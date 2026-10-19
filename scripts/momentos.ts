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
 * 4. ESTRIBILLO Y ENERGIA (Fase 6). Lo que se repite y lo que suena fuerte
 *    puntua mas; ver src/select/musica.ts. Sin audio.wav se ordena solo por
 *    voz, como antes.
 *
 * Tambien mide la confianza de la letra y la deja en musica.json: con una
 * letra poco fiable el render sale sin subtitulos.
 *
 * NO decide solo: imprime la propuesta con sus cifras para revisarla antes de
 * gastar GPU. Renderizar treinta clips malos cuesta mas que leer una tabla.
 */
import { parseArgs } from 'node:util'
import { loadEnv } from '../src/lib/env.js'
import { readJson, workDir, writeJson } from '../src/lib/fsx.js'
import { join } from 'node:path'
import type { Transcript, TranscriptSegment } from '../src/types.js'
import {
  CONFIANZA_MINIMA,
  confianzaLetra,
  drops,
  energia,
  esRuido,
  leerWav,
  medirTramo,
  normalizarEnergia,
  puntajeMusica,
  repeticiones,
  type MedidaTramo,
} from '../src/select/musica.js'

interface Candidato {
  start: number
  end: number
  caracteres: number
  palabras: number
  segmentos: number
  /** Caracteres de letra por segundo. La cifra que separa voz de instrumental. */
  densidad: number
  medida: MedidaTramo
  puntaje: number
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

  /*
   * La energia sale del audio.wav del ingest. Si no esta (un VOD viejo, o
   * borrado por la limpieza), se sigue sin ella: puntua solo voz y estribillo.
   */
  let norm: number[] = []
  try {
    const wav = leerWav(join(workDir(sourceId), 'audio.wav'))
    norm = normalizarEnergia(energia(wav.muestras, wav.rate))
  } catch {
    console.log('Sin audio.wav: se puntua sin la energia de la cancion.')
  }
  const listaDrops = drops(norm)
  const reps = repeticiones(segs)
  const confianza = confianzaLetra(t.segments, t.durationSec)

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
    const medida = medirTramo(ini, fin, norm, segs, reps, listaDrops)
    candidatos.push({
      medida,
      puntaje: puntajeMusica(medida),
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
  const restantes = [...candidatos].sort((a, b) => b.puntaje - a.puntaje || b.densidad - a.densidad)

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

  console.log(`Letra: confianza ${confianza.toFixed(2)}${confianza < CONFIANZA_MINIMA ? ' (baja: sin subtitulos)' : ''}`)
  console.log('')
  console.log('corte        dur  palabras  densidad  segmentos  puntaje')
  console.log('-'.repeat(59))
  const args: string[] = []
  for (const c of elegidos) {
    const ini = Math.round(c.start)
    const fin = Math.round(c.end)
    args.push(`--clip ${ini}-${fin}`)
    console.log(
      `${String(ini).padStart(4)}-${String(fin).padEnd(5)} ${String(fin - ini).padStart(4)}s ` +
        `${String(c.palabras).padStart(9)} ${c.densidad.toFixed(1).padStart(9)} ${String(c.segmentos).padStart(10)} ${String(c.puntaje).padStart(8)}`,
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
    reason:
      `Estribillo ${Math.round(c.medida.estribillo * 100)}%, energía ${Math.round(c.medida.energia * 100)}%, ` +
      `${c.densidad.toFixed(1)} letras por segundo${c.medida.conDrop ? ', empieza en un cambio fuerte' : ''}.`,
    caption: i === 0 ? titulo : `${titulo} (${i + 1})`,
    hashtags: [],
    // Estribillo, energia, voz y drop: lo medible sin un modelo que escuche.
    score: c.puntaje,
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
  /*
   * La confianza de la letra, para el render (subtitulos si o no) y para el
   * panel (sources.confianza_letra). Un fichero aparte y no un campo de
   * clips.json: clips.json lo reescribe tambien select.
   */
  writeJson(join(workDir(sourceId), 'musica.json'), {
    confianzaLetra: confianza,
    subtitulos: confianza >= CONFIANZA_MINIMA,
  })

  console.log(`${clips.length} corte(s) anotados en clips.json.`)
  console.log('')
  console.log('='.repeat(78))
  console.log(`Fuente    : ${sourceId}`)
  console.log(`Clips     : ${clips.length}`)
  console.log('Metodo    : estribillo, energia y voz, sin gastar API')
  console.log(`Confianza : ${confianza.toFixed(2)}`)
  console.log('='.repeat(78))
}

main()
