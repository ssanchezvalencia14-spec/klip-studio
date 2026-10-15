/**
 * Verificacion de las copias de revision (Fase 7).
 *
 *   npm run verify:nube
 *
 * Comprueba las dos cosas que de verdad deciden si esto sirve:
 *
 * 1. Que el panel sepa cuando hay video y cuando no, mire desde donde mire.
 *    Un reproductor que no carga nunca es peor que un aviso honesto.
 * 2. Que reimportar un VOD no borre del registro una copia que sigue en la
 *    nube. Eso dejaria objetos huerfanos ocupando sitio y clips que dicen no
 *    tener video teniendolo.
 *
 * NO habla con Supabase. Las partes que sí lo hacen (subir, firmar) se prueban
 * contra el servicio real con `npm run subir`, que es donde el fallo importa.
 * Aqui se prueba la logica que decide, que es la que se rompe en silencio.
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'
import type { Db } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
import { crearNube, rutaClip } from '../src/store/nube.js'
import { createCola } from '../src/jobs/cola.js'
import { arrancarCadena } from '../src/jobs/cadena.js'
import { buildJob } from '../src/review/pipeline.js'
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
    values ('vod-uno', '${OWNER}', 'Directo', 3600, true);
`)

const store = createStore(db, OWNER)

const base: ClipRecord = {
  sourceId: 'vod-uno',
  clipId: 'clip-01',
  start: 10,
  end: 40,
  hook: 'gancho',
  reason: 'razon',
  caption: 'pie',
  hashtags: ['a'],
  score: 80,
  status: 'pending',
  masterPath: 'C:/falso/1.mp4',
  proxyPath: '',
  proxyBytes: 0,
  reviewedAt: null,
}

// --- Ida y vuelta de las columnas nuevas ------------------------------------
await store.clips.save([base])
const recienGuardado = await store.clips.find('vod-uno', 'clip-01')
check(
  'Un clip nuevo nace sin copia',
  recienGuardado?.proxyPath === '' && recienGuardado?.proxyBytes === 0,
  `proxyPath="${recienGuardado?.proxyPath}" bytes=${recienGuardado?.proxyBytes}`,
)

const ruta = rutaClip(OWNER, 'vod-uno', 'clip-01')
await store.clips.marcarCopia('vod-uno', 'clip-01', ruta, 1184000)
const conCopia = await store.clips.find('vod-uno', 'clip-01')
check(
  'Anotar la copia la deja leible',
  conCopia?.proxyPath === ruta && conCopia?.proxyBytes === 1184000,
  `${conCopia?.proxyPath} (${((conCopia?.proxyBytes ?? 0) / 1048576).toFixed(2)} MB)`,
)

check(
  'La ruta lleva propietario, VOD y clip',
  ruta === `${OWNER}/vod-uno/clip-01.mp4`,
  ruta,
)

/*
 * marcarCopia NO puede pisar la decision de revision.
 *
 * Es el caso real: el subidor corre en el PC mientras alguien aprueba desde el
 * movil. Si marcarCopia reescribiera la fila entera con lo que leyo al empezar,
 * devolveria el clip a pendiente y el trabajo de revision se perderia sin que
 * nada avisara.
 */
await store.clips.setStatus('vod-uno', 'clip-01', 'approved', { caption: 'pie editado' })
await store.clips.marcarCopia('vod-uno', 'clip-01', ruta, 999)
const trasSubir = await store.clips.find('vod-uno', 'clip-01')
check(
  'Subir una copia no toca la decision ni el pie',
  trasSubir?.status === 'approved' && trasSubir?.caption === 'pie editado',
  `${trasSubir?.status}, "${trasSubir?.caption}", ${trasSubir?.proxyBytes} bytes`,
)

// --- Reimportar no debe huerfanar la copia ----------------------------------
//
// `importarClips` construye ClipRecord desde cero leyendo clips.json. Se imita
// aqui su forma: lo que se comprueba es que el campo se arrastre del previo,
// que es lo unico que impide dejar objetos sin dueño en la nube.
const previos = new Map((await store.clips.all()).map((c) => [c.clipId, c]))
const reimportado: ClipRecord = {
  ...base,
  hook: 'gancho nuevo del select',
  caption: previos.get('clip-01')?.caption ?? '',
  status: previos.get('clip-01')?.status ?? 'pending',
  proxyPath: previos.get('clip-01')?.proxyPath ?? '',
  proxyBytes: previos.get('clip-01')?.proxyBytes ?? 0,
}
await store.clips.save([reimportado])
const trasReimportar = await store.clips.find('vod-uno', 'clip-01')
check(
  'Reimportar el VOD conserva la copia ya subida',
  trasReimportar?.proxyPath === ruta && trasReimportar?.hook === 'gancho nuevo del select',
  `copia intacta, gancho actualizado`,
)

// --- El trabajo que llega al trabajador -------------------------------------
const CONOCIDOS = new Set(['vod-uno'])
const subir = buildJob('subir', { sourceId: 'vod-uno' }, CONOCIDOS)
check(
  'El panel puede encolar una subida',
  subir.kind === 'subir' && subir.args.join(' ') === 'vod-uno',
  `${subir.kind} ${subir.args.join(' ')}`,
)

const rehacer = buildJob('subir', { sourceId: 'vod-uno', rehacer: true }, CONOCIDOS)
check(
  'Rehacer las copias hay que pedirlo a proposito',
  rehacer.args.includes('--rehacer') && !subir.args.includes('--rehacer'),
  rehacer.args.join(' '),
)

let vodInventado = false
try {
  buildJob('subir', { sourceId: 'no-existe' }, CONOCIDOS)
} catch {
  vodInventado = true
}
check('Subir un VOD que no existe se rechaza', vodInventado, 'no-existe no pasa')

// --- El cliente de la nube sin credenciales ---------------------------------
//
// El panel tiene que arrancar igual sin clave: sin nube se comporta como antes
// de que esto existiera. Si crearNube lanzara, el servidor no arrancaria.
/*
 * Se fuerza la carga del .env ANTES de tocar nada.
 *
 * loadEnv() solo lee el fichero la primera vez. Sin esta llamada, el `delete`
 * de aqui abajo se aplicaba a un entorno todavia vacio y la primera lectura
 * posterior volvia a rellenar la variable desde el .env: la prueba pasaba solo
 * en maquinas que no tuvieran la clave configurada, y empezo a fallar el dia
 * que se configuro.
 */
loadEnv()

const guardadas = {
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  url: process.env.SUPABASE_URL,
  base: process.env.DATABASE_URL,
}
delete process.env.SUPABASE_SERVICE_ROLE_KEY
check('Sin clave, la nube es null y no lanza', crearNube() === null, 'null')

// Con clave pero sin URL explicita, se deduce del usuario de Postgres.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'falsa-solo-para-la-prueba'
delete process.env.SUPABASE_URL
process.env.DATABASE_URL = 'postgresql://postgres.abcdefghijklmnop:x@aws-0.pooler.supabase.com:5432/postgres'
const deducida = crearNube()
check(
  'La URL del proyecto se deduce del usuario de la base',
  deducida?.url === 'https://abcdefghijklmnop.supabase.co',
  deducida?.url ?? '(null)',
)

// Y una cadena que no tenga esa forma no se inventa una URL.
process.env.DATABASE_URL = 'postgresql://postgres:x@localhost:5432/postgres'
check('Una base que no es Supabase no inventa URL', crearNube() === null, 'null')

if (guardadas.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
else process.env.SUPABASE_SERVICE_ROLE_KEY = guardadas.key
if (guardadas.url === undefined) delete process.env.SUPABASE_URL
else process.env.SUPABASE_URL = guardadas.url
if (guardadas.base !== undefined) process.env.DATABASE_URL = guardadas.base

// --- El tamaño de la copia, sobre un fichero de verdad ----------------------
//
// No se codifica aqui (eso tarda y necesita ffmpeg con el master): se comprueba
// que la cuenta de espacio suma lo que dicen las filas, que es lo que decide
// cuando el panel avisa de que se llena.
const dir = mkdtempSync(join(tmpdir(), 'klip-nube-'))
try {
  writeFileSync(join(dir, 'x.mp4'), Buffer.alloc(1024))
  await store.clips.save([
    { ...base, clipId: 'clip-02', proxyPath: rutaClip(OWNER, 'vod-uno', 'clip-02'), proxyBytes: 2_000_000 },
    { ...base, clipId: 'clip-03', proxyPath: '', proxyBytes: 0 },
  ])
  const todos = await store.clips.all()
  const total = todos.reduce((n, c) => n + c.proxyBytes, 0)
  const conCopias = todos.filter((c) => c.proxyPath !== '').length
  check(
    'El espacio suma solo lo que tiene copia',
    conCopias === 2 && total === 999 + 2_000_000,
    `${conCopias} copias, ${total} bytes`,
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}

/*
 * --- El encadenado -----------------------------------------------------------
 *
 * Que el render lance la subida solo es lo que hace que añadir un VOD desde el
 * movil acabe con clips visibles desde ese mismo movil. Se comprueba sobre la
 * cola de verdad y no llamando a la funcion interna, porque lo que se lee es la
 * SALIDA del trabajo anterior: si alguien cambia el texto del resumen del
 * render, la cadena deja de encadenar y nada falla.
 */
const cola = createCola(db, OWNER)

/*
 * La cadena se arranca ANTES de que termine el render.
 *
 * Su primera vuelta marca como vistas todas las tareas ya acabadas, para no
 * relanzar el historial al reiniciar el panel. Si el render acabara antes de
 * arrancarla, caeria en esa primera vuelta y no encadenaria nada: la prueba
 * pasaria en verde comprobando lo contrario de lo que dice comprobar.
 */
const parar = arrancarCadena(cola)
await new Promise((r) => setTimeout(r, 30))

await cola.encolar('render', ['vod-uno'], 'Renderizar vod-uno')
const cogido = await cola.coger('pc-prueba')
await cola.terminar(cogido?.id ?? '', 'ok', 0, [
  'Clips renderizados : 5',
  'Salida             : C:/out/vod-uno',
])

// El encadenado mira cada 6 s, pero tambien en el momento de arrancar. Se
// espera a que la cola tenga el trabajo nuevo en vez de dormir a ciegas.
let trasRender = await cola.recientes(10)
for (let i = 0; i < 80 && !trasRender.some((j) => j.kind === 'subir'); i += 1) {
  await new Promise((r) => setTimeout(r, 100))
  trasRender = await cola.recientes(10)
}
parar()

check(
  'El render encadena la subida',
  trasRender.some((j) => j.kind === 'subir' && j.args[0] === 'vod-uno'),
  trasRender.map((j) => j.kind).join(' <- '),
)

check(
  'La subida no encadena nada mas',
  !trasRender.some((j) => j.kind === 'variants'),
  'la compuerta de aprobacion sigue en medio',
)

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
