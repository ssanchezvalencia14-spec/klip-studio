/**
 * Respaldos de la base de datos (Fase 8).
 *
 * Un fichero por dia, `klip-AAAA-MM-DD.json.gz`, con todas las tablas. Sin
 * pg_dump: no esta en el PC con Windows y obligaria a instalar el cliente de
 * Postgres de la misma version que Supabase. Se lee tabla a tabla con la misma
 * conexion que usa todo lo demas.
 *
 * El trabajador lo hace solo una vez al dia (src/jobs/sistema.ts), guarda los
 * ultimos 14 en RESPALDOS_DIR (respaldos/ por defecto, fuera de git) y, si hay
 * Supabase Storage, sube una copia al cubo privado: un respaldo que vive solo
 * en el mismo PC no sobrevive a que se rompa el disco.
 *
 * OJO: el fichero contiene datos sensibles (correos, huellas de contraseñas,
 * permisos de TikTok). Se trata como el .env: no se comparte ni se sube a git.
 *
 * Restaurar es aditivo: inserta lo que falte y no pisa nada (on conflict do
 * nothing), en el orden de las claves foraneas. Sirve para una base vacia
 * recien migrada o para recuperar filas borradas.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Db } from './db.js'

/** Tablas que no se respaldan: sesiones abiertas e intentos de acceso. Caducan solas. */
export const SIN_RESPALDO = new Set(['sesiones', 'intentos_acceso'])

export const CONSERVAR = 14

export interface Respaldo {
  version: 1
  fecha: string
  tablas: Record<string, Record<string, unknown>[]>
}

/** Las tablas en orden de dependencias: las referenciadas antes. */
export async function tablasOrdenadas(db: Db): Promise<string[]> {
  const tablas = (
    await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`,
    )
  ).map((t) => t.table_name).filter((t) => !SIN_RESPALDO.has(t) && !t.startsWith('_'))

  const deps = await db.query<{ hija: string; madre: string }>(
    `select tc.table_name as hija, ccu.table_name as madre
       from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  )
  const madres = new Map<string, Set<string>>(tablas.map((t) => [t, new Set()]))
  for (const d of deps) if (d.hija !== d.madre && madres.has(d.hija) && madres.has(d.madre)) madres.get(d.hija)!.add(d.madre)

  const orden: string[] = []
  const hecho = new Set<string>()
  const visitar = (t: string, camino: Set<string>): void => {
    if (hecho.has(t) || camino.has(t)) return
    camino.add(t)
    for (const m of madres.get(t) ?? []) visitar(m, camino)
    camino.delete(t)
    hecho.add(t)
    orden.push(t)
  }
  for (const t of tablas) visitar(t, new Set())
  return orden
}

/** Lee todas las tablas. */
export async function volcar(db: Db, ahora = new Date()): Promise<Respaldo> {
  const tablas: Respaldo['tablas'] = {}
  for (const t of await tablasOrdenadas(db)) {
    tablas[t] = await db.query<Record<string, unknown>>(`select * from "${t}"`)
  }
  return { version: 1, fecha: ahora.toISOString(), tablas }
}

export function dirRespaldos(): string {
  return process.env.RESPALDOS_DIR && process.env.RESPALDOS_DIR.trim() !== ''
    ? process.env.RESPALDOS_DIR
    : join(process.cwd(), 'respaldos')
}

/** Escribe el respaldo del dia y borra los que pasan de CONSERVAR. */
export async function respaldar(
  db: Db,
  dir = dirRespaldos(),
  ahora = new Date(),
): Promise<{ fichero: string; nombre: string; tablas: number; filas: number; kb: number }> {
  mkdirSync(dir, { recursive: true })
  const r = await volcar(db, ahora)
  const nombre = `klip-${ahora.toISOString().slice(0, 10)}.json.gz`
  const fichero = join(dir, nombre)
  writeFileSync(fichero, gzipSync(JSON.stringify(r)))

  const viejos = readdirSync(dir).filter((f) => /^klip-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort().reverse()
  for (const v of viejos.slice(CONSERVAR)) rmSync(join(dir, v), { force: true })

  return {
    fichero,
    nombre,
    tablas: Object.keys(r.tablas).length,
    filas: Object.values(r.tablas).reduce((n, filas) => n + filas.length, 0),
    kb: Math.round(statSync(fichero).size / 1024),
  }
}

export function leerRespaldo(fichero: string): Respaldo {
  if (!existsSync(fichero)) throw new Error('No existe ese fichero de respaldo.')
  const r = JSON.parse(gunzipSync(readFileSync(fichero)).toString('utf8')) as Respaldo
  if (r.version !== 1 || typeof r.tablas !== 'object') throw new Error('El fichero no es un respaldo de KLIP studio.')
  return r
}

/**
 * Restaura sin pisar nada: on conflict do nothing, tabla a tabla en orden de
 * dependencias. json_populate_recordset convierte cada campo al tipo de su
 * columna, asi que fechas, jsonb y arrays vuelven tal cual.
 */
export async function restaurar(db: Db, r: Respaldo): Promise<{ tabla: string; insertadas: number }[]> {
  const existentes = new Set(await tablasOrdenadas(db))
  const orden = (await tablasOrdenadas(db)).filter((t) => t in r.tablas)
  const out: { tabla: string; insertadas: number }[] = []
  for (const t of orden) {
    if (!existentes.has(t)) continue
    const filas = r.tablas[t] ?? []
    let insertadas = 0
    // De 500 en 500: un solo parametro JSON enorme no cabe en todas partes.
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500)
      const res = await db.query<{ n: number }>(
        `with nuevas as (
           insert into "${t}" select * from json_populate_recordset(null::"${t}", $1::json)
           on conflict do nothing returning 1
         ) select count(*)::int as n from nuevas`,
        [JSON.stringify(lote)],
      )
      insertadas += Number(res[0]?.n ?? 0)
    }
    // Las secuencias (ids bigserial) siguen por donde iban.
    const seqs = await db.query<{ columna: string }>(
      `select column_name as columna from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_default like 'nextval(%'`,
      [t],
    )
    for (const s of seqs) {
      await db.query(
        `select setval(pg_get_serial_sequence('"${t}"', $1), greatest(coalesce((select max("${s.columna}") from "${t}"), 0), 1))`,
        [s.columna],
      )
    }
    out.push({ tabla: t, insertadas })
  }
  return out
}
