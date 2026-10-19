import { createHash } from 'node:crypto'
import { createLogger } from '../lib/logger.js'
import type { Account } from '../store/store.js'
import { loadSettings, type FlowSettings } from './settings.js'

const log = createLogger('schedule')

/**
 * Los tres parametros de dispersion viven ahora en los ajustes de flujo.
 *
 * Antes eran constantes aqui mismo. Se movieron para poder tocarlos desde el
 * panel sin editar codigo, pero el significado de cada uno no ha cambiado:
 *
 * - jitterMinutes: sin dispersion, 20 cuentas publicarian a la misma hora
 *   exacta todos los dias. Es la firma mas obvia de una red coordinada.
 *
 * - clipCooldownMinutes: que el mismo corte aparezca en varias cuentas es
 *   inevitable, hay muchos mas huecos que clips. Lo que se evita es que
 *   aparezca en dos cuentas casi a la vez.
 *
 * - accountRepeatHours: restriccion distinta y mas dura. Se añadio tras ver el
 *   resultado real: controlando solo el enfriamiento global, 14 de 20 cuentas
 *   repetian clip el mismo dia y dos subian el mismo video tres veces. Que dos
 *   cuentas compartan un clip pasa desapercibido; que una lo suba tres veces en
 *   un dia es spam obvio.
 *
 * Se leen dentro de planSchedule y no en una constante de modulo: una constante
 * se congelaria con el valor que hubiera al importar, y el panel puede cambiar
 * los ajustes entre dos planificaciones del mismo proceso.
 */

/** Desviacion determinista: replanificar el mismo dia da el mismo resultado. */
function jitterFor(
  accountId: string,
  dayKey: string,
  slotIndex: number,
  jitterMinutes: number,
): number {
  const digest = createHash('sha256').update(`${accountId}::${dayKey}::${slotIndex}`).digest()
  const unit = digest.readUInt32BE(0) / 4294967296
  return (unit * 2 - 1) * jitterMinutes
}

export interface PlannedSlot {
  accountId: string
  clipId: string
  scheduledAt: Date
}

export interface ScheduleOptions {
  /** Dia base. Se planifica sobre este dia y los siguientes. */
  startDate: Date
  days: number
  /**
   * Los ajustes de Horarios. Sin esto se leen de state/settings.json, que es
   * lo que hacia siempre: pero ese fichero no es lo que se guarda desde el
   * panel (la base), y los cambios de Horarios no llegaban al reparto.
   */
  settings?: FlowSettings
  /**
   * Fase 7: cuantas veces como mucho sale el mismo clip, sumando todas las
   * cuentas y lo ya programado (usosPrevios). Un hueco sin clip disponible
   * se deja vacio antes que pasarse del tope.
   */
  maxRepeticiones?: number
  usosPrevios?: Map<string, number>
}

/**
 * Reparte los clips entre las franjas de las cuentas.
 *
 * El algoritmo es: generar todos los huecos con su desviacion, ordenarlos en el
 * tiempo, y recorrerlos asignando en cada uno el clip menos usado que no se
 * haya publicado dentro de la ventana de enfriamiento. Asi se reparte el uso y
 * no hay coincidencias visibles.
 */
export function planSchedule(
  accounts: Account[],
  clipIds: string[],
  options: ScheduleOptions,
): PlannedSlot[] {
  if (accounts.length === 0) throw new Error('No hay cuentas activas que planificar.')
  if (clipIds.length === 0) throw new Error('No hay clips que repartir.')

  const settings = options.settings ?? loadSettings()
  const tope = options.maxRepeticiones ?? Infinity

  // 1. Todos los huecos, con desviacion aplicada.
  const slots: { accountId: string; at: Date }[] = []

  for (let day = 0; day < options.days; day += 1) {
    const date = new Date(options.startDate)
    date.setDate(date.getDate() + day)
    const dayKey = date.toISOString().slice(0, 10)

    for (const account of accounts) {
      account.slots.forEach((hour, slotIndex) => {
        const at = new Date(date)
        at.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0)
        at.setMinutes(
          at.getMinutes() + jitterFor(account.id, dayKey, slotIndex, settings.jitterMinutes),
        )
        slots.push({ accountId: account.id, at })
      })
    }
  }

  slots.sort((a, b) => a.at.getTime() - b.at.getTime())

  // 2. Asignacion cronologica, con dos restricciones de distinta dureza.
  const lastUsedAt = new Map<string, number>()
  const lastUsedByAccount = new Map<string, number>()
  const useCount = new Map<string, number>(clipIds.map((id) => [id, options.usosPrevios?.get(id) ?? 0]))
  const planned: PlannedSlot[] = []
  let globalCollisions = 0
  let accountRepeats = 0
  let sinClip = 0

  for (const slot of slots) {
    const globalCutoff = slot.at.getTime() - settings.clipCooldownMinutes * 60_000
    const accountCutoff = slot.at.getTime() - settings.accountRepeatHours * 3_600_000

    const usedByAccount = (id: string): boolean =>
      (lastUsedByAccount.get(`${slot.accountId}::${id}`) ?? -Infinity) > accountCutoff

    // Menos usado primero; a igualdad, el que lleva mas tiempo sin usarse.
    const ranked = clipIds.filter((id) => (useCount.get(id) ?? 0) < tope).sort((a, b) => {
      const byCount = (useCount.get(a) ?? 0) - (useCount.get(b) ?? 0)
      if (byCount !== 0) return byCount
      return (lastUsedAt.get(a) ?? 0) - (lastUsedAt.get(b) ?? 0)
    })

    // La restriccion por cuenta es la dura: se prefiere violar el enfriamiento
    // global antes que hacer que una cuenta repita video. Que dos cuentas
    // compartan clip pasa desapercibido; que una lo suba dos veces, no.
    const notUsedByAccount = ranked.filter((id) => !usedByAccount(id))
    const pool = notUsedByAccount.length > 0 ? notUsedByAccount : ranked

    if (notUsedByAccount.length === 0) accountRepeats += 1

    let chosen = pool.find((id) => (lastUsedAt.get(id) ?? -Infinity) <= globalCutoff)

    if (chosen === undefined) {
      // Con pocos clips y muchos huecos puede no haber ninguno fuera del
      // enfriamiento global. Se coge el mas antiguo del grupo permitido y se
      // registra, en lugar de fallar en silencio: es la señal de que hacen
      // falta mas clips.
      chosen = pool[0]
      globalCollisions += 1
    }

    if (chosen === undefined) {
      sinClip += 1
      continue
    }

    lastUsedAt.set(chosen, slot.at.getTime())
    lastUsedByAccount.set(`${slot.accountId}::${chosen}`, slot.at.getTime())
    useCount.set(chosen, (useCount.get(chosen) ?? 0) + 1)
    planned.push({ accountId: slot.accountId, clipId: chosen, scheduledAt: slot.at })
  }

  if (globalCollisions > 0) {
    log.warn(
      `${globalCollisions} de ${slots.length} huecos se llenaron con un clip dentro de la ` +
        `ventana global de ${settings.clipCooldownMinutes} min. Hacen falta mas clips: ` +
        `con ${clipIds.length} clip(s) y ${slots.length} huecos, cada uno se repite ` +
        `${(slots.length / clipIds.length).toFixed(1)} veces.`,
    )
  }

  if (accountRepeats > 0) {
    log.error(
      `${accountRepeats} hueco(s) obligaron a que una cuenta repitiera un clip dentro de ` +
        `${settings.accountRepeatHours} h. Es el patron mas visible de todos. Se necesitan al menos ` +
        `tantos clips como publicaciones haga una cuenta en esa ventana.`,
    )
  }

  if (sinClip > 0) {
    log.warn(
      `${sinClip} hueco(s) quedaron vacios: todos los clips llegaron al tope de ${tope} ` +
        'publicaciones. Hacen falta mas clips aprobados.',
    )
  }

  return planned
}

/** Reparto de usos por clip, para revisar el plan de un vistazo. */
export function summarize(planned: PlannedSlot[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const slot of planned) counts.set(slot.clipId, (counts.get(slot.clipId) ?? 0) + 1)
  return counts
}
