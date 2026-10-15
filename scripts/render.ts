/**
 * Fase 3: clips.json (o cortes manuales) -> MP4 verticales publicables
 *
 *   npm run render -- <sourceId>
 *   npm run render -- <sourceId> --clip 1801-1845 --clip 2400-2455
 *   npm run render -- <sourceId> --no-subs
 *
 * La opcion --clip existe para poder validar el render sin depender de la
 * Fase 2. Acepta "inicio-fin" en segundos y se puede repetir.
 */
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnv, paths } from '../src/lib/env.js'
import { readJson, workDir } from '../src/lib/fsx.js'
import { formatDuration } from '../src/lib/logger.js'
import { beginRun } from '../src/store/runs.js'
import type { AssOptions } from '../src/render/ass.js'
import { buildContactSheet, renderClip, type RenderClip } from '../src/render/render.js'
import type { ValidatedClip } from '../src/select/schema.js'
import type { Transcript } from '../src/types.js'

interface ClipsFile {
  sourceId: string
  clips: ValidatedClip[]
}

function parseManualClip(spec: string): RenderClip {
  const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(spec.trim())
  if (match === null) {
    throw new Error(`Formato invalido en --clip "${spec}". Se espera inicio-fin, por ejemplo 1801-1845.`)
  }
  const start = Number(match[1])
  const end = Number(match[2])
  if (end <= start) throw new Error(`--clip "${spec}": el fin debe ser mayor que el inicio.`)
  return { start, end }
}

async function main(): Promise<void> {
  loadEnv()

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      clip: { type: 'string', multiple: true },
      limit: { type: 'string' },
      sheet: { type: 'boolean', default: true },
      // En negativo porque quemar los subtitulos es lo normal: asi la linea de
      // comando de siempre sigue significando lo mismo que significaba.
      'no-subs': { type: 'boolean', default: false },
      // Sin valor por defecto: sin la bandera, buildAss usa el suyo (o la
      // variable de entorno). Poner aqui un 72 duplicaria ese valor en dos
      // sitios y el dia que cambie uno, el otro se queda viejo.
      'sub-font': { type: 'string' },
      'sub-size': { type: 'string' },
      'sub-margin': { type: 'string' },
      // Rotulos cortos al ritmo del habla, con entrada animada. Sin esto, un
      // rotulo por segmento, que es lo de siempre.
      'sub-words': { type: 'string' },
      'sub-animate': { type: 'boolean', default: false },
      'sub-color': { type: 'string' },
      'sub-color-borde': { type: 'string' },
      'sub-borde': { type: 'string' },
      /*
       * Rotulo de titulo, quemado arriba del video.
       *
       * Sin --titulo-texto no hay rotulo. El resto son el estilo y solo
       * importan cuando hay texto; cada uno sin valor por defecto aqui, por
       * lo mismo que los de subtitulo: el defecto vive en buildAss y no se
       * duplica.
       */
      'titulo-texto': { type: 'string' },
      'titulo-arriba': { type: 'string' },
      'titulo-tam': { type: 'string' },
      'titulo-color': { type: 'string' },
      'titulo-color-borde': { type: 'string' },
      'titulo-borde': { type: 'string' },
      // Rehacer un solo clip, en su sitio. Ver el bloque de abajo.
      solo: { type: 'string' },
    },
  })

  // Solo las que vienen. Un `fontSize: NaN` seria peor que no pasar nada:
  // acabaria escrito en el .ass y libass no dibujaria ningun subtitulo.
  const sub: AssOptions = {}
  if (values['sub-font'] !== undefined) sub.fontName = values['sub-font']
  if (values['sub-size'] !== undefined) sub.fontSize = Number(values['sub-size'])
  if (values['sub-margin'] !== undefined) sub.marginV = Number(values['sub-margin'])
  if (values['sub-words'] !== undefined) sub.wordsPerCue = Number(values['sub-words'])
  if (values['sub-animate']) sub.animate = true
  if (values['sub-color'] !== undefined) sub.color = values['sub-color']
  if (values['sub-color-borde'] !== undefined) sub.colorBorde = values['sub-color-borde']
  if (values['sub-borde'] !== undefined) sub.borde = Number(values['sub-borde'])
  if (values['titulo-arriba'] !== undefined) sub.tituloArriba = Number(values['titulo-arriba'])
  if (values['titulo-tam'] !== undefined) sub.tituloTam = Number(values['titulo-tam'])
  if (values['titulo-color'] !== undefined) sub.tituloColor = values['titulo-color']
  if (values['titulo-color-borde'] !== undefined) {
    sub.tituloColorBorde = values['titulo-color-borde']
  }
  if (values['titulo-borde'] !== undefined) sub.tituloBorde = Number(values['titulo-borde'])
  for (const [k, v] of Object.entries(sub)) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      console.error(`--${k} no es un numero.`)
      process.exit(1)
    }
  }

  const sourceId = positionals[0]
  if (sourceId === undefined) {
    console.error('Uso: npm run render -- <sourceId> [--clip 1801-1845] [--limit 5]')
    process.exit(1)
  }

  const dir = workDir(sourceId)

  const transcriptPath = join(dir, 'transcript.json')
  if (!existsSync(transcriptPath)) {
    console.error(`A ${sourceId} le falta el texto de lo que se dice.`)
    console.error('Vuelve a añadirlo desde Inicio: la descarga saca el texto sola.')
    process.exit(1)
  }
  const transcript = readJson<Transcript>(transcriptPath)

  const sourceVideo = join(dir, 'source.mp4')
  if (!existsSync(sourceVideo)) {
    console.error(`No existe ${sourceVideo}.`)
    process.exit(1)
  }

  /*
   * REHACER UN SOLO CLIP, CONSERVANDO SU SITIO.
   *
   * El nombre del fichero de un clip sale de su POSICION en clips.json:
   * el tercero es clip-03.mp4, y asi es como la base lo encuentra. Renderizar
   * uno suelto con --clip lo escribiria como clip-01 y pisaria al primero.
   *
   * Con --solo clip-03 se renderiza unicamente ese, en su indice, con el mismo
   * nombre de fichero. Es lo que permite ajustar el corte de un momento desde
   * el panel sin rehacer el VOD entero: un clip son veinte segundos de GPU,
   * cuarenta y cinco son veinte minutos.
   *
   * Si ademas viene --clip, esos son los limites nuevos. Sin el, se rehace con
   * los que ya tenia, que es lo que hace falta cuando lo que cambio fue el
   * estilo (otro color de subtitulo, el rotulo encendido) y no el corte.
   */
  if (values.solo !== undefined) {
    const m = /^clip-(\d+)$/.exec(values.solo.trim())
    if (m === null) {
      console.error(`--solo "${values.solo}" no tiene la forma clip-03.`)
      process.exit(1)
    }
    const indice = Number(m[1])
    const clipsPath = join(dir, 'clips.json')
    if (!existsSync(clipsPath)) {
      console.error(`No existe ${clipsPath}, asi que no se sabe que momento es ${values.solo}.`)
      process.exit(1)
    }
    const file = readJson<ClipsFile>(clipsPath)
    const previo = file.clips[indice - 1]
    if (previo === undefined) {
      console.error(`${sourceId} no tiene ningun ${values.solo}: solo hay ${file.clips.length}.`)
      process.exit(1)
    }

    const manual = values.clip !== undefined && values.clip.length > 0
      ? parseManualClip(values.clip[0] ?? '')
      : null
    const uno: RenderClip = {
      start: manual?.start ?? previo.start,
      end: manual?.end ?? previo.end,
      caption: previo.caption,
    }

    /*
     * clips.json se actualiza con los limites nuevos.
     *
     * Es la fuente de la que sale todo lo demas -- publicarClips la relee para
     * refrescar la base -- asi que dejarla con los viejos haria que el panel
     * dijera 20-50 mientras el mp4 dura treinta segundos distintos. El
     * fichero se reescribe entero y solo cambia una entrada.
     */
    if (manual !== null) {
      file.clips[indice - 1] = { ...previo, start: uno.start, end: uno.end }
      writeFileSync(clipsPath, JSON.stringify(file, null, 2), 'utf8')
    }

    const run = beginRun('render', sourceId, `Rehacer ${values.solo}`)
    try {
      const result = await renderClip(transcript, sourceVideo, uno, indice, {
        subtitles: !values['no-subs'],
        sub,
        ...(values['titulo-texto'] === undefined ? {} : { rotulo: values['titulo-texto'] }),
      })
      run.finish({
        input: { clip: values.solo, start: uno.start, end: uno.end },
        output: { archivo: result.path },
      })
      console.log(`${values.solo} rehecho: ${uno.start.toFixed(1)}s -> ${uno.end.toFixed(1)}s`)
    } catch (error) {
      run.fail(error)
      throw error
    }
    return
  }

  let clips: RenderClip[]

  if (values.clip !== undefined && values.clip.length > 0) {
    clips = values.clip.map(parseManualClip)
    console.log(`Cortes manuales: ${clips.length}`)
  } else {
    const clipsPath = join(dir, 'clips.json')
    if (!existsSync(clipsPath)) {
      console.error(
        `No existe ${clipsPath} y no se dieron cortes con --clip.\n` +
          'Ejecuta la Fase 2 (npm run select) o pasa cortes manuales.',
      )
      process.exit(1)
    }
    const file = readJson<ClipsFile>(clipsPath)
    clips = file.clips.map((c) => ({ start: c.start, end: c.end, caption: c.caption }))
    console.log(`Clips desde clips.json: ${clips.length}`)
  }

  const limit = values.limit === undefined ? clips.length : Number(values.limit)
  clips = clips.slice(0, limit)

  const startedAt = performance.now()
  const rendered: string[] = []
  const run = beginRun('render', sourceId, `Renderizar ${clips.length} clips`)

  try {
    // En serie a proposito: hay un solo chip NVENC, paralelizar no acelera y
    // ademas compite por VRAM con el decodificador.
    for (const [i, clip] of clips.entries()) {
      const result = await renderClip(transcript, sourceVideo, clip, i + 1, {
        subtitles: !values['no-subs'],
        sub,
        ...(values['titulo-texto'] === undefined ? {} : { rotulo: values['titulo-texto'] }),
      })
      rendered.push(result.path)
    }
  } catch (error) {
    run.fail(error)
    throw error
  }

  const elapsed = performance.now() - startedAt

  // El tamaño en disco es el dato que avisa de que te estas quedando sin sitio:
  // 37 clips son 3,5 GB y cada VOD nuevo suma otro tanto.
  const bytes = rendered.reduce((total, p) => total + (existsSync(p) ? statSync(p).size : 0), 0)

  run.finish({
    input: { clips: clips.length },
    output: { archivos: rendered.length, MB: Math.round(bytes / 1048576) },
  })

  if (values.sheet && rendered.length > 0) {
    await buildContactSheet(rendered, join(paths.out, sourceId, 'contact-sheet.png'))
  }

  console.log('')
  console.log('='.repeat(72))
  console.log(`Clips renderizados : ${rendered.length}`)
  console.log(`Tiempo total       : ${formatDuration(elapsed)}`)
  console.log(
    `Media por clip     : ${formatDuration(elapsed / Math.max(1, rendered.length))}`,
  )
  console.log(`Salida             : ${join(paths.out, sourceId)}`)
  console.log('='.repeat(72))
}

await main()
