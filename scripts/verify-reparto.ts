/**
 * Verificacion del reparto automatico tras la compuerta.
 *
 *   npm run verify:reparto
 *
 * Lo que de verdad decide si esto sirve es CUANDO dispara y cuando NO. Que
 * reparta cuando toca se ve a simple vista; que no reparta cuando no toca es
 * invisible hasta que genera trabajo basura, y eso ya paso: el 2026-10-05 un
 * VOD con los 15 clips descartados encolo cinco veces unas variantes que no
 * podian salir bien.
 *
 * Contra PGlite en memoria, no contra la base de produccion. Un script de
 * verificacion que escribe en la base real es una bomba: el 2026-10-04,
 * verify-proyectos borro la campaña de tres canciones de ZOTI por reutilizar
 * filas de verdad para sus pruebas.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'
import type { Db } from '../src/store/db.js'
import { createCola } from '../src/jobs/cola.js'
import { createStore } from '../src/store/pg.js'
import { repartirSiToca } from '../src/jobs/reparto.js'
import type { ClipRecord } from '../src/store/store.js'

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
await pg.exec(`
  insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo');
  insert into sources (id, owner_id, title, duration_sec, has_transcript)
    values ('vod-mixto', '${OWNER}', 'Mitad y mitad', 600, true),
           ('vod-todo-no', '${OWNER}', 'Todo descartado', 600, true),
           ('vod-listo', '${OWNER}', 'Listo para repartir', 600, true);
`)

const store = createStore(db, OWNER)
const cola = createCola(db, OWNER)

const clip = (sourceId: string, n: number, status: ClipRecord['status']): ClipRecord => ({
  sourceId,
  clipId: `clip-${String(n).padStart(2, '0')}`,
  start: n * 10,
  end: n * 10 + 30,
  hook: 'gancho',
  reason: 'razon',
  caption: 'pie',
  hashtags: ['a'],
  score: 80,
  status,
  masterPath: `C:/falso/${sourceId}-${n}.mp4`,
  proxyPath: '',
  proxyBytes: 0,
  reviewedAt: null,
})

await store.clips.save([
  // Dos aprobados y uno todavia sin mirar.
  clip('vod-mixto', 1, 'approved'),
  clip('vod-mixto', 2, 'approved'),
  clip('vod-mixto', 3, 'pending'),
  // Revisado entero y descartado entero.
  clip('vod-todo-no', 1, 'rejected'),
  clip('vod-todo-no', 2, 'rejected'),
  // Revisado entero con material util.
  clip('vod-listo', 1, 'approved'),
  clip('vod-listo', 2, 'rejected'),
  clip('vod-listo', 3, 'approved'),
])

const encoladas = async (sourceId: string): Promise<number> => {
  const r = await db.query<{ n: string }>(
    `select count(*)::text n from jobs where owner_id = $1 and args[1] = $2`,
    [OWNER, sourceId],
  )
  return Number(r[0]?.n ?? '0')
}

// --- Todavia queda algo por mirar: no se toca nada --------------------------
const mixto = await repartirSiToca(db, cola, OWNER, 'vod-mixto')
check(
  'Con clips pendientes no reparte',
  !mixto.encolado && mixto.motivo === 'quedan-pendientes' && (await encoladas('vod-mixto')) === 0,
  `encolado=${mixto.encolado} motivo=${mixto.motivo} tareas=${await encoladas('vod-mixto')}`,
)

// --- Revisado entero pero sin nada aprobado ---------------------------------
const todoNo = await repartirSiToca(db, cola, OWNER, 'vod-todo-no')
check(
  'Con todo descartado no encola trabajo imposible',
  !todoNo.encolado && todoNo.motivo === 'nada-aprobado' && (await encoladas('vod-todo-no')) === 0,
  `encolado=${todoNo.encolado} motivo=${todoNo.motivo} tareas=${await encoladas('vod-todo-no')}`,
)

// --- El caso bueno ----------------------------------------------------------
const listo = await repartirSiToca(db, cola, OWNER, 'vod-listo')
check(
  'Revisado entero y con aprobados, reparte solo',
  listo.encolado && listo.aprobados === 2 && (await encoladas('vod-listo')) === 1,
  `encolado=${listo.encolado} aprobados=${listo.aprobados} tareas=${await encoladas('vod-listo')}`,
)

const tarea = await db.query<{ kind: string; label: string }>(
  `select kind, label from jobs where owner_id = $1 and args[1] = 'vod-listo'`,
  [OWNER],
)
check(
  'La tarea encolada son las copias por cuenta',
  tarea[0]?.kind === 'variants',
  `kind=${tarea[0]?.kind ?? '(ninguna)'} label="${tarea[0]?.label ?? ''}"`,
)

// --- Volver a aprobar no duplica el reparto ---------------------------------
const otraVez = await repartirSiToca(db, cola, OWNER, 'vod-listo')
check(
  'Aprobar otra vez no encola un segundo reparto',
  !otraVez.encolado && otraVez.motivo === 'ya-en-marcha' && (await encoladas('vod-listo')) === 1,
  `motivo=${otraVez.motivo} tareas=${await encoladas('vod-listo')}`,
)

/*
 * Y cuando el reparto ya termino, tampoco.
 *
 * `hayActiva` solo mira las tareas en cola o corriendo. Si el reparto acabo y
 * alguien vuelve a tocar la compuerta, encolar otra tanda seria correcto en
 * principio, pero las copias ya existen: lo que importa es que no se encole
 * mientras hay una en marcha, que es la ventana donde se duplicaria trabajo.
 */
await db.query(`update jobs set status = 'ok', ended_at = now() where owner_id = $1`, [OWNER])
const trasTerminar = await repartirSiToca(db, cola, OWNER, 'vod-listo')
check(
  'Con el reparto ya terminado se puede volver a lanzar',
  trasTerminar.encolado && (await encoladas('vod-listo')) === 2,
  `encolado=${trasTerminar.encolado} tareas=${await encoladas('vod-listo')}`,
)

await db.close()

console.log('')
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLA'} ${c.name}`)
  if (!c.ok) console.log(`        ${c.detail}`)
}
const malos = checks.filter((c) => !c.ok).length
console.log('')
console.log(`${checks.length - malos} de ${checks.length} comprobaciones pasan.`)
if (malos > 0) process.exitCode = 1
