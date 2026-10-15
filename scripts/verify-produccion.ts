/**
 * Comprobaciones contra la base REAL, en modo solo lectura.
 *
 *   npm run verify:produccion
 *
 * Existe porque PGlite no es identica al Postgres real. Se descubrio con las
 * columnas jsonb: pasarles una cadena funciona en PGlite y produce un objeto,
 * y en el Postgres real produce una CADENA JSON doblemente codificada. Las 34
 * comprobaciones sobre PGlite pasaban mientras las 19 pasadas de produccion
 * estaban corruptas y el panel habria pintado basura.
 *
 * Aqui no se escribe nada. Solo se mira que lo que hay guardado tenga la forma
 * que el panel espera.
 */
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { connect } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
import { createRunsStore } from '../src/store/runs-pg.js'
import { loadSettingsDb } from '../src/queue/settings.js'

loadEnv()

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const db = await connect(requireEnv('DATABASE_URL'))

// --- Las columnas jsonb guardan objetos, no cadenas -------------------------

const malCodificadas = await db.query<{ tabla: string; n: number }>(
  `select 'runs.input' as tabla, count(*)::int as n from runs where jsonb_typeof(input) <> 'object'
   union all
   select 'runs.output', count(*)::int from runs where jsonb_typeof(output) <> 'object'
   union all
   select 'queue.params', count(*)::int from queue where jsonb_typeof(params) <> 'object'`,
)
const sucias = malCodificadas.filter((r) => Number(r.n) > 0)
check(
  'Ninguna columna jsonb guarda una cadena en vez de un objeto',
  sucias.length === 0,
  sucias.length === 0
    ? 'runs.input, runs.output y queue.params son objetos'
    : sucias.map((r) => `${r.tabla}: ${r.n} mal`).join(', '),
)

// --- El panel puede leerlo todo sin romperse -------------------------------

const store = createStore(db, OWNER_ID)
const diario = createRunsStore(db, OWNER_ID)

const pasadas = await diario.recientes(60)
check(
  'El diario devuelve pares legibles, no texto suelto',
  pasadas.every(
    (r) =>
      typeof r.input === 'object' && r.input !== null && !Array.isArray(r.input) &&
      typeof r.output === 'object' && r.output !== null,
  ),
  `${pasadas.length} pasadas, ejemplo: ${JSON.stringify(pasadas[0]?.output ?? {})}`,
)

const resumen = await diario.resumen()
check(
  'Los totales del diario cuadran con las pasadas',
  resumen.count === pasadas.length || pasadas.length === 60,
  `${resumen.count} pasadas, $${resumen.costUsd.toFixed(4)}`,
)

const fuentes = await store.sources.all()
const clips = await store.clips.all()
check(
  'Cada VOD cuenta los momentos que de verdad tiene',
  fuentes.every(
    (f) => f.clips === clips.filter((c) => c.sourceId === f.sourceId).length,
  ),
  fuentes.map((f) => `${f.sourceId}=${f.clips}`).join(' '),
)

const huerfanos = clips.filter((c) => !fuentes.some((f) => f.sourceId === c.sourceId))
check(
  'Ningun momento apunta a un VOD que no existe',
  huerfanos.length === 0,
  `${huerfanos.length} huerfanos`,
)

const ajustes = await loadSettingsDb(db, OWNER_ID)
check(
  'Los ajustes tienen valores utiles',
  ajustes.dayEndHour > ajustes.dayStartHour && ajustes.accounts > 0,
  `${ajustes.accounts} cuentas, ${ajustes.dayStartHour}-${ajustes.dayEndHour}h`,
)

const cuentas = await store.accounts.all()
check(
  'Las cuentas tienen las franjas que piden los ajustes',
  cuentas.length === 0 ||
    cuentas.filter((c) => c.status === 'active').every((c) => c.slots.length === ajustes.postsPerDay),
  `${cuentas.length} cuentas, ${cuentas[0]?.slots.length ?? 0} franjas cada una`,
)

// --- Resultado --------------------------------------------------------------

console.log('')
console.log('='.repeat(78))
console.log('BASE REAL (solo lectura)')
console.log('='.repeat(78))
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLA'} ${c.name}`)
  console.log(`        ${c.detail}`)
}

const fallos = checks.filter((c) => !c.ok).length
console.log('')
console.log(`${checks.length - fallos}/${checks.length} comprobaciones pasan.`)
console.log('')

await db.close()
process.exit(fallos === 0 ? 0 : 1)
