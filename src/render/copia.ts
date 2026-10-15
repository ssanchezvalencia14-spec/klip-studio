import { statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDir, workDir } from '../lib/fsx.js'
import { createLogger } from '../lib/logger.js'
import { ffmpeg } from '../lib/proc.js'

const log = createLogger('copia')

/**
 * La copia de revision de un clip.
 *
 * Sirve para verla en el movil y decidir si el clip vale. El master no se toca:
 * se queda en este ordenador, que es de donde se publica.
 *
 * MISMA RESOLUCION QUE EL MASTER, A PROPOSITO. La primera version bajaba a
 * 540x960 con CRF 30 para ahorrar espacio, y eso creo un problema peor que el
 * que resolvia: al revisar desde el panel se veia una copia con 23 veces menos
 * tasa de bits que el fichero que se entrega, y era imposible juzgar la calidad
 * real. Se confundia "la copia esta comprimida" con "el clip esta mal".
 *
 * Ahora lo que se revisa se parece a lo que se entrega. Medido sobre un clip
 * real de 70 s:
 *
 *     master    1080x1920 NVENC CQ21   22,4 MB
 *     copia     1080x1920 x264 CRF23    6,8 MB   3,3 veces menos, 6,4 s
 *     (antes)    540x960  x264 CRF30    1,5 MB   pero ilegible para juzgar
 *
 * El espacio sigue cuadrando: el plan gratuito son 1024 MB y un clip medio pesa
 * unos 4 MB, asi que caben unos 250. Si algun dia estorba, bajar ANCHO a 720
 * los deja en 3,5 MB sin tocar nada mas.
 */

/** Ancho de la copia. La altura se deriva para no deformar. */
const ANCHO = 1080

/**
 * Calidad constante, no tasa de bits fija.
 *
 * Con tasa fija, un clip quieto desperdicia bits y uno con mucho movimiento se
 * deshace. CRF 23 es la frontera donde la compresion deja de verse en un movil;
 * por encima aparecen bloques justo en las caras, que es lo que hay que poder
 * juzgar.
 */
const CRF = 23

/** x264 y no NVENC a proposito. */
const PRESET = 'veryfast'

export interface CopiaResult {
  path: string
  bytes: number
  elapsedMs: number
}

/**
 * Codifica la copia de revision de un clip ya renderizado.
 *
 * Se usa x264 por CPU y no NVENC aunque haya GPU: a esta resolucion el
 * codificador por software tarda dos segundos y medio, y dejar la GPU libre
 * permite que el subidor corra mientras se renderiza otro VOD. Ademas x264 a
 * CRF alto comprime bastante mejor que NVENC, que es justo lo que se busca.
 */
export async function crearCopia(
  masterPath: string,
  sourceId: string,
  clipId: string,
): Promise<CopiaResult> {
  const startedAt = performance.now()

  const dir = ensureDir(join(workDir(sourceId), 'copias'))
  const target = join(dir, `${clipId}.mp4`)

  await ffmpeg([
    '-y',
    '-i',
    masterPath,
    '-vf',
    // -2 fuerza altura par, que h264 exige.
    `scale=${ANCHO}:-2`,
    '-c:v',
    'libx264',
    '-preset',
    PRESET,
    '-crf',
    String(CRF),
    // main y no high: algun navegador de movil viejo no decodifica high.
    '-profile:v',
    'main',
    '-pix_fmt',
    'yuv420p',
    /*
     * El indice al principio del fichero.
     *
     * Sin esto el navegador tiene que descargar el MP4 entero antes de pintar
     * el primer fotograma, porque la tabla de posiciones va al final. Sobre
     * una conexion de movil eso son varios segundos por clip, en una pantalla
     * cuyo trabajo es pasar treinta seguidos.
     */
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    /*
     * 128k y no 64k.
     *
     * A 64 kbps mono la voz se entiende, pero la musica de fondo y los golpes
     * de ambiente se deshacen, y parte de lo que se juzga al revisar un clip es
     * como suena. El audio pesa una fraccion de lo que pesa el video.
     */
    '-b:a',
    '128k',
    // Mono: es voz, y el estereo aqui solo dobla el audio sin aportar nada.
    '-ac',
    '1',
    target,
  ])

  const bytes = statSync(target).size
  const elapsedMs = performance.now() - startedAt

  log.info(`${clipId}: ${(bytes / 1048576).toFixed(2)} MB en ${(elapsedMs / 1000).toFixed(1)}s`)

  return { path: target, bytes, elapsedMs }
}
