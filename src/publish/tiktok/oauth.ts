import { randomBytes } from 'node:crypto'
import { optionalEnv } from '../../lib/env.js'

/**
 * El flujo de autorizacion de TikTok.
 *
 * Tres piezas: construir el enlace al que mandar al usuario, canjear el codigo
 * que vuelve por un token, y renovarlo antes de que caduque.
 *
 * NUNCA VEMOS LA CONTRASEÑA. El usuario la escribe en tiktok.com, y lo que
 * vuelve aqui es un permiso que esa misma cuenta puede revocar cuando quiera
 * desde sus ajustes.
 *
 * Verificado contra la documentacion de TikTok (Login Kit v2 y OAuth user
 * access token management), no de memoria.
 */

const AUTORIZAR = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/'

/**
 * Permisos que se piden.
 *
 * `video.publish` es el que permite publicar visible; `video.upload` deja el
 * video en borradores. Se piden los dos para poder cambiar de modo sin volver
 * a pedir autorizacion a las veinte cuentas.
 *
 * `user.info.basic` hace falta para saber a que cuenta corresponde cada
 * permiso: sin el, el open_id es un identificador opaco y el panel no podria
 * enseñar de quien es cada token.
 */
export const SCOPES = ['user.info.basic', 'video.upload', 'video.publish'] as const

export class TikTokNoConfigurado extends Error {}

export interface Credenciales {
  clientKey: string
  clientSecret: string
  redirectUri: string
}

/**
 * Lee las credenciales de la app, o explica cual falta.
 *
 * Devuelve null en vez de lanzar cuando no hay nada configurado, para que el
 * panel y el trabajador arranquen igual sin ellas: sin app de TikTok, el
 * sistema se comporta como antes y lo dice cuando alguien intenta publicar.
 */
export function credenciales(): Credenciales | null {
  const clientKey = optionalEnv('TIKTOK_CLIENT_KEY')
  const clientSecret = optionalEnv('TIKTOK_CLIENT_SECRET')
  const redirectUri = optionalEnv('TIKTOK_REDIRECT_URI')
  if (clientKey === undefined || clientSecret === undefined || redirectUri === undefined) {
    return null
  }

  /*
   * TikTok rechaza cualquier redirect que no sea https, y lo hace en su
   * pantalla de autorizacion: el usuario ve un error suyo, no nuestro, sin
   * ninguna pista de que la culpa es de una variable de entorno. Se comprueba
   * aqui para que el fallo salga al arrancar y no delante de la cuenta.
   */
  if (!redirectUri.startsWith('https://')) {
    throw new TikTokNoConfigurado(
      `TIKTOK_REDIRECT_URI debe empezar por https:// (ahora es "${redirectUri}"). ` +
        'TikTok no admite http ni siquiera en pruebas.',
    )
  }

  return { clientKey, clientSecret, redirectUri }
}

/**
 * El enlace al que mandar a la cuenta para que autorice.
 *
 * El `state` viaja de ida y vuelta sin que TikTok lo toque, asi que es donde se
 * mete que cuenta nuestra se esta enlazando. Lleva ademas un valor aleatorio:
 * es lo que permite comprobar, cuando vuelve, que la respuesta corresponde a
 * una peticion que hicimos nosotros y no a un enlace que alguien fabrico.
 */
export function enlaceAutorizacion(
  cred: Credenciales,
  accountId: string,
): { url: string; state: string } {
  const state = `${accountId}.${randomBytes(16).toString('hex')}`
  const params = new URLSearchParams({
    client_key: cred.clientKey,
    response_type: 'code',
    scope: SCOPES.join(','),
    redirect_uri: cred.redirectUri,
    state,
  })
  return { url: `${AUTORIZAR}?${params.toString()}`, state }
}

/** Saca de un state la cuenta a la que pertenece. */
export function cuentaDelState(state: string): string {
  return state.split('.')[0] ?? ''
}

export interface Permiso {
  openId: string
  accessToken: string
  refreshToken: string
  /** Instantes absolutos, no duraciones: una duracion sin su origen no dice nada. */
  accessExpiresAt: Date
  refreshExpiresAt: Date
  scope: string
}

interface RespuestaToken {
  open_id?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
  refresh_expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

/**
 * Habla con el endpoint de token.
 *
 * TikTok responde 200 con un campo `error` dentro para los fallos de negocio,
 * asi que mirar solo el codigo HTTP daria por buena una respuesta sin token.
 */
async function pedirToken(cuerpo: URLSearchParams): Promise<Permiso> {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: cuerpo,
  })

  const texto = await res.text()
  let datos: RespuestaToken
  try {
    datos = JSON.parse(texto) as RespuestaToken
  } catch {
    throw new Error(`TikTok respondio algo que no es JSON (HTTP ${res.status}): ${texto.slice(0, 200)}`)
  }

  if (datos.error !== undefined && datos.error !== '') {
    throw new Error(`TikTok rechazo la peticion: ${datos.error} ${datos.error_description ?? ''}`.trim())
  }
  if (datos.access_token === undefined || datos.refresh_token === undefined) {
    throw new Error(`TikTok no devolvio token (HTTP ${res.status}): ${texto.slice(0, 200)}`)
  }

  const ahora = Date.now()
  return {
    openId: datos.open_id ?? '',
    accessToken: datos.access_token,
    refreshToken: datos.refresh_token,
    // Valores medidos en su documentacion: 24 h y 365 dias. Se usan los que
    // vengan en la respuesta y solo se cae a esos si faltan.
    accessExpiresAt: new Date(ahora + (datos.expires_in ?? 86400) * 1000),
    refreshExpiresAt: new Date(ahora + (datos.refresh_expires_in ?? 31536000) * 1000),
    scope: datos.scope ?? '',
  }
}

/** Canjea el codigo que vuelve del navegador por un permiso duradero. */
export async function canjearCodigo(cred: Credenciales, code: string): Promise<Permiso> {
  return pedirToken(
    new URLSearchParams({
      client_key: cred.clientKey,
      client_secret: cred.clientSecret,
      // El codigo llega percent-encoded en la direccion; decodificarlo es
      // obligatorio segun su documentacion.
      code: decodeURIComponent(code),
      grant_type: 'authorization_code',
      redirect_uri: cred.redirectUri,
    }),
  )
}

/**
 * Renueva un permiso a punto de caducar.
 *
 * OJO CON EL REFRESH TOKEN QUE VUELVE. TikTok puede devolver uno distinto del
 * que enviaste, y en ese caso el viejo deja de valer. Guardar siempre el que
 * vuelve es lo unico que impide que una cuenta se quede fuera dentro de un
 * ano sin que nadie sepa por que.
 */
export async function renovar(cred: Credenciales, refreshToken: string): Promise<Permiso> {
  return pedirToken(
    new URLSearchParams({
      client_key: cred.clientKey,
      client_secret: cred.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  )
}
