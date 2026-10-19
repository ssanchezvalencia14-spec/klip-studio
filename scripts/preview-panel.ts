/**
 * El panel con datos de mentira, para mirarlo.
 *
 *   npx tsx scripts/preview-panel.ts
 *
 * Levanta el servidor de verdad sobre un Postgres en memoria y lo deja
 * corriendo. Existe para revisar el diseño sin tocar la base real ni depender
 * de que haya un VOD a medias: la revision visual necesita ver las seis
 * pantallas con contenido, y produccion no siempre tiene de todo.
 *
 * Sin login (KLIP_SIN_LOGIN=1): escucha solo en 127.0.0.1 y muere al cerrar
 * la consola.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'
import { OWNER_ID as OWNER } from '../src/lib/owner.js'
import type { Db } from '../src/store/db.js'
import { startReviewServer } from '../src/review/server.js'

process.env.AUTO_CHAIN = '0'
process.env.PANEL_REMOTO = '1'
delete process.env.REVIEW_PASSWORD
delete process.env.REVIEW_KEY
// Vista previa sin login: el servidor escucha solo en 127.0.0.1.
process.env.KLIP_SIN_LOGIN = '1'

const pg = new PGlite()
const db: Db = {
  query: async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}

for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}

/*
 * Dos VOD y no uno, y con distinto avance: uno a medias y otro terminado.
 * Un solo VOD enseña un solo estado de la fila de pasos, que es justo donde
 * vive la mitad del color de la pantalla de Inicio.
 */
await pg.exec(`
  insert into owners (id, email, label)
    values ('${OWNER}', 'yo@ejemplo.com', 'Yo');

  insert into sources (id, owner_id, title, duration_sec, has_transcript, variants_count)
    values ('vod-uno', '${OWNER}', 'Directo del lunes', 7200, true, 4),
           ('vod-dos', '${OWNER}', 'Maraton del sabado', 14400, true, 0);
  update sources set tipo = 'musica', confianza_letra = 0.3 where id = 'vod-dos';

  insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, hook, reason,
                     caption, hashtags, score, status, master_path)
    values
      ('${OWNER}', 'vod-uno', 'clip-01', 10, 40,
       'Lo que nadie te cuenta de empezar de cero',
       'Arranca con una afirmacion fuerte y la resuelve antes de los 30 segundos.',
       'Empezar de cero no es el problema', '{consejos,directo}', 91, 'pending', 'C:/falso/1.mp4'),
      ('${OWNER}', 'vod-uno', 'clip-02', 60, 95,
       'El error que cometi durante dos anios',
       'Historia personal con giro al final. Funciona en vertical.',
       'Dos anios equivocado', '{historia}', 78, 'pending', 'C:/falso/2.mp4'),
      ('${OWNER}', 'vod-uno', 'clip-03', 120, 150,
       'Tres cosas que haria distinto',
       'Lista corta, facil de seguir sin sonido.',
       'Tres cosas', '{lista}', 54, 'pending', 'C:/falso/3.mp4'),
      ('${OWNER}', 'vod-uno', 'clip-04', 200, 232,
       'La pregunta que me hacen siempre',
       'Responde a una duda repetida.',
       'La pregunta de siempre', '{faq}', 83, 'approved', 'C:/falso/4.mp4'),
      ('${OWNER}', 'vod-uno', 'clip-05', 300, 330,
       'Un momento flojo',
       'Se queda sin gancho a mitad.',
       'Flojo', '{}', 41, 'rejected', '');

  insert into accounts (owner_id, id, label, slots)
    values ('${OWNER}', 'acc-01', 'Cuenta 1', '{10,14,18}'),
           ('${OWNER}', 'acc-02', 'Cuenta 2', '{11,15,19}');

  insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path,
                     checksum, scheduled_at, status)
    values ('q1', '${OWNER}', 'vod-uno', 'clip-04', 'acc-01', 'v1.mp4', 'aaa',
            now() + interval '1 hour', 'pending'),
           ('q2', '${OWNER}', 'vod-uno', 'clip-04', 'acc-02', 'v2.mp4', 'bbb',
            now() + interval '3 hours', 'pending');

  /*
   * Trabajos ya terminados, para la campana de avisos.
   *
   * Un aviso ES un trabajo que acabo, asi que sin estos la campana sale siempre
   * vacia y no hay forma de revisarla. Con fechas escalonadas para ver tambien
   * los "hace N minutos", y uno fallido, que es el que lleva la barra roja y
   * tiene que distinguirse de un vistazo entre los demas.
   */
  insert into jobs (id, owner_id, kind, args, label, status, last_line, exit_code,
                    created_at, ended_at)
    values
      ('j1', '${OWNER}', 'render', '{vod-uno}', 'Renderizar vod-uno', 'ok',
       '5 clips listos', 0, now() - interval '9 minutes', now() - interval '4 minutes'),
      ('j2', '${OWNER}', 'select', '{vod-uno}', 'Elegir momentos de vod-uno', 'ok',
       '5 momentos', 0, now() - interval '40 minutes', now() - interval '31 minutes'),
      ('j3', '${OWNER}', 'ingest', '{https://ejemplo}', 'Descargar y transcribir', 'error',
       'yt-dlp devolvio 403', 1, now() - interval '3 hours', now() - interval '3 hours'),
      ('j4', '${OWNER}', 'doctor', '{}', 'Diagnostico del entorno', 'ok',
       'todo correcto', 0, now() - interval '2 days', now() - interval '2 days'),
      -- El mismo fallo tres veces: se tiene que ver como UNA tarjeta.
      ('j5', '${OWNER}', 'render', '{vod-dos}', 'Renderizar vod-dos', 'error',
       'ffmpeg termino con error', 1, now() - interval '50 minutes', now() - interval '50 minutes'),
      ('j6', '${OWNER}', 'render', '{vod-dos}', 'Renderizar vod-dos', 'error',
       'ffmpeg termino con error', 1, now() - interval '45 minutes', now() - interval '45 minutes'),
      ('j7', '${OWNER}', 'render', '{vod-dos}', 'Renderizar vod-dos', 'error',
       'ffmpeg termino con error', 1, now() - interval '40 minutes', now() - interval '40 minutes'),
      -- Una tarea esperando a la IA, que esta en limite (abajo).
      ('j8', '${OWNER}', 'select', '{vod-dos}', 'Elegir momentos de vod-dos', 'en_espera_ia',
       'La IA llegó al límite de uso.', 75, now() - interval '20 minutes', now() - interval '20 minutes');

  -- La IA con limite de uso: el aviso unico de Inicio y la pantalla Ajustes, IA.
  insert into ia_estado (owner_id, estado, mensaje, reanudar_en, proveedor, modelo)
    values ('${OWNER}', 'limite', 'La IA llegó al límite de uso.',
            now() + interval '2 hours', 'claude-cli', 'sonnet');

  insert into runs (id, owner_id, kind, label, started_at, ended_at, duration_ms,
                    status, input, output, input_tokens, output_tokens, cost_usd)
    values ('r1', '${OWNER}', 'select', 'Elegir momentos', now(), now(), 522000,
            'ok', '{"segmentos": 3027}', '{"clips": 32}', 91578, 4200, 0.2700),
           ('r2', '${OWNER}', 'render', 'Renderizar', now(), now(), 180000,
            'ok', '{}', '{"archivos": 32}', 0, 0, 0),
           ('r3', '${OWNER}', 'ingest', 'Descargar', now(), now(), 95000,
            'error', '{}', '{}', 0, 0, 0);
`)

const PUERTO = Number(process.env.PORT ?? 4310)
startReviewServer({ port: PUERTO, db, ownerId: OWNER })
console.log('panel de prueba en http://127.0.0.1:' + PUERTO)
