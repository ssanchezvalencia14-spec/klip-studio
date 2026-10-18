import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as z from 'zod/v4'
import { createLogger } from '../lib/logger.js'
import {
  ClipCandidateSchema,
  ClipSelectionSchema,
  MAX_CLIPS_PER_WINDOW,
  type ClipCandidate,
} from './schema.js'

const log = createLogger('select')

export interface SelectionResult {
  clips: ClipCandidate[]
  inputTokens: number
  outputTokens: number
}

/**
 * Contrato de seleccion de momentos.
 *
 * Mismo patron que publicacion y metricas: el resto de la fase no sabe quien
 * responde. El prompt, el troceado en ventanas, la verificacion antialucinacion
 * y la deduplicacion son identicos con cualquier proveedor, y son la mayor
 * parte del trabajo.
 */
export interface SelectionProvider {
  readonly name: string
  readonly model: string
  /**
   * `maxClips` es el tope que se le pidio a ESTA ventana.
   *
   * No es decorativo para el modelo local: alli el esquema se convierte en una
   * gramatica que obliga la forma de la salida, y una gramatica que permite
   * seis elementos no le da al modelo ninguna razon para cerrar el array en
   * tres. Medido con qwen3:8b: generaba los 2000 tokens del tope y entregaba
   * el JSON a medias. La ruta de Anthropic lo ignora porque alli el tope del
   * prompt basta.
   */
  select(systemPrompt: string, userPrompt: string, maxClips: number): Promise<SelectionResult>
}

// --- Anthropic ---------------------------------------------------------------

export class AnthropicSelectionProvider implements SelectionProvider {
  readonly name = 'anthropic'

  constructor(
    private readonly client: Anthropic,
    readonly model: string,
    private readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
  ) {}

  // maxClips no se usa aqui: el tope va en el texto del prompt y un modelo
  // capaz lo respeta. Se acepta para cumplir la interfaz.
  async select(systemPrompt: string, userPrompt: string): Promise<SelectionResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      thinking: { type: 'adaptive' },
      output_config: { format: zodOutputFormat(ClipSelectionSchema), effort: this.effort },
    })

    return {
      clips: response.parsed_output?.clips ?? [],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
}

// --- Ollama ------------------------------------------------------------------

/**
 * Ventana de contexto que se pide a Ollama.
 *
 * ESTO ES CRITICO. Ollama usa 4096 tokens por defecto y **trunca en silencio**
 * lo que no cabe. Una ventana de 15 minutos de transcripcion ronda los 7.000
 * tokens, asi que con el valor por defecto el modelo veria poco mas de la mitad
 * y elegiria momentos solo del principio, sin que nada avise del recorte.
 *
 * 16384 cubre la ventana mas el prompt de sistema con holgura. Ocupa VRAM
 * adicional para la cache; si el modelo no carga, bajar este numero antes que
 * cambiar de modelo.
 */
const OLLAMA_CONTEXT = 16384

interface OllamaResponse {
  response?: string
  prompt_eval_count?: number
  eval_count?: number
  done_reason?: string
}

/**
 * Reensambla una respuesta en streaming de Ollama.
 *
 * El cuerpo llega como NDJSON: un objeto por linea, cada uno con un fragmento
 * de texto en `response`. Solo el ultimo trae los contadores de tokens y el
 * motivo de finalizacion, asi que se acumula el texto y se conserva el ultimo
 * objeto como fuente de los metadatos.
 *
 * Se trocea por saltos de linea y no por lectura, porque un fragmento de red
 * puede partir una linea por la mitad.
 */
async function readStream(response: Response): Promise<OllamaResponse> {
  if (response.body === null) throw new Error('Ollama no devolvio cuerpo.')

  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let last: OllamaResponse = {}

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')

      if (line === '') continue
      try {
        const parsed = JSON.parse(line) as OllamaResponse
        text += parsed.response ?? ''
        last = parsed
      } catch {
        // Una linea ilegible no invalida el resto de la generacion.
      }
    }
  }

  // El resto del buffer, sin salto de linea final.
  //
  // Esto no es un detalle: la ULTIMA linea del stream es la que trae
  // `done_reason` y los contadores de tokens, y no siempre termina en salto de
  // linea. Sin este bloque, el bucle de arriba la deja en el buffer y se pierde.
  // El sintoma era desconcertante: la ejecucion reportaba "0 tokens de entrada
  // / 0 de salida" despues de varios minutos de GPU al 90%.
  const rest = buffer.trim()
  if (rest !== '') {
    try {
      const parsed = JSON.parse(rest) as OllamaResponse
      text += parsed.response ?? ''
      last = parsed
    } catch {
      // Ignorar: un ultimo fragmento incompleto no debe tumbar la ventana.
    }
  }

  return { ...last, response: text }
}

/**
 * Rescata los objetos completos de un array JSON cortado a medias.
 *
 * Recorre el texto contando llaves fuera de cadenas, anota donde termina cada
 * objeto de primer nivel del array, y reconstruye el JSON cerrandolo tras el
 * ultimo completo. Devuelve null si no hay ninguno.
 *
 * Se cuenta a mano en vez de usar una expresion regular porque los campos de
 * texto contienen llaves y comillas escapadas, y cualquier patron ingenuo corta
 * en el sitio equivocado.
 */
export function salvageTruncatedJson(text: string): { clips: unknown[] } | null {
  const arrayStart = text.indexOf('[')
  if (arrayStart === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  let objectStart = -1
  const objects: string[] = []

  for (let i = arrayStart; i < text.length; i += 1) {
    const char = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (char === '{') {
      if (depth === 0) objectStart = i
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && objectStart !== -1) {
        objects.push(text.slice(objectStart, i + 1))
        objectStart = -1
      }
    }
  }

  if (objects.length === 0) return null

  /*
   * Cada objeto por separado, no todos o ninguno.
   *
   * Estaba en un solo map dentro de un try: si UNO fallaba al parsear, el
   * catch devolvia null y se tiraban tambien los que estaban perfectos. Es
   * justo lo contrario de para lo que existe esta funcion.
   */
  const clips: unknown[] = []
  for (const o of objects) {
    try {
      clips.push(JSON.parse(o) as unknown)
    } catch {
      // Un objeto ilegible no dice nada del siguiente.
    }
  }
  return clips.length === 0 ? null : { clips }
}

export class OllamaSelectionProvider implements SelectionProvider {
  readonly name = 'ollama'

  constructor(
    readonly model: string,
    private readonly baseUrl = 'http://localhost:11434',
  ) {}

  async select(
    systemPrompt: string,
    userPrompt: string,
    maxClips = MAX_CLIPS_PER_WINDOW,
  ): Promise<SelectionResult> {
    /*
     * El esquema se deriva del mismo objeto Zod que usa la ruta de Anthropic,
     * pero con el array acotado a lo que se pidio de verdad.
     *
     * MEDIDO el 2026-10-18 con qwen3:8b sobre una ventana de 271 lineas: con
     * la gramatica abierta a seis, generaba los 2000 tokens enteros
     * (done_reason=length, 5864 caracteres) y el JSON llegaba partido. Dos de
     * las tres ventanas del VOD se perdieron asi, y las dos eran las grandes,
     * de modo que los clips salian todos del ultimo tercio del video.
     *
     * El tope del prompt no basta aqui: la gramatica es lo unico que el modelo
     * no puede desobedecer.
     */
    /*
     * LAS COTAS VIVEN AQUI, no en el esquema compartido.
     *
     * El esquema de schema.ts lo usan las DOS rutas, y la salida estructurada
     * de Anthropic no admite minimos ni maximos -- esta avisado alli mismo.
     * Ponerlos en el sitio comun arreglaria el modelo local y romperia la API.
     *
     * Para Ollama, en cambio, el esquema se convierte en una gramatica, y una
     * gramatica sin cotas es una invitacion a no parar nunca.
     */
    const tope = Math.max(1, Math.min(maxClips, MAX_CLIPS_PER_WINDOW))
    const acotado = z.object({
      clips: z
        .array(
          z.object({
            startLine: z.number().int(),
            endLine: z.number().int(),
            // Una cita literal de una linea del transcript no pasa de aqui.
            hook: z.string().max(300),
            // Una o dos frases.
            reason: z.string().max(400),
            // El texto pide 150; 200 deja margen y cierra la puerta.
            caption: z.string().max(200),
            /*
             * EL MAXIMO DE HASHTAGS ES LO QUE EVITA EL BUCLE INFINITO.
             *
             * MEDIDO el 2026-10-18 con qwen3:8b sobre la ventana 1 de un VOD
             * real: sin tope se comio los 4000 tokens repitiendo
             * "PensamientosDeLaGeneracion", "CulturaDeLaGeneracion",
             * "MusicaDeLaGeneracion" una y otra vez, sin llegar a cerrar NI
             * SIQUIERA el primer clip. Quince minutos de video perdidos.
             *
             * Decir "entre 3 y 5" en la descripcion no basta: la descripcion
             * es texto que el modelo puede ignorar; el maximo del array no.
             */
            hashtags: z.array(z.string().max(40)).max(5),
            score: z.number(),
          }),
        )
        .max(tope),
    })
    const schema = z.toJSONSchema(acotado)

    // Se pide en streaming, y no por preferencia estetica.
    //
    // El `fetch` de Node aborta si las cabeceras tardan mas de 300 segundos.
    // Sin streaming, Ollama no responde nada hasta terminar de generar, asi que
    // toda ventana que el modelo tarde mas de cinco minutos en procesar muere
    // con un escueto "fetch failed" que parece un problema de red. Ocurrio en 3
    // de 7 ventanas la primera vez que se ejecuto esto.
    //
    // En streaming las cabeceras llegan al instante y cada token es un trozo,
    // asi que el reloj no llega a saltar por larga que sea la generacion.
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        format: schema,
        stream: true,
        // Los modelos de la familia qwen3 razonan antes de responder y ese
        // razonamiento consume tokens de generacion. Con el esquema JSON activo
        // no aporta nada y hacia que la respuesta se cortara a mitad del objeto.
        think: false,
        options: {
          num_ctx: OLLAMA_CONTEXT,
          temperature: 0.4,
          /*
           * Margen para que seis candidatos completos quepan.
           *
           * Estuvo en 2000 con la cuenta de que "tres candidatos ocupan
           * bastante menos". Cierto, pero la gramatica permitia seis y el
           * modelo los llenaba: medido, 2000 tokens exactos y el JSON
           * partido. Ahora la gramatica se acota al tope pedido (ver mas
           * arriba), asi que esto es solo holgura por si el modelo es
           * verboso: 144 tokens por clip medidos x 6 clips deja de sobra.
           *
           * Sigue acotado a proposito. Sin tope, una generacion desbocada
           * tardaba 23 minutos en rendirse.
           */
          num_predict: 4000,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(
        `Ollama devolvio HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
      )
    }

    const payload = await readStream(response)
    const text = payload.response ?? ''

    if (payload.done_reason === 'length') {
      log.warn(
        'La respuesta se corto por longitud (num_predict). El JSON puede venir incompleto.',
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Antes de rendirse, se intenta rescatar los candidatos completos.
      //
      // Una respuesta cortada a mitad del tercer clip contiene dos clips
      // perfectamente validos. Descartar la ventana entera por eso tira trabajo
      // bueno: en una prueba real, 5 de 7 ventanas se perdieron asi.
      const salvaged = salvageTruncatedJson(text)
      if (salvaged === null) {
        throw new Error(`Ollama no devolvio JSON valido: ${text.slice(0, 300)}`)
      }
      log.warn('Respuesta cortada: se rescataron los candidatos completos.')
      parsed = salvaged
    }

    // Se valida contra el mismo esquema Zod. Que Ollama acepte un `format` no
    // garantiza que el modelo lo respete; sin esta comprobacion entrarian
    // candidatos con campos ausentes o de otro tipo.
    const result = ClipSelectionSchema.safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `La salida de Ollama no cumple el esquema: ${result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      )
    }

    return {
      clips: result.data.clips,
      inputTokens: payload.prompt_eval_count ?? 0,
      outputTokens: payload.eval_count ?? 0,
    }
  }
}

