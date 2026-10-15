/**
 * Verificacion del esquema de base de datos.
 *
 *   npm run verify:schema
 *
 * Levanta un Postgres de verdad en memoria (PGlite es Postgres compilado a
 * WebAssembly, no una imitacion), aplica el esquema y comprueba lo que de
 * verdad puede fallar: que las restricciones rechacen lo que deben rechazar.
 *
 * Un esquema que solo se ha "leido y parece bien" no esta verificado. Las
 * restricciones o funcionan o no, y eso se sabe intentando saltarselas.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

/** Espera que la consulta falle. Si pasa, la restriccion no protege nada. */
async function debeFallar(db: PGlite, sql: string, motivo: string): Promise<void> {
  try {
    await db.exec(sql)
    check(motivo, false, 'la base de datos lo acepto, y no deberia')
  } catch (error) {
    const msg = (error as Error).message.split('\n')[0] ?? ''
    check(motivo, true, msg.slice(0, 68))
  }
}

const db = new PGlite()

// --- El esquema se aplica limpio -------------------------------------------
const sql = readFileSync(join(ROOT, 'db', '001-esquema.sql'), 'utf8')
try {
  await db.exec(sql)
  check('El esquema se aplica sin errores', true, `${sql.split('\n').length} lineas`)
} catch (error) {
  check('El esquema se aplica sin errores', false, (error as Error).message.slice(0, 70))
  console.log('\nEl esquema no se pudo aplicar. Sin eso el resto no significa nada.\n')
  for (const c of checks) console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name}  ${c.detail}`)
  process.exitCode = 1
  throw new Error('esquema invalido')
}

// --- Todas las tablas existen ----------------------------------------------
const esperadas = [
  'owners', 'sources', 'accounts', 'clips', 'queue',
  'posts', 'metrics', 'runs', 'settings', 'jobs',
]
const tablas = await db.query<{ table_name: string }>(
  `select table_name from information_schema.tables where table_schema = 'public'`,
)
const nombres = new Set(tablas.rows.map((r) => r.table_name))
const faltan = esperadas.filter((t) => !nombres.has(t))
check('Estan las diez tablas', faltan.length === 0, faltan.length ? `faltan: ${faltan}` : 'todas')

// --- Datos de partida -------------------------------------------------------
await db.exec(`
  insert into owners (id, email, label)
  values ('11111111-1111-1111-1111-111111111111', 'yo@ejemplo.com', 'Yo');
  insert into sources (id, owner_id, title, duration_sec)
  values ('vod-1', '11111111-1111-1111-1111-111111111111', 'Directo de prueba', 7688);
`)
check('Acepta un propietario y un video', true, 'insertados')

// --- Las restricciones protegen de verdad -----------------------------------

await debeFallar(
  db,
  `insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, status)
   values ('11111111-1111-1111-1111-111111111111', 'vod-1', 'clip-01', 0, 20, 'aprobadisimo')`,
  'Rechaza un estado de clip inventado',
)

await debeFallar(
  db,
  `insert into clips (owner_id, source_id, clip_id, start_sec, end_sec)
   values ('11111111-1111-1111-1111-111111111111', 'vod-fantasma', 'clip-01', 0, 20)`,
  'Rechaza un clip de un video que no existe',
)

await debeFallar(
  db,
  `insert into sources (id, owner_id, title)
   values ('vod-2', '99999999-9999-9999-9999-999999999999', 'De nadie')`,
  'Rechaza un video sin propietario valido',
)

await debeFallar(
  db,
  `insert into accounts (id, owner_id, label, status)
   values ('acc-01', '11111111-1111-1111-1111-111111111111', 'Cuenta 1', 'dormida')`,
  'Rechaza un estado de cuenta inventado',
)

// Dos variantes con el mismo checksum en la misma cuenta serian el mismo
// archivo subido dos veces, que es lo que las variantes evitan.
await db.exec(`
  insert into accounts (id, owner_id, label) values
    ('acc-01', '11111111-1111-1111-1111-111111111111', 'Cuenta 1');
  insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path, checksum, scheduled_at)
  values ('q1', '11111111-1111-1111-1111-111111111111', 'vod-1', 'clip-01', 'acc-01', '/a.mp4', 'abc123', now());
`)
await debeFallar(
  db,
  `insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path, checksum, scheduled_at)
   values ('q2', '11111111-1111-1111-1111-111111111111', 'vod-1', 'clip-02', 'acc-01', '/b.mp4', 'abc123', now())`,
  'Rechaza dos variantes identicas en una cuenta',
)

// --- Borrar en cascada ------------------------------------------------------
await db.exec(`delete from sources where id = 'vod-1'`)
const restantes = await db.query<{ n: number }>(`select count(*)::int as n from clips`)
check(
  'Borrar un video arrastra sus clips',
  restantes.rows[0]?.n === 0,
  `${restantes.rows[0]?.n} clips restantes`,
)

// --- Los ajustes traen los valores de siempre -------------------------------
await db.exec(`insert into settings (owner_id) values ('11111111-1111-1111-1111-111111111111')`)
const ajustes = await db.query<{
  accounts: number
  posts_per_day: number
  clip_cooldown_minutes: number
}>(`select accounts, posts_per_day, clip_cooldown_minutes from settings`)
const a = ajustes.rows[0]
check(
  'Los ajustes nacen con los valores de siempre',
  a?.accounts === 20 && a?.posts_per_day === 3 && a?.clip_cooldown_minutes === 90,
  `${a?.accounts} cuentas, ${a?.posts_per_day}/dia, ${a?.clip_cooldown_minutes} min`,
)

// --- Reporte ----------------------------------------------------------------
await db.close()

const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}
const fallos = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - fallos.length}/${checks.length} comprobaciones correctas`)
if (fallos.length > 0) process.exitCode = 1
