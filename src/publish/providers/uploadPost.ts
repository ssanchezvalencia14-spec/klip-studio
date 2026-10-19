import { openAsBlob, statSync } from 'node:fs'
import { basename } from 'node:path'
import { createLogger } from '../../lib/logger.js'
import type { PublishProvider, PublishRequest, PublishResult } from '../types.js'
import { construirTexto } from '../texto.js'

const log = createLogger('upload-post')

/**
 * Proveedor de publicacion sobre upload-post.
 *
 * Se elige este por precio y capacidad, verificados en su documentacion:
 * el plan Professional cuesta 50 USD al mes, admite 25 perfiles y no limita el
 * numero de subidas. Con 20 cuentas quedan 5 de margen. Las alternativas
 * comparadas eran bundle.social (100 USD, cuentas ilimitadas) y Ayrshare
 * (149 USD, 14 cuentas por perfil, que no cubre el caso).
 *
 * Importante: este modulo es reemplazable. Cuando la app propia de TikTok pase
 * la auditoria, se escribe otro PublishProvider y no se toca nada mas.
 */
export class UploadPostProvider implements PublishProvider {
  readonly name = 'upload-post'

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.upload-post.com/api',
  ) {}

  async publish(request: PublishRequest): Promise<PublishResult> {
    const { videoPath, accountId, caption, hashtags, mode } = request

    let sizeBytes: number
    try {
      sizeBytes = statSync(videoPath).size
    } catch {
      return { ok: false, kind: 'media', message: `No se puede leer ${videoPath}` }
    }

    // Se comprueba antes de subir: un archivo rechazado por tamaño cuesta la
    // subida entera para nada.
    if (sizeBytes > 1024 * 1024 * 1024) {
      return {
        ok: false,
        kind: 'media',
        message: `${(sizeBytes / 1024 / 1024).toFixed(0)} MB supera el maximo de 1 GB`,
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

    const form = new FormData()
    form.append('user', accountId)
    form.append('platform[]', 'tiktok')
    form.append('title', title)
    // MEDIA_UPLOAD deja el video en borradores; DIRECT_POST publica en el perfil.
    form.append('post_mode', mode === 'draft' ? 'MEDIA_UPLOAD' : 'DIRECT_POST')

    /*
     * En directo hay que decir quien lo puede ver. En borrador no.
     *
     * Faltaba, y es obligatorio para DIRECT_POST: sin este campo TikTok no sabe
     * con que visibilidad publicar. En borrador no se manda porque la elige el
     * titular al abrir la notificacion, y mandarlo seria prometer algo que
     * decide otra persona.
     *
     * PUBLIC_TO_EVERYONE es el objetivo de todo esto. Que la cuenta lo permita
     * se consulta en /uploadposts/tiktok/settings, pero OJO: que aparezca ahi
     * no garantiza que la publicacion directa funcione. Con la app propia de
     * TikTok, @zotitan1 devolvia PUBLIC_TO_EVERYONE el 2026-09-26 y la
     * publicacion directa se rechazaba igualmente por no haber pasado la
     * auditoria. Lo unico que lo demuestra es intentarlo.
     */
    if (mode !== 'draft') form.append('privacy_level', request.privacidad ?? 'PUBLIC_TO_EVERYONE')

    // openAsBlob y no createReadStream. FormData espera un Blob: si se le pasa
    // un stream de Node, TypeScript no protesta y en ejecucion lo convierte a
    // la cadena "[object Object]", asi que la peticion sale sin video y el
    // proveedor devuelve un error que no apunta a la causa real.
    // openAsBlob ademas no carga el archivo entero en memoria.
    let blob: Blob
    try {
      blob = await openAsBlob(videoPath, { type: 'video/mp4' })
    } catch (error) {
      return {
        ok: false,
        kind: 'media',
        message: `No se pudo abrir ${videoPath}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    form.append('video', blob, basename(videoPath))

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        /*
         * "Apikey" con k minuscula, tal y como lo escribe su especificacion.
         *
         * Aqui ponia "ApiKey". El esquema de autenticacion de HTTP es
         * insensible a mayusculas segun la norma, asi que lo mas probable es
         * que diera igual, pero esto nunca se habia ejecutado contra el
         * servicio de verdad: las 222 publicaciones de la base salieron todas
         * por la API propia de TikTok. Se escribe como lo documentan para no
         * estrenar el camino depurando un 401.
         */
        headers: { Authorization: `Apikey ${this.apiKey}` },
        body: form,
      })
    } catch (error) {
      return {
        ok: false,
        kind: 'transient',
        message: `Fallo de red: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const bodyText = await response.text()

    if (response.ok) return leerResultado(bodyText, mode)

    return classifyFailure(response, bodyText)
  }
}

/**
 * Lee el resultado real de una respuesta 200.
 *
 * UN 200 NO SIGNIFICA QUE SE HAYA ENTREGADO. upload-post responde 200 con
 * `success: true` en el nivel de arriba y mete el resultado de verdad en
 * `results.<plataforma>`. El 2026-10-09, la primera prueba contra acc-02
 * devolvio 200 con esto dentro:
 *
 *   "results": { "tiktok": { "success": false, "status": "failed",
 *                "error": "Spam_risk_too_many_pending_share..." } }
 *
 * La version anterior miraba solo el codigo HTTP y habria dado esa entrega por
 * buena: el clip se marcaria como publicado, saldria de la cola y nadie volveria
 * a intentarlo. Es el mismo fallo que ya costo caro con la API de TikTok, donde
 * el worker cantaba "subido" en cuanto terminaban de viajar los bytes.
 */
function leerResultado(bodyText: string, mode: PublishRequest['mode']): PublishResult {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    // Sin cuerpo legible no se puede afirmar que llegara. Se trata como fallo
    // pasajero para que se reintente, en vez de darlo por bueno a ciegas.
    log.warn('Respuesta 200 no parseable como JSON.')
    return { ok: false, kind: 'transient', message: `Respuesta ilegible: ${bodyText.slice(0, 200)}` }
  }

  /*
   * El identificador es `request_id`, no `id` ni `post_id`.
   *
   * Esos dos no existen en su respuesta; se buscaban a ciegas y por eso el
   * campo salia vacio. El identificador de TikTok (`platform_post_id`) no esta
   * disponible todavia: la subida es asincrona y solo aparece despues, en
   * /uploadposts/history. Guardar `request_id` es lo que permite encontrarla
   * alli mas tarde.
   */
  const externalId = String(parsed['request_id'] ?? parsed['job_id'] ?? '')

  const results = parsed['results']
  const porPlataforma =
    typeof results === 'object' && results !== null
      ? ((results as Record<string, unknown>)['tiktok'] as Record<string, unknown> | undefined)
      : undefined

  // Sin bloque de la plataforma no se puede confirmar nada. Pasa, por ejemplo,
  // cuando la publicacion queda programada en vez de entregada.
  if (porPlataforma === undefined) {
    const estado = String(parsed['status'] ?? '')
    if (estado === 'failed') {
      return { ok: false, kind: 'transient', message: `Fallo sin detalle: ${bodyText.slice(0, 200)}` }
    }
    return { ok: true, externalId, mode }
  }

  if (porPlataforma['success'] === true) return { ok: true, externalId, mode }

  const error = String(porPlataforma['error'] ?? parsed['status'] ?? 'sin detalle')
  return clasificarMensaje(error)
}

/**
 * Clasifica un fallo que viene DENTRO de un 200, donde no hay codigo HTTP.
 *
 * Se compara contra el texto porque es lo unico que hay. Es fragil y se sabe:
 * por eso lo desconocido cae en `transient`, que reintenta, y no en
 * `permanent`, que quemaria la entrada de la cola para siempre.
 */
function clasificarMensaje(error: string): PublishResult {
  const e = error.toLowerCase()

  /*
   * La bandeja llena es el cuello de botella real, no un error.
   *
   * TikTok bloquea subidas nuevas cuando se acumulan borradores sin publicar.
   * Se arregla solo en cuanto alguien vacia la bandeja desde el movil, asi que
   * se espera y se reintenta en vez de darlo por perdido.
   */
  if (e.includes('spam_risk') || e.includes('too_many_pending')) {
    return {
      ok: false,
      kind: 'rate_limit',
      message: `Bandeja llena en TikTok: hay que publicar o descartar lo que espera. (${error.slice(0, 160)})`,
      retryAfterSec: 3600,
    }
  }

  if (e.includes('rate limit') || e.includes('too many requests')) {
    return { ok: false, kind: 'rate_limit', message: error.slice(0, 200), retryAfterSec: 600 }
  }

  if (e.includes('token') || e.includes('unauthor') || e.includes('reauth') || e.includes('permission')) {
    return { ok: false, kind: 'auth', message: `Hay que volver a conectar la cuenta: ${error.slice(0, 160)}` }
  }

  if (e.includes('duration') || e.includes('format') || e.includes('codec') || e.includes('size')) {
    return { ok: false, kind: 'media', message: `Video rechazado: ${error.slice(0, 160)}` }
  }

  return { ok: false, kind: 'transient', message: error.slice(0, 200) }
}

/**
 * Traduce una respuesta de error a la clasificacion que entiende el worker.
 *
 * Se clasifica por codigo HTTP y no por el texto del mensaje: los mensajes
 * cambian sin aviso y comparar cadenas produce logica que se rompe en
 * silencio meses despues.
 */
function classifyFailure(response: Response, body: string): PublishResult {
  const message = body.slice(0, 300)

  if (response.status === 429) {
    const header = response.headers.get('retry-after')
    const retryAfterSec = header === null ? 60 : Number(header)
    return {
      ok: false,
      kind: 'rate_limit',
      message: `Limite de peticiones: ${message}`,
      retryAfterSec: Number.isFinite(retryAfterSec) ? retryAfterSec : 60,
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'auth', message: `Credenciales o cuenta: ${message}` }
  }

  if (response.status === 413) {
    return { ok: false, kind: 'media', message: `Archivo rechazado por tamaño: ${message}` }
  }

  if (response.status >= 500) {
    return { ok: false, kind: 'transient', message: `Error del proveedor: ${message}` }
  }

  return { ok: false, kind: 'permanent', message: `HTTP ${response.status}: ${message}` }
}

/**
 * Proveedor de simulacion. No llama a ninguna API.
 *
 * Existe para que el modo en seco recorra el worker completo: la cadencia, los
 * reintentos, la salud de las cuentas y la escritura de estado. Un dry-run que
 * solo imprime lo que haria no prueba el worker, prueba un `console.log`.
 */
export class DryRunProvider implements PublishProvider {
  readonly name = 'simulacion'

  publish(request: PublishRequest): Promise<PublishResult> {
    log.info(
      `[SIMULADO] ${request.accountId} <- ${basename(request.videoPath)} ` +
        `(${request.mode}) "${request.caption.slice(0, 50)}"`,
    )
    return Promise.resolve({ ok: true, externalId: `dry-${Date.now()}`, mode: request.mode })
  }
}
