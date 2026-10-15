import { spawn } from 'node:child_process'
import { bin } from './env.js'

/**
 * Error de proceso externo que conserva el stderr completo.
 *
 * Esto es el motivo de que exista este modulo. Un fallo de filtergraph de ffmpeg
 * es indescifrable si solo se reporta el codigo de salida: el mensaje util
 * ("No such filter", "Invalid argument", el caracter exacto donde rompio el
 * parser) vive en stderr. Perderlo cuesta horas.
 */
export class ProcessError extends Error {
  constructor(
    readonly bin: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    const reason = signal !== null ? `señal ${signal}` : `codigo ${exitCode}`
    super(
      [
        `El proceso fallo con ${reason}: ${bin}`,
        '',
        'Argumentos:',
        args.map((a) => `  ${a}`).join('\n'),
        '',
        'stderr:',
        stderr.trim() === '' ? '  (vacio)' : stderr,
      ].join('\n'),
    )
    this.name = 'ProcessError'
  }
}

/** Limite de stderr. ffmpeg puede emitir megabytes de lineas de progreso. */
const STDERR_LIMIT = 512 * 1024

/** Limite de stdout. Solo existe para que un proceso desbocado no agote la RAM. */
const STDOUT_LIMIT = 32 * 1024 * 1024

export class OutputTooLargeError extends Error {
  constructor(command: string, bytes: number) {
    super(
      `El proceso "${command}" emitio mas de ${bytes} caracteres por stdout. ` +
        'Se aborta en lugar de truncar: stdout se trata como datos y truncarlo ' +
        'produciria una salida corrupta que parece valida.',
    )
    this.name = 'OutputTooLargeError'
  }
}

/**
 * Acumulador de stderr que conserva el principio y el final.
 *
 * Se guardan ambos extremos a proposito: los errores de configuracion de
 * filtros aparecen al principio y los de encode al final. Quedarse solo con la
 * cola perderia los primeros; solo con la cabeza, los segundos.
 *
 * Truncar aqui es seguro porque stderr es diagnostico. NO uses esto para
 * stdout: ver LosslessBuffer.
 */
class BoundedBuffer {
  private head = ''
  private tail = ''
  private truncated = 0

  push(chunk: string): void {
    if (this.head.length < STDERR_LIMIT / 2) {
      this.head += chunk
      return
    }
    this.tail += chunk
    if (this.tail.length > STDERR_LIMIT / 2) {
      const excess = this.tail.length - STDERR_LIMIT / 2
      this.tail = this.tail.slice(excess)
      this.truncated += excess
    }
  }

  toString(): string {
    if (this.truncated === 0) return this.head + this.tail
    return `${this.head}\n[... ${this.truncated} caracteres omitidos ...]\n${this.tail}`
  }
}

/**
 * Acumulador de stdout que nunca trunca en silencio.
 *
 * Existe por un fallo real: la version anterior usaba el buffer acotado para
 * ambos flujos. Al pedir metadatos de un video largo, yt-dlp emitio mas de
 * medio megabyte de JSON, el buffer inserto su marcador de truncado en mitad de
 * una cadena, y `JSON.parse` fallo con "Bad control character in string literal
 * at position 262144", exactamente el punto de corte.
 *
 * La leccion es la que aplica esta clase: truncar datos produce una salida que
 * parece valida y no lo es. Si se excede el limite, se lanza.
 */
class LosslessBuffer {
  private chunks: string[] = []
  private length = 0

  constructor(private readonly command: string) {}

  push(chunk: string): void {
    this.length += chunk.length
    if (this.length > STDOUT_LIMIT) {
      throw new OutputTooLargeError(this.command, STDOUT_LIMIT)
    }
    this.chunks.push(chunk)
  }

  toString(): string {
    return this.chunks.join('')
  }
}

export interface RunOptions {
  cwd?: string
  /** Recibe cada fragmento de stderr en vivo. Util para progreso. */
  onStderr?: (chunk: string) => void
  /** Milisegundos antes de matar el proceso. Sin limite por defecto. */
  timeoutMs?: number
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

/**
 * Ejecuta un binario con argumentos como array.
 *
 * Sin shell, a proposito. En Windows las rutas de los binarios contienen
 * espacios y los filtergraphs contienen comillas, comas y dos puntos. Pasar eso
 * por un shell obliga a un quoting fragil que rompe de formas dificiles de
 * diagnosticar. Con shell:false el array llega intacto al proceso.
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = performance.now()

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdout = new LosslessBuffer(command)
    const stderr = new BoundedBuffer()

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      try {
        stdout.push(chunk)
      } catch (error) {
        child.kill('SIGKILL')
        rejectPromise(error)
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr.push(chunk)
      options.onStderr?.(chunk)
    })

    let timer: NodeJS.Timeout | undefined
    let timedOut = false
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, options.timeoutMs)
    }

    child.on('error', (error) => {
      if (timer !== undefined) clearTimeout(timer)
      rejectPromise(
        new Error(
          `No se pudo ejecutar "${command}": ${error.message}. ` +
            'Verifica la ruta del binario en .env.',
          { cause: error },
        ),
      )
    })

    child.on('close', (code, signal) => {
      if (timer !== undefined) clearTimeout(timer)
      const durationMs = performance.now() - startedAt

      if (timedOut) {
        rejectPromise(
          new Error(`El proceso "${command}" excedio el limite de ${options.timeoutMs} ms.`),
        )
        return
      }

      if (code !== 0) {
        rejectPromise(
          new ProcessError(command, args, code, signal, stdout.toString(), stderr.toString()),
        )
        return
      }

      resolvePromise({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: code,
        durationMs,
      })
    })
  })
}

/** Argumentos que preceden a toda invocacion de ffmpeg. */
const FFMPEG_BASE_ARGS = [
  '-hide_banner',
  // Sin esto ffmpeg puede quedarse esperando entrada al preguntar si sobrescribe.
  '-nostdin',
  '-loglevel',
  'info',
] as const

export function ffmpeg(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return run(bin.ffmpeg, [...FFMPEG_BASE_ARGS, ...args], options)
}

export function ffprobe(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return run(bin.ffprobe, ['-hide_banner', ...args], options)
}

export function ytdlp(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return run(bin.ytdlp, args, options)
}

export interface ProbeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  duration?: string
  [key: string]: unknown
}

export interface ProbeResult {
  streams: ProbeStream[]
  format: {
    duration?: string
    size?: string
    format_name?: string
    [key: string]: unknown
  }
}

/** Inspecciona un archivo multimedia y devuelve el JSON de ffprobe ya parseado. */
export async function probe(filePath: string): Promise<ProbeResult> {
  const { stdout } = await ffprobe([
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ])
  return JSON.parse(stdout) as ProbeResult
}
