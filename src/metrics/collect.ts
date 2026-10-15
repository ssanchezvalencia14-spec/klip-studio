import { randomUUID } from 'node:crypto'
import { createLogger } from '../lib/logger.js'
import { metrics, posts, type MetricSnapshot, type Post } from '../store/store.js'

/**
 * De donde salen las publicaciones y donde van las lecturas.
 *
 * Se inyecta por el mismo motivo que en el worker: el panel lee Postgres y los
 * ficheros de state/ solo existen en este ordenador. Un recolector que escriba
 * en ficheros deja la seccion Resultados vacia para siempre.
 *
 * La implementacion de ficheros sigue siendo la de por defecto para que las
 * pruebas no necesiten base de datos.
 */
export interface EstadoMetricas {
  publicaciones: () => Promise<Post[]>
  lecturasDe: (postId: string) => Promise<MetricSnapshot[]>
  guardar: (filas: MetricSnapshot[]) => Promise<void>
}

export const metricasEnFicheros: EstadoMetricas = {
  publicaciones: async () => posts.all(),
  lecturasDe: async (postId) => metrics.forPost(postId),
  guardar: async (filas) => {
    metrics.add(filas)
  },
}
import { CAPTURE_AGES_HOURS, type MetricsProvider } from './types.js'

const log = createLogger('metricas')

function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000
}

/**
 * Publicaciones a las que toca tomarles una lectura.
 *
 * Se captura como mucho una vez por cada corte de edad. Sin esta comprobacion,
 * ejecutar el recolector cada hora generaria veinticuatro lecturas diarias por
 * publicacion, que no aportan nada y multiplican las peticiones al proveedor.
 */
export async function postsDueForCapture(
  now: Date,
  estado: EstadoMetricas = metricasEnFicheros,
): Promise<{ post: Post; targetAge: number }[]> {
  const due: { post: Post; targetAge: number }[] = []

  for (const post of await estado.publicaciones()) {
    if (post.externalId === '') continue

    const age = hoursSince(post.publishedAt, now)
    const passed = CAPTURE_AGES_HOURS.filter((h) => h <= age)
    const targetAge = passed[passed.length - 1]
    if (targetAge === undefined) continue

    const already = (await estado.lecturasDe(post.id)).some((m) => m.ageHours >= targetAge)
    if (!already) due.push({ post, targetAge })
  }

  return due
}

export interface CollectReport {
  candidates: number
  captured: number
  missing: number
}

/** Toma una lectura de las publicaciones que lo necesiten y la guarda. */
export async function collectMetrics(
  provider: MetricsProvider,
  now = new Date(),
  persist = true,
  estado: EstadoMetricas = metricasEnFicheros,
): Promise<CollectReport> {
  const due = await postsDueForCapture(now, estado)

  if (due.length === 0) {
    log.info('Ninguna publicacion necesita lectura ahora mismo.')
    return { candidates: 0, captured: 0, missing: 0 }
  }

  log.info(`${due.length} publicacion(es) pendientes de lectura | proveedor=${provider.name}`)

  const fetched = await provider.fetch(due.map((d) => d.post.externalId))
  const byExternalId = new Map(fetched.map((m) => [m.externalId, m]))

  const snapshots: MetricSnapshot[] = []
  let missing = 0

  for (const { post, targetAge } of due) {
    const reading = byExternalId.get(post.externalId)
    if (reading === undefined) {
      missing += 1
      continue
    }

    snapshots.push({
      id: randomUUID(),
      postId: post.id,
      externalId: post.externalId,
      accountId: post.accountId,
      clipId: post.clipId,
      capturedAt: now.toISOString(),
      // Se guarda el corte objetivo y no la edad exacta, para que las lecturas
      // de publicaciones distintas sean comparables entre si.
      ageHours: targetAge,
      views: reading.views,
      likes: reading.likes,
      comments: reading.comments,
      shares: reading.shares,
      averageWatchSec: reading.averageWatchSec,
    })
  }

  if (persist) await estado.guardar(snapshots)

  return { candidates: due.length, captured: snapshots.length, missing }
}
