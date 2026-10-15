/**
 * Aplica el esquema a la base de datos y crea el propietario.
 *
 *   npm run db:setup
 *
 * Lee la cadena de conexion de DATABASE_URL. Es idempotente: el esquema usa
 * "create table if not exists" en todas partes, asi que ejecutarlo dos veces no
 * rompe nada ni borra datos.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, requireEnv, ROOT } from '../src/lib/env.js'
import { connect } from '../src/store/db.js'

loadEnv()

const url = requireEnv('DATABASE_URL')
const host = new URL(url).hostname
console.log(`Conectando a ${host}...`)

const db = await connect(url)

try {
  const version = await db.query<{ version: string }>('select version()')
  console.log(`  ${String(version[0]?.version).split(',')[0]}`)

  // Se aplican en orden. Cada uno usa 'if not exists', asi que repetirlos
  // no rompe nada ni borra datos.
  for (const fichero of readdirSync(join(ROOT, 'db')).filter((f) => f.endsWith('.sql')).sort()) {
    await db.query(readFileSync(join(ROOT, 'db', fichero), 'utf8'))
    console.log(`  Aplicado ${fichero}`)
  }

  const tablas = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema = 'public' order by table_name`,
  )
  console.log(`  Tablas: ${tablas.map((t) => t.table_name).join(', ')}`)

  /*
   * El propietario unico.
   *
   * Se crea con un identificador fijo y no aleatorio para que la migracion y
   * el panel puedan referirse a el sin tener que leerlo de ningun sitio. El dia
   * que entren clientes, este deja de ser el unico y pasa a ser uno mas.
   */
  const OWNER = '11111111-1111-1111-1111-111111111111'
  await db.query(
    `insert into owners (id, email, label) values ($1, $2, $3)
     on conflict (id) do nothing`,
    [OWNER, requireEnv('OWNER_EMAIL'), 'Propietario'],
  )
  await db.query(`insert into settings (owner_id) values ($1) on conflict do nothing`, [OWNER])

  const o = await db.query<{ email: string }>(`select email from owners where id = $1`, [OWNER])
  console.log(`  Propietario: ${o[0]?.email}`)
  console.log('')
  console.log('Listo. Ahora: npm run db:migrate')
} finally {
  await db.close()
}
