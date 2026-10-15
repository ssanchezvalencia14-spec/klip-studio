/**
 * Fase 5b: variantes -> cola de publicacion programada
 *
 *   npm run schedule -- <sourceId> --days 1
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv, paths } from '../src/lib/env.js'
import { readJson, workDir } from '../src/lib/fsx.js'
import { planSchedule, summarize } from '../src/queue/schedule.js'
import { flowMath, loadSettingsDb } from '../src/queue/settings.js'
import { type QueueItem } from '../src/store/store.js'
/*
 * Postgres y no los ficheros de state/.
 *
 * El publicador ya lee la cola de la base (ver estado-pg.ts). Si el reparto
 * escribiera en los ficheros, nadie recogeria lo repartido: el panel enseñaria
 * la cola vacia y el worker no encontraria trabajo.
 */
import { connect } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { requireEnv } from '../src/lib/env.js'
import {
  createCaptionVarier,
  HashtagOnlyVarier,
  type CaptionSet,
} from '../src/variants/captions.js'
import type { VariantParams } from '../src/variants/params.js'

interface ClipsFile {
  clips: { caption: string; hashtags: string[] }[]
}

/**
 * Textos base por clip.
 *
 * El render numera los maestros en el orden de clips.json, asi que el indice de
 * ese array es la unica forma de relacionar un clip-NN con su caption.
 */
function loadBaseCaptions(sourceId: string): Map<string, CaptionSet> {
  const path = join(workDir(sourceId), 'clips.json')
  const map = new Map<string, CaptionSet>()
  if (!existsSync(path)) return map

  readJson<ClipsFile>(path).clips.forEach((clip, i) => {
    map.set(`clip-${String(i + 1).padStart(2, '0')}`, {
      caption: clip.caption,
      hashtags: clip.hashtags,
    })
  })
  return map
}

interface VariantsFile {
  sourceId: string
  variants: {
    clipId: string
    accountId: string
    path: string
    checksum: string
    params: VariantParams
    durationSec: number
  }[]
}

function formatDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function main(): Promise<void> {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: 'string', default: '1' },
      from: { type: 'string' },
      // Planifica y muestra el calendario sin exigir las variantes ni escribir
      // en la cola. Sirve para validar el reparto antes de gastar GPU.
      'dry-run': { type: 'boolean', default: false },
    },
  })

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run schedule -- <sourceId> [--days 1] [--from 2026-09-11]')
    process.exitCode = 1
    return
  }

  const dryRun = values['dry-run']

  const db = await connect(requireEnv('DATABASE_URL'))
  const store = createStore(db, OWNER_ID)

  // Solo las que tienen permiso de TikTok: repartir sobre las demas llena la
  // cola de publicaciones que fallaran una por una.
  const active = await store.accounts.publicables()
  if (active.length === 0) {
    console.error('No hay cuentas activas.')
    process.exitCode = 1
    await db.close()
    return
  }

  const baseCaptions = loadBaseCaptions(sourceId)
  const variantsPath = join(paths.out, sourceId, 'variants.json')

  let index = new Map<string, VariantsFile['variants'][number]>()
  let clipIds: string[]

  if (existsSync(variantsPath)) {
    const file = readJson<VariantsFile>(variantsPath)
    index = new Map(file.variants.map((v) => [`${v.clipId}::${v.accountId}`, v]))
    // En seco se planifica sobre TODOS los clips de clips.json, no solo sobre
    // los que ya tienen variante. Si no, un render a medias daria un calendario
    // enganoso: pareceria que hay menos material del que en realidad hay.
    const fromVariants = [...new Set(file.variants.map((v) => v.clipId))]
    clipIds = (dryRun && baseCaptions.size > 0 ? [...baseCaptions.keys()] : fromVariants).sort()
  } else if (dryRun) {
    clipIds = [...baseCaptions.keys()].sort()
    if (clipIds.length === 0) {
      console.error(`No hay variantes ni clips.json para ${sourceId}.`)
      process.exitCode = 1
      await db.close()
      return
    }
  } else {
    console.error(`${sourceId} no tiene todavia sus copias por cuenta.`)
    console.error('Se preparan solas al terminar de revisarlo, o a mano desde su ficha.')
    console.error('O usa --dry-run para validar el reparto sin variantes.')
    process.exitCode = 1
    await db.close()
    return
  }

  const startDate = values.from === undefined ? new Date() : new Date(`${values.from}T00:00:00`)
  startDate.setHours(0, 0, 0, 0)

  const planned = planSchedule(active, clipIds, { startDate, days: Number(values.days) })

  const accountIds = active.map((a) => a.id)
  const captionsByClip = new Map<string, Map<string, CaptionSet>>()

  // En seco no se varian textos: gastaria llamadas a la API para un calendario
  // que no se va a encolar.
  if (!dryRun) {
    let varier = createCaptionVarier()
    console.log(`Variacion de textos: ${varier.name}`)

    // Degradacion escalonada. Si el modelo falla se pasa a la variacion por
    // hashtags para el resto de clips, en lugar de reintentar seis veces contra
    // una API que ya se sabe que no responde, y en lugar de dejar el caption
    // base sin variar ni siquiera los hashtags.
    for (const clipId of clipIds) {
      const base = baseCaptions.get(clipId)
      if (base === undefined) continue
      try {
        captionsByClip.set(clipId, await varier.vary(base, accountIds))
      } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
        console.error(`  ${clipId}: fallo la variacion por modelo (${reason}).`)
        varier = new HashtagOnlyVarier()
        console.error(`  Se degrada a "${varier.name}" para los clips restantes.`)
        captionsByClip.set(clipId, await varier.vary(base, accountIds))
      }
    }
  }

  const items: QueueItem[] = []
  const missing: string[] = []

  for (const slot of planned) {
    const variant = index.get(`${slot.clipId}::${slot.accountId}`)
    if (variant === undefined && !dryRun) {
      missing.push(`${slot.clipId}/${slot.accountId}`)
      continue
    }
    const text =
      captionsByClip.get(slot.clipId)?.get(slot.accountId) ??
      baseCaptions.get(slot.clipId) ?? { caption: '', hashtags: [] }
    items.push({
      id: `${slot.clipId}-${slot.accountId}-${slot.scheduledAt.toISOString()}`,
      sourceId,
      clipId: slot.clipId,
      accountId: slot.accountId,
      variantPath: variant?.path ?? '(pendiente de renderizar)',
      checksum: variant?.checksum ?? '',
      params: variant?.params ?? {
        zoom: 0,
        speed: 0,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        trimStartSec: 0,
      },
      caption: text.caption,
      hashtags: text.hashtags,
      scheduledAt: slot.scheduledAt.toISOString(),
      status: 'pending',
      attemptCount: 0,
      lastError: null,
    })
  }

  const added = dryRun ? 0 : await store.queue.add(items)
  if (dryRun) console.log('Modo en seco: no se ha escrito nada en la cola.')

  // Capacidad: cuantos clips distintos hacen falta para que ninguno se repita
  // dentro de la ventana de enfriamiento. Es el dato mas accionable que puede
  // dar el planificador, porque marca cuanto material hay que producir al dia.
  //
  // El calculo vive en flowMath y no aqui: el panel enseña el mismo numero al
  // tocar los ajustes, y dos formulas separadas acabarian discrepando.
  const settings = await loadSettingsDb(db, OWNER_ID)
  const math = flowMath(settings)
  const spanMinutes = math.windowHours * 60 * Number(values.days)
  const minutesBetweenSlots = spanMinutes / Math.max(1, planned.length)

  console.log('')
  console.log('='.repeat(72))
  console.log(`Cuentas activas    : ${active.length}`)
  console.log(`Clips disponibles  : ${clipIds.length}`)
  console.log(`Huecos planificados: ${planned.length}`)
  console.log(
    `Encolados          : ${dryRun ? 'nada (modo en seco)' : `${added} (${items.length - added} ya existian)`}`,
  )
  console.log(
    `Capacidad          : un hueco cada ${minutesBetweenSlots.toFixed(0)} min; ` +
      `hacen falta ${math.clipsNeededPerDay} clips distintos al dia para respetar ` +
      `${settings.clipCooldownMinutes} min de enfriamiento`,
  )
  if (missing.length > 0) {
    console.log(`Sin variante      : ${missing.length} -> ${missing.slice(0, 5).join(', ')}`)
  }
  console.log('='.repeat(72))

  console.log('')
  console.log('Reparto por clip:')
  for (const [clipId, count] of [...summarize(planned)].sort()) {
    console.log(`  ${clipId}: ${count} publicacion(es)`)
  }

  console.log('')
  console.log('Primeras 12 publicaciones programadas:')
  for (const item of items.slice(0, 12)) {
    console.log(
      `  ${formatDateTime(new Date(item.scheduledAt))}  ${item.accountId}  ${item.clipId}`,
    )
  }

  // Comprobacion de dispersion: cuantas publicaciones caen en el mismo minuto.
  const perMinute = new Map<string, number>()
  for (const item of items) {
    const key = item.scheduledAt.slice(0, 16)
    perMinute.set(key, (perMinute.get(key) ?? 0) + 1)
  }
  const collisions = [...perMinute.values()].filter((n) => n > 1).length
  console.log('')
  console.log(
    `Dispersion: ${perMinute.size} minutos distintos para ${items.length} publicaciones, ` +
      `${collisions} minuto(s) con mas de una.`,
  )

  await db.close()
}

await main()
