/**
 * Fase 7: recoleccion de metricas y analisis
 *
 *   npm run metrics                  informe con lo que ya hay guardado
 *   npm run metrics -- --collect     toma lecturas nuevas del proveedor
 */
import { parseArgs } from 'node:util'
import { proveedorConfigurado } from '../src/publish/proveedor.js'
import { loadClipSettings } from '../src/select/ajustes.js'
import { loadEnv, optionalEnv } from '../src/lib/env.js'
import { analyze } from '../src/metrics/analyze.js'
import { collectMetrics } from '../src/metrics/collect.js'
import { buildFeedback } from '../src/metrics/feedback.js'
import { UploadPostMetricsProvider } from '../src/metrics/providers/uploadPostMetrics.js'
import { TikTokMetricsProvider } from '../src/metrics/providers/tiktokMetrics.js'
import { connect } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
import { crearMetricasPg } from '../src/metrics/estado-pg.js'
import { crearTokens } from '../src/publish/tiktok/tokens.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { requireEnv } from '../src/lib/env.js'
import { EARLY_SIGNAL_HOURS } from '../src/metrics/types.js'

function bar(value: number, max: number, width = 18): string {
  if (max <= 0) return ' '.repeat(width)
  const filled = Math.round((value / max) * width)
  return '#'.repeat(filled) + '.'.repeat(width - filled)
}

async function main(): Promise<void> {
  loadEnv()

  const { values } = parseArgs({
    options: {
      collect: { type: 'boolean', default: false },
      feedback: { type: 'boolean', default: false },
    },
  })

  if (values.feedback) {
    const fb = buildFeedback()
    if (!fb.ready) {
      console.log(`Todavia no: ${fb.reason}`)
      return
    }
    console.log(fb.block)
    console.log('')
    console.log('-'.repeat(74))
    console.log('Pega el bloque de arriba en src/select/prompt.ts y haz commit del cambio.')
    console.log('No se aplica solo: un prompt que cambia sin dejar rastro hace imposible')
    console.log('saber que version produjo cada resultado.')
    return
  }

  if (values.collect) {
    /*
     * El proveedor sale de PUBLISH_PROVIDER, no se adivina.
     *
     * Leer las cifras de una publicacion exige la misma credencial con la que
     * se publico. Mezclarlas daria cero lecturas sin decir por que.
     */
    const db = await connect(requireEnv('DATABASE_URL'))
    const store = createStore(db, OWNER_ID)
    const estado = crearMetricasPg(db, OWNER_ID)

    // Las metricas se leen con la credencial del proveedor por el que se
    // publico, asi que tiene que salir del mismo sitio que en publish.ts.
    const cual = proveedorConfigurado((await loadClipSettings(db, OWNER_ID)).proveedor)

    let proveedor
    if (cual === 'tiktok') {
      // De que cuenta es cada publicacion: cada una tiene su propio token.
      const publicaciones = await store.posts.all()
      const deQuien = new Map(publicaciones.map((p) => [p.externalId, p.accountId]))
      proveedor = new TikTokMetricsProvider(crearTokens(db, OWNER_ID), (id) => deQuien.get(id))
    } else {
      const apiKey = optionalEnv('UPLOAD_POST_API_KEY')
      if (apiKey === undefined) {
        console.error('Falta UPLOAD_POST_API_KEY en .env. Sin ella no se pueden leer metricas.')
        process.exitCode = 1
        await db.close()
        return
      }
      proveedor = new UploadPostMetricsProvider(apiKey)
    }

    const report = await collectMetrics(proveedor, new Date(), true, estado)
    await db.close()
    console.log(
      `Lecturas: ${report.captured} guardadas, ${report.missing} sin datos, ` +
        `de ${report.candidates} candidatas.`,
    )
    console.log('')
  }

  /*
   * Los datos salen de Postgres, no de los ficheros.
   *
   * analyze() leia del almacen de ficheros, que no se escribe desde el
   * 2026-09-13: el informe decia "Publicaciones: 6" habiendo doscientas
   * veintitres en la base. Parecia que no se medi­a nada cuando lo que pasaba es
   * que miraba al sitio equivocado.
   */
  const db2 = await connect(requireEnv('DATABASE_URL'))
  const store2 = createStore(db2, OWNER_ID)
  const [pPosts, pMetrics, pClips, pAccounts, pQueue] = await Promise.all([
    store2.posts.all(),
    store2.metrics.all(),
    store2.clips.all(),
    store2.accounts.all(),
    store2.queue.all(),
  ])
  await db2.close()

  const a = analyze({
    posts: pPosts,
    metrics: pMetrics,
    clips: pClips,
    accounts: pAccounts,
    pendientes: pQueue.filter((i: { status: string }) => i.status === 'pending').length,
  })

  console.log('='.repeat(74))
  console.log(`Publicaciones: ${a.totalPosts} | con metricas: ${a.measuredPosts}`)
  console.log('='.repeat(74))

  if (a.totalPosts === 0) {
    console.log('')
    console.log('Todavia no se ha publicado nada, asi que no hay nada que medir.')
    console.log('Las cifras apareceran cuando se publique el primer video.')
    console.log('')
  }

  // --- La pregunta que decide si la seleccion automatica sirve ---------------
  console.log('')
  console.log('CORRELACION entre la puntuacion del modelo y las vistas reales')
  if (a.correlation.value === null) {
    console.log(`  Sin datos suficientes (${a.correlation.n} clip(s) medidos).`)
  } else {
    console.log(`  Spearman = ${a.correlation.value.toFixed(2)}  sobre ${a.correlation.n} clips`)
    if (!a.correlation.reliable) {
      console.log('  AVISO: muestra demasiado pequeña. Este numero todavia es ruido.')
    } else if (a.correlation.value < 0.2) {
      console.log('  La puntuacion NO predice el rendimiento. Hay que revisar el prompt de la Fase 2.')
    } else if (a.correlation.value < 0.5) {
      console.log('  Relacion debil. El prompt acierta algo, pero hay margen.')
    } else {
      console.log('  La puntuacion predice el rendimiento. La seleccion automatica funciona.')
    }
  }

  if (a.byClip.length > 0) {
    const max = Math.max(...a.byClip.map((c) => c.medianViews))
    console.log('')
    console.log('POR CLIP')
    console.log(`  ${'clip'.padEnd(9)} ${'score'.padStart(5)} ${'pubs'.padStart(4)} ${'vistas'.padStart(8)} ${`${EARLY_SIGNAL_HOURS}h`.padStart(7)}`)
    for (const c of a.byClip) {
      console.log(
        `  ${c.clipId.padEnd(9)} ${String(c.score).padStart(5)} ${String(c.publications).padStart(4)} ` +
          `${c.medianViews.toLocaleString().padStart(8)} ${c.medianEarlyViews.toLocaleString().padStart(7)}  ` +
          bar(c.medianViews, max),
      )
    }
  }

  if (a.byAccount.some((x) => x.publications > 0)) {
    const max = Math.max(...a.byAccount.map((x) => x.medianViews))
    console.log('')
    console.log('POR CUENTA')
    for (const x of a.byAccount.filter((v) => v.publications > 0)) {
      const flag = x.zeroReachStreak >= 3 ? '  <-- sin alcance' : ''
      console.log(
        `  ${x.accountId.padEnd(8)} ${String(x.publications).padStart(4)} pubs  ` +
          `${x.medianViews.toLocaleString().padStart(8)} vistas  ${bar(x.medianViews, max)}${flag}`,
      )
    }
  }

  if (a.byHour.length > 0) {
    const max = Math.max(...a.byHour.map((h) => h.medianViews))
    console.log('')
    console.log('POR FRANJA HORARIA')
    for (const h of a.byHour) {
      console.log(
        `  ${String(h.hour).padStart(2, '0')}:00  ${String(h.publications).padStart(3)} pubs  ` +
          `${h.medianViews.toLocaleString().padStart(8)} vistas  ${bar(h.medianViews, max)}`,
      )
    }
  }

  if (a.alerts.length > 0) {
    console.log('')
    console.log('ALERTAS')
    for (const alert of a.alerts) {
      console.log(`  [${alert.level.toUpperCase()}] ${alert.subject}: ${alert.message}`)
    }
  }

  console.log('')
}

await main()
