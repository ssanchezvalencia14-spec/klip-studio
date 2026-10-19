// Un Claude Code falso, para las pruebas de la IA (scripts/verify-ia.ts).
//
// Imita la salida de `claude -p --output-format json` de la version 2.1.299:
// un objeto con `type: "result"`, `is_error` y `result`. Lo que responde sale
// de un fichero de guion (KLIP_FALSO_GUION), una respuesta por llamada, en
// orden. Lo que recibio lo apunta en KLIP_FALSO_REGISTRO, una linea JSON por
// llamada, para que la prueba compruebe el entorno, las banderas y el stdin.
//
// Pasos del guion:
//   { "texto": "..." }            responde bien con ese texto
//   { "error": "...", "status": n } responde con is_error (sin sesion, limite)
//   { "dormir": ms, "texto": "..." } tarda antes de responder
//   { "crudo": "...", "codigo": n } escribe eso tal cual y sale con ese codigo
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const guion = process.env.KLIP_FALSO_GUION
const registro = process.env.KLIP_FALSO_REGISTRO

let entrada = ''
process.stdin.setEncoding('utf8')
for await (const trozo of process.stdin) entrada += trozo

const inicio = Date.now()

let pasos = []
let n = 0
if (guion && existsSync(guion)) {
  pasos = JSON.parse(readFileSync(guion, 'utf8'))
  const contador = guion + '.n'
  n = existsSync(contador) ? Number(readFileSync(contador, 'utf8')) : 0
  writeFileSync(contador, String(n + 1))
}
const paso = pasos[n] ?? { texto: '{"momentos":[]}' }

if (paso.dormir) await new Promise((r) => setTimeout(r, paso.dormir))

if (registro) {
  appendFileSync(registro, JSON.stringify({
    n,
    inicio,
    fin: Date.now(),
    args: process.argv.slice(2),
    cwd: process.cwd(),
    stdinLargo: entrada.length,
    stdinEmpieza: entrada.slice(0, 60),
    tieneClaveApi: process.env.ANTHROPIC_API_KEY !== undefined,
    tieneAnthropic: Object.keys(process.env).some((k) => k.startsWith('ANTHROPIC_')),
    tieneClaudeCode: Object.keys(process.env).some((k) => k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')),
  }) + '\n')
}

if (paso.crudo !== undefined) {
  process.stdout.write(paso.crudo)
  process.exit(paso.codigo ?? 1)
}

const base = { type: 'result', subtype: 'success', num_turns: 1, modelUsage: { 'claude-falso': {} } }
if (paso.error !== undefined) {
  process.stdout.write(JSON.stringify({ ...base, is_error: true, result: paso.error, api_error_status: paso.status ?? null }))
  process.exit(1)
}
process.stdout.write(JSON.stringify({ ...base, is_error: false, result: paso.texto }))
