/**
 * Verificacion del acceso con usuario y contraseña (Fase 2).
 *
 *   npm run verify:acceso
 *
 * Levanta el panel de verdad sobre PGlite en memoria y lo recorre como lo
 * haria un navegador: sin sesion, entrando, saliendo, fallando la contraseña,
 * con cada rol y con la clave de servicio.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'

loadEnv()
process.env.AUTO_CHAIN = '0'
process.env.PANEL_REMOTO = '1'
delete process.env.KLIP_SIN_LOGIN
delete process.env.LEGACY_KEY_ENABLED
delete process.env.REVIEW_PASSWORD
process.env.REVIEW_KEY = 'llave-antigua-de-prueba-1234567890'
process.env.WORKER_TOKEN = 'token-de-servicio-de-prueba-con-mas-de-32-caracteres'
delete process.env.SUPABASE_SERVICE_ROLE_KEY

const { startReviewServer } = await import('../src/review/server.js')
const { createAuth, MAX_FALLOS_CORREO, MAX_FALLOS_IP } = await import('../src/auth/auth.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }

const pg = new PGlite()
const db = {
  query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}
for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}
const OWNER = '11111111-1111-1111-1111-111111111111'
await pg.exec(`insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)

const auth = createAuth(db, OWNER)
const ADMIN = { email: 'admin@ejemplo.com', contrasena: 'contraseña-de-admin-1' }
const OPER = { email: 'operador@ejemplo.com', contrasena: 'contraseña-de-oper-1' }
await auth.crear({ email: ADMIN.email, nombre: 'Admin', rol: 'admin', contrasena: ADMIN.contrasena })
await auth.crear({ email: OPER.email, nombre: 'Oper', rol: 'operador', contrasena: OPER.contrasena })

const PUERTO = 4398
startReviewServer({ port: PUERTO, db, ownerId: OWNER })
await new Promise((r) => setTimeout(r, 400))
const base = `http://127.0.0.1:${PUERTO}`

async function entrar(email: string, contrasena: string, cabeceras: Record<string, string> = {}): Promise<Response> {
  return fetch(base + '/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...cabeceras },
    body: new URLSearchParams({ email, contrasena, volver: '/' }).toString(),
  })
}
function galletaDe(r: Response): string {
  return /klip_sesion=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? ''
}
const con = (g: string, extra: Record<string, string> = {}) => ({ headers: { cookie: `klip_sesion=${g}`, ...extra } })

// --- Sin sesion no se ve nada ----------------------------------------------------

const portada = await fetch(base + '/', { redirect: 'manual', headers: { accept: 'text/html' } })
check('La portada sin sesion lleva al login', portada.status === 303 && portada.headers.get('location') === '/login', `${portada.status} ${portada.headers.get('location')}`)

const rutas = ['/api/overview', '/api/clips', '/api/jobs', '/api/queue', '/api/ia', '/api/usuarios', '/api/settings',
  '/api/ajustes', '/api/cuentas', '/api/plataformas', '/api/proyectos', '/api/metrics', '/api/runs', '/api/events', '/api/yo']
const abiertas: string[] = []
for (const r of rutas) {
  const x = await fetch(base + r, { redirect: 'manual' })
  if (x.status !== 401) abiertas.push(`${r}=${x.status}`)
  void x.body?.cancel()
}
const post = await fetch(base + '/api/jobs', { method: 'POST', body: '{"kind":"doctor"}', headers: { 'content-type': 'application/json' } })
check(`Ningun endpoint responde sin sesion (${rutas.length} GET y un POST)`, abiertas.length === 0 && post.status === 401, abiertas.join(' ') || `POST ${post.status}`)

const legal = await fetch(base + '/legal/privacidad')
check('Las paginas legales siguen siendo publicas', legal.status === 200)

const llave = await fetch(base + '/?k=' + process.env.REVIEW_KEY, { redirect: 'manual', headers: { accept: 'text/html' } })
check('Sin LEGACY_KEY_ENABLED, la llave antigua no abre nada', llave.status === 303 && (llave.headers.get('location') ?? '').startsWith('/login'), `${llave.status}`)

const login = await fetch(base + '/login')
const loginHtml = await login.text()
check(
  'La pantalla de login: oscura, boton azul, correo y contraseña',
  login.status === 200 && loginHtml.includes('#0B0C10') && loginHtml.includes('#5B7CFF') &&
    loginHtml.includes('type="email"') && loginHtml.includes('type="password"') && loginHtml.includes('KLIP'),
)

// --- Entrar y salir --------------------------------------------------------------------

const mal = await entrar(ADMIN.email, 'contraseña-equivocada')
const malHtml = await mal.text()
const noExiste = await entrar('nadie@ejemplo.com', 'lo-que-sea-largo')
const noExisteHtml = await noExiste.text()
check(
  'Contraseña mal y correo inexistente dan el mismo mensaje generico',
  mal.status === 401 && noExiste.status === 401 &&
    malHtml.includes('Correo o contraseña incorrectos.') && noExisteHtml.includes('Correo o contraseña incorrectos.'),
)

const bien = await entrar(ADMIN.email, ADMIN.contrasena)
const cookie = bien.headers.get('set-cookie') ?? ''
const g = galletaDe(bien)
check('Con la contraseña buena entra y vuelve a la portada', bien.status === 303 && bien.headers.get('location') === '/', `${bien.status} ${bien.headers.get('location')}`)
check(
  'La galleta es HttpOnly, SameSite=Lax y dura 7 dias',
  cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Max-Age=604800') && g.length >= 40,
  cookie.replace(/klip_sesion=[^;]*/, 'klip_sesion=***'),
)
const cifrada = await entrar(ADMIN.email, ADMIN.contrasena, { 'x-forwarded-proto': 'https' })
check('Detras de https (Hostinger) la galleta lleva Secure', (cifrada.headers.get('set-cookie') ?? '').includes('Secure'))

const dentro = await fetch(base + '/api/overview', con(g))
check('Con la sesion se ven los datos', dentro.status === 200, `${dentro.status}`)
const yo = (await (await fetch(base + '/api/yo', con(g))).json()) as { rol: string; email: string }
check('/api/yo dice quien es y su rol', yo.rol === 'admin' && yo.email === ADMIN.email)

const filasSesion = await db.query<{ id_hash: string }>(`select id_hash from sesiones`)
const filaUsuario = await db.query<{ hash: string }>(`select hash from usuarios where email = $1`, [ADMIN.email])
check(
  'En la base no estan ni el token ni la contraseña',
  filasSesion.every((f) => f.id_hash !== g && f.id_hash.length === 64) && filaUsuario[0]?.hash.startsWith('$2') === true,
)

const ajeno = await fetch(base + '/api/jobs', {
  method: 'POST', ...con(g, { origin: 'https://otro-sitio.example', 'content-type': 'application/json' }), body: '{"kind":"doctor"}',
})
check('Una peticion con la sesion pero desde otra web se rechaza', ajeno.status === 403, `${ajeno.status}`)

const salir = await fetch(base + '/logout', { method: 'POST', redirect: 'manual', ...con(g) })
check('Cerrar sesion borra la galleta', salir.status === 303 && (salir.headers.get('set-cookie') ?? '').includes('Max-Age=0'))
const trasSalir = await fetch(base + '/api/overview', con(g))
check('Tras cerrar sesion, la galleta vieja ya no vale', trasSalir.status === 401, `${trasSalir.status}`)

// --- Caducidad y renovacion -----------------------------------------------------------

const g2 = galletaDe(await entrar(ADMIN.email, ADMIN.contrasena))
await pg.query(`update sesiones set renovada_en = now() - interval '2 hours', expira_en = now() + interval '1 day'`)
const renovada = await fetch(base + '/api/overview', con(g2))
const { hashToken } = await import('../src/auth/auth.js')
const exp = await db.query<{ dias: number }>(
  `select extract(epoch from (expira_en - now())) / 86400 as dias from sesiones where id_hash = $1`,
  [hashToken(g2)],
)
check(
  'Usarla la renueva: 7 dias mas y galleta nueva',
  renovada.status === 200 && (renovada.headers.get('set-cookie') ?? '').includes('klip_sesion=') && exp.length === 1 && exp.every((e) => Number(e.dias) > 6.9),
  exp.map((e) => Number(e.dias).toFixed(2)).join(','),
)
await pg.query(`update sesiones set expira_en = now() - interval '1 minute'`)
check('Una sesion caducada no entra', (await fetch(base + '/api/overview', con(g2))).status === 401)

// --- Fuerza bruta -----------------------------------------------------------------------

for (let i = 0; i < MAX_FALLOS_CORREO; i += 1) await entrar(OPER.email, `mal-${i}-xxxxxxxx`, { 'x-forwarded-for': '10.0.0.5' })
const bloqueada = await entrar(OPER.email, OPER.contrasena, { 'x-forwarded-for': '10.0.0.6' })
const bloqueadaHtml = await bloqueada.text()
check(
  `Tras ${MAX_FALLOS_CORREO} fallos el correo se bloquea, aunque luego acierte`,
  bloqueada.status === 429 && bloqueadaHtml.includes('Demasiados intentos'),
  `${bloqueada.status}`,
)
for (let i = 0; i < MAX_FALLOS_IP; i += 1) await entrar(`otro${i}@ejemplo.com`, 'mal-mal-mal-mal', { 'x-forwarded-for': '10.0.0.9' })
const ipBloqueada = await entrar(ADMIN.email, ADMIN.contrasena, { 'x-forwarded-for': '10.0.0.9' })
check(`Tras ${MAX_FALLOS_IP} fallos desde una direccion, esa direccion se bloquea`, ipBloqueada.status === 429, `${ipBloqueada.status}`)
await pg.query(`update intentos_acceso set creado_en = now() - interval '16 minutes'`)
const desbloqueada = await entrar(OPER.email, OPER.contrasena, { 'x-forwarded-for': '10.0.0.6' })
check('Pasados 15 minutos se puede volver a entrar', desbloqueada.status === 303, `${desbloqueada.status}`)
const go = galletaDe(desbloqueada)

// --- Roles ----------------------------------------------------------------------------------

const ga = galletaDe(await entrar(ADMIN.email, ADMIN.contrasena))
const json = { 'content-type': 'application/json' }
const opLee = await fetch(base + '/api/settings', con(go))
const opCambia = await fetch(base + '/api/settings', { method: 'PUT', ...con(go, json), body: '{}' })
const opIA = await fetch(base + '/api/ia/reintentar', { method: 'POST', ...con(go) })
const opUsuarios = await fetch(base + '/api/usuarios', con(go))
const opCuentas = await fetch(base + '/api/cuentas', { method: 'POST', ...con(go, json), body: '{}' })
const opRevisa = await fetch(base + '/api/clips', con(go))
check(
  'Operador: ve las pantallas y revisa, pero no toca ajustes, cuentas, IA ni usuarios',
  opLee.status === 200 && opRevisa.status === 200 &&
    opCambia.status === 403 && opIA.status === 403 && opUsuarios.status === 403 && opCuentas.status === 403,
  `lee=${opLee.status} revisa=${opRevisa.status} ajustes=${opCambia.status} ia=${opIA.status} usuarios=${opUsuarios.status} cuentas=${opCuentas.status}`,
)
const adIA = await fetch(base + '/api/ia/reintentar', { method: 'POST', ...con(ga) })
check('Admin: si puede', adIA.status === 200, `${adIA.status}`)

// --- Usuarios desde el panel ------------------------------------------------------------------

const corta = await fetch(base + '/api/usuarios', { method: 'POST', ...con(ga, json), body: JSON.stringify({ email: 'nuevo@ejemplo.com', contrasena: 'corta', rol: 'operador' }) })
check('Contraseña de menos de 10 caracteres: rechazada', corta.status === 400)
const nuevo = await fetch(base + '/api/usuarios', { method: 'POST', ...con(ga, json), body: JSON.stringify({ email: 'Nuevo@Ejemplo.com', contrasena: 'provisional-123', rol: 'operador' }) })
const nuevoU = ((await nuevo.json()) as { usuario: { id: string; email: string; debeCambiar: boolean } }).usuario
check('El admin crea un usuario con contraseña provisional', nuevo.status === 201 && nuevoU.email === 'nuevo@ejemplo.com' && nuevoU.debeCambiar)

const primera = await entrar('nuevo@ejemplo.com', 'provisional-123')
const gn = galletaDe(primera)
check('Con contraseña provisional, al entrar se pide cambiarla', primera.headers.get('location') === '/cuenta/contrasena')
check('Y hasta cambiarla no ve datos', (await fetch(base + '/api/overview', con(gn))).status === 403)
const cambio = await fetch(base + '/cuenta/contrasena', {
  method: 'POST', redirect: 'manual', ...con(gn, { 'content-type': 'application/x-www-form-urlencoded' }),
  body: new URLSearchParams({ actual: 'provisional-123', nueva: 'la-mia-definitiva-1', repetida: 'la-mia-definitiva-1' }).toString(),
})
check('Cambia la contraseña y ya entra', cambio.status === 303 && (await fetch(base + '/api/overview', con(gn))).status === 200, `${cambio.status}`)

const reset = await fetch(base + `/api/usuarios/${nuevoU.id}/contrasena`, { method: 'POST', ...con(ga, json), body: JSON.stringify({ contrasena: 'otra-provisional-9' }) })
check('Si la olvida, el admin le pone otra y se cierran sus sesiones', reset.status === 200 && (await fetch(base + '/api/overview', con(gn))).status === 401)

const admins = await auth.listar()
const idAdmin = admins.find((u) => u.email === ADMIN.email)?.id ?? ''
let ultimoAdmin = ''
try {
  await auth.actualizar(idAdmin, { activo: false })
} catch (e) {
  ultimoAdmin = (e as Error).message
}
check('No se puede quitar el acceso al ultimo administrador', ultimoAdmin.includes('al menos un administrador'), ultimoAdmin)

// --- Clave de servicio --------------------------------------------------------------------------

const servicio = await fetch(base + '/api/jobs', { headers: { authorization: `Bearer ${process.env.WORKER_TOKEN}` } })
const servicioMal = await fetch(base + '/api/jobs', { headers: { authorization: 'Bearer token-inventado-pero-largo-de-mas-de-32' } })
check('La clave de servicio (WORKER_TOKEN) entra sin sesion de nadie', servicio.status === 200 && servicioMal.status === 401, `${servicio.status}/${servicioMal.status}`)

// --- La vista previa sin login no se cuela por un proxy -----------------------------------------

process.env.KLIP_SIN_LOGIN = '1'
const directa = await fetch(base + '/api/overview')
const proxy = await fetch(base + '/api/overview', { headers: { 'x-forwarded-for': '203.0.113.7' } })
check('KLIP_SIN_LOGIN solo abre a este ordenador, nunca tras un proxy', directa.status === 200 && proxy.status === 401, `${directa.status}/${proxy.status}`)
delete process.env.KLIP_SIN_LOGIN

// --- Informe ----------------------------------------------------------------------------------

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
process.exit(fallidas.length > 0 ? 1 : 0)
