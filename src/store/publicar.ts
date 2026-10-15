import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from '../lib/env.js'
import { readJson } from '../lib/fsx.js'
import { createLogger } from '../lib/logger.js'
import type { SourceMeta, Transcript } from '../types.js'
import type { Db } from './db.js'
import { createStore } from './pg.js'
import { createRunsStore } from './runs-pg.js'
import { runs as runsLocal } from './runs.js'
import type { ClipRecord } from './store.js'

const log = createLogger('publicar')

/**
 * El puente entre el ordenador que trabaja y el panel que mira.
 *
 * Los scripts de la tuberia siguen escribiendo en disco, y esta bien: una
 * transcripcion de 3.000 segmentos y un MP4 de 40 MB no tienen por que pasar
 * por una base de datos. Pero el panel ya no vive en este ordenador y no puede
 * leer ninguno de esos ficheros.
 *
 * Esto lee lo que dejaron los scripts y publica en la base LO QUE EL PANEL
 * NECESITA PARA ENSEÑARLO: el titulo, cuantos momentos hay, cuales tienen
 * video, cuantas copias se hicieron. No los datos, solo lo que se ve.
 *
 * LO LLAMA EL TRABAJADOR, no los scripts. Asi cada script sigue haciendo una
 * sola cosa y el conocimiento de "esto hay que contarselo al panel" vive en un
 * solo sitio en vez de repartido por cuatro ficheros.
 */

function leerFuente(sourceId: string): { title: string; durationSec: number } {
  const metaPath = join(paths.work, sourceId, 'source.json')
  if (existsSync(metaPath)) {
    try {
      const meta = readJson<SourceMeta>(metaPath)
      return { title: meta.title, durationSec: meta.durationSec }
    } catch {
      // Un source.json corrupto no debe impedir que el VOD aparezca; se cae al
      // identificador crudo, que es feo pero visible.
    }
  }
  return { title: sourceId, durationSec: 0 }
}

/** Anota el VOD y si ya tiene transcripcion. */
export async function publicarFuente(
  db: Db,
  ownerId: string,
  sourceId: string,
  campanaId?: string,
): Promise<void> {
  const store = createStore(db, ownerId)
  const { title, durationSec } = leerFuente(sourceId)

  const transcriptPath = join(paths.work, sourceId, 'transcript.json')
  let duracion = durationSec
  const hayTranscripcion = existsSync(transcriptPath)

  if (hayTranscripcion && duracion === 0) {
    // La duracion del source.json puede faltar en un archivo local; la de la
    // transcripcion siempre esta porque se midio al procesarlo.
    try {
      duracion = readJson<Transcript>(transcriptPath).durationSec
    } catch {
      duracion = 0
    }
  }

  await store.sources.upsert({
    sourceId,
    title,
    durationMin: duracion > 0 ? Math.round(duracion / 60) : null,
    hasTranscript: hayTranscripcion,
    // Estas las calcula la base al leer; aqui no se usan.
    clips: 0,
    rendered: 0,
    approved: 0,
    rejected: 0,
    variants: 0,
    updatedAt: new Date().toISOString(),
  })

  if (campanaId === undefined) return

  /*
   * Solo si todavia no tiene campaña.
   *
   * publicarFuente se llama otra vez en cada select y cada render del mismo
   * VOD. Sin esta condicion, mover un video a otra campaña desde el panel
   * duraria hasta el siguiente render, que lo devolveria a la que se eligio al
   * subirlo. Lo que se elige al subir es un valor inicial, no una atadura.
   *
   * La campaña se comprueba contra el mismo propietario: la clave foranea no
   * sabe de propietarios y aceptaria la de otro.
   */
  await db.query(
    `update sources set campana_id = $3
      where owner_id = $1 and id = $2 and campana_id is null
        and exists (select 1 from campanas where owner_id = $1 and id = $3)`,
    [ownerId, sourceId, campanaId],
  )
}

/**
 * Anota los momentos elegidos, con su video si ya se renderizo.
 *
 * NO TOCA EL ESTADO DE LO YA REVISADO. Un clip que alguien descarto en el panel
 * no puede volver a 'pending' porque el render se ejecute otra vez: la
 * compuerta de aprobacion dejaria de significar nada. Solo se insertan los
 * nuevos y se completa la ruta del video de los que ya estaban.
 */
export async function publicarClips(db: Db, ownerId: string, sourceId: string): Promise<number> {
  const clipsPath = join(paths.work, sourceId, 'clips.json')
  if (!existsSync(clipsPath)) return 0

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

  let file: ClipsFile
  try {
    file = readJson<ClipsFile>(clipsPath)
  } catch {
    log.warn(`clips.json de ${sourceId} ilegible; no se publica nada.`)
    return 0
  }

  const store = createStore(db, ownerId)
  const previos = new Map(
    (await store.clips.all())
      .filter((c) => c.sourceId === sourceId)
      .map((c) => [c.clipId, c]),
  )

  const filas: ClipRecord[] = file.clips.map((clip, i) => {
    const clipId = `clip-${String(i + 1).padStart(2, '0')}`
    const masterPath = join(paths.out, sourceId, `${clipId}.mp4`)
    const hayVideo = existsSync(masterPath)
    const previo = previos.get(clipId)

    return {
      sourceId,
      clipId,
      start: clip.start,
      end: clip.end,
      hook: clip.hook,
      reason: clip.reason,
      caption: previo?.caption ?? clip.caption,
      hashtags: previo?.hashtags ?? clip.hashtags,
      score: clip.score,
      status: previo?.status ?? 'pending',
      masterPath: hayVideo ? masterPath : (previo?.masterPath ?? ''),
      /*
       * La copia de revision se conserva, igual que la decision y el pie.
       *
       * Reimportar un VOD vuelve a pasar por aqui, y poner '' borraria del
       * registro una copia que sigue existiendo en la nube: quedaria huerfana,
       * ocupando sitio sin que nada la apunte, y el panel diria que no hay
       * video para un clip que si lo tiene.
       */
      proxyPath: previo?.proxyPath ?? '',
      proxyBytes: previo?.proxyBytes ?? 0,
      reviewedAt: previo?.reviewedAt ?? null,
    }
  })

  await store.clips.save(filas)
  return filas.length
}

/**
 * Cuenta las copias por cuenta que hay en disco y lo anota.
 *
 * Se cuentan los mp4 y no las entradas del directorio: `variants/` guarda una
 * subcarpeta por clip, asi que contar entradas daria 6 donde hay 120 archivos.
 */
export async function publicarVariantes(
  db: Db,
  ownerId: string,
  sourceId: string,
): Promise<number> {
  const dir = join(paths.out, sourceId, 'variants')
  let total = 0

  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      total += readdirSync(join(dir, entry.name)).filter((f) => f.endsWith('.mp4')).length
    }
  }

  await createStore(db, ownerId).sources.marcarVariantes(sourceId, total)
  return total
}

/**
 * Sube al diario de la base las pasadas que solo estan en el fichero local.
 *
 * Los scripts siguen anotando en runs.json porque `beginRun` es sincrono y una
 * escritura a una base remota no puede serlo. En vez de convertir media tuberia
 * a asincrona por el diario, se copia despues: `on conflict do nothing` hace
 * que repetirlo no duplique nada.
 */
export async function publicarPasadas(db: Db, ownerId: string): Promise<number> {
  const diario = createRunsStore(db, ownerId)
  const yaEstan = new Set((await diario.recientes(500)).map((r) => r.id))

  let subidas = 0
  for (const run of runsLocal.all()) {
    if (yaEstan.has(run.id)) continue
    await diario.anotar(run)
    subidas += 1
  }
  return subidas
}

/**
 * Publica todo lo que dejo una tarea, segun de que tarea se trate.
 *
 * El sourceId no siempre viene en los argumentos: el de un ingest no existe
 * hasta que el video se descarga y se deriva de su contenido, asi que se lee
 * del resumen que imprime el script. Es la misma via que usa el encadenado.
 */
export async function publicarResultado(
  db: Db,
  ownerId: string,
  kind: string,
  args: string[],
  salida: string,
): Promise<void> {
  const delResumen = /^sourceId\s*:\s*(\S+)/m.exec(salida)?.[1]
  const sourceId = kind === 'ingest' ? delResumen : (args[0] ?? delResumen)

  // El diario se sube siempre: cada tarea deja una pasada, tenga VOD o no.
  const pasadas = await publicarPasadas(db, ownerId)
  if (pasadas > 0) log.info(`${pasadas} pasada(s) anotadas en la base`)

  if (sourceId === undefined || !/^[A-Za-z0-9_-]+$/.test(sourceId)) return

  switch (kind) {
    case 'ingest': {
      /*
       * La campaña elegida al subir viaja en los argumentos del trabajo.
       *
       * Aqui es donde nace la fila del VOD, y es el primer momento en que
       * existe un sourceId al que colgarla. Antes de ingestar no hay a que
       * asignar nada, porque el identificador lo decide la descarga.
       */
      const i = args.indexOf('--campana')
      const campanaId = i === -1 ? undefined : args[i + 1]
      await publicarFuente(db, ownerId, sourceId, campanaId)
      log.info(`${sourceId} publicado en el panel`)
      return
    }

    case 'select':
    // El atajo de musica tambien escribe clips.json, asi que tambien hay que
    // contarselo al panel. Sin esto sus cortes no llegarian nunca a Revisar.
    case 'momentos':
    case 'render': {
      await publicarFuente(db, ownerId, sourceId)
      const n = await publicarClips(db, ownerId, sourceId)
      log.info(`${n} momento(s) de ${sourceId} publicados en el panel`)
      return
    }

    case 'variants': {
      const n = await publicarVariantes(db, ownerId, sourceId)
      log.info(`${n} copia(s) de ${sourceId} anotadas en el panel`)
      return
    }

    default:
      return
  }
}
