import type { Db } from '../store/db.js'
import type { QueueItem } from '../store/store.js'
import type { EstadoWorker } from './worker.js'

/**
 * El estado del worker, contra Postgres.
 *
 * Es lo que hace que el panel remoto vea lo que de verdad ha pasado. Antes el
 * worker escribia solo en los ficheros de state/ de este ordenador, y el panel
 * de Hostinger lee la base: seis clips entregados y la tarjeta de TikTok
 * diciendo "sin conectar", porque en `posts` no habia ni una fila.
 *
 * Escribe SOLO lo que cambia. El worker manda parches ("esta ya esta
 * publicada", "reintentala dentro de diez minutos"), y reescribir la fila
 * entera desde un objeto en memoria pisaria cualquier columna que hubiera
 * tocado otro proceso entre medias.
 */

/** Columna de la tabla para cada campo del parche. Lo que no este aqui, se ignora. */
const COLUMNA: Partial<Record<keyof QueueItem, string>> = {
  status: 'status',
  scheduledAt: 'scheduled_at',
  attemptCount: 'attempt_count',
  lastError: 'last_error',
  caption: 'caption',
  variantPath: 'variant_path',
  checksum: 'checksum',
}

function aItem(r: Record<string, unknown>): QueueItem {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    clipId: r.clip_id as string,
    accountId: r.account_id as string,
    variantPath: r.variant_path as string,
    checksum: r.checksum as string,
    params: r.params as QueueItem['params'],
    caption: r.caption as string,
    hashtags: (r.hashtags ?? []) as string[],
    scheduledAt: (r.scheduled_at as Date).toISOString(),
    status: r.status as QueueItem['status'],
    attemptCount: Number(r.attempt_count),
    lastError: (r.last_error as string | null) ?? null,
  }
}

export function crearEstadoPg(db: Db, ownerId: string): EstadoWorker {
  return {
    vencidos: async (now, tope) => {
      /*
       * El tope se interpola, no va como parametro, y por eso se sanea aqui.
       *
       * PostgreSQL no admite un parametro en LIMIT en todas las rutas del
       * driver, asi que este numero entra en el texto de la consulta. Es el
       * UNICO sitio del proyecto donde eso pasa: se fuerza a entero positivo
       * y, si no lo es, no se pone limite en vez de escribir "limit NaN" y
       * reventar la pasada entera.
       */
      const limite =
        tope !== undefined && Number.isFinite(tope) && tope >= 1
          ? ' limit ' + String(Math.floor(tope))
          : ''
      /*
       * Solo 'pending'. Un item en 'publishing' es uno que otra pasada dejo a
       * medias; recogerlo aqui lo subiria dos veces. De rescatarlos se encarga
       * `rescatarEncallados`, que ademas comprueba si llegaron a entregarse.
       *
       * Y solo de cuentas ACTIVAS. Una cuenta en pausa no debe recibir nada:
       * sus envios se quedan esperando por si vuelve. Sin esta condicion, al
       * pasar a upload-post con dos cuentas, los seis envios que quedaban de
       * acc-03 a acc-08 se habrian intentado contra perfiles que no existen
       * alli, fallando uno por uno y reintentando sin fin.
       */
      const filas = await db.query<Record<string, unknown>>(
        `select q.* from queue q
           join accounts a on a.owner_id = q.owner_id and a.id = q.account_id
          where q.owner_id = $1 and q.status = 'pending' and q.scheduled_at <= $2
            and a.status = 'active'
          order by q.scheduled_at
          ${limite}`,
        [ownerId, now.toISOString()],
      )
      return filas.map(aItem)
    },

    /*
     * Toma el envio solo si sigue pendiente. Ver EstadoWorker.tomar.
     *
     * El `and status = 'pending'` es toda la proteccion: dos pasadas
     * solapadas chocan sobre la misma fila, PostgreSQL las serializa y la
     * segunda recibe cero filas. Sin esto, las dos subirian el mismo video.
     */
    tomar: async (id) => {
      const filas = await db.query<{ id: string }>(
        `update queue set status = 'publishing', updated_at = now()
          where owner_id = $1 and id = $2 and status = 'pending'
          returning id`,
        [ownerId, id],
      )
      return filas.length > 0
    },

    rescatarEncallados: async (antesDe) => {
      /*
       * Primero los que SI se entregaron: estado perdido, no envio perdido.
       * Se reconocen porque dejaron su fila en `posts`.
       */
      const cerrados = await db.query<{ id: string }>(
        `update queue q set status = 'published', last_error = null
          where q.owner_id = $1 and q.status = 'publishing' and q.updated_at < $2
            and exists (select 1 from posts p
                         where p.owner_id = q.owner_id and p.queue_item_id = q.id)
          returning q.id`,
        [ownerId, antesDe.toISOString()],
      )

      // Y los que no llegaron a entregarse, de vuelta a la cola para ya.
      const reencolados = await db.query<{ id: string }>(
        `update queue q set status = 'pending', scheduled_at = now()
          where q.owner_id = $1 and q.status = 'publishing' and q.updated_at < $2
            and not exists (select 1 from posts p
                             where p.owner_id = q.owner_id and p.queue_item_id = q.id)
          returning q.id`,
        [ownerId, antesDe.toISOString()],
      )

      return { reencolados: reencolados.length, cerrados: cerrados.length }
    },

    publicacionesDesde: async (accountId, desde) => {
      const filas = await db.query<{ n: string }>(
        `select count(*) n from posts
          where owner_id = $1 and account_id = $2 and published_at >= $3`,
        [ownerId, accountId, desde.toISOString()],
      )
      return Number(filas[0]?.n ?? 0)
    },

    queue: async (id, patch) => {
      const sets: string[] = []
      const params: unknown[] = [ownerId, id]
      for (const [campo, valor] of Object.entries(patch)) {
        const col = COLUMNA[campo as keyof QueueItem]
        if (col === undefined) continue
        params.push(valor)
        sets.push(`${col} = $${params.length}`)
      }
      if (sets.length === 0) return
      // Siempre la marca de tiempo: es lo que permite saber cuanto lleva un
      // envio en 'publishing' y rescatarlo si se quedo a medias.
      sets.push('updated_at = now()')
      await db.query(`update queue set ${sets.join(', ')} where owner_id = $1 and id = $2`, params)
    },

    post: async (row) => {
      /*
       * ON CONFLICT DO NOTHING y no un insert a secas.
       *
       * Si el worker se reinicia tras subir pero antes de marcar la cola, el
       * siguiente paso reintentaria ese item y llegaria aqui con el mismo id.
       * Reventar por clave duplicada convertiria una repeticion inofensiva en
       * una pasada fallida.
       */
      await db.query(
        `insert into posts (id, owner_id, queue_item_id, source_id, clip_id, account_id,
                            external_id, provider, mode, published_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do nothing`,
        [
          row.id,
          ownerId,
          row.queueItemId,
          row.sourceId,
          row.clipId,
          row.accountId,
          row.externalId,
          row.provider,
          row.mode,
          row.publishedAt,
        ],
      )
    },

    published: async (accountId, at) => {
      await db.query(
        `update accounts set last_published_at = $3 where owner_id = $1 and id = $2`,
        [ownerId, accountId, at.toISOString()],
      )
    },

    resultado: async (accountId, ok, error) => {
      // Sin la migracion 024 la columna no existe: no es motivo para parar
      // una pasada de publicacion.
      try {
        await db.query(
          `update accounts set ultimo_resultado = $3, ultimo_resultado_en = now(), ultimo_error = $4
            where owner_id = $1 and id = $2`,
          [ownerId, accountId, ok ? 'ok' : 'error', ok ? null : (error ?? '').slice(0, 500)],
        )
      } catch {
        // nada
      }
    },

    accountStatus: async (accountId, status, token) => {
      // El estado del token solo se toca si viene: la mayoria de las pausas son
      // por otra cosa y poner 'unknown' borraria un 'ok' que era correcto.
      if (token === undefined) {
        await db.query(`update accounts set status = $3 where owner_id = $1 and id = $2`, [
          ownerId,
          accountId,
          status,
        ])
        return
      }
      await db.query(
        `update accounts set status = $3, token_status = $4 where owner_id = $1 and id = $2`,
        [ownerId, accountId, status, token],
      )
    },
  }
}
