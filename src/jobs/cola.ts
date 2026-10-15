import { randomUUID } from 'node:crypto'
import type { Db } from '../store/db.js'

/**
 * La cola de tareas, en la base de datos.
 *
 * Es el punto de encuentro entre el panel y el ordenador con tarjeta grafica.
 * El panel apunta lo que hay que hacer; el PC pregunta cada pocos segundos si
 * le toca algo.
 *
 * VA EN ESE SENTIDO A PROPOSITO. Si el panel llamara al PC, habria que abrir
 * puertos en casa y tener una direccion fija. Preguntando el PC, basta con que
 * tenga internet.
 */

/**
 * Los tipos de tarea admitidos.
 *
 * Es una lista y no solo un tipo porque hay que comprobar en tiempo de
 * ejecucion lo que llega del panel: el tipo de TypeScript desaparece al
 * compilar y no sirve para validar una peticion HTTP.
 *
 * Cada nombre es tambien el del script: `scripts/<kind>.ts`. El trabajador lo
 * usa tal cual para construir el comando, asi que esta lista es lo unico que
 * impide que una peticion ejecute un fichero cualquiera.
 */
export const JOB_KINDS = [
  'doctor', 'ingest', 'select', 'momentos', 'render', 'subir',
  'accounts', 'variants', 'schedule', 'publish', 'metrics',
] as const

export type JobKind = (typeof JOB_KINDS)[number]

export type JobStatus = 'queued' | 'running' | 'ok' | 'error' | 'cancelled'

export interface Job {
  id: string
  kind: JobKind
  args: string[]
  label: string
  status: JobStatus
  claimedBy: string | null
  lastLine: string
  log: string
  attemptCount: number
  exitCode: number | null
  createdAt: string
  endedAt: string | null
}

/**
 * Cuanto puede estar una tarea sin dar señales antes de darla por perdida.
 *
 * El trabajador late cada 15 segundos. Cinco minutos de silencio significan que
 * el PC se apago, se suspendio o se quedo sin red a media tarea. Se pone alto a
 * proposito: un render largo no emite nada durante minutos y no queremos
 * quitarselo de las manos mientras trabaja.
 */
const SIN_SEÑALES_MS = 5 * 60_000

/** Reintentos antes de rendirse. */
const MAX_INTENTOS = 3

/** Lineas de salida que se conservan. Lo que falla, falla al final. */
const LINEAS_LOG = 120

function aJob(r: Record<string, unknown>): Job {
  return {
    id: r.id as string,
    kind: r.kind as JobKind,
    args: (r.args ?? []) as string[],
    label: r.label as string,
    status: r.status as JobStatus,
    claimedBy: (r.claimed_by ?? null) as string | null,
    lastLine: (r.last_line ?? '') as string,
    log: (r.log ?? '') as string,
    attemptCount: Number(r.attempt_count ?? 0),
    exitCode: r.exit_code === null ? null : Number(r.exit_code),
    createdAt: new Date(r.created_at as string).toISOString(),
    endedAt: r.ended_at === null ? null : new Date(r.ended_at as string).toISOString(),
  }
}

export function createCola(db: Db, ownerId: string) {
  return {
    /** Apunta una tarea. La hace quien pregunte primero. */
    async encolar(kind: JobKind, args: string[], label: string): Promise<Job> {
      const filas = await db.query(
        `insert into jobs (id, owner_id, kind, args, label)
         values ($1, $2, $3, $4, $5) returning *`,
        [randomUUID().slice(0, 8), ownerId, kind, args, label],
      )
      return aJob(filas[0] as Record<string, unknown>)
    },

    /**
     * Coge la siguiente tarea, si hay.
     *
     * `for update skip locked` es lo que impide que dos trabajadores se lleven
     * la misma. El primero bloquea la fila; el segundo, en vez de esperar a que
     * se libere, la salta y mira la siguiente. Sin eso, dos PCs encendidos
     * renderizarian el mismo video a la vez.
     */
    async coger(trabajador: string): Promise<Job | null> {
      const filas = await db.query(
        `update jobs set
           status = 'running',
           claimed_by = $2,
           claimed_at = now(),
           heartbeat_at = now(),
           attempt_count = attempt_count + 1
         where id = (
           select id from jobs
           where owner_id = $1 and status = 'queued'
           order by created_at
           limit 1
           for update skip locked
         )
         returning *`,
        [ownerId, trabajador],
      )
      return filas[0] === undefined ? null : aJob(filas[0] as Record<string, unknown>)
    },

    /** Da señales de vida y publica la ultima linea de salida. */
    async latir(id: string, ultimaLinea: string, log: string[]): Promise<void> {
      await db.query(
        `update jobs set heartbeat_at = now(), last_line = $2, log = $3
         where id = $1 and owner_id = $4`,
        [id, ultimaLinea.slice(0, 500), log.slice(-LINEAS_LOG).join('\n'), ownerId],
      )
    },

    /**
     * Cierra una tarea.
     *
     * Escribe tambien la ultima linea, y no solo el registro completo. Sin eso,
     * una tarea que dura menos que el intervalo de latido nunca llega a
     * publicar progreso y el panel la enseña muda: se ve "hecho" pero no que
     * hizo. Le pasaba a todas las tareas cortas.
     */
    async terminar(
      id: string,
      status: 'ok' | 'error' | 'cancelled',
      exitCode: number | null,
      log: string[],
    ): Promise<void> {
      const ultima = log.at(-1) ?? ''
      await db.query(
        `update jobs set status = $2, exit_code = $3, ended_at = now(), log = $4, last_line = $5
         where id = $1 and owner_id = $6`,
        [id, status, exitCode, log.slice(-LINEAS_LOG).join('\n'), ultima.slice(0, 500), ownerId],
      )
    },

    /**
     * Devuelve a la cola las tareas cuyo trabajador dejo de dar señales.
     *
     * Sin esto, apagar el PC a media transcripcion deja la tarea en 'running'
     * para siempre: el panel dice que esta trabajando y no trabaja nadie.
     *
     * Pasados unos cuantos intentos se marca como fallida en vez de reintentar
     * sin fin. Una tarea que tumba al trabajador tres veces no va a funcionar
     * a la cuarta.
     */
    async recuperarPerdidas(): Promise<{ devueltas: number; rendidas: number }> {
      const devueltas = await db.query(
        `update jobs set status = 'queued', claimed_by = null
         where owner_id = $1 and status = 'running'
           and heartbeat_at < now() - interval '${SIN_SEÑALES_MS} milliseconds'
           and attempt_count < ${MAX_INTENTOS}
         returning id`,
        [ownerId],
      )
      const rendidas = await db.query(
        `update jobs set status = 'error', ended_at = now(),
           last_line = 'El trabajador dejo de responder tras varios intentos.'
         where owner_id = $1 and status = 'running'
           and heartbeat_at < now() - interval '${SIN_SEÑALES_MS} milliseconds'
           and attempt_count >= ${MAX_INTENTOS}
         returning id`,
        [ownerId],
      )
      return { devueltas: devueltas.length, rendidas: rendidas.length }
    },

    /** Cancela una tarea. Si esta corriendo, el trabajador lo vera al latir. */
    async cancelar(id: string): Promise<boolean> {
      const filas = await db.query(
        `update jobs set status = 'cancelled', ended_at = now()
         where id = $1 and owner_id = $2 and status in ('queued', 'running')
         returning id`,
        [id, ownerId],
      )
      return filas.length > 0
    },

    /** Para que el trabajador sepa que le han cancelado la tarea. */
    async sigueViva(id: string): Promise<boolean> {
      const filas = await db.query(
        `select status from jobs where id = $1 and owner_id = $2`,
        [id, ownerId],
      )
      return (filas[0] as { status?: string } | undefined)?.status === 'running'
    },

    async recientes(limite = 40): Promise<Job[]> {
      const filas = await db.query(
        `select * from jobs where owner_id = $1 order by created_at desc limit $2`,
        [ownerId, limite],
      )
      return filas.map((f) => aJob(f as Record<string, unknown>))
    },

    /**
     * Hay ya una tarea de ese tipo en marcha para ese VOD.
     *
     * Lo necesita el reparto automatico. Aprobar el ultimo clip de un VOD
     * encola el reparto, pero el usuario puede volver atras y aprobar otro mas:
     * sin esta comprobacion, cada ida y vuelta por la compuerta encolaria otra
     * tanda de variantes de los mismos clips.
     *
     * `args[1]` es el primer argumento: en Postgres los arrays empiezan en 1.
     */
    async hayActiva(kinds: readonly JobKind[], sourceId: string): Promise<boolean> {
      const filas = await db.query(
        `select 1 from jobs
          where owner_id = $1 and kind = any($2) and status in ('queued', 'running')
            and args[1] = $3
          limit 1`,
        [ownerId, [...kinds], sourceId],
      )
      return filas.length > 0
    },

    async porId(id: string): Promise<Job | null> {
      const filas = await db.query(`select * from jobs where id = $1 and owner_id = $2`, [
        id,
        ownerId,
      ])
      return filas[0] === undefined ? null : aJob(filas[0] as Record<string, unknown>)
    },
  }
}

export type Cola = ReturnType<typeof createCola>
