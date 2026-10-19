import { optionalEnv } from '../lib/env.js'
import type { Transcript } from '../types.js'
import { llamarClaude } from './claude-cli.js'

/**
 * El contrato con cualquier IA que elija momentos.
 *
 * Mismo patron que publicacion y metricas: el resto del sistema no sabe quien
 * responde. Hoy hay un proveedor de texto, `claude-cli` (Claude Code con la
 * suscripcion). La API de pago sigue disponible por su camino de siempre
 * (`LLM_PROVIDER=anthropic-api`, ver src/select/select.ts). Añadir otro, por
 * ejemplo Gemini, es escribir una clase con `completar` y un caso en
 * `crearProveedorLlm`: el prompt, el troceado, la validacion y la cache son
 * comunes y viven en src/llm/seleccion.ts.
 */
export interface ProveedorLlm {
  readonly nombre: string
  readonly modelo: string
  /** El coste no se calcula: va en la suscripcion. */
  readonly incluidoEnSuscripcion: boolean
  completar(sistema: string, usuario: string): Promise<{ texto: string; ms: number }>
}

export type NombreProveedor = 'claude-cli' | 'anthropic-api' | 'ollama'

/**
 * Que proveedor toca.
 *
 * `SELECT_PROVIDER=ollama` se respeta por compatibilidad: es como se activaba
 * el modelo local antes de esta fase. Si no, manda `LLM_PROVIDER`. Si tampoco,
 * lo guardado en Ajustes ('local' es Ollama) y, por defecto, la suscripcion.
 */
export function nombreProveedor(preferido?: string): NombreProveedor {
  if (optionalEnv('SELECT_PROVIDER') === 'ollama') return 'ollama'
  const env = optionalEnv('LLM_PROVIDER')
  if (env === 'claude-cli' || env === 'anthropic-api' || env === 'ollama') return env
  if (env !== undefined) {
    throw new Error(`LLM_PROVIDER=${env} no existe. Usa claude-cli, anthropic-api u ollama.`)
  }
  if (preferido === 'local') return 'ollama'
  return 'claude-cli'
}

export function configuracionCli(): { ruta: string; modelo: string; timeoutMs: number } {
  const timeout = Number(optionalEnv('LLM_TIMEOUT_MS') ?? '180000')
  return {
    ruta: optionalEnv('CLAUDE_CLI_PATH') ?? 'claude',
    modelo: optionalEnv('LLM_MODEL') ?? 'sonnet',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 180_000,
  }
}

export class ClaudeCliProveedor implements ProveedorLlm {
  readonly nombre = 'claude-cli'
  readonly incluidoEnSuscripcion = true

  constructor(
    private readonly ruta: string,
    readonly modelo: string,
    private readonly timeoutMs: number,
  ) {}

  async completar(sistema: string, usuario: string): Promise<{ texto: string; ms: number }> {
    const r = await llamarClaude({
      ruta: this.ruta,
      modelo: this.modelo,
      sistema,
      usuario,
      timeoutMs: this.timeoutMs,
    })
    return { texto: r.texto, ms: r.ms }
  }
}

/** El proveedor de texto configurado. Solo `claude-cli` pasa por aqui. */
export function crearProveedorLlm(modelo?: string): ProveedorLlm {
  const c = configuracionCli()
  return new ClaudeCliProveedor(c.ruta, modelo ?? c.modelo, c.timeoutMs)
}

/**
 * La interfaz unica que pide el plan: transcripcion dentro, momentos fuera.
 *
 * Es `selectClips` con otro nombre. Se carga perezosamente para no crear un
 * ciclo de importaciones con src/select/select.ts, que usa este modulo.
 */
export async function elegirMomentos(
  transcripcion: Transcript,
  opciones: import('../select/select.js').SelectOptions = {},
): Promise<import('../select/select.js').SelectResult> {
  const { selectClips } = await import('../select/select.js')
  return selectClips(transcripcion, opciones)
}
