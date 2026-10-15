import { createHash } from 'node:crypto'
import { createLogger } from '../lib/logger.js'
import { run } from '../lib/proc.js'
import type { SourceMeta } from '../types.js'

const log = createLogger('kick')

/**
 * Resolutor de VOD de Kick.
 *
 * Existe porque el extractor de Kick que trae yt-dlp esta roto para los VOD
 * nuevos, y no por tener yt-dlp desactualizado: se comprobo contra la ultima
 * version publicada (2026.08.19) y falla igual.
 *
 * La causa es que Kick convive con dos esquemas de identificador. La API que
 * consulta yt-dlp, /api/v1/video/<id>, solo entiende los UUID version 4 de los
 * VOD antiguos; las direcciones nuevas llevan un UUID version 7 y esa ruta
 * devuelve 404. Se ve a simple vista comparando los dos:
 *
 *   de la URL nueva   01a0743d-6218-7547-8ad9-c7994c97a09f   <- el 7 marca v7
 *   de la API vieja   6319a6a4-9dd2-41ee-b639-d0737f219770   <- el 4 marca v4
 *
 * Los dos apuntan al mismo directo de 128 minutos.
 *
 * La pagina del VOD si funciona y trae dentro la lista de reproduccion, asi que
 * se saca de ahi. Es fragil por definicion (depende del HTML de un tercero),
 * pero la alternativa es no poder procesar ningun directo de Kick.
 */

/** Direcciones tipo https://kick.com/<canal>/videos/<uuid>. */
const KICK_VOD = /^https?:\/\/(?:www\.)?kick\.com\/([^/]+)\/videos\/([0-9a-f-]+)/i

export function isKickVod(url: string): boolean {
  return KICK_VOD.test(url)
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

/**
 * curl del sistema, no el fetch de Node.
 *
 * Kick esta detras de Cloudflare, que no mira solo las cabeceras sino la huella
 * TLS de quien llama. Medido: con fetch de Node devuelve 403 tanto mandando
 * solo el user-agent como mandando el juego completo de cabeceras de Chrome
 * (accept, sec-ch-ua, sec-fetch-*). La misma peticion con curl devuelve 200.
 *
 * El motivo es que el curl de Windows usa Schannel, la pila TLS del propio
 * sistema, la misma que usan los navegadores. Node trae su OpenSSL y su huella
 * se distingue. Ninguna cabecera arregla eso.
 *
 * Se usa la ruta absoluta de System32 y no "curl" a secas para no depender del
 * PATH, que es la misma regla que sigue el proyecto con ffmpeg y yt-dlp.
 */
const CURL = 'C:\\Windows\\System32\\curl.exe'

async function pedirPagina(url: string): Promise<string> {
  const res = await run(CURL, [
    '--silent',
    '--show-error',
    '--location',
    '--max-time',
    '45',
    '--user-agent',
    UA,
    url,
  ])

  if (res.exitCode !== 0) {
    throw new Error(`curl fallo al pedir ${url}: ${res.stderr.trim() || `codigo ${res.exitCode}`}`)
  }
  return res.stdout
}

/** Suma las duraciones declaradas en la lista de reproduccion. */
function durationFromPlaylist(text: string): number {
  let total = 0
  for (const m of text.matchAll(/#EXTINF:([\d.]+)/g)) {
    total += Number.parseFloat(m[1] ?? '0')
  }
  return Math.round(total)
}

export async function metadataFromKick(url: string): Promise<SourceMeta> {
  const match = KICK_VOD.exec(url)
  if (match === null) throw new Error(`No parece un VOD de Kick: ${url}`)

  const canal = match[1] ?? 'kick'
  const uuid = match[2] ?? ''

  log.info(`Resolviendo VOD de Kick: ${canal}/${uuid}`)

  const html = await pedirPagina(url)

  // Se busca la lista maestra del VOD, no la del directo. La del directo vive
  // en playback.live-video.net y lleva un token que caduca; la del VOD esta en
  // stream.kick.com y es una ruta estable.
  const maestra = /https:\/\/stream\.kick\.com\/[^"'\\ ]+?master\.m3u8/.exec(html)?.[0]
  if (maestra === undefined) {
    throw new Error(
      'No se encontro la lista de reproduccion en la pagina del VOD. ' +
        'Puede que el directo siga emitiendo, que el VOD sea privado, o que Kick ' +
        'haya vuelto a cambiar su web.',
    )
  }

  // La duracion sale de contar la lista de la mejor calidad. Es el unico sitio
  // fiable: la pagina no la publica en ningun sitio legible.
  let durationSec = 0
  try {
    const base = maestra.slice(0, maestra.lastIndexOf('/'))
    durationSec = durationFromPlaylist(await pedirPagina(`${base}/1080p/playlist.m3u8`))
  } catch {
    // Sin duracion el resto sigue funcionando: ffprobe la sacara del archivo.
  }

  const titulo = /<title>([^<]+)<\/title>/.exec(html)?.[1]?.replace(/ - Watch the VOD on Kick$/, '')

  // El identificador se deriva del uuid de la direccion, que es lo unico
  // estable: reprocesar la misma URL cae en la misma carpeta de trabajo.
  const digest = createHash('sha256').update(uuid).digest('hex').slice(0, 10)

  log.info(`VOD resuelto: ${Math.round(durationSec / 60)} min`)

  return {
    id: `kick-${canal}-${digest}`,
    url: maestra,
    title: titulo?.trim() || `${canal} en Kick`,
    durationSec,
    uploader: canal,
    width: null,
    height: null,
    fps: null,
  }
}
