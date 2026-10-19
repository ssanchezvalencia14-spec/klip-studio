import { optionalEnv } from '../lib/env.js'

/**
 * Calidad de los clips: lo que decide cuanto pesan.
 *
 * Antes era VBR con calidad 21 y SIN TECHO de bitrate (`-b:v 0`): un clip de
 * 42 s salia en unos 30 MB (~5,7 Mbps). TikTok vuelve a comprimir todo lo que
 * recibe, asi que ese peso no se ve en el movil de nadie: solo ocupa disco y
 * tarda mas en subir.
 *
 * Ahora: calidad 24 y un techo de 4 Mbps (con colchon del doble), audio a
 * 128 kbps. Para 1080x1920 a 30 fps es holgado para la plataforma. Un clip de
 * 42 s no deberia pasar de unos 21 MB, y lo normal es que quede bastante por
 * debajo. SIN MEDIR en el PC de desarrollo (no tiene ffmpeg): compruebalo con
 * un render real y ajusta si hace falta.
 *
 *   NVENC_CQ        calidad (menor = mejor y mas pesado). Por defecto 24.
 *   NVENC_MAXRATE   techo de bitrate de video. Por defecto 4M.
 *   AUDIO_BITRATE   bitrate de audio. Por defecto 128k.
 */
export function argsCalidadVideo(cq?: number | string): string[] {
  const calidad = String(cq ?? optionalEnv('NVENC_CQ') ?? '24')
  const techo = optionalEnv('NVENC_MAXRATE') ?? '4M'
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(techo)
  const colchon = m ? `${Number(m[1]) * 2}${m[2]}` : '8M'
  return ['-rc', 'vbr', '-cq', calidad, '-b:v', '0', '-maxrate', techo, '-bufsize', colchon]
}

export function bitrateAudio(): string {
  return optionalEnv('AUDIO_BITRATE') ?? '128k'
}
