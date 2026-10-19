/**
 * Fase 7: sube copias de revision a la nube.
 *
 *   npm run subir -- <sourceId>
 *   npm run subir -- <sourceId> --rehacer     (vuelve a subir las que ya estan)
 *
 * El panel vive en un servidor y los MP4 en este ordenador, asi que desde el
 * movil no se veia ningun video. Esto sube una copia ligera de cada clip para
 * que la compuerta de aprobacion funcione desde cualquier sitio.
 *
 * NO SUBE EL MASTER. Un clip terminado son 30 MB de mediana y el plan gratuito
 * de Storage es 1 GB; lo que viaja es una copia de 540x960 de algo mas de un
 * mega, que es lo justo para decidir si el clip vale. El master se queda aqui,
 * que es de donde se publica y de donde salen las variantes.
 */
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { crearCopia } from '../src/render/copia.js'
import { connect } from '../src/store/db.js'
import { crearNube, rutaClip } from '../src/store/nube.js'
import { createStore } from '../src/store/pg.js'
import { rutaFotograma } from '../src/render/render.js'

async function main(): Promise<void> {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { rehacer: { type: 'boolean', default: false } },
  })

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run subir -- <sourceId> [--rehacer]')
    process.exit(1)
  }

  const nube = crearNube()
  if (nube === null) {
    console.error(
      'Falta SUPABASE_SERVICE_ROLE_KEY en el .env.\n' +
        'Esta en el panel de Supabase, en Project Settings -> API -> service_role.\n' +
        'Es la clave que salta las politicas de acceso: no la pongas en ningun sitio publico.',
    )
    process.exit(1)
  }

  const db = await connect(requireEnv('DATABASE_URL'))
  const store = createStore(db, OWNER_ID)

  try {
    console.log(`Cubo en ${nube.url}: ${await nube.asegurarCubo()}`)

    const todos = (await store.clips.all()).filter((c) => c.sourceId === sourceId)
    if (todos.length === 0) {
      console.error(`${sourceId} todavia no tiene momentos elegidos.`)
      console.error('En su ficha de Inicio, pulsa "Buscar los mejores momentos".')
      process.exit(1)
    }

    /*
     * Solo los que tienen master en disco.
     *
     * Un clip sin renderizar no tiene nada que copiar, y uno cuyo master se
     * borro para hacer sitio tampoco. Se avisa de cuantos se saltan en vez de
     * fallar: que falte el archivo de tres de treinta no es motivo para no
     * subir los veintisiete que si estan.
     */
    const conMaster = todos.filter((c) => c.masterPath !== '' && existsSync(c.masterPath))
    const sinMaster = todos.length - conMaster.length

    /*
     * Los descartados NO se suben.
     *
     * La copia existe para que alguien decida desde el movil. Un clip que ya se
     * descarto no necesita que nadie lo mire otra vez, y subirlo gasta el unico
     * recurso escaso que hay: el giga del plan gratuito.
     *
     * Medido el 2026-10-03: kick-cuenta-ejemplo-114acf735a tenia sus quince
     * clips descartados y ocupaba 110 MB en la nube, casi una cuarta parte del
     * total. Y peor, `npm run limpiar` los borraba y la siguiente pasada de
     * `subir` los volvia a poner, porque para el criterio de "le falta la
     * copia" eran candidatos como cualquier otro: las dos herramientas tiraban
     * la una de la otra.
     *
     * Con --rehacer tampoco: rehacer significa regenerar las copias que tocan,
     * no resucitar las de lo descartado.
     */
    const revisables = conMaster.filter((c) => c.status !== 'rejected')
    const descartados = conMaster.length - revisables.length

    const pendientes = values.rehacer ? revisables : revisables.filter((c) => c.proxyPath === '')

    console.log(
      `${todos.length} momentos | ${conMaster.length} con video | ` +
        `${pendientes.length} por subir` +
        (descartados > 0 ? ` | ${descartados} descartado(s), no se suben` : '') +
        (sinMaster > 0 ? ` | ${sinMaster} sin archivo` : ''),
    )
    if (pendientes.length === 0) {
      console.log('Nada que hacer. Con --rehacer se vuelven a subir todas.')
      return
    }

    let subidos = 0
    let bytes = 0
    const fallos: { clipId: string; porque: string }[] = []

    // En serie: la codificacion usa la CPU entera y subir en paralelo desde una
    // linea domestica no acelera nada, solo hace que un fallo de red tumbe
    // varias a la vez y sea mas dificil saber cuales quedaron a medias.
    for (const [i, clip] of pendientes.entries()) {
      const etiqueta = `[${i + 1}/${pendientes.length}] ${clip.clipId}`
      try {
        const copia = await crearCopia(clip.masterPath, sourceId, clip.clipId)
        const ruta = rutaClip(OWNER_ID, sourceId, clip.clipId)
        await nube.subir(ruta, copia.path)
        // El fotograma limpio para la vista previa de Estilo, si el render lo
        // dejo. No es imprescindible: sin el, la vista previa enseña el video.
        const foto = rutaFotograma(clip.masterPath)
        if (existsSync(foto)) {
          await nube.subir(ruta.replace(/\.mp4$/i, '.jpg'), foto, 'image/jpeg').catch((e: unknown) =>
            console.warn(`${etiqueta}  sin fotograma: ${e instanceof Error ? e.message : String(e)}`))
        }

        /*
         * Se anota DESPUES de que la subida vuelva bien.
         *
         * Al reves, un corte de red dejaria el clip marcado como subido sin
         * estarlo, y el panel enseñaria un reproductor que no carga nunca. Al
         * anotar despues, lo peor que pasa es un objeto en la nube que nadie
         * apunta, y la siguiente pasada lo sobrescribe.
         */
        await store.clips.marcarCopia(sourceId, clip.clipId, ruta, copia.bytes)

        subidos += 1
        bytes += copia.bytes
        console.log(`${etiqueta}  ${(copia.bytes / 1048576).toFixed(2)} MB`)
      } catch (error) {
        const porque = error instanceof Error ? error.message : String(error)
        fallos.push({ clipId: clip.clipId, porque })
        console.error(`${etiqueta}  FALLO: ${porque}`)
      }
    }

    console.log('')
    console.log(`Subidos ${subidos} de ${pendientes.length} (${(bytes / 1048576).toFixed(1)} MB)`)

    if (fallos.length > 0) {
      console.log('')
      console.log('No subieron:')
      for (const f of fallos) console.log(`  ${f.clipId}: ${f.porque}`)
      // Salida distinta de cero para que el panel marque el trabajo como
      // fallido: "subidos 27 de 30" en verde se lee como que fue bien.
      process.exitCode = 1
    }

    // Cuanto hay en la nube en total, que es el numero que dice cuando toca
    // limpiar. El plan gratuito son 1024 MB.
    const total = (await store.clips.all()).reduce((n, c) => n + c.proxyBytes, 0)
    console.log(`En la nube: ${(total / 1048576).toFixed(0)} MB de 1024 del plan gratuito.`)
  } finally {
    await db.close()
  }
}

await main()
