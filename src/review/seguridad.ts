/**
 * Seguridad del panel (Fase 8): cabeceras, limite de peticiones y registro
 * de auditoria.
 *
 * Todo lo de aqui es independiente de las rutas: el servidor lo llama al
 * principio de cada peticion (cabeceras y limite) y al terminar las que
 * cambian algo (auditoria).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Db } from '../store/db.js'
import { createLogger } from '../lib/logger.js'
import { limpiarRutas } from '../lib/limpiar.js'

const log = createLogger('seguridad')

// --- Cabeceras -----------------------------------------------------------------------------

/**
 * La huella del unico <script> en linea del panel (src/review/page.ts).
 *
 * Con la huella la politica no necesita 'unsafe-inline' para scripts: un
 * script inyectado por un fallo de escape no se ejecutaria. Los estilos si
 * llevan 'unsafe-inline' porque el panel usa atributos style="", que una
 * politica con huellas no permite; un estilo inyectado no ejecuta codigo.
 */
export function huellaScript(contenido: string): string {
  return `'sha256-${createHash('sha256').update(contenido, 'utf8').digest('base64')}'`
}

export function politicaContenido(huella: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${huella}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Las miniaturas y los videos pueden venir firmados del almacenamiento.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Si la peticion llego cifrada (directa o tras el proxy de Hostinger). */
export function llegoCifrada(req: IncomingMessage): boolean {
  return (req.headers['x-forwarded-proto'] ?? '') === 'https' ||
    Boolean((req.socket as { encrypted?: boolean }).encrypted)
}

/** Pone las cabeceras de seguridad. Se llama antes de cualquier respuesta. */
export function aplicarCabeceras(req: IncomingMessage, res: ServerResponse, huella: string): void {
  res.setHeader('content-security-policy', politicaContenido(huella))
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.setHeader('cross-origin-opener-policy', 'same-origin')
  // HSTS solo por https: por http (el panel en casa) el navegador lo ignora,
  // y mandarlo daria a entender una proteccion que no hay.
  if (llegoCifrada(req)) res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains')
}

// --- Limite de peticiones ------------------------------------------------------------------

export interface Limite {
  /** Peticiones permitidas por ventana. */
  maximo: number
  ventanaMs: number
}

/**
 * Cuantas peticiones por minuto y por direccion.
 *
 * Generosas a proposito: el panel sondea cada 3 s (20 por minuto y pestaña) y
 * aprobar en lote son decenas de peticiones seguidas. Lo que se corta es un
 * script en bucle o alguien probando contraseñas contra la API.
 */
export const LIMITES = {
  lectura: { maximo: 600, ventanaMs: 60_000 },
  escritura: { maximo: 120, ventanaMs: 60_000 },
  subida: { maximo: 10, ventanaMs: 60_000 },
} satisfies Record<string, Limite>

export function claseDePeticion(metodo: string, ruta: string): keyof typeof LIMITES | null {
  if (!ruta.startsWith('/api/')) return null
  // El progreso en vivo es una sola conexion larga.
  if (ruta === '/api/events') return null
  if (ruta === '/api/upload') return 'subida'
  return metodo === 'GET' || metodo === 'HEAD' ? 'lectura' : 'escritura'
}

/** Ventana fija por (clave, clase). En memoria: un solo proceso de panel. */
export function crearLimitador(ahora: () => number = Date.now) {
  const cubos = new Map<string, { desde: number; n: number }>()
  let limpiado = ahora()
  return {
    /** null si pasa; si no, los segundos que hay que esperar. */
    comprobar(clave: string, clase: keyof typeof LIMITES): number | null {
      const t = ahora()
      const lim = LIMITES[clase]
      if (t - limpiado > 5 * 60_000) {
        for (const [k, c] of cubos) if (t - c.desde > lim.ventanaMs * 2) cubos.delete(k)
        limpiado = t
      }
      const k = `${clase}:${clave}`
      const c = cubos.get(k)
      if (c === undefined || t - c.desde >= lim.ventanaMs) {
        cubos.set(k, { desde: t, n: 1 })
        return null
      }
      c.n += 1
      if (c.n > lim.maximo) return Math.max(1, Math.ceil((c.desde + lim.ventanaMs - t) / 1000))
      return null
    },
  }
}

/**
 * Quien pide, para el limite. Tras el proxy de Hostinger todas las
 * peticiones vienen de la misma direccion, asi que se usa la primera de
 * x-forwarded-for. Se puede falsear, pero el limite es una red de seguridad,
 * no la defensa: el login ya bloquea por intentos (src/auth/auth.ts).
 */
export function direccionDe(req: IncomingMessage): string {
  const reenviada = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()
  return reenviada || req.socket.remoteAddress || 'desconocida'
}

// --- Auditoria -----------------------------------------------------------------------------

/** Claves que nunca se guardan en el registro, ni siquiera recortadas. */
const SECRETAS = /pass|contrase|clave|token|secret|cookie|apikey|api_key|authorization/i

/** El cuerpo de la peticion, sin secretos y recortado, para el registro. */
export function resumirCuerpo(cuerpo: unknown, profundidad = 0): unknown {
  if (cuerpo === null || cuerpo === undefined) return null
  if (typeof cuerpo === 'string') return limpiarRutas(cuerpo).slice(0, 200)
  if (typeof cuerpo === 'number' || typeof cuerpo === 'boolean') return cuerpo
  if (profundidad > 2) return '…'
  if (Array.isArray(cuerpo)) {
    const lista = cuerpo.slice(0, 20).map((x) => resumirCuerpo(x, profundidad + 1))
    return cuerpo.length > 20 ? [...lista, `… y ${cuerpo.length - 20} más`] : lista
  }
  if (typeof cuerpo === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cuerpo as Record<string, unknown>).slice(0, 30)) {
      out[k] = SECRETAS.test(k) ? '***' : resumirCuerpo(v, profundidad + 1)
    }
    return out
  }
  return null
}

/** Una accion legible a partir de la ruta: lo que se ve en el registro. */
export function describirAccion(metodo: string, ruta: string, cuerpo: unknown): string {
  const b = (cuerpo ?? {}) as Record<string, unknown>
  const estado = typeof b.status === 'string' ? b.status : ''
  if (/^\/api\/clips\/[^/]+\/[^/]+\/status$/.test(ruta) || /^\/api\/clips\/[^/]+\/[^/]+$/.test(ruta)) {
    if (estado === 'approved') return 'aprobó un clip'
    if (estado === 'rejected') return 'descartó un clip'
    if (estado === 'pending') return 'devolvió un clip a revisar'
  }
  if (ruta === '/api/clips/lote') return estado === 'approved' ? 'aprobó clips en lote' : 'cambió clips en lote'
  if (ruta.endsWith('/editar')) return 'editó un clip'
  if (ruta.endsWith('/enlace')) return 'sacó un enlace de descarga'
  if (ruta === '/api/jobs' && b.kind === 'publish') return 'lanzó la publicación'
  if (ruta === '/api/jobs' && b.kind === 'schedule') return 'repartió en la agenda'
  if (ruta === '/api/jobs') return `lanzó una tarea (${typeof b.kind === 'string' ? b.kind : '?'})`
  if (ruta === '/api/cuentas') return `cuentas: ${typeof b.accion === 'string' ? b.accion : metodo}`
  if (ruta.startsWith('/api/usuarios')) return 'cambió usuarios'
  if (ruta.startsWith('/api/ajustes') || ruta === '/api/settings') return 'cambió ajustes'
  if (ruta === '/api/upload') return 'subió un video'
  return `${metodo} ${ruta}`
}

export async function anotarAuditoria(
  db: Db,
  ownerId: string,
  quien: string,
  metodo: string,
  ruta: string,
  cuerpo: unknown,
  estado: number,
): Promise<void> {
  try {
    await db.query(
      `insert into auditoria (owner_id, quien, accion, ruta, detalle, estado)
       values ($1, $2, $3, $4, $5, $6)`,
      [ownerId, quien.slice(0, 120), describirAccion(metodo, ruta, cuerpo), `${metodo} ${ruta}`.slice(0, 300),
        JSON.stringify(resumirCuerpo(cuerpo)), estado],
    )
  } catch (error) {
    // Sin la migracion 025, o la base caida un momento: no se tumba la peticion.
    log.warn(`No se pudo anotar en la auditoria: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }
}

export async function leerAuditoria(db: Db, ownerId: string, limite = 50): Promise<Record<string, unknown>[]> {
  const filas = await db.query<Record<string, unknown>>(
    `select quien, accion, ruta, detalle, estado, en from auditoria
      where owner_id = $1 order by en desc limit $2`,
    [ownerId, limite],
  )
  return filas.map((f) => ({
    quien: f.quien,
    accion: f.accion,
    ruta: f.ruta,
    detalle: f.detalle,
    estado: Number(f.estado),
    en: new Date(f.en as string).toISOString(),
  }))
}

// --- Enlaces de descarga firmados ---------------------------------------------------------

/** Lo que dura un enlace de descarga. */
export const DURACION_ENLACE_S = 24 * 3600

/*
 * El secreto con el que se firman. Del .env (ENLACES_SECRETO) para que los
 * enlaces sobrevivan a un reinicio del panel; si falta, uno al azar por
 * proceso: los enlaces caducan al reiniciar, que es seguro aunque incomodo.
 */
let secretoProceso: string | null = null
function secretoEnlaces(): string {
  const env = process.env.ENLACES_SECRETO ?? ''
  if (env.length >= 32) return env
  secretoProceso ??= randomBytes(32).toString('base64url')
  return secretoProceso
}

function firma(sourceId: string, clipId: string, exp: number): string {
  return createHmac('sha256', secretoEnlaces()).update(`${sourceId}\n${clipId}\n${exp}`).digest('base64url')
}

/** La ruta firmada para descargar un clip, valida `segundos`. */
export function firmarEnlace(sourceId: string, clipId: string, segundos = DURACION_ENLACE_S, ahora = Date.now()): string {
  const exp = Math.floor(ahora / 1000) + segundos
  return `/descarga/${encodeURIComponent(sourceId)}/${encodeURIComponent(clipId)}?exp=${exp}&firma=${firma(sourceId, clipId, exp)}`
}

/** Si la firma es buena y no ha caducado. Comparacion en tiempo constante. */
export function verificarEnlace(sourceId: string, clipId: string, exp: string, f: string, ahora = Date.now()): boolean {
  const n = Number(exp)
  if (!Number.isInteger(n) || n < Math.floor(ahora / 1000)) return false
  const esperada = Buffer.from(firma(sourceId, clipId, n))
  const recibida = Buffer.from(f)
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida)
}
