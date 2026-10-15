/**
 * Fase 4: compuerta de aprobacion
 *
 *   npm run review -- <sourceId>      importa los clips del VOD y abre el panel
 *   npm run review                    abre el panel con lo ya importado
 *
 * El panel escucha en todas las interfaces para poder revisarlo desde el movil,
 * que es donde tiene sentido mirar un video vertical.
 *
 * TODO SALE DE LA BASE DE DATOS. Antes leia los ficheros JSON de state/, y eso
 * ataba el panel al ordenador que hacia el trabajo. Ahora el panel puede correr
 * en un servidor y el render aqui, hablando los dos por Postgres.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv, paths, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { readJson, workDir } from '../src/lib/fsx.js'
import { startReviewServer } from '../src/review/server.js'
import { connect } from '../src/store/db.js'
import { createStore, type Store } from '../src/store/pg.js'
import type { ClipRecord } from '../src/store/store.js'

interface ClipsFile {
  clips: {
    start: number
    end: number
    hook: string
    reason: string
    caption: string
    hashtags: string[]
    score: number
  }[]
}

/**
 * Trae a la compuerta los clips ya renderizados de un VOD.
 *
 * Solo se importan los que tienen su MP4 maestro: revisar un clip que no se
 * puede reproducir no sirve de nada, y aprobarlo a ciegas es justo lo que la
 * compuerta existe para evitar.
 *
 * Es una utilidad LOCAL: lee el directorio de trabajo, asi que solo tiene
 * sentido en el ordenador que renderizo. El panel remoto nunca pasa por aqui.
 */
async function importSource(
  store: Store,
  sourceId: string,
): Promise<{ imported: number; skipped: number }> {
  const clipsPath = join(workDir(sourceId), 'clips.json')
  if (!existsSync(clipsPath)) {
    throw new Error(
      `No existe ${clipsPath}. Ejecuta antes la seleccion y el render de ese VOD.`,
    )
  }

  const file = readJson<ClipsFile>(clipsPath)
  const nuevos: ClipRecord[] = []
  let skipped = 0

  // Los que ya estan, de una vez. Preguntar clip a clip contra una base remota
  // serian treinta idas y vueltas para no traer nada nuevo.
  const yaEstan = new Set((await store.clips.all()).map((c) => `${c.sourceId}/${c.clipId}`))

  file.clips.forEach((clip, i) => {
    const clipId = `clip-${String(i + 1).padStart(2, '0')}`
    const masterPath = join(paths.out, sourceId, `${clipId}.mp4`)

    if (!existsSync(masterPath)) {
      skipped += 1
      return
    }
    // No se toca el estado de lo ya revisado: reimportar no debe resucitar un
    // clip que alguien descarto.
    if (yaEstan.has(`${sourceId}/${clipId}`)) return

    nuevos.push({
      sourceId,
      clipId,
      start: clip.start,
      end: clip.end,
      hook: clip.hook,
      reason: clip.reason,
      caption: clip.caption,
      hashtags: clip.hashtags,
      score: clip.score,
      status: 'pending',
      masterPath,
      // Recien importado no hay copia en la nube todavia. La sube despues
      // `npm run subir`, que es lo que lo hace revisable desde el movil.
      proxyPath: '',
      proxyBytes: 0,
      reviewedAt: null,
    })
  })

  await store.clips.save(nuevos)
  return { imported: nuevos.length, skipped }
}

async function main(): Promise<void> {
  loadEnv()

  /*
   * El puerto lo manda el servidor.
   *
   * En un hosting no se elige: el proceso recibe PORT y tiene que escuchar ahi
   * o el servidor web no encuentra la aplicacion. En casa no existe esa
   * variable y se usa el de siempre.
   */
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { port: { type: 'string', default: process.env.PORT ?? '4310' } },
  })

  const db = await connect(requireEnv('DATABASE_URL'))
  const store = createStore(db, OWNER_ID)

  const sourceId = positionals[0]

  if (sourceId !== undefined) {
    const { imported, skipped } = await importSource(store, sourceId)
    console.log(`Importados ${imported} clip(s) nuevos de ${sourceId}.`)
    if (skipped > 0) {
      console.log(`Omitidos ${skipped} sin MP4 renderizado.`)
    }
    if (imported === 0) {
      console.log('Los demas ya estaban en la compuerta; no se toca su estado.')
    }
  }

  const todos = await store.clips.all()
  const pending = todos.filter((c) => c.status === 'pending').length
  const approved = todos.filter((c) => c.status === 'approved').length
  const rejected = todos.filter((c) => c.status === 'rejected').length

  console.log('')
  console.log(`Compuerta: ${pending} pendientes | ${approved} aprobados | ${rejected} descartados`)

  // Antes se salia aqui cuando no habia clips, y tenia sentido: esto era solo
  // una compuerta de revision y sin clips no habia nada que revisar.
  //
  // Ya no. El panel es el centro de control desde el que se añade el primer
  // video, se ajustan los horarios y se mira el historial. Negarse a arrancar
  // con el almacen vacio dejaba sin forma de empezar.
  if (todos.length === 0) {
    console.log('')
    console.log('Sin videos todavia. Abre el panel y añade el primero desde Inicio.')
  }

  startReviewServer({ port: Number(values.port), db, ownerId: OWNER_ID })
}

/*
 * SIN `await` AQUI, a proposito.
 *
 * Un `await` en el nivel superior convierte el modulo en asincrono, y entonces
 * no se puede cargar con `require()`. En casa da igual, pero el servidor de
 * Hostinger arranca la aplicacion exactamente asi, desde su propio lsnode.js, y
 * lo unico que se veia era un 503 sin explicacion:
 *
 *   ERR_REQUIRE_ASYNC_MODULE: require() cannot be used on an ESM graph
 *   with top-level await.
 *
 * Con la promesa encadenada el modulo carga de inmediato y el servidor se pone
 * a escuchar un instante despues, que es lo que el alojamiento espera.
 */
main().catch((error: unknown) => {
  console.error('El panel no pudo arrancar:', error)
  process.exitCode = 1
})
