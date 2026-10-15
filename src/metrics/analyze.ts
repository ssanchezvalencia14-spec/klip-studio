import {
  accounts,
  clips,
  metrics,
  posts,
  queue,
  type Account,
  type MetricSnapshot,
  type Post,
} from '../store/store.js'
import { EARLY_SIGNAL_HOURS } from './types.js'

/** Mediana. Se usa en lugar de la media porque las vistas son de cola pesada:
 *  un solo clip viral desplaza la media y esconde el comportamiento tipico. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0)
}

/** Rangos con empates promediados, necesarios para Spearman. */
function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }))
  indexed.sort((a, b) => a.value - b.value)

  const result = new Array<number>(values.length)
  let i = 0
  while (i < indexed.length) {
    let j = i
    while (j + 1 < indexed.length && indexed[j + 1]?.value === indexed[i]?.value) j += 1
    const averageRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k += 1) {
      const entry = indexed[k]
      if (entry !== undefined) result[entry.index] = averageRank
    }
    i = j + 1
  }
  return result
}

/**
 * Correlacion de rangos de Spearman.
 *
 * Se usa Spearman y no Pearson a proposito: la relacion entre la puntuacion del
 * modelo y las vistas no tiene por que ser lineal, y las vistas son de cola
 * pesada. Spearman solo compara ordenaciones, que es exactamente la pregunta:
 * ¿los clips que el modelo puntuo mas alto rinden mas?
 */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null

  const ra = ranks(a)
  const rb = ranks(b)
  const n = a.length
  const mean = (n + 1) / 2

  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i += 1) {
    const x = (ra[i] ?? 0) - mean
    const y = (rb[i] ?? 0) - mean
    num += x * y
    da += x * x
    db += y * y
  }

  if (da === 0 || db === 0) return null
  return num / Math.sqrt(da * db)
}

/** Ultima lectura de una publicacion, y la temprana si existe. */
function readingsFor(post: Post, all: MetricSnapshot[]): { latest?: MetricSnapshot; early?: MetricSnapshot } {
  const own = all.filter((m) => m.postId === post.id).sort((a, b) => a.ageHours - b.ageHours)
  const early = own.find((m) => m.ageHours >= EARLY_SIGNAL_HOURS)
  return {
    ...(own.length > 0 ? { latest: own[own.length - 1] } : {}),
    ...(early === undefined ? {} : { early }),
  }
}

export interface ClipPerformance {
  clipId: string
  sourceId: string
  score: number
  publications: number
  medianViews: number
  medianEarlyViews: number
  medianLikes: number
}

export interface AccountPerformance {
  accountId: string
  status: Account['status']
  publications: number
  medianViews: number
  /** Publicaciones seguidas, de la mas reciente hacia atras, con vistas nulas. */
  zeroReachStreak: number
}

export interface HourPerformance {
  hour: number
  publications: number
  medianViews: number
}

export interface Alert {
  level: 'error' | 'warn'
  subject: string
  message: string
}

export interface Analysis {
  totalPosts: number
  measuredPosts: number
  byClip: ClipPerformance[]
  byAccount: AccountPerformance[]
  byHour: HourPerformance[]
  correlation: { value: number | null; n: number; reliable: boolean }
  alerts: Alert[]
}

/**
 * Numero minimo de clips para que la correlacion signifique algo.
 *
 * Con menos, el coeficiente sale igualmente pero es ruido: tres o cuatro puntos
 * producen correlaciones altisimas por azar. Reportarlo sin esta marca seria
 * dar por buena una conclusion que los datos no sostienen.
 */
const MIN_CLIPS_FOR_CORRELATION = 12

/** Vistas por debajo de las cuales se considera que la cuenta no llego a nadie. */
const ZERO_REACH_THRESHOLD = 5

/** Publicaciones seguidas sin alcance antes de avisar. */
const ZERO_REACH_ALERT = 3

/**
 * Los datos sobre los que se analiza.
 *
 * Se pasan desde fuera porque viven en Postgres desde la Fase 4. Antes se leian
 * aqui dentro del almacen de ficheros, que lleva sin escribirse desde el
 * 2026-09-13: el informe de consola decia "Publicaciones: 6" con doscientas
 * veintitres en la base, y nadie podia saber si era un fallo o es que de verdad
 * no habia nada medido.
 */
export interface DatosAnalisis {
  posts: Post[]
  metrics: MetricSnapshot[]
  clips: { sourceId: string; clipId: string; score: number; status: string }[]
  accounts: Account[]
  /** Cuantos envios quedan por salir. Solo se usa para avisar si no queda nada. */
  pendientes: number
}

/**
 * Sin datos se cae al almacen de ficheros.
 *
 * Es lo que necesitan las verificaciones, que montan un directorio de pruebas y
 * esperan leer de ahi. En produccion SIEMPRE se le pasan los de Postgres.
 */
export function analyze(datos?: DatosAnalisis): Analysis {
  const allPosts = datos?.posts ?? posts.all()
  const allMetrics = datos?.metrics ?? metrics.all()
  const allClips = datos?.clips ?? clips.all()
  const allAccounts = datos?.accounts ?? accounts.all()

  const alerts: Alert[] = []

  // --- Por clip ---------------------------------------------------------------
  const clipGroups = new Map<string, { views: number[]; early: number[]; likes: number[] }>()

  for (const post of allPosts) {
    const { latest, early } = readingsFor(post, allMetrics)
    if (latest === undefined) continue
    const key = `${post.sourceId}::${post.clipId}`
    const group = clipGroups.get(key) ?? { views: [], early: [], likes: [] }
    group.views.push(latest.views)
    group.likes.push(latest.likes)
    if (early !== undefined) group.early.push(early.views)
    clipGroups.set(key, group)
  }

  const byClip: ClipPerformance[] = []
  for (const [key, group] of clipGroups) {
    const [sourceId = '', clipId = ''] = key.split('::')
    const record = allClips.find((c) => c.sourceId === sourceId && c.clipId === clipId)
    byClip.push({
      clipId,
      sourceId,
      score: record?.score ?? 0,
      publications: group.views.length,
      medianViews: Math.round(median(group.views)),
      medianEarlyViews: Math.round(median(group.early)),
      medianLikes: Math.round(median(group.likes)),
    })
  }
  byClip.sort((a, b) => b.medianViews - a.medianViews)

  // --- Correlacion puntuacion vs rendimiento ----------------------------------
  //
  // Esta es la pregunta que decide si la seleccion automatica sirve. Si el
  // modelo puntua alto lo que luego no rinde, la Fase 2 no aporta nada.
  const scored = byClip.filter((c) => c.score > 0)
  const correlation = {
    value: spearman(
      scored.map((c) => c.score),
      scored.map((c) => c.medianViews),
    ),
    n: scored.length,
    reliable: scored.length >= MIN_CLIPS_FOR_CORRELATION,
  }

  // --- Por cuenta -------------------------------------------------------------
  const byAccount: AccountPerformance[] = []

  for (const account of allAccounts) {
    const own = allPosts
      .filter((p) => p.accountId === account.id)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

    const views: number[] = []
    let streak = 0
    let streakBroken = false

    for (const post of own) {
      const { latest } = readingsFor(post, allMetrics)
      if (latest === undefined) continue
      views.push(latest.views)
      if (!streakBroken) {
        if (latest.views < ZERO_REACH_THRESHOLD) streak += 1
        else streakBroken = true
      }
    }

    byAccount.push({
      accountId: account.id,
      status: account.status,
      publications: views.length,
      medianViews: Math.round(median(views)),
      zeroReachStreak: streak,
    })

    if (streak >= ZERO_REACH_ALERT) {
      alerts.push({
        level: 'error',
        subject: account.id,
        message:
          `${streak} publicaciones seguidas por debajo de ${ZERO_REACH_THRESHOLD} vistas. ` +
          'Sacala de rotacion: seguir alimentandola gasta clips sin llegar a nadie.',
      })
    }
  }
  byAccount.sort((a, b) => b.medianViews - a.medianViews)

  // --- Por franja horaria -----------------------------------------------------
  const hourGroups = new Map<number, number[]>()
  for (const post of allPosts) {
    const { latest } = readingsFor(post, allMetrics)
    if (latest === undefined) continue
    const hour = new Date(post.publishedAt).getHours()
    hourGroups.set(hour, [...(hourGroups.get(hour) ?? []), latest.views])
  }

  const byHour: HourPerformance[] = [...hourGroups.entries()]
    .map(([hour, views]) => ({
      hour,
      publications: views.length,
      medianViews: Math.round(median(views)),
    }))
    .sort((a, b) => a.hour - b.hour)

  // --- Alertas de estado ------------------------------------------------------
  for (const account of allAccounts) {
    if (account.status === 'error' || account.tokenStatus === 'expired') {
      alerts.push({
        level: 'error',
        subject: account.id,
        message: `Fuera de rotacion (estado ${account.status}, token ${account.tokenStatus}).`,
      })
    }
  }

  const pending = datos?.pendientes ?? queue.all().filter((i) => i.status === 'pending').length
  if (pending === 0) {
    alerts.push({
      level: 'warn',
      subject: 'cola',
      message: 'No queda nada pendiente de publicar. Procesa un VOD nuevo.',
    })
  }

  const measured = allPosts.filter((p) => readingsFor(p, allMetrics).latest !== undefined).length
  if (allPosts.length > 0 && measured < allPosts.length) {
    alerts.push({
      level: 'warn',
      subject: 'metricas',
      message: `${allPosts.length - measured} publicacion(es) sin ninguna lectura de metricas.`,
    })
  }

  return {
    totalPosts: allPosts.length,
    measuredPosts: measured,
    byClip,
    byAccount,
    byHour,
    correlation,
    alerts,
  }
}
