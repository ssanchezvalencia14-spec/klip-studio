import { createLogger } from '../lib/logger.js'
import type { Cola, Job } from './cola.js'

const log = createLogger('cadena')

/**
 * Encadena los pasos automaticos de la tuberia, sobre la cola de la base.
 *
 * Es el mismo encadenado de antes, con una diferencia de fondo: ya no se
 * engancha a un canal de eventos en memoria. No puede: quien ejecuta las tareas
 * es el trabajador, que corre en otro ordenador y no comparte memoria con el
 * panel. Lo unico que ven los dos es la tabla de tareas, asi que aqui se mira
 * esa tabla.
 *
 *   descargar -> buscar momentos -> crear los videos -> subirlos -> [COMPUERTA]
 *   [COMPUERTA] -> copias por cuenta -> repartir en el calendario
 *
 * LA COMPUERTA SIGUE SIENDO HUMANA. Lo que cambia es que ya no hay que hacer
 * nada MAS que aprobar: antes la cadena moria aqui y los dos pasos de despues
 * habia que lanzarlos a mano desde una terminal, asi que quien revisaba desde
 * el movil terminaba con clips aprobados que no salian a ninguna parte.
 *
 * Quien dispara la segunda mitad no es este fichero sino `reparto.ts`, cuando
 * un VOD se queda sin nada pendiente de revisar. Aqui solo se encadena el paso
 * que va detras de las copias.
 *
 * La subida SI se encadena, aunque sea el paso inmediatamente anterior a la
 * compuerta. No es una decision: es lo que hace que los clips se puedan ver
 * desde el movil. Dejarla fuera significaria que añadir un VOD desde el telefono
 * termina con un monton de videos que desde ese mismo telefono no se ven, que es
 * justo el problema que la Fase 7 existe para arreglar.
 */

/** Cada cuanto se mira si algo termino. */
const INTERVALO_MS = 6_000

/**
 * Tareas ya encadenadas.
 *
 * VIVE EN MEMORIA A PROPOSITO, y eso tiene una consecuencia: si el panel se
 * reinicia justo despues de encadenar, el paso siguiente podria lanzarse dos
 * veces. Se acepta porque la alternativa (una columna en la tabla) cambiaria el
 * esquema para cubrir una ventana de segundos, y porque lanzar dos veces un
 * select o un render no rompe nada: sobrescriben su salida.
 */
const yaEncadenados = new Set<string>()

/**
 * Saca un valor del resumen que imprime cada script.
 *
 * Se lee de la salida y no de un fichero porque el identificador del video no
 * existe hasta que el ingest termina: se deriva del contenido. El formato es
 * estable porque los scripts son nuestros, pero si alguien cambia el resumen
 * esto deja de encadenar, y por eso falla en silencio con un aviso en vez de
 * romper nada.
 */
function leerDelResumen(job: Job, campo: string): string | undefined {
  const patron = new RegExp(`^${campo}\\s*:\\s*(\\S+)`, 'm')
  return patron.exec(job.log)?.[1]
}

type PasoEncadenable = 'select' | 'momentos' | 'render' | 'subir' | 'schedule'

/** Decide que toca despues, o nada si la cadena termina aqui. */
function siguientePaso(job: Job): { kind: PasoEncadenable; sourceId: string } | null {
  if (job.kind === 'ingest') {
    const sourceId = leerDelResumen(job, 'sourceId')
    if (sourceId === undefined) {
      log.warn('El ingest acabo bien pero no se pudo leer el sourceId. La cadena se detiene.')
      return null
    }
    // Un video musical no pasa por la IA: se buscan los estribillos en el audio.
    return { kind: job.args.includes('--musica') ? 'momentos' : 'select', sourceId }
  }

  // El atajo de musica desemboca en el mismo sitio que `select`: hay cortes
  // anotados, toca convertirlos en video.
  if (job.kind === 'select' || job.kind === 'momentos') {
    // Sin momentos no hay nada que renderizar. Lanzar el render igualmente
    // gastaria GPU para producir cero archivos y dejaria un fallo confuso.
    const clips = Number(leerDelResumen(job, 'Clips') ?? '0')
    if (!Number.isFinite(clips) || clips === 0) {
      log.info('La busqueda no encontro momentos aprovechables. No hay nada que renderizar.')
      return null
    }

    const sourceId = job.args[0]
    if (sourceId === undefined) return null
    return { kind: 'render', sourceId }
  }

  if (job.kind === 'render') {
    // Sin archivos no hay nada que subir. Encolar la subida igualmente dejaria
    // un trabajo que recorre cero clips y acaba en verde, que se lee como que
    // los videos ya estan arriba.
    const archivos = Number(leerDelResumen(job, 'Clips renderizados') ?? '0')
    if (!Number.isFinite(archivos) || archivos === 0) {
      log.info('El render no produjo archivos. No hay nada que subir.')
      return null
    }

    const sourceId = job.args[0]
    if (sourceId === undefined) return null
    return { kind: 'subir', sourceId }
  }

  /*
   * Las copias por cuenta ya estan: toca repartirlas en el calendario.
   *
   * Es el ultimo eslabon. Despues de esto los videos tienen fecha y hora, y el
   * publicador los va soltando solo; no hay nada mas que lanzar.
   *
   * No se comprueba cuantas copias salieron. `variants` ya se niega a correr si
   * no hay nada aprobado, asi que si llego hasta aqui en verde es que produjo
   * copias.
   */
  if (job.kind === 'variants') {
    const sourceId = job.args[0]
    if (sourceId === undefined) return null
    return { kind: 'schedule', sourceId }
  }

  return null
}

const ETIQUETAS = {
  select: (id: string) => `Buscar momentos de ${id}`,
  momentos: (id: string) => `Buscar estribillos de ${id}`,
  render: (id: string) => `Armar clips de ${id}`,
  subir: (id: string) => `Subir para revisar ${id}`,
  schedule: (id: string) => `Repartir ${id} entre las cuentas`,
}

/**
 * Arranca el encadenado y devuelve la funcion para pararlo.
 *
 * La primera vuelta marca como vistas todas las tareas que ya habian terminado
 * antes de arrancar. Sin eso, reiniciar el panel relanzaria el select de cada
 * ingest del historial, que son horas de GPU por un reinicio.
 */
export function arrancarCadena(cola: Cola, alEncolar?: () => void): () => void {
  if (process.env.AUTO_CHAIN === '0') {
    log.info('Encadenado desactivado por AUTO_CHAIN=0. Cada paso habra que lanzarlo a mano.')
    return () => {}
  }

  let primeraVuelta = true

  const mirar = async (): Promise<void> => {
    const recientes = await cola.recientes(40)

    for (const job of recientes) {
      if (job.status !== 'ok') continue
      if (yaEncadenados.has(job.id)) continue
      yaEncadenados.add(job.id)

      if (primeraVuelta) continue

      const siguiente = siguientePaso(job)
      if (siguiente === null) continue

      /*
       * Cada panel encendido corre su propio encadenado (Hostinger, el local,
       * la vista previa) y cada uno recuerda en memoria lo que ya encadeno.
       * Sin esta comprobacion en la base, dos paneles encolaban el mismo paso
       * dos veces: una de las causas de las ejecuciones repetidas de "Elegir
       * momentos". `en_espera_ia` tambien cuenta: ese paso ya esta pedido.
       */
      if (await cola.hayActiva([siguiente.kind], siguiente.sourceId)) {
        log.info(`${siguiente.kind} de ${siguiente.sourceId} ya esta en la cola. No se repite.`)
        continue
      }

      log.info(`${job.kind} termino, sigue ${siguiente.kind} de ${siguiente.sourceId}`)
      await cola.encolar(
        siguiente.kind,
        // Sin --aplicar, momentos solo enseña la propuesta y no escribe clips.json.
        siguiente.kind === 'momentos' ? [siguiente.sourceId, '--aplicar'] : [siguiente.sourceId],
        ETIQUETAS[siguiente.kind](siguiente.sourceId),
      )
      alEncolar?.()
    }

    primeraVuelta = false
  }

  const timer = setInterval(() => {
    // Un corte de red no debe tumbar el panel: se anota y se reintenta en la
    // siguiente vuelta.
    void mirar().catch((error: unknown) => log.error('No se pudo revisar la cadena', error))
  }, INTERVALO_MS)

  // Sin unref, este temporizador mantendria vivo el proceso al cerrar.
  timer.unref()

  void mirar().catch((error: unknown) => log.error('No se pudo revisar la cadena', error))

  return () => clearInterval(timer)
}
