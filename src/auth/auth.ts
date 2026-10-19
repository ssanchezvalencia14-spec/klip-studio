import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Db } from '../store/db.js'

/**
 * Usuarios y sesiones del panel.
 *
 * IMPLEMENTACION PROPIA, y no Supabase Auth: el proyecto usa Supabase solo como
 * Postgres (con el driver `postgres`) y como almacen de archivos, sin su
 * cliente. Meter su autenticacion obligaria a añadir el SDK y a cambiar como
 * habla el panel con la base, para tres o cuatro personas que entran con
 * correo y contraseña.
 *
 * - Contraseñas con bcrypt (bcryptjs: JavaScript puro, sin compilar nada en
 *   Hostinger). Minimo 10 caracteres.
 * - La sesion es un token al azar de 32 bytes en una galleta HttpOnly. En la
 *   base solo se guarda su hash.
 * - 7 dias de vida que se renuevan mientras se use.
 * - Sin registro publico: los usuarios los crea un administrador.
 */

export type Rol = 'admin' | 'operador'

export interface Usuario {
  id: string
  email: string
  nombre: string
  rol: Rol
  activo: boolean
  debeCambiar: boolean
  creadoEn: string
  ultimoAcceso: string | null
}

export const MIN_CONTRASENA = 10
export const SESION_DIAS = 7
/** Cada cuanto se alarga la sesion mientras se usa. Mas a menudo seria escribir en cada peticion. */
const RENOVAR_CADA_MS = 60 * 60_000
const COSTE_BCRYPT = 12

/** Frenado de intentos: ventana, y fallos que se toleran dentro de ella. */
export const VENTANA_INTENTOS_MIN = 15
export const MAX_FALLOS_CORREO = 5
export const MAX_FALLOS_IP = 20

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

/** Devuelve por que no vale, o null si vale. */
export function problemaContrasena(contrasena: string): string | null {
  if (contrasena.length < MIN_CONTRASENA) return `La contraseña necesita al menos ${MIN_CONTRASENA} caracteres.`
  if (contrasena.length > 200) return 'La contraseña es demasiado larga.'
  return null
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/*
 * Un hash de bcrypt valido que no corresponde a nadie.
 *
 * Cuando el correo no existe se compara igualmente contra esto. Sin ello, un
 * correo inexistente responderia en un milisegundo y uno existente en
 * doscientos: el tiempo diria que correos tienen cuenta.
 */
const HASH_FANTASMA = bcrypt.hashSync('nadie-tiene-esta-contraseña', COSTE_BCRYPT)

function aUsuario(f: Record<string, unknown>): Usuario {
  return {
    id: String(f.id),
    email: String(f.email),
    nombre: String(f.nombre ?? ''),
    rol: f.rol as Rol,
    activo: Boolean(f.activo),
    debeCambiar: Boolean(f.debe_cambiar),
    creadoEn: new Date(f.creado_en as string).toISOString(),
    ultimoAcceso: f.ultimo_acceso === null || f.ultimo_acceso === undefined ? null : new Date(f.ultimo_acceso as string).toISOString(),
  }
}

export type ResultadoAcceso =
  | { ok: true; token: string; usuario: Usuario }
  | { ok: false; motivo: 'credenciales' | 'bloqueado' }

export class ErrorUsuarios extends Error {}

export function createAuth(db: Db, ownerId: string) {
  async function fallos(clave: string): Promise<number> {
    const filas = await db.query<{ n: string }>(
      `select count(*) as n from intentos_acceso
        where clave = $1 and creado_en > now() - interval '${VENTANA_INTENTOS_MIN} minutes'`,
      [clave],
    )
    return Number(filas[0]?.n ?? 0)
  }

  async function anotarFallo(claves: string[]): Promise<void> {
    for (const clave of claves) {
      await db.query(`insert into intentos_acceso (clave) values ($1)`, [clave])
    }
    // Limpieza de paso: lo de hace mas de un dia no sirve para nada.
    await db.query(`delete from intentos_acceso where creado_en < now() - interval '1 day'`)
  }

  async function crearSesion(usuarioId: string, agente: string): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await db.query(
      `insert into sesiones (id_hash, usuario_id, expira_en, agente)
       values ($1, $2, now() + interval '${SESION_DIAS} days', $3)`,
      [hashToken(token), usuarioId, agente.slice(0, 200)],
    )
    return token
  }

  async function contarAdmins(): Promise<number> {
    const filas = await db.query<{ n: string }>(
      `select count(*) as n from usuarios where owner_id = $1 and rol = 'admin' and activo`,
      [ownerId],
    )
    return Number(filas[0]?.n ?? 0)
  }

  return {
    async contar(): Promise<number> {
      const filas = await db.query<{ n: string }>(`select count(*) as n from usuarios where owner_id = $1`, [ownerId])
      return Number(filas[0]?.n ?? 0)
    },

    async listar(): Promise<Usuario[]> {
      const filas = await db.query(
        `select * from usuarios where owner_id = $1 order by rol, lower(email)`,
        [ownerId],
      )
      return filas.map((f) => aUsuario(f))
    },

    async crear(datos: { email: string; nombre?: string; rol: Rol; contrasena: string; debeCambiar?: boolean }): Promise<Usuario> {
      const email = normalizarEmail(datos.email)
      if (!emailValido(email)) throw new ErrorUsuarios('El correo no es válido.')
      if (datos.rol !== 'admin' && datos.rol !== 'operador') throw new ErrorUsuarios('El rol no existe.')
      const problema = problemaContrasena(datos.contrasena)
      if (problema !== null) throw new ErrorUsuarios(problema)
      const existe = await db.query(`select 1 from usuarios where lower(email) = $1`, [email])
      if (existe.length > 0) throw new ErrorUsuarios('Ya hay un usuario con ese correo.')
      const hash = await bcrypt.hash(datos.contrasena, COSTE_BCRYPT)
      const filas = await db.query(
        `insert into usuarios (owner_id, email, nombre, rol, hash, debe_cambiar)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [ownerId, email, (datos.nombre ?? '').trim().slice(0, 80), datos.rol, hash, datos.debeCambiar ?? false],
      )
      return aUsuario(filas[0] as Record<string, unknown>)
    },

    /**
     * Entrar con correo y contraseña.
     *
     * El motivo del fallo NUNCA distingue "no existe" de "contraseña mal": la
     * pantalla dice lo mismo en los dos casos. Con demasiados fallos recientes
     * del mismo correo o de la misma direccion, ni se comprueba la contraseña.
     */
    async entrar(emailCrudo: string, contrasena: string, ip: string, agente = ''): Promise<ResultadoAcceso> {
      const email = normalizarEmail(emailCrudo)
      const claves = [`email:${email}`, `ip:${ip}`]

      if ((await fallos(claves[0]!)) >= MAX_FALLOS_CORREO || (await fallos(claves[1]!)) >= MAX_FALLOS_IP) {
        return { ok: false, motivo: 'bloqueado' }
      }

      const filas = await db.query(
        `select * from usuarios where lower(email) = $1 and owner_id = $2`,
        [email, ownerId],
      )
      const fila = filas[0] as Record<string, unknown> | undefined
      const coincide = await bcrypt.compare(contrasena, (fila?.hash as string | undefined) ?? HASH_FANTASMA)

      if (fila === undefined || !coincide || !fila.activo) {
        await anotarFallo(claves)
        return { ok: false, motivo: 'credenciales' }
      }

      await db.query(`delete from intentos_acceso where clave = $1`, [claves[0]])
      await db.query(`update usuarios set ultimo_acceso = now() where id = $1`, [fila.id])
      return { ok: true, token: await crearSesion(String(fila.id), agente), usuario: aUsuario(fila) }
    },

    /**
     * Quien es el dueño de esta galleta, o null.
     *
     * `renovar` dice si hay que volver a mandar la galleta: la sesion se alarga
     * otros 7 dias como mucho una vez por hora.
     */
    async sesion(token: string | undefined): Promise<{ usuario: Usuario; renovar: boolean } | null> {
      if (token === undefined || token === '' || token.length > 200) return null
      const id = hashToken(token)
      const filas = await db.query(
        `select u.*, s.renovada_en from sesiones s join usuarios u on u.id = s.usuario_id
          where s.id_hash = $1 and s.expira_en > now() and u.activo and u.owner_id = $2`,
        [id, ownerId],
      )
      const f = filas[0] as Record<string, unknown> | undefined
      if (f === undefined) return null
      const renovar = Date.now() - new Date(f.renovada_en as string).getTime() > RENOVAR_CADA_MS
      if (renovar) {
        await db.query(
          `update sesiones set expira_en = now() + interval '${SESION_DIAS} days', renovada_en = now()
            where id_hash = $1`,
          [id],
        )
      }
      return { usuario: aUsuario(f), renovar }
    },

    async salir(token: string | undefined): Promise<void> {
      if (token === undefined || token === '') return
      await db.query(`delete from sesiones where id_hash = $1`, [hashToken(token)])
    },

    /** Cambiar la propia contraseña. Cierra las demas sesiones de ese usuario. */
    async cambiarContrasena(usuarioId: string, actual: string, nueva: string, tokenActual?: string): Promise<void> {
      const filas = await db.query(`select hash from usuarios where id = $1 and owner_id = $2`, [usuarioId, ownerId])
      const hash = (filas[0] as { hash?: string } | undefined)?.hash
      if (hash === undefined || !(await bcrypt.compare(actual, hash))) {
        throw new ErrorUsuarios('La contraseña actual no es correcta.')
      }
      const problema = problemaContrasena(nueva)
      if (problema !== null) throw new ErrorUsuarios(problema)
      await db.query(
        `update usuarios set hash = $2, debe_cambiar = false where id = $1`,
        [usuarioId, await bcrypt.hash(nueva, COSTE_BCRYPT)],
      )
      await db.query(
        `delete from sesiones where usuario_id = $1 and id_hash <> $2`,
        [usuarioId, tokenActual === undefined ? '' : hashToken(tokenActual)],
      )
    },

    /**
     * El administrador pone una contraseña nueva a otro usuario.
     *
     * Es la recuperacion de contraseña mientras no haya correo configurado.
     * Cierra todas sus sesiones y le pide cambiarla al entrar.
     */
    async restablecer(usuarioId: string, nueva: string): Promise<void> {
      const problema = problemaContrasena(nueva)
      if (problema !== null) throw new ErrorUsuarios(problema)
      const filas = await db.query(
        `update usuarios set hash = $3, debe_cambiar = true where id = $1 and owner_id = $2 returning id`,
        [usuarioId, ownerId, await bcrypt.hash(nueva, COSTE_BCRYPT)],
      )
      if (filas.length === 0) throw new ErrorUsuarios('Ese usuario no existe.')
      await db.query(`delete from sesiones where usuario_id = $1`, [usuarioId])
    },

    /** Cambiar rol o desactivar. Nunca deja el panel sin ningun administrador. */
    async actualizar(usuarioId: string, cambios: { rol?: Rol; activo?: boolean }): Promise<Usuario> {
      const filas = await db.query(`select * from usuarios where id = $1 and owner_id = $2`, [usuarioId, ownerId])
      const f = filas[0] as Record<string, unknown> | undefined
      if (f === undefined) throw new ErrorUsuarios('Ese usuario no existe.')
      const actual = aUsuario(f)
      if (cambios.rol !== undefined && cambios.rol !== 'admin' && cambios.rol !== 'operador') {
        throw new ErrorUsuarios('El rol no existe.')
      }
      const dejaDeSerAdmin =
        actual.rol === 'admin' && actual.activo && (cambios.rol === 'operador' || cambios.activo === false)
      if (dejaDeSerAdmin && (await contarAdmins()) <= 1) {
        throw new ErrorUsuarios('Tiene que quedar al menos un administrador activo.')
      }
      const nuevas = await db.query(
        `update usuarios set rol = $2, activo = $3 where id = $1 returning *`,
        [usuarioId, cambios.rol ?? actual.rol, cambios.activo ?? actual.activo],
      )
      if (cambios.activo === false) await db.query(`delete from sesiones where usuario_id = $1`, [usuarioId])
      return aUsuario(nuevas[0] as Record<string, unknown>)
    },
  }
}

export type Auth = ReturnType<typeof createAuth>

// --- Permisos ---------------------------------------------------------------------

/**
 * Que puede tocar cada rol.
 *
 * El operador revisa, aprueba y mira la agenda; tambien añade videos, que es
 * su trabajo diario. No toca la configuracion: cuentas, clientes, horarios,
 * estilo, plantillas, IA ni usuarios. LEER esas pantallas si puede (el panel
 * las usa para pintar), salvo la lista de usuarios.
 *
 * Se decide en el servidor. Esconder botones en la pantalla es comodidad, no
 * seguridad.
 */
const SOLO_ADMIN_ESCRITURA = [
  '/api/settings', '/api/ajustes', '/api/plantillas', '/api/proyectos',
  '/api/cuentas', '/api/plataformas', '/api/ia',
]

export function permitido(rol: Rol, metodo: string, ruta: string): boolean {
  if (rol === 'admin') return true
  if (ruta === '/api/usuarios' || ruta.startsWith('/api/usuarios/')) return false
  const escribe = metodo !== 'GET' && metodo !== 'HEAD'
  if (!escribe) return true
  return !SOLO_ADMIN_ESCRITURA.some((p) => ruta === p || ruta.startsWith(p + '/'))
}
