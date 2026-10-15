/**
 * Contrato de recoleccion de metricas.
 *
 * Mismo patron que la publicacion: el resto del sistema no conoce al proveedor.
 * Cuando se migre a una app propia de TikTok, se escribe otra implementacion y
 * no se toca el analisis.
 */

export interface PostMetrics {
  externalId: string
  views: number
  likes: number
  comments: number
  shares: number
  /** Segundos medios de reproduccion, si el proveedor lo expone. */
  averageWatchSec: number | null
}

export interface MetricsProvider {
  readonly name: string
  /**
   * Consulta metricas de varias publicaciones.
   *
   * Se pide en lote y no de una en una porque la recoleccion recorre cientos de
   * publicaciones al dia; una peticion por post agotaria cualquier limite.
   * Las que no se puedan consultar simplemente no aparecen en el resultado.
   */
  fetch(externalIds: string[]): Promise<PostMetrics[]>
}

/**
 * Edad, en horas, a la que se toma la senal temprana.
 *
 * Las vistas de las primeras horas predicen el alcance final mejor que
 * cualquier otra cosa disponible: si un clip no arranca en ese plazo, no
 * arranca. Sirve para descartar material sin esperar dias.
 */
export const EARLY_SIGNAL_HOURS = 2

/**
 * Momentos de captura, en horas desde la publicacion.
 *
 * No se muestrea de forma continua porque las metricas se mueven mucho al
 * principio y casi nada despues. Estos cortes capturan la curva con pocas
 * peticiones.
 */
export const CAPTURE_AGES_HOURS = [2, 6, 24, 72, 168] as const
