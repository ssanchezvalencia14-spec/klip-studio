import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createLogger } from '../lib/logger.js'
import { MIN_CONTRASENA, SESION_DIAS, type Auth, type Rol, type Usuario, ErrorUsuarios } from '../auth/auth.js'
import { renderCambiarContrasena, renderLogin } from './login.js'

const log = createLogger('acceso')

/**
 * Quien hace cada peticion al panel.
 *
 * Cuatro formas de entrar, por orden:
 *
 * 1. SESION: la galleta `klip_sesion` tras entrar con correo y contraseña.
 *    Es la forma normal.
 * 2. SERVICIO: la cabecera `Authorization: Bearer <WORKER_TOKEN>`. Para
 *    programas, nunca para personas. Hoy el trabajador no llama al panel (los
 *    dos solo comparten la base), pero si algun dia lo hace, entra por aqui y
 *    no con la sesion de nadie.
 * 3. LLAVE ANTIGUA: `?k=` y REVIEW_PASSWORD, solo con LEGACY_KEY_ENABLED=true,
 *    durante la transicion. Se borrara cuando el login este confirmado.
 * 4. SIN LOGIN: KLIP_SIN_LOGIN=1, solo para la vista previa de desarrollo, y
 *    entonces el servidor escucha solo en 127.0.0.1.
 */

export const GALLETA_SESION = 'klip_sesion'

export interface Quien {
  tipo: 'usuario' | 'servicio' | 'legado' | 'local'
  rol: Rol
  usuario?: Usuario
  token?: string
}

export function leerGalleta(req: IncomingMessage, nombre: string): string | undefined {
  const cabecera = req.headers.cookie ?? ''
  for (const parte of cabecera.split(';')) {
    const eq = parte.indexOf('=')
    if (eq === -1) continue
    if (parte.slice(0, eq).trim() === nombre) {
      try {
        return decodeURIComponent(parte.slice(eq + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/**
 * Si la peticion viaja cifrada.
 *
 * En Hostinger el TLS lo termina el proxy, que lo dice en x-forwarded-proto.
 * En el ordenador de casa el panel va por http, y ahi una galleta `Secure` no
 * se guardaria nunca en el movil de la red local.
 */
export function esCifrada(req: IncomingMessage): boolean {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim()
  return proto === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true
}

export function galletaSesion(token: string, cifrada: boolean): string {
  return `${GALLETA_SESION}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESION_DIAS * 24 * 3600}${cifrada ? '; Secure' : ''}`
}

export function galletaBorrada(cifrada: boolean): string {
  return `${GALLETA_SESION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cifrada ? '; Secure' : ''}`
}

/** La direccion de quien llama. Tras el proxy de Hostinger, la primera de x-forwarded-for. */
export function ipDe(req: IncomingMessage): string {
  const reenviada = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
  return reenviada !== undefined && reenviada !== '' ? reenviada : (req.socket.remoteAddress ?? 'desconocida')
}

/** Solo rutas propias: un `volver=https://otro.sitio` seria una redireccion abierta. */
export function rutaPropia(volver: string | undefined): string {
  if (volver === undefined || !volver.startsWith('/') || volver.startsWith('//') || volver.startsWith('/\\')) return '/'
  if (volver.startsWith('/login') || volver.startsWith('/logout')) return '/'
  return volver.slice(0, 500)
}

/**
 * Una peticion que cambia algo tiene que venir de esta misma web.
 *
 * La galleta es SameSite=Lax, que ya impide la mayoria de envios desde otros
 * sitios; esto cierra el resto. Sin cabecera Origin (programas, curl) no se
 * puede comprobar y se deja pasar: esos no llevan la galleta de nadie.
 */
export function mismoOrigen(req: IncomingMessage): boolean {
  const origen = req.headers.origin
  if (origen === undefined || origen === '' || origen === 'null') return origen !== 'null'
  try {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    return new URL(origen).host === host
  } catch {
    return false
  }
}

function igual(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest()
  return timingSafeEqual(h(a), h(b))
}

async function leerCuerpo(req: IncomingMessage, limite = 16_384): Promise<string> {
  let total = 0
  const trozos: Buffer[] = []
  for await (const t of req) {
    total += (t as Buffer).length
    if (total > limite) throw new Error('cuerpo demasiado grande')
    trozos.push(t as Buffer)
  }
  return Buffer.concat(trozos).toString('utf8')
}

/** Formulario urlencoded o JSON, lo que mande el navegador. */
export async function leerFormulario(req: IncomingMessage): Promise<Record<string, string>> {
  const texto = await leerCuerpo(req)
  if (String(req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      const o = JSON.parse(texto) as Record<string, unknown>
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')]))
    } catch {
      return {}
    }
  }
  return Object.fromEntries(new URLSearchParams(texto))
}

function html(res: ServerResponse, estado: number, cuerpo: string, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(estado, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(cuerpo),
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    ...extra,
  })
  res.end(cuerpo)
}

function redirigir(res: ServerResponse, a: string, extra: Record<string, string | string[]> = {}): void {
  res.writeHead(303, { location: a, 'cache-control': 'no-store', ...extra })
  res.end()
}

function json(res: ServerResponse, estado: number, cuerpo: unknown): void {
  const p = JSON.stringify(cuerpo)
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(p), 'cache-control': 'no-store' })
  res.end(p)
}

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos.'
const MENSAJE_BLOQUEO = `Demasiados intentos. Espera ${15} minutos y vuelve a probar.`

export function legadoActivo(): boolean {
  return process.env.LEGACY_KEY_ENABLED === 'true'
}

export function sinLoginActivo(): boolean {
  return process.env.KLIP_SIN_LOGIN === '1'
}

/**
 * Atiende /login, /logout y /cuenta/contrasena. Devuelve true si la peticion
 * era una de esas y ya esta respondida.
 */
export async function atenderAcceso(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  auth: Auth,
): Promise<boolean> {
  const ruta = url.pathname
  const cifrada = esCifrada(req)

  if (ruta === '/login' && req.method === 'GET') {
    const yaDentro = await auth.sesion(leerGalleta(req, GALLETA_SESION))
    if (yaDentro !== null) {
      redirigir(res, rutaPropia(url.searchParams.get('volver') ?? '/'))
      return true
    }
    const salio = url.searchParams.get('salio') === '1'
    html(res, 200, renderLogin({
      volver: rutaPropia(url.searchParams.get('volver') ?? '/'),
      ...(salio ? { aviso: 'Has cerrado la sesión.' } : {}),
    }))
    return true
  }

  if (ruta === '/login' && req.method === 'POST') {
    if (!mismoOrigen(req)) {
      html(res, 403, renderLogin({ error: 'No se pudo entrar desde aquí. Abre el panel y vuelve a probar.' }))
      return true
    }
    let f: Record<string, string>
    try {
      f = await leerFormulario(req)
    } catch {
      html(res, 413, renderLogin({ error: MENSAJE_CREDENCIALES }))
      return true
    }
    const email = (f.email ?? '').slice(0, 254)
    const volver = rutaPropia(f.volver)
    const r = await auth.entrar(email, (f.contrasena ?? '').slice(0, 200), ipDe(req), String(req.headers['user-agent'] ?? ''))
    if (!r.ok) {
      // Mismo mensaje exista o no el correo. El bloqueo si se dice: quien lo
      // ve tiene que saber que esperar, no que su contraseña esta mal.
      log.warn(`Acceso fallido (${r.motivo}) desde ${ipDe(req)}`)
      html(res, r.motivo === 'bloqueado' ? 429 : 401, renderLogin({
        error: r.motivo === 'bloqueado' ? MENSAJE_BLOQUEO : MENSAJE_CREDENCIALES,
        email,
        volver,
      }))
      return true
    }
    log.info(`Acceso de ${r.usuario.email}`)
    redirigir(res, r.usuario.debeCambiar ? '/cuenta/contrasena' : volver, { 'set-cookie': galletaSesion(r.token, cifrada) })
    return true
  }

  if (ruta === '/logout' && (req.method === 'POST' || req.method === 'GET')) {
    // GET tambien, para que un enlace "Salir" funcione; cerrar sesion no
    // cambia nada que un tercero pueda aprovechar.
    await auth.salir(leerGalleta(req, GALLETA_SESION))
    redirigir(res, '/login?salio=1', { 'set-cookie': galletaBorrada(cifrada) })
    return true
  }

  if (ruta === '/cuenta/contrasena') {
    const token = leerGalleta(req, GALLETA_SESION)
    const s = await auth.sesion(token)
    if (s === null) {
      redirigir(res, '/login?volver=%2Fcuenta%2Fcontrasena')
      return true
    }
    if (req.method === 'GET') {
      html(res, 200, renderCambiarContrasena({ obligatorio: s.usuario.debeCambiar, minimo: MIN_CONTRASENA }))
      return true
    }
    if (req.method === 'POST') {
      if (!mismoOrigen(req)) {
        html(res, 403, renderCambiarContrasena({ obligatorio: s.usuario.debeCambiar, minimo: MIN_CONTRASENA, error: 'Vuelve a abrir esta página desde el panel.' }))
        return true
      }
      const f = await leerFormulario(req)
      const error = (m: string) =>
        html(res, 400, renderCambiarContrasena({ obligatorio: s.usuario.debeCambiar, minimo: MIN_CONTRASENA, error: m }))
      if ((f.nueva ?? '') !== (f.repetida ?? '')) {
        error('Las dos contraseñas nuevas no coinciden.')
        return true
      }
      if ((f.nueva ?? '') === (f.actual ?? '')) {
        error('La nueva tiene que ser distinta de la actual.')
        return true
      }
      try {
        await auth.cambiarContrasena(s.usuario.id, f.actual ?? '', f.nueva ?? '', token)
      } catch (e) {
        if (e instanceof ErrorUsuarios) {
          error(e.message)
          return true
        }
        throw e
      }
      redirigir(res, '/')
      return true
    }
  }

  return false
}

/**
 * Quien es, o null si nadie.
 *
 * `legado` es la comprobacion antigua (llave o REVIEW_PASSWORD), que el
 * servidor pasa ya hecha para no duplicarla aqui.
 */
export async function quienEs(
  req: IncomingMessage,
  auth: Auth,
  legado: () => boolean,
): Promise<{ quien: Quien; renovar: boolean } | null> {
  const token = leerGalleta(req, GALLETA_SESION)
  const s = await auth.sesion(token)
  if (s !== null) return { quien: { tipo: 'usuario', rol: s.usuario.rol, usuario: s.usuario, ...(token ? { token } : {}) }, renovar: s.renovar }

  const servicio = process.env.WORKER_TOKEN
  const cabecera = String(req.headers.authorization ?? '')
  if (servicio !== undefined && servicio.length >= 32 && cabecera.startsWith('Bearer ')) {
    if (igual(cabecera.slice(7).trim(), servicio)) return { quien: { tipo: 'servicio', rol: 'admin' }, renovar: false }
  }

  if (legadoActivo() && legado()) return { quien: { tipo: 'legado', rol: 'admin' }, renovar: false }
  if (sinLoginActivo() && directaDesdeEsteOrdenador(req)) return { quien: { tipo: 'local', rol: 'admin' }, renovar: false }
  return null
}

/**
 * La peticion llega del propio ordenador y sin pasar por ningun proxy.
 *
 * Escuchar en 127.0.0.1 no basta: en un hosting el proxy publico tambien se
 * conecta por localhost. Pero un proxy siempre añade x-forwarded-for, y un
 * navegador abierto en este mismo ordenador no.
 */
function directaDesdeEsteOrdenador(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? ''
  const local = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  return local && req.headers['x-forwarded-for'] === undefined && req.headers['x-forwarded-host'] === undefined
}

/** Sin sesion: las paginas van al login, las llamadas de datos reciben 401. */
export function pedirLogin(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const esPagina = req.method === 'GET' && (url.pathname === '/' || !url.pathname.startsWith('/api/')) &&
    String(req.headers.accept ?? '').includes('text/html')
  if (esPagina) {
    redirigir(res, `/login${url.pathname === '/' ? '' : `?volver=${encodeURIComponent(url.pathname + url.search)}`}`)
    return
  }
  json(res, 401, { error: 'Tu sesión terminó. Vuelve a entrar.' })
}

export function negarPermiso(res: ServerResponse): void {
  json(res, 403, { error: 'Tu usuario no puede cambiar esto. Pídeselo a quien administra el panel.' })
}
