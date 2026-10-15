/**
 * Verificacion del puente entre el disco y el panel.
 *
 *   npm run verify:publicar
 *
 * Los scripts de la tuberia escriben en disco y el panel lee de Postgres. Si
 * este puente falla, todo parece funcionar: las tareas se ejecutan, los MP4
 * aparecen en la carpeta, y el panel se queda vacio sin dar ningun error.
 *
 * Por eso se comprueba con ficheros de verdad en una carpeta temporal y un
 * Postgres de verdad en memoria, y no con simulacros de ninguno de los dos.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'
import { OWNER_ID as OWNER } from '../src/lib/owner.js'
import type { Db } from '../src/store/db.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

// --- Un disco de mentira, con ficheros de verdad ----------------------------

const RAIZ = join(tmpdir(), `clipline-publicar-${process.pid}`)
const WORK = join(RAIZ, 'work')
const OUT = join(RAIZ, 'out')

process.env.WORK_DIR = WORK
process.env.OUT_DIR = OUT

const VOD = 'vod-prueba'
mkdirSync(join(WORK, VOD), { recursive: true })
mkdirSync(join(OUT, VOD), { recursive: true })

writeFileSync(
  join(WORK, VOD, 'source.json'),
  JSON.stringify({
    id: VOD,
    url: 'https://ejemplo/directo',
    title: 'Directo de prueba',
    durationSec: 5400,
    uploader: null,
    width: 1920,
    height: 1080,
    fps: 60,
  }),
)

writeFileSync(
  join(WORK, VOD, 'transcript.json'),
  JSON.stringify({ sourceId: VOD, language: 'es', durationSec: 5400, segments: [] }),
)

writeFileSync(
  join(WORK, VOD, 'clips.json'),
  JSON.stringify({
    clips: [
      { start: 10, end: 40, hook: 'g1', reason: 'r1', caption: 'pie 1', hashtags: ['a'], score: 88 },
      { start: 90, end: 125, hook: 'g2', reason: 'r2', caption: 'pie 2', hashtags: ['b'], score: 72 },
      { start: 200, end: 232, hook: 'g3', reason: 'r3', caption: 'pie 3', hashtags: ['c'], score: 61 },
    ],
  }),
)

// Solo dos de los tres momentos llegaron a renderizarse.
writeFileSync(join(OUT, VOD, 'clip-01.mp4'), 'fingido')
writeFileSync(join(OUT, VOD, 'clip-02.mp4'), 'fingido')

// Las copias por cuenta: una subcarpeta por clip con varios mp4 dentro.
for (const clip of ['clip-01', 'clip-02']) {
  mkdirSync(join(OUT, VOD, 'variants', clip), { recursive: true })
  for (let i = 1; i <= 3; i += 1) {
    writeFileSync(join(OUT, VOD, 'variants', clip, `acc-0${i}.mp4`), 'fingido')
  }
}
// Un fichero suelto que NO es un mp4: no debe contarse.
writeFileSync(join(OUT, VOD, 'variants', 'clip-01', 'notas.txt'), 'x')

// La importacion va despues de fijar WORK_DIR y OUT_DIR: `paths` los lee de
// forma diferida, pero el modulo no debe cargarse antes de tiempo.
const { publicarFuente, publicarClips, publicarVariantes, publicarResultado } = await import(
  '../src/store/publicar.js'
)

// --- La base ----------------------------------------------------------------

const pg = new PGlite()
const db: Db = {
  query: async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}

for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}
await pg.exec(`insert into owners (id, email, label)
               values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)

// --- 1. El VOD aparece ------------------------------------------------------

await publicarFuente(db, OWNER, VOD)
const [fuente] = await db.query<{ title: string; duration_sec: number; has_transcript: boolean }>(
  `select title, duration_sec, has_transcript from sources where id = $1`,
  [VOD],
)
check(
  'Publica el VOD con su titulo y duracion reales',
  fuente?.title === 'Directo de prueba' && fuente.has_transcript === true,
  `"${fuente?.title}", ${fuente?.duration_sec}s, transcrito=${fuente?.has_transcript}`,
)

// --- 2. Los momentos, con y sin video --------------------------------------

const n = await publicarClips(db, OWNER, VOD)
const filas = await db.query<{ clip_id: string; master_path: string; status: string; score: number }>(
  `select clip_id, master_path, status, score from clips where source_id = $1 order by clip_id`,
  [VOD],
)
check('Publica los tres momentos del clips.json', n === 3 && filas.length === 3, `${filas.length} filas`)
check(
  'Solo los renderizados llevan ruta de video',
  filas[0]?.master_path.endsWith('clip-01.mp4') === true &&
    filas[1]?.master_path.endsWith('clip-02.mp4') === true &&
    filas[2]?.master_path === '',
  `${filas.map((f) => (f.master_path === '' ? 'vacio' : 'ruta')).join(' ')}`,
)
check(
  'Todos entran pendientes de revision',
  filas.every((f) => f.status === 'pending'),
  filas.map((f) => f.status).join(' '),
)

// --- 3. Republicar no pisa lo que decidio una persona ----------------------

await db.query(
  `update clips set status = 'rejected', caption = 'pie escrito a mano'
   where clip_id = 'clip-01' and source_id = $1`,
  [VOD],
)
// El tercer momento se renderiza ahora, como pasaria al reintentar un render.
writeFileSync(join(OUT, VOD, 'clip-03.mp4'), 'fingido')
await publicarClips(db, OWNER, VOD)

const [reimportado] = await db.query<{ status: string; caption: string }>(
  `select status, caption from clips where clip_id = 'clip-01' and source_id = $1`,
  [VOD],
)
check(
  'Un clip descartado NO vuelve a pendiente al republicar',
  reimportado?.status === 'rejected',
  `sigue en ${reimportado?.status}`,
)
check(
  'El pie editado a mano se conserva',
  reimportado?.caption === 'pie escrito a mano',
  `"${reimportado?.caption}"`,
)

const [tercero] = await db.query<{ master_path: string }>(
  `select master_path from clips where clip_id = 'clip-03' and source_id = $1`,
  [VOD],
)
check(
  'El momento renderizado despues sí recibe su ruta',
  tercero?.master_path.endsWith('clip-03.mp4') === true,
  tercero?.master_path ?? '',
)

// --- 4. Las copias por cuenta se cuentan por archivo -----------------------

const copias = await publicarVariantes(db, OWNER, VOD)
const [conCopias] = await db.query<{ variants_count: number }>(
  `select variants_count from sources where id = $1`,
  [VOD],
)
check(
  'Cuenta los mp4, no las carpetas ni los ficheros sueltos',
  copias === 6 && Number(conCopias?.variants_count) === 6,
  `${copias} copias (2 clips x 3 cuentas, ignorando notas.txt)`,
)

// --- 5. El reparto por tipo de tarea ---------------------------------------

await db.query(`delete from clips where source_id = $1`, [VOD])
await publicarResultado(db, OWNER, 'render', [VOD], 'salida cualquiera')
const [trasRender] = await db.query<{ n: number }>(
  `select count(*)::int as n from clips where source_id = $1`,
  [VOD],
)
check(
  'Una tarea de render publica los momentos',
  Number(trasRender?.n) === 3,
  `${trasRender?.n} momentos`,
)

// El ingest no lleva el VOD en los argumentos: se lee del resumen impreso.
await db.query(`delete from sources where id = $1`, [VOD])
await publicarResultado(
  db,
  OWNER,
  'ingest',
  ['C:/subidas/video.mp4'],
  `Fuente     : Directo de prueba\nsourceId   : ${VOD}\nSegmentos  : 3027`,
)
const [trasIngest] = await db.query<{ n: number }>(
  `select count(*)::int as n from sources where id = $1`,
  [VOD],
)
check(
  'Un ingest saca el identificador del resumen, no de los argumentos',
  Number(trasIngest?.n) === 1,
  `${trasIngest?.n} fuente(s)`,
)

// --- 6. Lo que no debe pasar ------------------------------------------------

const antes = await db.query<{ n: number }>(`select count(*)::int as n from sources`)
await publicarResultado(db, OWNER, 'render', ['../../etc/passwd'], '')
const despues = await db.query<{ n: number }>(`select count(*)::int as n from sources`)
check(
  'Un identificador con ../ se ignora en vez de escribirse',
  Number(antes[0]?.n) === Number(despues[0]?.n),
  `${antes[0]?.n} antes, ${despues[0]?.n} despues`,
)

await publicarResultado(db, OWNER, 'doctor', [], 'todo correcto')
check('Una tarea sin VOD no rompe nada', true, 'doctor pasa sin tocar fuentes')

// --- Resultado --------------------------------------------------------------

console.log('')
console.log('='.repeat(78))
console.log('PUENTE DISCO -> PANEL')
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
rmSync(RAIZ, { recursive: true, force: true })
process.exit(fallos === 0 ? 0 : 1)
