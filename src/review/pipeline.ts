import { JOB_KINDS, type JobKind } from '../jobs/cola.js'
import { CLIP_DEFAULTS, FUENTES, ZONA_SEGURA_PX, type ClipSettings } from '../select/ajustes.js'

/**
 * Traduccion de lo que pide el panel a un comando concreto.
 *
 * EL CLIENTE NUNCA ENVIA ARGUMENTOS. Manda un tipo de trabajo y unos parametros
 * con nombre, y aqui se construye la linea de comando. Es la diferencia entre
 * "ejecuta esto" y "haz esta tarea sobre este VOD".
 *
 * Importa porque el panel se expone por un tunel publico. `spawn` sin shell ya
 * evita la inyeccion clasica, pero sin esta capa un argumento como `--output`
 * apuntando a otra ruta, o una URL `file://`, seguirian siendo aceptados. Al
 * armar el comando aqui, lo unico que viaja por la red es un identificador que
 * se comprueba contra la lista de VOD conocidos.
 */

export class BadRequest extends Error {}

/**
 * Un sourceId debe ser conocido y no puede salirse del directorio.
 *
 * Antes se comprobaba mirando si existia la carpeta en disco. Eso solo valia
 * con el panel y los ficheros en el mismo ordenador; el panel ya vive en un
 * servidor que no tiene ninguno de esos directorios, asi que la lista de VOD
 * conocidos la da ahora la base de datos y llega aqui como parametro.
 *
 * La comprobacion de caracteres se queda igual de estricta: el identificador
 * acaba concatenado a una ruta en el ordenador del trabajador, y `..` seguiria
 * permitiendo escribir fuera de su directorio de trabajo.
 */
function requireSource(value: unknown, conocidos: ReadonlySet<string>): string {
  if (typeof value !== 'string' || value === '') {
    throw new BadRequest('Falta el identificador del VOD.')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequest('El identificador del VOD tiene caracteres no permitidos.')
  }
  if (!conocidos.has(value)) {
    throw new BadRequest(`No existe el VOD ${value}.`)
  }
  return value
}

/**
 * Valida la URL de origen.
 *
 * Solo http y https. Sin esto se aceptaria `file:///C:/...`, que convertiria el
 * panel en un lector de ficheros arbitrarios del disco a traves de yt-dlp.
 */
function requireUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequest('Falta la URL del video.')
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new BadRequest('La URL no es valida.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequest('Solo se admiten direcciones http o https.')
  }
  return parsed.toString()
}

/** Numero dentro de un rango. Fuera de el, se rechaza en vez de recortarse. */
function requireNumber(value: unknown, name: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadRequest(`${name} debe ser un numero entre ${min} y ${max}.`)
  }
  return n
}

export interface BuiltJob {
  kind: JobKind
  args: string[]
  label: string
}

/**
 * Construye el comando a partir de lo que pidio el panel.
 *
 * Lanza BadRequest con un mensaje en claro cuando algo no encaja, para que el
 * panel lo enseñe tal cual en vez de un 500 sin explicacion.
 *
 * `ajustes` son los de la seccion Ajustes, leidos de la base por quien llama.
 * NO VIENEN DEL PANEL a proposito: si el navegador los mandara, una pestaña
 * abierta desde ayer cortaria con los valores de ayer sin que nadie lo note.
 * Leerlos aqui hace que lo guardado sea siempre lo aplicado. Los parametros
 * explicitos siguen ganando, que es lo que permite probar un corte distinto sin
 * guardar nada.
 */
export function buildJob(
  kind: unknown,
  params: Record<string, unknown>,
  conocidos: ReadonlySet<string>,
  ajustes: ClipSettings = CLIP_DEFAULTS,
): BuiltJob {
  if (typeof kind !== 'string' || !JOB_KINDS.includes(kind as JobKind)) {
    throw new BadRequest(`Tipo de trabajo desconocido: ${String(kind)}`)
  }

  switch (kind as JobKind) {
    case 'doctor':
      return { kind: 'doctor', args: [], label: 'Diagnostico del entorno' }

    // Una llamada minima a la IA desde el PC. El resultado se guarda en ia_estado.
    case 'probar-ia':
      return { kind: 'probar-ia', args: [], label: 'Probar IA' }

    case 'ingest': {
      const url = requireUrl(params.url)
      /*
       * La campaña es opcional y se comprueba como uuid, no como texto libre.
       *
       * Acaba en la linea de comando del trabajo. Que ademas exista y sea de
       * este propietario lo verifica publicarFuente contra la base cuando el
       * VOD ya tiene identificador; aqui solo se garantiza la forma.
       *
       * Una cadena vacia es "sin campaña" y no un error: es lo que manda el
       * desplegable cuando se deja en "Sin asignar".
       */
      const campana = params.campanaId
      // Video musical: al terminar se buscan estribillos, sin IA (ver cadena.ts).
      const musica = params.tipo === 'musica' ? ['--musica'] : []
      if (campana === undefined || campana === '') {
        return { kind: 'ingest', args: [url, ...musica], label: `Descargar y transcribir` }
      }
      if (
        typeof campana !== 'string' ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(campana)
      ) {
        throw new BadRequest('La campaña indicada no es valida.')
      }
      return {
        kind: 'ingest',
        args: [url, '--campana', campana, ...musica],
        label: `Descargar y transcribir`,
      }
    }

    case 'select': {
      const sourceId = requireSource(params.sourceId, conocidos)
      const args = [sourceId]

      // Lo guardado es el valor de partida; lo que venga en params lo pisa. Los
      // rangos son los mismos que valida select/ajustes.ts, asi que un valor
      // salido de la base nunca puede fallar aqui.
      const maxPerWindow = params.maxPerWindow ?? ajustes.perWindow
      const windowSec = params.windowSec ?? ajustes.windowSec
      const minSec = params.minSec ?? ajustes.minSec
      const maxSec = params.maxSec ?? ajustes.maxSec

      args.push('--max-per-window', String(requireNumber(maxPerWindow, 'Clips por ventana', 1, 6)))
      args.push('--window', String(requireNumber(windowSec, 'Tamaño de ventana', 300, 1800)))
      args.push('--min', String(requireNumber(minSec, 'Duración mínima', 10, 60)))
      args.push('--max', String(requireNumber(maxSec, 'Duración máxima', 30, 180)))

      return { kind: 'select', args, label: `Buscar momentos de ${sourceId}` }
    }

    /*
     * El atajo para musica, el que no gasta la API.
     *
     * `select` le pregunta a un modelo donde estan los mejores momentos: cuesta
     * dinero y se para en seco cuando se acaba el saldo. Para un VOD de musica no
     * hace falta preguntar, porque los picos de energia del audio marcan los
     * estribillos igual de bien y salen de medir el propio fichero.
     *
     * Es un trabajo del panel porque hasta ahora el unico sitio donde se
     * mencionaba era el mensaje de error de `select`: "para musica hay un atajo
     * que no la usa: npm run momentos". Ofrecer la salida solo por una terminal,
     * en un panel que existe para no abrir terminales, es no ofrecerla.
     *
     * Siempre con --aplicar. Sin esa bandera solo imprime una tabla, y una tarea
     * que acaba en verde sin dejar nada hecho se lee como un fallo silencioso.
     */
    case 'momentos': {
      const sourceId = requireSource(params.sourceId, conocidos)
      const args = [sourceId, '--aplicar']
      if (params.cuantos !== undefined) {
        args.push('--cuantos', String(requireNumber(params.cuantos, 'Cuantos momentos', 1, 12)))
      }
      if (params.dur !== undefined) {
        args.push('--dur', String(requireNumber(params.dur, 'Duracion', 10, 90)))
      }
      return { kind: 'momentos', args, label: `Buscar estribillos de ${sourceId}` }
    }

    case 'render': {
      const sourceId = requireSource(params.sourceId, conocidos)
      const args = [sourceId]

      /*
       * REHACER UN SOLO MOMENTO, con o sin corte nuevo.
       *
       * No es un tipo de trabajo aparte. Cada `kind` es el nombre de un
       * fichero de scripts/ que el trabajador ejecuta tal cual, asi que un
       * 'recorte' pediria un script nuevo y una entrada mas en la lista que
       * es la frontera de seguridad. Es el mismo render con otra bandera.
       *
       * El identificador se comprueba contra una forma exacta y no se
       * interpola sin mirar: acaba en la linea de comando del trabajador.
       */
      let soloUno = ''
      if (params.clipId !== undefined) {
        soloUno = String(params.clipId)
        if (!/^clip-\d{1,3}$/.test(soloUno)) {
          throw new BadRequest(`"${soloUno}" no tiene la forma clip-03.`)
        }
        args.push('--solo', soloUno)

        /*
         * Los limites nuevos, si los hay. Sin ellos se rehace con los suyos,
         * que es lo que hace falta cuando lo que cambio fue el estilo.
         *
         * El tope de 6 horas no es un capricho: un VOD mas largo que eso no
         * ha existido nunca aqui, y sin tope un numero absurdo acabaria en
         * un -ss que deja a ffmpeg buscando hasta el final del fichero.
         */
        if (params.start !== undefined || params.end !== undefined) {
          const ini = requireNumber(params.start, 'Inicio del corte', 0, 21600)
          const fin = requireNumber(params.end, 'Fin del corte', 0, 21600)
          if (fin <= ini) {
            throw new BadRequest('El final del corte tiene que ir después del principio.')
          }
          // Los mismos limites de duracion que valida Ajustes, para que un
          // recorte a mano no produzca un clip que TikTok rechaza por corto.
          const dur = fin - ini
          if (dur < 5 || dur > 180) {
            throw new BadRequest('Un momento tiene que durar entre 5 segundos y 3 minutos.')
          }
          args.push('--clip', `${ini.toFixed(2)}-${fin.toFixed(2)}`)
        }
      }

      // --limit no tiene sentido con --solo: ya es uno.
      if (params.limit !== undefined && soloUno === '') {
        args.push('--limit', String(requireNumber(params.limit, 'Limite', 1, 200)))
      }
      // Bandera solo para apagarlos: quemarlos es lo normal y lo que hacia
      // antes de que esto fuera configurable. Un `--subs` redundante en la
      // linea de comando de cada render no informa de nada.
      const subtitles = params.subtitles ?? ajustes.subtitles
      if (subtitles === false) {
        args.push('--no-subs')
      } else {
        /*
         * El estilo solo viaja si hay subtitulos que estilizar.
         *
         * La fuente NO se valida con requireNumber ni se deja pasar: llega de
         * la base, donde solo puede haber entrado por validateClipSettings,
         * pero acaba en un fichero .ass separado por comas. Se comprueba aqui
         * tambien porque es la ultima puerta antes de la linea de comando.
         */
        if (!FUENTES.includes(ajustes.subFont as (typeof FUENTES)[number])) {
          throw new BadRequest(`La tipografia ${ajustes.subFont} no esta en la lista.`)
        }
        args.push('--sub-font', ajustes.subFont)
        args.push('--sub-size', String(requireNumber(ajustes.subSize, 'Cuerpo del subtítulo', 40, 120)))
        args.push('--sub-margin', String(requireNumber(ajustes.subMargin, 'Altura del subtítulo', ZONA_SEGURA_PX, 900)))

        /*
         * Color y borde se comprueban aqui tambien, como la fuente.
         *
         * Acaban en la linea `Style:` de un fichero .ass, que separa por comas.
         * Vienen de la base, donde solo pueden haber entrado por
         * validateClipSettings, pero esta es la ultima puerta antes de la linea
         * de comando y es barata.
         */
        for (const [bandera, valor] of [
          ['--sub-color', ajustes.subColor],
          ['--sub-color-borde', ajustes.subColorBorde],
        ] as const) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(valor)) {
            throw new BadRequest(`El color ${valor} no tiene la forma #RRGGBB.`)
          }
          args.push(bandera, valor)
        }
        args.push('--sub-borde', String(requireNumber(ajustes.subBorde, 'Grosor del borde', 0, 20)))
        args.push('--sub-words', String(requireNumber(ajustes.subPalabras, 'Palabras por rótulo', 1, 7)))
        if (ajustes.subAnimacion) args.push('--sub-animate')
      }

      /*
       * El rotulo de titulo va FUERA del bloque de subtitulos.
       *
       * Son dos cosas independientes: se puede querer un clip limpio con una
       * frase arriba, o subtitulos sin rotulo. Meterlo dentro del else ataria
       * el rotulo a que los subtitulos esten encendidos, que no tiene nada
       * que ver.
       */
      if (ajustes.tituloActivo) {
        /*
         * Sin {titulo} no se manda nada.
         *
         * validateClipSettings ya lo exige al guardar y ajustesDeFila cae al
         * valor por defecto al leer, asi que llegar aqui sin el significa que
         * alguien escribio en la base a mano. Encender el rotulo con texto
         * fijo quemaria la misma frase en los cien clips del VOD.
         */
        if (!ajustes.tituloTexto.includes('{titulo}')) {
          throw new BadRequest('El rótulo del video debe incluir {titulo}.')
        }
        args.push('--titulo-texto', ajustes.tituloTexto)
        args.push(
          '--titulo-arriba',
          String(requireNumber(ajustes.tituloArriba, 'Altura del rótulo', 80, 700)),
        )
        args.push('--titulo-tam', String(requireNumber(ajustes.tituloTam, 'Cuerpo del rótulo', 36, 110)))
        // Los colores, por la misma puerta que los del subtitulo y por el
        // mismo motivo: acaban en una linea separada por comas de un .ass.
        for (const [bandera, valor] of [
          ['--titulo-color', ajustes.tituloColor],
          ['--titulo-color-borde', ajustes.tituloColorBorde],
        ] as const) {
          if (!/^#[0-9A-Fa-f]{6}$/.test(valor)) {
            throw new BadRequest(`El color ${valor} no tiene la forma #RRGGBB.`)
          }
          args.push(bandera, valor)
        }
        args.push(
          '--titulo-borde',
          String(requireNumber(ajustes.tituloBorde, 'Borde del rótulo', 0, 20)),
        )
      }

      return {
        kind: 'render',
        args,
        label: soloUno === '' ? `Armar clips de ${sourceId}` : `Volver a armar ${soloUno} de ${sourceId}`,
      }
    }

    case 'subir': {
      const sourceId = requireSource(params.sourceId, conocidos)
      const args = [sourceId]
      // Rehacer las copias solo si se pide. Por defecto sube las que faltan,
      // que es lo normal: recodificar treinta clips ya subidos son dos minutos
      // de CPU para dejar los mismos ficheros.
      if (params.rehacer === true) args.push('--rehacer')
      return { kind: 'subir', args, label: `Subir para revisar ${sourceId}` }
    }

    case 'variants': {
      const sourceId = requireSource(params.sourceId, conocidos)
      return { kind: 'variants', args: [sourceId], label: `Generar variantes de ${sourceId}` }
    }

    case 'schedule': {
      const args: string[] = []
      if (params.days !== undefined) {
        args.push('--days', String(requireNumber(params.days, 'Dias', 1, 14)))
      }
      return { kind: 'schedule', args, label: 'Planificar la cola' }
    }

    case 'accounts':
      return { kind: 'accounts', args: [], label: 'Revisar cuentas' }

    case 'metrics': {
      // Sin flag no hace nada: hay que decirle si toma lecturas nuevas del
      // proveedor o si solo reconstruye el informe con lo ya guardado.
      const mode = params.mode === 'collect' ? 'collect' : 'feedback'
      return {
        kind: 'metrics',
        args: [`--${mode}`],
        label: mode === 'collect' ? 'Tomar lecturas nuevas' : 'Recalcular el informe',
      }
    }

    case 'publish': {
      // El script ya es simulacro por defecto (`live = live && !dry-run`), asi
      // que solo hay que añadir --live cuando se quiere publicar de verdad.
      // Se respeta esa asimetria en vez de pasar --dry-run redundante: el modo
      // peligroso debe exigir un gesto explicito tambien desde aqui.
      const args: string[] = []
      if (params.live === true) args.push('--live')
      if (params.limit !== undefined) {
        args.push('--limit', String(requireNumber(params.limit, 'Limite', 1, 60)))
      }
      return {
        kind: 'publish',
        args,
        label: params.live === true ? 'Publicar de verdad' : 'Publicar (simulacro)',
      }
    }
  }
}
