/**
 * Fase 5a: clip maestro -> una variante por cuenta
 *
 *   npm run variants -- <sourceId>                    todos los clips, todas las cuentas
 *   npm run variants -- <sourceId> --clips 1,2        solo esos clips
 *   npm run variants -- <sourceId> --accounts 3       solo las 3 primeras cuentas
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv, paths } from '../src/lib/env.js'
import { writeJson } from '../src/lib/fsx.js'
import { formatDuration } from '../src/lib/logger.js'
import { beginRun } from '../src/store/runs.js'
/*
 * Postgres y no los ficheros de state/.
 *
 * Las cuentas enlazadas y el estado de los clips viven en la base: es lo que
 * mira el panel y lo que escribe el revisor desde el movil. Leyendo los
 * ficheros se generarian variantes para cuentas que ya no estan activas y se
 * ignorarian aprobaciones hechas desde el panel.
 */
import { connect } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { requireEnv } from '../src/lib/env.js'
import { renderVariant, type VariantResult } from '../src/variants/render.js'

async function main(): Promise<void> {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      clips: { type: 'string' },
      accounts: { type: 'string' },
    },
  })

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run variants -- <sourceId> [--clips 1,2] [--accounts 3]')
    process.exitCode = 1
    return
  }

  const db = await connect(requireEnv('DATABASE_URL'))
  const store = createStore(db, OWNER_ID)

  // Las que pueden publicar, no las meramente activas: ver publicables().
  // Generar variantes para una cuenta sin permiso es tiempo de GPU tirado.
  const active = await store.accounts.publicables()
  if (active.length === 0) {
    console.error('No hay ninguna cuenta que pueda publicar.')
    console.error('Enlaza al menos una con TikTok en Ajustes, en Cuentas.')
    process.exitCode = 1
    await db.close()
    return
  }

  const selectedAccounts =
    values.accounts === undefined ? active : active.slice(0, Number(values.accounts))

  const outDir = join(paths.out, sourceId)
  const wanted =
    values.clips === undefined
      ? null
      : new Set(values.clips.split(',').map((n) => n.trim().padStart(2, '0')))

  // Solo se generan variantes de clips APROBADOS. Esta es la compuerta: sin
  // ella se renderizarian 20 variantes y se publicarian 60 videos diarios de
  // material que nadie ha visto. Un clip malo replicado en 20 cuentas hace mas
  // daño que no publicar nada.
  const approved = (await store.clips.byStatus('approved'))
    .filter((c) => c.sourceId === sourceId)
    .filter((c) => wanted === null || wanted.has(c.clipId.replace('clip-', '')))

  const masters = approved
    .filter((c) => existsSync(c.masterPath))
    .map((c) => ({ clipId: c.clipId, path: c.masterPath }))

  const missingFiles = approved.length - masters.length
  if (missingFiles > 0) {
    console.error(`Aviso: ${missingFiles} clip(s) aprobados no tienen su MP4 renderizado.`)
  }

  if (masters.length === 0) {
    /*
     * El motivo se mira en la base, no se adivina.
     *
     * Antes, sin aprobados y sin pendientes, esto decia "Importa los clips a la
     * compuerta: npm run review". Las dos mitades estaban mal: los clips SI
     * estaban importados, y lo que pasaba de verdad es que estaban todos
     * descartados. Ademas mandaba a una terminal, que es justo lo que el panel
     * existe para evitar. El 2026-10-05 ese mensaje hizo reintentar cinco veces
     * un trabajo que no podia salir bien.
     */
    const delVod = (await store.clips.all()).filter((c) => c.sourceId === sourceId)
    const pending = delVod.filter((c) => c.status === 'pending').length
    const rejected = delVod.filter((c) => c.status === 'rejected').length

    if (delVod.length === 0) {
      console.error(`${sourceId} todavia no tiene ningun momento en el panel.`)
      console.error('Busca sus momentos y crea los videos desde Inicio.')
    } else if (pending > 0) {
      console.error(`${sourceId} tiene ${pending} video(s) sin revisar y ninguno aprobado.`)
      console.error('Entra en Revisar y decide cuales valen. El reparto arranca solo al terminar.')
    } else {
      console.error(`Los ${rejected} video(s) de ${sourceId} estan descartados.`)
      console.error('No hay nada que repartir. Si alguno valia, recuperalo desde Revisar.')
    }
    process.exitCode = 1
    await db.close()
    return
  }

  const total = masters.length * selectedAccounts.length
  console.log(
    `${masters.length} clip(s) x ${selectedAccounts.length} cuenta(s) = ${total} variantes`,
  )

  const startedAt = performance.now()
  const results: VariantResult[] = []
  const run = beginRun('variants', sourceId, `Generar ${total} variantes`)

  try {
    // En serie: hay un solo chip NVENC y paralelizar solo añade contencion.
    for (const master of masters) {
      for (const account of selectedAccounts) {
        const result = await renderVariant(sourceId, master.clipId, master.path, account.id)
        results.push(result)
        process.stdout.write(`\r  ${results.length}/${total} renderizadas`)
      }
    }
  } catch (error) {
    process.stdout.write('\n')
    run.fail(error)
    throw error
  }
  process.stdout.write('\n')

  const elapsed = performance.now() - startedAt

  // Comprobacion clave: si dos variantes comparten checksum, no son variantes.
  const byChecksum = new Map<string, string[]>()
  for (const r of results) {
    const key = r.checksum
    byChecksum.set(key, [...(byChecksum.get(key) ?? []), `${r.clipId}/${r.accountId}`])
  }
  const duplicates = [...byChecksum.values()].filter((group) => group.length > 1)

  run.finish({
    input: { clips: masters.length, cuentas: selectedAccounts.length },
    // Los checksums unicos son la comprobacion que da sentido al paso: si se
    // repiten, no son variantes y TikTok las ve como el mismo archivo.
    output: { variantes: results.length, unicas: byChecksum.size, duplicadas: duplicates.length },
  })

  writeJson(join(outDir, 'variants.json'), {
    sourceId,
    generatedAt: new Date().toISOString(),
    variants: results.map((r) => ({
      clipId: r.clipId,
      accountId: r.accountId,
      path: r.path,
      checksum: r.checksum,
      params: r.params,
      durationSec: r.durationSec,
    })),
  })

  console.log('')
  console.log('='.repeat(72))
  console.log(`Variantes        : ${results.length}`)
  console.log(`Checksums unicos : ${byChecksum.size} de ${results.length}`)
  console.log(
    `Duplicados       : ${duplicates.length === 0 ? 'ninguno' : duplicates.map((g) => g.join(' = ')).join(' | ')}`,
  )
  console.log(`Tiempo total     : ${formatDuration(elapsed)}`)
  console.log(`Media por variante: ${formatDuration(elapsed / Math.max(1, results.length))}`)
  console.log(`Salida           : ${join(outDir, 'variants')}`)
  console.log('='.repeat(72))

  if (duplicates.length > 0) {
    console.error('')
    console.error('FALLO: hay variantes identicas. Publicarlas seria peor que no variar nada.')
    process.exitCode = 1
    await db.close()
    return
  }

  console.log('')
  console.log('Muestra de parametros:')
  for (const r of results.slice(0, 5)) {
    console.log(
      `  ${r.clipId}/${r.accountId}  zoom ${r.params.zoom}  vel ${r.params.speed}  ` +
        `corte ${r.params.trimStartSec.toFixed(2)}s  ${r.durationSec.toFixed(1)}s  ` +
        `${r.checksum.slice(0, 12)}`,
    )
  }

  await db.close()
}

await main()
