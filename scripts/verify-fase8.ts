/**
 * Verificacion de la Fase 8: seguridad y respaldos.
 *
 *   npm run verify:fase8
 *
 * 1. Cabeceras (CSP con huella, frames, nosniff) contra el panel de verdad
 * 2. Limite de peticiones
 * 3. Enlaces de descarga firmados y con caducidad
 * 4. Auditoria sin secretos
 * 5. Respaldo y restauracion de la base
 * 6. Nada tecnico a la vista
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

process.env.KLIP_SIN_LOGIN = '1'
delete process.env.PANEL_REMOTO
const { loadEnv, ROOT } = await import('../src/lib/env.js')
loadEnv()
process.env.KLIP_SIN_LOGIN = '1'

const seg = await import('../src/review/seguridad.js')
const { SCRIPT_PANEL } = await import('../src/review/page.js')
const { startReviewServer } = await import('../src/review/server.js')
const { respaldar, leerRespaldo, restaurar } = await import('../src/store/respaldo.js')
const { limpiarRutas } = await import('../src/lib/limpiar.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }

async function baseNueva() {
  const pg = new PGlite()
  for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
  return { pg, db: { query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[], close: async () => pg.close() } }
}
const OWNER = '11111111-1111-1111-1111-111111111111'
const { pg, db } = await baseNueva()
await pg.exec(`insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo');
  insert into sources (id, owner_id, title) values ('vod-1', '${OWNER}', 'Uno');
  insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, hook, reason, caption, hashtags, score, status, master_path)
    values ('${OWNER}', 'vod-1', 'clip-01', 1, 30, 'h', 'r', 'c', '{a}', 80, 'pending', '');`)

// --- 1. Cabeceras ---------------------------------------------------------------------------

const PORT = 4400 + Math.floor(Math.random() * 90)
startReviewServer({ port: PORT, db, ownerId: OWNER })
const BASE = `http://localhost:${PORT}`
for (let i = 0; i < 50; i += 1) {
  try { await fetch(BASE + '/api/yo'); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}
const pagina = await fetch(BASE + '/')
const html = await pagina.text()
const csp = pagina.headers.get('content-security-policy') ?? ''
const servido = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
check('Cabeceras: CSP sin unsafe-inline para scripts', csp.includes("script-src 'self' 'sha256-") && !/script-src[^;]*unsafe-inline/.test(csp), csp.slice(0, 120))
check('Cabeceras: la huella de la CSP es la del script que se sirve', csp.includes(seg.huellaScript(servido)) && servido === SCRIPT_PANEL)
check(
  'Cabeceras: el script no lleva caracteres que el navegador cambie (NUL, CR)',
  !/[\0\r]/.test(SCRIPT_PANEL),
  `NUL ${(SCRIPT_PANEL.match(/\0/g) ?? []).length}`,
)
check('Cabeceras: solo un <script> en línea en la página', (html.match(/<script/g) ?? []).length === 1)
check(
  'Cabeceras: frames, nosniff, referrer y permisos',
  pagina.headers.get('x-frame-options') === 'DENY' && pagina.headers.get('x-content-type-options') === 'nosniff' &&
    pagina.headers.get('referrer-policy') !== null && (pagina.headers.get('permissions-policy') ?? '').includes('camera=()') &&
    csp.includes("frame-ancestors 'none'"),
)
const api = await fetch(BASE + '/api/clips')
check('Cabeceras: también en las respuestas de la API', api.headers.get('x-content-type-options') === 'nosniff' && api.headers.get('content-security-policy') !== null)
check('HSTS solo por https (detrás del proxy)', pagina.headers.get('strict-transport-security') === null &&
  readFileSync(join(ROOT, 'src', 'review', 'seguridad.ts'), 'utf8').includes("if (llegoCifrada(req)) res.setHeader('strict-transport-security'"))

// --- 2. Limite de peticiones ----------------------------------------------------------------

let reloj = 0
const lim = seg.crearLimitador(() => reloj)
let cortada: number | null = null
for (let i = 0; i < seg.LIMITES.subida.maximo + 1; i += 1) cortada = lim.comprobar('1.2.3.4', 'subida')
check('Límite: la petición que se pasa recibe la espera', cortada !== null && cortada > 0, String(cortada))
check('Límite: otra dirección no se ve afectada', lim.comprobar('5.6.7.8', 'subida') === null)
reloj += 61_000
check('Límite: pasado el minuto se vuelve a poder', lim.comprobar('1.2.3.4', 'subida') === null)
check('Límite: el progreso en vivo no cuenta', seg.claseDePeticion('GET', '/api/events') === null && seg.claseDePeticion('POST', '/api/clips/lote') === 'escritura')
// Dos acciones normales por el panel (sin proxy delante, como en este PC):
// una buena y una que la ruta rechaza. Las dos tienen que quedar anotadas.
const directa = (cuerpo: string) => fetch(BASE + '/api/clips/vod-1/clip-01', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: cuerpo,
})
const buena = await directa('{"status":"pending"}')
const mala = await directa('{"status":"inventado"}')
check('Acciones de prueba: una sale bien y otra se rechaza', buena.status === 200 && mala.status === 400, `${buena.status} ${mala.status}`)

const ip = `10.0.0.${Math.floor(Math.random() * 200)}`
let ultimo = 200
for (let i = 0; i < seg.LIMITES.escritura.maximo + 2; i += 1) {
  ultimo = (await fetch(BASE + '/api/clips/vod-1/clip-01', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': ip }, body: '{"status":"pending"}',
  })).status
}
check('Límite: el panel responde 429 con un mensaje amable', ultimo === 429)

// --- 3. Enlaces firmados --------------------------------------------------------------------

const ahora = Date.now()
const ruta = seg.firmarEnlace('vod-1', 'clip-01', 600, ahora)
const q = new URL('http://x' + ruta).searchParams
check('Enlace: una firma buena vale', seg.verificarEnlace('vod-1', 'clip-01', q.get('exp')!, q.get('firma')!, ahora))
check('Enlace: caduca', !seg.verificarEnlace('vod-1', 'clip-01', q.get('exp')!, q.get('firma')!, ahora + 601_000))
check('Enlace: no sirve para otro clip', !seg.verificarEnlace('vod-1', 'clip-02', q.get('exp')!, q.get('firma')!, ahora))
check('Enlace: alargar la caducidad a mano invalida la firma', !seg.verificarEnlace('vod-1', 'clip-01', String(Number(q.get('exp')) + 3600), q.get('firma')!, ahora))
const falsa = await fetch(BASE + '/descarga/vod-1/clip-01?exp=9999999999&firma=inventada')
check('Enlace: el panel rechaza una firma inventada sin pedir login', falsa.status === 403 && (await falsa.text()).includes('no es válido'))
const pedido = await fetch(BASE + '/api/clips/vod-1/clip-01/enlace', { method: 'POST', headers: { origin: BASE } })
const pj = (await pedido.json()) as { ruta?: string; horas?: number }
check('Enlace: el panel da uno de 24 horas', pedido.status === 200 && (pj.ruta ?? '').startsWith('/descarga/vod-1/clip-01?exp=') && pj.horas === 24)

// --- 4. Auditoria ---------------------------------------------------------------------------

const resumen = JSON.stringify(seg.resumirCuerpo({ email: 'a@b.c', password: 'secreta123', nueva: { contrasena: 'x' }, token: 'abc', status: 'approved' }))
check('Auditoría: nunca guarda contraseñas ni claves', !resumen.includes('secreta123') && !resumen.includes('"abc"') && resumen.includes('approved'), resumen)
check('Auditoría: dice la acción en palabras', seg.describirAccion('POST', '/api/clips/vod-1/clip-01', { status: 'approved' }) === 'aprobó un clip' &&
  seg.describirAccion('POST', '/api/jobs', { kind: 'publish' }) === 'lanzó la publicación')
await new Promise((r) => setTimeout(r, 1000))
const registro = await db.query<{ quien: string; accion: string; estado: number }>(`select quien, accion, estado from auditoria order by id`)
check('Auditoría: lo que se hace por el panel queda anotado, con quién', registro.some((r) => r.accion === 'devolvió un clip a revisar') && registro.every((r) => r.quien !== ''), `${registro.length} filas`)
check('Auditoría: también lo que la ruta rechaza, con su código', registro.some((r) => r.estado === 400))
const pubPg = readFileSync(join(ROOT, 'src', 'publish', 'estado-pg.ts'), 'utf8')
check('Auditoría: las publicaciones del procesador se anotan una vez', pubPg.includes("'procesador', 'publicó un clip'") && pubPg.includes('if (nuevas.length > 0)'))

// --- 5. Respaldos ---------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), 'klip-f8-'))
const r = await respaldar(db, dir, new Date('2026-11-02T03:00:00Z'))
check('Respaldo: un fichero comprimido con todas las tablas', r.nombre === 'klip-2026-11-02.json.gz' && r.tablas > 15 && r.filas > 0, `${r.tablas} tablas, ${r.filas} filas`)
const datos = leerRespaldo(r.fichero)
check('Respaldo: sin sesiones abiertas', !('sesiones' in datos.tablas) && !('intentos_acceso' in datos.tablas))
for (let d = 3; d <= 18; d += 1) await respaldar(db, dir, new Date(`2026-11-${String(d).padStart(2, '0')}T03:00:00Z`))
check('Respaldo: se quedan los 14 últimos', readdirSync(dir).length === 14 && !readdirSync(dir).includes('klip-2026-11-02.json.gz'))
const otra = await baseNueva()
const res = await restaurar(otra.db, datos)
const clipsRest = await otra.db.query<{ hashtags: string[] }>(`select hashtags from clips`)
check('Restaurar: una base vacía recupera los datos con sus tipos', clipsRest.length === 1 && Array.isArray(clipsRest[0]?.hashtags), JSON.stringify(res.filter((x) => x.insertadas > 0)))
check('Restaurar: hacerlo dos veces no duplica nada', (await restaurar(otra.db, datos)).every((x) => x.insertadas === 0))
const ids = await otra.db.query<{ id: number }>(`insert into auditoria (owner_id, quien, accion) values ('${OWNER}', 'x', 'y') returning id`)
check('Restaurar: los contadores siguen por donde iban', Number(ids[0]?.id) > Math.max(...registro.map((_, i) => i + 1)), String(ids[0]?.id))
await otra.pg.close()
rmSync(dir, { recursive: true, force: true })
check('Respaldos fuera de git', readFileSync(join(ROOT, '.gitignore'), 'utf8').includes('respaldos/'))
check('El procesador hace uno al día', readFileSync(join(ROOT, 'src', 'jobs', 'sistema.ts'), 'utf8').includes("debeHacerse('respaldo', 86_400_000)"))

// --- 6. Nada tecnico a la vista ---------------------------------------------------------------

check('Errores: sin rutas de usuario ni claves', limpiarRutas('No existe C:\\Users\\ana\\Desktop\\klip\\work\\v\\x.mp4 (Bearer abcdefghijk123)') === 'No existe …\\work\\v\\x.mp4 (Bearer ***)')
// Visto con un video real: la s: de https:// se tomaba por una unidad de Windows.
check('Errores: los enlaces no se confunden con rutas', limpiarRutas('Descargar https://youtu.be/kxBQ844hxRw') === 'Descargar https://youtu.be/kxBQ844hxRw')
const server = readFileSync(join(ROOT, 'src', 'review', 'server.ts'), 'utf8')
// Visto con un video real: el reparto encadenado salia sin el video.
check('Encadenado: solo buscar momentos y armar clips toman los ajustes; el reparto lleva su video', server.includes("kind === 'select' || kind === 'render'"))
check('Errores: toda respuesta de error pasa por el limpiador', server.includes('error: limpiarRutas((body as { error: string }).error)'))
check('Tareas: el navegador no recibe rutas completas en los argumentos', server.includes("emitir('job', jobParaPanel(resto))") && server.includes('activeJob: jobParaPanel(enMarcha(jobs))') && server.includes('...limpiarProfundo(jobParaPanel(rest))') && server.includes('limpiarProfundo({ ...jobParaPanel(resto), lines:') && server.includes('runs: rows.map((r) => limpiarProfundo(r))'))
check('Subida: la respuesta no lleva la ruta del disco', server.includes('upload: { name: stored.name, bytes: stored.bytes }'))

await pg.close()

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
process.exit(fallidas.length > 0 ? 1 : 0)
