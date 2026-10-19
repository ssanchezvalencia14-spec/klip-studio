/**
 * Verificacion de la IA con la suscripcion (Fase 1).
 *
 *   npm run verify:ia
 *
 * Sin red y sin gastar uso: Claude Code se sustituye por un falso
 * (scripts/fixtures/claude-falso.mjs) que imita su salida JSON y apunta lo que
 * recibio. La base es PGlite en memoria.
 *
 * Lo que se comprueba es lo que pide la fase: entorno limpio (sin
 * ANTHROPIC_API_KEY aunque este puesta), prompt por stdin, sin herramientas,
 * tiempo maximo, una llamada a la vez, JSON validado con un solo reintento,
 * cache, deteccion de sesion y limite, y la pausa de la cola sin bucles.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'

loadEnv()

// Todo lo de esta prueba vive en una carpeta temporal.
const TMP = mkdtempSync(join(tmpdir(), 'klip-verify-ia-'))
const FALSO = join(ROOT, 'scripts', 'fixtures', 'claude-falso.mjs')
const GUION = join(TMP, 'guion.json')
const REGISTRO = join(TMP, 'registro.ndjson')

process.env.WORK_DIR = join(TMP, 'work')
process.env.STATE_DIR = join(TMP, 'state')
process.env.LLM_PROVIDER = 'claude-cli'
process.env.CLAUDE_CLI_PATH = FALSO
process.env.LLM_MODEL = 'sonnet'
process.env.LLM_TIMEOUT_MS = '20000'
// A proposito: una clave mala y restos de una sesion de Claude Code. El CLI
// no debe ver ninguna de las dos.
process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-clave-mala-a-proposito'
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'
process.env.CLAUDECODE = '1'
process.env.CLAUDE_CODE_ENTRYPOINT = 'prueba'
process.env.KLIP_FALSO_GUION = GUION
process.env.KLIP_FALSO_REGISTRO = REGISTRO

const { ClaudeCliProveedor } = await import('../src/llm/provider.js')
const { entornoLimpio } = await import('../src/llm/claude-cli.js')
const { ErrorIA, clasificarSalidaCli, leerHoraDeVuelta } = await import('../src/llm/errores.js')
const { LlmSelectionProvider } = await import('../src/llm/seleccion.js')
const { selectClips } = await import('../src/select/select.js')
const { clasificarFallo } = await import('../src/select/fallo.js')
const { createCola } = await import('../src/jobs/cola.js')
const { createEstadoIA, iaPausada, KINDS_DE_IA, leerMarca, textoEstadoIA } = await import('../src/llm/estado.js')
const { MomentoSchema } = await import('../src/llm/esquema.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => {
  checks.push({ name, ok, detail })
}

type Paso = { texto?: string; error?: string; status?: number; dormir?: number; crudo?: string; codigo?: number }

function guion(pasos: Paso[]): void {
  writeFileSync(GUION, JSON.stringify(pasos))
  rmSync(`${GUION}.n`, { force: true })
  rmSync(REGISTRO, { force: true })
  rmSync(join(process.env.WORK_DIR!, 'ia-cache'), { recursive: true, force: true })
}

interface Llamada {
  n: number; inicio: number; fin: number; args: string[]; cwd: string
  stdinLargo: number; stdinEmpieza: string
  tieneClaveApi: boolean; tieneAnthropic: boolean; tieneClaudeCode: boolean
}
function llamadas(): Llamada[] {
  if (!existsSync(REGISTRO)) return []
  return readFileSync(REGISTRO, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Llamada)
}

async function falla(p: Promise<unknown>): Promise<InstanceType<typeof ErrorIA> | Error | null> {
  try {
    await p
    return null
  } catch (e) {
    return e as Error
  }
}

const llm = (timeoutMs = 20_000) => new ClaudeCliProveedor(FALSO, 'sonnet', timeoutMs)

// --- Entorno, banderas y stdin ----------------------------------------------------

const limpio = entornoLimpio({ ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'y', CLAUDECODE: '1', CLAUDE_CODE_SSE_PORT: '1', PATH: 'p' })
check(
  'El entorno del CLI no lleva ANTHROPIC_* ni restos de Claude Code',
  Object.keys(limpio).join(',') === 'PATH',
  Object.keys(limpio).join(','),
)

guion([{ texto: 'hola' }])
const largo = 'x'.repeat(200_000)
const r1 = await llm().completar('sistema', `INICIO ${largo}`)
const [ll1] = llamadas()
check('Responde con el texto del CLI', r1.texto === 'hola', r1.texto)
check(
  'Con una ANTHROPIC_API_KEY mala en el entorno, el CLI no la ve',
  ll1 !== undefined && !ll1.tieneClaveApi && !ll1.tieneAnthropic && !ll1.tieneClaudeCode,
  JSON.stringify({ clave: ll1?.tieneClaveApi, anthropic: ll1?.tieneAnthropic, claudeCode: ll1?.tieneClaudeCode }),
)
check(
  'El prompt va por stdin, no en los argumentos (200.000 caracteres)',
  ll1 !== undefined && ll1.stdinLargo === largo.length + 7 && !ll1.args.some((a) => a.includes('xxxx')),
  `stdin=${ll1?.stdinLargo}`,
)
const args = ll1?.args ?? []
const tras = (b: string) => args[args.indexOf(b) + 1]
check(
  'Banderas: -p, JSON, sin herramientas, 1 turno, modo seguro, sin MCP ni sesion',
  args.includes('-p') && tras('--output-format') === 'json' && tras('--tools') === '' &&
    tras('--max-turns') === '1' && args.includes('--safe-mode') && args.includes('--strict-mcp-config') &&
    args.includes('--no-session-persistence') && tras('--model') === 'sonnet',
  args.filter((a) => a.startsWith('-')).join(' '),
)
check(
  'Corre en una carpeta temporal propia que se borra al terminar',
  ll1 !== undefined && ll1.cwd.includes('klip-ia-') && !existsSync(ll1.cwd),
  ll1 ? 'carpeta temporal borrada' : 'sin registro',
)

// --- Fallos del CLI ---------------------------------------------------------------

guion([{ error: 'Not logged in · Please run /login' }])
const eSesion = await falla(llm().completar('s', 'u'))
check(
  'Sin sesion (texto real del CLI 2.1.299) se detecta como sin_sesion',
  eSesion instanceof ErrorIA && eSesion.clase === 'sin_sesion' && eSesion.pausaLaCola,
  eSesion instanceof ErrorIA ? eSesion.clase : String(eSesion),
)
check(
  'El mensaje de sin sesion dice que hacer, sin rutas ni .env',
  eSesion instanceof Error && eSesion.message.includes('/login') && !eSesion.message.includes('.env') && !/[A-Z]:\\/.test(eSesion.message),
  eSesion?.message ?? '',
)

guion([{ error: "You've hit your limit · resets 3pm (America/Bogota)", status: 429 }])
const eLimite = await falla(llm().completar('s', 'u'))
check(
  'Limite de uso con hora: se detecta y trae la hora de vuelta',
  eLimite instanceof ErrorIA && eLimite.clase === 'limite' && eLimite.reanudarEn?.getHours() === 15,
  eLimite instanceof ErrorIA ? `${eLimite.clase} ${eLimite.reanudarEn?.toString()}` : String(eLimite),
)
const epoch = leerHoraDeVuelta('Claude AI usage limit reached|1760000000')
check('Formato antiguo del limite (segundos Unix)', epoch?.getTime() === 1760000000 * 1000, epoch?.toISOString() ?? 'nada')
const manana = leerHoraDeVuelta('resets 1am', new Date(2026, 9, 19, 22, 0))
check('Una hora ya pasada hoy se entiende como de mañana', manana?.getDate() === 20 && manana.getHours() === 1, manana?.toString() ?? '')
check(
  'Un 401 del CLI es falta de sesion',
  clasificarSalidaCli('Invalid API key · Please run /login', 401).clase === 'sin_sesion',
)

guion([{ dormir: 8000, texto: 'tarde' }])
const t0 = Date.now()
const eTiempo = await falla(llm(1500).completar('s', 'u'))
check(
  'Tiempo maximo: se mata el proceso y falla como tiempo agotado',
  eTiempo instanceof ErrorIA && eTiempo.clase === 'tiempo' && Date.now() - t0 < 6000,
  `${eTiempo instanceof ErrorIA ? eTiempo.clase : String(eTiempo)} en ${Date.now() - t0} ms`,
)

const eNo = await falla(new ClaudeCliProveedor(join(TMP, 'no-existe', 'claude.exe'), 'sonnet', 5000).completar('s', 'u'))
check(
  'CLI no encontrado se detecta como tal',
  eNo instanceof ErrorIA && eNo.clase === 'no_encontrado',
  eNo instanceof ErrorIA ? eNo.clase : String(eNo),
)

guion([{ crudo: 'Error: algo raro paso antes de arrancar', codigo: 2 }])
const eCrudo = await falla(llm().completar('s', 'u'))
check('Una salida que no es JSON no rompe nada: falla como "otro"', eCrudo instanceof ErrorIA && eCrudo.clase === 'otro')

// --- Una llamada a la vez -----------------------------------------------------------

guion([{ dormir: 700, texto: 'a' }, { dormir: 700, texto: 'b' }, { dormir: 700, texto: 'c' }])
await Promise.all([llm().completar('s', '1'), llm().completar('s', '2'), llm().completar('s', '3')])
const serie = llamadas().sort((a, b) => a.inicio - b.inicio)
const solapan = serie.some((c, i) => i > 0 && c.inicio < (serie[i - 1]?.fin ?? 0))
check('Tres llamadas a la vez se hacen de una en una', serie.length === 3 && !solapan, serie.map((c) => `${c.inicio % 100000}-${c.fin % 100000}`).join(' '))

// --- Esquema, reintento unico y cache -------------------------------------------------

const momento = {
  inicio: 1, fin: 10, titulo: 'Lo que nadie cuenta del estudio',
  gancho: 'Frase numero 1 del video de prueba', descripcion: 'Un momento de prueba',
  hashtags: ['prueba', 'clips', 'tiktok'], puntaje_gancho: 80, puntaje_cierre: 70,
  puntaje_retencion: 75, puntaje_total: 78, motivo: 'Funciona solo.',
}
check('El esquema acepta un momento correcto', MomentoSchema.safeParse(momento).success)
check(
  'El esquema rechaza un titulo de mas de 8 palabras',
  !MomentoSchema.safeParse({ ...momento, titulo: 'uno dos tres cuatro cinco seis siete ocho nueve' }).success,
)
check(
  'El esquema rechaza un titulo que repite la primera frase',
  !MomentoSchema.safeParse({ ...momento, titulo: 'Frase numero 1 del video' }).success,
)

const transcript = {
  sourceId: 'vod-prueba',
  language: 'es',
  durationSec: 120,
  hasWordTimestamps: false,
  segments: Array.from({ length: 40 }, (_, i) => ({
    start: i * 3, end: i * 3 + 3, text: `Frase numero ${i + 1} del video de prueba`,
  })),
}

const valido = JSON.stringify({ momentos: [momento] })

guion([{ texto: 'no es json' }, { texto: '```json\n' + valido + '\n```' }])
const sel1 = await selectClips(transcript)
check(
  'JSON roto: un reintento con el error y luego vale',
  sel1.clips.length === 1 && llamadas().length === 2,
  `${sel1.clips.length} clip(s), ${llamadas().length} llamada(s)`,
)
const segundo = llamadas()[1]
check('El reintento le dice a la IA que fallo', segundo !== undefined && segundo.stdinLargo > (llamadas()[0]?.stdinLargo ?? 0))
check(
  'El clip trae titulo, desglose del puntaje y segundos reales',
  sel1.clips[0]?.titulo === momento.titulo && sel1.clips[0]?.puntajes?.cierre === 70 &&
    sel1.clips[0]?.start === 0 && sel1.clips[0]?.end === 30,
  JSON.stringify(sel1.clips[0] ?? {}).slice(0, 160),
)
check('Un video corto va en un solo bloque', sel1.windows === 1, `${sel1.windows} bloque(s)`)
check(
  'Registro de uso: proveedor, modelo y "incluido en la suscripcion"',
  sel1.proveedor === 'claude-cli' && sel1.modelo === 'sonnet' && sel1.incluidoEnSuscripcion && sel1.usage.estimatedUsd === null,
  `${sel1.proveedor} ${sel1.modelo} usd=${sel1.usage.estimatedUsd}`,
)
const clipsJson = join(process.env.WORK_DIR!, 'vod-prueba', 'clips.json')
check('Escribe clips.json', existsSync(clipsJson))

// Cache: misma transcripcion y mismos parametros, cero llamadas nuevas.
rmSync(REGISTRO, { force: true })
const sel2 = await selectClips(transcript)
check('Cache: repetir la misma seleccion no llama a la IA', sel2.clips.length === 1 && llamadas().length === 0 && sel2.llamadas === 0, `${llamadas().length} llamada(s)`)

guion([{ texto: 'nada' }, { texto: 'tampoco' }, { texto: 'ni esto' }])
const sel3 = await selectClips(transcript)
check(
  'JSON roto dos veces: falla limpio tras 2 llamadas, sin bucle',
  sel3.clips.length === 0 && llamadas().length === 2 && sel3.motivoCorte?.clase === 'respuesta_invalida',
  `${llamadas().length} llamada(s), ${sel3.motivoCorte?.clase}`,
)

// Presupuesto: dos tiempos agotados y un JSON roto no dan para mas de 3 llamadas.
const prov = new LlmSelectionProvider(llm(1200))
guion([{ dormir: 4000, texto: 'x' }, { dormir: 4000, texto: 'x' }, { dormir: 4000, texto: 'x' }, { texto: valido }])
const ePres = await falla(prov.select('s', 'u', 3))
check(
  'Maximo 2 reintentos por tarea: tres llamadas como mucho',
  ePres instanceof ErrorIA && prov.llamadas === 3,
  `${prov.llamadas} llamada(s), ${ePres instanceof ErrorIA ? ePres.clase : String(ePres)}`,
)

guion([{ error: 'Not logged in · Please run /login' }, { error: 'Not logged in · Please run /login' }])
const sel4 = await selectClips({ ...transcript, sourceId: 'vod-sin-sesion' })
check(
  'Sin sesion: una sola llamada y la tarea queda para esperar, no para reintentar',
  llamadas().length === 1 && sel4.motivoCorte?.esperaIA?.estado === 'sin_sesion',
  `${llamadas().length} llamada(s), ${JSON.stringify(sel4.motivoCorte?.esperaIA)}`,
)
check('Sin sesion no machaca un clips.json anterior', !existsSync(join(process.env.WORK_DIR!, 'vod-sin-sesion', 'clips.json')))

const fLim = clasificarFallo(new ErrorIA('limite', 'x', new Date('2030-01-01T15:00:00Z')))
check('Un limite se marca para esperar con su hora', fLim.esperaIA?.estado === 'limite' && fLim.esperaIA.reanudarEn === '2030-01-01T15:00:00.000Z')

// --- El script select de punta a punta --------------------------------------------------

const idScript = 'vod-script'
mkdirSync(join(process.env.WORK_DIR!, idScript), { recursive: true })
writeFileSync(join(process.env.WORK_DIR!, idScript, 'transcript.json'), JSON.stringify({ ...transcript, sourceId: idScript }))
guion([{ error: "You've hit your limit · resets 4pm" }])
const TSX = createRequire(import.meta.url).resolve('tsx/cli')
const sal = spawnSync(process.execPath, [TSX, 'scripts/select.ts', idScript], { cwd: ROOT, env: process.env, encoding: 'utf8' })
const lineas = `${sal.stdout}`.split('\n').map((l) => l.trim()).filter(Boolean)
const marca = leerMarca(lineas)
check(
  'npm run select con limite: sale con 75 y deja la marca de espera',
  sal.status === 75 && marca?.espera === true && marca.marca.estado === 'limite' && marca.marca.reanudarEn !== undefined,
  `codigo ${sal.status}, marca ${JSON.stringify(marca?.marca ?? null)}`,
)
check(
  'La ultima linea es una frase para la pantalla, no la marca',
  !(lineas.at(-1) ?? '').startsWith('[klip-') && (lineas.at(-1) ?? '').includes('límite'),
  lineas.at(-1) ?? '',
)

// --- La cola se pausa y se reanuda --------------------------------------------------------

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
const cola = createCola(db, OWNER)
const ia = createEstadoIA(db, OWNER)

const jSel = await cola.encolar('select', ['vod-1'], 'Elegir momentos de vod-1')
await cola.coger('pc-1')
await cola.terminar(jSel.id, 'en_espera_ia', 75, ['La IA llegó al límite de uso.'])
const vuelta = new Date(Date.now() + 60 * 60_000).toISOString()
await ia.guardar({ estado: 'limite', mensaje: 'x', reanudarEn: vuelta, proveedor: 'claude-cli', modelo: 'sonnet' })
const jSel2 = await cola.encolar('select', ['vod-2'], 'Elegir momentos de vod-2')
const jRender = await cola.encolar('render', ['vod-3'], 'Renderizar vod-3')

const info1 = await ia.leer()
check('La migracion admite en_espera_ia y guarda el estado', (await cola.porId(jSel.id))?.status === 'en_espera_ia' && info1.estado === 'limite')
check('Con limite, la IA cuenta como pausada', iaPausada(info1))
check('El texto dice a que hora vuelve', /^IA con límite, vuelve a las \d\d:\d\d$/.test(textoEstadoIA(info1)), textoEstadoIA(info1))
const cogida = await cola.coger('pc-1', iaPausada(info1) ? KINDS_DE_IA : [])
check('En pausa, el trabajador salta la IA y sigue con un render', cogida?.id === jRender.id, `${cogida?.kind}`)
check('En pausa, no hay nada mas que coger', (await cola.coger('pc-1', KINDS_DE_IA)) === null)
check('Antes de la hora no se reanuda nada', (await ia.reanudar()) === 0)
check('Un paso en espera cuenta como pedido: el encadenado no lo repite', await cola.hayActiva(['select'], 'vod-1'))

await pg.query(`update ia_estado set reanudar_en = now() - interval '1 minute' where owner_id = $1`, [OWNER])
const reanudadas = await ia.reanudar()
check('Pasada la hora, lo que esperaba vuelve solo a la cola', reanudadas === 1 && (await cola.porId(jSel.id))?.status === 'queued', `${reanudadas}`)
check('Y la IA deja de estar en pausa', !iaPausada(await ia.leer()))
check('Las tareas de IA se vuelven a coger', (await cola.coger('pc-1', []))?.kind === 'select')

await ia.guardar({ estado: 'sin_sesion', mensaje: 'x' })
await cola.terminar(jSel2.id, 'en_espera_ia', 75, [])
check('Sin sesion no se reanuda sola', (await ia.reanudar()) === 0 && iaPausada(await ia.leer()))
check('El texto de sin sesion es el del plan', textoEstadoIA(await ia.leer()) === 'IA sin sesión (abre Claude Code en tu PC y ejecuta /login)')
check('"Reintentar" la reanuda a mano', (await ia.reanudar(true)) === 1 && !iaPausada(await ia.leer()))

await ia.guardar({ estado: 'lista', mensaje: '' })
check('IA lista', textoEstadoIA(await ia.leer()) === 'IA lista')

await pg.close()
rmSync(TMP, { recursive: true, force: true })

// --- Informe ---------------------------------------------------------------------------

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (c.detail !== '' && !c.ok) console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
if (fallidas.length > 0) process.exitCode = 1
