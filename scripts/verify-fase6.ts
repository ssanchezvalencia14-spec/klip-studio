/**
 * Verificacion de la Fase 6: calidad de clips y edicion.
 *
 *   npm run verify:fase6
 *
 * 1. Deteccion y seguimiento de caras (datos sinteticos, sin modelo)
 * 2. Encuadre en el render y en Ajustes
 * 3. Muletillas y preferencias del prompt
 * 4. Edicion de titulo y subtitulos (base de prueba)
 * 5. Modo musica: energia, estribillo, drops y confianza de la letra
 * 6. El panel
 *
 * Lo que NO cubre: un render de verdad. El seguimiento en ffmpeg (sendcmd +
 * crop) y el realce de voz necesitan ffmpeg; se prueban con un video real.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'

loadEnv()

const { decodificar, nms, elegirCentros, suavizar, comandosCrop } = await import('../src/render/rostros.js')
const { buildFilterGraphRostro } = await import('../src/render/render.js')
const { validateClipSettings, ajustesDeFila, CLIP_DEFAULTS, InvalidClipSettings } = await import('../src/select/ajustes.js')
const { buildJob } = await import('../src/review/pipeline.js')
const { empiezaConMuletilla, puntajeConMuletilla, PENALIZACION_MULETILLA } = await import('../src/select/validate.js')
const musica = await import('../src/select/musica.js')
const { GUION } = await import('../src/review/guion.js')
const { createStore } = await import('../src/store/pg.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }
const fuente = (ruta: string[]): string => readFileSync(join(ROOT, ...ruta), 'utf8')

// --- 1. Caras ----------------------------------------------------------------------------

/*
 * Salidas falsas de YuNet: una sola ancla encendida en el paso 32. La caja
 * tiene que salir donde dice la formula de OpenCV.
 */
const W = 640
const salidas: Record<string, { data: Float32Array }> = {}
for (const s of [8, 16, 32]) {
  const n = (W / s) * (W / s)
  salidas[`cls_${s}`] = { data: new Float32Array(n) }
  salidas[`obj_${s}`] = { data: new Float32Array(n) }
  salidas[`bbox_${s}`] = { data: new Float32Array(n * 4) }
  salidas[`kps_${s}`] = { data: new Float32Array(n * 10) }
}
const cols = W / 32
const ancla = 5 * cols + 7 // fila 5, columna 7
salidas.cls_32!.data[ancla] = 0.9
salidas.obj_32!.data[ancla] = 0.9
salidas.bbox_32!.data.set([0.5, 0.5, Math.log(3), Math.log(4)], ancla * 4)
const caras = decodificar(salidas, W, W)
const c0 = caras[0]
check(
  'Caras: la caja de YuNet se decodifica como en OpenCV',
  caras.length === 1 && c0 !== undefined && Math.abs(c0.x + c0.w / 2 - 7.5 * 32) < 0.01 &&
    Math.abs(c0.w - 96) < 0.01 && Math.abs(c0.h - 128) < 0.01 && Math.abs(c0.score - 0.9) < 0.001,
  JSON.stringify(c0),
)
salidas.cls_32!.data[ancla] = 0.3
check('Caras: por debajo del umbral no hay cara', decodificar(salidas, W, W).length === 0)

const cara = (x: number, score = 0.9, bocaY = 0): { x: number; y: number; w: number; h: number; score: number; kps: number[] } =>
  ({ x, y: 100, w: 100, h: 120, score, kps: [x + 30, 140, x + 70, 140, x + 50, 170, x + 35, 190 + bocaY, x + 65, 190 + bocaY] })
check('Caras: dos detecciones de la misma cara se quedan en una (NMS)', nms([cara(100), cara(105, 0.8), cara(400)]).length === 2)

/*
 * Dos personas: la de la izquierda (x=100) quieta, la de la derecha (x=500)
 * moviendo la boca a partir del segundo 3. El encuadre empieza en una y
 * pasa a la que habla, sin saltar en cada fotograma.
 */
const muestras = []
for (let k = 0; k <= 30; k += 1) {
  const t = k / 3
  const habla = t >= 3 ? (k % 2 === 0 ? 12 : -12) : 0
  muestras.push({ t, caras: [cara(100, 0.9, 0), cara(500, 0.9, habla)] })
}
const centros = elegirCentros(muestras, 640)
// La ventana de actividad es de +-1 s: el cambio puede llegar hasta 1 s
// antes de que hable, que en montaje es lo correcto (se corta antes de la voz).
const antes = centros.filter((c) => c.t < 1.9).map((c) => c.cx)
const despues = centros.filter((c) => c.t > 6).map((c) => c.cx)
check(
  'Seguimiento: sigue a quien mueve la boca',
  despues.every((cx) => cx === 550) && antes.every((cx) => cx === 150),
  `antes ${[...new Set(antes)]} despues ${[...new Set(despues)]}`,
)
let cambios = 0
for (let i = 1; i < centros.length; i += 1) if (centros[i]!.cx !== centros[i - 1]!.cx) cambios += 1
check('Seguimiento: no salta de una cara a otra en cada fotograma', cambios <= 2, `${cambios} cambios`)
const sinCaras = elegirCentros([{ t: 0, caras: [cara(300)] }, { t: 0.33, caras: [] }, { t: 0.66, caras: [] }], 640)
check('Seguimiento: si la cara se pierde un momento, el encuadre se queda donde estaba', sinCaras.every((c) => c.cx === 350), JSON.stringify(sinCaras))

const suave = suavizar([{ t: 0, cx: 0 }, { t: 0.33, cx: 0 }, { t: 0.66, cx: 300 }, { t: 1, cx: 300 }])
check('Suavizado: el cambio se reparte en vez de dar un salto', suave[1]!.cx > 0 && suave[2]!.cx < 300, JSON.stringify(suave))

// Fuente 1920x1080, ventana 9:16 de 608 px; los centros estan medidos a 640 px de ancho.
const cmd = comandosCrop([{ t: 0, cx: 0 }, { t: 2, cx: 640 }], 3, 1920, 608, 2)
const xs = cmd.texto.trim().split('\n').map((l) => Number(/crop x (\d+);/.exec(l)?.[1]))
check(
  'Recorte: la ventana nunca se sale del video y va en pixeles pares',
  xs.every((x) => x >= 0 && x <= 1920 - 608 && x % 2 === 0) && cmd.x0 === 0 && xs.at(-1) === 1312,
  `${xs.length} comandos, de ${xs[0]} a ${xs.at(-1)}`,
)
check('Recorte: un comando cada 0,1 s', xs.length === 21 && /^0\.00 crop x \d+;\n0\.10 crop x/.test(cmd.texto), cmd.texto.slice(0, 40))

// --- 2. Encuadre en render y Ajustes ----------------------------------------------------

const grafo = buildFilterGraphRostro('C:/w/x.ass', { anchoCrop: 608, altoCrop: 1080, x0: 656, rutaComandos: 'C:/w/clip-01.encuadre.txt' })
check(
  'Render: el encuadre con cara recorta, escala a 1080x1920 y quema los subtitulos',
  grafo.includes('sendcmd=f=') && grafo.includes('crop=w=608:h=1080:x=656:y=0') &&
    grafo.includes('scale=1080:1920') && grafo.includes('ass=') && !grafo.includes('gblur'),
  grafo,
)
const foto = buildFilterGraphRostro(null, { anchoCrop: 608, altoCrop: 1080, x0: 656, rutaComandos: null })
check('Render: el fotograma limpio usa el mismo recorte, sin comandos ni subtitulos', !foto.includes('sendcmd') && !foto.includes('ass=') && foto.endsWith('[vout]'), foto)
const render = fuente(['src', 'render', 'render.ts'])
check(
  'Render: sin plan de cara se usa el clasico (fondo borroso)',
  render.includes('plan === null ? buildFilterGraph(assPath, blurSigma) : buildFilterGraphRostro(assPath, plan)') &&
    /catch \(error\) \{\s*log\.warn\(`Clip \$\{index\}: no se pudo seguir la cara/.test(render),
)
check('Ajustes: el encuadre por defecto sigue la cara', CLIP_DEFAULTS.encuadre === 'rostro')
let rechazado = false
try { validateClipSettings({ ...CLIP_DEFAULTS, encuadre: 'otro' }) } catch (e) { rechazado = e instanceof InvalidClipSettings }
check('Ajustes: un encuadre que no existe se rechaza', rechazado)
check('Ajustes: una fila con basura cae al defecto', ajustesDeFila({ encuadre: 'x' }).encuadre === 'rostro' && ajustesDeFila({ encuadre: 'clasico' }).encuadre === 'clasico')
const jClasico = buildJob('render', { sourceId: 'v1' }, new Set(['v1']), { ...CLIP_DEFAULTS, encuadre: 'clasico' })
const jRostro = buildJob('render', { sourceId: 'v1' }, new Set(['v1']), { ...CLIP_DEFAULTS })
check(
  'Ajustes: el render recibe --encuadre clasico solo cuando toca',
  jClasico.args.join(' ').includes('--encuadre clasico') && !jRostro.args.includes('--encuadre'),
  jClasico.args.join(' '),
)
check('Estilo: el panel ofrece los dos encuadres', GUION.includes("'Siguiendo la cara'") && GUION.includes("'Clásico (fondo borroso)'"))

// --- 3. Muletillas y prompt -------------------------------------------------------------

check('Muletillas: "Bueno, ..." al empezar es muletilla', empiezaConMuletilla('Bueno, pues le dije que no'))
check('Muletillas: "No sé por qué" es una frase, no muletilla', !empiezaConMuletilla('No sé por qué lo hizo'))
check('Muletillas: restan puntos', puntajeConMuletilla(80, 'O sea, eso') === 80 - PENALIZACION_MULETILLA && puntajeConMuletilla(80, 'Lo que pasó') === 80)
const esquema = fuente(['src', 'llm', 'esquema.ts'])
check('Prompt: pide 20-60 s, sin muletilla y un titulo distinto de la primera frase', /20.{0,6}60/.test(esquema) && /muletilla/i.test(esquema) && /t[ií]tulo/i.test(esquema))

// --- 4. Edicion (base de prueba) --------------------------------------------------------

const pg = new PGlite()
const db = { query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[], close: async () => pg.close() }
for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
const OWNER = '11111111-1111-1111-1111-111111111111'
await pg.exec(`insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)
await pg.exec(`insert into sources (id, owner_id, title, duration_sec, has_transcript) values ('vod-6', '${OWNER}', 'Entrevista', 600, true)`)
const store = createStore(db, OWNER)
const segs = [{ start: 10, end: 13, text: 'primera frase' }, { start: 13, end: 16, text: 'segunda frase' }]
await store.clips.save([{
  sourceId: 'vod-6', clipId: 'clip-01', start: 10, end: 40, hook: 'Bueno, mira', reason: 'r', caption: 'c',
  hashtags: [], score: 70, status: 'pending', masterPath: '', proxyPath: '', proxyBytes: 0, reviewedAt: null,
  titulo: 'Titulo original', puntajes: { gancho: 80, cierre: 60, retencion: 70 }, segmentos: segs,
}])
const leido = (await store.clips.all())[0]
check(
  'Base: titulo, puntajes y segmentos se guardan y se leen',
  leido?.titulo === 'Titulo original' && leido.puntajes?.gancho === 80 && leido.segmentos?.length === 2,
  JSON.stringify(leido),
)
await store.clips.editar('vod-6', 'clip-01', { titulo: 'Nuevo titulo' })
const tras1 = (await store.clips.all())[0]
check('Edicion: cambiar el titulo no toca los subtitulos', tras1?.titulo === 'Nuevo titulo' && (tras1.subtitulos ?? null) === null)
await store.clips.editar('vod-6', 'clip-01', { subtitulos: [{ start: 10, end: 13, text: 'frase corregida' }] })
const tras2 = (await store.clips.all())[0]
check('Edicion: los subtitulos editados se guardan sin tocar el titulo', tras2?.titulo === 'Nuevo titulo' && tras2.subtitulos?.[0]?.text === 'frase corregida')
await store.clips.editar('vod-6', 'clip-01', { subtitulos: null })
check('Edicion: "Volver a los originales" borra la edicion', ((await store.clips.all())[0]?.subtitulos ?? null) === null)
const src6 = (await store.sources.all())[0]
check('Base: el video lleva su tipo (entrevista por defecto)', src6?.tipo === 'entrevista' && src6.confianzaLetra === null, JSON.stringify(src6))
await pg.close()

const server = fuente(['src', 'review', 'server.ts'])
check('Servidor: la ruta de edicion existe y limita el titulo', server.includes('/editar') && /90/.test(server) && server.includes('store.clips.editar('))
const renderScript = fuente(['scripts', 'render.ts'])
check('Render: usa el titulo y los subtitulos editados en el panel', renderScript.includes('ediciones(sourceId)'))

// --- 5. Musica --------------------------------------------------------------------------

// Un segundo de silencio y un segundo fuerte, a 16 kHz.
const rate = 16000
const pcm = new Int16Array(rate * 20)
for (let i = 0; i < pcm.length; i += 1) {
  const t = i / rate
  const fuerte = t >= 10
  pcm[i] = Math.round(Math.sin(2 * Math.PI * 220 * t) * (fuerte ? 20000 : 1500))
}
const db20 = musica.energia(pcm, rate)
check('Musica: la energia sale por cada medio segundo', db20.length === 40, `${db20.length}`)
const norm = musica.normalizarEnergia(db20)
check('Musica: lo fuerte se normaliza a 1 y lo suave a 0', norm[5] === 0 && norm[30] === 1, `${norm[5]} ${norm[30]}`)
const listaDrops = musica.drops(norm)
check('Musica: el cambio fuerte del segundo 10 es un drop', listaDrops.length === 1 && Math.abs(listaDrops[0]! - 10) <= 0.5, JSON.stringify(listaDrops))

const letra = [
  { start: 0, end: 3, text: 'empieza la cancion despacio' },
  { start: 3, end: 6, text: 'baila conmigo hasta el amanecer' },
  { start: 6, end: 9, text: 'otra linea distinta del verso' },
  { start: 9, end: 12, text: 'Baila conmigo, hasta el amanecer!' },
  { start: 12, end: 15, text: 'oh oh' },
  { start: 15, end: 18, text: 'oh oh' },
]
const reps = musica.repeticiones(letra)
check('Estribillo: la misma linea con otros signos cuenta como repetida', reps[1] === 2 && reps[3] === 2 && reps[0] === 1, JSON.stringify(reps))
check('Estribillo: "oh oh" no cuenta, es relleno', reps[4] === 1)

const buena = musica.confianzaLetra(letra, 20)
const bucle = musica.confianzaLetra(Array.from({ length: 10 }, (_, i) => ({ start: i * 3, end: i * 3 + 3, text: 'gracias por ver el video' })), 30)
const ruido = musica.confianzaLetra([{ start: 0, end: 2, text: '[Música]' }, { start: 30, end: 32, text: '♪' }], 180)
check('Letra: una transcripcion normal es fiable', buena >= musica.CONFIANZA_MINIMA, `${buena}`)
check('Letra: la misma frase en bucle (alucinacion de whisper) no es fiable', bucle < musica.CONFIANZA_MINIMA, `${bucle}`)
check('Letra: solo [Música] y notas no es fiable', ruido < musica.CONFIANZA_MINIMA, `${ruido}`)

const conEstribillo = musica.medirTramo(9, 19, norm, letra, reps, listaDrops)
const verso = musica.medirTramo(0, 9, norm, letra, reps, listaDrops)
check(
  'Puntaje: el tramo fuerte, con estribillo y que empieza en el drop puntua mas',
  musica.puntajeMusica(conEstribillo) > musica.puntajeMusica(verso) && conEstribillo.conDrop,
  `${musica.puntajeMusica(conEstribillo)} vs ${musica.puntajeMusica(verso)}`,
)
const momentos = fuente(['scripts', 'momentos.ts'])
check('Momentos: ordena por el puntaje de musica y deja musica.json', momentos.includes('b.puntaje - a.puntaje') && momentos.includes("'musica.json'"))
check('Render: con letra poco fiable sale sin subtitulos', renderScript.includes("m.subtitulos === false") && renderScript.includes("values['no-subs'] = true"))
const ingest = fuente(['scripts', 'ingest.ts'])
check('Ingest: una cancion se transcribe con la voz realzada', ingest.includes('values.musica ? await realzarVoz('))

// --- 6. Panel ---------------------------------------------------------------------------

check('Panel: chip "Música" y aviso de derechos en la tarjeta', GUION.includes("'Música</span>'") && GUION.includes('puede ser bloqueada o silenciada por las plataformas'))
check('Panel: el detalle enseña el desglose del puntaje', GUION.includes('desglosePuntaje(c)'))
check('Panel: corte con deslizadores y editor de subtitulos', GUION.includes('rango-ini') && GUION.includes('data-subs-guardar') && GUION.includes('data-subs-originales'))
/*
 * Dos fallos encontrados al probar el Estilo en el navegador:
 * - la lista de altura ofrecia 200/300/380 (dentro de la zona que tapa TikTok)
 *   y no tenia el 480 por defecto, asi que el formulario marcaba 200 y
 *   cualquier Guardar en Estilo fallaba;
 * - opciones() comparaba con Number(), y las listas de palabras (encuadre,
 *   modo) nunca marcaban el valor guardado.
 */
const iAltura = GUION.indexOf("key: 'subMargin', texto: 'Altura sobre el borde'")
const alturas = iAltura < 0 ? '' : GUION.slice(iAltura, GUION.indexOf(']],', iAltura))
const valoresAltura = [...alturas.matchAll(/\[(\d+),/g)].map((m) => Number(m[1]))
check(
  'Estilo: la lista de altura respeta la zona segura e incluye el valor por defecto',
  valoresAltura.length > 0 && valoresAltura.every((v) => v >= 400) && valoresAltura.includes(CLIP_DEFAULTS.subMargin),
  JSON.stringify(valoresAltura),
)
check('Estilo: los desplegables marcan el valor guardado aunque sea texto', GUION.includes("String(v) === a ? ' selected'") && !GUION.includes("Number(actual) === v"))
check('Panel: atajos de revision A / R y flechas', /'a'/.test(GUION) && /'r'/.test(GUION) && GUION.includes('ArrowDown'))

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
if (fallidas.length > 0) process.exitCode = 1
