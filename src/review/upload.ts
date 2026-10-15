import { createWriteStream } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage } from 'node:http'
import { paths } from '../lib/env.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('upload')

/**
 * Subida de un VOD local desde el panel.
 *
 * El cuerpo de la peticion es el fichero en crudo, no multipart. Es deliberado:
 * multipart obligaria a escribir un parser propio (el proyecto no tiene
 * dependencias de produccion mas alla del SDK y zod) para resolver un problema
 * que aqui no existe. Multipart sirve para enviar varios campos a la vez desde
 * un formulario; aqui el unico cliente es esta misma pagina y solo manda un
 * archivo. El nombre viaja en una cabecera.
 *
 * Se escribe segun llega, sin acumular en memoria. Un VOD de 87 minutos ronda
 * los 900 MB: cargarlo entero antes de escribirlo tumbaria el proceso.
 */

/** Tope por archivo. Cuatro gigas cubren un stream largo en buena calidad. */
const MAX_BYTES = 4 * 1024 * 1024 * 1024

const ALLOWED = new Set(['mp4', 'mov', 'mkv', 'webm', 'm4v'])

export class UploadError extends Error {}

/** Deja el nombre en algo seguro de concatenar a una ruta. */
function safeName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? 'video'
  const cleaned = base
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)

  const dot = cleaned.lastIndexOf('.')
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned
  const ext = dot > 0 ? cleaned.slice(dot + 1).toLowerCase() : ''

  if (!ALLOWED.has(ext)) {
    throw new UploadError(`Formato no admitido: .${ext || 'sin extension'}`)
  }
  return `${stem || 'video'}.${ext}`
}

export interface StoredUpload {
  path: string
  name: string
  bytes: number
}

/**
 * Guarda el cuerpo de la peticion en disco y devuelve la ruta absoluta.
 *
 * Ante cualquier fallo borra el archivo a medias. Un MP4 truncado es peor que
 * ninguno: yt-dlp lo ignoraria, pero ffmpeg lo acepta y produciria una
 * transcripcion incompleta sin avisar de nada.
 */
export async function storeUpload(req: IncomingMessage): Promise<StoredUpload> {
  const header = req.headers['x-file-name']
  const raw = Array.isArray(header) ? header[0] : header
  if (raw === undefined || raw === '') {
    throw new UploadError('Falta el nombre del archivo.')
  }

  // Rechazo temprano cuando el cliente declara un tamaño imposible: asi no se
  // empieza a escribir para nada. NO es el limite de verdad, ver mas abajo.
  const declared = Number(req.headers['content-length'] ?? 0)
  if (declared > MAX_BYTES) {
    throw new UploadError(`El archivo supera el limite de ${MAX_BYTES / 1024 ** 3} GB.`)
  }

  const name = safeName(decodeURIComponent(raw))
  const dir = join(paths.work, '_uploads')
  await mkdir(dir, { recursive: true })

  // Prefijo temporal para que un proceso que mire el directorio no confunda
  // una subida a medias con un archivo listo.
  const target = join(dir, name)
  const partial = `${target}.parcial`

  /*
   * El limite se cuenta sobre lo que llega de verdad, no sobre lo que el
   * cliente dijo que iba a mandar.
   *
   * Comprobar solo content-length no sirve de nada: con codificacion por
   * trozos esa cabecera no existe, `Number(undefined ?? 0)` da 0 y el tope se
   * salta entero. Probado contra el panel: 30 MB escritos a disco sin declarar
   * tamaño. Sin este corte, una peticion puede llenar el disco.
   */
  let written = 0
  let excedido = false

  req.on('data', (chunk: Buffer) => {
    written += chunk.length
    if (written > MAX_BYTES && !excedido) {
      excedido = true
      // destroy() aborta la peticion, lo que hace fallar el pipeline y entra
      // por el catch de abajo, que ya borra el archivo a medias.
      req.destroy(new Error('limite de tamaño superado'))
    }
  })

  try {
    await pipeline(req, createWriteStream(partial))
  } catch (error) {
    await unlink(partial).catch(() => {})
    if (excedido) {
      throw new UploadError(
        `El archivo supera el limite de ${MAX_BYTES / 1024 ** 3} GB y se corto la subida.`,
      )
    }
    throw new UploadError(
      `La subida se corto a los ${(written / 1024 ** 2).toFixed(0)} MB: ${(error as Error).message}`,
    )
  }

  if (written === 0) {
    await unlink(partial).catch(() => {})
    throw new UploadError('El archivo llego vacio.')
  }

  // Se renombra al final: hasta aqui no habia nada que otro proceso pudiera
  // coger por error.
  await rename(partial, target)

  log.info(`subido ${name} (${(written / 1024 ** 2).toFixed(0)} MB)`)
  return { path: target, name, bytes: written }
}
