/**
 * Verificacion de la cola de tareas.
 *
 *   npm run verify:cola
 *
 * Comprueba lo que de verdad decide si el reparto entre servidor y PC funciona:
 * que dos trabajadores no se lleven la misma tarea, que una tarea abandonada
 * vuelva sola a la cola, y que no se reintente para siempre.
 *
 * Corre contra un Postgres de verdad en memoria (PGlite), no contra la base
 * real: crea y destruye tareas, y eso no debe tocar datos de produccion.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'
import type { Db } from '../src/store/db.js'
import { createCola } from '../src/jobs/cola.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const pg = new PGlite()
const db: Db = {
  query: async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}

for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}

const OWNER = '11111111-1111-1111-1111-111111111111'
await pg.exec(`insert into owners (id, email, label)
               values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)

const cola = createCola(db, OWNER)

// --- Encolar y coger --------------------------------------------------------
const a = await cola.encolar('render', ['vod-1'], 'Renderizar vod-1')
check('Encola una tarea', a.status === 'queued', `${a.id} en estado ${a.status}`)

const cogida = await cola.coger('pc-1')
check('El trabajador la coge', cogida?.id === a.id, `${cogida?.id} por ${cogida?.claimedBy}`)

const vacia = await cola.coger('pc-2')
check('No hay dos para la misma tarea', vacia === null, vacia === null ? 'nada que coger' : 'FALLO')

// --- Dos trabajadores a la vez sobre varias tareas ---------------------------
//
// Es el escenario que de verdad importa: dos PCs encendidos preguntando al
// mismo tiempo. Sin "for update skip locked" los dos se llevarian la misma.
for (let i = 0; i < 6; i += 1) {
  await cola.encolar('select', [`vod-${i}`], `Elegir momentos ${i}`)
}

const [lote1, lote2] = await Promise.all([
  Promise.all([cola.coger('pc-1'), cola.coger('pc-1'), cola.coger('pc-1')]),
  Promise.all([cola.coger('pc-2'), cola.coger('pc-2'), cola.coger('pc-2')]),
])

const cogidas = [...lote1, ...lote2].filter((j) => j !== null)
const ids = cogidas.map((j) => j?.id)
const unicos = new Set(ids)
check(
  'Seis tareas repartidas sin solaparse',
  cogidas.length === 6 && unicos.size === 6,
  `${cogidas.length} cogidas, ${unicos.size} distintas`,
)

// --- Latido y progreso ------------------------------------------------------
await cola.latir(a.id, 'Renderizando 3 de 16', ['linea 1', 'linea 2', 'Renderizando 3 de 16'])
const conProgreso = await cola.porId(a.id)
check(
  'El progreso llega al panel',
  conProgreso?.lastLine === 'Renderizando 3 de 16' && conProgreso.log.includes('linea 1'),
  `"${conProgreso?.lastLine}"`,
)

// --- Cancelar desde el panel ------------------------------------------------
const cancelada = await cola.cancelar(a.id)
const sigue = await cola.sigueViva(a.id)
check('Cancelar desde el panel', cancelada && !sigue, `el trabajador lo vera al latir`)

// --- Una tarea abandonada vuelve a la cola ----------------------------------
//
// Se simula un PC apagado: la tarea queda en marcha y su ultimo latido se
// retrasa en el tiempo.
const perdida = await cola.encolar('ingest', ['url'], 'Transcribir')
await cola.coger('pc-apagado')
await pg.exec(`update jobs set heartbeat_at = now() - interval '10 minutes'
               where id = '${perdida.id}'`)

const rescate = await cola.recuperarPerdidas()
const devuelta = await cola.porId(perdida.id)
check(
  'Una tarea abandonada vuelve a la cola',
  rescate.devueltas === 1 && devuelta?.status === 'queued',
  `${rescate.devueltas} devuelta(s), ahora en ${devuelta?.status}`,
)

// --- Pero no para siempre ---------------------------------------------------
for (let i = 0; i < 3; i += 1) {
  await cola.coger('pc-que-falla')
  await pg.exec(`update jobs set heartbeat_at = now() - interval '10 minutes'
                 where id = '${perdida.id}'`)
  await cola.recuperarPerdidas()
}
const rendida = await cola.porId(perdida.id)
check(
  'Deja de reintentar tras varios intentos',
  rendida?.status === 'error',
  `${rendida?.attemptCount} intentos, acabo en ${rendida?.status}`,
)

// --- Terminar y registrar ---------------------------------------------------
const final = await cola.encolar('doctor', [], 'Diagnostico')
await cola.coger('pc-1')
await cola.terminar(final.id, 'ok', 0, ['todo correcto'])
const hecha = await cola.porId(final.id)
check(
  'Cierra una tarea con su salida',
  hecha?.status === 'ok' && hecha.exitCode === 0 && hecha.log.includes('todo correcto'),
  `${hecha?.status}, codigo ${hecha?.exitCode}`,
)

// Una tarea que acaba antes del primer latido tambien debe dejar rastro.
check(
  'Una tarea corta deja ultima linea',
  hecha?.lastLine === 'todo correcto',
  `"${hecha?.lastLine}"`,
)

// --- Aislamiento por propietario --------------------------------------------
const otra = createCola(db, '22222222-2222-2222-2222-222222222222')
const ajenas = await otra.recientes()
check('Otro propietario no ve estas tareas', ajenas.length === 0, `${ajenas.length} visibles`)

await pg.close()

const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}
const fallos = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - fallos.length}/${checks.length} comprobaciones correctas`)
if (fallos.length > 0) process.exitCode = 1
