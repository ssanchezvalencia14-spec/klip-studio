/**
 * Fase 1 de punta a punta: URL o archivo local -> transcript.json
 *
 *   npm run ingest -- <url|ruta> [--lang es] [--queue 30] [--force]
 */
import { existsSync } from 'node:fs'
import { copyFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { extractAudio } from '../src/ingest/audio.js'
import { downloadSource, esBloqueoYoutube, fetchMetadata } from '../src/ingest/download.js'
import { SALIDA_NO_REINTENTAR } from '../src/jobs/reintentos.js'
import { isKickVod, metadataFromKick } from '../src/ingest/kick.js'
import { metadataFromFile } from '../src/ingest/local.js'
import { loadEnv } from '../src/lib/env.js'
import { workDir, writeJson } from '../src/lib/fsx.js'
import { createLogger, formatDuration } from '../src/lib/logger.js'
import { beginRun } from '../src/store/runs.js'
import { parseTranscript, speechCoverage } from '../src/transcribe/parse.js'
import { DEFAULT_QUEUE_SECONDS, transcribeAudio } from '../src/transcribe/whisper.js'

const log = createLogger('ingest-cli')

/**
 * Deja un archivo local donde el resto de la tuberia espera encontrarlo.
 *
 * Sin esto, un video subido desde el panel se transcribia bien y luego el
 * render fallaba con "No existe work/<id>/source.mp4": la ruta de descarga
 * escribe ahi el video y el source.json, pero la ruta local se los saltaba
 * entera. El fallo aparecia dos pasos mas tarde, sin relacion aparente.
 *
 * Se MUEVE lo que venga de _uploads, porque esa carpeta es solo un deposito
 * temporal del panel y dejar ahi una copia de 63 MB no sirve de nada. Lo que
 * venga de cualquier otro sitio se COPIA: es un archivo del usuario y no somos
 * quien para moverlo de su carpeta.
 */
async function adoptLocalFile(meta: { id: string; url: string }): Promise<string> {
  const destino = join(workDir(meta.id), 'source.mp4')

  if (existsSync(destino)) {
    log.info(`El video ya estaba en su sitio: ${destino}`)
  } else if (meta.url.replace(/\\/g, '/').includes('/work/_uploads/')) {
    await rename(meta.url, destino)
    log.info(`Video movido desde la carpeta de subidas: ${destino}`)
  } else {
    await copyFile(meta.url, destino)
    log.info(`Video copiado (el original se queda donde estaba): ${destino}`)
  }

  // El source.json lo escribia solo la ruta de descarga. Sin el, el panel
  // enseña el identificador crudo en vez del nombre del video.
  writeJson(join(workDir(meta.id), 'source.json'), { ...meta, url: destino })

  return destino
}

async function main(): Promise<void> {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      lang: { type: 'string', default: 'auto' },
      queue: { type: 'string', default: String(DEFAULT_QUEUE_SECONDS) },
      force: { type: 'boolean', default: false },
      vad: { type: 'boolean', default: false },
      /*
       * La campaña a la que asignar el VOD. Se acepta y NO se usa aqui.
       *
       * Quien la aplica es publicarResultado, que lee los argumentos del
       * trabajo cuando termina: ese es el primer instante en que existe el
       * sourceId al que colgarla. Hay que declararla igualmente porque
       * parseArgs rechaza las opciones que no conoce, y sin esto la tarea
       * moriria nada mas arrancar.
       */
      campana: { type: 'string' },
      /*
       * Video musical. Tampoco se usa aqui: lo lee el encadenado al terminar
       * para buscar estribillos (momentos) en vez de preguntar a la IA.
       */
      musica: { type: 'boolean', default: false },
    },
  })

  const input = positionals[0]
  if (input === undefined) {
    console.error('Uso: npm run ingest -- <url|ruta> [--lang es] [--queue 30] [--force]')
    process.exit(1)
  }

  const queueSeconds = Number(values.queue)
  if (!Number.isFinite(queueSeconds) || queueSeconds < 0.02 || queueSeconds > 3600) {
    console.error('--queue debe estar entre 0.02 y 3600 segundos.')
    process.exit(1)
  }

  const startedAt = performance.now()

  // Un archivo local se usa donde esta; solo una URL pasa por yt-dlp.
  const isLocalFile = existsSync(input)
  const run = beginRun('ingest', null, isLocalFile ? 'Transcribir archivo local' : 'Descargar y transcribir')

  let meta
  let transcript
  try {
    // Kick necesita su propio resolutor: el extractor de yt-dlp esta roto para
    // los VOD nuevos. Ver src/ingest/kick.ts.
    meta = isLocalFile
      ? await metadataFromFile(input)
      : isKickVod(input)
        ? await metadataFromKick(input)
        : await fetchMetadata(input)

    const videoPath = isLocalFile ? await adoptLocalFile(meta) : await downloadSource(meta)

    const audioPath = await extractAudio(meta.id, videoPath)
    const rawPath = await transcribeAudio(meta.id, audioPath, {
      language: values.lang,
      queueSeconds,
      force: values.force,
      useVad: values.vad,
    })
    transcript = parseTranscript(meta.id, rawPath, meta.durationSec, values.lang)
  } catch (error) {
    run.fail(error)
    const texto = error instanceof Error ? `${error.message}\n${(error as { stderr?: string }).stderr ?? ''}` : String(error)
    /*
     * Fallos que no se arreglan reintentando: se explican y se sale con
     * SALIDA_NO_REINTENTAR para que el trabajador no insista. La frase va la
     * ultima porque es la que enseña el panel en la tarjeta del video.
     */
    if (esBloqueoYoutube(texto)) {
      // La linea de yt-dlp que lo dice, para el registro completo.
      console.error(texto.split('\n').find((l) => l.includes('ERROR:')) ?? '')
      console.log('YouTube bloqueó la descarga. Sube el MP4 directamente o configura las cookies.')
      process.exitCode = SALIDA_NO_REINTENTAR
      return
    }
    if (/no devolvio duracion|is_live|live event will begin/i.test(texto)) {
      console.log('Es un directo en curso. Añádelo cuando termine, o sube la grabación en MP4.')
      process.exitCode = SALIDA_NO_REINTENTAR
      return
    }
    throw error
  }

  const elapsed = performance.now() - startedAt
  const speedup = (meta.durationSec * 1000) / elapsed

  run.finish({
    input: {
      origen: isLocalFile ? 'archivo local' : 'URL',
      minutos: Math.round(meta.durationSec / 60),
    },
    output: {
      segmentos: transcript.segments.length,
      cobertura: `${(speechCoverage(transcript) * 100).toFixed(1)}%`,
      velocidad: `${speedup.toFixed(1)}x`,
    },
  })

  console.log('')
  console.log('='.repeat(72))
  console.log(`Fuente     : ${meta.title}`)
  console.log(`sourceId   : ${meta.id}`)
  console.log(`Duracion   : ${formatDuration(meta.durationSec * 1000)}`)
  console.log(`Segmentos  : ${transcript.segments.length}`)
  console.log(`Cobertura  : ${(speechCoverage(transcript) * 100).toFixed(1)}% del audio con voz`)
  console.log(`Tiempos/pal: ${transcript.hasWordTimestamps ? 'si' : 'no (solo segmentos)'}`)
  console.log(`Proceso    : ${formatDuration(elapsed)} (${speedup.toFixed(1)}x tiempo real)`)
  console.log(`Salida     : ${workDir(meta.id)}`)
  console.log('='.repeat(72))
  console.log('')
  console.log('Primeros 15 segmentos:')
  for (const segment of transcript.segments.slice(0, 15)) {
    const stamp = `${segment.start.toFixed(1).padStart(7)}s -> ${segment.end.toFixed(1).padStart(7)}s`
    console.log(`  ${stamp}  ${segment.text}`)
  }
}

await main()
