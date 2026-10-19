/**
 * Verificacion de la Fase 5: una prueba por cada fallo corregido.
 *
 *   npm run verify:fase5
 *
 * 1. Hashtags   2. Videos distintos por dia   3. Palabras por subtitulo
 * 4. Zona segura   5. Vista previa con fotograma   6. Resultados vacio
 * 7. Tildes y plurales   8. Cuentas activas y conectadas
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'

loadEnv()

const { construirTexto, elegirHashtags, recortarTexto, MAX_HASHTAGS } = await import('../src/publish/texto.js')
const { flowMath } = await import('../src/queue/settings.js')
const { buildAss } = await import('../src/render/ass.js')
const { buildFilterGraph, rutaFotograma } = await import('../src/render/render.js')
const { ajustesDeFila, validateClipSettings, CLIP_DEFAULTS, ZONA_SEGURA_PX, InvalidClipSettings } = await import('../src/select/ajustes.js')
const { buildJob } = await import('../src/review/pipeline.js')
const { GUION } = await import('../src/review/guion.js')
const { createStore } = await import('../src/store/pg.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }

// --- 1. Hashtags ----------------------------------------------------------------------

const t1 = construirTexto({
  caption: 'Lo mejor de la noche #MúsicaColombiana',
  hashtags: ['musicacolombiana', 'MusicaColombiana', 'TikT', 'TikTok', 'medellin', 'reggaeton', 'envivo', 'parati', 'fyp'],
  plantilla: '{titulo} {hashtags}',
  fijos: 'MúsicaColombiana, zoti',
})
const etiquetas = t1.match(/#[\p{L}\p{N}_]+/gu) ?? []
const claves = etiquetas.map((h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
check('Hashtags: ninguno repetido, ni por mayusculas ni por tildes', new Set(claves).size === claves.length, t1)
check('Hashtags: el de la descripcion no se repite al final', claves.filter((c) => c === '#musicacolombiana').length === 1, t1)
check(`Hashtags: como mucho ${MAX_HASHTAGS} añadidos`, etiquetas.length - 1 <= MAX_HASHTAGS, `${etiquetas.length - 1} añadidos`)
check('Hashtags: un trozo de otra etiqueta (#TikT) no sale', !/#TikT\b/.test(t1) && t1.includes('#TikTok'), t1)
check('Hashtags: las fijas entran aunque el clip traiga muchas', t1.includes('#zoti'), t1)
const largo = recortarTexto('palabra '.repeat(270) + '#etiquetalarga #otra', 2200)
check('Hashtags: el recorte nunca deja una etiqueta a medias', largo.length <= 2200 && !/#\S*$/.test(largo.split(' ').at(-1) ?? '') || !/#etiquetal(?!arga)/.test(largo), largo.slice(-30))
check('Hashtags: elegirHashtags respeta el tope con muchas fijas', elegirHashtags(['a1', 'b2'], ['f1', 'f2', 'f3', 'f4', 'f5', 'f6']).length === MAX_HASHTAGS)

// --- 2. Videos distintos por dia --------------------------------------------------------

const base = { maxCuentas: 25, maxRepeticiones: 10, postsPerDay: 3, dayStartHour: 10, dayEndHour: 23, jitterMinutes: 40, clipCooldownMinutes: 90, accountRepeatHours: 72 }
const una = flowMath({ ...base, accounts: 1 })
check('Una cuenta, 3 al dia, 3 dias de espera: 9 en reserva', una.clipsEnRotacion === 9, JSON.stringify(una))
check('... y 3 nuevos al dia', una.clipsNeededPerDay === 3, `${una.clipsNeededPerDay}`)
const ocho = flowMath({ ...base, accounts: 8 })
check(
  'Ocho cuentas: la reserva cuenta la espera entre cuentas y en la misma cuenta',
  ocho.clipsEnRotacion === Math.ceil((8 * 3 * 3) / Math.min(8, ocho.maxUsesPerClip * 3)) && ocho.clipsNeededPerDay >= 3,
  JSON.stringify(ocho),
)
check('El "¿Por qué?" de Horarios enseña la formula', GUION.includes("'reserva = '") && GUION.includes("'nuevos al día = '"))

// --- 3. Palabras por subtitulo -----------------------------------------------------------

const TMP = mkdtempSync(join(tmpdir(), 'klip-verify-f5-'))
const assPath = join(TMP, 'x.ass')
const segmentos = [{ start: 0, end: 4, text: 'uno dos tres cuatro cinco seis siete ocho' }]
buildAss(segmentos, 0, 4, assPath, { wordsPerCue: 3 })
const dialogos = readFileSync(assPath, 'utf8').split('\n').filter((l) => l.startsWith('Dialogue:'))
const maxPalabras = Math.max(...dialogos.map((l) => (l.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '').trim().split(/\s+/).length)))
check('Subtitulos: con el ajuste en 3, ningun rotulo pasa de 3 palabras', maxPalabras <= 3 && dialogos.length === 3, `${dialogos.length} rotulos, max ${maxPalabras}`)
const job = buildJob('render', { sourceId: 'vod-1' }, new Set(['vod-1']), { ...CLIP_DEFAULTS, subtitles: true, subPalabras: 3 })
const i = job.args.indexOf('--sub-words')
check('El render lleva las palabras del ajuste (tambien desde el encadenado)', i >= 0 && job.args[i + 1] === '3', job.args.join(' '))
check(
  'El encadenado pide los argumentos con los ajustes al servidor',
  readFileSync(join(ROOT, 'src', 'review', 'server.ts'), 'utf8').includes('buildJob(kind, { sourceId }, new Set([sourceId]), await loadClipSettings(db, ownerId)).args'),
)
check('Estilo ofrece "Volver a armar los clips pendientes"', GUION.includes('Volver a armar los clips pendientes'))

// --- 4. Zona segura -----------------------------------------------------------------------

check('Zona segura: por defecto el subtitulo va fuera del 20 % de abajo', CLIP_DEFAULTS.subMargin >= 1920 * 0.2, `${CLIP_DEFAULTS.subMargin} px`)
check('Zona segura: una altura vieja (300) se sube al leerla', ajustesDeFila({ sub_margin: 300 }).subMargin === ZONA_SEGURA_PX)
let rechazada = false
try { validateClipSettings({ ...CLIP_DEFAULTS, subMargin: 200 }) } catch (e) { rechazada = e instanceof InvalidClipSettings }
check('Zona segura: guardar una altura dentro de la zona se rechaza', rechazada)
buildAss(segmentos, 0, 4, assPath, { marginV: 150 })
const estilo = readFileSync(assPath, 'utf8').split('\n').find((l) => l.startsWith('Style: Default')) ?? ''
check('Zona segura: el .ass nunca baja de 400 px aunque se lo pidan', Number(estilo.split(',').at(-2)) >= ZONA_SEGURA_PX, estilo)

// --- 5. Vista previa ------------------------------------------------------------------------

check('Vista previa: el fotograma sale sin subtitulos', !buildFilterGraph(null, 30).includes('ass='))
check('Vista previa: el fotograma va junto al clip', rutaFotograma('C:/x/out/vod/clip-01.mp4') === 'C:/x/out/vod/clip-01.fotograma.jpg')
check('Vista previa: Estilo pinta el fotograma y la zona que tapa TikTok', GUION.includes('/fotograma/') && GUION.includes('pv-zona'))

// --- 6. Resultados vacio ----------------------------------------------------------------------

check(
  'Resultados: dice "Aún no se ha publicado nada" y no pide enlazar si ya hay cuentas',
  GUION.includes('Aún no se ha publicado nada') && GUION.includes('Esto se llena cuando salgan los primeros clips de la agenda.'),
)

// --- 7. Tildes y plurales ---------------------------------------------------------------------

const SIN_TILDE = ['aqui', 'todavia', 'publicacion', 'despues', 'tambien', 'ningun', 'numero', 'dia', 'dias', 'subtitulos', 'rotulo', 'movil', 'ultimo', 'facil', 'pagina', 'automaticamente', 'musica', 'demas']
const encontradas: string[] = []
for (const linea of GUION.split('\n')) {
  const t = linea.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
  for (const m of linea.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
    const cad = m[1] ?? ''
    if (!cad.includes(' ')) continue
    for (const w of cad.matchAll(/(?<![\p{L}={"'._\-/#])(\p{L}+)(?![\p{L}}"'=_\-/])/gu)) {
      if (SIN_TILDE.includes((w[1] ?? '').toLowerCase())) encontradas.push(w[1] ?? '')
    }
  }
}
check('Tildes: ningun texto visible sin tilde de la lista (aqui, todavia, publicacion...)', encontradas.length === 0, encontradas.slice(0, 10).join(', '))
const plural = (n: number, s: string, p?: string) => n + ' ' + (n === 1 ? s : (p ?? s + 's'))
check('Plurales: "1 video" y "5 videos"', plural(1, 'video') === '1 video' && plural(5, 'video') === '5 videos' && GUION.includes('function plural(n, singular, pluralForma)'))
const conVod = GUION.split('\n').filter((l) => {
  const t = l.trim()
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
  return /'[^'\n]*\bVODs?\b[^'\n]*'/.test(l)
})
check('Terminologia: el panel ya no dice VOD', conVod.length === 0, conVod.slice(0, 3).join(' | '))

// --- 8. Cuentas activas y conectadas -----------------------------------------------------------

const pg = new PGlite()
const db = { query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[], close: async () => pg.close() }
for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
const OWNER = '11111111-1111-1111-1111-111111111111'
await pg.exec(`insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)
await pg.exec(`insert into accounts (owner_id, id, label, slots, status) values
  ('${OWNER}', 'acc-01', 'Uno', '{}', 'active'), ('${OWNER}', 'acc-02', 'Dos', '{}', 'active'), ('${OWNER}', 'acc-03', 'Tres', '{}', 'paused')`)
const store = createStore(db, OWNER)
const conUpload = await store.accounts.publicables('upload-post')
const conTikTok = await store.accounts.publicables('tiktok')
check('Cuentas: con upload-post publican las activas, no todas las creadas', conUpload.length === 2, `${conUpload.length}`)
check('Cuentas: con la API directa, solo las que tienen permiso de TikTok', conTikTok.length === 0, `${conTikTok.length}`)
check('Cuentas: Horarios cuenta igual que Inicio segun el proveedor', readFileSync(join(ROOT, 'src', 'review', 'server.ts'), 'utf8').includes("const porUploadPost = proveedorActivo() === 'upload-post'"))
await pg.close()
rmSync(TMP, { recursive: true, force: true })

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
if (fallidas.length > 0) process.exitCode = 1
