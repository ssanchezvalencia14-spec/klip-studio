/**
 * Verificacion del entorno.
 *
 * Comprueba que todo lo que el pipeline da por sentado existe realmente en esta
 * maquina. Se ejecuta antes de cada fase nueva y despues de cualquier cambio en
 * el sistema, porque la instalacion de una herramienta puede desplazar a otra en
 * el PATH sin avisar.
 */
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { bin, loadEnv, optionalEnv, paths, ROOT } from '../src/lib/env.js'
import { ffmpeg, ffprobe, run, ytdlp } from '../src/lib/proc.js'
import { crearNube, CUBO } from '../src/store/nube.js'

interface Check {
  name: string
  ok: boolean
  detail: string
  /** Un fallo bloquea el pipeline. Un aviso no. */
  blocking: boolean
}

const checks: Check[] = []

function record(name: string, ok: boolean, detail: string, blocking = true): void {
  checks.push({ name, ok, detail, blocking })
}

async function safe(name: string, blocking: boolean, fn: () => Promise<string>): Promise<void> {
  try {
    record(name, true, await fn(), blocking)
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error)
    record(name, false, message, blocking)
  }
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

async function main(): Promise<void> {
  loadEnv()

  console.log(`\nRaiz del proyecto: ${ROOT}\n`)

  // --- Runtime ---------------------------------------------------------------
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  record('Node.js >= 24', major >= 24, `v${process.versions.node}`)

  record(
    'Archivo .env',
    existsSync(join(ROOT, '.env')),
    existsSync(join(ROOT, '.env')) ? 'presente' : 'ausente: copia .env.example a .env',
  )

  // --- Binarios --------------------------------------------------------------
  for (const [label, getter] of [
    ['ffmpeg', () => bin.ffmpeg],
    ['ffprobe', () => bin.ffprobe],
    ['yt-dlp', () => bin.ytdlp],
  ] as const) {
    let resolved: string
    try {
      resolved = getter()
    } catch (error) {
      record(`Ruta de ${label}`, false, error instanceof Error ? error.message : String(error))
      continue
    }
    // Sin ruta fija se usa el del PATH: lo comprueba la version de mas abajo.
    record(
      `Ruta de ${label}`,
      !isAbsolute(resolved) || existsSync(resolved),
      !isAbsolute(resolved) ? `del PATH (${resolved})` : existsSync(resolved) ? resolved : `no existe: ${resolved}`,
    )
  }

  await safe('Version de ffmpeg', true, async () => {
    const { stdout, stderr } = await ffmpeg(['-version'])
    const first = `${stdout}${stderr}`.split('\n')[0]?.trim() ?? ''
    return first.replace(/^ffmpeg version /, '')
  })

  await safe('Version de ffprobe', true, async () => {
    const { stdout, stderr } = await ffprobe(['-version'])
    const first = `${stdout}${stderr}`.split('\n')[0]?.trim() ?? ''
    return first.replace(/^ffprobe version /, '')
  })

  await safe('Version de yt-dlp', true, async () => (await ytdlp(['--version'])).stdout.trim())

  // --- Capacidades de ffmpeg -------------------------------------------------
  // Se consultan una vez y se reutilizan: cada invocacion cuesta un proceso.
  let encodersText = ''
  let filtersText = ''

  await safe('Listado de encoders', true, async () => {
    encodersText = (await ffmpeg(['-encoders'])).stdout
    return `${encodersText.split('\n').length} lineas`
  })

  await safe('Listado de filtros', true, async () => {
    filtersText = (await ffmpeg(['-filters'])).stdout
    return `${filtersText.split('\n').length} lineas`
  })

  const requiredEncoders = ['h264_nvenc', 'hevc_nvenc']
  for (const encoder of requiredEncoders) {
    record(
      `Encoder ${encoder}`,
      new RegExp(`\\b${encoder}\\b`).test(encodersText),
      new RegExp(`\\b${encoder}\\b`).test(encodersText) ? 'disponible' : 'AUSENTE',
    )
  }

  // El filtro whisper es el que sostiene la decision de no usar Python.
  // Si desaparece, el diseno del proyecto cambia, no es un detalle menor.
  const requiredFilters = ['whisper', 'ass', 'subtitles', 'loudnorm', 'gblur', 'crop', 'overlay']
  for (const filter of requiredFilters) {
    const present = new RegExp(`\\s${filter}\\s`).test(filtersText)
    record(`Filtro ${filter}`, present, present ? 'disponible' : 'AUSENTE')
  }

  await safe('Opciones del filtro whisper', true, async () => {
    const { stdout, stderr } = await ffmpeg(['-h', 'filter=whisper'])
    const text = `${stdout}${stderr}`
    const expected = ['model', 'use_gpu', 'format', 'destination', 'max_len']
    const missing = expected.filter((option) => !text.includes(option))
    if (missing.length > 0) throw new Error(`faltan opciones: ${missing.join(', ')}`)
    return `model, use_gpu, format, destination, max_len presentes`
  })

  // --- Modelo ----------------------------------------------------------------
  try {
    const modelPath = paths.whisperModel
    if (existsSync(modelPath)) {
      const size = statSync(modelPath).size
      record('Modelo whisper ggml', size > 100 * 1024 * 1024, `${formatMb(size)} en ${modelPath}`)
    } else {
      record('Modelo whisper ggml', false, `no existe: ${modelPath}`)
    }
  } catch (error) {
    record('Modelo whisper ggml', false, error instanceof Error ? error.message : String(error))
  }

  const vad = paths.whisperVadModel
  record(
    'Modelo VAD (opcional)',
    vad === undefined || existsSync(vad),
    vad === undefined ? 'no configurado' : vad,
    false,
  )

  // --- API de Anthropic (Fase 2) ---------------------------------------------
  //
  // Se hacen DOS comprobaciones, y la distincion importa.
  //
  // `models.retrieve` es un endpoint gratuito: confirma que la clave autentica,
  // pero NO que la cuenta pueda ejecutar inferencia. Una cuenta sin saldo pasa
  // esa prueba y luego falla con 400 en la primera llamada real. Ocurrio en este
  // proyecto: el doctor daba verde y la Fase 2 moria en la primera ventana.
  //
  // Por eso la segunda comprobacion envia un mensaje minimo de verdad. Cuesta
  // una fraccion de centimo y es la unica forma de saber que el pipeline puede
  // correr antes de lanzarlo.
  const apiKey = optionalEnv('ANTHROPIC_API_KEY')
  const model = optionalEnv('SELECT_MODEL') ?? 'claude-opus-5-5'

  if (apiKey === undefined) {
    record('ANTHROPIC_API_KEY', false, 'no configurada (necesaria desde la Fase 2)', false)
  } else {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })

    await safe('Clave autentica', false, async () => {
      const info = await client.models.retrieve(model)
      const context =
        info.max_input_tokens === null || info.max_input_tokens === undefined
          ? 'desconocido'
          : `${info.max_input_tokens.toLocaleString()} tokens`
      return `${info.id} | contexto ${context}`
    })

    await safe('Cuenta puede inferir', false, async () => {
      const response = await client.messages.create({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ok' }],
      })
      return `si | ${response.usage.input_tokens} tokens de entrada facturados`
    })
  }

  /*
   * --- Copias de revision en la nube (Fase 7) --------------------------------
   *
   * No bloquea: sin nube el pipeline sigue funcionando entero, solo que los
   * clips hay que revisarlos sentado delante de este ordenador.
   *
   * Se comprueba contra el servicio de verdad y no solo que la variable exista,
   * porque una clave copiada a medias o de otro proyecto solo se manifestaria
   * al subir el primer video, que es despues de haber recodificado treinta.
   */
  const nube = crearNube()
  if (nube === null) {
    record(
      'Copias en la nube',
      false,
      'sin SUPABASE_SERVICE_ROLE_KEY: no se podran revisar los videos desde el movil',
      false,
    )
  } else {
    await safe('Copias en la nube', false, async () => {
      const estado = await nube.asegurarCubo()
      return `${nube.url} | cubo "${CUBO}": ${estado}`
    })
  }

  // --- GPU -------------------------------------------------------------------
  await safe('GPU NVIDIA', false, async () => {
    const { stdout } = await run('nvidia-smi', [
      '--query-gpu=name,memory.total,driver_version',
      '--format=csv,noheader',
    ])
    return stdout.trim()
  })

  // --- Reporte ---------------------------------------------------------------
  const nameWidth = Math.max(...checks.map((c) => c.name.length))
  console.log(`${'CHECK'.padEnd(nameWidth)}  ESTADO  DETALLE`)
  console.log(`${'-'.repeat(nameWidth)}  ------  ${'-'.repeat(40)}`)

  for (const check of checks) {
    const status = check.ok ? '  OK  ' : check.blocking ? ' FALLO' : ' AVISO'
    console.log(`${check.name.padEnd(nameWidth)}  ${status}  ${check.detail}`)
  }

  const failed = checks.filter((c) => !c.ok && c.blocking)
  const warned = checks.filter((c) => !c.ok && !c.blocking)

  console.log('')
  if (failed.length === 0) {
    console.log(
      `Todo en orden: ${checks.length - warned.length} verificaciones correctas` +
        (warned.length > 0 ? `, ${warned.length} aviso(s) no bloqueante(s).` : '.'),
    )
    process.exit(0)
  }

  console.log(`${failed.length} verificacion(es) bloqueante(s) fallaron:`)
  for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`)
  process.exit(1)
}

await main()
