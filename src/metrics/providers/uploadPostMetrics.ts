import { createLogger } from '../../lib/logger.js'
import type { MetricsProvider, PostMetrics } from '../types.js'

const log = createLogger('metricas')

/**
 * Lector de metricas sobre upload-post.
 *
 * LA VERSION ANTERIOR PEDIA A UN ENDPOINT QUE NO EXISTE:
 * GET /uploadposts/post-analytics/{platform}_{post_id}. Se comprobo contra su
 * especificacion el 2026-10-09 y no esta; lo que hay es otra cosa. Como ademas
 * nunca se habia ejecutado (no habia ni una publicacion por upload-post), el
 * fallo vivia ahi sin que nada lo delatara: la seccion Resultados salia vacia y
 * se leia como que los videos no funcionaban.
 *
 * Dos pasos, porque los identificadores no coinciden:
 *
 *   1. Al publicar guardamos el request_id que devuelve la subida, porque es lo
 *      unico que hay en ese momento: la entrega es asincrona y el video todavia
 *      no existe en TikTok. Las metricas, en cambio, van por el identificador
 *      NATIVO de TikTok. /uploadposts/history trae los dos en la misma fila y
 *      es lo que permite cruzarlos.
 *   2. Las metricas se piden POR PERFIL, no por publicacion. Eso es una
 *      consulta por cuenta en lugar de una por video: recorriendo cientos de
 *      publicaciones al dia, la diferencia es el limite de peticiones.
 *
 * El origen es snapshot_cache: cifras de la ultima foto que hizo upload-post,
 * no del instante. Una publicacion recien hecha sale con
 * cached_posts_in_range igual a 0 hasta que entra en una foto. No es un error.
 */
export class UploadPostMetricsProvider implements MetricsProvider {
  readonly name = 'upload-post'

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.upload-post.com/api',
  ) {}

  private async pedir(ruta: string): Promise<Record<string, unknown> | null> {
    const r = await globalThis.fetch(this.baseUrl + ruta, {
      headers: { Authorization: 'Apikey ' + this.apiKey, accept: 'application/json' },
    })
    if (!r.ok) {
      log.warn(ruta + ': HTTP ' + r.status)
      return null
    }
    return (await r.json()) as Record<string, unknown>
  }

  /**
   * Cruza nuestros request_id con el identificador de TikTok y su perfil.
   *
   * Se recorre el historial por paginas y se corta en cuanto estan todos los
   * buscados: con el tiempo seran miles de filas y casi siempre interesan las
   * ultimas, que es justo por donde empieza.
   */
  private async resolver(
    buscados: Set<string>,
  ): Promise<Map<string, { postId: string; perfil: string }>> {
    const encontrados = new Map<string, { postId: string; perfil: string }>()

    for (let pagina = 1; pagina <= 20 && encontrados.size < buscados.size; pagina += 1) {
      const j = await this.pedir('/uploadposts/history?page=' + pagina + '&limit=100')
      const filas = (j?.['history'] ?? []) as Record<string, unknown>[]
      if (filas.length === 0) break

      for (const f of filas) {
        const req = String(f['request_id'] ?? '')
        const postId = f['platform_post_id']
        if (!buscados.has(req) || encontrados.has(req)) continue
        // Sin identificador nativo no hay metricas que pedir. Les pasa a los
        // borradores, que no llegan a ser una publicacion.
        if (typeof postId !== 'string' || postId === '') continue
        encontrados.set(req, { postId, perfil: String(f['profile_username'] ?? '') })
      }
    }

    return encontrados
  }

  /** Todas las metricas cacheadas de un perfil, por identificador de TikTok. */
  private async metricasDe(perfil: string): Promise<Map<string, Record<string, unknown>>> {
    const salida = new Map<string, Record<string, unknown>>()
    let cursor = ''

    for (let vuelta = 0; vuelta < 20; vuelta += 1) {
      const base =
        '/uploadposts/post-analytics/cached?user=' +
        encodeURIComponent(perfil) +
        '&platform=tiktok&limit=100'
      const j = await this.pedir(
        cursor === '' ? base : base + '&cursor=' + encodeURIComponent(cursor),
      )
      if (j === null) break

      for (const p of (j['posts'] ?? []) as Record<string, unknown>[]) {
        const id = String(p['post_id'] ?? '')
        const m = p['metrics']
        if (id !== '' && typeof m === 'object' && m !== null) {
          salida.set(id, m as Record<string, unknown>)
        }
      }

      if (j['has_more'] !== true) break
      const siguiente = j['next_cursor']
      if (typeof siguiente !== 'string' || siguiente === '') break
      cursor = siguiente
    }

    return salida
  }

  async fetch(externalIds: string[]): Promise<PostMetrics[]> {
    if (externalIds.length === 0) return []

    const mapa = await this.resolver(new Set(externalIds))
    if (mapa.size === 0) {
      log.info('Ninguna de las publicaciones tiene todavia identificador de TikTok.')
      return []
    }

    const perfiles = new Set([...mapa.values()].map((v) => v.perfil))
    const porPerfil = new Map<string, Map<string, Record<string, unknown>>>()
    for (const perfil of perfiles) porPerfil.set(perfil, await this.metricasDe(perfil))

    const salida: PostMetrics[] = []
    let sinFoto = 0

    for (const externalId of externalIds) {
      const ref = mapa.get(externalId)
      if (ref === undefined) continue
      const crudo = porPerfil.get(ref.perfil)?.get(ref.postId)
      if (crudo === undefined) {
        sinFoto += 1
        continue
      }
      const leido = leerMetricas(externalId, crudo)
      if (leido !== null) salida.push(leido)
    }

    if (sinFoto > 0) {
      log.info(sinFoto + ' publicacion(es) sin foto todavia; saldran en la proxima pasada.')
    }
    return salida
  }
}

/**
 * Saca un numero probando varios nombres de campo.
 *
 * Su especificacion dice que las claves de metrics varian por plataforma y no
 * documenta las de TikTok. El 2026-10-09 la cache estaba vacia y no se pudieron
 * observar, asi que se prueban los nombres plausibles. Van primero los de la
 * vista por perfil (/analytics/{perfil}), que ese dia si se pudieron ver: alli
 * las vistas se llaman impressions.
 */
function numero(m: Record<string, unknown>, nombres: readonly string[]): number | null {
  for (const n of nombres) {
    const v = m[n]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return null
}

const VISTAS = ['impressions', 'views', 'video_views', 'play_count', 'viewCount', 'plays'] as const
const ME_GUSTA = ['likes', 'like_count', 'likeCount', 'digg_count'] as const
const COMENTARIOS = ['comments', 'comment_count', 'commentCount'] as const
const COMPARTIDOS = ['shares', 'share_count', 'shareCount'] as const
const SEGUNDOS = [
  'average_watch_time',
  'average_time_watched',
  'avg_watch_time',
  'averageWatchSec',
] as const

/**
 * Convierte el bloque crudo en lo que entiende el analisis.
 *
 * Si no encuentra las vistas NO devuelve ceros: se queja con el JSON delante y
 * descarta la fila. Unos ceros silenciosos se leerian como un clip que no
 * funciono, que es la conclusion contraria a la verdadera y la que llevaria a
 * tirar material bueno.
 */
export function leerMetricas(externalId: string, m: Record<string, unknown>): PostMetrics | null {
  const views = numero(m, VISTAS)
  if (views === null) {
    log.error(
      'No encuentro las vistas en las metricas de ' +
        externalId +
        '. Campos recibidos: ' +
        JSON.stringify(m).slice(0, 300),
    )
    return null
  }

  return {
    externalId,
    views,
    likes: numero(m, ME_GUSTA) ?? 0,
    comments: numero(m, COMENTARIOS) ?? 0,
    shares: numero(m, COMPARTIDOS) ?? 0,
    averageWatchSec: numero(m, SEGUNDOS),
  }
}
