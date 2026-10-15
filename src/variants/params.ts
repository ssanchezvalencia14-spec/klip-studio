import { createHash } from 'node:crypto'

/**
 * Parametros de una variante.
 *
 * Todos son imperceptibles para una persona y suficientes para cambiar el hash
 * del archivo y las huellas perceptuales. Ese es exactamente el objetivo: el
 * mismo MP4 publicado en 20 cuentas se detecta por contenido y su alcance se
 * ahoga.
 */
export interface VariantParams {
  /** Factor de acercamiento. 1.0 = sin cambio. */
  zoom: number
  /** Factor de velocidad. 1.0 = sin cambio. Afecta a video y audio a la vez. */
  speed: number
  /** Brillo, en el rango del filtro eq: -1 a 1. Valores diminutos. */
  brightness: number
  /** Contraste del filtro eq: 1.0 = sin cambio. */
  contrast: number
  /** Saturacion del filtro eq: 1.0 = sin cambio. */
  saturation: number
  /** Segundos recortados del inicio, para cambiar el primer frame. */
  trimStartSec: number
}

/**
 * Generador pseudoaleatorio determinista (mulberry32).
 *
 * Se usa un PRNG con semilla en lugar de Math.random a proposito. Si un render
 * falla y hay que repetirlo, la variante debe salir identica; con aleatoriedad
 * pura tendrias archivos irreproducibles y depurar seria imposible. Ademas
 * permite regenerar cualquier variante meses despues sin haber guardado sus
 * parametros.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Convierte una cadena de semilla en un entero de 32 bits estable. */
function seedFrom(text: string): number {
  const digest = createHash('sha256').update(text).digest()
  return digest.readUInt32BE(0)
}

export interface VariantRanges {
  zoomMin: number
  zoomMax: number
  speedMin: number
  speedMax: number
  trimMaxSec: number
}

export const DEFAULT_RANGES: VariantRanges = {
  // Un 8% de acercamiento es invisible al ojo y recorta poco del encuadre.
  zoomMin: 1.0,
  zoomMax: 1.08,
  // Mas de un 2% de cambio de velocidad se nota en la voz.
  speedMin: 0.98,
  speedMax: 1.02,
  // 300 ms bastan para cambiar el primer frame sin comerse una palabra del
  // gancho, que es lo que sostiene el clip.
  trimMaxSec: 0.3,
}

/**
 * Deriva los parametros de una variante de forma determinista.
 *
 * La semilla combina clip y cuenta, asi que el mismo par siempre produce la
 * misma variante, y dos cuentas distintas nunca reciben la misma.
 */
export function deriveParams(
  clipId: string,
  accountId: string,
  ranges: VariantRanges = DEFAULT_RANGES,
): VariantParams {
  const random = mulberry32(seedFrom(`${clipId}::${accountId}`))

  const between = (min: number, max: number): number =>
    Number((min + random() * (max - min)).toFixed(4))

  return {
    zoom: between(ranges.zoomMin, ranges.zoomMax),
    speed: between(ranges.speedMin, ranges.speedMax),
    brightness: between(-0.02, 0.02),
    contrast: between(0.97, 1.03),
    saturation: between(0.95, 1.05),
    trimStartSec: between(0, ranges.trimMaxSec),
  }
}
