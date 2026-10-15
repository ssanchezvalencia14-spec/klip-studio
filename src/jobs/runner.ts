import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { ROOT } from '../lib/env.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('jobs')

/**
 * Ruta del lanzador de tsx.
 *
 * Se resuelve por el propio resolutor de Node y no componiendo la ruta a mano:
 * en Windows una URL de fichero llega como `/C:/...` y hay que limpiarle la
 * barra inicial, que es justo la clase de detalle que se rompe en silencio.
 */
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli')

/**
 * Ejecutor de trabajos largos para el panel.
 *
 * El panel lanza comandos que tardan minutos: transcribir un VOD son ~6, el
 * render de 37 clips ~7, las 120 variantes ~17. Eso no cabe en una peticion
 * HTTP: el navegador corta mucho antes y recargar la pagina perderia el hilo.
 *
 * Por eso el trabajo vive en el servidor y la pagina solo lo observa. Se lanza
 * con un POST que responde al instante con un id, y el progreso viaja por SSE.
 * Si cierras el movil y vuelves media hora despues, el trabajo sigue y la
 * pagina se reengancha donde estaba.
 *
 * EN SERIE Y NO EN PARALELO. Todos estos comandos pelean por los mismos
 * recursos: transcribir y renderizar usan la misma GPU, y descargar y renderizar
 * el mismo disco. Lanzar dos a la vez no acelera nada y multiplica los fallos
 * por falta de VRAM. Lo que llega mientras hay algo corriendo se encola.
 */

export type JobKind =
  | 'doctor'
  | 'ingest'
  | 'select'
  | 'render'
  | 'accounts'
  | 'variants'
  | 'schedule'
  | 'publish'
  | 'metrics'

/** Los unicos comandos lanzables. La lista es la frontera de seguridad. */
export const JOB_KINDS: readonly JobKind[] = [
  'doctor',
  'ingest',
  'select',
  'render',
  'accounts',
  'variants',
  'schedule',
  'publish',
  'metrics',
]

export type JobStatus = 'queued' | 'running' | 'ok' | 'error' | 'cancelled'

export interface Job {
  id: string
  kind: JobKind
  args: string[]
  label: string
  status: JobStatus
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  exitCode: number | null
  /** Ultima linea util, para enseñar progreso sin abrir el registro entero. */
  lastLine: string
  lines: string[]
}

/**
 * Tope de lineas guardadas por trabajo.
 *
 * Un render de 37 clips emite ~80 lineas y un ingest con yt-dlp puede pasar de
 * mil por las actualizaciones de porcentaje. Se guardan las ultimas y no las
 * primeras porque cuando algo falla, el error esta al final.
 */
const MAX_LINES = 400

/** Trabajos que se recuerdan una vez terminados. */
const MAX_HISTORY = 40

const jobs = new Map<string, Job>()
const pending: Job[] = []
let active: { job: Job; child: ChildProcess } | null = null

type Listener = (job: Job) => void
const listeners = new Set<Listener>()

/** Avisa a los observadores. Un fallo en uno no debe tumbar el trabajo. */
function emit(job: Job): void {
  for (const listener of listeners) {
    try {
      listener(job)
    } catch {
      // Un observador caido no es problema del trabajo.
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id)
}

export function activeJob(): Job | null {
  return active?.job ?? null
}

/** Descarta los trabajos terminados mas antiguos. */
function prune(): void {
  const done = listJobs().filter((j) => j.status !== 'running' && j.status !== 'queued')
  for (const job of done.slice(MAX_HISTORY)) jobs.delete(job.id)
}

function push(job: Job, line: string): void {
  const clean = line.replace(/\r/g, '').trimEnd()
  if (clean === '') return

  job.lines.push(clean)
  if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
  job.lastLine = clean
  emit(job)
}

/**
 * Arranca el siguiente de la cola, si no hay nada corriendo.
 *
 * Se invoca al encolar y al terminar cada trabajo, que son los dos unicos
 * momentos en que la cola puede avanzar.
 */
function drain(): void {
  if (active !== null) return

  const job = pending.shift()
  if (job === undefined) return

  job.status = 'running'
  job.startedAt = new Date().toISOString()
  emit(job)

  // Se invoca tsx directamente y no "npm run": npm añade su propia capa de
  // proceso, y al cancelar un trabajo matariamos el envoltorio dejando huerfano
  // el ffmpeg de dentro, que seguiria ocupando la GPU.
  const child = spawn(process.execPath, [TSX_CLI, `scripts/${job.kind}.ts`, ...job.args], {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
  })

  active = { job, child }
  log.info(`${job.kind} ${job.args.join(' ')} -> ${job.id}`)

  let outRest = ''
  let errRest = ''

  const feed = (rest: string, chunk: Buffer, sink: (l: string) => void): string => {
    const text = rest + chunk.toString('utf8')
    const parts = text.split('\n')
    const tail = parts.pop() ?? ''
    for (const part of parts) sink(part)
    return tail
  }

  child.stdout.on('data', (c: Buffer) => {
    outRest = feed(outRest, c, (l) => push(job, l))
  })
  child.stderr.on('data', (c: Buffer) => {
    errRest = feed(errRest, c, (l) => push(job, l))
  })

  const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (outRest.trim() !== '') push(job, outRest)
    if (errRest.trim() !== '') push(job, errRest)

    job.exitCode = code
    job.endedAt = new Date().toISOString()
    // Un proceso matado a proposito no es un fallo del sistema.
    job.status = job.status === 'cancelled' ? 'cancelled' : code === 0 ? 'ok' : 'error'

    if (signal !== null && job.status !== 'cancelled') {
      push(job, `Proceso terminado por señal ${signal}.`)
    }

    log.info(`${job.kind} ${job.id} -> ${job.status}${code === null ? '' : ` (${code})`}`)
    active = null
    emit(job)
    prune()
    drain()
  }

  child.on('error', (error: Error) => {
    push(job, `No se pudo lanzar el proceso: ${error.message}`)
    finish(1, null)
  })
  child.on('close', finish)
}

export interface StartOptions {
  kind: JobKind
  args?: string[]
  label?: string
}

export function startJob({ kind, args = [], label }: StartOptions): Job {
  const job: Job = {
    id: randomUUID().slice(0, 8),
    kind,
    args,
    label: label ?? `${kind} ${args.join(' ')}`.trim(),
    status: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastLine: 'En cola.',
    lines: [],
  }

  jobs.set(job.id, job)
  pending.push(job)
  emit(job)
  drain()
  return job
}

/**
 * Cancela un trabajo.
 *
 * En Windows no hay grupos de proceso como en POSIX, asi que matar el padre
 * dejaria vivo el ffmpeg que lanzo. Se usa taskkill con /T, que arrastra a los
 * hijos; sin eso un render cancelado seguiria ocupando la GPU hasta terminar.
 */
export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (job === undefined) return false

  if (job.status === 'queued') {
    const i = pending.indexOf(job)
    if (i !== -1) pending.splice(i, 1)
    job.status = 'cancelled'
    job.endedAt = new Date().toISOString()
    job.lastLine = 'Cancelado antes de empezar.'
    emit(job)
    return true
  }

  if (active?.job.id !== id) return false

  job.status = 'cancelled'
  push(job, 'Cancelando...')

  const pid = active.child.pid
  if (pid === undefined) return false

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    active.child.kill('SIGTERM')
  }
  return true
}
