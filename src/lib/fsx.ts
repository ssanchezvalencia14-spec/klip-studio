import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { paths } from './env.js'

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Directorio de trabajo de un VOD. Todas las etapas escriben aqui. */
export function workDir(sourceId: string): string {
  return ensureDir(join(paths.work, sourceId))
}

/**
 * Escritura atomica: se escribe a un temporal y se renombra.
 *
 * Sin esto, una interrupcion a mitad de escritura deja un archivo truncado que
 * la logica de reanudacion daria por valido en la siguiente ejecucion.
 */
export function writeJson(filePath: string, value: unknown): void {
  ensureDir(dirname(filePath))
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

/** Verdadero si el archivo existe y supera un tamaño minimo plausible. */
export function hasContent(filePath: string, minBytes = 1024): boolean {
  return existsSync(filePath) && statSync(filePath).size >= minBytes
}

export function fileSizeMb(filePath: string): number {
  return statSync(filePath).size / 1024 / 1024
}

/**
 * Prepara una ruta para incrustarla en un filtergraph de ffmpeg.
 *
 * Comprobado empiricamente en ffmpeg 8.1.1 sobre Windows:
 *   - `C:/ruta`   falla, los dos puntos separan opciones del filtro
 *   - `C\:/ruta`  falla igual, un solo escape no sobrevive al parser
 *   - `C\\:/ruta` FUNCIONA
 *
 * El parser aplica dos pasadas de desescapado, asi que el backslash debe ir
 * duplicado. Las barras invertidas se convierten a barras normales porque en
 * filtergraph la barra invertida es el caracter de escape.
 */
export function toFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\\\:')
}
