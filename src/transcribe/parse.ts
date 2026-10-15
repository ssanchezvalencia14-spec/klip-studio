import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { workDir, writeJson } from '../lib/fsx.js'
import { createLogger } from '../lib/logger.js'
import type { Transcript, TranscriptSegment } from '../types.js'

const log = createLogger('parse')

/**
 * Forma real de cada linea que emite `whisper=format=json` en ffmpeg 8.1.1.
 *
 * Verificado ejecutando el filtro, no supuesto. Tres cosas que la documentacion
 * no dice y que rompen cualquier implementacion ingenua:
 *
 *   1. El archivo NO es un documento JSON. Es NDJSON: un objeto por linea, sin
 *      corchetes envolventes ni comas. `JSON.parse` sobre el archivo entero
 *      lanza excepcion.
 *   2. Los tiempos vienen en MILISEGUNDOS, pese a que la opcion `queue` del
 *      mismo filtro se expresa en segundos.
 *   3. No hay tiempos por palabra. Solo segmentos.
 */
interface RawLine {
  start: number
  end: number
  text: string
}

/** Solapamiento maximo, en segundos, que se corrige en silencio. */
const OVERLAP_TOLERANCE_SEC = 0.25

function isRawLine(value: unknown): value is RawLine {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['start'] === 'number' &&
    typeof candidate['end'] === 'number' &&
    typeof candidate['text'] === 'string'
  )
}

/**
 * Convierte la salida cruda del filtro en un transcript normalizado.
 *
 * Limpieza aplicada, cada una por un motivo observado:
 *   - Descarta segmentos vacios o de duracion cero. El filtro los produce al
 *     dividir texto con `max_len`, y en subtitulos aparecerian como parpadeos.
 *   - Corrige solapamientos pequeños entre segmentos consecutivos. Con ventanas
 *     cortas se observaron solapes de hasta 8 ms por redondeo.
 *   - Descarta segmentos fuera de la duracion real del audio.
 */
export function parseTranscript(
  sourceId: string,
  rawPath: string,
  durationSec: number,
  language: string,
): Transcript {
  const content = readFileSync(rawPath, 'utf8')

  const segments: TranscriptSegment[] = []
  let skippedEmpty = 0
  let skippedZeroLength = 0
  let skippedOutOfRange = 0
  let fixedOverlaps = 0
  let malformed = 0

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      malformed += 1
      continue
    }

    if (!isRawLine(parsed)) {
      malformed += 1
      continue
    }

    const text = parsed.text.trim()
    if (text === '') {
      skippedEmpty += 1
      continue
    }

    // Milisegundos a segundos. Unico punto del sistema donde ocurre.
    const start = parsed.start / 1000
    const end = parsed.end / 1000

    if (end <= start) {
      skippedZeroLength += 1
      continue
    }

    if (start > durationSec) {
      skippedOutOfRange += 1
      continue
    }

    const previous = segments.at(-1)
    let adjustedStart = start

    if (previous !== undefined && start < previous.end) {
      const overlap = previous.end - start
      if (overlap <= OVERLAP_TOLERANCE_SEC) {
        adjustedStart = previous.end
        fixedOverlaps += 1
      } else {
        log.warn(
          `Solapamiento de ${overlap.toFixed(2)} s en ${start.toFixed(2)} s. ` +
            'Excede la tolerancia y se conserva sin ajustar.',
        )
      }
    }

    if (adjustedStart >= end) {
      skippedZeroLength += 1
      continue
    }

    segments.push({
      start: adjustedStart,
      end: Math.min(end, durationSec),
      text,
    })
  }

  if (malformed > 0) {
    log.warn(`${malformed} linea(s) ilegibles descartadas.`)
  }

  log.info(
    `${segments.length} segmentos | descartados: ${skippedEmpty} vacios, ` +
      `${skippedZeroLength} de duracion cero, ${skippedOutOfRange} fuera de rango | ` +
      `${fixedOverlaps} solapamiento(s) corregido(s)`,
  )

  if (segments.length === 0) {
    throw new Error(
      'La transcripcion no produjo ningun segmento utilizable. ' +
        'Verifica que el audio contenga voz y que el idioma sea correcto.',
    )
  }

  const transcript: Transcript = {
    sourceId,
    language,
    durationSec,
    // El filtro whisper de ffmpeg no expone tiempos por palabra. La Fase 3 debe
    // trabajar a nivel de segmento.
    hasWordTimestamps: false,
    segments,
  }

  writeJson(join(workDir(sourceId), 'transcript.json'), transcript)
  return transcript
}

/** Cobertura de habla sobre el total, util para detectar transcripciones pobres. */
export function speechCoverage(transcript: Transcript): number {
  const spoken = transcript.segments.reduce((total, s) => total + (s.end - s.start), 0)
  return transcript.durationSec === 0 ? 0 : spoken / transcript.durationSec
}
