/**
 * Fase 2: transcript.json -> clips.json
 *
 *   npm run select -- <sourceId> [--max-per-window 3] [--min 20] [--max 90]
 *                                [--window 900] [--overlap 120]
 */
import Anthropic from '@anthropic-ai/sdk'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv } from '../src/lib/env.js'
import { readJson, workDir } from '../src/lib/fsx.js'
import { formatDuration } from '../src/lib/logger.js'
import { beginRun } from '../src/store/runs.js'
import { selectClips } from '../src/select/select.js'
import type { SourceMeta, Transcript } from '../src/types.js'

function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

async function main(): Promise<void> {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'max-per-window': { type: 'string', default: '3' },
      min: { type: 'string', default: '20' },
      max: { type: 'string', default: '90' },
      window: { type: 'string' },
      overlap: { type: 'string' },
      // Procesa solo las N primeras ventanas. Iterar sobre el prompt con las 7
      // cuesta mas de una hora en local; con una, diez minutos.
      'max-windows': { type: 'string' },
    },
  })

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run select -- <sourceId> [--max-per-window 3] [--min 20] [--max 90]')
    process.exit(1)
  }

  const dir = workDir(sourceId)
  const transcriptPath = join(dir, 'transcript.json')

  if (!existsSync(transcriptPath)) {
    console.error(`A ${sourceId} le falta el texto de lo que se dice.`)
    console.error('Vuelve a añadirlo desde Inicio: la descarga saca el texto sola.')
    process.exit(1)
  }

  const transcript = readJson<Transcript>(transcriptPath)

  let title = sourceId
  const metaPath = join(dir, 'source.json')
  if (existsSync(metaPath)) {
    title = readJson<SourceMeta>(metaPath).title
  }

  const run = beginRun('select', sourceId, `Elegir momentos de ${title}`)

  let result
  try {
    result = await selectClips(transcript, {
      maxClipsPerWindow: Number(values['max-per-window']),
      minDurationSec: Number(values.min),
      maxDurationSec: Number(values.max),
      sourceTitle: title,
      ...(values.window !== undefined ? { windowSec: Number(values.window) } : {}),
      ...(values.overlap !== undefined ? { overlapSec: Number(values.overlap) } : {}),
      ...(values['max-windows'] !== undefined ? { maxWindows: Number(values['max-windows']) } : {}),
    })
  } catch (error) {
    // Una pasada fallida tambien se anota: saber que el paso mas caro se rompio
    // tres veces seguidas importa tanto como saber cuanto costo cuando funciono.
    run.fail(error)
    throw error
  }

  run.finish({
    input: {
      segmentos: transcript.segments.length,
      minutos: Math.round(transcript.durationSec / 60),
      ventanas: result.windows,
    },
    output: { clips: result.clips.length },
    tokens: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
    costUsd: result.usage.estimatedUsd ?? 0,
  })

  console.log('')
  console.log('='.repeat(78))
  console.log(`Fuente    : ${title}`)
  console.log(`Ventanas  : ${result.windows}`)
  console.log(`Clips     : ${result.clips.length}`)
  if (result.fallidas > 0) console.log(`Ventanas fallidas: ${result.fallidas} de ${result.windows}`)
  console.log(
    `Tokens    : ${result.usage.inputTokens.toLocaleString()} entrada / ` +
      `${result.usage.outputTokens.toLocaleString()} salida`,
  )
  console.log(
    `Coste est.: ${
      result.usage.estimatedUsd === null
        ? 'modelo sin precio en la tabla'
        : `$${result.usage.estimatedUsd.toFixed(4)}`
    }`,
  )
  console.log(`Tiempo    : ${formatDuration(result.elapsedMs)}`)
  console.log('='.repeat(78))

  /*
   * Si NINGUNA ventana respondio, esto es un fallo, no un VOD sin momentos.
   *
   * Las dos cosas producian cero clips y salida 0, asi que desde el panel se
   * leian igual: tarea 'listo' y ni un clip. El 2026-10-01 fue por saldo
   * agotado en la API, y el motivo solo se veia abriendo el registro.
   *
   * Se distingue de 'respondio y no encontro nada', que si es un resultado
   * legitimo y sigue saliendo con exito.
   */
  /*
   * O fallaron todas, O se corto en seco por un motivo que iba a repetirse.
   *
   * La segunda mitad hay que ponerla explicita: desde que el bucle corta al
   * primer fallo definitivo, `fallidas` vale 1 y `windows` 3, asi que la
   * igualdad de la izquierda ya no se cumple. Sin esto, un VOD con la clave
   * rechazada terminaba en EXITO con cero clips -- peor que el fallo
   * original, porque nadie mira un trabajo que salio bien.
   */
  const noSePudoPreguntar =
    result.motivoCorte !== undefined || (result.fallidas === result.windows && result.windows > 0)
  if (noSePudoPreguntar) {
    console.error('')
    /*
     * La salida se nombra por su boton, no por su comando.
     *
     * Decia "npm run momentos -- <id>", y esa era ademas la ULTIMA linea del
     * trabajo, o sea justo la que el panel enseña en la tarjeta de error. El
     * resultado: un panel que al fallar te mandaba a abrir una terminal. El
     * atajo es ahora un boton en la ficha del video.
     */
    console.error('Ninguna ventana llego a responder: no es que el video no diera para clips,')
    console.error('es que no se pudo preguntar.')
    console.error('')
    /*
     * El motivo concreto, si se supo, en lugar de "mira el registro".
     *
     * El registro esta justo encima, si, pero lleva una linea por ventana con
     * el JSON crudo del proveedor. La frase que dice QUE hacer tiene que
     * estar al final, que es donde mira quien pulso el boton.
     */
    if (result.motivoCorte !== undefined) {
      console.error(result.motivoCorte.mensaje)
    } else {
      console.error('Mira el registro de arriba para ver el motivo.')
      console.error('Si fue por saldo de la API y el video es musica, en su ficha tienes el')
      console.error('boton "Es musica: buscar estribillos", que no gasta saldo.')
    }
    process.exitCode = 1
    return
  }

  for (const [i, clip] of result.clips.entries()) {
    console.log('')
    console.log(
      `${String(i + 1).padStart(2)}. [${formatTimestamp(clip.start)} -> ${formatTimestamp(clip.end)}] ` +
        `${(clip.end - clip.start).toFixed(0)}s  score=${clip.score}`,
    )
    console.log(`    gancho : ${clip.hook}`)
    console.log(`    razon  : ${clip.reason}`)
    console.log(`    caption: ${clip.caption}`)
    console.log(`    tags   : ${clip.hashtags.join(', ')}`)
  }
}

/**
 * Traduce los fallos de la API a algo accionable.
 *
 * Sin esto, quedarse sin saldo produce cuarenta lineas de volcado de pila del
 * SDK que entierran la unica frase que importa. Se usan las clases tipadas del
 * SDK en vez de comparar textos de error, que cambian sin aviso.
 */
function explain(error: unknown): string | null {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'La clave de ANTHROPIC_API_KEY no es valida o fue revocada. Genera una nueva en platform.claude.com.'
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'La clave no tiene permiso para este modelo. Revisa SELECT_MODEL en .env y los permisos de la clave.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Limite de peticiones alcanzado. Espera unos minutos y reintenta; el trabajo ya hecho no se pierde.'
  }
  if (error instanceof Anthropic.BadRequestError) {
    const message = error.message
    if (message.includes('credit balance')) {
      return [
        'La cuenta no tiene saldo para llamar a la API.',
        '',
        'La clave autentica correctamente, pero ejecutar inferencia requiere credito.',
        'Añade saldo en platform.claude.com, seccion Plans & Billing, y reintenta.',
        '',
        'Nota: el consumo de la API es independiente de cualquier suscripcion de',
        'Claude.ai o Claude Code. Son bolsas de credito separadas.',
      ].join('\n')
    }
    return `Peticion invalida: ${message}`
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'No se pudo conectar con la API. Revisa la conexion a internet.'
  }
  return null
}

try {
  await main()
} catch (error) {
  const explanation = explain(error)
  if (explanation === null) throw error

  console.error('')
  console.error('='.repeat(78))
  console.error(explanation)
  console.error('='.repeat(78))

  // Se marca el codigo de salida en lugar de llamar a process.exit(). Con
  // sockets del SDK todavia abiertos, exit() aborta libuv y añade un
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" que no significa
  // nada y tapa el mensaje util de arriba.
  process.exitCode = 1
}
