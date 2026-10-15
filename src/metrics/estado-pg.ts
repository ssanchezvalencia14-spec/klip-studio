import type { Db } from '../store/db.js'
import { createStore } from '../store/pg.js'
import type { MetricSnapshot } from '../store/store.js'
import type { EstadoMetricas } from './collect.js'

/**
 * El estado del recolector de metricas, contra Postgres.
 *
 * Mismo motivo que en el worker de publicacion: el panel lee la base y los
 * ficheros de state/ solo existen en este ordenador. Un recolector que escriba
 * en ficheros deja la seccion Resultados vacia para siempre, por muchas
 * lecturas que tome.
 */
export function crearMetricasPg(db: Db, ownerId: string): EstadoMetricas {
  const store = createStore(db, ownerId)

  return {
    publicaciones: () => store.posts.all(),

    /*
     * Se consulta por publicacion y no se trae la tabla entera.
     *
     * Con una lectura por corte de edad y cientos de publicaciones, `metrics`
     * crece rapido; cargarla completa para comprobar un unico post seria pedir
     * miles de filas por cada una.
     */
    lecturasDe: async (postId) => {
      const filas = await db.query<Record<string, unknown>>(
        `select * from metrics where owner_id = $1 and post_id = $2 order by age_hours`,
        [ownerId, postId],
      )
      return filas.map(
        (r): MetricSnapshot => ({
          id: r.id as string,
          postId: r.post_id as string,
          externalId: r.external_id as string,
          accountId: r.account_id as string,
          clipId: r.clip_id as string,
          capturedAt: (r.captured_at as Date).toISOString(),
          ageHours: Number(r.age_hours),
          views: Number(r.views),
          likes: Number(r.likes),
          comments: Number(r.comments),
          shares: Number(r.shares),
          averageWatchSec:
            r.average_watch_sec === null ? null : Number(r.average_watch_sec),
        }),
      )
    },

    guardar: async (filas) => {
      if (filas.length === 0) return
      await store.metrics.save(filas)
    },
  }
}
