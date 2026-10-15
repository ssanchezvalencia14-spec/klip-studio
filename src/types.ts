/** Metadatos del VOD de origen, tal como los reporta yt-dlp. */
export interface SourceMeta {
  /** Identificador del video segun el sitio de origen. Sirve de sourceId. */
  id: string
  url: string
  title: string
  durationSec: number
  uploader: string | null
  width: number | null
  height: number | null
  fps: number | null
}

/**
 * Segmento de transcripcion, ya normalizado.
 *
 * Tiempos en SEGUNDOS. El filtro whisper de ffmpeg los emite en milisegundos;
 * la conversion ocurre una sola vez, en el parser, para que ningun otro modulo
 * tenga que recordarlo.
 */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  sourceId: string
  language: string
  /** Duracion del audio en segundos. */
  durationSec: number
  /**
   * Si la transcripcion incluye tiempos por palabra.
   *
   * Con el filtro whisper de ffmpeg 8.1.1 esto es SIEMPRE false: el filtro solo
   * emite segmentos. La Fase 3 debe generar subtitulos a nivel de segmento y no
   * puede hacer resaltado palabra por palabra sin cambiar de motor.
   */
  hasWordTimestamps: boolean
  segments: TranscriptSegment[]
}
