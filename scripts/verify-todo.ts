/**
 * Todas las pruebas de una vez (Fase 8).
 *
 *   npm test
 *
 * Lanza cada `verify:*` en su propio proceso, en serie (varias arrancan un
 * panel o una base en memoria), y resume. Dos tipos de prueba no pueden
 * correr en cualquier PC, y se marcan OMITIDA en vez de FALLO, diciendo por
 * que:
 *
 * - las que hablan con la base real (necesitan DATABASE_URL);
 * - verify:jobs, que usa `doctor` como tarea lenta y sin ffmpeg acaba al
 *   instante, antes de que la prueba pueda ver la cola.
 *
 * Sale con 1 si alguna falla de verdad.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { bin, loadEnv, optionalEnv, ROOT } from '../src/lib/env.js'

loadEnv()

const SUITES = [
  'texto', 'reparto', 'select', 'ia', 'schema', 'ajustes', 'cola', 'procesador', 'acceso',
  'panel', 'publish', 'publicar', 'uploadpost', 'tiktok', 'metrics', 'nube',
  'fase5', 'fase6', 'fase7', 'fase8', 'e2e', 'jobs', 'db', 'proyectos', 'produccion',
]
const CON_BASE_REAL = new Set(['db', 'proyectos', 'produccion'])

const hayFfmpeg = spawnSync(bin.ffmpeg, ['-version'], { encoding: 'utf8' }).status === 0
const hayBase = optionalEnv('DATABASE_URL') !== undefined

const tsx = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const filas: { suite: string; estado: 'OK' | 'FALLO' | 'OMITIDA'; detalle: string; ms: number }[] = []

for (const suite of SUITES) {
  if (CON_BASE_REAL.has(suite) && !hayBase) {
    filas.push({ suite, estado: 'OMITIDA', detalle: 'necesita DATABASE_URL (base real)', ms: 0 })
    continue
  }
  if (suite === 'jobs' && !hayFfmpeg) {
    filas.push({ suite, estado: 'OMITIDA', detalle: 'necesita ffmpeg (usa doctor como tarea lenta)', ms: 0 })
    continue
  }
  const inicio = Date.now()
  const r = spawnSync(process.execPath, [tsx, join(ROOT, 'scripts', `verify-${suite}.ts`)], {
    cwd: ROOT, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024,
  })
  const salida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const cuenta = /(\d+)\s*(?:\/|de)\s*(\d+)\s+comprobaciones/.exec(salida)
  const total = cuenta ? `${cuenta[1]}/${cuenta[2]}` : ''
  const ok = r.status === 0 && (cuenta === null || cuenta[1] === cuenta[2])
  filas.push({
    suite,
    estado: ok ? 'OK' : 'FALLO',
    detalle: ok ? total : total || (salida.trim().split('\n').at(-1) ?? '').slice(0, 120),
    ms: Date.now() - inicio,
  })
  console.log(`  ${ok ? 'OK     ' : 'FALLO  '} ${suite.padEnd(11)} ${filas.at(-1)!.detalle}`)
}

for (const f of filas.filter((x) => x.estado === 'OMITIDA')) console.log(`  OMITIDA ${f.suite.padEnd(11)} ${f.detalle}`)

const fallos = filas.filter((f) => f.estado === 'FALLO')
const ok = filas.filter((f) => f.estado === 'OK').length
console.log(`\n${ok} suites pasan, ${fallos.length} fallan, ${filas.length - ok - fallos.length} omitidas.`)
process.exit(fallos.length > 0 ? 1 : 0)
