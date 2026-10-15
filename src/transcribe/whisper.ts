import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../lib/env.js'
import { hasContent, toFilterPath, workDir } from '../lib/fsx.js'
import { createLogger, formatDuration } from '../lib/logger.js'
import { ffmpeg } from '../lib/proc.js'

const log = createLogger('whisper')

/**
 * Ventana de audio, en segundos, que el filtro entrega a whisper por inferencia.
 *
 * El valor por defecto del filtro es 3 segundos y produce transcripciones malas:
 * el filtro trocea el audio en ventanas de tamaño fijo, y toda palabra que cae
 * sobre una frontera se parte. Medido en esta maquina con voz sintetica:
 *
 *   queue=3  -> "The pipeline downloads a long video, trance," (corta "transcribes")
 *   queue=15 -> "The pipeline downloads a long video, transcribes the audio with
 *                Whisper, and then selects the best moments automatically."
 *
 * Se usa 30 porque es la ventana de contexto nativa de whisper; ventanas mayores
 * no aportan contexto adicional y solo empeoran la granularidad de los tiempos.
 * El rango que acepta el filtro es [0.02, 3600].
 */
export const DEFAULT_QUEUE_SECONDS = 30

export interface TranscribeOptions {
  /** Codigo de idioma, o 'auto' para deteccion. */
  language?: string
  queueSeconds?: number
  /** Fuerza la transcripcion aunque ya exista salida previa. */
  force?: boolean
  /**
   * Activa el VAD. Desactivado por defecto y a proposito.
   *
   * Medido en esta maquina sobre 33 s de audio, con el mismo modelo y la misma
   * ventana:
   *
   *   sin VAD -> 2.5 s
   *   con VAD -> 87.6 s
   *
   * Es 35 veces mas lento y la salida fue byte a byte identica. La
   * implementacion de VAD de este build no esta acelerada y no aporta nada aqui.
   * Sobre un stream de 4 horas la diferencia es de 18 minutos frente a 10 horas.
   *
   * Se conserva la opcion porque en audio con silencios largos el VAD podria
   * ahorrar inferencias, pero hay que medirlo antes de activarlo.
   */
  useVad?: boolean
}

/**
 * Transcribe el audio con el filtro whisper integrado de ffmpeg.
 *
 * Devuelve la ruta del archivo crudo. OJO: el formato NO es un JSON: es NDJSON,
 * un objeto por linea. El parseo vive en parse.ts.
 */
export async function transcribeAudio(
  sourceId: string,
  audioPath: string,
  options: TranscribeOptions = {},
): Promise<string> {
  const dir = workDir(sourceId)
  const rawPath = join(dir, 'transcript.raw.jsonl')

  if (!options.force && hasContent(rawPath, 32)) {
    log.info('Transcripcion cruda ya existe, se omite.')
    return rawPath
  }

  const modelPath = paths.whisperModel
  if (!existsSync(modelPath)) {
    throw new Error(
      `No existe el modelo whisper en ${modelPath}. Ejecuta "npm run doctor" para diagnosticar.`,
    )
  }

  const language = options.language ?? 'auto'
  const queueSeconds = options.queueSeconds ?? DEFAULT_QUEUE_SECONDS

  // Las rutas se escapan porque los dos puntos de "C:" separan opciones dentro
  // del filtergraph. Ver toFilterPath para el detalle de por que es doble.
  const filterOptions = [
    `model=${toFilterPath(modelPath)}`,
    `language=${language}`,
    'format=json',
    `queue=${queueSeconds}`,
    `destination=${toFilterPath(rawPath)}`,
  ]

  if (options.useVad === true) {
    const vadModel = paths.whisperVadModel
    if (vadModel === undefined || !existsSync(vadModel)) {
      throw new Error(
        'Se pidio VAD pero WHISPER_VAD_MODEL_PATH no apunta a un archivo existente.',
      )
    }
    filterOptions.push(`vad_model=${toFilterPath(vadModel)}`)
    log.warn('VAD activo: medido 35x mas lento en esta maquina. Solo para experimentar.')
  }

  log.info(`Transcribiendo (modelo=${language}, ventana=${queueSeconds}s)...`)

  const { durationMs } = await ffmpeg(
    ['-y', '-i', audioPath, '-af', `whisper=${filterOptions.join(':')}`, '-f', 'null', '-'],
    {
      onStderr: (chunk) => {
        if (chunk.includes('run transcription at')) log.debug(chunk.trim())
      },
    },
  )

  if (!hasContent(rawPath, 2)) {
    throw new Error(
      `El filtro whisper termino sin error pero no escribio ${rawPath}. ` +
        'Revisa el escape de rutas del filtergraph.',
    )
  }

  log.info(`Transcripcion terminada en ${formatDuration(durationMs)}`)
  return rawPath
}
