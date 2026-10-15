/**
 * Propone cortes para una cancion.
 *
 *   npm run momentos -- <sourceId> [--cuantos 3] [--dur 28]
 *
 * Una cancion no tiene "mejores momentos" como una entrevista. No hay un
 * argumento que se desarrolla ni un remate: hay estribillo, versos y silencios
 * instrumentales. Asi que el criterio es otro.
 *
 * Lo que se busca:
 *
 * 1. VOZ DENSA. Un tramo con poca letra es instrumental, y un clip de TikTok
 *    que empieza con ocho segundos de base pierde al espectador antes de
 *    llegar a nada.
 * 2. REPARTIDOS. Tres cortes seguidos del mismo estribillo son el mismo clip
 *    tres veces. Se fuerza separacion entre ellos.
 * 3. QUE NO CORTEN UNA FRASE. Los limites se ajustan a los bordes de los
 *    segmentos del transcript.
 *
 * NO decide solo: imprime la propuesta con sus cifras para revisarla antes de
 * gastar GPU. Renderizar treinta clips malos cuesta mas que leer una tabla.
 */
import { parseArgs } from 'node:util'
import { loadEnv } from '../src/lib/env.js'
import { readJson, workDir, writeJson } from '../src/lib/fsx.js'
import { join } from 'node:path'
import type { Transcript, TranscriptSegment } from '../src/types.js'

/** Lo que whisper inventa en los tramos sin voz: tags de productor, *Musica*. */
function esRuido(texto: string): boolean {
  const t = texto.trim()
  return t === '' || /^[[(*].*[\])*]$/.test(t)
}

interface Candidato {
  start: number
  end: number
  caracteres: number
  palabras: number
  segmentos: number
  /** Caracteres de letra por segundo. La cifra que separa voz de instrumental. */
  densidad: number
}

/**
 * Ajusta un corte a los bordes de los segmentos que contiene.
 *
 * Sin esto, un corte en un instante arbitrario parte una frase por la mitad y
 * el clip empieza a media palabra, que es justo lo que hace que un clip se
 * sienta amateur.
 */
function cuadrar(segs: TranscriptSegment[], desde: number, hasta: number): [number, number] {
  const dentro = segs.filter((s) => s.start >= desde - 1.5 && s.end <= hasta + 1.5)
  if (dentro.length === 0) return [desde, hasta]
  return [dentro[0]!.start, dentro[dentro.length - 1]!.end]
}

function main(): void {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cuantos: { type: 'string', default: '3' },
      // Sin esto solo imprime la propuesta. Es deliberado: ver la tabla antes de
      // gastar GPU es lo que evita renderizar treinta clips malos.
      aplicar: { type: 'boolean', default: false },
      dur: { type: 'string', default: '28' },
    },
  })

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run momentos -- <sourceId> [--cuantos 3] [--dur 28]')
    process.exit(1)
  }

  const cuantos = Number(values.cuantos)
  const objetivo = Number(values.dur)

  const t = readJson<Transcript>(join(workDir(sourceId), 'transcript.json'))
  const segs = t.segments.filter((s) => !esRuido(s.text))

  if (segs.length === 0) {
    console.error(`${sourceId} no tiene ningun segmento con voz.`)
    process.exit(1)
  }

  /*
   * Suelo de duracion.
   *
   * `cuadrar` puede encoger una ventana hasta casi nada: si en ese tramo solo
   * cae un segmento, devuelve justo ese segmento. Sin este filtro, el selector
   * proponia cortes de dos segundos al final de la cancion, porque un segmento
   * corto y suelto tiene densidad altisima y ganaba el ranking.
   *
   * Detectado sobre LUNA: proponia 210-212, dos segundos.
   */
  const minimo = Math.max(15, objetivo * 0.6)

  // Ventanas deslizantes de 2 s. Mas fino no aporta: los segmentos del
  // transcript duran 2-3 s, asi que el corte real se cuadra a ellos despues.
  const candidatos: Candidato[] = []
  for (let a = 0; a + objetivo <= t.durationSec; a += 2) {
    const [ini, fin] = cuadrar(segs, a, a + objetivo)
    if (fin - ini < minimo) continue
    const dentro = segs.filter((s) => s.end > ini && s.start < fin)
    if (dentro.length === 0) continue
    const caracteres = dentro.reduce((n, s) => n + s.text.trim().length, 0)
    const palabras = dentro.reduce((n, s) => n + s.text.trim().split(/\s+/).length, 0)
    candidatos.push({
      start: ini,
      end: fin,
      caracteres,
      palabras,
      segmentos: dentro.length,
      densidad: caracteres / Math.max(1, fin - ini),
    })
  }

  /*
   * Seleccion glotona con separacion obligatoria.
   *
   * Se coge el mas denso, se descarta todo lo que se le solape o quede
   * demasiado cerca, y se repite. La separacion minima es media duracion: sin
   * ella los tres cortes salen del mismo estribillo, que es el tramo mas denso
   * de cualquier cancion y acaparia la seleccion entera.
   */
  const separacion = objetivo / 2
  const elegidos: Candidato[] = []
  const restantes = [...candidatos].sort((a, b) => b.densidad - a.densidad)

  for (const c of restantes) {
    if (elegidos.length >= cuantos) break
    const choca = elegidos.some((e) => c.start < e.end + separacion && c.end > e.start - separacion)
    if (!choca) elegidos.push(c)
  }

  elegidos.sort((a, b) => a.start - b.start)

  console.log(`${sourceId} | ${t.durationSec}s | ${segs.length} segmentos con voz`)
  console.log('')
  if (elegidos.length < cuantos) {
    console.log(
      `Solo caben ${elegidos.length} de ${cuantos} cortes de ${objetivo}s sin solaparse. ` +
        'Baja --dur o pide menos.',
    )
    console.log('')
  }

  console.log('corte        dur  palabras  densidad  segmentos')
  console.log('-'.repeat(50))
  const args: string[] = []
  for (const c of elegidos) {
    const ini = Math.round(c.start)
    const fin = Math.round(c.end)
    args.push(`--clip ${ini}-${fin}`)
    console.log(
      `${String(ini).padStart(4)}-${String(fin).padEnd(5)} ${String(fin - ini).padStart(4)}s ` +
        `${String(c.palabras).padStart(9)} ${c.densidad.toFixed(1).padStart(9)} ${String(c.segmentos).padStart(10)}`,
    )
  }

  console.log('')

  if (!values.aplicar) {
    console.log('Para renderizarlos tal cual:')
    console.log(`  npm run render -- ${sourceId} ${args.join(' ')} --sub-words 3 --sub-animate`)
    console.log('')
    console.log('O deja los cortes anotados y sigue el flujo normal:')
    console.log(`  npm run momentos -- ${sourceId} --aplicar`)
    return
  }

  /*
   * Escribe el mismo clips.json que produce `select`.
   *
   * Sin esto, esta herramienta solo imprimia una tabla y habia que escribir el
   * fichero a mano para que render y el panel se enteraran. Con el saldo de la
   * API agotado, este es el unico camino para musica, y dejarlo a medias
   * obligaba a editar JSON para cada cancion.
   *
   * Los textos salen del titulo del VOD: esta herramienta no llama a ningun
   * modelo, asi que no puede inventar un gancho. Se dejan utiles y neutros,
   * listos para editarse desde el panel al revisar.
   */
  /*
   * El titulo sale de source.json, no del transcript.
   *
   * El transcript solo tiene segmentos y duracion; no sabe como se llama el
   * video. Sin esto los pies de publicacion salian con el identificador de
   * YouTube ('yqySUNhic3o'), que es lo que acabaria publicado en TikTok.
   */
  let titulo = sourceId
  try {
    titulo = readJson<{ title?: string }>(join(workDir(sourceId), 'source.json')).title ?? sourceId
  } catch {
    // Un VOD local puede no tener source.json. El identificador sirve de apaño
    // y el texto se edita al revisar.
  }
  const clips = elegidos.map((c, i) => ({
    sourceId,
    windowIndex: 0,
    start: Math.round(c.start),
    end: Math.round(c.end),
    hook: `${titulo} (${i + 1})`,
    reason: `Tramo con mas voz: ${c.densidad.toFixed(1)} caracteres por segundo.`,
    caption: i === 0 ? titulo : `${titulo} (${i + 1})`,
    hashtags: [],
    // Nota derivada de la densidad, acotada. No es una valoracion de calidad:
    // es lo unico medible sin un modelo que escuche la cancion.
    score: Math.max(50, Math.min(85, Math.round(50 + c.densidad * 2))),
  }))

  writeJson(join(workDir(sourceId), 'clips.json'), {
    sourceId,
    model: 'momentos-cancion',
    provider: 'densidad-de-voz',
    generatedFromWindows: 1,
    clips,
  })

  /*
   * El resumen lleva el mismo formato que los demas scripts, con `Clips : N`.
   *
   * No es cosmetica: la cadena automatica lee ese campo de la salida para saber
   * si encadena el render. Sin esa linea el panel se quedaba parado aqui, que es
   * justo lo que pedia el texto que habia antes en su lugar: abrir una terminal
   * y escribir el render a mano.
   */
  console.log(`${clips.length} corte(s) anotados en clips.json.`)
  console.log('')
  console.log('='.repeat(78))
  console.log(`Fuente    : ${sourceId}`)
  console.log(`Clips     : ${clips.length}`)
  console.log('Metodo    : densidad de voz, sin gastar API')
  console.log('='.repeat(78))
}

main()
