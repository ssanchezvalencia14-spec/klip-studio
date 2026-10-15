import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Raiz del proyecto, resuelta desde la ubicacion de este archivo. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Parser propio de .env, deliberadamente simple.
 *
 * No procesa secuencias de escape. Es intencional: los valores de este proyecto
 * son rutas absolutas de Windows y un parser que interprete escapes convertiria
 * `C:\Users\...` en basura silenciosamente (`\U` es una secuencia valida en
 * varias implementaciones). Aqui el valor se toma literal.
 */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    if (key === '') continue

    let value = line.slice(eq + 1).trim()

    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    if (quoted) value = value.slice(1, -1)

    out[key] = value
  }

  return out
}

let loaded = false

/** Carga .env en process.env. Las variables ya definidas en el entorno ganan. */
export function loadEnv(): void {
  if (loaded) return
  loaded = true

  const envPath = resolve(ROOT, '.env')
  if (!existsSync(envPath)) return

  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

/** Lee una variable obligatoria. Lanza con un mensaje accionable si falta. */
export function requireEnv(name: string): string {
  loadEnv()
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env y completala.`,
    )
  }
  return value
}

/** Lee una variable opcional. Devuelve undefined si esta ausente o vacia. */
export function optionalEnv(name: string): string | undefined {
  loadEnv()
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? undefined : value
}

/** Resuelve una ruta relativa contra la raiz del proyecto. Las absolutas pasan tal cual. */
export function fromRoot(pathish: string): string {
  return isAbsolute(pathish) ? pathish : resolve(ROOT, pathish)
}

/** Rutas de binarios externos, fijadas por .env y nunca por el PATH. */
export const bin = {
  get ffmpeg(): string {
    return requireEnv('FFMPEG_PATH')
  },
  get ffprobe(): string {
    return requireEnv('FFPROBE_PATH')
  },
  get ytdlp(): string {
    return requireEnv('YTDLP_PATH')
  },
}

export const paths = {
  get whisperModel(): string {
    return fromRoot(requireEnv('WHISPER_MODEL_PATH'))
  },
  get whisperVadModel(): string | undefined {
    const raw = optionalEnv('WHISPER_VAD_MODEL_PATH')
    return raw === undefined ? undefined : fromRoot(raw)
  },
  get work(): string {
    return fromRoot(optionalEnv('WORK_DIR') ?? 'work')
  },
  get out(): string {
    return fromRoot(optionalEnv('OUT_DIR') ?? 'out')
  },
}
