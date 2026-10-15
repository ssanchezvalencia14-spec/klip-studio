import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bin, optionalEnv } from '../lib/env.js'
import { fileSizeMb, hasContent, workDir, writeJson } from '../lib/fsx.js'
import { createLogger, formatDuration } from '../lib/logger.js'
import { probe, ytdlp } from '../lib/proc.js'
import type { SourceMeta } from '../types.js'

const log = createLogger('ingest')

/** Subconjunto del JSON de yt-dlp que este proyecto consume. */
interface YtdlpDump {
  id?: unknown
  title?: unknown
  duration?: unknown
  uploader?: unknown
  width?: unknown
  height?: unknown
  fps?: unknown
  webpage_url?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Campos que se piden a yt-dlp, y solo esos.
 *
 * `--dump-single-json` devuelve el volcado completo: para un video de 87 minutos
 * son mas de 500 KB de formatos, storyboards y URLs de subtitulos en decenas de
 * idiomas, de los cuales usamos ocho campos. Pedir solo lo necesario baja la
 * carga util a unos 300 bytes.
 */
const METADATA_FIELDS = 'id,title,duration,uploader,width,height,fps,webpage_url'

/**
 * El player_client que usa yt-dlp contra YouTube.
 *
 * LO NECESITAN LAS DOS LLAMADAS, no solo la descarga. Esa fue la mitad que se
 * quedo sin arreglar el 2026-10-03: se puso en la descarga, y la consulta de
 * metadatos seguia yendo a pelo. Como esa va primero, los tres VOD siguientes
 * murieron antes de empezar con "Sign in to confirm you're not a bot", que
 * encima no se parece en nada al 403 que se habia corregido.
 *
 * Medido ese dia contra ZOTI, JOELSA - QUE HPTA PARTY:
 *
 *   android        devuelve los metadatos
 *   mweb           devuelve los metadatos
 *   web_embedded   devuelve los metadatos
 *   web_safari     "Requested format is not available"
 *   tv             "The page needs to be reloaded"
 *   android_vr     "Sign in to confirm you're not a bot"
 *
 * Lista y no uno solo: cual funciona cambia cada pocos meses segun lo que toque
 * YouTube, y asi yt-dlp pasa al siguiente sin que haya que tocar codigo.
 */
function clientesYoutube(): string {
  return optionalEnv('YTDLP_EXTRACTOR_ARGS') ?? 'youtube:player_client=android,mweb,web_embedded'
}

/** Consulta los metadatos sin descargar el video. */
export async function fetchMetadata(url: string): Promise<SourceMeta> {
  log.info(`Consultando metadatos: ${url}`)

  const { stdout } = await ytdlp([
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '--extractor-args',
    clientesYoutube(),
    '--print',
    `%(.{${METADATA_FIELDS}})j`,
    url,
  ])

  const dump = JSON.parse(stdout.trim()) as YtdlpDump

  const id = asString(dump.id)
  if (id === null) throw new Error('yt-dlp no devolvio un id de video utilizable.')

  const durationSec = asNumber(dump.duration)
  if (durationSec === null) {
    throw new Error(
      'yt-dlp no devolvio duracion. Puede tratarse de una transmision en vivo, que este ' +
        'pipeline no soporta: procesa la grabacion una vez finalizada.',
    )
  }

  const meta: SourceMeta = {
    id,
    url: asString(dump.webpage_url) ?? url,
    title: asString(dump.title) ?? id,
    durationSec,
    uploader: asString(dump.uploader),
    width: asNumber(dump.width),
    height: asNumber(dump.height),
    fps: asNumber(dump.fps),
  }

  log.info(
    `"${meta.title}" | ${formatDuration(meta.durationSec * 1000)} | ` +
      `${meta.width ?? '?'}x${meta.height ?? '?'} @ ${meta.fps ?? '?'} fps`,
  )

  return meta
}

/**
 * Descarga el VOD. Reanudable: si ya existe un archivo valido, no rehace nada.
 *
 * Se pasa --ffmpeg-location apuntando al build de gyan.dev a proposito. yt-dlp
 * trae su propio ffmpeg como dependencia y lo prefiere si no se le indica otro;
 * ese build no incluye NVENC ni el filtro whisper. Aqui solo se usa para
 * remuxear, pero mantener un unico ffmpeg en todo el pipeline evita divergencias
 * silenciosas de comportamiento.
 */
export async function downloadSource(meta: SourceMeta): Promise<string> {
  const dir = workDir(meta.id)
  const target = join(dir, 'source.mp4')

  if (hasContent(target, 1024 * 1024)) {
    try {
      await probe(target)
      log.info(`Ya descargado, se omite: ${target} (${fileSizeMb(target).toFixed(1)} MB)`)
      return target
    } catch {
      log.warn('El archivo existente no es legible por ffprobe. Se vuelve a descargar.')
    }
  }

  log.info('Descargando VOD...')
  let lastPercent = -1

  const args = [
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--ffmpeg-location',
    dirname(bin.ffmpeg),
    '-f',
    optionalEnv('YTDLP_FORMAT') ?? 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/b',
    '--merge-output-format',
    'mp4',
    '-o',
    target,
  ]

  // El mismo cliente que en los metadatos: ver clientesYoutube(). Sin el,
  // YouTube deja empezar la descarga y la corta a mitad con un 403.
  args.push('--extractor-args', clientesYoutube())

  const cookiesBrowser = optionalEnv('YTDLP_COOKIES_FROM_BROWSER')
  if (cookiesBrowser !== undefined) {
    log.warn(`Usando cookies de ${cookiesBrowser}: yt-dlp accedera a tu sesion.`)
    args.push('--cookies-from-browser', cookiesBrowser)
  }

  args.push(meta.url)

  await ytdlp(args, {
      onStderr: () => {
        /* el progreso de yt-dlp va por stdout */
      },
    },
  ).then((result) => {
    for (const line of result.stdout.split('\n')) {
      const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line)
      if (match?.[1] === undefined) continue
      const percent = Math.floor(Number(match[1]) / 25) * 25
      if (percent > lastPercent) {
        lastPercent = percent
        log.debug(`descarga ${percent}%`)
      }
    }
    return result
  })

  if (!existsSync(target)) {
    throw new Error(`yt-dlp termino sin error pero no produjo ${target}.`)
  }

  const info = await probe(target)
  const video = info.streams.find((s) => s.codec_type === 'video')
  log.info(
    `Descargado: ${fileSizeMb(target).toFixed(1)} MB | ` +
      `${video?.width ?? '?'}x${video?.height ?? '?'} | ${video?.codec_name ?? '?'}`,
  )

  writeJson(join(dir, 'source.json'), meta)
  return target
}
