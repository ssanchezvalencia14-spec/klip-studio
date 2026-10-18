import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createHash } from 'node:crypto'
import * as z from 'zod/v4'
import { optionalEnv } from '../lib/env.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('captions')

export interface CaptionSet {
  caption: string
  hashtags: string[]
}

/**
 * Estrategia de variacion de textos.
 *
 * Existe como interfaz porque hoy hay dos implementaciones con capacidades muy
 * distintas, y conviene que quede explicito cual esta en uso.
 */
export interface CaptionVarier {
  readonly name: string
  vary(base: CaptionSet, accountIds: string[]): Promise<Map<string, CaptionSet>>
}

const CaptionVariantsSchema = z.object({
  variants: z
    .array(
      z.object({
        caption: z.string().describe('Reescritura del caption. Maximo 150 caracteres.'),
        hashtags: z.array(z.string()).describe('Entre 3 y 5 hashtags, sin almohadilla.'),
      }),
    )
    .describe('Una entrada por cuenta, en el mismo orden pedido.'),
})

/**
 * Reescribe los textos con un modelo. Es la implementacion correcta.
 *
 * Se le pide que varie angulo y estructura, no sinonimos: rotar sinonimos sobre
 * una plantilla produce textos que se parecen entre si de una forma que se
 * detecta trivialmente agrupando por n-gramas.
 */
export class ModelCaptionVarier implements CaptionVarier {
  readonly name = 'modelo'

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async vary(base: CaptionSet, accountIds: string[]): Promise<Map<string, CaptionSet>> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 8000,
      system:
        'Escribes captions para TikTok. Te dan un caption base y debes producir N ' +
        'reescrituras distintas para publicar el MISMO video en N cuentas.\n\n' +
        'Cada reescritura debe atacar el video desde un angulo diferente: una puede ' +
        'ser una pregunta, otra una cita textual, otra una afirmacion tajante, otra ' +
        'apelar a la incredulidad. NO rotes sinonimos sobre la misma frase: dos ' +
        'captions que comparten estructura se agrupan trivialmente y delatan la red.\n\n' +
        'Mantén el idioma del original. Maximo 150 caracteres. Sin emojis de relleno. ' +
        'No destripes el remate del video.',
      messages: [
        {
          role: 'user',
          content:
            `Caption base: ${base.caption}\n` +
            `Hashtags base: ${base.hashtags.join(', ')}\n\n` +
            `Genera exactamente ${accountIds.length} variantes.`,
        },
      ],
      thinking: { type: 'adaptive' },
      output_config: { format: zodOutputFormat(CaptionVariantsSchema), effort: 'medium' },
    })

    const parsed = response.parsed_output
    if (parsed === null || parsed === undefined) {
      throw new Error('El modelo no devolvio variantes de texto validas.')
    }

    const result = new Map<string, CaptionSet>()
    accountIds.forEach((accountId, i) => {
      const variant = parsed.variants[i]
      result.set(accountId, variant ?? base)
    })
    return result
  }
}

/**
 * Alternativa sin modelo: varia solo los hashtags.
 *
 * IMPORTANTE, y no es un detalle menor: esto NO resuelve el problema. El texto
 * del caption queda identico en las 20 cuentas, y publicar el mismo texto desde
 * 20 cuentas es una señal de coordinacion tan clara como publicar el mismo
 * archivo. Lo unico que aporta es no empeorar las cosas con plantillas de
 * sinonimos, que se detectan igual de facil y ademas se leen mal.
 *
 * Sirve para no bloquear el resto del sistema mientras no hay modelo
 * disponible. No es una solucion.
 */
export class HashtagOnlyVarier implements CaptionVarier {
  readonly name = 'solo-hashtags'

  /** El aviso se emite una vez, no una por clip: repetirlo solo tapa el log. */
  private warned = false

  vary(base: CaptionSet, accountIds: string[]): Promise<Map<string, CaptionSet>> {
    if (!this.warned) {
      this.warned = true
      log.warn(
        'Variacion de textos degradada: los captions seran IDENTICOS en todas las cuentas. ' +
          'Es un patron detectable. Configura ANTHROPIC_API_KEY con saldo, o un modelo local, ' +
          'para variar el texto de verdad.',
      )
    }

    const result = new Map<string, CaptionSet>()

    for (const accountId of accountIds) {
      // Subconjunto y orden deterministas por cuenta.
      const digest = createHash('sha256').update(accountId).digest()
      const shuffled = [...base.hashtags]
        .map((tag, i) => ({ tag, rank: digest.readUInt8(i % digest.length) }))
        .sort((a, b) => a.rank - b.rank)
        .map((x) => x.tag)

      const keep = Math.max(3, base.hashtags.length - (digest.readUInt8(0) % 2))
      result.set(accountId, { caption: base.caption, hashtags: shuffled.slice(0, keep) })
    }

    return Promise.resolve(result)
  }
}

/** Elige la estrategia segun lo que haya configurado. */
export function createCaptionVarier(): CaptionVarier {
  const apiKey = optionalEnv('ANTHROPIC_API_KEY')
  if (apiKey === undefined) return new HashtagOnlyVarier()

  const model = optionalEnv('SELECT_MODEL') ?? 'claude-opus-5-5'
  return new ModelCaptionVarier(new Anthropic({ apiKey }), model)
}
