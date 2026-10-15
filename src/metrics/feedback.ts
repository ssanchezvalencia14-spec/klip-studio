import { clips } from '../store/store.js'
import { analyze, type ClipPerformance } from './analyze.js'

/**
 * Construye ejemplos reales para inyectar en el prompt de seleccion.
 *
 * Devuelve TEXTO, no aplica nada. Es deliberado: un ajuste automatico del
 * prompt cambiaria el comportamiento del sistema sin que quede constancia de
 * cuando ni por que, y al comparar resultados entre semanas seria imposible
 * saber que version produjo cada cosa. El bloque se pega a mano en prompt.ts y
 * queda versionado en git como cualquier otro cambio.
 */

/** Clips minimos medidos antes de que los ejemplos signifiquen algo. */
const MIN_MEASURED = 10

export interface Feedback {
  ready: boolean
  reason: string
  best: ClipPerformance[]
  worst: ClipPerformance[]
  block: string
}

function describe(performance: ClipPerformance): string {
  const record = clips.find(performance.sourceId, performance.clipId)
  const hook = record?.hook ?? '(gancho no encontrado)'
  return `- "${hook}" | puntuaste ${performance.score} | ${performance.medianViews.toLocaleString()} vistas medianas en ${performance.publications} publicaciones`
}

export function buildFeedback(count = 3): Feedback {
  const analysis = analyze()
  const measured = analysis.byClip.filter((c) => c.publications > 0)

  if (measured.length < MIN_MEASURED) {
    return {
      ready: false,
      reason:
        `Solo hay ${measured.length} clip(s) con metricas. Hacen falta al menos ${MIN_MEASURED} ` +
        'para que los ejemplos no sean ruido.',
      best: [],
      worst: [],
      block: '',
    }
  }

  const best = measured.slice(0, count)
  const worst = measured.slice(-count).reverse()

  const block = `
<!-- Bloque generado el ${new Date().toISOString().slice(0, 10)} a partir de ${measured.length} clips medidos.
     Pegar en SELECTION_SYSTEM_PROMPT (src/select/prompt.ts) y commitear el cambio. -->

APRENDIZAJE DE PUBLICACIONES ANTERIORES

Estos momentos rindieron MEJOR de lo que sugeria su puntuacion o confirmaron una
puntuacion alta. Busca patrones parecidos:
${best.map(describe).join('\n')}

Estos rindieron PEOR. Fijate en que fallo, aunque parecieran buenos candidatos:
${worst.map(describe).join('\n')}

Ajusta tu criterio con esta evidencia, sin dejar de aplicar las reglas anteriores.
`.trim()

  return {
    ready: true,
    reason: `${measured.length} clips medidos.`,
    best,
    worst,
    block,
  }
}
