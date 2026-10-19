/**
 * Verificacion del procesador (Fase 4).
 *
 *   npm run verify:procesador
 *
 * Contra PGlite en memoria y una carpeta temporal: reintentos con espera,
 * reanudacion al reiniciar, salida sin rutas, bloqueo de YouTube, ajustes del
 * procesador y limpieza de archivos.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'

loadEnv()
const TMP = mkdtempSync(join(tmpdir(), 'klip-verify-procesador-'))
process.env.WORK_DIR = join(TMP, 'work')
mkdirSync(process.env.WORK_DIR, { recursive: true })

const { createCola } = await import('../src/jobs/cola.js')
const { seReintenta, MAX_REINTENTOS, SALIDA_NO_REINTENTAR } = await import('../src/jobs/reintentos.js')
const { createSistema } = await import('../src/jobs/sistema.js')
const { limpiarRutas } = await import('../src/lib/limpiar.js')
const { esBloqueoYoutube } = await import('../src/ingest/download.js')
const { permitido } = await import('../src/auth/auth.js')
const { argsCalidadVideo, bitrateAudio } = await import('../src/render/calidad.js')

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = ''): void => { checks.push({ name, ok, detail }) }

// --- Sin rutas en pantalla --------------------------------------------------------

const crudo = 'El proceso fallo: C:\\Users\\ana.perez\\Desktop\\klip\\out\\vod-1\\clip-01.mp4 no existe; ' +
  'modelo en /home/ana/klip/models/ggml.bin; clave sk-ant-api03-AbCdEfGhIjKlMnOp'
const limpio = limpiarRutas(crudo)
check(
  'La salida no enseña rutas, usuario de Windows ni claves',
  !limpio.includes('ana') && !limpio.includes('C:\\') && !limpio.includes('/home') && !limpio.includes('AbCdEf') &&
    limpio.includes('out\\vod-1\\clip-01.mp4') && limpio.includes('models/ggml.bin'),
  limpio,
)

// --- YouTube bloqueado --------------------------------------------------------------

check(
  'Se reconoce el bloqueo de YouTube (mensaje real de yt-dlp)',
  esBloqueoYoutube("ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.") &&
    !esBloqueoYoutube('ERROR: Unable to download video data: HTTP Error 503'),
)

// --- Reintentos ------------------------------------------------------------------------

check('Primer fallo: se reintenta al minuto', seReintenta('render', 1, 0) === 60)
check('Segundo fallo: a los 5 minutos', seReintenta('render', 1, 1) === 300)
check(`Tras ${MAX_REINTENTOS} reintentos, no mas`, seReintenta('render', 1, 2) === null)
check('Lo que no se arregla insistiendo no se reintenta', seReintenta('ingest', SALIDA_NO_REINTENTAR, 0) === null)
check('Publicar y probar no se reintentan aqui', seReintenta('publish', 1, 0) === null && seReintenta('probar-ia', 1, 0) === null)

// --- La cola -----------------------------------------------------------------------------

const pg = new PGlite()
const db = {
  query: async <T>(sql: string, params: unknown[] = []) => (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}
for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}
const OWNER = '11111111-1111-1111-1111-111111111111'
await pg.exec(`insert into owners (id, email, label) values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)
const cola = createCola(db, OWNER)

const j = await cola.encolar('render', ['vod-1'], 'Armar clips de vod-1')
await cola.coger('PC1-100')
await cola.reprogramar(j.id, 60, ['C:\\Users\\ana\\klip\\out\\vod-1\\x.mp4 fallo'], 'Falló; se reintenta sola a las 10:01 (intento 1 de 2).')
const tras = await cola.porId(j.id)
check(
  'Un fallo reintentable vuelve a la cola con su espera',
  tras?.status === 'queued' && tras.reintentos === 1 && tras.noAntesDe !== null &&
    new Date(tras.noAntesDe).getTime() > Date.now() + 50_000,
  JSON.stringify({ status: tras?.status, reintentos: tras?.reintentos, noAntesDe: tras?.noAntesDe }),
)
check('Y en el registro no queda la ruta', !(tras?.log ?? '').includes('ana'), tras?.log ?? '')
check('Antes de su hora nadie la coge', (await cola.coger('PC1-100')) === null)
await pg.query(`update jobs set no_antes_de = now() - interval '1 second' where id = $1`, [j.id])
const otraVez = await cola.coger('PC1-100')
check('Pasada la espera, se vuelve a coger', otraVez?.id === j.id && otraVez.reintentos === 1)

await cola.terminar(j.id, 'error', 1, ['Error en C:\\Users\\ana\\Desktop\\klip\\work\\vod-1\\audio.wav'])
const fallida = await cola.porId(j.id)
check('Al cerrar una tarea, la ultima linea sale sin rutas', !(fallida?.lastLine ?? '').includes('ana') && (fallida?.lastLine ?? '').includes('audio.wav'), fallida?.lastLine ?? '')

// Reanudacion al reiniciar el trabajador.
const a = await cola.encolar('ingest', ['https://x'], 'Descargar')
const b = await cola.encolar('ingest', ['https://y'], 'Descargar')
await cola.coger('PC1-111')
await cola.coger('PC2-5')
const recuperadas = await cola.recuperarDeEsteEquipo('PC1', 'PC1-222')
check(
  'Al reiniciar, lo que este equipo dejo a medias vuelve a la cola en el acto',
  recuperadas === 1 && (await cola.porId(a.id))?.status === 'queued' && (await cola.porId(b.id))?.status === 'running',
  `${recuperadas} recuperada(s)`,
)

// Latido del trabajador.
await cola.latirTrabajador('PC1-222')
check('El latido marca al procesador como conectado', (await cola.trabajadorVivo()).vivo)
await pg.query(`update trabajadores set visto_en = now() - interval '6 minutes'`)
const caido = await cola.trabajadorVivo()
check('Sin latido, el panel lo ve desconectado', !caido.vivo && caido.vistoEn !== null)

// --- Ajustes del procesador ----------------------------------------------------------------

const sistema = createSistema(db, OWNER)
let error = ''
try { await sistema.guardarAjustes({ ytdlpCookies: 'netscape' }) } catch (e) { error = (e as Error).message }
check('Un navegador que no existe se rechaza', error !== '')
const guardado = await sistema.guardarAjustes({ ytdlpCookies: 'firefox', retencionDias: 14 })
check('Se guardan las cookies y los dias de retencion', guardado.ytdlpCookies === 'firefox' && guardado.retencionDias === 14)
error = ''
try { await sistema.guardarAjustes({ retencionDias: 400 }) } catch (e) { error = (e as Error).message }
check('Mas de 365 dias se rechaza', error !== '')
check('Solo un administrador cambia el procesador', !permitido('operador', 'PUT', '/api/sistema') && permitido('operador', 'GET', '/api/sistema') && permitido('admin', 'PUT', '/api/sistema'))

// --- Disco y retencion -----------------------------------------------------------------------

const disco = await sistema.comprobarDisco()
const estadoDisco = (await sistema.estado()).disco
check('Mide el disco y lo guarda para el panel', disco !== null && disco.usado >= 0 && disco.usado <= 1 && estadoDisco !== undefined, JSON.stringify(estadoDisco?.valor))

const work = process.env.WORK_DIR!
const crear = (id: string, nombre: string): string => {
  mkdirSync(join(work, id), { recursive: true })
  const ruta = join(work, id, nombre)
  writeFileSync(ruta, Buffer.alloc(1024 * 1024))
  return ruta
}
const viejoRevisado = crear('vod-viejo', 'source.mp4')
crear('vod-viejo', 'audio.wav')
const transcripcion = crear('vod-viejo', 'transcript.json')
const viejoPendiente = crear('vod-pendiente', 'source.mp4')
const nuevo = crear('vod-nuevo', 'source.mp4')
const descartado = crear('vod-viejo', 'clip-02.mp4')
const aprobado = crear('vod-viejo', 'clip-01.mp4')
await pg.query(
  `insert into sources (id, owner_id, title, created_at) values
     ('vod-viejo', $1, 'Viejo', now() - interval '20 days'),
     ('vod-pendiente', $1, 'Pendiente', now() - interval '20 days'),
     ('vod-nuevo', $1, 'Nuevo', now())`,
  [OWNER],
)
await pg.query(
  `insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, status, master_path) values
     ($1, 'vod-viejo', 'clip-01', 0, 30, 'approved', $2),
     ($1, 'vod-viejo', 'clip-02', 30, 60, 'rejected', $3),
     ($1, 'vod-pendiente', 'clip-01', 0, 30, 'pending', '')`,
  [OWNER, aprobado, descartado],
)
const r = await sistema.aplicarRetencion(14)
check(
  'Retencion: borra el original de lo revisado hace mas de N dias y los clips descartados',
  !existsSync(viejoRevisado) && !existsSync(descartado) && r.videos === 1 && r.clips === 1 && r.mb >= 3,
  JSON.stringify(r),
)
check(
  'Retencion: no toca lo pendiente, lo reciente, la transcripcion ni lo aprobado',
  existsSync(viejoPendiente) && existsSync(nuevo) && existsSync(transcripcion) && existsSync(aprobado),
)
check('Con 0 dias no se borra nada', (await sistema.aplicarRetencion(0)).videos === 0 && existsSync(viejoPendiente))

// --- Calidad de los clips ---------------------------------------------------------------------

const calidad = argsCalidadVideo()
check(
  'Los clips llevan techo de bitrate (antes sin limite) y audio a 128k',
  calidad.includes('-maxrate') && calidad[calidad.indexOf('-maxrate') + 1] === '4M' &&
    calidad[calidad.indexOf('-bufsize') + 1] === '8M' && calidad[calidad.indexOf('-cq') + 1] === '24' && bitrateAudio() === '128k',
  calidad.join(' '),
)

await pg.close()
rmSync(TMP, { recursive: true, force: true })

for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLO'} ${c.name}`)
  if (!c.ok && c.detail !== '') console.log(`        ${c.detail}`)
}
const fallidas = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - fallidas.length}/${checks.length} comprobaciones pasan.`)
if (fallidas.length > 0) process.exitCode = 1
