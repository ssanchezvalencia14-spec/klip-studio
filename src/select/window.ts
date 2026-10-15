import type { Transcript, TranscriptSegment } from '../types.js'

export interface TranscriptWindow {
  index: number
  startSec: number
  endSec: number
  segments: TranscriptSegment[]
}

/**
 * Tamaño de ventana, en segundos.
 *
 * Un video de 87 minutos cabe entero en el contexto del modelo, asi que la
 * ventana no existe por limite de tokens. Existe por recall: al pedir "los
 * mejores N momentos" sobre hora y media de una vez, el modelo tiende a
 * concentrarse en el principio y a pasar por encima del resto. Troceando y
 * pidiendo un maximo por trozo, cada parte del video recibe la misma atencion.
 *
 * 15 minutos es el compromiso: suficiente contexto para entender de que va la
 * conversacion, poco como para que ningun momento quede desatendido.
 */
export const DEFAULT_WINDOW_SEC = 15 * 60

/**
 * Solapamiento entre ventanas consecutivas.
 *
 * Sin solape, un buen momento que cae justo sobre una frontera se parte en dos
 * mitades y ninguna de las dos se elige. Dos minutos cubren de sobra la
 * duracion maxima de un clip.
 */
export const DEFAULT_OVERLAP_SEC = 2 * 60

export interface WindowOptions {
  windowSec?: number
  overlapSec?: number
}

export function buildWindows(transcript: Transcript, options: WindowOptions = {}): TranscriptWindow[] {
  const windowSec = options.windowSec ?? DEFAULT_WINDOW_SEC
  const overlapSec = options.overlapSec ?? DEFAULT_OVERLAP_SEC

  if (overlapSec >= windowSec) {
    throw new Error('El solapamiento debe ser menor que la ventana; si no, el avance seria nulo.')
  }

  const windows: TranscriptWindow[] = []
  const stride = windowSec - overlapSec
  let index = 0

  for (let start = 0; start < transcript.durationSec; start += stride) {
    const end = Math.min(start + windowSec, transcript.durationSec)

    // Un segmento entra si empieza dentro de la ventana. Usar solapamiento
    // parcial duplicaria segmentos largos en dos ventanas sin aportar nada.
    const segments = transcript.segments.filter((s) => s.start >= start && s.start < end)

    if (segments.length > 0) {
      windows.push({ index, startSec: start, endSec: end, segments })
      index += 1
    }

    if (end >= transcript.durationSec) break
  }

  return windows
}

/** Texto plano de una ventana, para verificar que el gancho existe de verdad. */
export function windowText(window: TranscriptWindow): string {
  return window.segments.map((s) => s.text).join(' ')
}
