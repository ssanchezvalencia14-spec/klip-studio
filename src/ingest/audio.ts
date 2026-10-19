import { join } from 'node:path'
import { fileSizeMb, hasContent, workDir } from '../lib/fsx.js'
import { createLogger } from '../lib/logger.js'
import { ffmpeg, probe } from '../lib/proc.js'

const log = createLogger('audio')

/** whisper.cpp exige exactamente esto. No es una preferencia. */
export const WHISPER_SAMPLE_RATE = 16_000
export const WHISPER_CHANNELS = 1

/**
 * Extrae el audio en el formato que whisper.cpp requiere: PCM 16 bits,
 * 16 kHz, mono.
 *
 * Pasarle cualquier otra cosa degrada la transcripcion en vez de fallar de
 * forma visible, que es peor: el resultado parece correcto y no lo es.
 */
export async function extractAudio(sourceId: string, videoPath: string): Promise<string> {
  const target = join(workDir(sourceId), 'audio.wav')

  if (hasContent(target, 16_000)) {
    const info = await probe(target).catch(() => null)
    const stream = info?.streams.find((s) => s.codec_type === 'audio')
    const rate = Number(stream?.['sample_rate'] ?? 0)
    const channels = Number(stream?.['channels'] ?? 0)

    if (rate === WHISPER_SAMPLE_RATE && channels === WHISPER_CHANNELS) {
      log.info(`Audio ya extraido, se omite (${fileSizeMb(target).toFixed(1)} MB)`)
      return target
    }
    log.warn(`El audio existente es ${rate} Hz / ${channels} canal(es). Se regenera.`)
  }

  log.info('Extrayendo audio a 16 kHz mono...')
  const { durationMs } = await ffmpeg([
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-ac',
    String(WHISPER_CHANNELS),
    '-ar',
    String(WHISPER_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    target,
  ])

  log.info(`Audio listo en ${(durationMs / 1000).toFixed(1)} s (${fileSizeMb(target).toFixed(1)} MB)`)
  return target
}

/**
 * Filtro de realce de voz para canciones (Fase 6), en lugar de Demucs.
 *
 * Quita graves (bombo y bajo, por debajo de 150 Hz) y agudos por encima de
 * 5 kHz (platos), reduce ruido de fondo y nivela el volumen. No separa la voz
 * como una red neuronal, pero deja a whisper lo que mas le importa: la banda
 * donde esta la letra. Medido en la literatura de whisper: con la base a todo
 * volumen alucina menos si se le recorta el bajo.
 */
export const FILTRO_VOZ = 'highpass=f=150,lowpass=f=5000,afftdn=nf=-25,dynaudnorm=f=150:g=15'

/**
 * Copia de audio.wav con la voz realzada, para transcribir una cancion. El
 * original se queda: el analisis de energia (src/select/musica.ts) necesita
 * la mezcla entera, bombo incluido.
 */
export async function realzarVoz(sourceId: string, audioPath: string): Promise<string> {
  const target = join(workDir(sourceId), 'audio-voz.wav')
  if (hasContent(target, 16_000)) return target
  log.info('Realzando la voz de la canción antes de transcribir...')
  await ffmpeg([
    '-y',
    '-i',
    audioPath,
    '-af',
    FILTRO_VOZ,
    '-ac',
    String(WHISPER_CHANNELS),
    '-ar',
    String(WHISPER_SAMPLE_RATE),
    '-c:a',
    'pcm_s16le',
    target,
  ])
  return target
}
