import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/env.js'
import { writeJson } from '../lib/fsx.js'
import type { Db as DbLike } from '../store/db.js'

/**
 * Parametros que regulan el flujo de publicacion.
 *
 * Estaban repartidos como constantes entre el planificador y el generador de
 * cuentas. Se centralizan aqui porque son las perillas que de verdad se tocan:
 * cuantas cuentas, cuantas veces al dia, en que franja y con cuanta separacion.
 *
 * Los valores por defecto son exactamente los que habia escritos en el codigo,
 * asi que un sistema sin fichero de ajustes se comporta igual que antes.
 */

export interface FlowSettings {
  /** Cuentas activas sobre las que repartir. */
  accounts: number
  /** Publicaciones diarias por cuenta. */
  postsPerDay: number
  /** Primera hora util del dia. */
  dayStartHour: number
  /** Ultima hora util del dia. */
  dayEndHour: number
  /** Desviacion maxima, en minutos, sobre la hora ancla de cada franja. */
  jitterMinutes: number
  /** Ventana en la que un clip no puede repetirse entre cuentas distintas. */
  clipCooldownMinutes: number
  /** Ventana en la que una misma cuenta no puede repetir clip. */
  accountRepeatHours: number
  /**
   * Cuantas cuentas se pueden llegar a tener.
   *
   * Es un ajuste, no una constante del programa. Vivia escrito a mano en tres
   * sitios -- aqui, y dos veces en el servidor -- y el guion de consola no lo
   * respetaba, asi que por terminal se podian crear mas de las que el panel
   * admitia despues.
   *
   * El tope que manda de verdad no es este, es el plan del proveedor: el de
   * upload-post contratado admite 25 perfiles. Una cuenta de mas aqui es una
   * que falla al publicar porque no existe al otro lado.
   */
  maxCuentas: number
}

export const DEFAULTS: FlowSettings = {
  accounts: 20,
  postsPerDay: 3,
  dayStartHour: 10,
  dayEndHour: 23,
  jitterMinutes: 40,
  clipCooldownMinutes: 90,
  accountRepeatHours: 72,
  maxCuentas: 25,
}

const FILE = join(ROOT, 'state', 'settings.json')

/**
 * Limites de cada parametro. Fuera de rango se rechaza, no se recorta.
 *
 * El campo accounts NO esta aqui, y es deliberado. Es un dato que se CUENTA, no
 * uno que alguien elija: el servidor lo pisa con el numero real de cuentas
 * publicables antes de guardar. Validarlo contra un tope convertia un hecho en
 * una infraccion: con 150 cuentas creadas, guardar cualquier cosa en Horarios
 * fallaba con "accounts debe estar entre 1 y 100" sin que nadie hubiera
 * escrito ese 150 en ninguna parte.
 *
 * Quien limita cuantas cuentas puede haber es maxCuentas, que si es una
 * decision y si se valida.
 */
const LIMITS: Partial<Record<keyof FlowSettings, [number, number]>> = {
  postsPerDay: [1, 10],
  dayStartHour: [0, 23],
  dayEndHour: [1, 24],
  jitterMinutes: [0, 120],
  clipCooldownMinutes: [0, 1440],
  accountRepeatHours: [0, 336],
  // El techo de 1000 no es una capacidad medida: es un seguro contra un
  // dedazo. Lo que de verdad limita son el plan del proveedor y la
  // concurrencia del trabajador.
  maxCuentas: [1, 1000],
}

export class InvalidSettings extends Error {}

/**
 * Lee los ajustes, completando con los valores por defecto lo que falte.
 *
 * Un fichero corrupto no debe dejar el sistema sin planificar: se avisa por
 * excepcion solo al guardar, y al leer se cae a los valores por defecto.
 */
export function loadSettings(): FlowSettings {
  if (!existsSync(FILE)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<FlowSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Comprueba que los ajustes son coherentes. Devuelve los mismos valores.
 *
 * Esta separado de saveSettings porque hay dos sitios donde se guarda (fichero
 * y base de datos) y la validacion no debe vivir en uno de los dos. Un panel
 * en un servidor que aceptara una franja invertida produciria horas negativas
 * exactamente igual que el de aqui.
 */
export function validateSettings(merged: FlowSettings): FlowSettings {
  for (const [key, rango] of Object.entries(LIMITS) as [
    keyof FlowSettings,
    [number, number],
  ][]) {
    const [min, max] = rango
    const value = merged[key]
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new InvalidSettings(`${key} debe estar entre ${min} y ${max}.`)
    }
  }

  // Una franja invertida produciria bandas negativas y horas sin sentido.
  if (merged.dayEndHour <= merged.dayStartHour) {
    throw new InvalidSettings('La hora de fin debe ser posterior a la de inicio.')
  }

  return merged
}

/** Valida y guarda. Devuelve los ajustes ya normalizados. */
export function saveSettings(input: Partial<FlowSettings>): FlowSettings {
  const merged = validateSettings({ ...loadSettings(), ...input })
  writeJson(FILE, merged)
  return merged
}

/**
 * Los mismos ajustes, en la base de datos.
 *
 * Una fila por propietario. Se lee con los valores por defecto rellenando lo
 * que falte, igual que la version de fichero: un propietario sin fila todavia
 * debe comportarse como el sistema de siempre, no romperse.
 *
 * Solo se admiten campos conocidos. El cuerpo de la peticion llega del panel y
 * copiar sus claves a una sentencia SQL seria dejar que el cliente eligiera que
 * columnas se tocan.
 */
const COLUMNAS: Record<keyof FlowSettings, string> = {
  accounts: 'accounts',
  postsPerDay: 'posts_per_day',
  dayStartHour: 'day_start_hour',
  dayEndHour: 'day_end_hour',
  jitterMinutes: 'jitter_minutes',
  clipCooldownMinutes: 'clip_cooldown_minutes',
  accountRepeatHours: 'account_repeat_hours',
  maxCuentas: 'max_cuentas',
}

export async function loadSettingsDb(db: DbLike, ownerId: string): Promise<FlowSettings> {
  const filas = await db.query(`select * from settings where owner_id = $1`, [ownerId])
  const fila = filas[0]
  if (fila === undefined) return { ...DEFAULTS }

  const out = { ...DEFAULTS }
  for (const [campo, columna] of Object.entries(COLUMNAS) as [keyof FlowSettings, string][]) {
    const valor = Number((fila as Record<string, unknown>)[columna])
    if (Number.isFinite(valor)) out[campo] = valor
  }
  return out
}

export async function saveSettingsDb(
  db: DbLike,
  ownerId: string,
  input: Partial<FlowSettings>,
): Promise<FlowSettings> {
  const merged = validateSettings({ ...(await loadSettingsDb(db, ownerId)), ...input })

  const columnas = Object.values(COLUMNAS)
  const valores = (Object.keys(COLUMNAS) as (keyof FlowSettings)[]).map((k) => merged[k])

  await db.query(
    `insert into settings (owner_id, ${columnas.join(', ')})
     values ($1, ${columnas.map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (owner_id) do update set
       ${columnas.map((c) => `${c} = excluded.${c}`).join(', ')},
       updated_at = now()`,
    [ownerId, ...valores],
  )

  return merged
}

export interface FlowMath {
  /** Huecos diarios totales. */
  slotsPerDay: number
  /** Horas utiles de la franja. */
  windowHours: number
  /** Veces que un mismo clip puede usarse en un dia sin saltarse el enfriamiento. */
  maxUsesPerClip: number
  /** Clips distintos necesarios al dia. */
  clipsNeededPerDay: number
  /** Clips distintos necesarios al mes. */
  clipsNeededPerMonth: number
}

/**
 * Deriva lo que de verdad importa de los ajustes: cuantos clips distintos
 * hacen falta al dia.
 *
 * Es el calculo que decide si el sistema es viable, y no es evidente mirando
 * las perillas. Una subida no equivale a un clip nuevo: cada clip se publica en
 * varias cuentas, asi que 60 huecos diarios no piden 60 clips. Lo que limita es
 * el enfriamiento, que marca cuantas veces puede reaparecer el mismo corte.
 */
export function flowMath(s: FlowSettings): FlowMath {
  const slotsPerDay = s.accounts * s.postsPerDay
  const windowHours = s.dayEndHour - s.dayStartHour

  // Un clip usado en el minuto 0 puede reaparecer en el 90, el 180... Por eso
  // es el numero de huecos que caben, mas el primero.
  const maxUsesPerClip =
    s.clipCooldownMinutes <= 0
      ? slotsPerDay
      : Math.floor((windowHours * 60) / s.clipCooldownMinutes) + 1

  const clipsNeededPerDay = Math.max(1, Math.ceil(slotsPerDay / maxUsesPerClip))

  return {
    slotsPerDay,
    windowHours,
    maxUsesPerClip,
    clipsNeededPerDay,
    clipsNeededPerMonth: clipsNeededPerDay * 30,
  }
}
