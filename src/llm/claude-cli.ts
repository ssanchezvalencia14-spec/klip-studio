import { spawn } from 'node:child_process'
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '../lib/logger.js'
import { clasificarSalidaCli, ErrorIA, mensajeIA } from './errores.js'

const log = createLogger('claude-cli')

/**
 * Claude Code en modo no interactivo, con la sesion de la suscripcion.
 *
 *   claude -p --output-format json --model <m> --tools "" ...
 *
 * Banderas comprobadas con `claude --help` en la version 2.1.299. Si cambian en
 * otra version, este es el unico sitio que hay que tocar.
 *
 * TRES COSAS QUE NO SON NEGOCIABLES:
 *
 * 1. Se borran del entorno del hijo todas las variables ANTHROPIC_* y las de
 *    una sesion de Claude Code que lo lance (CLAUDECODE, CLAUDE_CODE_*). Con una
 *    ANTHROPIC_API_KEY presente el CLI la usa en lugar de la suscripcion, y una
 *    clave vieja en las variables de Windows es la causa probable del 401.
 *
 * 2. Sin herramientas (`--tools ""`), sin MCP, sin hooks ni CLAUDE.md
 *    (`--safe-mode`), sin permisos que pedir y en una carpeta temporal vacia.
 *    El CLI solo puede devolver texto: no lee ni escribe nada del ordenador.
 *
 * 3. El prompt va por la entrada estandar. En Windows la linea de comandos se
 *    corta en 32.767 caracteres y una transcripcion de una hora son cientos de
 *    miles.
 */

export interface OpcionesCli {
  /** Ruta del ejecutable. Un .js/.mjs se lanza con este mismo Node (pruebas, instalacion por npm). */
  ruta: string
  modelo: string
  sistema: string
  usuario: string
  timeoutMs: number
}

export interface RespuestaCli {
  texto: string
  ms: number
  /** Lo que el CLI dice que uso. Para el registro, no para cobrar. */
  modelos: string[]
}

/** Variables que no pueden llegar al CLI. */
export function entornoLimpio(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const limpio: NodeJS.ProcessEnv = {}
  for (const [clave, valor] of Object.entries(env)) {
    if (/^ANTHROPIC_/i.test(clave)) continue
    if (/^CLAUDECODE$|^CLAUDE_CODE_|^CLAUDE_AGENT_SDK|^CLAUDE_PID$|^CLAUDE_PREVIEW/i.test(clave)) continue
    limpio[clave] = valor
  }
  return limpio
}

export function argumentosCli(modelo: string, sistema: string): string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--model', modelo,
    '--tools', '',
    '--max-turns', '1',
    '--safe-mode',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--permission-prompts', 'none',
    '--system-prompt', sistema,
  ]
}

/** Mata al hijo y a lo que haya lanzado. En Windows no hay grupos de proceso. */
function matar(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try { process.kill(pid, 'SIGKILL') } catch { /* ya no existe */ }
  }
}

interface SalidaJson {
  type?: string
  is_error?: boolean
  result?: string
  api_error_status?: number | null
  modelUsage?: Record<string, unknown>
}

/** Una llamada. Sin cola: para eso esta `llamarClaude`. */
async function llamarUnaVez(o: OpcionesCli): Promise<RespuestaCli> {
  const inicio = Date.now()
  // Carpeta vacia y propia: aunque algo fallara en las banderas, ahi no hay
  // nada que leer ni un CLAUDE.md que cargar.
  const cwd = mkdtempSync(join(tmpdir(), 'klip-ia-'))

  const esScript = /\.(c|m)?js$/i.test(o.ruta)
  const comando = esScript ? process.execPath : o.ruta
  const args = [...(esScript ? [o.ruta] : []), ...argumentosCli(o.modelo, o.sistema)]

  try {
    const { codigo, stdout, stderr, agotado } = await new Promise<{
      codigo: number | null
      stdout: string
      stderr: string
      agotado: boolean
    }>((resolve, reject) => {
      const hijo = spawn(comando, args, {
        cwd,
        env: entornoLimpio(),
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      let out = ''
      let err = ''
      let agotado = false
      hijo.stdout.setEncoding('utf8')
      hijo.stderr.setEncoding('utf8')
      hijo.stdout.on('data', (c: string) => { out += c })
      hijo.stderr.on('data', (c: string) => { if (err.length < 20_000) err += c })

      const reloj = setTimeout(() => {
        agotado = true
        matar(hijo.pid)
      }, o.timeoutMs)

      hijo.on('error', (e: NodeJS.ErrnoException) => {
        clearTimeout(reloj)
        if (e.code === 'ENOENT') reject(new ErrorIA('no_encontrado', mensajeIA('no_encontrado'), undefined, e.message))
        else reject(e)
      })
      hijo.on('close', (codigo) => {
        clearTimeout(reloj)
        resolve({ codigo, stdout: out, stderr: err, agotado })
      })

      // Un EPIPE si el hijo muere antes de leer no debe tumbar el proceso.
      hijo.stdin.on('error', () => {})
      hijo.stdin.end(o.usuario, 'utf8')
    })

    if (agotado) {
      throw new ErrorIA('tiempo', mensajeIA('tiempo'), undefined, `sin respuesta en ${o.timeoutMs} ms`)
    }

    let json: SalidaJson | null = null
    try {
      json = JSON.parse(stdout) as SalidaJson
    } catch {
      json = null
    }

    if (json === null || typeof json.result !== 'string') {
      // Sin JSON: el CLI fallo antes de empezar. El motivo esta en stderr.
      throw clasificarSalidaCli(`${stderr}\n${stdout}`.trim() || `codigo ${codigo}`)
    }

    if (json.is_error === true || codigo !== 0) {
      throw clasificarSalidaCli(json.result, json.api_error_status)
    }

    return {
      texto: json.result,
      ms: Date.now() - inicio,
      modelos: Object.keys(json.modelUsage ?? {}),
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

// --- Una llamada a la vez ------------------------------------------------------
//
// Dentro del proceso, una cadena de promesas. Entre procesos (dos tareas o dos
// trabajadores en la misma maquina), un fichero de cerrojo en la carpeta
// temporal: la suscripcion es una sola y dos llamadas a la vez solo adelantan
// el limite.

let cola: Promise<unknown> = Promise.resolve()

const CERROJO = join(tmpdir(), 'klip-ia.lock')

function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function cogerCerrojo(maxEsperaMs: number): Promise<() => void> {
  const hasta = Date.now() + maxEsperaMs
  for (;;) {
    try {
      const fd = openSync(CERROJO, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(CERROJO) } catch { /* ya no estaba */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      // Un cerrojo de un proceso muerto, o mas viejo que la espera maxima, no
      // cuenta: si no, un corte de luz dejaria la IA bloqueada para siempre.
      try {
        const pid = Number(readFileSync(CERROJO, 'utf8'))
        const edad = Date.now() - statSync(CERROJO).mtimeMs
        if (!Number.isFinite(pid) || !procesoVivo(pid) || edad > maxEsperaMs) {
          unlinkSync(CERROJO)
          continue
        }
      } catch {
        continue
      }
      if (Date.now() > hasta) {
        throw new ErrorIA('tiempo', mensajeIA('tiempo'), undefined, 'otra llamada a la IA no termino')
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

export function llamarClaude(o: OpcionesCli): Promise<RespuestaCli> {
  const turno = cola.then(async () => {
    const soltar = await cogerCerrojo(o.timeoutMs + 30_000)
    try {
      log.info(`Llamada a ${o.modelo} (${Math.round(o.usuario.length / 1000)}k caracteres)`)
      return await llamarUnaVez(o)
    } finally {
      soltar()
    }
  })
  // La cola sigue aunque esta llamada falle.
  cola = turno.catch(() => {})
  return turno
}
