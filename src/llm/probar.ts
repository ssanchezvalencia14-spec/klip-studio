import { optionalEnv } from '../lib/env.js'
import { ErrorIA, mensajeIA } from './errores.js'
import type { EstadoIA } from './estado.js'
import { ClaudeCliProveedor, configuracionCli, nombreProveedor } from './provider.js'

export interface ResultadoPrueba {
  estado: EstadoIA
  /** Frase para la pantalla. Sin rutas ni nombres de usuario. */
  mensaje: string
  proveedor: string
  modelo: string
  reanudarEn?: string
  ms: number
}

/**
 * Una llamada minima a la IA configurada, para saber si esta lista.
 *
 * La usan "Probar IA" (Ajustes, IA) y `npm run check-health`. Con la
 * suscripcion se prueba con el modelo mas pequeño (`LLM_MODEL_PRUEBA`, por
 * defecto haiku): lo que se comprueba es la sesion y el limite, no la calidad.
 */
export async function probarIA(): Promise<ResultadoPrueba> {
  const inicio = Date.now()
  const proveedor = nombreProveedor()

  if (proveedor === 'claude-cli') {
    const c = configuracionCli()
    const modelo = optionalEnv('LLM_MODEL_PRUEBA') ?? 'haiku'
    const llm = new ClaudeCliProveedor(c.ruta, modelo, Math.min(c.timeoutMs, 90_000))
    try {
      await llm.completar('Responde solo con la palabra ok.', 'ok')
      return { estado: 'lista', mensaje: 'La IA responde.', proveedor, modelo, ms: Date.now() - inicio }
    } catch (e) {
      const err = e instanceof ErrorIA ? e : new ErrorIA('otro', mensajeIA('otro'), undefined, String(e))
      const estado: EstadoIA =
        err.clase === 'sin_sesion' || err.clase === 'limite' || err.clase === 'no_encontrado' || err.clase === 'tiempo'
          ? err.clase
          : 'error'
      return {
        estado,
        mensaje: err.message,
        proveedor,
        modelo,
        ...(err.reanudarEn === undefined ? {} : { reanudarEn: err.reanudarEn.toISOString() }),
        ms: Date.now() - inicio,
      }
    }
  }

  if (proveedor === 'ollama') {
    const base = optionalEnv('OLLAMA_URL') ?? 'http://localhost:11434'
    const modelo = optionalEnv('OLLAMA_MODEL') ?? ''
    try {
      const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(15_000) })
      return r.ok
        ? { estado: 'lista', mensaje: 'El modelo local responde.', proveedor, modelo, ms: Date.now() - inicio }
        : { estado: 'error', mensaje: `El modelo local respondió con error (${r.status}).`, proveedor, modelo, ms: Date.now() - inicio }
    } catch {
      return { estado: 'error', mensaje: 'El modelo local no responde.', proveedor, modelo, ms: Date.now() - inicio }
    }
  }

  // anthropic-api: una llamada de verdad, no models.retrieve (ver doctor.ts).
  const modelo = optionalEnv('SELECT_MODEL') ?? 'claude-opus-5-5'
  const clave = optionalEnv('ANTHROPIC_API_KEY')
  if (clave === undefined) {
    return { estado: 'error', mensaje: 'Falta la clave de la API de Anthropic.', proveedor, modelo, ms: 0 }
  }
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const cliente = new Anthropic({ apiKey: clave, maxRetries: 0, timeout: 30_000 })
    await cliente.messages.create({ model: modelo, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] })
    return { estado: 'lista', mensaje: 'La API responde.', proveedor, modelo, ms: Date.now() - inicio }
  } catch (e) {
    const status = (e as { status?: number }).status
    const estado: EstadoIA = status === 401 ? 'sin_sesion' : status === 429 ? 'limite' : 'error'
    const mensaje =
      status === 401 ? 'La clave de la API no vale.' :
      status === 429 ? 'La API está limitando peticiones.' :
      'La API no pudo responder.'
    return { estado, mensaje, proveedor, modelo, ms: Date.now() - inicio }
  }
}
