import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { probe } from '../lib/proc.js'
import type { SourceMeta } from '../types.js'

/**
 * Construye los metadatos de un archivo local, sin pasar por yt-dlp.
 *
 * Existe porque el contenido de origen de este proyecto son streams propios, y
 * esos suelen estar en disco antes que en YouTube. Tambien permite probar el
 * pipeline sin depender de una descarga.
 */
export async function metadataFromFile(filePath: string): Promise<SourceMeta> {
  const absolute = resolve(filePath)
  if (!existsSync(absolute)) throw new Error(`No existe el archivo: ${absolute}`)

  const info = await probe(absolute)

  const durationSec = Number(info.format.duration ?? 0)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`ffprobe no pudo determinar la duracion de ${absolute}.`)
  }

  const video = info.streams.find((s) => s.codec_type === 'video')

  // El id se deriva del nombre y del tamaño para que reprocesar el mismo archivo
  // reutilice su directorio de trabajo y la reanudacion funcione.
  const stats = statSync(absolute)
  const digest = createHash('sha1')
    .update(`${basename(absolute)}:${stats.size}`)
    .digest('hex')
    .slice(0, 10)

  const name = basename(absolute, extname(absolute))
  const slug = name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40)

  return {
    id: `local-${slug}-${digest}`,
    url: absolute,
    title: name,
    durationSec,
    uploader: null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFrameRate(video?.r_frame_rate),
  }
}

/** ffprobe reporta el frame rate como fraccion, por ejemplo "30000/1001". */
function parseFrameRate(value: string | undefined): number | null {
  if (value === undefined) return null
  const [num, den] = value.split('/')
  const numerator = Number(num)
  const denominator = Number(den ?? 1)
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return Math.round((numerator / denominator) * 1000) / 1000
}
