import { createLogger } from '../lib/logger.js'
import type { Transcript } from '../types.js'
import type { ClipCandidate, ValidatedClip } from './schema.js'
import { windowText, type TranscriptWindow } from './window.js'

const log = createLogger('validate')

export interface ValidationLimits {
  minDurationSec: number
  maxDurationSec: number
}

/**
 * Normaliza texto para comparar el gancho contra el transcript.
 *
 * Se quitan acentos, puntuacion y diferencias de espaciado porque el modelo
 * reproduce la frase con variaciones cosmeticas (una coma de mas, mayuscula
 * inicial distinta) que no deberian invalidar un candidato correcto.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    // Marcas diacriticas combinantes. Se escribe con escapes en vez de con los
    // caracteres literales para que el fuente sea legible y no dependa de la
    // codificacion del archivo.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Verifica que el gancho aparece de verdad en la ventana.
 *
 * Es la comprobacion antialucinacion del sistema. Si el modelo invento la
 * frase, tambien invento el momento, y los timestamps no apuntan a nada. Se
 * exige coincidencia del prefijo en lugar de la frase entera porque el modelo
 * a veces recorta el final del gancho.
 */
function hookExists(hook: string, window: TranscriptWindow): boolean {
  const haystack = normalize(windowText(window))
  const needle = normalize(hook)
  if (needle === '') return false

  if (haystack.includes(needle)) return true

  const words = needle.split(' ')
  if (words.length < 4) return false

  const prefix = words.slice(0, Math.max(4, Math.floor(words.length * 0.6))).join(' ')
  return haystack.includes(prefix)
}

export interface ValidationResult {
  accepted: ValidatedClip[]
  rejected: { clip: ClipCandidate; reason: string }[]
}

/** Filtra los candidatos de una ventana. No se confia en la salida del modelo. */
export function validateCandidates(
  candidates: ClipCandidate[],
  window: TranscriptWindow,
  transcript: Transcript,
  limits: ValidationLimits,
): ValidationResult {
  const accepted: ValidatedClip[] = []
  const rejected: { clip: ClipCandidate; reason: string }[] = []

  const total = window.segments.length

  for (const clip of candidates) {
    // Los indices se validan contra la lista real que se le dio al modelo. Un
    // indice fuera de rango es una alucinacion detectable; un segundo inventado
    // no lo seria.
    if (!Number.isInteger(clip.startLine) || !Number.isInteger(clip.endLine)) {
      rejected.push({ clip, reason: 'los indices de linea no son enteros' })
      continue
    }

    if (clip.startLine < 1 || clip.endLine > total) {
      rejected.push({
        clip,
        reason: `lineas ${clip.startLine}-${clip.endLine} fuera del rango 1-${total}`,
      })
      continue
    }

    if (clip.endLine <= clip.startLine) {
      rejected.push({
        clip,
        reason: `tramo de una sola linea (${clip.startLine}-${clip.endLine})`,
      })
      continue
    }

    // Aqui es donde los indices se vuelven segundos. Los limites caen siempre
    // sobre fronteras reales de segmento, nunca a mitad de una palabra.
    const first = window.segments[clip.startLine - 1]
    const last = window.segments[clip.endLine - 1]
    if (first === undefined || last === undefined) {
      rejected.push({ clip, reason: 'no se pudieron resolver las lineas' })
      continue
    }

    const start = first.start
    const end = last.end
    const duration = end - start

    if (duration < limits.minDurationSec || duration > limits.maxDurationSec) {
      rejected.push({
        clip,
        reason:
          `lineas ${clip.startLine}-${clip.endLine} suman ${duration.toFixed(1)}s, ` +
          `fuera de [${limits.minDurationSec}, ${limits.maxDurationSec}]`,
      })
      continue
    }

    if (end > transcript.durationSec) {
      rejected.push({ clip, reason: `fuera de la duracion del video (${transcript.durationSec}s)` })
      continue
    }

    if (!hookExists(clip.hook, window)) {
      rejected.push({ clip, reason: 'el gancho no aparece en el transcript (posible alucinacion)' })
      continue
    }

    accepted.push({
      start,
      end,
      hook: clip.hook,
      reason: clip.reason,
      caption: clip.caption,
      hashtags: clip.hashtags,
      score: clip.score,
      sourceId: transcript.sourceId,
      windowIndex: window.index,
    })
  }

  return { accepted, rejected }
}

/** Fraccion solapada respecto al clip mas corto de los dos. */
function overlapRatio(a: ValidatedClip, b: ValidatedClip): number {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start)
  if (overlap <= 0) return 0
  const shortest = Math.min(a.end - a.start, b.end - b.start)
  return overlap / shortest
}

/**
 * Elimina candidatos que se pisan entre si, quedandose con el de mayor score.
 *
 * Hace falta porque las ventanas se solapan a proposito: el mismo momento se le
 * ofrece a dos ventanas distintas y suele ser elegido en ambas, con cortes
 * ligeramente diferentes.
 */
export function dedupe(clips: ValidatedClip[], maxOverlap = 0.5): ValidatedClip[] {
  const byScore = [...clips].sort((a, b) => b.score - a.score)
  const kept: ValidatedClip[] = []

  for (const clip of byScore) {
    const collides = kept.some((k) => overlapRatio(clip, k) > maxOverlap)
    if (collides) continue
    kept.push(clip)
  }

  const removed = clips.length - kept.length
  if (removed > 0) log.info(`${removed} candidato(s) duplicado(s) por solapamiento de ventanas`)

  return kept.sort((a, b) => b.score - a.score)
}
