/**
 * Prueba de extremo a extremo (Fase 8):
 *
 *   subir MP4 -> transcribir -> buscar momentos -> revisar -> aprobar -> agenda
 *
 *   npm run verify:e2e
 *
 * Lo que es REAL: el panel entero (servidor HTTP, rutas, almacen) contra una
 * base PGlite con todas las migraciones; la subida del MP4 por la API; la
 * busqueda de momentos con el script de siempre (scripts/select.ts, como lo
 * lanza el trabajador) y el mismo proveedor claude -p; la publicacion de
 * resultados en la base (publicarResultado); revisar y aprobar por la API; y
 * el reparto con las funciones del planificador.
 *
 * Lo que se SUSTITUYE, y por que:
 * - Transcribir: necesita ffmpeg con whisper, que no esta en todas partes. Se
 *   deja el transcript.json que escribiria el ingest y se publica igual.
 * - Claude Code: un CLI falso (scripts/fixtures/claude-falso.mjs) que responde
 *   dos momentos. El proveedor, el esquema y la validacion son los reales.
 * - Armar clips y copias por cuenta: necesitan ffmpeg y la GPU. La agenda se
 *   reparte sobre los clips aprobados, que es lo que decide el reparto.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const TMP = mkdtempSync(join(tmpdir(), 'klip-e2e-'))
process.env.WORK_DIR = join(TMP, 'work')
process.env.OUT_DIR = join(TMP, 'out')
process.env.KLIP_SIN_LOGIN = '1'
process.env.LLM_PROVIDER = 'claude-cli'
delete process.env.PANEL_REMOTO
delete process.env.DATABASE_URL
mkdirSync(process.env.WORK_DIR, { recursive: true })

const { loadEnv, ROOT } = await import('../src/lib/env.js')
loadEnv()
// loadEnv no pisa lo que ya esta en el entorno, pero por si el .env trae algo:
process.env.WORK_DIR = join(TMP, 'work')
process.env.KLIP_SIN_LOGIN = '1'

const { startReviewServer } = await import('../src/review/server.js')
const { publicarResultado } = await import('../src/store/publicar.js')
const { createStore } = await import('../src/store/pg.js')
const { destinoDelVideo, franjasDelGrupo, usosPrevios } = await import('../src/queue/reparto.js')
const { planSchedule } = await import('../src/queue/schedule.js')
const { loadSettingsDb } = await import('../src/queue/settings.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }

// --- Base y panel ---------------------------------------------------------------------------

const pg = new PGlite()
const db = { query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[], close: async () => pg.close() }
for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
const OWNER = '11111111-1111-1111-1111-111111111111'
const CLI = '22222222-2222-2222-2222-222222222222'
const CAMP = '33333333-3333-3333-3333-333333333333'
await pg.exec(`
  insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo');
  insert into settings (owner_id) values ('${OWNER}');
  insert into clientes (id, owner_id, nombre) values ('${CLI}', '${OWNER}', 'Cliente E2E');
  insert into campanas (id, owner_id, cliente_id, nombre) values ('${CAMP}', '${OWNER}', '${CLI}', 'Campaña E2E');
  insert into accounts (owner_id, id, label, slots, cliente_id) values
    ('${OWNER}', 'acc-01', 'Cuenta 1', '{}', '${CLI}'),
    ('${OWNER}', 'acc-02', 'Cuenta 2', '{}', '${CLI}'),
    ('${OWNER}', 'acc-03', 'Cuenta 3', '{}', '${CLI}');
`)
const PORT = 4300 + Math.floor(Math.random() * 90)
startReviewServer({ port: PORT, db, ownerId: OWNER })
const BASE = `http://localhost:${PORT}`
for (let i = 0; i < 50; i += 1) {
  try { await fetch(BASE + '/api/yo'); break } catch { await new Promise((r) => setTimeout(r, 100)) }
}
const api = async (ruta: string, init: RequestInit = {}): Promise<{ status: number; json: Record<string, unknown> }> => {
  const r = await fetch(BASE + ruta, { ...init, headers: { origin: BASE, ...(init.headers ?? {}) } })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

// --- 1. Subir el MP4 ------------------------------------------------------------------------

const subida = await api('/api/upload', {
  method: 'POST',
  headers: { 'x-file-name': encodeURIComponent('entrevista e2e.mp4'), 'x-campana': CAMP, 'content-type': 'application/octet-stream' },
  body: Buffer.alloc(64 * 1024, 1),
})
const job = subida.json.job as { kind?: string; args?: string[] } | undefined
check('1. Subir: el panel acepta el MP4 y encola la transcripción', subida.status === 202 && job?.kind === 'ingest', `${subida.status} ${JSON.stringify(subida.json).slice(0, 160)}`)
check('1. Subir: la tarea lleva la campaña elegida', (job?.args ?? []).includes(CAMP), JSON.stringify(job?.args))

// --- 2. Transcribir (lo que deja el ingest) ---------------------------------------------------

const ID = 'e2e-entrevista'
const dir = join(process.env.WORK_DIR, ID)
mkdirSync(dir, { recursive: true })
const frases = [
  'Bueno, empezamos la entrevista de hoy', 'Lo primero que aprendí al empezar fue a escuchar',
  'Nadie te cuenta que el primer año pierdes dinero', 'Y aun así volvería a hacerlo mañana',
  'El secreto fue rodearme de gente mejor que yo', 'Eso me cambió la forma de trabajar',
]
const transcript = {
  sourceId: ID, language: 'es', durationSec: 180, hasWordTimestamps: false,
  segments: Array.from({ length: 60 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: `${frases[i % frases.length]} (${i + 1})` })),
}
writeFileSync(join(dir, 'transcript.json'), JSON.stringify(transcript))
writeFileSync(join(dir, 'source.json'), JSON.stringify({ id: ID, title: 'Entrevista E2E', durationSec: 180, url: '' }))
await publicarResultado(db, OWNER, 'ingest', job?.args ?? [], `sourceId   : ${ID}\n`)
const fuentes = await api('/api/overview')
check('2. Transcribir: el video aparece en el panel con su campaña', JSON.stringify(fuentes.json).includes(ID) &&
  (await db.query<{ campana_id: string }>(`select campana_id from sources where id = $1`, [ID]))[0]?.campana_id === CAMP)

// --- 3. Buscar momentos (script real + Claude falso) -------------------------------------------

// inicio y fin son NUMEROS DE LINEA de la transcripcion (1 = la primera), no segundos.
const momento = (inicio: number, fin: number, titulo: string, total: number) => ({
  inicio, fin, titulo, gancho: transcript.segments[inicio - 1]!.text, descripcion: 'Un momento de la prueba',
  hashtags: ['emprender', 'consejos', 'entrevista'], puntaje_gancho: 85, puntaje_cierre: 70,
  puntaje_retencion: 75, puntaje_total: total, motivo: 'Tiene gancho y cierre.',
})
const guion = join(TMP, 'guion.json')
writeFileSync(guion, JSON.stringify([{ texto: JSON.stringify({ momentos: [momento(2, 12, 'El año que nadie te cuenta', 82), momento(21, 33, 'Rodearse de gente mejor', 74)] }) }]))
const sel = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(ROOT, 'scripts', 'select.ts'), ID], {
  cwd: ROOT,
  env: { ...process.env, CLAUDE_CLI_PATH: join(ROOT, 'scripts', 'fixtures', 'claude-falso.mjs'), KLIP_FALSO_GUION: guion },
  encoding: 'utf8',
  timeout: 120_000,
})
check('3. Buscar momentos: el script termina bien', sel.status === 0, (sel.stdout + sel.stderr).split('\n').slice(-6).join(' | '))
await publicarResultado(db, OWNER, 'select', [ID], sel.stdout)

// --- 4. Revisar -------------------------------------------------------------------------------

const lista = await api('/api/clips')
const clips = ((lista.json.clips ?? lista.json.items ?? []) as { sourceId: string; clipId: string; status: string; titulo?: string }[])
  .filter((c) => c.sourceId === ID)
check('4. Revisar: los momentos llegan a Revisar, pendientes', clips.length === 2 && clips.every((c) => c.status === 'pending'), JSON.stringify(clips.map((c) => c.clipId + ':' + c.status)))
check('4. Revisar: con el título que propuso la IA', clips.some((c) => c.titulo === 'El año que nadie te cuenta'), JSON.stringify(clips.map((c) => c.titulo)))

// --- 5. Aprobar -------------------------------------------------------------------------------

for (const c of clips) {
  await api(`/api/clips/${encodeURIComponent(ID)}/${encodeURIComponent(c.clipId)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }),
  })
}
const store = createStore(db, OWNER)
const aprobados = (await store.clips.byStatus('approved')).filter((c) => c.sourceId === ID)
check('5. Aprobar: los dos clips quedan aprobados', aprobados.length === 2)
const audit = await db.query<{ accion: string }>(`select accion from auditoria where accion = 'aprobó un clip'`)
check('5. Aprobar: queda en el registro de auditoría', audit.length === 2, `${audit.length}`)

// --- 6. Agenda --------------------------------------------------------------------------------

const settings = await loadSettingsDb(db, OWNER)
const destino = await destinoDelVideo(db, OWNER, ID, await store.accounts.publicables('upload-post'), settings)
const cuentas = franjasDelGrupo(destino.cuentas, destino.perfil)
const plan = aprobados.length === 0 ? [] : planSchedule(cuentas, aprobados.map((c) => c.clipId), {
  startDate: new Date('2026-11-02T00:00:00'), days: 1, settings: { ...settings, accountRepeatHours: 24 },
  maxRepeticiones: settings.maxRepeticiones, usosPrevios: usosPrevios(await store.queue.all(), ID),
})
await store.queue.add(plan.map((p) => ({
  id: `${p.clipId}-${p.accountId}-${p.scheduledAt.toISOString()}`, sourceId: ID, clipId: p.clipId, accountId: p.accountId,
  variantPath: '(e2e)', checksum: '', params: { zoom: 0, speed: 0, brightness: 0, contrast: 0, saturation: 0, trimStartSec: 0 },
  caption: 'Texto', hashtags: ['emprender'], scheduledAt: p.scheduledAt.toISOString(), status: 'pending', attemptCount: 0, lastError: null,
})))
const agenda = await api('/api/queue')
const texto = JSON.stringify(agenda.json)
check('6. Agenda: se reparte entre las 3 cuentas del cliente', destino.cuentas.length === 3 && new Set(plan.map((p) => p.accountId)).size === 3, JSON.stringify(plan.map((p) => p.accountId)))
check('6. Agenda: el panel enseña las salidas programadas', agenda.status === 200 && texto.includes(ID) && plan.length > 0, `${plan.length} salidas`)

// --- 7. Nada técnico a la vista ---------------------------------------------------------------

if (process.env.E2E_DEBUG) {
  console.log('DEBUG sel', sel.stdout.split('\n').slice(-12).join(' | '))
  console.log('DEBUG clips db', JSON.stringify(await db.query('select clip_id, status from clips')))
  console.log('DEBUG api clips', Object.keys(lista.json), JSON.stringify(lista.json).slice(0, 300))
  for (const [n, r] of Object.entries({ subida, fuentes, lista, agenda })) {
    const t = JSON.stringify(r.json)
    const i = t.search(/[A-Za-z]:\\\\Users/)
    if (i >= 0) console.log('DEBUG ruta en', n, t.slice(Math.max(0, i - 80), i + 60))
  }
}
const todo = [subida, fuentes, lista, agenda].map((r) => JSON.stringify(r.json)).join(' ')
const ruta = /[A-Za-z]:\\\\Users\\\\|\/home\/[a-z]|\/Users\/[a-z]/i.exec(todo)
check('7. Ninguna respuesta del panel enseña rutas de usuario', ruta === null, ruta?.[0] ?? '')
const err = await api('/api/clips/no-existe/clip-99', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"status":"approved"}' })
check('7. Un error se explica sin detalle técnico', typeof err.json.error === 'string' && !/at \w+ \(|Error:|\\\\/.test(String(err.json.error)), String(err.json.error))

await pg.close()
rmSync(TMP, { recursive: true, force: true })

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
process.exit(fallidas.length > 0 ? 1 : 0)
