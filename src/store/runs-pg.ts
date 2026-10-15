import type { Db } from './db.js'
import type { Run, RunSummary } from './runs.js'

/**
 * El diario de pasadas, contra Postgres.
 *
 * Responde a "cuanto llevo gastado". Antes vivia en un JSON que se leia entero
 * en cada escritura; con el panel en un servidor y el trabajo en otro
 * ordenador, quien escribe el diario y quien lo lee ya no son el mismo proceso.
 *
 * LA SUMA LA HACE LA BASE, no este codigo. El diario crece sin parar y traer
 * quinientas filas por la red para sumar siete numeros seria pagar el tamaño
 * del historial en cada carga del panel.
 */

function aRun(r: Record<string, unknown>): Run {
  const entrada = Number(r.input_tokens ?? 0)
  const salida = Number(r.output_tokens ?? 0)

  return {
    id: r.id as string,
    kind: r.kind as string,
    sourceId: (r.source_id ?? null) as string | null,
    label: r.label as string,
    startedAt: new Date(r.started_at as string).toISOString(),
    endedAt: r.ended_at === null ? '' : new Date(r.ended_at as string).toISOString(),
    durationMs: Number(r.duration_ms ?? 0),
    status: r.status as 'ok' | 'error',
    input: (r.input ?? {}) as Record<string, number | string>,
    output: (r.output ?? {}) as Record<string, number | string>,
    // null y no un par de ceros: el panel distingue "no llamo al modelo" de
    // "llamo y gasto cero", y con ceros diria "0 / 0 tokens" en cada render.
    tokens: entrada === 0 && salida === 0 ? null : { inputTokens: entrada, outputTokens: salida },
    costUsd: Number(r.cost_usd ?? 0),
    error: (r.error ?? null) as string | null,
  }
}

export function createRunsStore(db: Db, ownerId: string) {
  return {
    async recientes(limite = 60): Promise<Run[]> {
      const filas = await db.query(
        `select * from runs where owner_id = $1 order by started_at desc limit $2`,
        [ownerId, limite],
      )
      return filas.map((f) => aRun(f as Record<string, unknown>))
    },

    /**
     * Los totales, sumados por la base.
     *
     * Dos consultas y no una: el total general y el desglose por comando tienen
     * granularidad distinta, y sacarlos juntos obligaria a sumar el desglose en
     * este lado, que es justo lo que se queria evitar.
     */
    async resumen(): Promise<RunSummary> {
      const [total] = await db.query(
        `select count(*)::int as count,
                coalesce(sum(cost_usd), 0) as cost,
                coalesce(sum(duration_ms), 0)::bigint as ms,
                coalesce(sum(input_tokens), 0)::bigint as entrada,
                coalesce(sum(output_tokens), 0)::bigint as salida
         from runs where owner_id = $1`,
        [ownerId],
      )

      const porTipo = await db.query(
        `select kind,
                count(*)::int as count,
                coalesce(sum(cost_usd), 0) as cost,
                coalesce(sum(duration_ms), 0)::bigint as ms
         from runs where owner_id = $1
         group by kind`,
        [ownerId],
      )

      const byKind: RunSummary['byKind'] = {}
      for (const r of porTipo) {
        byKind[r.kind as string] = {
          count: Number(r.count),
          costUsd: Number(r.cost),
          durationMs: Number(r.ms),
        }
      }

      const t = (total ?? {}) as Record<string, unknown>
      return {
        count: Number(t.count ?? 0),
        costUsd: Number(t.cost ?? 0),
        durationMs: Number(t.ms ?? 0),
        inputTokens: Number(t.entrada ?? 0),
        outputTokens: Number(t.salida ?? 0),
        byKind,
      }
    },

    /**
     * Anota una pasada terminada.
     *
     * OJO CON EL `::text::jsonb`. Sin el, el cliente de Postgres trata la cadena
     * como un valor JSON y la vuelve a codificar: en la columna acaba la cadena
     * `"{\"clips\":15}"` en lugar del objeto `{"clips": 15}`. El panel entonces
     * hace Object.keys() sobre un texto y pinta las posiciones de sus letras.
     *
     * Paso desapercibido porque PGlite, donde se prueba, SI acepta la cadena y
     * la convierte en objeto. Las dos no se comportan igual aqui, y solo la
     * version con la conversion explicita funciona en ambas.
     */
    async anotar(run: Run): Promise<void> {
      await db.query(
        `insert into runs (id, owner_id, kind, source_id, label, started_at, ended_at,
                           duration_ms, status, input, output, input_tokens, output_tokens,
                           cost_usd, error)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb,$11::text::jsonb,$12,$13,$14,$15)
         on conflict (id) do nothing`,
        [
          run.id, ownerId, run.kind, run.sourceId, run.label, run.startedAt,
          run.endedAt === '' ? null : run.endedAt, run.durationMs, run.status,
          JSON.stringify(run.input), JSON.stringify(run.output),
          run.tokens?.inputTokens ?? 0, run.tokens?.outputTokens ?? 0,
          run.costUsd, run.error,
        ],
      )
    },
  }
}

export type RunsStore = ReturnType<typeof createRunsStore>
