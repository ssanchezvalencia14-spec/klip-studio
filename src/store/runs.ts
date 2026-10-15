import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fromRoot } from '../lib/env.js'
import { ensureDir, readJson, writeJson } from '../lib/fsx.js'
import { existsSync } from 'node:fs'

/**
 * Registro de pasadas: que entro, que salio, cuanto tardo y cuanto costo.
 *
 * Hasta ahora estos numeros se imprimian por pantalla y se perdian. La Fase 2
 * consumio 91.578 tokens de entrada, produjo 32 clips y costo 1,51 dolares en
 * 8 min 42 s, y ese dato solo existia en un fichero temporal que se borro al
 * reiniciar la sesion. Sin esto no hay forma de responder a "cuanto llevo
 * gastado" ni de comparar dos configuraciones.
 *
 * Es un diario, no un estado: las entradas no se modifican una vez escritas.
 */

const STATE_DIR = fromRoot(process.env['STATE_DIR'] ?? 'state')
const FILE = join(STATE_DIR, 'runs.json')

/**
 * Pasadas que se conservan.
 *
 * A una docena de pasadas al dia, 500 son mas de un mes de historia. El fichero
 * se lee entero en cada escritura, asi que dejarlo crecer sin limite acabaria
 * costando mas que la propia pasada.
 */
const MAX_RUNS = 500

export interface RunTotals {
  /** Tokens de entrada y salida. Solo los pasos que llaman al modelo. */
  inputTokens: number
  outputTokens: number
}

export interface Run {
  id: string
  /** Comando que se ejecuto: ingest, select, render... */
  kind: string
  sourceId: string | null
  label: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: 'ok' | 'error'
  /** Que consumio, en pares legibles: { segmentos: 3027, ventanas: 7 }. */
  input: Record<string, number | string>
  /** Que produjo: { clips: 32, archivos: 37, MB: 3500 }. */
  output: Record<string, number | string>
  tokens: RunTotals | null
  costUsd: number
  /** Mensaje corto cuando algo fallo. */
  error: string | null
}

function load(): Run[] {
  if (!existsSync(FILE)) return []
  try {
    return readJson<Run[]>(FILE)
  } catch {
    // Un diario corrupto no debe impedir que el programa siga trabajando.
    return []
  }
}

export const runs = {
  all: (): Run[] => load(),

  /** De la mas reciente a la mas antigua. */
  recent: (limit = 50): Run[] =>
    [...load()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit),

  add: (run: Run): void => {
    ensureDir(STATE_DIR)
    const rows = load()
    rows.push(run)
    // Se recorta por fecha y no por posicion: dos procesos escribiendo a la vez
    // podrian dejar el array desordenado.
    const kept = rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).slice(-MAX_RUNS)
    writeJson(FILE, kept)
  },
}

export interface RunSummary {
  count: number
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  byKind: Record<string, { count: number; costUsd: number; durationMs: number }>
}

/** Suma el diario entero. Es la respuesta a "cuanto llevo gastado". */
export function summarizeRuns(rows: Run[] = load()): RunSummary {
  const out: RunSummary = {
    count: rows.length,
    costUsd: 0,
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    byKind: {},
  }

  for (const run of rows) {
    out.costUsd += run.costUsd
    out.durationMs += run.durationMs
    out.inputTokens += run.tokens?.inputTokens ?? 0
    out.outputTokens += run.tokens?.outputTokens ?? 0

    const k = (out.byKind[run.kind] ??= { count: 0, costUsd: 0, durationMs: 0 })
    k.count += 1
    k.costUsd += run.costUsd
    k.durationMs += run.durationMs
  }

  return out
}

export interface RunHandle {
  /** Cierra la pasada y la escribe. Llamar una sola vez. */
  finish(data: {
    input?: Record<string, number | string>
    output?: Record<string, number | string>
    tokens?: RunTotals | null
    costUsd?: number
  }): void
  /** Cierra la pasada como fallida. */
  fail(error: unknown): void
}

/**
 * Abre una pasada y devuelve el asa para cerrarla.
 *
 * El reloj arranca aqui, asi que la duracion incluye todo el trabajo real y no
 * solo el ultimo tramo. Si el proceso muere de golpe la entrada no llega a
 * escribirse: es preferible perder el registro a guardar una pasada con datos
 * inventados sobre lo que produjo.
 */
export function beginRun(kind: string, sourceId: string | null, label: string): RunHandle {
  const startedAt = new Date()
  let cerrada = false

  const escribir = (
    status: 'ok' | 'error',
    input: Record<string, number | string>,
    output: Record<string, number | string>,
    tokens: RunTotals | null,
    costUsd: number,
    error: string | null,
  ): void => {
    if (cerrada) return
    cerrada = true

    const endedAt = new Date()
    runs.add({
      id: randomUUID().slice(0, 8),
      kind,
      sourceId,
      label,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      status,
      input,
      output,
      tokens,
      costUsd,
      error,
    })
  }

  return {
    finish: (data) =>
      escribir('ok', data.input ?? {}, data.output ?? {}, data.tokens ?? null, data.costUsd ?? 0, null),
    fail: (error) =>
      escribir('error', {}, {}, null, 0, error instanceof Error ? error.message : String(error)),
  }
}
