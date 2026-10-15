import { createLogger } from '../lib/logger.js'
import { startJob, subscribe, type Job } from './runner.js'

const log = createLogger('cadena')

/**
 * Encadena los pasos automaticos de la tuberia.
 *
 * Antes habia que pulsar un boton por cada paso: subir el video, luego buscar
 * momentos, luego crear los videos. Los tres son mecanicos y siempre van en el
 * mismo orden, asi que esperar a que alguien los dispare solo añade tiempo
 * muerto, y encima hay que estar delante para hacerlo.
 *
 *   subir -> buscar momentos -> crear los videos -> [PARA]
 *
 * PARA AHI A PROPOSITO. El siguiente paso son las copias por cuenta, y esas
 * solo se generan de clips aprobados. La compuerta de aprobacion es lo unico
 * que separa "el programa propone" de "el programa publica solo", y encadenarla
 * seria quitarla.
 */

/** Trabajos ya encadenados, para no lanzar el siguiente paso dos veces. */
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
  return patron.exec(job.lines.join('\n'))?.[1]
}

/** Decide que toca despues, o nada si la cadena termina aqui. */
function siguientePaso(job: Job): { kind: 'select' | 'render'; sourceId: string } | null {
  if (job.kind === 'ingest') {
    const sourceId = leerDelResumen(job, 'sourceId')
    if (sourceId === undefined) {
      log.warn('El ingest acabo bien pero no se pudo leer el sourceId. La cadena se detiene.')
      return null
    }
    return { kind: 'select', sourceId }
  }

  if (job.kind === 'select') {
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

  return null
}

/**
 * Arranca el encadenado.
 *
 * Se engancha al mismo canal de avisos que ya usa el panel para el progreso en
 * vivo, asi que el ejecutor no necesita saber nada de la tuberia: sigue siendo
 * un lanzador de procesos y la logica de que va despues de que vive aqui.
 */
export function startChain(): void {
  if (process.env.AUTO_CHAIN === '0') {
    log.info('Encadenado desactivado por AUTO_CHAIN=0. Cada paso habra que lanzarlo a mano.')
    return
  }

  subscribe((job) => {
    // El canal avisa en cada linea de salida, no solo al terminar.
    if (job.status !== 'ok') return
    if (yaEncadenados.has(job.id)) return
    yaEncadenados.add(job.id)

    const siguiente = siguientePaso(job)
    if (siguiente === null) return

    const etiquetas = {
      select: `Buscar momentos de ${siguiente.sourceId}`,
      render: `Crear los videos de ${siguiente.sourceId}`,
    }

    log.info(`${job.kind} termino, sigue ${siguiente.kind} de ${siguiente.sourceId}`)
    startJob({
      kind: siguiente.kind,
      args: [siguiente.sourceId],
      label: etiquetas[siguiente.kind],
    })
  })
}
