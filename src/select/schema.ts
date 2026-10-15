import * as z from 'zod/v4'

/**
 * Esquema de salida que se le impone al modelo.
 *
 * Se usa salida estructurada en lugar de pedir JSON en el prompt y parsearlo:
 * la validacion ocurre en la capa de la API, asi que el modelo reintenta solo
 * cuando no encaja, en vez de devolvernos texto que hay que reparar a mano.
 *
 * EL MODELO DEVUELVE NUMEROS DE LINEA, NO SEGUNDOS.
 *
 * La primera version pedia `start` y `end` en segundos. Tiene dos problemas.
 * El primero es practico: obliga al modelo a hacer aritmetica con marcas de
 * tiempo, y los modelos pequeños fallan sistematicamente (medido sobre un
 * podcast real: 15 de 15 candidatos por debajo del minimo, devolviendo lineas
 * sueltas en vez de tramos).
 *
 * El segundo es de diseño y afecta a cualquier modelo: un segundo inventado es
 * un valor plausible que nadie puede desmentir. Un indice de linea, en cambio,
 * o existe en la lista que se le dio o no existe. Al convertirlo aqui, los
 * cortes caen siempre sobre fronteras reales de segmento, que ademas es lo que
 * quieren los subtitulos.
 *
 * Nota: las restricciones numericas (minimo, maximo) no forman parte del
 * subconjunto de JSON Schema que admite la salida estructurada. Los limites de
 * duracion y de rango se comprueban en validate.ts, contra el transcript real.
 */
export const ClipCandidateSchema = z.object({
  startLine: z
    .number()
    .int()
    .describe('Numero de la PRIMERA linea del tramo, tal como aparece entre corchetes.'),
  endLine: z
    .number()
    .int()
    .describe(
      'Numero de la ULTIMA linea del tramo. Debe ser mayor que startLine: un clip ' +
        'abarca varias lineas consecutivas, nunca una sola.',
    ),
  hook: z
    .string()
    .describe(
      'CITA LITERAL: copia exacta del texto de la linea startLine, palabra por ' +
        'palabra. NO es una descripcion ni un resumen de lo que se dice. Se ' +
        'compara automaticamente contra el transcript y, si no coincide, el ' +
        'candidato se descarta entero.',
    ),
  reason: z
    .string()
    .describe('Por que este momento funciona como clip independiente. Una o dos frases.'),
  caption: z
    .string()
    .describe('Texto para publicar en TikTok. Maximo 150 caracteres. Sin hashtags aqui.'),
  hashtags: z.array(z.string()).describe('Entre 3 y 5 hashtags, sin el simbolo almohadilla.'),
  score: z
    .number()
    .describe('Confianza propia de 0 a 100 en que este clip funcionara. Se honesto y discrimina.'),
})

/**
 * Tope de candidatos por ventana.
 *
 * El `max` no es cosmetico: sin el, la generacion guiada por gramatica de un
 * modelo local no tiene motivo para cerrar el array y sigue añadiendo clips
 * hasta agotar el limite de tokens. Medido con Ollama: una ventana consumio
 * 16.384 tokens en 23 minutos y devolvio un JSON incompleto.
 *
 * Estuvo en 3 por ese motivo, pero 3 resulto demasiado bajo para un modelo
 * capaz. Medido con Opus 4.8 sobre un podcast de 87 minutos: las ventanas
 * devolvian 3 candidatos y ninguna era descartada, o sea que cortaba el tope y
 * no la falta de material. Una pasada manual sobre el mismo transcript
 * encontro 37 momentos aprovechables, muy por encima de los 21 que permitia.
 *
 * 6 deja margen sobre lo que rinde de verdad una ventana de 15 minutos sin
 * quitar el freno que protege al modelo local.
 */
export const MAX_CLIPS_PER_WINDOW = 6

export const ClipSelectionSchema = z.object({
  clips: z
    .array(ClipCandidateSchema)
    .max(MAX_CLIPS_PER_WINDOW)
    .describe(`Como maximo ${MAX_CLIPS_PER_WINDOW} candidatos. Menos es correcto; cero tambien.`),
})

export type ClipCandidate = z.infer<typeof ClipCandidateSchema>
export type ClipSelection = z.infer<typeof ClipSelectionSchema>

/**
 * Candidato con los indices ya traducidos a segundos reales.
 *
 * Es la frontera del sistema: a partir de aqui nadie vuelve a ver un numero de
 * linea. El render, la compuerta y las variantes trabajan con segundos.
 */
export interface ResolvedClip {
  start: number
  end: number
  hook: string
  reason: string
  caption: string
  hashtags: string[]
  score: number
}

/** Candidato ya validado, con la ventana de la que salio. */
export interface ValidatedClip extends ResolvedClip {
  sourceId: string
  windowIndex: number
}
