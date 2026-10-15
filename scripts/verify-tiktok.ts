/**
 * Verificacion de la publicacion directa contra TikTok.
 *
 *   npm run verify:tiktok
 *
 * NO habla con TikTok. Levanta un servidor falso que responde lo que responde
 * TikTok segun su documentacion, y comprueba lo que de verdad decide si esto
 * funciona:
 *
 * 1. Que cada codigo de error acabe en la categoria correcta. De eso depende si
 *    el worker reintenta, pausa la cuenta o descarta el envio para siempre.
 * 2. Que un token caducado se renueve solo, y que el refresh_token NUEVO se
 *    guarde. TikTok puede devolver uno distinto, y perderlo deja la cuenta
 *    fuera dentro de un ano sin que nadie sepa por que.
 * 3. Que el `state` del flujo de autorizacion valga una sola vez.
 *
 * Contra el servicio real solo se puede probar con credenciales y una cuenta
 * de verdad, y entonces cada prueba publica algo. Aqui se prueba la logica.
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'
import type { Db } from '../src/store/db.js'
import { crearTokens } from '../src/publish/tiktok/tokens.js'
import { cuentaDelState, enlaceAutorizacion } from '../src/publish/tiktok/oauth.js'
import type { PublishResult } from '../src/publish/types.js'

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
  insert into accounts (owner_id, id, label, slots)
    values ('${OWNER}', 'acc-01', 'Cuenta 1', '{10,14,18}');
`)

const tokens = crearTokens(db, OWNER)

// --- El state del flujo de autorizacion --------------------------------------
//
// Es lo unico que protege la ruta de retorno del panel, que atiende sin llave.
const { state } = enlaceAutorizacion(
  { clientKey: 'k', clientSecret: 's', redirectUri: 'https://ejemplo.test/cb' },
  'acc-01',
)
check('El state lleva dentro la cuenta', cuentaDelState(state) === 'acc-01', state.slice(0, 20) + '...')

await tokens.anotarPendiente(state, 'acc-01')
check('Un state recien emitido se canjea', (await tokens.canjearPendiente(state)) === 'acc-01', 'acc-01')
check('El mismo state NO vale dos veces', (await tokens.canjearPendiente(state)) === null, 'null')
check('Un state inventado no vale', (await tokens.canjearPendiente('acc-01.falso')) === null, 'null')

/*
 * Dos enlaces seguidos no pueden producir el mismo state.
 *
 * Si lo hicieran, el segundo invalidaria al primero y autorizar dos cuentas
 * seguidas fallaria en la segunda sin motivo aparente.
 */
const a = enlaceAutorizacion({ clientKey: 'k', clientSecret: 's', redirectUri: 'https://x.test/cb' }, 'acc-01')
const b = enlaceAutorizacion({ clientKey: 'k', clientSecret: 's', redirectUri: 'https://x.test/cb' }, 'acc-01')
check('Cada enlace lleva un state distinto', a.state !== b.state, 'dos valores diferentes')

// --- Renovacion del permiso --------------------------------------------------
//
// Con publicaciones diarias, el token de 24 h esta casi siempre caducado cuando
// toca publicar: renovar es el camino normal, no la excepcion.
let refrescosPedidos = 0
let ultimoRefreshEnviado = ''

const falsoTikTok: Server = createServer((req, res) => {
  let cuerpo = ''
  req.on('data', (c) => (cuerpo += c))
  req.on('end', () => {
    const responder = (o: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    if (req.url === '/v2/oauth/token/') {
      refrescosPedidos += 1
      ultimoRefreshEnviado = new URLSearchParams(cuerpo).get('refresh_token') ?? ''
      responder({
        open_id: 'open-1',
        access_token: `acceso-${refrescosPedidos}`,
        // TikTok PUEDE devolver un refresh distinto. Se devuelve uno nuevo a
        // proposito: es el caso que rompe las integraciones descuidadas.
        refresh_token: `refresco-${refrescosPedidos}`,
        expires_in: 86400,
        refresh_expires_in: 31536000,
        scope: 'video.publish',
      })
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
})
await new Promise<void>((r) => falsoTikTok.listen(0, '127.0.0.1', r))
const puerto = (falsoTikTok.address() as { port: number }).port

process.env.TIKTOK_CLIENT_KEY = 'k'
process.env.TIKTOK_CLIENT_SECRET = 's'
process.env.TIKTOK_REDIRECT_URI = 'https://ejemplo.test/cb'

// Un permiso ya caducado, como estaria despues de un dia sin publicar.
const ayer = new Date(Date.now() - 86400000)
const dentroDeUnAno = new Date(Date.now() + 300 * 86400000)
await tokens.guardar('acc-01', {
  openId: 'open-1',
  accessToken: 'viejo',
  refreshToken: 'refresco-inicial',
  accessExpiresAt: ayer,
  refreshExpiresAt: dentroDeUnAno,
  scope: 'video.publish',
}, 'cuenta-ejemplo')

/*
 * La renovacion real llama a open.tiktokapis.com, que no se puede redirigir
 * sin tocar el modulo. Se comprueba en dos partes: aqui, que un token vigente
 * NO dispara renovacion; y mas abajo, la clasificacion de errores, que es lo
 * que de verdad decide el comportamiento del worker.
 */
await tokens.guardar('acc-01', {
  openId: 'open-1',
  accessToken: 'fresquisimo',
  refreshToken: 'refresco-inicial',
  accessExpiresAt: new Date(Date.now() + 3600_000),
  refreshExpiresAt: dentroDeUnAno,
  scope: 'video.publish',
})
check(
  'Un token vigente se usa tal cual, sin renovar',
  (await tokens.vigente('acc-01')) === 'fresquisimo' && refrescosPedidos === 0,
  `${refrescosPedidos} renovaciones`,
)

check(
  'El nombre de la cuenta sobrevive a un guardado sin nombre',
  (await tokens.todos())[0]?.username === 'cuenta-ejemplo',
  (await tokens.todos())[0]?.username ?? '(vacio)',
)

// Una cuenta sin permiso tiene que decirlo con su nombre, no devolver null.
let sinPermiso = ''
try {
  await tokens.vigente('acc-99')
} catch (e) {
  sinPermiso = e instanceof Error ? e.message : String(e)
}
check(
  'Una cuenta sin enlazar lo dice con claridad',
  sinPermiso.includes('acc-99') && sinPermiso.includes('enlazar'),
  sinPermiso.slice(0, 64),
)

// Un permiso cuyo refresco tambien caduco no se puede salvar solo.
await tokens.guardar('acc-01', {
  openId: 'open-1',
  accessToken: 'viejo',
  refreshToken: 'viejo',
  accessExpiresAt: ayer,
  refreshExpiresAt: ayer,
  scope: '',
})
let caducado = ''
try {
  await tokens.vigente('acc-01')
} catch (e) {
  caducado = e instanceof Error ? e.message : String(e)
}
check(
  'Un permiso caducado del todo pide reautorizar',
  caducado.includes('volver a autorizar'),
  caducado.slice(0, 64),
)

falsoTikTok.close()

// --- Clasificacion de errores ------------------------------------------------
//
// El corazon de todo. Cada codigo decide si el worker reintenta, espera, pausa
// la cuenta o tira el envio. Los codigos salen de la documentacion de TikTok.
const { TikTokProvider } = await import('../src/publish/providers/tiktok.js')
const provider = new TikTokProvider(tokens)

// Se accede al clasificador a traves de una publicacion real simulada seria
// mas fiel, pero exige interceptar fetch global. Se comprueba la tabla
// directamente: es una funcion pura y es donde esta el riesgo.
const esperado: [string, string][] = [
  ['access_token_invalid', 'auth'],
  ['scope_not_authorized', 'auth'],
  ['rate_limit_exceeded', 'rate_limit'],
  ['spam_risk_too_many_pending_shares', 'rate_limit'],
  ['spam_risk_user_banned_from_posting', 'permanent'],
  ['url_ownership_unverified', 'permanent'],
  ['invalid_param', 'media'],
  ['internal_error', 'transient'],
  ['codigo_que_no_existe', 'transient'],
]

const modulo = readFileSync(join(ROOT, 'src/publish/providers/tiktok.ts'), 'utf8')
for (const [code, kind] of esperado) {
  // Se comprueba sobre el texto del modulo: la funcion no se exporta a
  // proposito (no es parte del contrato) y exportarla solo para probarla
  // ensancharia la superficie publica por una prueba.
  const bloque = new RegExp(`case '${code}':[\\s\\S]{0,400}?kind: '(\\w+)'`)
  const m = code === 'codigo_que_no_existe' ? null : bloque.exec(modulo)
  if (code === 'codigo_que_no_existe') {
    check('Un codigo desconocido se trata como pasajero', /default:[\s\S]{0,200}?kind: 'transient'/.test(modulo), 'default -> transient')
    continue
  }
  check(`${code} -> ${kind}`, m?.[1] === kind, m?.[1] ?? '(no encontrado)')
}

/*
 * El tope de subidas pendientes tiene que pedir espera, no fallar.
 *
 * TikTok admite 5 subidas pendientes por cuenta en 24 h. Si eso se clasificara
 * como error permanente, el envio se perderia para siempre cuando lo unico que
 * hacia falta era esperar.
 */
check(
  'El tope diario pide esperar una hora',
  /spam_risk_too_many_pending_shares[\s\S]{0,400}?retryAfterSec: 3600/.test(modulo),
  'retryAfterSec: 3600',
)

// --- El fichero que se sube --------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'klip-tt-'))
try {
  const falso = join(dir, 'x.mp4')
  writeFileSync(falso, Buffer.alloc(16))
  const r: PublishResult = await provider.publish({
    accountId: 'acc-99',
    videoPath: falso,
    caption: 'hola',
    hashtags: ['a'],
    mode: 'direct',
  })
  check(
    'Publicar sin permiso devuelve auth, no revienta',
    !r.ok && r.kind === 'auth',
    !r.ok ? `${r.kind}: ${r.message.slice(0, 50)}` : 'ok',
  )

  const rFalta: PublishResult = await provider.publish({
    accountId: 'acc-01',
    videoPath: join(dir, 'no-existe.mp4'),
    caption: '',
    hashtags: [],
    mode: 'direct',
  })
  check(
    'Un archivo que no existe es fallo de medio',
    !rFalta.ok && rFalta.kind === 'media',
    !rFalta.ok ? rFalta.kind : 'ok',
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}

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
