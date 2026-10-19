import { join } from 'node:path'
import { optionalEnv, paths } from '../lib/env.js'
import { ensureDir, fileSizeMb, toFilterPath, workDir } from '../lib/fsx.js'
import { createLogger, formatDuration } from '../lib/logger.js'
import { ffmpeg, probe } from '../lib/proc.js'
import type { Transcript } from '../types.js'
import { buildAss, PLAY_RES_X, PLAY_RES_Y, type AssOptions } from './ass.js'
import { argsCalidadVideo, bitrateAudio } from './calidad.js'

const log = createLogger('render')

/** Especificaciones que TikTok exige. Se comprueban tras renderizar. */
export const TIKTOK_LIMITS = {
  minDurationSec: 3,
  maxDurationSec: 600,
  minSide: 360,
  minFps: 23,
  maxFps: 60,
  maxBytes: 1024 * 1024 * 1024,
} as const

export interface RenderClip {
  start: number
  end: number
  caption?: string
}

/**
 * Filtergraph de reencuadre 9:16 con fondo desenfocado.
 *
 * Se usa fondo desenfocado en lugar de recortar el centro porque recortar
 * decapita al hablante en cuanto no esta perfectamente centrado, que es casi
 * siempre en un podcast a dos camaras. El desenfoque nunca falla, es una sola
 * pasada, y es el aspecto estandar de los clips de stream.
 *
 * El seguimiento de cara daria un encuadre mejor, pero multiplica la
 * complejidad y no se aborda hasta saber si los clips convierten.
 */
/** Donde va el fotograma limpio de un clip: al lado del MP4, en .jpg. */
export function rutaFotograma(clipMp4: string): string {
  return clipMp4.replace(/\.mp4$/i, '') + '.fotograma.jpg'
}

export function buildFilterGraph(assPath: string | null, blurSigma: number): string {
  // Sin subtitulos, la salida del overlay YA ES la final. Dejarla como [v1] y
  // no encadenar nada mas dejaria el filtergraph sin [vout] y ffmpeg fallaria
  // al mapear, asi que el nombre de la ultima etiqueta depende de si hay
  // pasada de subtitulos o no.
  const ultima = assPath === null ? 'vout' : 'v1'

  const partes = [
    // Se duplica la entrada: una copia para el fondo, otra para el primer plano.
    '[0:v]split=2[bg][fg]',
    // Fondo: se agranda hasta cubrir 1080x1920, se recorta y se desenfoca.
    `[bg]scale=${PLAY_RES_X}:${PLAY_RES_Y}:force_original_aspect_ratio=increase,` +
      `crop=${PLAY_RES_X}:${PLAY_RES_Y},gblur=sigma=${blurSigma}[bgb]`,
    // Primer plano: al ancho completo. -2 mantiene la relacion y fuerza altura par,
    // que el encoder h264 exige.
    `[fg]scale=${PLAY_RES_X}:-2[fgs]`,
    // Centrado sobre el fondo.
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2[${ultima}]`,
  ]

  // Subtitulos quemados. La ruta va escapada: los dos puntos de "C:" separan
  // opciones dentro del filtergraph.
  if (assPath !== null) partes.push(`[v1]ass=${toFilterPath(assPath)}[vout]`)

  return partes.join(';')
}

export interface RenderResult {
  path: string
  durationSec: number
  width: number
  height: number
  fps: number
  sizeMb: number
  subtitleCount: number
  elapsedMs: number
}

/** Valida el resultado contra las specs de TikTok. Falla ruidosamente. */
async function validateAgainstTikTok(filePath: string): Promise<Omit<RenderResult, 'path' | 'subtitleCount' | 'elapsedMs'>> {
  const info = await probe(filePath)
  const video = info.streams.find((s) => s.codec_type === 'video')
  const audio = info.streams.find((s) => s.codec_type === 'audio')

  if (video === undefined) throw new Error(`${filePath} no tiene pista de video.`)
  if (audio === undefined) throw new Error(`${filePath} no tiene pista de audio.`)

  const durationSec = Number(info.format.duration ?? 0)
  const width = video.width ?? 0
  const height = video.height ?? 0

  const [num, den] = (video.r_frame_rate ?? '0/1').split('/')
  const fps = Number(num) / Number(den ?? 1)

  const sizeBytes = Number(info.format.size ?? 0)

  const problems: string[] = []
  if (durationSec < TIKTOK_LIMITS.minDurationSec || durationSec > TIKTOK_LIMITS.maxDurationSec) {
    problems.push(`duracion ${durationSec.toFixed(1)}s fuera de [3, 600]`)
  }
  if (width < TIKTOK_LIMITS.minSide || height < TIKTOK_LIMITS.minSide) {
    problems.push(`resolucion ${width}x${height}, minimo 360 por lado`)
  }
  if (fps < TIKTOK_LIMITS.minFps || fps > TIKTOK_LIMITS.maxFps) {
    problems.push(`${fps.toFixed(2)} fps fuera de [23, 60]`)
  }
  if (sizeBytes > TIKTOK_LIMITS.maxBytes) {
    problems.push(`${(sizeBytes / 1024 / 1024).toFixed(0)} MB, maximo 1 GB`)
  }
  if (video.codec_name !== 'h264') {
    problems.push(`codec de video ${video.codec_name}, se esperaba h264`)
  }
  if (audio.codec_name !== 'aac') {
    problems.push(`codec de audio ${audio.codec_name}, se esperaba aac`)
  }

  if (problems.length > 0) {
    throw new Error(`El render no cumple las specs de TikTok:\n  - ${problems.join('\n  - ')}`)
  }

  return { durationSec, width, height, fps, sizeMb: sizeBytes / 1024 / 1024 }
}

export interface RenderOptions {
  blurSigma?: number
  /** Calidad NVENC: menor es mejor. 21 es un buen punto para 1080x1920. */
  cq?: number
  preset?: string
  /**
   * Quemar los subtitulos. Por defecto si.
   *
   * Apagarlos casi siempre es un error en TikTok, donde la mayoria mira sin
   * sonido, pero es una decision del usuario y no del programa.
   */
  subtitles?: boolean
  /** Estilo de los subtitulos. Se pasa tal cual a buildAss. */
  sub?: AssOptions
  /*
   * PLANTILLA del rotulo de titulo, no el rotulo ya hecho.
   *
   * Llega aqui con {titulo} dentro porque el texto cambia en cada clip: es el
   * pie que el modelo propuso para ESE momento. El estilo (altura, cuerpo,
   * colores) si es comun y viaja en `sub`, que es donde acaba todo lo que va
   * al fichero .ass.
   */
  rotulo?: string
}

/** Renderiza un clip vertical, con subtitulos quemados salvo que se apaguen. */
export async function renderClip(
  transcript: Transcript,
  sourceVideo: string,
  clip: RenderClip,
  index: number,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const startedAt = performance.now()

  const outDir = ensureDir(join(paths.out, transcript.sourceId))
  const target = join(outDir, `clip-${String(index).padStart(2, '0')}.mp4`)

  // Sin subtitulos no se escribe el .ass siquiera: generarlo para no usarlo
  // deja ficheros huerfanos en el directorio de trabajo que luego confunden al
  // depurar ("hay subtitulos, por que no salen").
  const conSubs = options.subtitles ?? true

  /*
   * El rotulo de titulo se resuelve aqui, clip a clip.
   *
   * La plantilla es comun a todo el VOD; lo que cambia es el pie. Si el clip
   * no trae pie, el rotulo se queda vacio y buildAss no lo pinta: mejor sin
   * rotulo que con la plantilla cruda y un hueco donde iba el texto.
   */
  const rotulo = (options.rotulo ?? '').includes('{titulo}')
    ? (options.rotulo ?? '').replaceAll('{titulo}', clip.caption ?? '').trim()
    : ''
  const conRotulo = rotulo !== '' && (clip.caption ?? '') !== ''

  /*
   * Hay fichero .ass si hay subtitulos O rotulo.
   *
   * Antes solo lo habia con subtitulos. Con el rotulo encendido y los
   * subtitulos apagados -- que es una combinacion razonable: un clip limpio
   * con una frase arriba -- no se escribia nada y el rotulo desaparecia sin
   * decir por que.
   */
  const assPath =
    conSubs || conRotulo
      ? join(workDir(transcript.sourceId), `clip-${String(index).padStart(2, '0')}.ass`)
      : null
  const subtitleCount =
    assPath === null
      ? 0
      : buildAss(
          // Sin subtitulos, el .ass se escribe solo para el rotulo: no se le
          // pasa ningun segmento y de ahi no sale ningun Dialogue de habla.
          conSubs ? transcript.segments : [],
          clip.start,
          clip.end,
          assPath,
          { ...(options.sub ?? {}), ...(conRotulo ? { titulo: rotulo } : {}) },
        )

  const duration = clip.end - clip.start
  const blurSigma = options.blurSigma ?? Number(optionalEnv('BLUR_SIGMA') ?? '30')
  const cq = options.cq ?? Number(optionalEnv('NVENC_CQ') ?? '24')
  const preset = options.preset ?? optionalEnv('NVENC_PRESET') ?? 'p6'

  log.info(
    `Clip ${index}: ${clip.start.toFixed(1)}s -> ${clip.end.toFixed(1)}s ` +
      `(${duration.toFixed(1)}s, ${subtitleCount} subtitulos)`,
  )

  await ffmpeg([
    '-y',
    // -ss antes de -i hace la busqueda rapida; con re-encode ffmpeg decodifica
    // desde el keyframe previo y descarta, asi que el corte sale al frame.
    '-ss',
    clip.start.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-i',
    sourceVideo,
    '-filter_complex',
    buildFilterGraph(assPath, blurSigma),
    '-map',
    '[vout]',
    '-map',
    '0:a:0',
    // Normalizacion de sonoridad EBU R128. -14 LUFS es lo habitual en
    // plataformas sociales; sin esto unos clips suenan mucho mas bajos que otros.
    '-af',
    'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-c:v',
    'h264_nvenc',
    '-preset',
    preset,
    '-tune',
    'hq',
    // Calidad y techo de bitrate: ver src/render/calidad.ts.
    ...argsCalidadVideo(cq),
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    bitrateAudio(),
    '-ar',
    '44100',
    '-ac',
    '2',
    // Mueve el indice al principio para que empiece a reproducirse sin descargar
    // el archivo entero.
    '-movflags',
    '+faststart',
    target,
  ])

  const validated = await validateAgainstTikTok(target)

  /*
   * Un fotograma limpio, sin subtitulos ni rotulo (Fase 5).
   *
   * La vista previa de Estilo pinta encima los subtitulos con los ajustes del
   * momento. Sobre el clip ya armado saldrian dos veces (los quemados y los de
   * la vista previa), y sin nada salia un rectangulo negro. Este fotograma es
   * el encuadre real del video, a 540x960. Si falla no pasa nada: el clip ya
   * esta hecho.
   */
  try {
    await ffmpeg([
      '-y',
      '-ss',
      (clip.start + Math.min(1.5, duration / 2)).toFixed(3),
      '-i',
      sourceVideo,
      '-filter_complex',
      buildFilterGraph(null, blurSigma) + ';[vout]scale=540:960[foto]',
      '-map',
      '[foto]',
      '-frames:v',
      '1',
      '-q:v',
      '4',
      rutaFotograma(target),
    ])
  } catch (error) {
    log.warn(`No se pudo sacar el fotograma del clip ${index}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }

  const elapsedMs = performance.now() - startedAt

  log.info(
    `Clip ${index} listo: ${validated.width}x${validated.height} @ ${validated.fps.toFixed(2)} fps, ` +
      `${fileSizeMb(target).toFixed(1)} MB, en ${formatDuration(elapsedMs)}`,
  )

  return { path: target, ...validated, subtitleCount, elapsedMs }
}

/**
 * Genera una hoja de contactos con un frame de cada clip.
 *
 * Sirve para revisar el encuadre de todos los clips de un vistazo, en lugar de
 * abrir uno por uno.
 */
export async function buildContactSheet(clipPaths: string[], outputPath: string): Promise<void> {
  if (clipPaths.length === 0) return

  const first = clipPaths[0]
  if (first === undefined) return

  // hstack exige dos entradas como minimo; con un solo clip basta con extraer
  // el frame directamente.
  if (clipPaths.length === 1) {
    await ffmpeg([
      '-y',
      '-i',
      first,
      '-vf',
      'select=eq(n\\,60),scale=270:480,setsar=1',
      '-frames:v',
      '1',
      outputPath,
    ])
    log.info(`Hoja de contactos: ${outputPath}`)
    return
  }

  const args: string[] = ['-y']
  for (const path of clipPaths) {
    args.push('-i', path)
  }

  // Un frame fijo por clip (el 60, cerca del segundo 1) en lugar de un
  // porcentaje: evita fundidos de entrada y da una muestra comparable.
  const selects = clipPaths
    .map((_, i) => `[${i}:v]select=eq(n\\,60),scale=270:480,setsar=1[t${i}]`)
    .join(';')
  const inputs = clipPaths.map((_, i) => `[t${i}]`).join('')

  args.push(
    '-filter_complex',
    `${selects};${inputs}hstack=inputs=${clipPaths.length}[out]`,
    '-map',
    '[out]',
    '-frames:v',
    '1',
    outputPath,
  )

  await ffmpeg(args)
  log.info(`Hoja de contactos: ${outputPath}`)
}
