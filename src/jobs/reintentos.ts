import type { JobKind } from './cola.js'

/**
 * Cuando reintentar una tarea que fallo, y cuando no.
 *
 * Dos reintentos como mucho, con espera creciente (1 y 5 minutos). Un corte de
 * red o un ffmpeg que se cae una vez suelen arreglarse solos; si falla tres
 * veces, insistir solo llena el historial de lo mismo.
 *
 * NO se reintenta lo que va a fallar igual: el script lo dice saliendo con el
 * codigo SALIDA_NO_REINTENTAR (YouTube bloqueo la descarga, la clave de la API
 * no vale, el video es un directo en curso...).
 */
export const MAX_REINTENTOS = 2

/** Segundos de espera antes del reintento N (empezando en 1). */
export const ESPERAS_S = [60, 5 * 60]

/** Codigo de salida de un script cuyo fallo no se arregla reintentando. */
export const SALIDA_NO_REINTENTAR = 3

/**
 * Las tareas que se reintentan solas.
 *
 * Fuera: publicar (tiene sus propios reintentos por envio, en publish/worker),
 * y las pruebas (doctor, probar-ia), cuyo resultado ES el fallo.
 */
export const REINTENTABLES: readonly JobKind[] = [
  'ingest', 'select', 'momentos', 'render', 'subir', 'variants', 'schedule', 'metrics',
]

export function esperaParaReintento(reintentosHechos: number): number | null {
  if (reintentosHechos >= MAX_REINTENTOS) return null
  return ESPERAS_S[reintentosHechos] ?? ESPERAS_S[ESPERAS_S.length - 1] ?? 300
}

export function seReintenta(kind: JobKind, codigo: number | null, reintentosHechos: number): number | null {
  if (!REINTENTABLES.includes(kind)) return null
  if (codigo === SALIDA_NO_REINTENTAR) return null
  return esperaParaReintento(reintentosHechos)
}
