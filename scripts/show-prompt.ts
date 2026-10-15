/**
 * Muestra el prompt exacto que recibe el modelo para una ventana.
 *
 *   npm run show-prompt -- <sourceId> [--window 0]
 *
 * Sirve para revisar a ojo lo que se le esta pidiendo, sin gastar una llamada
 * ni esperar a que un modelo responda. Cuando la seleccion falla, lo primero es
 * mirar que se envio.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv } from '../src/lib/env.js'
import { readJson, workDir } from '../src/lib/fsx.js'
import { buildWindowPrompt } from '../src/select/prompt.js'
import { buildWindows } from '../src/select/window.js'
import type { Transcript } from '../src/types.js'

function main(): void {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      window: { type: 'string', default: '0' },
      lines: { type: 'string', default: '30' },
      full: { type: 'boolean', default: false },
    },
  })

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run show-prompt -- <sourceId> [--window 0] [--full]')
    process.exitCode = 1
    return
  }

  const path = join(workDir(sourceId), 'transcript.json')
  if (!existsSync(path)) {
    console.error(`No existe ${path}.`)
    process.exitCode = 1
    return
  }

  const transcript = readJson<Transcript>(path)
  const windows = buildWindows(transcript)
  const window = windows[Number(values.window)]

  if (window === undefined) {
    console.error(`Solo hay ${windows.length} ventanas (0-${windows.length - 1}).`)
    process.exitCode = 1
    return
  }

  const prompt = buildWindowPrompt({
    window,
    maxClips: 3,
    minDurationSec: 25,
    maxDurationSec: 75,
    sourceTitle: sourceId,
    totalDurationSec: transcript.durationSec,
  })

  const lines = prompt.split('\n')
  console.log('')

  if (values.full) {
    console.log(prompt)
  } else {
    const head = Number(values.lines)
    console.log(lines.slice(0, head).join('\n'))
    if (lines.length > head) {
      console.log(`\n  ... ${lines.length - head} lineas mas (usa --full para verlas) ...\n`)
      console.log(lines.slice(-3).join('\n'))
    }
  }

  console.log('')
  console.log('-'.repeat(70))
  console.log(
    `ventana ${window.index} | ${window.segments.length} lineas | ` +
      `${lines.length} lineas de prompt | ~${Math.round(prompt.length / 3.5).toLocaleString()} tokens`,
  )
}

main()
