import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/v4'
import { paths } from '../lib/env.js'
import { createLogger } from '../lib/logger.js'
import type { SelectionProvider, SelectionResult } from '../select/provider.js'
import type { ClipCandidate } from '../select/schema.js'
import { ErrorIA, mensajeIA } from './errores.js'
import {
  extraerJson,
  instruccionesFormato,
  momentosSchema,
  resumirErrores,
  VERSION_ESQUEMA,
  type Momento,
} from './esquema.js'
import type { ProveedorLlm } from './provider.js'

const log = createLogger('ia')

/**
 * Reintentos que puede gastar UNA tarea, sumando todos sus bloques.
 *
 * Hoy "Elegir momentos" llego a correr 28 veces sobre el mismo video. El tope
 * es por tarea y no por llamada: un JSON mal formado gasta uno, un tiempo
 * agotado otro, y a partir de ahi se falla limpio.
 */
export const REINTENTOS_POR_TAREA = 2

/** Lo que el panel y las variantes necesitan, ademas del candidato clasico. */
export interface CandidatoIA extends ClipCandidate {
  titulo: string
  puntajes: { gancho: number; cierre: number; retencion: number; total: number }
}

function aCandidato(m: Momento): CandidatoIA {
  return {
    startLine: m.inicio,
    endLine: m.fin,
    hook: m.gancho,
    reason: m.motivo,
    caption: m.descripcion,
    hashtags: m.hashtags,
    score: m.puntaje_total,
    titulo: m.titulo,
    puntajes: {
      gancho: m.puntaje_gancho,
      cierre: m.puntaje_cierre,
      retencion: m.puntaje_retencion,
      total: m.puntaje_total,
    },
  }
}

/**
 * Los nombres de campo del formato JSON no son los que usa el prompt de
 * sistema, que se escribio para la salida estructurada de la API. Esta linea
 * los empareja para que el prompt se pueda compartir sin duplicarlo.
 */
const EQUIVALENCIAS =
  'En este formato los campos se llaman distinto que arriba: startLine es "inicio", ' +
  'endLine es "fin", hook es "gancho", caption es "descripcion", reason es "motivo" y ' +
  'score es "puntaje_total". inicio y fin son NUMEROS DE LINEA, no segundos.'

// --- Cache ---------------------------------------------------------------------

function claveCache(modelo: string, sistema: string, usuario: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: VERSION_ESQUEMA, modelo, sistema, usuario }))
    .digest('hex')
    .slice(0, 32)
}

function rutaCache(clave: string): string {
  return join(paths.work, 'ia-cache', `${clave}.json`)
}

function leerCache(clave: string): Momento[] | null {
  const ruta = rutaCache(clave)
  if (!existsSync(ruta)) return null
  try {
    const crudo = JSON.parse(readFileSync(ruta, 'utf8')) as { momentos?: unknown }
    const r = z.object({ momentos: z.array(z.unknown()) }).safeParse(crudo)
    return r.success ? (crudo as { momentos: Momento[] }).momentos : null
  } catch {
    return null
  }
}

function escribirCache(clave: string, momentos: Momento[], modelo: string): void {
  const ruta = rutaCache(clave)
  mkdirSync(join(paths.work, 'ia-cache'), { recursive: true })
  writeFileSync(ruta, JSON.stringify({ creado: new Date().toISOString(), modelo, momentos }, null, 2))
}

// --- Proveedor de seleccion ----------------------------------------------------

/**
 * Adapta un proveedor de texto (hoy, Claude Code) al contrato de seleccion.
 *
 * El prompt, las ventanas, la comprobacion contra la transcripcion y la
 * deduplicacion siguen siendo los de src/select: aqui solo se pide JSON, se
 * valida con zod y se traduce al candidato de siempre.
 */
export class LlmSelectionProvider implements SelectionProvider {
  readonly name: string
  readonly model: string
  readonly incluidoEnSuscripcion: boolean
  /** Llamadas que llegaron de verdad a la IA (sin contar la cache). */
  llamadas = 0
  desdeCache = 0
  msTotales = 0

  constructor(
    private readonly llm: ProveedorLlm,
    private reintentos = REINTENTOS_POR_TAREA,
  ) {
    this.name = llm.nombre
    this.model = llm.modelo
    this.incluidoEnSuscripcion = llm.incluidoEnSuscripcion
  }

  private gastarReintento(): boolean {
    if (this.reintentos <= 0) return false
    this.reintentos -= 1
    return true
  }

  /** Una llamada, reintentando solo lo que puede ir mejor y con presupuesto. */
  private async completar(sistema: string, usuario: string): Promise<string> {
    for (;;) {
      try {
        this.llamadas += 1
        const r = await this.llm.completar(sistema, usuario)
        this.msTotales += r.ms
        return r.texto
      } catch (e) {
        // Sin sesion, limite o sin CLI: reintentar daria lo mismo.
        if (e instanceof ErrorIA && e.pausaLaCola) throw e
        if (!this.gastarReintento()) throw e
        log.warn(`La IA fallo (${e instanceof Error ? e.message : String(e)}). Se reintenta una vez.`)
      }
    }
  }

  async select(systemPrompt: string, userPrompt: string, maxClips: number): Promise<SelectionResult> {
    const esquema = momentosSchema(Math.max(1, maxClips))
    const usuario = `${userPrompt}\n${instruccionesFormato(maxClips)}\n\n${EQUIVALENCIAS}`

    const clave = claveCache(this.model, systemPrompt, usuario)
    const guardado = leerCache(clave)
    if (guardado !== null) {
      this.desdeCache += 1
      log.info(`Bloque ya consultado antes: ${guardado.length} momento(s) desde la cache.`)
      return { clips: guardado.map(aCandidato), inputTokens: 0, outputTokens: 0 }
    }

    let texto = await this.completar(systemPrompt, usuario)

    // Un solo reintento por respuesta ilegible, y diciendole a la IA que fallo.
    for (let intento = 0; ; intento += 1) {
      let error: string
      try {
        const r = esquema.safeParse(extraerJson(texto))
        if (r.success) {
          escribirCache(clave, r.data.momentos, this.model)
          return { clips: r.data.momentos.map(aCandidato), inputTokens: 0, outputTokens: 0 }
        }
        error = resumirErrores(r.error)
      } catch (e) {
        error = `- ${e instanceof Error ? e.message : String(e)}`
      }

      if (intento >= 1 || !this.gastarReintento()) {
        throw new ErrorIA('respuesta_invalida', mensajeIA('respuesta_invalida'), undefined, error)
      }
      log.warn(`La respuesta no cumple el formato. Se pide corregida una vez:\n${error}`)
      texto = await this.completar(
        systemPrompt,
        `${usuario}\n\nTu respuesta anterior no era valida por esto:\n${error}\n\n` +
          `Respuesta anterior:\n${texto.slice(0, 20_000)}\n\n` +
          'Devuelve el JSON corregido completo, solo el JSON.',
      )
    }
  }
}
