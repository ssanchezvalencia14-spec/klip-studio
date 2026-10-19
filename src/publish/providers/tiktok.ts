import { openAsBlob, statSync } from 'node:fs'
import { createLogger } from '../../lib/logger.js'
import type { PublishProvider, PublishRequest, PublishResult } from '../types.js'
import { construirTexto } from '../texto.js'
import type { Tokens } from '../tiktok/tokens.js'
import { PermisoCaducado, SinPermiso } from '../tiktok/tokens.js'

const log = createLogger('tiktok')

const API = 'https://open.tiktokapis.com/v2'

/**
 * Publicacion contra la API directa de TikTok.
 *
 * Sustituye a upload-post sin que nada mas cambie: el sistema entero habla con
 * PublishProvider, no con un proveedor concreto. La diferencia de fondo es de
 * quien es el permiso. Con upload-post, las cuentas viven en su panel y
 * nosotros mandamos un nombre de perfil. Aqui el permiso es nuestro, lo
 * guardamos nosotros y no hay cuota mensual.
 *
 * Todo lo que sigue esta verificado contra su documentacion, no de memoria:
 * los endpoints, los nombres de los campos, los codigos de error y los limites.
 */

/**
 * Como viaja el video.
 *
 * FILE_UPLOAD y no PULL_FROM_URL. PULL_FROM_URL exige verificar la propiedad
 * del dominio desde el que TikTok descarga ("url_ownership_unverified"), y los
 * masteres viven en el PC que renderiza, no en un dominio nuestro. Subir el
 * fichero desde aqui evita ese tramite entero.
 */
const UNA_SOLA_PIEZA = 1

/**
 * Traduce un codigo de error de TikTok a lo que el worker sabe hacer.
 *
 * Importa mas que el mensaje: de esto depende si la tarea se reintenta, si se
 * pausa la cuenta o si se descarta para siempre. Un fallo mal clasificado
 * significa reintentar eternamente algo que nunca va a funcionar, o tirar un
 * envio que solo necesitaba esperar un minuto.
 */
function clasificar(code: string, message: string): PublishResult {
  switch (code) {
    // El permiso de esta cuenta no sirve. Reintentar con el mismo token no
    // arregla nada: hace falta volver a autorizar.
    case 'access_token_invalid':
    case 'scope_not_authorized':
      return { ok: false, kind: 'auth', message: `${code}: ${message}` }

    case 'rate_limit_exceeded':
      return { ok: false, kind: 'rate_limit', message: `${code}: ${message}` }

    /*
     * Tope diario de subidas por cuenta, no un fallo.
     *
     * TikTok permite 5 subidas pendientes por cuenta en 24 h. Se trata como
     * limite de cadencia y no como error permanente porque el envio sigue
     * siendo valido: solo hay que intentarlo mas tarde.
     */
    /*
     * Las DOS grafias, singular y plural.
     *
     * El codigo solo contemplaba el plural, que es el que aparece en la
     * documentacion. Lo que devuelve la API el 2026-09-26 es el singular:
     * `spam_risk_too_many_pending_share`. Al no coincidir, el error caia en el
     * caso generico y se trataba como pasajero: cuatro reintentos con un
     * minuto de espera contra un tope que tarda horas en liberarse.
     *
     * Se dejan las dos porque no se cual de las dos es la buena, solo cual
     * llego.
     */
    case 'spam_risk_too_many_pending_share':
    case 'spam_risk_too_many_pending_shares':
      return {
        ok: false,
        kind: 'rate_limit',
        message:
          `${code}: la cuenta tiene demasiadas subidas sin publicar. ` +
          'Se libera cuando el titular publique o descarte borradores.',
        retryAfterSec: 3600,
      }

    /*
     * La app no ha pasado la auditoria de TikTok.
     *
     * Caia en el caso generico y se trataba como pasajero: cuatro reintentos
     * con espera creciente POR CADA ITEM. Con 110 publicaciones en cola eso son
     * mas de cuatrocientas llamadas que no pueden salir bien, porque lo que
     * falta es una aprobacion humana que tarda semanas.
     *
     * NO es `permanent` a proposito. Permanente marcaria el item como fallido y
     * lo consumiria; el envio es perfectamente valido y saldra en cuanto se
     * publique en modo borrador o pase la auditoria. Como limite de cadencia a
     * 24 h, la cola se conserva intacta y nadie pierde trabajo.
     */
    case 'unaudited_client_can_only_post_to_private_accounts':
      return {
        ok: false,
        kind: 'rate_limit',
        message:
          `${code}: TikTok no deja publicar en publico hasta aprobar la app. ` +
          'Usa el modo borrador (--mode draft o PUBLISH_MODE=draft): el video llega ' +
          'a la bandeja de entrada de la cuenta y el titular lo publica desde el movil.',
        retryAfterSec: 86400,
      }

    // La cuenta esta vetada. Reintentar solo acumula intentos fallidos.
    case 'spam_risk_user_banned_from_posting':
      return { ok: false, kind: 'permanent', message: `${code}: ${message}` }

    case 'url_ownership_unverified':
      return { ok: false, kind: 'permanent', message: `${code}: ${message}` }

    // El video o los parametros no cumplen. Volver a mandarlo igual dara lo
    // mismo; hay que mirar el archivo.
    case 'invalid_param':
      return { ok: false, kind: 'media', message: `${code}: ${message}` }

    case 'internal_error':
      return { ok: false, kind: 'transient', message: `${code}: ${message}` }

    default:
      return { ok: false, kind: 'transient', message: `${code}: ${message}` }
  }
}

interface RespuestaTikTok {
  data?: { publish_id?: string; upload_url?: string; [k: string]: unknown }
  error?: { code?: string; message?: string; log_id?: string }
}

export interface CreatorInfo {
  username: string
  nickname: string
  privacyLevels: string[]
  maxDurationSec: number
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
}

export class TikTokProvider implements PublishProvider {
  readonly name = 'tiktok'

  constructor(private readonly tokens: Tokens) {}

  /**
   * Quien es esta cuenta y que privacidad admite.
   *
   * NO DICE SI LA APP PASO LA AUDITORIA. Aqui ponia lo contrario, y es falso:
   * `privacy_level_options` describe a la CUENTA, no el permiso de la app.
   *
   * Medido el 2026-09-26 contra el sandbox con @zotitan1: esta consulta
   * devolvia PUBLIC_TO_EVERYONE entre las opciones, y aun asi el intento de
   * publicacion directa se rechazo con
   * `unaudited_client_can_only_post_to_private_accounts`.
   *
   * Lo unico que confirma la auditoria es intentar un `direct` y ver si pasa.
   */
  async creatorInfo(accountId: string): Promise<CreatorInfo> {
    const token = await this.tokens.vigente(accountId)
    const res = await fetch(`${API}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
      },
    })
    const cuerpo = (await res.json()) as RespuestaTikTok & {
      data?: {
        creator_username?: string
        creator_nickname?: string
        privacy_level_options?: string[]
        max_video_post_duration_sec?: number
        comment_disabled?: boolean
        duet_disabled?: boolean
        stitch_disabled?: boolean
      }
    }

    const code = cuerpo.error?.code ?? 'ok'
    if (code !== 'ok') {
      throw new Error(`${code}: ${cuerpo.error?.message ?? 'sin mensaje'}`)
    }

    const d = cuerpo.data ?? {}
    return {
      username: d.creator_username ?? '',
      nickname: d.creator_nickname ?? '',
      privacyLevels: d.privacy_level_options ?? [],
      maxDurationSec: d.max_video_post_duration_sec ?? 0,
      commentDisabled: d.comment_disabled ?? false,
      duetDisabled: d.duet_disabled ?? false,
      stitchDisabled: d.stitch_disabled ?? false,
    }
  }

  /**
   * Que fue de una subida, segun TikTok.
   *
   * `publish` devuelve en cuanto terminan de viajar los bytes, sin esperar al
   * procesado. Eso mantiene el worker en marcha, pero deja un hueco: si TikTok
   * rechaza el video despues, la cola dice "publicado" y nadie se entera.
   *
   * Esta consulta cierra ese hueco a posteriori. Estados que devuelve:
   *
   *   SEND_TO_USER_INBOX   listo, esperando a que el titular lo toque
   *   PUBLISH_COMPLETE     publicado (solo en modo directo)
   *   PROCESSING_*         aun trabajando
   *   FAILED               rechazado, con motivo en failReason
   */
  async estadoSubida(
    accountId: string,
    publishId: string,
  ): Promise<{ status: string; failReason: string }> {
    const token = await this.tokens.vigente(accountId)
    const res = await fetch(`${API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    })
    const cuerpo = (await res.json()) as RespuestaTikTok & {
      data?: { status?: string; fail_reason?: string }
    }

    const code = cuerpo.error?.code ?? 'ok'
    if (code !== 'ok') {
      throw new Error(`${code}: ${cuerpo.error?.message ?? 'sin mensaje'}`)
    }

    return {
      status: cuerpo.data?.status ?? '(sin estado)',
      failReason: cuerpo.data?.fail_reason ?? '',
    }
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const { videoPath, accountId, caption, hashtags, mode } = request

    let sizeBytes: number
    try {
      sizeBytes = statSync(videoPath).size
    } catch {
      return { ok: false, kind: 'media', message: `No se puede leer ${videoPath}` }
    }

    // Se comprueba antes de pedir nada: TikTok admite 4 GB, y un archivo por
    // encima gastaria la inicializacion para nada.
    if (sizeBytes > 4 * 1024 * 1024 * 1024) {
      return {
        ok: false,
        kind: 'media',
        message: `${(sizeBytes / 1024 / 1024).toFixed(0)} MB supera el maximo de 4 GB`,
      }
    }

    let token: string
    try {
      token = await this.tokens.vigente(accountId)
    } catch (error) {
      // Sin permiso o con el permiso caducado, el worker debe pausar la cuenta,
      // no reintentar: no hay nada que reintentar hasta que alguien autorice.
      if (error instanceof SinPermiso || error instanceof PermisoCaducado) {
        return { ok: false, kind: 'auth', message: error.message }
      }
      return {
        ok: false,
        kind: 'transient',
        message: error instanceof Error ? error.message : String(error),
      }
    }

    /*
     * El texto lo arma quien llama, con la plantilla de Ajustes.
     *
     * Aqui habia una copia de la misma linea que en el otro proveedor, asi que
     * la forma del texto vivia en dos sitios. Se deja el caso sin plantilla
     * para que una llamada suelta siga funcionando.
     */
    const title =
      request.texto ?? construirTexto({ caption, hashtags, plantilla: '{titulo} {hashtags}', fijos: '' })

    /*
     * `draft` y `direct` son dos endpoints distintos, no un parametro.
     *
     * El de borradores (`inbox`) no admite privacy_level: el video llega a la
     * bandeja del usuario y la privacidad la elige el al publicar desde la app.
     */
    const endpoint =
      mode === 'draft' ? '/post/publish/inbox/video/init/' : '/post/publish/video/init/'

    const cuerpo: Record<string, unknown> = {
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: sizeBytes,
        chunk_size: sizeBytes,
        total_chunk_count: UNA_SOLA_PIEZA,
      },
    }

    if (mode === 'direct') {
      cuerpo.post_info = {
        title,
        /*
         * PUBLIC_TO_EVERYONE es lo que se pide, pero NO es lo que se obtiene si
         * la app no paso la auditoria: TikTok fuerza SELF_ONLY y el video no lo
         * ve nadie. Por eso el comando `tiktok revisar` consulta las opciones
         * reales antes de que esto llegue a produccion.
         */
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_stitch: false,
        disable_comment: false,
      }
    }

    let init: RespuestaTikTok
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(cuerpo),
      })
      init = (await res.json()) as RespuestaTikTok

      if (res.status >= 500) {
        return { ok: false, kind: 'transient', message: `TikTok devolvio HTTP ${res.status}` }
      }
    } catch (error) {
      return {
        ok: false,
        kind: 'transient',
        message: `No se pudo iniciar la subida: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const code = init.error?.code ?? 'ok'
    if (code !== 'ok') {
      return clasificar(code, init.error?.message ?? 'sin mensaje')
    }

    const uploadUrl = init.data?.upload_url
    const publishId = init.data?.publish_id
    if (uploadUrl === undefined || publishId === undefined) {
      return { ok: false, kind: 'transient', message: 'TikTok no devolvio upload_url ni publish_id' }
    }

    /*
     * La subida en si.
     *
     * openAsBlob y no createReadStream: fetch espera un cuerpo que sepa medir.
     * Con un stream de Node, TypeScript no protesta y en ejecucion la peticion
     * sale vacia, asi que el fallo aparece como un rechazo de TikTok que no
     * apunta a la causa real. (Es la misma trampa que ya mordio en el proveedor
     * de upload-post.)
     *
     * Content-Range es obligatorio aunque se mande en una sola pieza.
     */
    try {
      const blob = await openAsBlob(videoPath)
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(sizeBytes),
          'content-range': `bytes 0-${sizeBytes - 1}/${sizeBytes}`,
        },
        body: blob,
      })

      if (!res.ok) {
        const detalle = (await res.text()).slice(0, 200)
        // El upload_url caduca una hora despues de emitirse. Si se agoto, hay
        // que rehacer la inicializacion, no reintentar esta URL.
        return {
          ok: false,
          kind: res.status >= 500 ? 'transient' : 'media',
          message: `La subida fallo con HTTP ${res.status}: ${detalle}`,
        }
      }
    } catch (error) {
      return {
        ok: false,
        kind: 'transient',
        message: `Se corto la subida: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    log.info(`${accountId}: subido, publish_id ${publishId}`)

    /*
     * Se devuelve en cuanto la subida termina, sin esperar a que TikTok
     * procese.
     *
     * El procesado tarda y bloquear aqui dejaria el worker parado por cada
     * video mientras el resto de la cola espera. El publish_id se guarda como
     * identificador externo, que es lo que la Fase 7 de metricas usa despues
     * para preguntar como fue.
     */
    return { ok: true, externalId: publishId, mode }
  }

  /** Como acabo una publicacion. Para comprobar despues, sin bloquear el envio. */
  async estado(accountId: string, publishId: string): Promise<{ status: string; error?: string }> {
    const token = await this.tokens.vigente(accountId)
    const res = await fetch(`${API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: publishId }),
    })
    const cuerpo = (await res.json()) as RespuestaTikTok & { data?: { status?: string } }
    const code = cuerpo.error?.code ?? 'ok'
    if (code !== 'ok') return { status: 'ERROR', error: `${code}: ${cuerpo.error?.message ?? ''}` }
    return { status: cuerpo.data?.status ?? 'DESCONOCIDO' }
  }
}
