/**
 * Verificacion de la Fase 7: multicliente, cuentas y publicacion.
 *
 *   npm run verify:fase7
 *
 * 1. Reparto: un cliente nuevo con 3 cuentas recibe sus clips y nadie mas
 * 2. Topes: diario por cuenta y de repeticiones por clip
 * 3. Cuentas: alias, tope y ultimo resultado en la base
 * 4. Alertas: un fallo forzado llega, y no se repite
 *
 * Todo contra una base PGlite en memoria; la red de las alertas se sustituye
 * por una funcion que apunta lo que se habria enviado.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'

loadEnv()

const { planSchedule } = await import('../src/queue/schedule.js')
const { destinoDelVideo, franjasDelGrupo, usosPrevios } = await import('../src/queue/reparto.js')
const { DEFAULTS } = await import('../src/queue/settings.js')
const { detectar, revisarAlertas } = await import('../src/alertas/vigia.js')
const { enviarAlerta } = await import('../src/alertas/canales.js')
const { createStore } = await import('../src/store/pg.js')
const { GUION } = await import('../src/review/guion.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }

const pg = new PGlite()
const db = { query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[], close: async () => pg.close() }
for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
const OWNER = '11111111-1111-1111-1111-111111111111'
const CLI = '22222222-2222-2222-2222-222222222222'
const CAMP = '33333333-3333-3333-3333-333333333333'
await pg.exec(`
  insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo');
  insert into settings (owner_id) values ('${OWNER}');
  insert into accounts (owner_id, id, label, slots) values
    ('${OWNER}', 'acc-01', 'Cuenta 1', '{10,14,18}'),
    ('${OWNER}', 'acc-02', 'Cuenta 2', '{11,15,19}');
  insert into clientes (id, owner_id, nombre, posts_per_day) values ('${CLI}', '${OWNER}', 'Cliente nuevo', 2);
  insert into campanas (id, owner_id, cliente_id, nombre) values ('${CAMP}', '${OWNER}', '${CLI}', 'Lanzamiento');
  -- Tres cuentas recien creadas: franjas vacias, como salen del boton Crear.
  insert into accounts (owner_id, id, label, slots, cliente_id) values
    ('${OWNER}', 'acc-03', 'Cuenta 3', '{}', '${CLI}'),
    ('${OWNER}', 'acc-04', 'Cuenta 4', '{}', '${CLI}'),
    ('${OWNER}', 'acc-05', 'Cuenta 5', '{}', '${CLI}');
  insert into sources (id, owner_id, title, campana_id) values ('vod-cli', '${OWNER}', 'Del cliente', '${CAMP}');
  insert into sources (id, owner_id, title) values ('vod-suelto', '${OWNER}', 'Sin campaña');
`)
const store = createStore(db, OWNER)
const publicables = await store.accounts.publicables('upload-post')

// --- 1. Reparto por cliente --------------------------------------------------------------

const settings = { ...DEFAULTS, postsPerDay: 3 }
const delCliente = await destinoDelVideo(db, OWNER, 'vod-cli', publicables, settings)
check(
  'Reparto: el video del cliente va solo a sus 3 cuentas',
  delCliente.cliente?.nombre === 'Cliente nuevo' && delCliente.cuentas.map((c) => c.id).join(',') === 'acc-03,acc-04,acc-05',
  delCliente.cuentas.map((c) => c.id).join(','),
)
const suelto = await destinoDelVideo(db, OWNER, 'vod-suelto', publicables, settings)
check('Reparto: un video sin campaña va a las cuentas sin cliente', suelto.cliente === null && suelto.cuentas.map((c) => c.id).join(',') === 'acc-01,acc-02')
check('Reparto: usa el perfil del cliente (2 al día) y no el general (3)', delCliente.perfil.postsPerDay === 2)

const grupo = franjasDelGrupo(delCliente.cuentas, delCliente.perfil)
check(
  'Reparto: las cuentas recien creadas (sin franjas) reciben sus horas',
  grupo.every((c) => c.slots.length === 2) && new Set(grupo.map((c) => c.slots[0])).size === 3,
  JSON.stringify(grupo.map((c) => c.slots)),
)
const clips = ['clip-01', 'clip-02', 'clip-03', 'clip-04', 'clip-05', 'clip-06', 'clip-07', 'clip-08']
const plan = planSchedule(grupo, clips, { startDate: new Date('2026-11-02T00:00:00'), days: 3, settings })
const porCuenta = new Map<string, number>()
for (const p of plan) porCuenta.set(p.accountId, (porCuenta.get(p.accountId) ?? 0) + 1)
check(
  'Agenda: 3 cuentas x 2 al día x 3 días = 18 salidas, 6 por cuenta, ninguna fuera del cliente',
  plan.length === 18 && [...porCuenta.values()].every((n) => n === 6) && [...porCuenta.keys()].every((k) => ['acc-03', 'acc-04', 'acc-05'].includes(k)),
  JSON.stringify([...porCuenta]),
)
const repeticionEnCuenta = plan.some((p, i) => plan.some((q, j) =>
  j > i && q.accountId === p.accountId && q.clipId === p.clipId &&
  q.scheduledAt.getTime() - p.scheduledAt.getTime() < settings.accountRepeatHours * 3_600_000))
check('Agenda: ninguna cuenta repite clip dentro de su espera', !repeticionEnCuenta)
const horas = plan.map((p) => p.scheduledAt.getHours() + p.scheduledAt.getMinutes() / 60)
check(
  'Agenda: todo cae dentro de la franja (con el desfase de minutos)',
  horas.every((h) => h >= settings.dayStartHour - 1 && h <= settings.dayEndHour + 1),
  `${Math.min(...horas).toFixed(2)}-${Math.max(...horas).toFixed(2)}`,
)

// --- 2. Topes -------------------------------------------------------------------------------

const conTope = franjasDelGrupo(delCliente.cuentas.map((c) => (c.id === 'acc-04' ? { ...c, limiteDiario: 1 } : c)), delCliente.perfil)
check('Tope diario: una cuenta con tope 1 publica una vez al día', conTope.find((c) => c.id === 'acc-04')?.slots.length === 1)
const planTope = planSchedule(grupo, ['clip-01', 'clip-02'], {
  startDate: new Date('2026-11-02T00:00:00'), days: 3, settings: { ...settings, accountRepeatHours: 0, clipCooldownMinutes: 0 },
  maxRepeticiones: 4, usosPrevios: new Map([['clip-01', 3]]),
})
const usos = new Map<string, number>()
for (const p of planTope) usos.set(p.clipId, (usos.get(p.clipId) ?? 0) + 1)
check(
  'Repeticiones: ningun clip pasa del tope, contando lo ya programado',
  (usos.get('clip-01') ?? 0) <= 1 && (usos.get('clip-02') ?? 0) <= 4 && planTope.length === 5,
  JSON.stringify([...usos]),
)
check(
  'Repeticiones: lo fallido no cuenta como uso',
  usosPrevios([{ sourceId: 'v', clipId: 'a', status: 'failed' }, { sourceId: 'v', clipId: 'a', status: 'pending' }], 'v').get('a') === 1,
)

// --- 3. Cuentas -------------------------------------------------------------------------------

await store.accounts.editar('acc-03', { alias: 'Zoti fans', limiteDiario: 2, plataformas: ['tiktok', 'youtube'] })
await store.accounts.anotarResultado('acc-03', false, 'El perfil no existe en upload-post.')
const acc3 = (await store.accounts.all()).find((a) => a.id === 'acc-03')
check(
  'Cuentas: alias, tope, plataformas y ultimo resultado se guardan',
  acc3?.alias === 'Zoti fans' && acc3.limiteDiario === 2 && acc3.plataformas?.join(',') === 'tiktok,youtube' &&
    acc3.ultimoResultado === 'error' && (acc3.ultimoError ?? '').includes('no existe'),
  JSON.stringify(acc3),
)
await store.accounts.editar('acc-03', { limiteDiario: null })
check('Cuentas: quitar el tope vuelve al horario sin tocar el alias', (await store.accounts.all()).find((a) => a.id === 'acc-03')?.limiteDiario === null)
check('Panel: cuentas agrupadas por cliente con acciones por grupo', GUION.includes('function gruposCuentas(') && GUION.includes('Pausar todas</button>') && GUION.includes('Comprobar todas</button>') && GUION.includes("'Sin cliente'"))
check('Panel: sin clientes, la lista de siempre (sin cajas vacias)', GUION.includes("if (!clientes || clientes.length === 0) {"))

// --- 4. Alertas -----------------------------------------------------------------------------

process.env.TELEGRAM_BOT_TOKEN = 'token-de-prueba'
process.env.TELEGRAM_CHAT_ID = '42'
const llamadas: { url: string; cuerpo: string }[] = []
const red = async (url: string, init: RequestInit) => {
  llamadas.push({ url, cuerpo: String(init.body) })
  return { ok: true, status: 200 }
}
const enviar = (asunto: string, texto: string) => enviarAlerta(asunto, texto, red)

// Una publicacion que falla, forzada.
await pg.exec(`
  insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path, checksum, scheduled_at, status, last_error, updated_at)
  values ('q-mal', '${OWNER}', 'vod-cli', 'clip-01', 'acc-03', 'v.mp4', 'x', now() - interval '5 minutes', 'failed',
          'El perfil acc-03 no existe en upload-post.', now());
`)
const primera = await revisarAlertas(db, OWNER, enviar)
const fallo = primera.find((a) => a.tipo === 'publicacion')
check('Alertas: una publicación fallida manda la alerta', fallo !== undefined && fallo.texto.includes('acc-03'), JSON.stringify(primera.map((a) => a.tipo)))
check(
  'Alertas: sale por Telegram, sin que el token aparezca en el texto',
  llamadas.some((l) => l.url.includes('api.telegram.org') && l.cuerpo.includes('falló una publicación')) &&
    !llamadas.some((l) => l.cuerpo.includes('token-de-prueba')),
)
const segunda = await revisarAlertas(db, OWNER, enviar)
check('Alertas: la misma no se repite en la vuelta siguiente', segunda.every((a) => a.tipo !== 'publicacion'), JSON.stringify(segunda.map((a) => a.tipo)))
await pg.exec(`update settings set alertas_activas = false where owner_id = '${OWNER}'`)
await pg.exec(`insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path, checksum, scheduled_at, status, last_error, updated_at)
  values ('q-mal-2', '${OWNER}', 'vod-cli', 'clip-02', 'acc-04', 'v.mp4', 'y', now(), 'failed', 'otro', now())`)
check('Alertas: apagadas no sale nada', (await revisarAlertas(db, OWNER, enviar)).length === 0)

const ahora = new Date('2026-11-02T12:00:00Z')
const base = {
  ahora, trabajador: { vivo: true, vistoEn: ahora.toISOString() }, ia: { estado: 'lista' as const, reanudarEn: null },
  cuentasSinPermiso: [], cuentasActivas: 3, colaFutura: 5, haPublicado: true, fallos: [],
}
check('Alertas: todo en orden, ninguna alerta', detectar(base).length === 0)
check('Alertas: procesador sin latido 10 minutos', detectar({ ...base, trabajador: { vivo: false, vistoEn: new Date(ahora.getTime() - 600_000).toISOString() } }).some((a) => a.tipo === 'procesador'))
check('Alertas: un corte de 1 minuto no avisa', !detectar({ ...base, trabajador: { vivo: false, vistoEn: new Date(ahora.getTime() - 60_000).toISOString() } }).some((a) => a.tipo === 'procesador'))
check('Alertas: IA en el límite', detectar({ ...base, ia: { estado: 'limite', reanudarEn: new Date(ahora.getTime() + 3_600_000).toISOString() } }).some((a) => a.tipo === 'ia'))
check('Alertas: permiso de TikTok caducado', detectar({ ...base, cuentasSinPermiso: [{ id: 'acc-07', alias: '' }] }).some((a) => a.tipo === 'token' && a.clave === 'acc-07'))
check('Alertas: agenda vacía', detectar({ ...base, colaFutura: 0 }).some((a) => a.tipo === 'cola'))
check('Alertas: un panel recién instalado no avisa de agenda vacía', !detectar({ ...base, colaFutura: 0, haPublicado: false }).some((a) => a.tipo === 'cola'))
check('Panel: Ajustes > Sistema enseña las alertas y el botón de prueba', GUION.includes('function pintarAlertas(') && GUION.includes('Enviar una prueba'))
const ejemplo = readFileSync(join(ROOT, '.env.example'), 'utf8')
check('.env.example lleva las variables de alertas, vacías', /^TELEGRAM_BOT_TOKEN=$/m.test(ejemplo) && /^RESEND_API_KEY=$/m.test(ejemplo))

// --- 5. Anti-spam y cumplimiento --------------------------------------------------------------

const { SubscriptionCaptionVarier, PlantillaVarier } = await import('../src/variants/captions.js')
const { validateSettings } = await import('../src/queue/settings.js')
const baseTexto = { caption: 'Lo que nadie te cuenta de empezar de cero', hashtags: ['consejos', 'directo', 'emprender', 'motivacion'] }
const cuentas3 = ['acc-03', 'acc-04', 'acc-05']
const llmFalso = {
  nombre: 'falso', modelo: 'x', incluidoEnSuscripcion: true,
  completar: async () => ({
    ms: 1,
    texto: '```json\n{"variants":[' +
      '{"caption":"¿Empezar de cero? Esto es lo que nadie dice","hashtags":["#emprender","consejos","vida"]},' +
      '{"caption":"Empezar de cero no es el problema. El miedo sí.","hashtags":["miedo","emprender","directo"]},' +
      '{"caption":"Nadie te avisa de esto al empezar","hashtags":["consejos","inicio","motivacion"]}]}\n```',
  }),
}
const conIA = await new SubscriptionCaptionVarier(llmFalso).vary(baseTexto, cuentas3)
check(
  'Textos: con la suscripción cada cuenta recibe una descripción distinta',
  new Set([...conIA.values()].map((v) => v.caption)).size === 3 && conIA.get('acc-03')?.hashtags[0] === 'emprender',
  JSON.stringify([...conIA.values()]),
)
const sinIA = await new PlantillaVarier().vary(baseTexto, cuentas3)
check(
  'Textos: sin IA también cambia la frase, no solo los hashtags',
  new Set([...sinIA.values()].map((v) => v.caption)).size === 3 && [...sinIA.values()].every((v) => v.caption.length <= 150),
  JSON.stringify([...sinIA.values()].map((v) => v.caption)),
)
check('Textos: el reparto cae a la variación sin IA si la IA falla', readFileSync(join(ROOT, 'scripts', 'schedule.ts'), 'utf8').includes('varier = new PlantillaVarier()'))
check('Horarios: tope de repeticiones por clip, 10 por defecto', DEFAULTS.maxRepeticiones === 10 && GUION.includes("key: 'maxRepeticiones'"))
let fueraDeRango = false
try { validateSettings({ ...DEFAULTS, maxRepeticiones: 0 }) } catch { fueraDeRango = true }
check('Horarios: un tope de 0 repeticiones se rechaza', fueraDeRango)
check('El reparto usa el tope guardado en Horarios', readFileSync(join(ROOT, 'scripts', 'schedule.ts'), 'utf8').includes('maxRepeticiones: settings.maxRepeticiones'))
const riesgos = readFileSync(join(ROOT, 'docs', 'RIESGOS.md'), 'utf8')
check('docs/RIESGOS.md explica normas de TikTok, tope de repeticiones y licencias', /normas/i.test(riesgos) && /repeticiones/i.test(riesgos) && /licencia/i.test(riesgos))
check('Videos: aviso de permiso o licencia al añadir un video', GUION.includes('Usa solo videos tuyos o con permiso de su autor'))

await pg.close()

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
if (fallidas.length > 0) process.exitCode = 1
