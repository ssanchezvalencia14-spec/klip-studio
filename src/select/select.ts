import Anthropic from '@anthropic-ai/sdk'
import { clasificarFallo, type FalloSelect } from './fallo.js'
import { join } from 'node:path'
import { optionalEnv, requireEnv } from '../lib/env.js'
import { workDir, writeJson } from '../lib/fsx.js'
import { createLogger, formatDuration } from '../lib/logger.js'
import type { Transcript } from '../types.js'
import { buildWindowPrompt, SELECTION_SYSTEM_PROMPT } from './prompt.js'
import {
  AnthropicSelectionProvider,
  OllamaSelectionProvider,
  type SelectionProvider,
} from './provider.js'
import { type ValidatedClip } from './schema.js'
import { dedupe, validateCandidates } from './validate.js'
import { buildWindows, type TranscriptWindow } from './window.js'

const log = createLogger('select')

/**
 * Modelo por defecto.
 *
 * Se usa el mas capaz a proposito: la seleccion de momentos es la pieza que
 * decide si el producto funciona, y el coste por VOD es de centimos frente al
 * de renderizar y publicar 60 clips diarios. Se puede bajar con SELECT_MODEL en
 * .env, pero conviene medir la calidad antes de hacerlo.
 */
const DEFAULT_MODEL = 'claude-opus-5-5'

/**
 * Precios por millon de tokens. Solo para estimar; verifica antes de presupuestar.
 *
 * VERIFICADOS el 2026-10-18 contra la tabla de modelos vigente. Dos arreglos de
 * esa revision: se añade claude-opus-5-5, y claude-sonnet-5 estaba a 3/15, que
 * son los precios de Sonnet 4.6 -- los suyos son 2/10, asi que el panel
 * sobrestimaba su coste un cincuenta por ciento.
 *
 * Un modelo que no este aqui no rompe nada: estimatedUsd sale null y el panel
 * enseña el coste en blanco en vez de una cifra inventada.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

export interface SelectOptions {
  /** 'anthropic' o 'local'. Sin esto, lo que diga el entorno o la API. */
  selector?: string
  maxClipsPerWindow?: number
  minDurationSec?: number
  maxDurationSec?: number
  windowSec?: number
  overlapSec?: number
  sourceTitle?: string
  /** Procesa solo las N primeras ventanas. Para iterar sobre el prompt. */
  maxWindows?: number
}

export interface SelectResult {
  clips: ValidatedClip[]
  windows: number
  /**
   * Ventanas que ni siquiera llegaron a responder.
   *
   * Sin este dato, quedarse sin saldo en la API producia el mismo resultado
   * que un VOD sin momentos buenos: cero clips y salida 0. El 2026-10-01 la
   * tarea se marco 'ok' con 'Your credit balance is too low' en el registro, y
   * desde el panel se leia como que el video no daba para nada.
   */
  fallidas: number
  /**
   * Por que se corto, si se corto por algo que se iba a repetir.
   *
   * Lo usa el guion para decir QUE hacer en vez de "mira el registro".
   */
  motivoCorte?: FalloSelect
  usage: { inputTokens: number; outputTokens: number; estimatedUsd: number | null }
  elapsedMs: number
}

/**
 * Elige el proveedor segun lo configurado.
 *
 * HACE FALTA SELECT_PROVIDER=ollama PARA USAR EL MODELO LOCAL. Antes bastaba
 * con que existiera OLLAMA_MODEL en .env, y eso resulto ser una trampa: esa
 * variable se quedo escrita de cuando se probo Ollama, asi que el panel elegia
 * en silencio un modelo que no sabe hacer esta tarea.
 *
 * Medido con qwen3:8b sobre un transcript real: devolvia tramos consecutivos
 * sin huecos que cubrian el video entero, o sea que estaba dividiendo en
 * capitulos en vez de elegir los mejores momentos, y ademas citaba frases que
 * no aparecian en el texto. Una pasada se comio 16.384 tokens en 23 minutos
 * para devolver un JSON incompleto.
 *
 * Caer en eso por una linea olvidada en un fichero de configuracion cuesta
 * media hora de GPU y produce clips inservibles sin avisar de nada.
 */
export function createSelectionProvider(preferido?: string): SelectionProvider {
  /*
   * El entorno manda sobre lo guardado, igual que con el proveedor de
   * publicacion: para una prueba suelta desde consola es mas comodo exportar
   * una variable que tocar la base.
   *
   * `preferido` viene de Ajustes y usa los nombres del panel ('local'), no el
   * del motor ('ollama'); se traducen aqui para no filtrar el nombre de una
   * herramienta concreta a una pantalla que lee quien no la conoce.
   */
  const elegido = optionalEnv('SELECT_PROVIDER') ?? (preferido === 'local' ? 'ollama' : preferido)

  if (elegido === 'ollama') {
    const ollamaModel = optionalEnv('OLLAMA_MODEL')
    if (ollamaModel === undefined) {
      throw new Error(
        'SELECT_PROVIDER=ollama pero falta OLLAMA_MODEL. Indica que modelo local usar.',
      )
    }
    return new OllamaSelectionProvider(
      ollamaModel,
      optionalEnv('OLLAMA_URL') ?? 'http://localhost:11434',
    )
  }

  const apiKey = requireEnv('ANTHROPIC_API_KEY')
  const model = optionalEnv('SELECT_MODEL') ?? DEFAULT_MODEL
  /*
   * xhigh entra en la lista: Opus 5.5 lo admite y queda entre high y max.
   * Sin el, poner SELECT_EFFORT=xhigh en el .env lo aceptaba TypeScript por el
   * casting y lo rechazaba la API a mitad del VOD.
   */
  const effort = (optionalEnv('SELECT_EFFORT') ?? 'high') as
    | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  return new AnthropicSelectionProvider(new Anthropic({ apiKey }), model, effort)
}

async function selectFromWindow(
  provider: SelectionProvider,
  window: TranscriptWindow,
  transcript: Transcript,
  options: Required<Pick<SelectOptions, 'maxClipsPerWindow' | 'minDurationSec' | 'maxDurationSec'>>,
  sourceTitle: string,
): Promise<{
  candidates: ValidatedClip[]
  inputTokens: number
  outputTokens: number
  /** La ventana no llego a responder. Distinto de responder y no dar clips. */
  fallo: boolean
  /** Por que fallo, cuando fallo. Sirve para no repetir lo irrepetible. */
  motivo?: FalloSelect
}> {
  const prompt = buildWindowPrompt({
    window,
    maxClips: options.maxClipsPerWindow,
    minDurationSec: options.minDurationSec,
    maxDurationSec: options.maxDurationSec,
    sourceTitle,
    totalDurationSec: transcript.durationSec,
  })

  let result
  try {
    // El tope viaja al proveedor: el modelo local lo necesita como gramatica,
    // no como frase en el prompt. Ver SelectionProvider.select.
    result = await provider.select(SELECTION_SYSTEM_PROMPT, prompt, options.maxClipsPerWindow)
  } catch (error) {
    /*
     * Una ventana que falla no debe tumbar el VOD entero: las demas siguen
     * aportando candidatos. PERO hay fallos que no son de la ventana sino de
     * la configuracion -- la clave, el saldo, el modelo -- y esos se repiten
     * identicos en todas. Se clasifican aqui y quien llama decide si sigue.
     */
    const motivo = clasificarFallo(error)
    log.warn(`Ventana ${window.index}: ${motivo.mensaje}`)
    return { candidates: [], inputTokens: 0, outputTokens: 0, fallo: true, motivo }
  }

  const { inputTokens, outputTokens } = result

  const { accepted, rejected } = validateCandidates(result.clips, window, transcript, {
    minDurationSec: options.minDurationSec,
    maxDurationSec: options.maxDurationSec,
  })

  for (const { clip, reason } of rejected) {
    log.warn(`Ventana ${window.index}: descartado lineas ${clip.startLine}-${clip.endLine}: ${reason}`)
  }

  log.info(
    `Ventana ${window.index}: ${accepted.length} aceptado(s), ${rejected.length} descartado(s)`,
  )

  return { candidates: accepted, inputTokens, outputTokens, fallo: false }
}

export async function selectClips(
  transcript: Transcript,
  options: SelectOptions = {},
): Promise<SelectResult> {
  const startedAt = performance.now()

  const provider = createSelectionProvider(options.selector)

  const limits = {
    maxClipsPerWindow: options.maxClipsPerWindow ?? 3,
    minDurationSec: options.minDurationSec ?? 20,
    maxDurationSec: options.maxDurationSec ?? 90,
  }

  const allWindows = buildWindows(transcript, {
    ...(options.windowSec !== undefined ? { windowSec: options.windowSec } : {}),
    ...(options.overlapSec !== undefined ? { overlapSec: options.overlapSec } : {}),
  })

  const windows =
    options.maxWindows === undefined ? allWindows : allWindows.slice(0, options.maxWindows)

  log.info(
    `${windows.length} de ${allWindows.length} ventana(s) | proveedor=${provider.name} | modelo=${provider.model}`,
  )

  const all: ValidatedClip[] = []
  let inputTokens = 0
  let outputTokens = 0
  let fallidas = 0
  let motivoCorte: FalloSelect | undefined

  // En serie a proposito: son pocas llamadas, el paralelismo no cambia la
  // experiencia y en cambio complica el manejo de limites de peticiones.
  for (const window of windows) {
    const result = await selectFromWindow(
      provider,
      window,
      transcript,
      limits,
      options.sourceTitle ?? transcript.sourceId,
    )
    all.push(...result.candidates)
    inputTokens += result.inputTokens
    outputTokens += result.outputTokens
    if (result.fallo) fallidas += 1

    /*
     * Corte en seco cuando el fallo no depende de la ventana.
     *
     * Con la clave rechazada, seguir es gastar una llamada por ventana para
     * recibir exactamente el mismo 401. Un VOD de tres horas son doce
     * ventanas y doce copias del mismo error, que ademas entierran la unica
     * linea que explica que pasa.
     */
    if (result.motivo?.definitivo === true) {
      motivoCorte = result.motivo
      log.error(result.motivo.mensaje)
      const quedan = windows.length - window.index - 1
      if (quedan > 0) {
        log.warn(`No se intentan las ${quedan} ventana(s) restantes: fallarian igual.`)
      }
      break
    }
  }

  const clips = dedupe(all)

  const price = provider.name === 'ollama' ? { input: 0, output: 0 } : PRICING[provider.model]
  const estimatedUsd =
    price === undefined
      ? null
      : (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output

  /*
   * NO se escribe clips.json cuando no se pudo ni preguntar.
   *
   * Se escribia siempre, tambien con cero clips, asi que relanzar la
   * seleccion con la clave caducada MACHACABA los momentos buenos de una
   * pasada anterior y los dejaba en una lista vacia. El VOD seguia ahi, la
   * transcripcion tambien, pero el trabajo de eleccion se perdia y habia que
   * pagarlo otra vez.
   *
   * La condicion es "no respondio NINGUNA ventana", no "salieron cero clips":
   * un VOD que se consulta entero y de verdad no da para nada es un resultado
   * legitimo, y ese si tiene que quedar escrito para no volver a intentarlo.
   */
  const nadieRespondio = motivoCorte !== undefined || (fallidas === windows.length && windows.length > 0)
  if (nadieRespondio) {
    log.warn('No se toca clips.json: no se pudo preguntar, asi que lo que hubiera sigue valiendo.')
  } else {
    writeJson(join(workDir(transcript.sourceId), 'clips.json'), {
      sourceId: transcript.sourceId,
      model: provider.model,
      provider: provider.name,
      generatedFromWindows: windows.length,
      clips,
    })
  }

  const elapsedMs = performance.now() - startedAt
  log.info(`${clips.length} clip(s) tras deduplicar, en ${formatDuration(elapsedMs)}`)

  return {
    clips,
    windows: windows.length,
    fallidas,
    ...(motivoCorte === undefined ? {} : { motivoCorte }),
    usage: { inputTokens, outputTokens, estimatedUsd },
    elapsedMs,
  }
}
