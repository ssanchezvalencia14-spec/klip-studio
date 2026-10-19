import { proveedorActivo, type Proveedor } from '../publish/proveedor.js'
import type { Db } from './db.js'
import type {
  Account,
  AccountStatus,
  ClipRecord,
  ClipStatus,
  MetricSnapshot,
  Post,
  QueueItem,
  SegmentoClip,
} from './store.js'

/**
 * El almacen, contra Postgres.
 *
 * Sustituye a los ficheros JSON de state/. Aquellos funcionaban con un unico
 * proceso: el panel leia, escribia y nadie mas tocaba nada. En cuanto el panel
 * vive en un servidor y el trabajo pesado en otra maquina, dos procesos
 * escriben a la vez y un fichero JSON se pisa en silencio.
 *
 * TODO PASA POR owner_id. No hay ninguna consulta sin el, ni siquiera ahora que
 * hay un solo propietario. Es lo que evita que el dia que entren clientes haya
 * que revisar cada consulta preguntandose si filtra bien.
 *
 * Todo es asincrono, a diferencia del almacen de ficheros. No hay forma de
 * evitarlo: una consulta a la red no puede devolverse de inmediato. Es el
 * precio de que el estado deje de vivir en un solo ordenador.
 */

/**
 * Un video de origen, tal y como lo ve el panel.
 *
 * Antes esta lista se sacaba leyendo el directorio de trabajo. Eso funcionaba
 * con todo en el mismo ordenador; en un servidor sin esos ficheros, la unica
 * fuente es la base de datos.
 */
export interface SourceRow {
  sourceId: string
  title: string
  durationMin: number | null
  hasTranscript: boolean
  clips: number
  rendered: number
  /** Clips aprobados: los unicos de los que se pueden sacar variantes. */
  approved: number
  /** Descartados. Con approved distingue "sin revisar" de "revisado y no vale". */
  rejected: number
  variants: number
  updatedAt: string
  /** 'entrevista', 'stream' o 'musica' (Fase 6). */
  tipo?: string
  /** Confianza 0..1 en la letra de un video musical; null si no se midio. */
  confianzaLetra?: number | null
}

export interface Store {
  accounts: {
    all(): Promise<Account[]>
    active(): Promise<Account[]>
    /**
     * Las que de verdad pueden publicar, SEGUN POR DONDE SE PUBLIQUE.
     *
     * No es lo mismo que `active`. Una cuenta se crea activa desde el primer
     * dia, pero eso no basta para subir nada en su nombre, y lo que falta
     * depende del camino:
     *
     *   tiktok       que su titular haya autorizado nuestra app. Repartir sobre
     *                las activas llenaba la cola de publicaciones condenadas a
     *                fallar una por una con "no ha autorizado TikTok todavia", y
     *                generaba variantes para cuentas que no iban a usarlas:
     *                medido el 2026-09-30, veinte por clip en vez de ocho.
     *   upload-post  que exista un perfil con ese mismo nombre dado de alta
     *                alli. El token de TikTok no pinta nada, porque quien tiene
     *                la sesion de la cuenta es upload-post. Exigirlo dejaba
     *                fuera cuentas perfectamente utilizables.
     *
     * Sin argumento se usa el proveedor configurado.
     */
    publicables(proveedor?: Proveedor): Promise<Account[]>
    /**
     * Pausa o reactiva una cuenta.
     *
     * Metodo propio y no `save`, que reescribe la fila entera: quien pausa desde
     * el panel no tiene delante los horarios ni el estado del token, y mandarlos
     * de vuelta tal y como los pinto la pantalla arriesga pisar un cambio hecho
     * mientras tanto.
     */
    setStatus(id: string, status: Account['status']): Promise<boolean>
    save(rows: Account[]): Promise<void>
  }
  clips: {
    all(): Promise<ClipRecord[]>
    byStatus(status: ClipStatus): Promise<ClipRecord[]>
    find(sourceId: string, clipId: string): Promise<ClipRecord | undefined>
    save(rows: ClipRecord[]): Promise<void>
    setStatus(
      sourceId: string,
      clipId: string,
      status: ClipStatus,
      patch?: { caption?: string; hashtags?: string[] },
    ): Promise<ClipRecord | undefined>
    editar(
      sourceId: string,
      clipId: string,
      cambios: { titulo?: string; subtitulos?: SegmentoClip[] | null },
    ): Promise<ClipRecord | undefined>
    marcarCopia(
      sourceId: string,
      clipId: string,
      proxyPath: string,
      proxyBytes: number,
    ): Promise<void>
  }
  queue: {
    all(): Promise<QueueItem[]>
    add(items: QueueItem[]): Promise<number>
    save(rows: QueueItem[]): Promise<void>
  }
  sources: {
    all(): Promise<SourceRow[]>
    upsert(row: SourceRow): Promise<void>
    contarVariantes(): Promise<Record<string, number>>
    marcarVariantes(sourceId: string, n: number): Promise<void>
  }
  posts: { all(): Promise<Post[]>; save(rows: Post[]): Promise<void> }
  metrics: { all(): Promise<MetricSnapshot[]>; save(rows: MetricSnapshot[]): Promise<void> }
}

/** Convierte una fila de Postgres en el objeto que espera el resto del programa. */
function aClip(r: Record<string, unknown>): ClipRecord {
  return {
    sourceId: r.source_id as string,
    clipId: r.clip_id as string,
    start: Number(r.start_sec),
    end: Number(r.end_sec),
    hook: r.hook as string,
    reason: r.reason as string,
    caption: r.caption as string,
    hashtags: (r.hashtags ?? []) as string[],
    score: Number(r.score),
    status: r.status as ClipStatus,
    masterPath: r.master_path as string,
    // Una fila leida antes de aplicar la migracion 006 no trae estas columnas.
    // Se cae a "sin copia", que es exactamente la verdad en ese momento.
    proxyPath: (r.proxy_path as string | undefined) ?? '',
    proxyBytes: Number(r.proxy_bytes ?? 0),
    reviewedAt: r.reviewed_at === null ? null : new Date(r.reviewed_at as string).toISOString(),
    titulo: (r.titulo as string | undefined) ?? '',
    puntajes:
      r.puntaje_gancho === null || r.puntaje_gancho === undefined
        ? null
        : {
            gancho: Number(r.puntaje_gancho),
            cierre: Number(r.puntaje_cierre ?? 0),
            retencion: Number(r.puntaje_retencion ?? 0),
          },
    segmentos: leerSegmentos(r.segmentos) ?? [],
    subtitulos: leerSegmentos(r.subtitulos),
  }
}

/** jsonb llega como objeto con postgres y como texto en algunos drivers. */
function leerSegmentos(v: unknown): { start: number; end: number; text: string }[] | null {
  if (v === null || v === undefined) return null
  const lista = typeof v === 'string' ? (JSON.parse(v) as unknown) : v
  if (!Array.isArray(lista)) return null
  return lista
    .filter((x): x is { start: unknown; end: unknown; text: unknown } => typeof x === 'object' && x !== null)
    .map((x) => ({ start: Number(x.start), end: Number(x.end), text: String(x.text ?? '') }))
}

function aCuenta(r: Record<string, unknown>): Account {
  return {
    id: r.id as string,
    label: r.label as string,
    status: r.status as AccountStatus,
    slots: ((r.slots ?? []) as unknown[]).map(Number),
    tokenStatus: r.token_status as Account['tokenStatus'],
    lastPublishedAt:
      r.last_published_at === null
        ? null
        : new Date(r.last_published_at as string).toISOString(),
  }
}

function aEnvio(r: Record<string, unknown>): QueueItem {
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
    scheduledAt: new Date(r.scheduled_at as string).toISOString(),
    status: r.status as QueueItem['status'],
    attemptCount: Number(r.attempt_count ?? 0),
    lastError: (r.last_error ?? null) as string | null,
  }
}

export function createStore(db: Db, ownerId: string): Store {
  return {
    accounts: {
      all: async () =>
        (await db.query(`select * from accounts where owner_id = $1 order by id`, [ownerId])).map(
          aCuenta,
        ),

      active: async () =>
        (
          await db.query(
            `select * from accounts where owner_id = $1 and status = 'active' order by id`,
            [ownerId],
          )
        ).map(aCuenta),

      publicables: async (proveedor) => {
        /*
         * Con upload-post no se puede comprobar nada mas que estar activa.
         *
         * Saber si existe el perfil al otro lado exigiria preguntarselo a
         * upload-post en cada reparto. No se hace: el reparto se ejecuta sobre
         * cientos de clips y eso serian cientos de llamadas para una respuesta
         * que casi nunca cambia. Si el perfil no existe, la publicacion falla y
         * el error lo dice con el nombre delante, que es informacion suficiente.
         *
         * La consecuencia practica: con upload-post hay que DESACTIVAR las
         * cuentas que no tengan perfil alli, o el reparto las incluira.
         */
        if ((proveedor ?? proveedorActivo()) === 'upload-post') {
          return (
            await db.query(
              `select * from accounts where owner_id = $1 and status = 'active' order by id`,
              [ownerId],
            )
          ).map(aCuenta)
        }
        return (
          await db.query(
            `select a.* from accounts a
               join tiktok_tokens t
                 on t.owner_id = a.owner_id and t.account_id = a.id
              where a.owner_id = $1 and a.status = 'active'
              order by a.id`,
            [ownerId],
          )
        ).map(aCuenta)
      },

      setStatus: async (id, status) => {
        const filas = await db.query(
          `update accounts set status = $3 where owner_id = $1 and id = $2 returning id`,
          [ownerId, id, status],
        )
        return filas.length > 0
      },

      save: async (rows) => {
        // Una sola sentencia con todas las filas, no una por cuenta. Con veinte
        // cuentas eso es una ida y vuelta en vez de veinte, y sobre una base
        // remota la diferencia se nota.
        if (rows.length === 0) return
        const valores = rows
          .map(
            (_, i) =>
              `($1, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6}, $${i * 6 + 7})`,
          )
          .join(', ')
        const params: unknown[] = [ownerId]
        for (const a of rows) {
          params.push(a.id, a.label, a.status, a.slots, a.tokenStatus, a.lastPublishedAt)
        }
        await db.query(
          `insert into accounts (owner_id, id, label, status, slots, token_status, last_published_at)
           values ${valores}
           on conflict (owner_id, id) do update set
             label = excluded.label,
             status = excluded.status,
             slots = excluded.slots,
             token_status = excluded.token_status,
             last_published_at = excluded.last_published_at`,
          params,
        )
      },
    },

    clips: {
      all: async () =>
        (
          await db.query(`select * from clips where owner_id = $1 order by score desc`, [ownerId])
        ).map(aClip),

      byStatus: async (status) =>
        (
          await db.query(
            `select * from clips where owner_id = $1 and status = $2 order by score desc`,
            [ownerId, status],
          )
        ).map(aClip),

      find: async (sourceId, clipId) => {
        const rows = await db.query(
          `select * from clips where owner_id = $1 and source_id = $2 and clip_id = $3`,
          [ownerId, sourceId, clipId],
        )
        return rows[0] === undefined ? undefined : aClip(rows[0])
      },

      save: async (rows) => {
        if (rows.length === 0) return
        for (const c of rows) {
          await db.query(
            `insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, hook, reason,
                                caption, hashtags, score, status, master_path, reviewed_at,
                                proxy_path, proxy_bytes, titulo, puntaje_gancho, puntaje_cierre,
                                puntaje_retencion, segmentos)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
             on conflict (owner_id, source_id, clip_id) do update set
               start_sec = excluded.start_sec, end_sec = excluded.end_sec,
               hook = excluded.hook, reason = excluded.reason,
               caption = excluded.caption, hashtags = excluded.hashtags,
               score = excluded.score, status = excluded.status,
               master_path = excluded.master_path, reviewed_at = excluded.reviewed_at,
               proxy_path = excluded.proxy_path, proxy_bytes = excluded.proxy_bytes,
               titulo = excluded.titulo,
               puntaje_gancho = excluded.puntaje_gancho, puntaje_cierre = excluded.puntaje_cierre,
               puntaje_retencion = excluded.puntaje_retencion,
               segmentos = excluded.segmentos`,
            [
              ownerId, c.sourceId, c.clipId, c.start, c.end, c.hook, c.reason,
              c.caption, c.hashtags, c.score, c.status, c.masterPath, c.reviewedAt,
              c.proxyPath, c.proxyBytes, c.titulo ?? '',
              c.puntajes?.gancho ?? null, c.puntajes?.cierre ?? null, c.puntajes?.retencion ?? null,
              JSON.stringify(c.segmentos ?? []),
            ],
          )
        }
      },

      setStatus: async (sourceId, clipId, status, patch = {}) => {
        /*
         * Una sola sentencia, no leer-modificar-escribir.
         *
         * Con el panel abierto en el movil y en el portatil a la vez, leer,
         * cambiar en memoria y volver a escribir hace que la segunda pestaña
         * pise lo que decidio la primera. Aqui la base resuelve el orden.
         *
         * coalesce deja intactos los campos que no vienen en el parche.
         */
        const rows = await db.query(
          `update clips set
             status = $4,
             caption = coalesce($5, caption),
             hashtags = coalesce($6, hashtags),
             reviewed_at = now()
           where owner_id = $1 and source_id = $2 and clip_id = $3
           returning *`,
          [ownerId, sourceId, clipId, status, patch.caption ?? null, patch.hashtags ?? null],
        )
        return rows[0] === undefined ? undefined : aClip(rows[0])
      },

      /*
       * Anota que un clip ya tiene copia en la nube.
       *
       * Sentencia propia y no `save`, por la misma razon que setStatus: el
       * subidor corre en el PC mientras alguien puede estar revisando desde el
       * movil. `save` reescribe la fila entera, asi que una subida que
       * terminara justo despues de una aprobacion devolveria el clip a
       * pendiente con los datos que el subidor leyo al empezar.
       *
       * Aqui solo se tocan las dos columnas de la copia; lo demas no se mira.
       */
      /*
       * Lo que se edita desde Revisar (Fase 6): titulo y subtitulos.
       *
       * Sentencia propia, como setStatus: solo toca lo que viene. Los
       * subtitulos se guardan aparte de los segmentos de la transcripcion, asi
       * que "deshacer" es poner null y volver a los originales.
       */
      editar: async (sourceId, clipId, cambios) => {
        const rows = await db.query(
          `update clips set
             titulo = coalesce($4, titulo),
             subtitulos = case when $5::boolean then $6::jsonb else subtitulos end
           where owner_id = $1 and source_id = $2 and clip_id = $3
           returning *`,
          [
            ownerId, sourceId, clipId, cambios.titulo ?? null,
            cambios.subtitulos !== undefined,
            cambios.subtitulos === undefined || cambios.subtitulos === null ? null : JSON.stringify(cambios.subtitulos),
          ],
        )
        return rows[0] === undefined ? undefined : aClip(rows[0])
      },

      marcarCopia: async (sourceId, clipId, proxyPath, proxyBytes) => {
        await db.query(
          `update clips set proxy_path = $4, proxy_bytes = $5
           where owner_id = $1 and source_id = $2 and clip_id = $3`,
          [ownerId, sourceId, clipId, proxyPath, proxyBytes],
        )
      },
    },

    queue: {
      all: async () =>
        (
          await db.query(`select * from queue where owner_id = $1 order by scheduled_at`, [ownerId])
        ).map(aEnvio),

      add: async (items) => {
        let añadidos = 0
        for (const q of items) {
          // `do nothing` y no `do update`: reprogramar no debe reescribir lo que
          // ya estaba, y el indice unico de checksum por cuenta es justo lo que
          // impide subir dos veces el mismo archivo.
          const filas = await db.query(
            `insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path,
                                checksum, params, caption, hashtags, scheduled_at, status,
                                attempt_count, last_error)
             values ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9,$10,$11,$12,$13,$14)
             on conflict do nothing
             returning id`,
            [
              q.id, ownerId, q.sourceId, q.clipId, q.accountId, q.variantPath,
              q.checksum, JSON.stringify(q.params), q.caption, q.hashtags,
              q.scheduledAt, q.status, q.attemptCount, q.lastError,
            ],
          )
          if (filas.length > 0) añadidos += 1
        }
        return añadidos
      },

      save: async (rows) => {
        await db.query(`delete from queue where owner_id = $1`, [ownerId])
        for (const q of rows) {
          await db.query(
            `insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path,
                                checksum, params, caption, hashtags, scheduled_at, status,
                                attempt_count, last_error)
             values ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9,$10,$11,$12,$13,$14)`,
            [
              q.id, ownerId, q.sourceId, q.clipId, q.accountId, q.variantPath,
              q.checksum, JSON.stringify(q.params), q.caption, q.hashtags,
              q.scheduledAt, q.status, q.attemptCount, q.lastError,
            ],
          )
        }
      },
    },

    sources: {
      /*
       * La lista de videos, con sus cifras ya contadas por la base.
       *
       * Los momentos y los renderizados salen de la tabla de clips en la misma
       * consulta, no en tres viajes distintos. Sobre una base remota cada ida y
       * vuelta cuesta, y esta lista se pide en cada carga del panel.
       */
      all: async () => {
        const filas = await db.query(
          `select s.id, s.title, s.duration_sec, s.has_transcript, s.variants_count,
                  s.updated_at, s.tipo, s.confianza_letra,
                  count(c.clip_id)::int as clips,
                  count(c.clip_id) filter (where c.master_path <> '')::int as rendered,
                  -- Cuantos pasaron la compuerta. Es lo unico que puede generar
                  -- variantes, y sin este dato el panel ofrecia el boton de
                  -- 'copia por cuenta' en VOD con los quince clips descartados.
                  count(c.clip_id) filter (where c.status = 'approved')::int as approved,
                  count(c.clip_id) filter (where c.status = 'rejected')::int as rejected
           from sources s
           left join clips c on c.source_id = s.id and c.owner_id = s.owner_id
           where s.owner_id = $1
           group by s.id, s.title, s.duration_sec, s.has_transcript,
                    s.variants_count, s.updated_at, s.tipo, s.confianza_letra
           order by s.updated_at desc`,
          [ownerId],
        )
        return filas.map((r) => ({
          sourceId: r.id as string,
          title: r.title as string,
          durationMin:
            Number(r.duration_sec) > 0 ? Math.round(Number(r.duration_sec) / 60) : null,
          hasTranscript: Boolean(r.has_transcript),
          clips: Number(r.clips),
          rendered: Number(r.rendered),
          approved: Number(r.approved),
          rejected: Number(r.rejected),
          variants: Number(r.variants_count),
          updatedAt: new Date(r.updated_at as string).toISOString(),
          tipo: typeof r.tipo === 'string' ? r.tipo : 'entrevista',
          confianzaLetra:
            r.confianza_letra === null || r.confianza_letra === undefined ? null : Number(r.confianza_letra),
        }))
      },

      upsert: async (row) => {
        await db.query(
          `insert into sources (id, owner_id, title, duration_sec, has_transcript)
           values ($1,$2,$3,$4,$5)
           on conflict (id) do update set
             title = excluded.title,
             duration_sec = excluded.duration_sec,
             has_transcript = excluded.has_transcript,
             updated_at = now()`,
          [row.sourceId, ownerId, row.title, (row.durationMin ?? 0) * 60, row.hasTranscript],
        )
      },

      contarVariantes: async () => {
        const filas = await db.query(
          `select id, variants_count from sources where owner_id = $1`,
          [ownerId],
        )
        const out: Record<string, number> = {}
        for (const r of filas) out[r.id as string] = Number(r.variants_count)
        return out
      },

      marcarVariantes: async (sourceId, n) => {
        await db.query(
          `update sources set variants_count = $3, updated_at = now()
           where id = $1 and owner_id = $2`,
          [sourceId, ownerId, n],
        )
      },
    },

    posts: {
      all: async () =>
        (
          await db.query(`select * from posts where owner_id = $1 order by published_at desc`, [
            ownerId,
          ])
        ).map((r) => ({
          id: r.id as string,
          queueItemId: r.queue_item_id as string,
          sourceId: r.source_id as string,
          clipId: r.clip_id as string,
          accountId: r.account_id as string,
          externalId: r.external_id as string,
          provider: r.provider as string,
          mode: r.mode as Post['mode'],
          publishedAt: new Date(r.published_at as string).toISOString(),
        })) as Post[],

      save: async (rows) => {
        for (const p of rows) {
          await db.query(
            `insert into posts (id, owner_id, queue_item_id, source_id, clip_id, account_id,
                                external_id, provider, mode, published_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             on conflict (id) do nothing`,
            [
              p.id, ownerId, p.queueItemId, p.sourceId, p.clipId, p.accountId,
              p.externalId, p.provider, p.mode, p.publishedAt,
            ],
          )
        }
      },
    },

    metrics: {
      all: async () =>
        (
          await db.query(`select * from metrics where owner_id = $1 order by captured_at desc`, [
            ownerId,
          ])
        ).map((r) => ({
          id: r.id as string,
          postId: r.post_id as string,
          externalId: r.external_id as string,
          accountId: r.account_id as string,
          clipId: r.clip_id as string,
          capturedAt: new Date(r.captured_at as string).toISOString(),
          ageHours: Number(r.age_hours),
          views: Number(r.views),
          likes: Number(r.likes),
          comments: Number(r.comments),
          shares: Number(r.shares ?? 0),
          // Nulo se respeta: significa 'este proveedor no mide el visionado',
          // que no es lo mismo que cero segundos.
          averageWatchSec: r.average_watch_sec === null || r.average_watch_sec === undefined
            ? null
            : Number(r.average_watch_sec),
        })) as MetricSnapshot[],

      save: async (rows) => {
        for (const m of rows) {
          await db.query(
            `insert into metrics (id, owner_id, post_id, external_id, account_id, clip_id,
                                  captured_at, age_hours, views, likes, comments,
                                  shares, average_watch_sec)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             on conflict (id) do nothing`,
            [
              m.id, ownerId, m.postId, m.externalId, m.accountId, m.clipId,
              m.capturedAt, m.ageHours, m.views, m.likes, m.comments,
              m.shares, m.averageWatchSec,
            ],
          )
        }
      },
    },
  }
}
