/**
 * Comprueba que lo migrado coincide con los ficheros originales.
 *
 *   npm run verify:db
 *
 * No basta con que el script de migracion no diera error. Esto lee de la base
 * y lo compara contra state/*.json campo a campo en los registros que importan.
 * Migrar bien significa que los datos siguen diciendo lo mismo, no que hubo el
 * mismo numero de filas.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, requireEnv, ROOT } from '../src/lib/env.js'
import { readJson } from '../src/lib/fsx.js'
import { connect } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
import type { Account, ClipRecord } from '../src/store/store.js'

loadEnv()

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const OWNER = '11111111-1111-1111-1111-111111111111'
const STATE = join(ROOT, 'state')
const leer = <T>(n: string): T[] =>
  existsSync(join(STATE, `${n}.json`)) ? readJson<T[]>(join(STATE, `${n}.json`)) : []

const db = await connect(requireEnv('DATABASE_URL'))
const store = createStore(db, OWNER)

try {
  // --- Los clips llegaron todos y con el mismo contenido --------------------
  const ficheroClips = leer<ClipRecord>('clips')
  const baseClips = await store.clips.all()

  check(
    'Numero de clips',
    ficheroClips.length === baseClips.length,
    `${ficheroClips.length} en fichero, ${baseClips.length} en base`,
  )

  // Se compara campo a campo, no solo el total: una migracion puede traer el
  // numero correcto de filas con el contenido cambiado.
  const porClave = new Map(baseClips.map((c) => [`${c.sourceId}/${c.clipId}`, c]))
  const distintos: string[] = []
  for (const f of ficheroClips) {
    const b = porClave.get(`${f.sourceId}/${f.clipId}`)
    if (b === undefined) {
      distintos.push(`${f.clipId} ausente`)
      continue
    }
    if (
      b.status !== f.status ||
      b.score !== f.score ||
      b.caption !== f.caption ||
      b.hook !== f.hook ||
      Math.abs(b.start - f.start) > 0.01 ||
      b.hashtags.join(',') !== f.hashtags.join(',')
    ) {
      distintos.push(f.clipId)
    }
  }
  check(
    'Contenido de cada clip identico',
    distintos.length === 0,
    distintos.length === 0 ? 'todos coinciden' : `difieren: ${distintos.slice(0, 4).join(', ')}`,
  )

  // --- Los estados de revision se conservaron -------------------------------
  const cuenta = (rows: ClipRecord[]) => ({
    pending: rows.filter((c) => c.status === 'pending').length,
    approved: rows.filter((c) => c.status === 'approved').length,
    rejected: rows.filter((c) => c.status === 'rejected').length,
  })
  const ef = cuenta(ficheroClips)
  const eb = cuenta(baseClips)
  check(
    'Aprobados y descartados intactos',
    ef.pending === eb.pending && ef.approved === eb.approved && ef.rejected === eb.rejected,
    `${eb.pending} por revisar, ${eb.approved} aprobados, ${eb.rejected} descartados`,
  )

  // --- Las cuentas y sus horarios -------------------------------------------
  const ficheroCuentas = leer<Account>('accounts')
  const baseCuentas = await store.accounts.all()
  check(
    'Numero de cuentas',
    ficheroCuentas.length === baseCuentas.length,
    `${baseCuentas.length}`,
  )

  const primeraF = ficheroCuentas[0]
  const primeraB = baseCuentas.find((c) => c.id === primeraF?.id)
  check(
    'Horarios de cuenta conservados',
    primeraF !== undefined &&
      primeraB !== undefined &&
      primeraF.slots.length === primeraB.slots.length &&
      primeraF.slots.every((h, i) => Math.abs(h - (primeraB.slots[i] ?? 0)) < 0.001),
    `${primeraB?.id}: [${primeraB?.slots.join(', ')}]`,
  )

  // --- El filtro por propietario de verdad filtra ---------------------------
  const otro = createStore(db, '22222222-2222-2222-2222-222222222222')
  const ajenos = await otro.clips.all()
  check(
    'Otro propietario no ve nada',
    ajenos.length === 0,
    `${ajenos.length} clips visibles para un propietario distinto`,
  )

  // --- Escribir y leer de vuelta --------------------------------------------
  const uno = baseClips[0]
  if (uno !== undefined) {
    const original = uno.status
    const cambiado = original === 'pending' ? 'rejected' : 'pending'

    await store.clips.setStatus(uno.sourceId, uno.clipId, cambiado)
    const releido = await store.clips.find(uno.sourceId, uno.clipId)
    const ok = releido?.status === cambiado

    // Se deja como estaba: esto es una comprobacion, no un cambio.
    await store.clips.setStatus(uno.sourceId, uno.clipId, original)
    const restaurado = await store.clips.find(uno.sourceId, uno.clipId)

    check('Escribir y releer un clip', ok, `${uno.clipId}: ${original} -> ${cambiado} -> ok`)
    check(
      'La comprobacion no dejo rastro',
      restaurado?.status === original,
      `${uno.clipId} sigue en ${restaurado?.status}`,
    )
  }
} finally {
  await db.close()
}

const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}
const fallos = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - fallos.length}/${checks.length} comprobaciones correctas`)
if (fallos.length > 0) process.exitCode = 1
