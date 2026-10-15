/**
 * Verificacion del ejecutor de trabajos.
 *
 *   npm run verify:jobs
 *
 * Comprueba lo que decide si el panel es usable: que un trabajo largo se lance
 * sin bloquear, que el progreso llegue linea a linea, que dos peticiones a la
 * vez se encolen en vez de pelearse por la GPU, y que cancelar mate de verdad
 * el proceso. Todo con comandos reales del proyecto, sin simulacros.
 */
import { activeJob, cancelJob, getJob, listJobs, startJob, subscribe } from '../src/jobs/runner.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Espera a que el trabajo salga de en curso, con tope para no colgarse. */
async function esperarFin(id: string, topeMs: number): Promise<void> {
  const limite = Date.now() + topeMs
  for (;;) {
    const job = getJob(id)
    if (job === undefined) return
    if (job.status !== 'running' && job.status !== 'queued') return
    if (Date.now() > limite) return
    await espera(100)
  }
}

// --- Un trabajo corto de principio a fin -------------------------------------
{
  const eventos: string[] = []
  const off = subscribe((j) => eventos.push(j.status))

  // `doctor` sirve de conejillo: es real, no toca nada y tarda unos segundos.
  const job = startJob({ kind: 'doctor', args: [] })

  // Devuelve mientras el proceso vive, no cuando termina. Si no hay nada en
  // marcha arranca en el acto y sale ya en 'running'; con la GPU ocupada sale
  // en 'queued'. Lo que NO puede es volver con el trabajo ya acabado.
  check(
    'Devuelve el control sin esperar al final',
    job.status === 'queued' || job.status === 'running',
    `estado al volver: ${job.status}`,
  )
  check('Asigna identificador', /^[0-9a-f]{8}$/.test(job.id), job.id)

  await esperarFin(job.id, 120_000)
  off()

  const fin = getJob(job.id)
  check(
    'El trabajo termina y se registra',
    fin?.status === 'ok' || fin?.status === 'error',
    `estado ${fin?.status} codigo ${fin?.exitCode}`,
  )
  check('Captura la salida linea a linea', (fin?.lines.length ?? 0) > 5, `${fin?.lines.length} lineas`)
  check('Publica cambios de estado', eventos.includes('running'), eventos.slice(0, 4).join(' -> '))
  check('Deja de estar activo al acabar', activeJob() === null, String(activeJob()))
}

// --- Dos a la vez se encolan, no compiten ------------------------------------
{
  const a = startJob({ kind: 'doctor', args: [] })
  const b = startJob({ kind: 'doctor', args: [] })

  await espera(400)

  const ja = getJob(a.id)
  const jb = getJob(b.id)
  check(
    'El segundo espera en cola',
    ja?.status === 'running' && jb?.status === 'queued',
    `primero ${ja?.status}, segundo ${jb?.status}`,
  )
  check('Solo hay uno activo', activeJob()?.id === a.id, activeJob()?.id ?? 'ninguno')

  // Cancelar el encolado no debe tocar al que corre.
  const cancelado = cancelJob(b.id)
  check('Cancela el que esperaba', cancelado && getJob(b.id)?.status === 'cancelled', String(getJob(b.id)?.status))
  check('El que corria sigue', getJob(a.id)?.status === 'running', String(getJob(a.id)?.status))

  await esperarFin(a.id, 120_000)
}

// --- Cancelar uno en marcha --------------------------------------------------
{
  const job = startJob({ kind: 'doctor', args: [] })
  await espera(600)

  const corriendo = getJob(job.id)?.status === 'running'
  const ok = cancelJob(job.id)
  await esperarFin(job.id, 30_000)

  check(
    'Cancela un trabajo en marcha',
    !corriendo || (ok && getJob(job.id)?.status === 'cancelled'),
    `estado final ${getJob(job.id)?.status}`,
  )
}

// --- Historial ---------------------------------------------------------------
{
  const todos = listJobs()
  check('Conserva el historial', todos.length >= 3, `${todos.length} trabajos`)
  check(
    'Ordena del mas reciente al mas antiguo',
    todos.every((j, i) => i === 0 || todos[i - 1]!.createdAt >= j.createdAt),
    'orden correcto',
  )
}

// --- Reporte -----------------------------------------------------------------
const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}

const failed = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - failed.length}/${checks.length} comprobaciones correctas`)
if (failed.length > 0) process.exitCode = 1
