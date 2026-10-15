/**
 * Pasa los datos de state/*.json a Postgres.
 *
 *   npm run db:migrate
 *
 * NO BORRA NADA DE state/. Los ficheros se quedan donde estan, intactos. Si la
 * migracion sale mal o hay que volver atras, el original sigue ahi.
 *
 * Es idempotente: cada insercion resuelve el conflicto sin duplicar, asi que
 * ejecutarlo dos veces deja la base igual que ejecutarlo una.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, paths, requireEnv, ROOT } from '../src/lib/env.js'
import { readJson } from '../src/lib/fsx.js'
import { connect } from '../src/store/db.js'
import type { Account, ClipRecord, MetricSnapshot, Post, QueueItem } from '../src/store/store.js'
import type { Run } from '../src/store/runs.js'
import type { SourceMeta, Transcript } from '../src/types.js'

loadEnv()

const OWNER = '11111111-1111-1111-1111-111111111111'
const STATE = join(ROOT, 'state')

/** Lee un fichero del almacen viejo. Devuelve vacio si no existe. */
function leer<T>(nombre: string): T[] {
  const f = join(STATE, `${nombre}.json`)
  if (!existsSync(f)) return []
  try {
    return readJson<T[]>(f)
  } catch {
    return []
  }
}

const db = await connect(requireEnv('DATABASE_URL'))
const resumen: { tabla: string; leidos: number; escritos: number }[] = []

try {
  /*
   * Los videos van primero.
   *
   * Los clips tienen una clave foranea contra sources, asi que insertarlos
   * antes fallaria. Y la lista sale del directorio de trabajo, no de un fichero
   * de estado: el almacen viejo nunca guardo los videos como tales, solo los
   * clips que salieron de ellos.
   */
  let videos = 0
  if (existsSync(paths.work)) {
    for (const entrada of readdirSync(paths.work, { withFileTypes: true })) {
      if (!entrada.isDirectory() || entrada.name.startsWith('_')) continue

      const dir = join(paths.work, entrada.name)
      const metaPath = join(dir, 'source.json')
      const transcriptPath = join(dir, 'transcript.json')

      let titulo = entrada.name
      let duracion = 0
      let url: string | null = null
      if (existsSync(metaPath)) {
        try {
          const m = readJson<SourceMeta>(metaPath)
          titulo = m.title
          duracion = Math.round(m.durationSec)
          url = m.url
        } catch {
          // Un source.json roto no debe impedir migrar el resto del video.
        }
      }

      let segmentos = 0
      if (existsSync(transcriptPath)) {
        try {
          const t = readJson<Transcript>(transcriptPath)
          segmentos = t.segments.length
          if (duracion === 0) duracion = Math.round(t.durationSec)
        } catch {
          segmentos = 0
        }
      }

      await db.query(
        `insert into sources (id, owner_id, title, url, duration_sec, video_path,
                              has_transcript, segments)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set
           title = excluded.title, duration_sec = excluded.duration_sec,
           has_transcript = excluded.has_transcript, segments = excluded.segments`,
        [
          entrada.name, OWNER, titulo, url, duracion,
          existsSync(join(dir, 'source.mp4')) ? join(dir, 'source.mp4') : null,
          existsSync(transcriptPath), segmentos,
        ],
      )
      videos += 1
    }
  }
  resumen.push({ tabla: 'sources', leidos: videos, escritos: videos })

  // --- Cuentas -------------------------------------------------------------
  const cuentas = leer<Account>('accounts')
  for (const a of cuentas) {
    await db.query(
      `insert into accounts (owner_id, id, label, status, slots, token_status, last_published_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (owner_id, id) do update set
         label = excluded.label, status = excluded.status, slots = excluded.slots`,
      [OWNER, a.id, a.label, a.status, a.slots, a.tokenStatus, a.lastPublishedAt],
    )
  }
  resumen.push({ tabla: 'accounts', leidos: cuentas.length, escritos: cuentas.length })

  // --- Clips ---------------------------------------------------------------
  const clips = leer<ClipRecord>('clips')
  let clipsOk = 0
  for (const c of clips) {
    // Un clip cuyo video ya no esta en work/ (archivado, por ejemplo) no puede
    // insertarse por la clave foranea. Se cuenta aparte en vez de reventar.
    const existe = await db.query(`select 1 from sources where id = $1`, [c.sourceId])
    if (existe.length === 0) continue

    await db.query(
      `insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, hook, reason,
                          caption, hashtags, score, status, master_path, reviewed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (owner_id, source_id, clip_id) do update set
         status = excluded.status, caption = excluded.caption,
         hashtags = excluded.hashtags, reviewed_at = excluded.reviewed_at`,
      [
        OWNER, c.sourceId, c.clipId, c.start, c.end, c.hook, c.reason,
        c.caption, c.hashtags, c.score, c.status, c.masterPath, c.reviewedAt,
      ],
    )
    clipsOk += 1
  }
  resumen.push({ tabla: 'clips', leidos: clips.length, escritos: clipsOk })

  // --- Cola ----------------------------------------------------------------
  const cola = leer<QueueItem>('queue')
  let colaOk = 0
  for (const q of cola) {
    const r = await db.query(
      `insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path,
                          checksum, params, caption, hashtags, scheduled_at, status,
                          attempt_count, last_error)
       values ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb,$9,$10,$11,$12,$13,$14)
       on conflict do nothing returning id`,
      [
        q.id, OWNER, q.sourceId, q.clipId, q.accountId, q.variantPath,
        q.checksum, JSON.stringify(q.params), q.caption, q.hashtags,
        q.scheduledAt, q.status, q.attemptCount ?? 0, q.lastError ?? null,
      ],
    )
    if (r.length > 0) colaOk += 1
  }
  resumen.push({ tabla: 'queue', leidos: cola.length, escritos: colaOk })

  // --- Publicaciones y metricas --------------------------------------------
  const posts = leer<Post>('posts')
  for (const p of posts) {
    await db.query(
      `insert into posts (id, owner_id, queue_item_id, source_id, clip_id, account_id,
                          external_id, provider, mode, published_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
      [p.id, OWNER, p.queueItemId, p.sourceId, p.clipId, p.accountId,
       p.externalId, p.provider, p.mode, p.publishedAt],
    )
  }
  resumen.push({ tabla: 'posts', leidos: posts.length, escritos: posts.length })

  const metrics = leer<MetricSnapshot>('metrics')
  for (const m of metrics) {
    await db.query(
      `insert into metrics (id, owner_id, post_id, external_id, account_id, clip_id,
                            captured_at, age_hours, views, likes, comments)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`,
      [m.id, OWNER, m.postId, m.externalId, m.accountId, m.clipId,
       m.capturedAt, m.ageHours, m.views, m.likes, m.comments],
    )
  }
  resumen.push({ tabla: 'metrics', leidos: metrics.length, escritos: metrics.length })

  // --- Diario de tareas -----------------------------------------------------
  const runs = leer<Run>('runs')
  for (const r of runs) {
    await db.query(
      `insert into runs (id, owner_id, kind, source_id, label, started_at, ended_at,
                         duration_ms, status, input, output, input_tokens, output_tokens,
                         cost_usd, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text::jsonb,$11::text::jsonb,$12,$13,$14,$15)
       on conflict (id) do nothing`,
      [
        r.id, OWNER, r.kind, null, r.label, r.startedAt, r.endedAt,
        r.durationMs, r.status === 'error' ? 'error' : 'ok',
        JSON.stringify(r.input), JSON.stringify(r.output),
        r.tokens?.inputTokens ?? 0, r.tokens?.outputTokens ?? 0, r.costUsd, r.error,
      ],
    )
  }
  resumen.push({ tabla: 'runs', leidos: runs.length, escritos: runs.length })

  // --- Ajustes --------------------------------------------------------------
  const ajustes = existsSync(join(STATE, 'settings.json'))
    ? readJson<Record<string, number>>(join(STATE, 'settings.json'))
    : null
  if (ajustes !== null) {
    await db.query(
      `insert into settings (owner_id, accounts, posts_per_day, day_start_hour, day_end_hour,
                             jitter_minutes, clip_cooldown_minutes, account_repeat_hours)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (owner_id) do update set
         accounts = excluded.accounts, posts_per_day = excluded.posts_per_day,
         day_start_hour = excluded.day_start_hour, day_end_hour = excluded.day_end_hour,
         jitter_minutes = excluded.jitter_minutes,
         clip_cooldown_minutes = excluded.clip_cooldown_minutes,
         account_repeat_hours = excluded.account_repeat_hours`,
      [
        OWNER, ajustes.accounts, ajustes.postsPerDay, ajustes.dayStartHour,
        ajustes.dayEndHour, ajustes.jitterMinutes, ajustes.clipCooldownMinutes,
        ajustes.accountRepeatHours,
      ],
    )
    resumen.push({ tabla: 'settings', leidos: 1, escritos: 1 })
  }

  // --- Reporte --------------------------------------------------------------
  console.log('')
  console.log('  tabla       leidos  escritos')
  for (const r of resumen) {
    const aviso = r.leidos !== r.escritos ? `  <- ${r.leidos - r.escritos} sin migrar` : ''
    console.log(
      `  ${r.tabla.padEnd(10)}  ${String(r.leidos).padStart(6)}  ${String(r.escritos).padStart(8)}${aviso}`,
    )
  }
  console.log('')
  console.log('  Los ficheros de state/ siguen intactos.')
} finally {
  await db.close()
}
