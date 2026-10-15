import { createLogger } from '../../lib/logger.js'
import type { Tokens } from '../../publish/tiktok/tokens.js'
import type { MetricsProvider, PostMetrics } from '../types.js'

const log = createLogger('metricas-tiktok')

const API = 'https://open.tiktokapis.com/v2'

/**
 * Lecturas de TikTok por su API directa.
 *
 * EL IDENTIFICADOR QUE GUARDAMOS NO ES EL DEL VIDEO. Al publicar, TikTok
 * devuelve un `publish_id` (`v_pub_file~v2...`), que identifica el ENVIO, no la
 * publicacion resultante. La API de estadisticas no lo conoce.
 *
 * El puente es `/post/publish/status/fetch/`: cuando el envio termina, devuelve
 * `publicaly_available_post_id` con el id real del video. Eso es lo que se usa
 * aqui para pedir las cifras.
 *
 * Consecuencia: un video que no se publico (los que quedan en la bandeja del
 * usuario esperando) NO tiene estadisticas, y no es un fallo. Mientras nadie lo
 * publique desde el movil no existe como publicacion.
 */
export class TikTokMetricsProvider implements MetricsProvider {
  readonly name = 'tiktok'

  /**
   * A que cuenta pertenece cada publish_id.
   *
   * Hace falta porque cada cuenta tiene su propio token: no hay una credencial
   * global con la que consultar las ocho. Quien llama lo sabe (lo tiene en la
   * tabla de publicaciones) y lo pasa hecho.
   */
  constructor(
    private readonly tokens: Tokens,
    private readonly cuentaDe: (externalId: string) => string | undefined,
  ) {}

  async fetch(externalIds: string[]): Promise<PostMetrics[]> {
    /*
     * Agrupado por cuenta y no de uno en uno.
     *
     * `/video/query/` admite hasta veinte ids por peticion, pero todos tienen
     * que ser de la misma cuenta porque la credencial va en la cabecera. Con
     * ocho cuentas y cien publicaciones, esto son ocho peticiones en vez de
     * cien.
     */
    const porCuenta = new Map<string, string[]>()
    for (const id of externalIds) {
      const cuenta = this.cuentaDe(id)
      if (cuenta === undefined) continue
      const lista = porCuenta.get(cuenta) ?? []
      lista.push(id)
      porCuenta.set(cuenta, lista)
    }

    const salida: PostMetrics[] = []

    for (const [accountId, ids] of porCuenta) {
      let token: string
      try {
        token = await this.tokens.vigente(accountId)
      } catch (error) {
        // Una cuenta sin permiso no tumba la recoleccion de las demas.
        log.warn(`${accountId}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      // publish_id -> id del video, resolviendo uno a uno porque el estado se
      // consulta por envio.
      const videoDe = new Map<string, string>()
      for (const publishId of ids) {
        const real = await this.idPublicado(token, publishId)
        if (real !== null) videoDe.set(real, publishId)
      }
      if (videoDe.size === 0) continue

      for (const lote of trocear([...videoDe.keys()], 20)) {
        const cifras = await this.cifras(token, lote)
        for (const [videoId, m] of cifras) {
          const publishId = videoDe.get(videoId)
          if (publishId !== undefined) salida.push({ ...m, externalId: publishId })
        }
      }
    }

    return salida
  }

  /** El id del video ya publicado, o null si todavia no lo esta. */
  private async idPublicado(token: string, publishId: string): Promise<string | null> {
    try {
      const res = await fetch(`${API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: publishId }),
      })
      const cuerpo = (await res.json()) as {
        data?: { status?: string; publicaly_available_post_id?: (string | number)[] }
      }
      // El campo viene mal escrito en la API de TikTok ("publicaly"). Se respeta
      // tal cual: corregirlo aqui seria no encontrarlo nunca.
      const ids = cuerpo.data?.publicaly_available_post_id
      const primero = ids?.[0]
      return primero === undefined ? null : String(primero)
    } catch (error) {
      log.warn(`estado de ${publishId}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /** Las cifras de un lote de videos de la misma cuenta. */
  private async cifras(token: string, videoIds: string[]): Promise<Map<string, PostMetrics>> {
    const out = new Map<string, PostMetrics>()
    try {
      const campos = 'id,like_count,comment_count,share_count,view_count'
      const res = await fetch(`${API}/video/query/?fields=${campos}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ filters: { video_ids: videoIds } }),
      })
      const cuerpo = (await res.json()) as {
        data?: {
          videos?: {
            id?: string
            like_count?: number
            comment_count?: number
            share_count?: number
            view_count?: number
          }[]
        }
        error?: { code?: string; message?: string }
      }

      const code = cuerpo.error?.code ?? 'ok'
      if (code !== 'ok' && code !== 'ok_but_empty') {
        /*
         * El fallo mas probable aqui es de permisos, y conviene decirlo entero.
         *
         * Leer estadisticas exige el scope `video.list`. Las cuentas enlazadas
         * antes de añadirlo tienen un permiso que no lo incluye, y hay que
         * volver a autorizarlas: el token no se amplia solo.
         */
        log.warn(`video/query: ${code} ${cuerpo.error?.message ?? ''}`)
        return out
      }

      for (const v of cuerpo.data?.videos ?? []) {
        if (v.id === undefined) continue
        out.set(String(v.id), {
          externalId: String(v.id),
          views: v.view_count ?? 0,
          likes: v.like_count ?? 0,
          comments: v.comment_count ?? 0,
          shares: v.share_count ?? 0,
          // TikTok no expone duracion media de visionado en esta API. Null y no
          // cero: cero significaria "nadie lo vio", que es otra cosa.
          averageWatchSec: null,
        })
      }
    } catch (error) {
      log.warn(`video/query: ${error instanceof Error ? error.message : String(error)}`)
    }
    return out
  }
}

function trocear<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
