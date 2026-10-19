/**
 * El trabajador. Corre en el ordenador que tiene la tarjeta grafica.
 *
 *   npm run worker
 *
 * Pregunta a la base de datos si hay tareas, coge una, la ejecuta con la GPU y
 * devuelve el resultado. Nada mas. El panel vive en otro sitio y no sabe nada
 * de este proceso mas alla de lo que lee en la tabla de tareas.
 *
 * ES EL PC QUIEN PREGUNTA, no el servidor quien llama. Asi no hace falta abrir
 * puertos en casa, ni tener IP fija, ni que el router colabore. Basta con que
 * este ordenador tenga internet.
 *
 * Se puede apagar en cualquier momento. La tarea a medias vuelve a la cola sola
 * cuando deja de dar señales.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { hostname } from 'node:os'
import { createRequire } from 'node:module'
import { loadEnv, requireEnv, ROOT } from '../src/lib/env.js'
import { createLogger } from '../src/lib/logger.js'
import { OWNER_ID as OWNER } from '../src/lib/owner.js'
import { connect } from '../src/store/db.js'
import { publicarResultado } from '../src/store/publicar.js'
import { createCola, type Job } from '../src/jobs/cola.js'
import {
  createEstadoIA,
  iaPausada,
  KINDS_DE_IA,
  leerMarca,
  MARCA_ESPERA_IA,
  MARCA_ESTADO_IA,
  SALIDA_ESPERA_IA,
} from '../src/llm/estado.js'
import { MAX_REINTENTOS, seReintenta } from '../src/jobs/reintentos.js'
import { createSistema } from '../src/jobs/sistema.js'

loadEnv()

const log = createLogger('worker')
const TSX = createRequire(import.meta.url).resolve('tsx/cli')

/** Cada cuanto se pregunta si hay trabajo. */
const INTERVALO_MS = 5_000

/** Cada cuanto se da señal de vida mientras se trabaja. */
const LATIDO_MS = 15_000

/*
 * Cada cuanto dice el PC "sigo aqui", haga lo que haga.
 *
 * Antes solo latia entre tarea y tarea: durante un render de veinte minutos el
 * panel lo daba por desconectado. Ahora late con su propio reloj, tambien
 * mientras trabaja.
 */
const LATIDO_TRABAJADOR_MS = 30_000

/** Identidad de este trabajador. Sirve para saber quien cogio que. */
const YO = `${hostname()}-${process.pid}`

const db = await connect(requireEnv('DATABASE_URL'))
const cola = createCola(db, OWNER)
const estadoIA = createEstadoIA(db, OWNER)
const sistema = createSistema(db, OWNER)

let parando = false
let actual: ChildProcess | null = null

/**
 * Ejecuta una tarea y devuelve como acabo.
 *
 * Mientras corre, late hacia la base cada quince segundos con la ultima linea
 * de salida. Eso es lo que permite dos cosas: que el panel enseñe el progreso,
 * y que si este ordenador se apaga, la tarea se detecte perdida y vuelva a la
 * cola en vez de quedarse en marcha para siempre.
 */
async function ejecutar(job: Job): Promise<'ok' | 'error' | 'cancelled' | 'en_espera_ia'> {
  log.info(`${job.kind} ${job.args.join(' ')} (${job.id})`)

  const lineas: string[] = []
  // Las marcas de estado de la IA van aparte: son para este proceso, no para
  // la pantalla. Una linea de JSON como ultima linea de la tarjeta no le dice
  // nada a nadie.
  const marcas: string[] = []
  let ultima = ''
  let cancelada = false

  /*
   * El navegador de cookies para yt-dlp se elige en el panel (Ajustes,
   * Sistema). Si esta en el .env, manda el .env, como con el resto.
   */
  const env = { ...process.env }
  if (job.kind === 'ingest' && env.YTDLP_COOKIES_FROM_BROWSER === undefined) {
    const { ytdlpCookies } = await sistema.ajustes().catch(() => ({ ytdlpCookies: '' }))
    if (ytdlpCookies !== '') env.YTDLP_COOKIES_FROM_BROWSER = ytdlpCookies
  }

  const hijo = spawn(process.execPath, [TSX, `scripts/${job.kind}.ts`, ...job.args], {
    cwd: ROOT,
    env,
    windowsHide: true,
  })
  actual = hijo

  const recoger = (chunk: Buffer): void => {
    for (const linea of chunk.toString('utf8').split('\n')) {
      const limpia = linea.replace(/\r/g, '').trimEnd()
      if (limpia === '') continue
      if (limpia.includes(MARCA_ESPERA_IA) || limpia.includes(MARCA_ESTADO_IA)) {
        marcas.push(limpia)
        continue
      }
      lineas.push(limpia)
      ultima = limpia
    }
  }
  hijo.stdout.on('data', recoger)
  hijo.stderr.on('data', recoger)

  const latido = setInterval(() => {
    void (async () => {
      await cola.latir(job.id, ultima, lineas)
      // El panel puede haber cancelado mientras tanto. Se comprueba en el mismo
      // latido para no abrir una consulta aparte.
      if (!(await cola.sigueViva(job.id)) && !cancelada) {
        cancelada = true
        log.warn(`${job.id} cancelado desde el panel`)
        matar(hijo)
      }
    })()
  }, LATIDO_MS)

  const codigo = await new Promise<number | null>((resolve) => {
    hijo.on('close', (c) => resolve(c))
    hijo.on('error', (e) => {
      lineas.push(`No se pudo lanzar: ${e.message}`)
      resolve(1)
    })
  })

  clearInterval(latido)
  actual = null

  /*
   * Lo que la tarea dijo de la IA.
   *
   * Si no pudo preguntar (sin sesion, limite, sin CLI) la tarea NO falla:
   * queda en `en_espera_ia` y la cola de IA se pausa hasta la hora de vuelta o
   * hasta que alguien pulse "Reintentar". Reintentar ahora daria lo mismo.
   */
  const leida = leerMarca(marcas)
  if (leida !== null) {
    try {
      await estadoIA.guardar(leida.marca)
    } catch (error) {
      log.error('No se pudo guardar el estado de la IA', error)
    }
  }

  if (!cancelada && codigo === SALIDA_ESPERA_IA && leida?.espera === true) {
    await cola.terminar(job.id, 'en_espera_ia', codigo, lineas)
    log.warn(`${job.id} -> en espera de la IA (${leida.marca.estado}). Se pausan las tareas de IA.`)
    return 'en_espera_ia'
  }

  const estado = cancelada ? 'cancelled' : codigo === 0 ? 'ok' : 'error'

  if (estado === 'error') {
    const espera = seReintenta(job.kind, codigo, job.reintentos)
    if (espera !== null) {
      const hora = new Date(Date.now() + espera * 1000)
      const hh = String(hora.getHours()).padStart(2, '0') + ':' + String(hora.getMinutes()).padStart(2, '0')
      const linea = `Falló; se reintenta sola a las ${hh} (intento ${job.reintentos + 1} de ${MAX_REINTENTOS}).`
      await cola.reprogramar(job.id, espera, lineas, linea)
      log.warn(`${job.id} -> fallo, reintento ${job.reintentos + 1} de ${MAX_REINTENTOS} en ${espera} s`)
      return 'error'
    }
  }

  await cola.terminar(job.id, estado, codigo, lineas)
  log.info(`${job.id} -> ${estado}`)

  /*
   * Lo que produjo la tarea, contado al panel.
   *
   * Los scripts escriben en disco, que es donde tiene que estar un MP4 de
   * cuarenta megas. Pero el panel corre en un servidor que no ve este disco:
   * sin este paso, un VOD recien transcrito no aparece en ninguna pantalla.
   *
   * Va DESPUES de cerrar la tarea y en su propio try. Si la base falla justo
   * aqui, la tarea ya quedo marcada como hecha y el trabajo no se repite; se
   * pierde la actualizacion del panel, que se arregla sola en la siguiente
   * tarea del mismo VOD.
   */
  if (estado === 'ok') {
    try {
      await publicarResultado(db, OWNER, job.kind, job.args, lineas.join('\n'))
    } catch (error) {
      log.error('La tarea acabo bien pero no se pudo publicar al panel', error)
    }
  }

  return estado
}

/**
 * Mata un proceso y sus hijos.
 *
 * En Windows no hay grupos de proceso: matar al padre dejaria vivo el ffmpeg
 * que lanzo, ocupando la GPU hasta terminar el render que ya nadie quiere.
 */
function matar(hijo: ChildProcess): void {
  const pid = hijo.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    hijo.kill('SIGTERM')
  }
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// --- Salida ordenada --------------------------------------------------------
//
// Al pulsar Ctrl+C se deja de coger trabajo nuevo y se mata lo que hubiera en
// marcha. La tarea queda en 'running' sin latir, y en unos minutos vuelve sola
// a la cola. Es preferible a marcarla fallida: puede que el ordenador se
// encienda otra vez en un minuto.
for (const señal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(señal, () => {
    if (parando) process.exit(1)
    parando = true
    log.info('Parando. La tarea en curso volvera a la cola sola.')
    if (actual !== null) matar(actual)
  })
}

// --- Bucle principal --------------------------------------------------------

log.info(`Trabajador ${YO} en marcha. Preguntando cada ${INTERVALO_MS / 1000}s.`)

const latidoPropio = setInterval(() => {
  void cola.latirTrabajador(YO).catch((e: unknown) => log.error('No se pudo latir', e))
}, LATIDO_TRABAJADOR_MS)
await cola.latirTrabajador(YO).catch(() => {})

/*
 * Lo que este mismo PC dejo a medias (se cerro, se fue la luz) vuelve a la
 * cola en el acto: no hace falta esperar los cinco minutos sin latido.
 */
{
  const recuperadas = await cola.recuperarDeEsteEquipo(hostname(), YO).catch(() => 0)
  if (recuperadas > 0) log.warn(`${recuperadas} tarea(s) que quedaron a medias vuelven a la cola.`)
}

let ocioso = 0
while (!parando) {
  try {
    /*
     * Lo primero: decir que estoy aqui.
     *
     * Antes de mirar si hay trabajo, porque el dato que hace falta al otro
     * lado es precisamente "hay alguien escuchando AUNQUE no haya nada que
     * hacer". Sin esto, el panel no podia distinguir un PC apagado de uno
     * encendido y ocioso, y por eso se negaba a encolar desde el movil.
     */
    await cola.latirTrabajador(YO)

    // Antes de coger nada, se rescatan las que otro trabajador dejo colgadas.
    const { devueltas, rendidas } = await cola.recuperarPerdidas()
    if (devueltas > 0) log.warn(`${devueltas} tarea(s) perdidas devueltas a la cola`)
    if (rendidas > 0) log.error(`${rendidas} tarea(s) descartadas tras varios intentos`)

    /*
     * La IA: si la hora de vuelta ya paso, lo que esperaba vuelve a la cola.
     * Si sigue en pausa, las tareas de IA se saltan y el resto sigue: un
     * limite de uso no tiene por que parar un render.
     */
    const reanudadas = await estadoIA.reanudar()
    if (reanudadas > 0) log.info(`La IA vuelve a estar disponible: ${reanudadas} tarea(s) de nuevo en la cola.`)
    const pausada = iaPausada(await estadoIA.leer())

    const job = await cola.coger(YO, pausada ? KINDS_DE_IA : [])
    if (job === null) {
      // Se avisa de vez en cuando, no en cada vuelta: con 5 segundos de
      // intervalo serian 720 lineas por hora sin decir nada nuevo.
      ocioso += 1
      if (ocioso % 60 === 1) log.info('Sin trabajo pendiente.')
      // yt-dlp, disco y retencion: cada cosa a su ritmo (semanal, media hora, diario).
      if (ocioso % 12 === 1) await sistema.mantenimiento()
      await dormir(INTERVALO_MS)
      continue
    }

    ocioso = 0
    await ejecutar(job)
  } catch (error) {
    // Un corte de red no debe tumbar el trabajador: se espera y se reintenta.
    log.error('Fallo en el bucle, reintentando', error)
    await dormir(INTERVALO_MS * 3)
  }
}

clearInterval(latidoPropio)
await db.close()
log.info('Trabajador detenido.')
