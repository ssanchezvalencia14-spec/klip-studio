/**
 * Verificacion del analisis de metricas.
 *
 *   npm run verify:metrics
 *
 * Existe porque todavia no hay ninguna publicacion real, asi que el informe sale
 * vacio y no demuestra nada. Lo que si se puede comprobar hoy es que las cuentas
 * estan bien hechas: la correlacion contra valores conocidos, la deteccion de
 * cuentas sin alcance, y el aviso cuando la muestra es demasiado pequeña.
 *
 * Los datos son sinteticos y estan generados aqui. No son resultados: son
 * entradas de prueba con salida esperada conocida.
 *
 * Trabaja sobre un directorio temporal, nunca sobre el estado real.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'clipper-metrics-'))
process.env['STATE_DIR'] = sandbox

const store = await import('../src/store/store.js')
const { analyze, median, spearman } = await import('../src/metrics/analyze.js')
const { postsDueForCapture, collectMetrics } = await import('../src/metrics/collect.js')
const { leerMetricas } = await import('../src/metrics/providers/uploadPostMetrics.js')
import type { MetricSnapshot, Post } from '../src/store/store.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}
const near = (a: number | null, b: number, tol = 0.001): boolean =>
  a !== null && Math.abs(a - b) < tol

// --- 1. Mediana --------------------------------------------------------------
check('Mediana impar', median([3, 1, 2]) === 2, `${median([3, 1, 2])}`)
check('Mediana par', median([1, 2, 3, 4]) === 2.5, `${median([1, 2, 3, 4])}`)
check('Mediana vacia', median([]) === 0, `${median([])}`)

// --- 2. Spearman contra valores conocidos ------------------------------------
check(
  'Spearman monotona creciente = 1',
  near(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1),
  `${spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])}`,
)
check(
  'Spearman monotona decreciente = -1',
  near(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]), -1),
  `${spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])}`,
)
check(
  'Spearman ignora la escala (no lineal)',
  near(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]), 1),
  'cuadratica creciente sigue dando 1',
)
check(
  'Spearman con empates',
  near(spearman([1, 2, 2, 3], [10, 20, 20, 30]), 1),
  `${spearman([1, 2, 2, 3], [10, 20, 20, 30])}`,
)
check(
  'Spearman con muestra minima devuelve null',
  spearman([1, 2], [3, 4]) === null,
  'n < 3',
)
check(
  'Spearman con una serie constante devuelve null',
  spearman([1, 1, 1, 1], [1, 2, 3, 4]) === null,
  'varianza cero',
)

// --- 3. Utilidades para construir el escenario -------------------------------
function seed(options: {
  clips: { clipId: string; score: number }[]
  /** vistas por clip, una por publicacion */
  viewsByClip: Record<string, number[]>
  accounts?: string[]
}): void {
  const accountIds = options.accounts ?? ['acc-01', 'acc-02', 'acc-03']

  store.accounts.save(
    accountIds.map((id) => ({
      id,
      label: id,
      status: 'active' as const,
      slots: [10, 14, 18],
      tokenStatus: 'ok' as const,
      lastPublishedAt: null,
    })),
  )

  store.clips.save(
    options.clips.map((c) => ({
      sourceId: 'src',
      clipId: c.clipId,
      start: 0,
      end: 30,
      hook: 'h',
      reason: 'r',
      caption: 'c',
      hashtags: [],
      score: c.score,
      status: 'approved' as const,
      masterPath: 'x.mp4',
      proxyPath: '',
      proxyBytes: 0,
      reviewedAt: null,
    })),
  )

  const allPosts: Post[] = []
  const allMetrics: MetricSnapshot[] = []
  let n = 0

  for (const [clipId, views] of Object.entries(options.viewsByClip)) {
    views.forEach((v, i) => {
      n += 1
      const postId = `post-${n}`
      const accountId = accountIds[i % accountIds.length] ?? 'acc-01'
      // Hora fija por indice, para poder comprobar el reparto por franja.
      const publishedAt = new Date(Date.UTC(2026, 8, 1, 0, 0, 0))
      publishedAt.setHours(10 + (i % 3))

      allPosts.push({
        id: postId,
        queueItemId: `q-${n}`,
        sourceId: 'src',
        clipId,
        accountId,
        externalId: `ext-${n}`,
        provider: 'prueba',
        mode: 'direct',
        publishedAt: publishedAt.toISOString(),
      })

      allMetrics.push({
        id: `m-${n}`,
        postId,
        externalId: `ext-${n}`,
        accountId,
        clipId,
        capturedAt: publishedAt.toISOString(),
        ageHours: 24,
        views: v,
        likes: Math.round(v * 0.05),
        comments: 0,
        shares: 0,
        averageWatchSec: null,
      })
    })
  }

  store.posts.save(allPosts)
  store.metrics.save(allMetrics)
  store.queue.save([])
}

// --- 4. Correlacion perfecta con muestra suficiente --------------------------
{
  // 12 clips donde mas puntuacion implica mas vistas: Spearman debe dar 1.
  const clipDefs = Array.from({ length: 12 }, (_, i) => ({
    clipId: `clip-${String(i + 1).padStart(2, '0')}`,
    score: 50 + i * 4,
  }))
  const views: Record<string, number[]> = {}
  clipDefs.forEach((c, i) => {
    views[c.clipId] = [(i + 1) * 100, (i + 1) * 110, (i + 1) * 90]
  })

  seed({ clips: clipDefs, viewsByClip: views })
  const a = analyze()

  check(
    'Correlacion perfecta detectada',
    near(a.correlation.value, 1, 0.01),
    `spearman=${a.correlation.value?.toFixed(3)} n=${a.correlation.n}`,
  )
  check('Muestra suficiente se marca fiable', a.correlation.reliable, `n=${a.correlation.n}`)
  check('Agrega por clip', a.byClip.length === 12, `${a.byClip.length} clips`)
  check(
    'Ordena por vistas descendente',
    (a.byClip[0]?.medianViews ?? 0) > (a.byClip[11]?.medianViews ?? 0),
    `${a.byClip[0]?.medianViews} > ${a.byClip[11]?.medianViews}`,
  )
  check('Agrega por franja horaria', a.byHour.length === 3, `${a.byHour.length} franjas`)
  check(
    'Mediana por clip correcta',
    a.byClip.find((c) => c.clipId === 'clip-01')?.medianViews === 100,
    `clip-01 mediana=${a.byClip.find((c) => c.clipId === 'clip-01')?.medianViews} (de 100/110/90)`,
  )
}

// --- 5. Muestra pequeña: se calcula pero se marca no fiable ------------------
{
  const clipDefs = [
    { clipId: 'clip-01', score: 90 },
    { clipId: 'clip-02', score: 70 },
    { clipId: 'clip-03', score: 50 },
  ]
  seed({
    clips: clipDefs,
    viewsByClip: { 'clip-01': [900], 'clip-02': [500], 'clip-03': [100] },
  })
  const a = analyze()

  check(
    'Muestra pequeña se marca NO fiable',
    a.correlation.value !== null && !a.correlation.reliable,
    `spearman=${a.correlation.value?.toFixed(2)} n=${a.correlation.n} fiable=${a.correlation.reliable}`,
  )
}

// --- 6. Puntuacion que NO predice -------------------------------------------
{
  const clipDefs = Array.from({ length: 12 }, (_, i) => ({
    clipId: `clip-${String(i + 1).padStart(2, '0')}`,
    score: 96 - i * 4,
  }))
  const views: Record<string, number[]> = {}
  clipDefs.forEach((c, i) => {
    views[c.clipId] = [(i + 1) * 100]
  })

  seed({ clips: clipDefs, viewsByClip: views })
  const a = analyze()

  check(
    'Correlacion inversa detectada',
    near(a.correlation.value, -1, 0.01),
    `spearman=${a.correlation.value?.toFixed(3)} (el modelo puntua al reves)`,
  )
}

// --- 7. Cuenta sin alcance ---------------------------------------------------
{
  seed({
    clips: [{ clipId: 'clip-01', score: 80 }],
    viewsByClip: { 'clip-01': [0, 1, 2, 3000, 2500, 2200] },
    accounts: ['acc-muerta', 'acc-viva'],
  })

  // Las 3 primeras publicaciones (vistas 0,1,2) van alternando cuentas, asi que
  // se reasignan a mano para que una cuenta acumule la racha.
  const all = store.posts.all()
  const rewritten = all.map((p, i) => ({ ...p, accountId: i < 3 ? 'acc-muerta' : 'acc-viva' }))
  store.posts.save(rewritten)
  store.metrics.save(
    store.metrics.all().map((m, i) => ({ ...m, accountId: i < 3 ? 'acc-muerta' : 'acc-viva' })),
  )

  const a = analyze()
  const dead = a.byAccount.find((x) => x.accountId === 'acc-muerta')
  const alive = a.byAccount.find((x) => x.accountId === 'acc-viva')

  check(
    'Detecta racha sin alcance',
    dead?.zeroReachStreak === 3,
    `racha=${dead?.zeroReachStreak} (esperado 3)`,
  )
  check(
    'Cuenta con alcance no tiene racha',
    alive?.zeroReachStreak === 0,
    `racha=${alive?.zeroReachStreak}`,
  )
  check(
    'Emite alerta por cuenta sin alcance',
    a.alerts.some((x) => x.subject === 'acc-muerta' && x.level === 'error'),
    a.alerts.filter((x) => x.subject === 'acc-muerta').map((x) => x.level).join(',') || 'ninguna',
  )
}

// --- 8. Cadencia de captura --------------------------------------------------
{
  store.posts.save([
    {
      id: 'p-nuevo',
      queueItemId: 'q',
      sourceId: 'src',
      clipId: 'clip-01',
      accountId: 'acc-01',
      externalId: 'ext-nuevo',
      provider: 'prueba',
      mode: 'direct',
      publishedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    },
    {
      id: 'p-maduro',
      queueItemId: 'q',
      sourceId: 'src',
      clipId: 'clip-01',
      accountId: 'acc-01',
      externalId: 'ext-maduro',
      provider: 'prueba',
      mode: 'direct',
      publishedAt: new Date(Date.now() - 8 * 3_600_000).toISOString(),
    },
  ])
  store.metrics.save([])

  const due = await postsDueForCapture(new Date())
  check(
    'No captura antes del primer corte',
    !due.some((d) => d.post.id === 'p-nuevo'),
    'publicacion de 30 min quedo fuera',
  )
  check(
    'Captura al corte alcanzado',
    due.find((d) => d.post.id === 'p-maduro')?.targetAge === 6,
    `corte=${due.find((d) => d.post.id === 'p-maduro')?.targetAge} (8h -> corte de 6h)`,
  )

  // Tras guardar la lectura, no debe repetirse en la misma ventana.
  await collectMetrics(
    {
      name: 'prueba',
      fetch: (ids) =>
        Promise.resolve(
          ids.map((externalId) => ({
            externalId,
            views: 100,
            likes: 5,
            comments: 1,
            shares: 0,
            averageWatchSec: null,
          })),
        ),
    },
    new Date(),
  )

  check(
    'No repite lectura en el mismo corte',
    (await postsDueForCapture(new Date())).length === 0,
    `${(await postsDueForCapture(new Date())).length} pendientes tras capturar`,
  )
}

// --- 9. Parser defensivo de metricas ----------------------------------------
{
  /*
   * El bloque que llega es PLANO, no anidado.
   *
   * La version anterior probaba a bucear en `data.metrics`, pero eso era
   * especulacion sobre un endpoint que ni siquiera existia. El que existe,
   * /uploadposts/post-analytics/cached, entrega las cifras sueltas dentro de
   * `metrics`.
   */
  const plano = leerMetricas('a', { views: 1000, likes: 50, comments: 3, shares: 2 })
  check(
    'Lee los campos tal y como llegan',
    plano?.views === 1000 && plano?.likes === 50,
    `views=${plano?.views} likes=${plano?.likes}`,
  )

  // En la vista por perfil las vistas se llaman `impressions`, y es el nombre
  // mas probable tambien aqui. Los alias existen para no depender de acertar.
  const alias = leerMetricas('b', { impressions: 777, digg_count: 42, share_count: 9 })
  check(
    'Reconoce los otros nombres posibles de cada cifra',
    alias?.views === 777 && alias?.likes === 42 && alias?.shares === 9,
    `views=${alias?.views} likes=${alias?.likes} shares=${alias?.shares}`,
  )

  /*
   * Sin vistas NO se inventa un cero.
   *
   * Un cero se leeria como un clip que no funciono, que es la conclusion
   * contraria a la verdadera, y llevaria a descartar material bueno. Se
   * devuelve null y el motivo queda en el registro con el JSON delante.
   */
  const raro = leerMetricas('c', { algo: 'inesperado' })
  check(
    'Sin vistas devuelve nada, no un cero engañoso',
    raro === null,
    raro === null ? 'descartada' : `devolvio views=${raro.views}`,
  )

  const sinOpcionales = leerMetricas('d', { views: 5 })
  check(
    'Lo que falta queda a cero, pero solo si hay vistas',
    sinOpcionales?.views === 5 && sinOpcionales?.likes === 0 && sinOpcionales?.averageWatchSec === null,
    `likes=${sinOpcionales?.likes} segundos=${sinOpcionales?.averageWatchSec}`,
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
