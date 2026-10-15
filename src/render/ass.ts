import { writeFileSync } from 'node:fs'
import { optionalEnv } from '../lib/env.js'
import { ensureDir } from '../lib/fsx.js'
import { dirname } from 'node:path'
import type { TranscriptSegment } from '../types.js'

/** Lienzo de referencia. Debe coincidir con la resolucion de salida. */
export const PLAY_RES_X = 1080
export const PLAY_RES_Y = 1920

/**
 * Margen inferior, en pixeles del lienzo de 1920.
 *
 * La interfaz de TikTok ocupa la franja de abajo con el caption, el nombre de
 * usuario y el audio. Un subtitulo pegado al borde queda tapado. 380 lo levanta
 * por encima de esa zona sin llevarlo al centro.
 */
const MARGIN_V = 380

/**
 * Tipografias admitidas, repetidas aqui a proposito.
 *
 * El nombre se escribe tal cual en la linea `Style:`, que es un formato
 * separado por comas: una fuente con una coma en el nombre correria todos los
 * campos siguientes y el tamaño acabaria en el sitio del color.
 *
 * La lista de verdad vive en select/ajustes.ts, que es donde la usa el panel.
 * Esta copia esta aqui porque este modulo tambien se llama desde la linea de
 * comando, donde nadie ha pasado por aquella validacion. Importarla crearia una
 * dependencia del renderizador hacia el selector por cinco cadenas.
 */
const FUENTES_OK = new Set(['Impact', 'Arial Black', 'Segoe UI Black', 'Verdana', 'Tahoma'])

/** Margen lateral, para que el texto no toque los bordes ni la columna de iconos. */
const MARGIN_H = 70

/**
 * Tope de seguridad de caracteres por linea.
 *
 * El ajuste de linea real lo hace libass (WrapStyle 0), que mide los glifos.
 * Este limite solo existe para partir manualmente los segmentos absurdamente
 * largos, donde libass produciria cuatro o cinco lineas y taparia el video.
 */
const HARD_WRAP_CHARS = 42

/**
 * Convierte segundos a el formato de tiempo de ASS: h:mm:ss.cc
 * Centesimas, no milisegundos. ASS solo tiene dos decimales.
 */
function toAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const cs = Math.round((clamped - Math.floor(clamped)) * 100)
  // El redondeo de centesimas puede dar 100; se normaliza.
  const csFixed = cs === 100 ? 99 : cs
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(csFixed).padStart(2, '0')}`
}

/**
 * Escapa texto para el cuerpo de un evento ASS.
 *
 * Las llaves abren etiquetas de formato en ASS, asi que un texto que las
 * contenga se interpretaria como instrucciones de estilo en lugar de mostrarse.
 * Los saltos de linea reales rompen el formato de linea unica de Dialogue.
 */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim()
}

/**
 * Reparte el texto solo cuando es muy largo. El resto lo ajusta libass.
 *
 * La version anterior hacia todo el ajuste contando caracteres y forzaba dos
 * lineas siempre. Con Impact a 96 px, dos lineas de 35 caracteres miden mas de
 * 1200 px sobre un ancho util de 940, y el texto se salia del encuadre por
 * ambos lados. Contar caracteres no sirve: el ancho depende de los glifos.
 */
function wrapText(text: string): string {
  if (text.length <= HARD_WRAP_CHARS) return text

  // Reparto equilibrado en dos mitades por palabras; libass ajustara cada
  // mitad si aun no cabe.
  const words = text.split(/\s+/)
  const mid = Math.ceil(words.length / 2)
  return `${words.slice(0, mid).join(' ')}\\N${words.slice(mid).join(' ')}`
}

export interface AssOptions {
  /** Tipografia. Debe estar instalada en el sistema; libass la resuelve por nombre. */
  fontName?: string
  fontSize?: number
  /** Cuanto se levantan sobre el borde inferior, en pixeles del lienzo de 1920. */
  marginV?: number
  /**
   * Palabras por rotulo. Sin valor, un rotulo por segmento (lo de siempre).
   *
   * Con 2 o 3 el texto avanza al ritmo del habla en vez de aparecer en bloques
   * de cinco segundos. Es lo que hace que un clip se lea como los de TikTok y
   * no como una pelicula subtitulada.
   */
  wordsPerCue?: number
  /** Animacion de entrada en cada rotulo. Solo tiene sentido con wordsPerCue. */
  animate?: boolean
  /** Color del texto, en #RRGGBB. */
  color?: string
  /** Color del borde de cada letra, en #RRGGBB. */
  colorBorde?: string
  /** Grosor de ese borde, en pixeles del lienzo. */
  borde?: number

  /**
   * Rotulo de titulo quemado arriba, fijo durante todo el clip.
   *
   * No es un subtitulo: no sigue al habla, no cambia y no se mide desde abajo.
   * Es la frase que explica de que va el clip para quien pasa deprisa y no
   * lee el pie de la publicacion. Si viene vacio, no se pinta nada.
   */
  titulo?: string
  /** Altura desde ARRIBA, en pixeles del lienzo de 1920. */
  tituloArriba?: number
  tituloTam?: number
  tituloColor?: string
  tituloColorBorde?: string
  tituloBorde?: number
}

/**
 * Pasa un #RRGGBB al formato de los ficheros .ass.
 *
 * Alli los colores se escriben &HAABBGGRR: con los bytes AL REVES y el canal
 * alfa delante, donde 00 es opaco. Escribir el #RRGGBB tal cual produce el
 * color complementario, que es un fallo dificil de ver en el codigo y evidente
 * en el video.
 */
export function aColorAss(hex: string, alfa = '00'): string {
  const limpio = /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.slice(1) : 'FFFFFF'
  const rr = limpio.slice(0, 2)
  const gg = limpio.slice(2, 4)
  const bb = limpio.slice(4, 6)
  return ('&H' + alfa + bb + gg + rr).toUpperCase()
}

/**
 * Parte un segmento en grupos de palabras y reparte su duracion.
 *
 * SE HACE AQUI Y NO CON max_len DEL FILTRO. El filtro whisper de ffmpeg acepta
 * max_len, pero corta por caracteres sin mirar las palabras: medido sobre
 * material real, producia "que tu quer" / "ias ser futbol" / "ista ahorita".
 * Ademas obligaria a re-transcribir para cambiar el estilo, cuando esto se
 * decide al renderizar.
 *
 * El reparto es proporcional a los caracteres, no a partes iguales: "y" y
 * "extraordinariamente" no se tardan lo mismo en decir, y con reparto uniforme
 * los rotulos largos se quedan cortos y adelantan a la voz.
 */
function partirEnRotulos(
  texto: string,
  inicio: number,
  fin: number,
  porRotulo: number,
): { start: number; end: number; text: string }[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return []

  const grupos: string[] = []
  for (let i = 0; i < palabras.length; i += porRotulo) {
    grupos.push(palabras.slice(i, i + porRotulo).join(' '))
  }

  const total = grupos.reduce((n, g) => n + g.length, 0)
  const duracion = fin - inicio

  let t = inicio
  return grupos.map((g, i) => {
    // El ultimo cierra exactamente en `fin`: acumular redondeos dejaria un
    // hueco o un solape de decimas con el segmento siguiente.
    const start = t
    const end = i === grupos.length - 1 ? fin : t + (g.length / total) * duracion
    t = end
    return { start, end, text: g }
  })
}

/**
 * Entrada animada de un rotulo.
 *
 * Aparece al 72% y crece al 100% en 110 ms, con un desvanecido de 60 ms. Es
 * suficiente para que el ojo note el cambio sin que el texto rebote.
 *
 * Solo transformaciones de escala y alfa: son las que libass resuelve sin
 * recomponer el fotograma entero.
 */
const ENTRADA = '{\\fad(60,0)\\fscx72\\fscy72\\t(0,110,\\fscx100\\fscy100)}'

/**
 * Descarta lo que whisper inventa en los tramos sin voz.
 *
 * En una cancion, la intro instrumental y los silencios producen etiquetas
 * entre asteriscos (tags de productor, *Musica*) que el modelo emite con
 * aplomo. Quemadas en el video se leen como un error del editor.
 */
function esRuido(texto: string): boolean {
  const t = texto.trim()
  return t === '' || /^[\[(*].*[\])*]$/.test(t)
}

/**
 * Genera un archivo .ass con los subtitulos de un clip.
 *
 * Los tiempos se rebasan a cero: el .ass acompaña a un clip ya recortado, asi
 * que el segundo 0 del subtitulo es el segundo 0 del clip, no del video fuente.
 */
export function buildAss(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number,
  outputPath: string,
  options: AssOptions = {},
): number {
  const pedida = options.fontName ?? optionalEnv('SUBTITLE_FONT') ?? 'Impact'
  /*
   * Una fuente fuera de la lista se rechaza, no se sustituye en silencio.
   *
   * Sustituir por Impact produciria clips correctos con una tipografia que
   * nadie pidio, y el error solo se veria mirando los videos ya renderizados.
   * Un VOD entero renderizado con la fuente equivocada son horas de GPU.
   */
  if (!FUENTES_OK.has(pedida)) {
    throw new Error(
      `Tipografia no admitida: "${pedida}". Las que valen son ${[...FUENTES_OK].join(', ')}.`,
    )
  }
  const fontName = pedida
  // 72 px sale de medir el material real, no de estimar. Sobre 3027 segmentos
  // de un podcast: mediana de 20 caracteres, p75 de 30, p90 de 41. Con Impact
  // sobre un ancho util de 940 px caben unos 16 caracteres por linea a 96 px y
  // unos 22 a 72 px. A 96 px hasta la mediana ocupaba dos lineas y el p90
  // cuatro, que tapan al hablante. A 72 px la mediana cabe en una y el p90 en
  // dos, que es lo que deja los subtitulos dentro de la banda desenfocada.
  const fontSize = options.fontSize ?? Number(optionalEnv('SUBTITLE_SIZE') ?? '72')
  const marginV = options.marginV ?? MARGIN_V

  const porRotulo = options.wordsPerCue ?? 0
  const animar = options.animate === true && porRotulo > 0

  const colorTexto = aColorAss(options.color ?? '#FFFFFF')
  const colorBorde = aColorAss(options.colorBorde ?? '#000000')
  // El grosor del borde era 7 fijo. Se admite 0 (sin borde), asi que no vale un
  // `||`: con 0 caeria al valor por defecto y el borde reaparecia.
  const grosor = options.borde ?? 7

  /*
   * El titulo.
   *
   * Se pasa por el mismo escapado que los subtitulos: viene de un modelo y
   * acaba dentro de un fichero cuyas llaves son instrucciones de formato.
   * Vacio despues de escapar significa que no hay titulo que pintar.
   */
  const tituloTexto = escapeAssText(options.titulo ?? '')
  const conTitulo = tituloTexto !== ''
  const tituloArriba = options.tituloArriba ?? 240
  const tituloTam = options.tituloTam ?? 64
  const tituloColor = aColorAss(options.tituloColor ?? '#FFFFFF')
  const tituloColorBorde = aColorAss(options.tituloColorBorde ?? '#000000')
  const tituloGrosor = options.tituloBorde ?? 6

  const inRange = segments
    .filter((s) => s.end > clipStart && s.start < clipEnd)
    .filter((s) => !esRuido(s.text))

  const events = inRange.flatMap((segment) => {
    // Se recorta a los limites del clip: un segmento puede empezar antes del
    // corte o terminar despues, y el subtitulo no debe salirse del video.
    const start = Math.max(0, segment.start - clipStart)
    const end = Math.min(clipEnd - clipStart, segment.end - clipStart)
    const limpio = escapeAssText(segment.text)
    if (limpio === '') return []

    if (porRotulo === 0) {
      return [`Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Default,,0,0,0,,${wrapText(limpio)}`]
    }

    /*
     * Con rotulos cortos NO se usa wrapText.
     *
     * Aquel parte en dos lineas lo que pase de 42 caracteres, y tres palabras
     * nunca llegan ahi. Dejarlo puesto solo añadiria un salto de linea en el
     * caso raro de tres palabras larguisimas, y partir dos palabras en dos
     * lineas se lee peor que dejarlas seguidas.
     */
    return partirEnRotulos(limpio, start, end, porRotulo).map(
      (r) =>
        `Dialogue: 0,${toAssTime(r.start)},${toAssTime(r.end)},Default,,0,0,0,,` +
        `${animar ? ENTRADA : ''}${r.text}`,
    )
  })

  // Colores ASS en formato &HAABBGGRR: alfa, azul, verde, rojo. No es RGB.
  // Blanco opaco = &H00FFFFFF. Negro opaco = &H00000000.
  const content = `[Script Info]
ScriptType: v4.00+
PlayResX: ${PLAY_RES_X}
PlayResY: ${PLAY_RES_Y}
; WrapStyle 0 = ajuste automatico con lineas equilibradas. Es libass quien mide
; el ancho real de los glifos y decide donde partir, respetando MarginL/MarginR.
; Con WrapStyle 2 el ajuste queda en manos del generador, que solo puede contar
; caracteres, y el texto se desborda del encuadre.
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${colorTexto},${colorTexto},${colorBorde},&H96000000,0,0,0,0,100,100,0,0,1,${grosor},4,2,${MARGIN_H},${MARGIN_H},${marginV},1
${
  /*
   * El estilo del titulo solo se escribe si hay titulo.
   *
   * Un estilo declarado y nunca usado no rompe nada, pero deja ficheros .ass
   * distintos segun los ajustes para clips que salen identicos, y eso es
   * ruido al comparar dos renders que deberian ser iguales.
   *
   * Alignment 8 = arriba y centrado. Con esa alineacion MarginV se mide desde
   * el borde SUPERIOR, que es justo lo que queremos: el titulo se coloca a N
   * pixeles de arriba, igual que el subtitulo se coloca a N de abajo.
   */
  conTitulo
    ? `Style: Titulo,${fontName},${tituloTam},${tituloColor},${tituloColor},${tituloColorBorde},&H96000000,0,0,0,0,100,100,0,0,1,${tituloGrosor},4,8,${MARGIN_H},${MARGIN_H},${tituloArriba},1
`
    : ''
}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${
  /*
   * El titulo, en la capa 1 y de punta a punta del clip.
   *
   * Capa 1 y no 0: si un subtitulo llegara a solaparse con el, el titulo
   * queda encima. Y va el PRIMERO de la lista de eventos porque su hueco es
   * el clip entero, y leerlo arriba del todo dice de un vistazo que ese
   * fichero lleva rotulo.
   */
  conTitulo
    ? `Dialogue: 1,${toAssTime(0)},${toAssTime(clipEnd - clipStart)},Titulo,,0,0,0,,${wrapText(tituloTexto)}
`
    : ''
}${events.join('\n')}
`

  ensureDir(dirname(outputPath))
  // UTF-8 sin BOM. libass lo espera asi; con BOM el primer subtitulo sale mal.
  writeFileSync(outputPath, content, 'utf8')

  return events.length
}
