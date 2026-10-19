/**
 * A que cuentas va un video y a que horas publica cada una (Fase 7).
 *
 * El modelo clientes -> campañas -> cuentas existia desde la migracion 008,
 * pero el reparto lo ignoraba: los clips de un video del cliente A se
 * repartian por TODAS las cuentas, tambien las del cliente B, y el perfil de
 * cada cliente (publicaciones al dia, franja horaria) se guardaba sin usarse.
 *
 * Regla:
 * - Video con campaña -> las cuentas del cliente de esa campaña.
 * - Video sin campaña -> las cuentas sin cliente.
 *
 * Sin clientes creados todas las cuentas estan "sin cliente", asi que quien
 * no usa clientes sigue igual que antes.
 */
import type { Db } from '../store/db.js'
import type { Account } from '../store/store.js'
import type { FlowSettings } from './settings.js'

export interface PerfilEfectivo {
  postsPerDay: number
  dayStartHour: number
  dayEndHour: number
}

export interface DestinoVideo {
  /** El cliente del video, o null si no tiene campaña. */
  cliente: { id: string; nombre: string } | null
  cuentas: Account[]
  perfil: PerfilEfectivo
}

/** Las cuentas (de entre las que pueden publicar) que reciben este video. */
export async function destinoDelVideo(
  db: Db,
  ownerId: string,
  sourceId: string,
  publicables: Account[],
  settings: FlowSettings,
): Promise<DestinoVideo> {
  const filas = await db.query<Record<string, unknown>>(
    `select c.id as cliente_id, c.nombre, c.posts_per_day, c.day_start_hour, c.day_end_hour
       from sources s
       left join campanas k on k.id = s.campana_id and k.owner_id = s.owner_id
       left join clientes c on c.id = k.cliente_id and c.owner_id = s.owner_id
      where s.owner_id = $1 and s.id = $2`,
    [ownerId, sourceId],
  )
  const f = filas[0]
  const clienteId = (f?.cliente_id as string | null | undefined) ?? null
  const cliente = clienteId === null ? null : { id: clienteId, nombre: String(f?.nombre ?? '') }
  const cuentas = publicables.filter((a) => (a.clienteId ?? null) === clienteId)
  return {
    cliente,
    cuentas,
    perfil: perfilEfectivo(settings, f),
  }
}

/** El perfil del cliente, con lo que no tenga tomado del horario general. */
export function perfilEfectivo(settings: FlowSettings, fila?: Record<string, unknown>): PerfilEfectivo {
  const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))
  const p = {
    postsPerDay: num(fila?.posts_per_day) ?? settings.postsPerDay,
    dayStartHour: num(fila?.day_start_hour) ?? settings.dayStartHour,
    dayEndHour: num(fila?.day_end_hour) ?? settings.dayEndHour,
  }
  // Un perfil a medias puede quedar invertido (inicio del cliente, fin general).
  if (p.dayStartHour >= p.dayEndHour) {
    return { postsPerDay: p.postsPerDay, dayStartHour: settings.dayStartHour, dayEndHour: settings.dayEndHour }
  }
  return p
}

/**
 * Las horas de publicacion de cada cuenta del grupo.
 *
 * Se calculan al repartir, no se leen de la base: una cuenta recien creada
 * tiene las franjas vacias hasta que alguien guarda Horarios, y con eso no
 * recibia nada. El tope diario de la cuenta recorta sus huecos del dia.
 *
 * Las horas de las cuentas del grupo se desfasan entre si dentro de cada
 * banda, como hacia repartirFranjas: no publican todas al mismo minuto.
 */
export function franjasDelGrupo(cuentas: Account[], perfil: PerfilEfectivo): Account[] {
  const total = Math.max(1, cuentas.length)
  const banda = (perfil.dayEndHour - perfil.dayStartHour) / perfil.postsPerDay
  return cuentas.map((cuenta, i) => {
    const slots = Array.from({ length: perfil.postsPerDay }, (_, s) =>
      Number((perfil.dayStartHour + s * banda + (i / total) * banda).toFixed(3)),
    )
    const tope = cuenta.limiteDiario ?? null
    return { ...cuenta, slots: tope === null ? slots : slots.slice(0, Math.max(1, tope)) }
  })
}

/** Lo que el reparto necesita saber de las ya programadas de un video. */
export function usosPrevios(items: { sourceId: string; clipId: string; status: string }[], sourceId: string): Map<string, number> {
  const usos = new Map<string, number>()
  for (const it of items) {
    if (it.sourceId !== sourceId || it.status === 'failed') continue
    usos.set(it.clipId, (usos.get(it.clipId) ?? 0) + 1)
  }
  return usos
}

/** El tope de repeticiones por clip guardado en Ajustes (10 si no hay). */
export async function maxRepeticiones(db: Db, ownerId: string): Promise<number> {
  try {
    const filas = await db.query<{ max_repeticiones: number | null }>(
      `select max_repeticiones from settings where owner_id = $1`,
      [ownerId],
    )
    const n = Number(filas[0]?.max_repeticiones)
    return Number.isInteger(n) && n >= 1 ? n : 10
  } catch {
    // Una base sin la migracion 024 todavia.
    return 10
  }
}
