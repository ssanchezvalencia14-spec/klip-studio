import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { optionalEnv, paths } from '../lib/env.js'
import { ensureDir, fileSizeMb } from '../lib/fsx.js'
import { createLogger, formatDuration } from '../lib/logger.js'
import { ffmpeg, probe } from '../lib/proc.js'
import { PLAY_RES_X, PLAY_RES_Y } from '../render/ass.js'
import { deriveParams, type VariantParams } from './params.js'

const log = createLogger('variants')

/**
 * Filtergraph de la variante, aplicado sobre el clip maestro ya vertical.
 *
 * Se parte del maestro y no del video fuente a proposito. Rehacer el
 * reencuadre, el desenfoque y los subtitulos veinte veces por clip costaria
 * veinte veces el render completo; partir del maestro es una operacion ligera.
 * El precio es una segunda compresion, que a cq 21 no se distingue.
 */
function buildVariantFilters(params: VariantParams): { video: string; audio: string } {
  const { zoom, speed, brightness, contrast, saturation } = params

  const video = [
    // Acercamiento: se agranda y se recorta al centro. trunc(.../2)*2 fuerza
    // dimensiones pares, que el encoder h264 exige.
    `scale=trunc(iw*${zoom}/2)*2:trunc(ih*${zoom}/2)*2`,
    `crop=${PLAY_RES_X}:${PLAY_RES_Y}:(iw-${PLAY_RES_X})/2:(ih-${PLAY_RES_Y})/2`,
    // Ajuste de color imperceptible.
    `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
    // Velocidad. PTS se divide porque un factor mayor que 1 acelera.
    `setpts=PTS/${speed}`,
  ].join(',')

  // atempo mantiene el tono al cambiar la velocidad. Si video y audio no se
  // ajustan con el mismo factor, el clip se desincroniza.
  const audio = `atempo=${speed}`

  return { video, audio }
}

/** SHA-256 del archivo, para comprobar que las variantes son de verdad distintas. */
export function fileChecksum(filePath: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', rejectPromise)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolvePromise(hash.digest('hex')))
  })
}

export interface VariantResult {
  path: string
  accountId: string
  clipId: string
  params: VariantParams
  checksum: string
  durationSec: number
  sizeMb: number
  elapsedMs: number
}

/** Renderiza la variante de un clip para una cuenta concreta. */
export async function renderVariant(
  sourceId: string,
  clipId: string,
  masterPath: string,
  accountId: string,
): Promise<VariantResult> {
  const startedAt = performance.now()

  const params = deriveParams(clipId, accountId)
  const { video, audio } = buildVariantFilters(params)

  const outDir = ensureDir(join(paths.out, sourceId, 'variants', clipId))
  const target = join(outDir, `${accountId}.mp4`)

  const cq = optionalEnv('NVENC_CQ') ?? '21'
  const preset = optionalEnv('NVENC_PRESET') ?? 'p6'

  await ffmpeg([
    '-y',
    '-ss',
    params.trimStartSec.toFixed(3),
    '-i',
    masterPath,
    '-vf',
    video,
    '-af',
    audio,
    '-c:v',
    'h264_nvenc',
    '-preset',
    preset,
    '-tune',
    'hq',
    '-rc',
    'vbr',
    '-cq',
    cq,
    '-b:v',
    '0',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    target,
  ])

  const info = await probe(target)
  const durationSec = Number(info.format.duration ?? 0)
  const checksum = await fileChecksum(target)
  const elapsedMs = performance.now() - startedAt

  log.debug(
    `${clipId}/${accountId}: zoom ${params.zoom} vel ${params.speed} ` +
      `corte ${params.trimStartSec.toFixed(2)}s -> ${durationSec.toFixed(1)}s ` +
      `en ${formatDuration(elapsedMs)}`,
  )

  return {
    path: target,
    accountId,
    clipId,
    params,
    checksum,
    durationSec,
    sizeMb: fileSizeMb(target),
    elapsedMs,
  }
}
