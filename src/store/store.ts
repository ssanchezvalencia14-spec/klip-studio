import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fromRoot } from '../lib/env.js'
import { ensureDir, readJson, writeJson } from '../lib/fsx.js'
import type { VariantParams } from '../variants/params.js'

/**
 * Almacen respaldado por archivos JSON.
 *
 * La Fase 4 sustituira esto por Supabase. Se mantiene detras de estas funciones
 * a proposito: el resto del sistema no sabe donde vive el estado, asi que
 * migrar es reimplementar este modulo y nada mas. Es el mismo patron que el
 * adaptador de publicacion.
 *
 * Los archivos pesados (los MP4) nunca pasan por aqui; solo rutas.
 */
/**
 * Directorio de estado. Configurable para poder verificar el worker contra un
 * directorio temporal sin tocar la cola real.
 */
const STATE_DIR = fromRoot(process.env['STATE_DIR'] ?? 'state')

export type AccountStatus = 'active' | 'paused' | 'error'

export interface Account {
  id: string
  label: string
  status: AccountStatus
  /**
   * Horas ancla del dia, en formato 24h, una por publicacion diaria.
   * El planificador les aplica desviacion aleatoria.
   */
  slots: number[]
  tokenStatus: 'ok' | 'expired' | 'unknown'
  lastPublishedAt: string | null
}

export type QueueStatus = 'pending' | 'publishing' | 'published' | 'failed'

export interface QueueItem {
  id: string
  sourceId: string
  clipId: string
  accountId: string
  variantPath: string
  checksum: string
  params: VariantParams
  /** Texto de publicacion, ya variado para esta cuenta. */
  caption: string
  hashtags: string[]
  /** ISO 8601. Momento objetivo de publicacion. */
  scheduledAt: string
  status: QueueStatus
  attemptCount: number
  lastError: string | null
}

function pathFor(name: string): string {
  ensureDir(STATE_DIR)
  return join(STATE_DIR, `${name}.json`)
}

function load<T>(name: string): T[] {
  const file = pathFor(name)
  if (!existsSync(file)) return []
  return readJson<T[]>(file)
}

function save<T>(name: string, rows: T[]): void {
  writeJson(pathFor(name), rows)
}

export const accounts = {
  all: (): Account[] => load<Account>('accounts'),
  save: (rows: Account[]): void => save('accounts', rows),
  active: (): Account[] => load<Account>('accounts').filter((a) => a.status === 'active'),
}

export type ClipStatus = 'pending' | 'approved' | 'rejected'

/**
 * Un clip renderizado a la espera de revision.
 *
 * Es la compuerta del sistema. Sin ella, la Fase 5 genera 20 variantes y la
 * Fase 6 publica 60 videos diarios sin que nadie los haya visto. Un clip malo
 * replicado en 20 cuentas es peor que no publicar nada.
 */
export interface ClipRecord {
  sourceId: string
  /** Identificador dentro del VOD: clip-01, clip-02... */
  clipId: string
  start: number
  end: number
  hook: string
  reason: string
  caption: string
  hashtags: string[]
  score: number
  status: ClipStatus
  masterPath: string
  /**
   * Ruta de la copia de revision dentro del cubo. Vacia si no se ha subido.
   *
   * NO es el master. El master pesa 30 MB de mediana y se queda en este
   * ordenador, que es donde se publica desde el. Esto es una copia de 540x960
   * de algo mas de un mega cuyo unico trabajo es verse en un movil.
   */
  proxyPath: string
  /** Lo que ocupa esa copia. Para saber cuanto hay en la nube sin preguntarle. */
  proxyBytes: number
  reviewedAt: string | null
  /** Titulo corto (Fase 6). Vacio si la IA no dio uno. */
  titulo?: string
  /** Desglose del puntaje (Fase 6). null si la seleccion no lo dio. */
  puntajes?: { gancho: number; cierre: number; retencion: number } | null
  /** Lineas de la transcripcion dentro del clip, en segundos del video largo. */
  segmentos?: SegmentoClip[]
  /** Subtitulos editados a mano. null o ausente = los de la transcripcion. */
  subtitulos?: SegmentoClip[] | null
}

export interface SegmentoClip {
  start: number
  end: number
  text: string
}

function clipKey(sourceId: string, clipId: string): string {
  return `${sourceId}::${clipId}`
}

export const clips = {
  all: (): ClipRecord[] => load<ClipRecord>('clips'),
  save: (rows: ClipRecord[]): void => save('clips', rows),

  byStatus: (status: ClipStatus): ClipRecord[] =>
    load<ClipRecord>('clips').filter((c) => c.status === status),

  find: (sourceId: string, clipId: string): ClipRecord | undefined =>
    load<ClipRecord>('clips').find((c) => c.sourceId === sourceId && c.clipId === clipId),

  /**
   * Inserta los que faltan y NO toca los existentes.
   *
   * Reimportar un VOD ya revisado no debe devolver a pendiente lo que ya se
   * aprobo o rechazo: eso borraria el trabajo de revision sin avisar.
   */
  addMissing: (rows: ClipRecord[]): number => {
    const existing = load<ClipRecord>('clips')
    const seen = new Set(existing.map((c) => clipKey(c.sourceId, c.clipId)))
    const fresh = rows.filter((c) => !seen.has(clipKey(c.sourceId, c.clipId)))
    if (fresh.length > 0) save('clips', [...existing, ...fresh])
    return fresh.length
  },

  setStatus: (
    sourceId: string,
    clipId: string,
    status: ClipStatus,
    edits?: { caption?: string; hashtags?: string[] },
  ): ClipRecord | undefined => {
    const rows = load<ClipRecord>('clips')
    const i = rows.findIndex((c) => c.sourceId === sourceId && c.clipId === clipId)
    if (i === -1) return undefined
    const current = rows[i]
    if (current === undefined) return undefined

    rows[i] = {
      ...current,
      status,
      reviewedAt: new Date().toISOString(),
      ...(edits?.caption === undefined ? {} : { caption: edits.caption }),
      ...(edits?.hashtags === undefined ? {} : { hashtags: edits.hashtags }),
    }
    save('clips', rows)
    return rows[i]
  },
}

export interface Post {
  id: string
  queueItemId: string
  sourceId: string
  clipId: string
  accountId: string
  /** Identificador en el proveedor, para cruzar metricas en la Fase 7. */
  externalId: string
  provider: string
  mode: 'direct' | 'draft'
  publishedAt: string
}

export const posts = {
  all: (): Post[] => load<Post>('posts'),
  save: (rows: Post[]): void => save('posts', rows),
  add: (row: Post): void => save('posts', [...load<Post>('posts'), row]),

  /** Publicaciones de una cuenta desde un momento dado. Base del control de cadencia. */
  since: (accountId: string, from: Date): Post[] =>
    load<Post>('posts').filter(
      (p) => p.accountId === accountId && new Date(p.publishedAt) >= from,
    ),
}

/**
 * Una lectura de metricas de una publicacion en un momento dado.
 *
 * Se guardan varias lecturas por publicacion en lugar de un solo valor
 * acumulado porque la pregunta que importa no es "cuantas vistas tiene" sino
 * "como arranco": las vistas de las primeras horas predicen el alcance final
 * mejor que el total a los siete dias, y llegan a tiempo para decidir.
 */
export interface MetricSnapshot {
  id: string
  postId: string
  externalId: string
  accountId: string
  clipId: string
  capturedAt: string
  /** Horas transcurridas desde la publicacion cuando se tomo la lectura. */
  ageHours: number
  views: number
  likes: number
  comments: number
  shares: number
  averageWatchSec: number | null
}

export const metrics = {
  all: (): MetricSnapshot[] => load<MetricSnapshot>('metrics'),
  save: (rows: MetricSnapshot[]): void => save('metrics', rows),

  add: (rows: MetricSnapshot[]): number => {
    if (rows.length === 0) return 0
    const existing = load<MetricSnapshot>('metrics')
    save('metrics', [...existing, ...rows])
    return rows.length
  },

  /** Lecturas de una publicacion, de la mas antigua a la mas reciente. */
  forPost: (postId: string): MetricSnapshot[] =>
    load<MetricSnapshot>('metrics')
      .filter((m) => m.postId === postId)
      .sort((a, b) => a.ageHours - b.ageHours),
}

export const queue = {
  all: (): QueueItem[] => load<QueueItem>('queue'),
  save: (rows: QueueItem[]): void => save('queue', rows),

  /** Añade items sin duplicar: la clave es clip + cuenta + momento. */
  add: (items: QueueItem[]): number => {
    const existing = load<QueueItem>('queue')
    const seen = new Set(existing.map((i) => `${i.clipId}::${i.accountId}::${i.scheduledAt}`))
    const fresh = items.filter((i) => !seen.has(`${i.clipId}::${i.accountId}::${i.scheduledAt}`))
    if (fresh.length > 0) save('queue', [...existing, ...fresh])
    return fresh.length
  },

  /** Items vencidos y pendientes, en orden cronologico. */
  due: (now: Date): QueueItem[] =>
    load<QueueItem>('queue')
      .filter((i) => i.status === 'pending' && new Date(i.scheduledAt) <= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),

  /**
   * Actualiza un item por id.
   *
   * Se relee el archivo entero en cada llamada a proposito. Es lento, pero
   * evita que dos actualizaciones concurrentes se pisen escribiendo una copia
   * en memoria desactualizada. Cuando esto pase a Supabase el problema
   * desaparece solo.
   */
  update: (id: string, patch: Partial<QueueItem>): void => {
    const rows = load<QueueItem>('queue')
    const i = rows.findIndex((r) => r.id === id)
    if (i === -1) return
    const current = rows[i]
    if (current === undefined) return
    rows[i] = { ...current, ...patch }
    save('queue', rows)
  },
}

/** Marca el estado de una cuenta. Usado para sacarla de rotacion. */
export function setAccountStatus(
  accountId: string,
  status: AccountStatus,
  tokenStatus?: Account['tokenStatus'],
): void {
  const rows = accounts.all()
  const i = rows.findIndex((a) => a.id === accountId)
  if (i === -1) return
  const current = rows[i]
  if (current === undefined) return
  rows[i] = {
    ...current,
    status,
    ...(tokenStatus === undefined ? {} : { tokenStatus }),
  }
  accounts.save(rows)
}

/** Registra una publicacion exitosa en la cuenta. */
export function markAccountPublished(accountId: string, at: Date): void {
  const rows = accounts.all()
  const i = rows.findIndex((a) => a.id === accountId)
  if (i === -1) return
  const current = rows[i]
  if (current === undefined) return
  rows[i] = { ...current, lastPublishedAt: at.toISOString(), tokenStatus: 'ok' }
  accounts.save(rows)
}

/**
 * Franja util del dia para publicar, en horas.
 *
 * Se conservan como valores por defecto para quien los importe suelto, pero la
 * franja real vive en los ajustes de flujo y puede cambiarse desde el panel.
 */
export const DAY_START_HOUR = 10
export const DAY_END_HOUR = 23

/**
 * Crea las cuentas iniciales con franjas repartidas a lo largo del dia.
 *
 * El reparto es en dos ejes. Cada cuenta divide la franja util en bandas
 * iguales y coloca una publicacion en cada banda, asi que su propia actividad
 * se reparte por el dia. Y cada cuenta entra en su banda con un desfase propio,
 * proporcional a su indice, para que dos cuentas no compartan hora ancla.
 *
 * La primera version usaba una hora base fija por banda y solo variaba los
 * minutos. El resultado eran tres bloques de una hora con las 20 cuentas
 * dentro y el resto del dia vacio: ni una publicacion entre las 12:00 y las
 * 13:20. Un patron asi es tan detectable como publicar todas a la vez.
 */
/**
 * Recalcula las franjas de las cuentas existentes sin recrearlas.
 *
 * NO se usa seedAccounts para esto a proposito. Regenerar produciria cuentas
 * nuevas con `tokenStatus: 'unknown'`, y en cuanto haya 20 cuentas de TikTok
 * enlazadas por OAuth eso significaria perder el vinculo de todas por haber
 * movido una hora en el panel. Aqui se conserva la identidad de cada cuenta y
 * solo cambian los horarios.
 *
 * Si sobran cuentas se pausan en lugar de borrarse: una cuenta pausada conserva
 * su historial y puede volver, una borrada no.
 */
export function reslotAccounts(
  count: number,
  slotsPerDay: number,
  startHour: number,
  endHour: number,
): { kept: number; added: number; deactivated: number } {
  const { rows, ...resumen } = recalcularFranjas(
    count,
    slotsPerDay,
    startHour,
    endHour,
    accounts.all(),
  )
  accounts.save(rows)
  return resumen
}

/**
 * El mismo calculo, sin tocar ningun almacen.
 *
 * Se separa porque hay dos sitios que lo necesitan y guardan en lugares
 * distintos: los scripts locales sobre el fichero JSON y el panel sobre
 * Postgres. Dejar la escritura dentro obligaria a duplicar el reparto de
 * franjas, que es la parte que tiene logica de verdad.
 */
/**
 * Reparte las horas del dia entre las cuentas SIN tocar su estado.
 *
 * recalcularFranjas hace dos cosas a la vez: reparte franjas y decide cuantas
 * cuentas estan activas, forzando a 'active' todas las que entren en el cupo.
 * Eso vale para "quiero N cuentas" y es un desastre para todo lo demas:
 *
 *   - Guardar un cambio de horario en el panel reactivaba en silencio cada
 *     cuenta pausada. El 2026-10-09 se pausaron dieciocho para probar
 *     upload-post con dos, y volvieron solas.
 *   - Crear una cuenta nueva hacia lo mismo con las dieciocho anteriores.
 *
 * Quien pausa una cuenta esta diciendo "esta no publica". Mover una hora no es
 * motivo para desdecirlo.
 */
export function repartirFranjas(
  slotsPerDay: number,
  startHour: number,
  endHour: number,
  existing: Account[],
): { rows: Account[]; kept: number } {
  const total = Math.max(existing.length, 1)
  const band = (endHour - startHour) / slotsPerDay

  const rows = existing.map((cuenta, i) => ({
    ...cuenta,
    slots: Array.from({ length: slotsPerDay }, (_, s) =>
      Number((startHour + s * band + (i / total) * band).toFixed(3)),
    ),
  }))

  return { rows, kept: rows.length }
}

export function recalcularFranjas(
  count: number,
  slotsPerDay: number,
  startHour: number,
  endHour: number,
  existing: Account[],
): { rows: Account[]; kept: number; added: number; deactivated: number } {
  const band = (endHour - startHour) / slotsPerDay
  const slotsFor = (index: number): number[] => {
    const phase = (index / count) * band
    return Array.from({ length: slotsPerDay }, (_, s) =>
      Number((startHour + s * band + phase).toFixed(3)),
    )
  }

  const rows: Account[] = []
  let added = 0
  let deactivated = 0

  for (let i = 0; i < Math.max(count, existing.length); i += 1) {
    const prev = existing[i]

    if (i >= count) {
      if (prev !== undefined) {
        rows.push({ ...prev, status: 'paused' })
        deactivated += 1
      }
      continue
    }

    if (prev === undefined) {
      rows.push({
        id: `acc-${String(i + 1).padStart(2, '0')}`,
        label: `Cuenta ${i + 1}`,
        status: 'active',
        slots: slotsFor(i),
        tokenStatus: 'unknown',
        lastPublishedAt: null,
      })
      added += 1
      continue
    }

    rows.push({ ...prev, status: 'active', slots: slotsFor(i) })
  }

  return { rows, kept: rows.length - added - deactivated, added, deactivated }
}

export function seedAccounts(
  count: number,
  slotsPerDay: number,
  startHour: number = DAY_START_HOUR,
  endHour: number = DAY_END_HOUR,
): Account[] {
  const rows: Account[] = []
  const band = (endHour - startHour) / slotsPerDay

  for (let i = 0; i < count; i += 1) {
    const phase = (i / count) * band

    const slots = Array.from({ length: slotsPerDay }, (_, s) => startHour + s * band + phase)

    rows.push({
      id: `acc-${String(i + 1).padStart(2, '0')}`,
      label: `Cuenta ${i + 1}`,
      status: 'active',
      slots: slots.map((h) => Number(h.toFixed(3))),
      tokenStatus: 'unknown',
      lastPublishedAt: null,
    })
  }

  return rows
}
