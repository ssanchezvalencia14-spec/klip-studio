import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createHash } from 'node:crypto'
import * as z from 'zod/v4'
import { optionalEnv } from '../lib/env.js'
import { createLogger } from '../lib/logger.js'
import { crearProveedorLlm, nombreProveedor, type ProveedorLlm } from '../llm/provider.js'

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

  /** `callado`: cuando lo usa PlantillaVarier, que si cambia el texto. */
  constructor(private readonly callado = false) {}

  /** El aviso se emite una vez, no una por clip: repetirlo solo tapa el log. */
  private warned = false

  vary(base: CaptionSet, accountIds: string[]): Promise<Map<string, CaptionSet>> {
    if (!this.warned && !this.callado) {
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

const SISTEMA_VARIACION =
  'Escribes captions para TikTok. Te dan un caption base y debes producir N ' +
  'reescrituras distintas para publicar el MISMO video en N cuentas.\n\n' +
  'Cada reescritura debe atacar el video desde un angulo diferente: una puede ' +
  'ser una pregunta, otra una cita textual, otra una afirmacion tajante, otra ' +
  'apelar a la incredulidad. NO rotes sinonimos sobre la misma frase: dos ' +
  'captions que comparten estructura se agrupan trivialmente y delatan la red.\n\n' +
  'Mantén el idioma del original. Maximo 150 caracteres. Sin emojis de relleno. ' +
  'No destripes el remate del video.\n\n' +
  'Responde SOLO con JSON, sin texto alrededor: ' +
  '{"variants":[{"caption":"...","hashtags":["a","b","c"]}]} ' +
  '(hashtags sin almohadilla, entre 3 y 5).'

/** El primer objeto JSON del texto: el modelo a veces lo envuelve en ```json. */
export function extraerJson(texto: string): unknown {
  const ini = texto.indexOf('{')
  const fin = texto.lastIndexOf('}')
  if (ini < 0 || fin <= ini) throw new Error('La respuesta no trae JSON.')
  return JSON.parse(texto.slice(ini, fin + 1))
}

/**
 * Variacion con la SUSCRIPCION (Fase 7), por claude -p.
 *
 * Desde la Fase 1 la IA va por la suscripcion y no por la API, pero esta
 * parte seguia pidiendo ANTHROPIC_API_KEY: sin ella caia a variar solo los
 * hashtags, y el texto salia identico en todas las cuentas.
 */
export class SubscriptionCaptionVarier implements CaptionVarier {
  readonly name = 'suscripcion'

  constructor(private readonly llm: ProveedorLlm) {}

  async vary(base: CaptionSet, accountIds: string[]): Promise<Map<string, CaptionSet>> {
    const { texto } = await this.llm.completar(
      SISTEMA_VARIACION,
      `Caption base: ${base.caption}\nHashtags base: ${base.hashtags.join(', ')}\n\n` +
        `Genera exactamente ${accountIds.length} variantes.`,
    )
    const parsed = CaptionVariantsSchema.safeParse(extraerJson(texto))
    if (!parsed.success) throw new Error('El modelo no devolvio variantes de texto validas.')
    const result = new Map<string, CaptionSet>()
    accountIds.forEach((accountId, i) => {
      const v = parsed.data.variants[i]
      result.set(
        accountId,
        v === undefined
          ? base
          : {
              caption: v.caption.slice(0, 150),
              hashtags: v.hashtags.map((h) => h.replace(/^#/, '')).filter(Boolean).slice(0, 5),
            },
      )
    })
    return result
  }
}

/**
 * Alternativa sin modelo que SI cambia el texto (Fase 7).
 *
 * Mejor que solo-hashtags, peor que un modelo: cada cuenta recibe el caption
 * con una estructura distinta (pregunta, aviso, cita...) elegida de forma
 * estable por cuenta, mas su propio orden y seleccion de hashtags. No engaña
 * a un clasificador serio, pero ya no hay N textos identicos.
 */
export class PlantillaVarier implements CaptionVarier {
  readonly name = 'plantillas'

  private static readonly FORMAS: ((c: string) => string)[] = [
    (c) => c,
    (c) => `${c.replace(/[.!?¡¿]+$/, '')}. Míralo hasta el final.`,
    (c) => `¿Lo sabías? ${c}`,
    (c) => `"${c.replace(/[.!?]+$/, '')}"`,
    (c) => `Esto hay que verlo: ${c.charAt(0).toLowerCase()}${c.slice(1)}`,
    (c) => `${c.replace(/[.!?]+$/, '')}. ¿Qué opinas?`,
    (c) => `Atento a esto. ${c}`,
  ]

  vary(base: CaptionSet, accountIds: string[]): Promise<Map<string, CaptionSet>> {
    const hashtags = new HashtagOnlyVarier(true)
    const result = new Map<string, CaptionSet>()
    return hashtags.vary(base, accountIds).then((tags) => {
      accountIds.forEach((accountId, i) => {
        const digest = createHash('sha256').update(`forma::${accountId}`).digest()
        // Por posicion y no solo por hash: dos cuentas seguidas nunca comparten forma.
        const forma = PlantillaVarier.FORMAS[(i + digest.readUInt8(0)) % PlantillaVarier.FORMAS.length]!
        result.set(accountId, {
          caption: forma(base.caption.trim()).slice(0, 150),
          hashtags: tags.get(accountId)?.hashtags ?? base.hashtags,
        })
      })
      return result
    })
  }
}

/** Elige la estrategia segun lo que haya configurado. */
export function createCaptionVarier(): CaptionVarier {
  const apiKey = optionalEnv('ANTHROPIC_API_KEY')
  if (apiKey !== undefined && nombreProveedor() === 'anthropic-api') {
    const model = optionalEnv('SELECT_MODEL') ?? 'claude-opus-5-5'
    return new ModelCaptionVarier(new Anthropic({ apiKey }), model)
  }
  if (nombreProveedor() === 'claude-cli') return new SubscriptionCaptionVarier(crearProveedorLlm())
  return new PlantillaVarier()
}
