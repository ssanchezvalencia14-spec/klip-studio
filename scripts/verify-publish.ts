/**
 * Verificacion de los caminos de fallo del worker de publicacion.
 *
 *   npm run verify:publish
 *
 * Existe porque el modo en seco solo ejercita el camino feliz, y lo que importa
 * de este worker es que hace cuando algo va mal: si respeta la cadencia, si
 * reprograma en vez de reintentar a ciegas, si saca de rotacion una cuenta con
 * el token caducado. Publicar es irreversible; esa logica no puede estar sin
 * probar.
 *
 * Trabaja sobre un directorio de estado aparte, asi que nunca toca la cola real.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Debe fijarse ANTES de importar el almacen: la ruta se resuelve al cargar.
const sandbox = mkdtempSync(join(tmpdir(), 'clipper-verify-'))
process.env['STATE_DIR'] = sandbox

const { accounts, posts, queue, seedAccounts } = await import('../src/store/store.js')
const { runWorker } = await import('../src/publish/worker.js')
const { TIKTOK_LIMITS } = await import('../src/publish/types.js')
import type { PublishProvider, PublishResult } from '../src/publish/types.js'
import type { QueueItem } from '../src/store/store.js'

/** Proveedor que devuelve siempre el fallo que se le indique. */
function failingProvider(result: PublishResult): PublishProvider {
  return { name: 'prueba', publish: () => Promise.resolve(result) }
}

function makeItem(id: string, accountId: string, scheduledAt: Date): QueueItem {
  return {
    id,
    sourceId: 'test',
    clipId: 'clip-01',
    accountId,
    variantPath: 'x.mp4',
    checksum: 'abc',
    params: { zoom: 1, speed: 1, brightness: 0, contrast: 1, saturation: 1, trimStartSec: 0 },
    caption: 'prueba',
    hashtags: ['a'],
    scheduledAt: scheduledAt.toISOString(),
    status: 'pending',
    attemptCount: 0,
    lastError: null,
  }
}

const checks: { name: string; ok: boolean; detail: string }[] = []

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail })
}

/** Deja el estado limpio antes de cada comprobacion. */
function reset(): void {
  accounts.save(seedAccounts(2, 3))
  queue.save([])
  writeFileSync(join(sandbox, 'posts.json'), '[]', 'utf8')
}

const past = new Date(Date.now() - 60_000)

// --- 1. Cadencia: una cuenta que ya publico su tope diario se pospone --------
{
  reset()
  queue.save([makeItem('q1', 'acc-01', past)])

  writeFileSync(
    join(sandbox, 'posts.json'),
    JSON.stringify(
      Array.from({ length: TIKTOK_LIMITS.maxPer24h }, (_, i) => ({
        id: `p${i}`,
        queueItemId: 'x',
        sourceId: 'test',
        clipId: 'clip-01',
        accountId: 'acc-01',
        externalId: 'e',
        provider: 'prueba',
        mode: 'direct',
        publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
      })),
    ),
    'utf8',
  )

  const report = await runWorker({
    provider: failingProvider({ ok: false, kind: 'transient', message: 'no deberia llamarse' }),
    mode: 'direct',
  })

  check(
    'Cadencia diaria bloquea',
    report.skippedByCadence === 1 && report.attempted === 0,
    `pospuestas=${report.skippedByCadence} intentadas=${report.attempted}`,
  )
  check(
    'Item bloqueado sigue pendiente',
    queue.all()[0]?.status === 'pending',
    `estado=${queue.all()[0]?.status}`,
  )
}

// --- 1b. La ventana de cadencia avanza con el reloj durante la pasada --------
//
// Regresion del 2026-09-26. `now` se calculaba una vez al arrancar y se
// reutilizaba para cada item. Como cada subida real tarda uno o dos minutos, al
// llegar al sexto clip la ventana de "ultimo minuto" seguia anclada al arranque
// y contaba como recientes publicaciones de hacia ocho minutos. Sintoma: cinco
// subidas repartidas entre las 21:08 y las 21:15 bloquearon las seis siguientes.
//
// Se monta asi: cuatro publicaciones a 59 s (una por debajo del tope), dos
// items, y un proveedor que tarda 1,5 s. Al procesar el segundo item ya han
// pasado mas de 59 s desde aquellas cuatro, asi que deben salir de la ventana.
// Con el reloj congelado nunca salen y el segundo item se bloquea.
{
  reset()
  const ahora = Date.now()
  queue.save([makeItem('q1', 'acc-01', past), makeItem('q2', 'acc-01', past)])

  writeFileSync(
    join(sandbox, 'posts.json'),
    JSON.stringify(
      Array.from({ length: TIKTOK_LIMITS.maxPerMinute - 1 }, (_, i) => ({
        id: `viejo${i}`,
        queueItemId: 'x',
        sourceId: 'test',
        clipId: 'clip-01',
        accountId: 'acc-01',
        externalId: 'e',
        provider: 'prueba',
        mode: 'draft',
        publishedAt: new Date(ahora - 59_000).toISOString(),
      })),
    ),
    'utf8',
  )

  const lento: PublishProvider = {
    name: 'lento',
    publish: async () => {
      await new Promise((r) => setTimeout(r, 1_500))
      return { ok: true, externalId: 'e', mode: 'draft' }
    },
  }

  const report = await runWorker({ provider: lento, mode: 'draft' })

  check(
    'La ventana de cadencia no se queda congelada',
    report.attempted === 2 && report.skippedByCadence === 0,
    `intentadas=${report.attempted} pospuestas=${report.skippedByCadence}`,
  )
}

// --- 2. rate_limit: reprograma y NO consume intento --------------------------
{
  reset()
  queue.save([makeItem('q2', 'acc-02', past)])

  const report = await runWorker({
    provider: failingProvider({
      ok: false,
      kind: 'rate_limit',
      message: 'demasiadas',
      retryAfterSec: 120,
    }),
    mode: 'direct',
  })

  const item = queue.all()[0]
  const rescheduled = item !== undefined && new Date(item.scheduledAt) > new Date()

  check('Limite reprograma', report.rateLimited === 1, `rateLimited=${report.rateLimited}`)
  check('Limite no gasta intento', item?.attemptCount === 0, `intentos=${item?.attemptCount}`)
  check('Limite mueve la hora al futuro', rescheduled, `scheduledAt=${item?.scheduledAt}`)
}

// --- 3. transient: reintenta con espera creciente hasta agotar ---------------
{
  reset()
  queue.save([makeItem('q3', 'acc-02', past)])

  let last = queue.all()[0]
  for (let pass = 1; pass <= 5; pass += 1) {
    // Se fuerza el vencimiento para poder encadenar pasadas sin esperar.
    queue.update('q3', { scheduledAt: past.toISOString() })
    await runWorker({
      provider: failingProvider({ ok: false, kind: 'transient', message: 'caida' }),
      mode: 'direct',
    })
    last = queue.all()[0]
    if (last?.status === 'failed') break
  }

  check(
    'Transitorio acaba en fallida tras agotar intentos',
    last?.status === 'failed',
    `estado=${last?.status} intentos=${last?.attemptCount}`,
  )
}

// --- 4. auth: pausa la cuenta tras fallos repetidos --------------------------
{
  reset()
  queue.save([
    makeItem('q4a', 'acc-01', past),
    makeItem('q4b', 'acc-01', past),
  ])

  const report = await runWorker({
    provider: failingProvider({ ok: false, kind: 'auth', message: 'token caducado' }),
    mode: 'direct',
  })

  const account = accounts.all().find((a) => a.id === 'acc-01')

  check(
    'Auth pausa la cuenta',
    account?.status === 'error' && account.tokenStatus === 'expired',
    `estado=${account?.status} token=${account?.tokenStatus}`,
  )
  check(
    'Cuenta pausada se reporta',
    report.pausedAccounts.includes('acc-01'),
    `pausadas=${report.pausedAccounts.join(',') || 'ninguna'}`,
  )
}

// --- 5. media: fallo definitivo, sin reintentos ------------------------------
{
  reset()
  queue.save([makeItem('q5', 'acc-02', past)])

  await runWorker({
    provider: failingProvider({ ok: false, kind: 'media', message: 'archivo invalido' }),
    mode: 'direct',
  })

  check(
    'Media no reintenta',
    queue.all()[0]?.status === 'failed',
    `estado=${queue.all()[0]?.status}`,
  )
}

// --- 6. persist=false no toca el estado --------------------------------------
{
  reset()
  queue.save([makeItem('q6', 'acc-02', past)])

  await runWorker({
    provider: { name: 'ok', publish: () => Promise.resolve({ ok: true, externalId: 'e', mode: 'direct' }) },
    mode: 'direct',
    persist: false,
  })

  check(
    'Modo en seco no escribe',
    queue.all()[0]?.status === 'pending' && posts.all().length === 0,
    `estado=${queue.all()[0]?.status} posts=${posts.all().length}`,
  )
}


// --- Concurrencia entre cuentas ---------------------------------------------
//
// El trabajador paso de publicar en serie a atender varias CUENTAS a la vez.
// Es el cambio con mas riesgo de todo el modulo, porque si se cuela un envio
// de la misma cuenta en paralelo con otro se rompe la cadencia: los dos leen
// el mismo recuento de publicaciones y los dos creen que pueden pasar.
//
// Las tres pruebas cubren exactamente eso: que dos cuentas SI se solapan, que
// dos envios de una misma cuenta NO, y que un envio que ya cogio otra pasada
// se salta en vez de subirse dos veces.

/** Proveedor que tarda y anota quien estaba dentro en cada momento. */
function proveedorLento(registro: {
  dentro: Set<string>
  maxALaVez: number
  solapes: string[]
}): PublishProvider {
  return {
    name: 'lento',
    publish: async (req) => {
      registro.dentro.add(req.accountId)
      registro.maxALaVez = Math.max(registro.maxALaVez, registro.dentro.size)
      if (registro.dentro.size > 1) registro.solapes.push([...registro.dentro].sort().join('+'))
      await new Promise((r) => setTimeout(r, 40))
      registro.dentro.delete(req.accountId)
      return { ok: true, externalId: 'e-' + req.accountId, mode: 'direct' }
    },
  }
}

// --- Dos cuentas distintas se atienden a la vez ------------------------------
{
  reset()
  queue.save([
    makeItem('c1', 'acc-01', past),
    makeItem('c2', 'acc-02', past),
  ])

  const reg = { dentro: new Set<string>(), maxALaVez: 0, solapes: [] as string[] }
  const report = await runWorker({
    provider: proveedorLento(reg),
    mode: 'direct',
    concurrencia: 2,
  })

  check(
    'Dos cuentas distintas publican a la vez',
    reg.maxALaVez === 2 && report.published === 2,
    `maximo simultaneo=${reg.maxALaVez} publicadas=${report.published}`,
  )
}

// --- Dos envios de la MISMA cuenta nunca se solapan --------------------------
{
  reset()
  // Tres envios, todos de acc-01, y concurrencia alta: aun asi tienen que ir
  // uno detras de otro, porque el paralelismo es entre cuentas.
  queue.save([
    makeItem('m1', 'acc-01', past),
    makeItem('m2', 'acc-01', past),
    makeItem('m3', 'acc-01', past),
  ])

  const reg = { dentro: new Set<string>(), maxALaVez: 0, solapes: [] as string[] }
  const report = await runWorker({
    provider: proveedorLento(reg),
    mode: 'direct',
    concurrencia: 8,
    // Sin tope diario de por medio: lo que se mide aqui es el solape, no la
    // cadencia, y con los topes de TikTok el tercero se pospondria.
    cadencia: { porMinuto: 6, porDia: 15 },
  })

  check(
    'La misma cuenta nunca publica dos a la vez',
    reg.maxALaVez === 1 && reg.solapes.length === 0 && report.published === 3,
    `maximo simultaneo=${reg.maxALaVez} publicadas=${report.published}`,
  )
}

// --- Un envio que ya cogio otra pasada se salta ------------------------------
{
  reset()
  queue.save([makeItem('t1', 'acc-01', past), makeItem('t2', 'acc-02', past)])

  // Estado real salvo `tomar`, que simula que otra pasada se llevo el primero.
  const { estadoEnFicheros } = await import('../src/publish/worker.js')
  const tomados: string[] = []
  const estado = {
    ...estadoEnFicheros,
    tomar: async (id: string) => {
      tomados.push(id)
      if (id === 't1') return false
      return estadoEnFicheros.tomar(id)
    },
  }

  const report = await runWorker({
    provider: failingProvider({ ok: true, externalId: 'e', mode: 'direct' } as never),
    mode: 'direct',
    estado,
    concurrencia: 2,
  })

  check(
    'Un envio ya tomado por otra pasada no se sube',
    tomados.includes('t1') && report.attempted === 1 && report.published === 1,
    `tomados=${tomados.join(',')} intentadas=${report.attempted} publicadas=${report.published}`,
  )
}

// --- Reporte -----------------------------------------------------------------
rmSync(sandbox, { recursive: true, force: true })

const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}

const failed = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - failed.length}/${checks.length} comprobaciones correctas`)
if (failed.length > 0) process.exitCode = 1
