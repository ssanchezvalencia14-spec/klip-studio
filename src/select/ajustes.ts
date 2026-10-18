import type { Db as DbLike } from '../store/db.js'

/**
 * Como se cortan los videos.
 *
 * Separado de FlowSettings a proposito, aunque compartan fila en la tabla:
 * aquello regula la PUBLICACION y cada guardado suyo recalcula las franjas de
 * todas las cuentas. Esto regula la GENERACION, y guardarlo no debe tocar
 * ningun horario.
 *
 * Todos los valores por defecto son los que ya estaban en el codigo, asi que un
 * propietario sin fila se comporta igual que antes de que esto existiera.
 */
export interface ClipSettings {
  /** Duracion minima de un clip, en segundos. */
  minSec: number
  /** Duracion maxima de un clip, en segundos. */
  maxSec: number
  /** Cuantos momentos como mucho se eligen de cada trozo del VOD. */
  perWindow: number
  /** Tamaño del trozo que se le da al modelo de una vez, en segundos. */
  windowSec: number
  /** Quemar los subtitulos en el video. */
  subtitles: boolean
  /** Tipografia de los subtitulos. Una de FUENTES. */
  subFont: string
  /** Cuerpo de los subtitulos, en pixeles del lienzo de 1920. */
  subSize: number
  /** Cuanto se levantan sobre el borde inferior, en pixeles del lienzo. */
  subMargin: number
  /** Color del texto, en #RRGGBB. */
  subColor: string
  /** Color del borde que rodea cada letra, en #RRGGBB. */
  subColorBorde: string
  /** Grosor de ese borde, en pixeles del lienzo. */
  subBorde: number
  /** Cuantas palabras como mucho entran en cada rotulo. */
  subPalabras: number
  /** Si cada rotulo entra con una pequeña animacion. */
  subAnimacion: boolean
  /**
   * Plantilla del texto que acompaña al video.
   *
   * {titulo} es el pie que propuso el modelo y {hashtags} las etiquetas ya con
   * almohadilla. Estaba cosido dentro de cada proveedor de publicacion, con lo
   * que cambiar el orden o meter una linea fija obligaba a tocar codigo.
   */
  textoPlantilla: string
  /** Etiquetas que se añaden siempre. Separadas por comas, sin almohadilla. */
  hashtagsFijos: string
  /** Quien ve lo que se publica en directo. */
  privacidad: string
  /** Tope de publicaciones por minuto y cuenta. */
  maxPorMinuto: number
  /** Tope de publicaciones al dia y cuenta. */
  maxPorDia: number
  /**
   * Cuantas cuentas se atienden a la vez al publicar.
   *
   * El trabajador publicaba estrictamente en serie. Con dos cuentas da igual;
   * con doscientas, una pasada tardaria horas y se solaparia con la siguiente.
   * Nunca se publican dos envios de la MISMA cuenta a la vez: el paralelismo
   * es entre cuentas, que es donde no hay topes compartidos.
   */
  concurrencia: number
  /**
   * Por donde se publica: 'upload-post' o 'tiktok'.
   *
   * Vivia en el .env y en scripts/publicar.cmd, o sea en el ordenador de casa.
   * Cambiarlo obligaba a editar dos ficheros a mano.
   */
  proveedor: string
  /** 'direct' publica en el perfil; 'draft' lo deja en la bandeja del titular. */
  modo: string

  /**
   * Quien elige los momentos: 'anthropic' o 'local'.
   *
   * Vivia en SELECT_PROVIDER, dentro del .env del ordenador de casa. Cuando la
   * clave de Anthropic quedo rechazada, procesar un VOD fallaba y la salida
   * -- el modelo local -- exigia editar un fichero y reiniciar. Un panel que
   * no puede cambiar de motor cuando el motor se rompe no sirve de mucho.
   *
   * El entorno sigue mandando sobre esto, a proposito: para una prueba suelta
   * desde consola es mas comodo que tocar la base.
   */
  selector: string

  /*
   * ROTULO DE TITULO, quemado arriba del video.
   *
   * No es lo mismo que textoPlantilla: aquello es el texto que acompaña a la
   * publicacion y se lee aparte; esto va DENTRO del video. Quien pasa deprisa
   * por TikTok ve la imagen y no el pie, y un clip sin rotulo no se entiende
   * hasta que lleva tres segundos vistos, que es justo lo que no tiene.
   */
  /** Si se quema el rotulo. Nace apagado: encenderlo cambia todos los videos. */
  tituloActivo: boolean
  /** Que se escribe. {titulo} es el pie que propuso el modelo para ese clip. */
  tituloTexto: string
  /** Altura desde ARRIBA, en pixeles del lienzo de 1920. */
  tituloArriba: number
  /** Cuerpo del rotulo, en pixeles del lienzo. */
  tituloTam: number
  tituloColor: string
  tituloColorBorde: string
  tituloBorde: number
}

export const CLIP_DEFAULTS: ClipSettings = {
  minSec: 20,
  maxSec: 90,
  perWindow: 3,
  windowSec: 900,
  subtitles: true,
  subFont: 'Impact',
  subSize: 72,
  subMargin: 380,
  subColor: '#FFFFFF',
  subColorBorde: '#000000',
  subBorde: 7,
  subPalabras: 3,
  subAnimacion: true,
  textoPlantilla: '{titulo} {hashtags}',
  hashtagsFijos: '',
  privacidad: 'PUBLIC_TO_EVERYONE',
  maxPorMinuto: 5,
  maxPorDia: 13,
  // Uno por defecto: el comportamiento de siempre. Subirlo es una decision.
  concurrencia: 1,
  proveedor: 'upload-post',
  modo: 'direct',
  selector: 'anthropic',
  tituloActivo: false,
  tituloTexto: '{titulo}',
  tituloArriba: 240,
  tituloTam: 64,
  tituloColor: '#FFFFFF',
  tituloColorBorde: '#000000',
  tituloBorde: 6,
}

/**
 * Tipografias admitidas. Lista cerrada, y no por gusto.
 *
 * El nombre se escribe tal cual en la linea `Style:` del fichero .ass, que es
 * un formato separado por comas. Una fuente con una coma en el nombre correria
 * todos los campos siguientes una posicion y produciria subtitulos con el
 * tamaño en el sitio del color. Con una lista cerrada eso no puede pasar.
 *
 * Ademas libass resuelve la fuente POR NOMBRE contra las instaladas en el
 * ordenador que renderiza. Un nombre que no existe no da error: cae en
 * silencio a otra fuente y los clips salen distintos sin avisar. Estas cinco
 * estan comprobadas en el PC que hace el render.
 */
export const FUENTES = ['Impact', 'Arial Black', 'Segoe UI Black', 'Verdana', 'Tahoma'] as const

/**
 * Limites de cada perilla.
 *
 * DEBEN COINCIDIR CON LOS DE buildJob en review/pipeline.ts. Si divergen, el
 * panel ofrece un valor que el servidor rechaza despues, y el usuario ve un
 * error al lanzar el trabajo sin entender que ha hecho mal.
 */
type Numericos = Exclude<
  keyof ClipSettings,
  | 'subtitles'
  | 'subFont'
  | 'subAnimacion'
  | 'subColor'
  | 'subColorBorde'
  | 'textoPlantilla'
  | 'hashtagsFijos'
  | 'privacidad'
  | 'proveedor'
  | 'modo'
  | 'selector'
  | 'tituloActivo'
  | 'tituloTexto'
  | 'tituloColor'
  | 'tituloColorBorde'
>

const LIMITS: Record<Numericos, [number, number]> = {
  minSec: [10, 60],
  maxSec: [30, 180],
  perWindow: [1, 6],
  windowSec: [300, 1800],
  // Por debajo de 40 px no se lee en un movil; por encima de 120 con Impact
  // dos lineas ya tapan al hablante.
  subSize: [40, 120],
  // 0 lo pega al borde, donde la interfaz de TikTok lo tapa. 900 lo sube por
  // encima del centro del encuadre, que es donde esta la cara.
  subMargin: [120, 900],
  // Sin borde el texto blanco desaparece sobre fondo claro; pasado de 20 las
  // letras se empastan entre si y no se lee nada.
  subBorde: [0, 20],
  // Una palabra por rotulo parpadea sin descanso; mas de siete no caben en dos
  // lineas al cuerpo que se usa.
  subPalabras: [1, 7],
  // Los limites reales de TikTok son 6 por minuto y 15 al dia. Se deja pasar
  // hasta ahi, no mas: por encima el rechazo lo pone la plataforma.
  maxPorMinuto: [1, 6],
  maxPorDia: [1, 15],
  // Mas de ocho subidas a la vez saturan la salida de una conexion domestica
  // antes que cualquier limite del proveedor, y empiezan a fallar por tiempo
  // de espera en vez de ir mas rapido.
  concurrencia: [1, 8],
  /*
   * El rotulo vive en el tercio de arriba y nada mas.
   *
   * Por debajo de 80 px lo tapa la barra de estado del telefono; pasado de
   * 700 se mete en el centro del encuadre, que es donde esta la cara, y
   * ademas empieza a chocar con los subtitulos cuando estos suben.
   */
  tituloArriba: [80, 700],
  // Mas pequeño que 36 no se lee de pasada, que es el unico momento en que se
  // lee. Mas de 110 y dos lineas ocupan medio video.
  tituloTam: [36, 110],
  tituloBorde: [0, 20],
}

/** Lo que TikTok admite como visibilidad de una publicacion directa. */
/** Por donde se puede publicar. */
export const PROVEEDORES = ['upload-post', 'tiktok'] as const
/** Que se hace con el video al llegar. */
export const MODOS = ['direct', 'draft'] as const
/** Quien elige los momentos. */
export const SELECTORES = ['anthropic', 'local'] as const

export const PRIVACIDADES = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
] as const

export class InvalidClipSettings extends Error {}

/** Valida y normaliza. Fuera de rango se rechaza, no se recorta. */
export function validateClipSettings(merged: ClipSettings): ClipSettings {
  for (const [key, [min, max]] of Object.entries(LIMITS) as [
    keyof typeof LIMITS,
    [number, number],
  ][]) {
    const value = merged[key]
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new InvalidClipSettings(`${key} debe estar entre ${min} y ${max}.`)
    }
  }

  if (!FUENTES.includes(merged.subFont as (typeof FUENTES)[number])) {
    throw new InvalidClipSettings(`La tipografia ${merged.subFont} no esta en la lista.`)
  }

  /*
   * Los colores van tal cual a la linea `Style:` del fichero .ass, que separa
   * por comas. Cualquier cosa que no sea exactamente #RRGGBB podria correr los
   * campos siguientes y producir subtitulos con el tamaño en el sitio del
   * color, igual que pasaria con una fuente que llevase coma en el nombre.
   */
  for (const campo of ['subColor', 'subColorBorde', 'tituloColor', 'tituloColorBorde'] as const) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(merged[campo])) {
      throw new InvalidClipSettings(`${campo} debe ser un color como #FFFFFF.`)
    }
  }

  if (!PRIVACIDADES.includes(merged.privacidad as (typeof PRIVACIDADES)[number])) {
    throw new InvalidClipSettings(`La privacidad ${merged.privacidad} no esta en la lista.`)
  }

  if (!PROVEEDORES.includes(merged.proveedor as (typeof PROVEEDORES)[number])) {
    throw new InvalidClipSettings(`El proveedor ${merged.proveedor} no existe.`)
  }
  if (!MODOS.includes(merged.modo as (typeof MODOS)[number])) {
    throw new InvalidClipSettings(`El modo ${merged.modo} no existe.`)
  }
  if (!SELECTORES.includes(merged.selector as (typeof SELECTORES)[number])) {
    throw new InvalidClipSettings(`El selector ${merged.selector} no existe.`)
  }

  /*
   * Sin {titulo} la plantilla produciria publicaciones sin el pie que eligio el
   * modelo: solo etiquetas, o texto fijo repetido en todos los videos.
   */
  if (!merged.textoPlantilla.includes('{titulo}')) {
    throw new InvalidClipSettings('La plantilla del texto debe incluir {titulo}.')
  }
  if (merged.textoPlantilla.length > 300) {
    throw new InvalidClipSettings('La plantilla del texto no puede pasar de 300 caracteres.')
  }
  if (merged.hashtagsFijos.length > 300) {
    throw new InvalidClipSettings('Las etiquetas fijas no pueden pasar de 300 caracteres.')
  }

  /*
   * El rotulo tiene que decir algo del clip, no ser texto fijo.
   *
   * Sin {titulo}, los cien videos de un VOD saldrian con la misma frase
   * quemada encima, que es peor que no llevar rotulo: parece una marca de
   * agua y ademas tapa la imagen.
   */
  if (merged.tituloActivo && !merged.tituloTexto.includes('{titulo}')) {
    throw new InvalidClipSettings('El rotulo del video debe incluir {titulo}.')
  }
  // Dos lineas a 64 px es lo que cabe sin tapar al hablante. 120 caracteres es
  // mas de lo que entra ahi, asi que como tope duro sobra.
  if (merged.tituloTexto.length > 120) {
    throw new InvalidClipSettings('El rotulo del video no puede pasar de 120 caracteres.')
  }

  // Un rango invertido no lo detecta ningun limite individual, y el modelo
  // recibiria "entre 90 y 20 segundos", que no significa nada.
  if (merged.maxSec <= merged.minSec) {
    throw new InvalidClipSettings('La duracion maxima debe ser mayor que la minima.')
  }

  /*
   * El solape entre ventanas es fijo (120 s, select/window.ts) y debe ser menor
   * que la ventana o el avance seria nulo y buildWindows lanzaria. El limite
   * inferior de windowSec es 300, asi que esto no puede fallar por aqui; la
   * comprobacion se queda escrita porque el dia que alguien baje ese 300 el
   * fallo saldria lejos, dentro del trabajador, y sin explicacion.
   */
  if (merged.windowSec <= 120) {
    throw new InvalidClipSettings('El trozo debe durar mas que el solape de 2 minutos.')
  }

  return {
    ...merged,
    subtitles: Boolean(merged.subtitles),
    subAnimacion: Boolean(merged.subAnimacion),
    subColor: merged.subColor.toUpperCase(),
    subColorBorde: merged.subColorBorde.toUpperCase(),
    tituloActivo: Boolean(merged.tituloActivo),
    tituloColor: merged.tituloColor.toUpperCase(),
    tituloColorBorde: merged.tituloColorBorde.toUpperCase(),
  }
}

/**
 * Solo se admiten campos conocidos.
 *
 * El cuerpo de la peticion llega del panel; copiar sus claves a una sentencia
 * SQL seria dejar que el cliente eligiera que columnas se tocan.
 */
export const COLUMNAS: Record<keyof ClipSettings, string> = {
  minSec: 'clip_min_sec',
  maxSec: 'clip_max_sec',
  perWindow: 'clips_per_window',
  windowSec: 'window_sec',
  subtitles: 'subtitles',
  subFont: 'sub_font',
  subSize: 'sub_size',
  subMargin: 'sub_margin',
  subColor: 'sub_color',
  subColorBorde: 'sub_color_borde',
  subBorde: 'sub_borde',
  subPalabras: 'sub_palabras',
  subAnimacion: 'sub_animacion',
  textoPlantilla: 'texto_plantilla',
  hashtagsFijos: 'hashtags_fijos',
  privacidad: 'privacidad',
  maxPorMinuto: 'max_por_minuto',
  maxPorDia: 'max_por_dia',
  concurrencia: 'concurrencia',
  proveedor: 'proveedor',
  modo: 'modo',
  selector: 'selector',
  tituloActivo: 'titulo_activo',
  tituloTexto: 'titulo_texto',
  tituloArriba: 'titulo_arriba',
  tituloTam: 'titulo_tam',
  tituloColor: 'titulo_color',
  tituloColorBorde: 'titulo_color_borde',
  tituloBorde: 'titulo_borde',
}

/**
 * Convierte una fila (de `settings` o de `plantillas`) en ajustes.
 *
 * Las dos tablas comparten los nombres de columna a proposito, asi que el
 * mismo lector vale para ambas y una plantilla no puede desincronizarse de lo
 * que significa cada campo.
 */
export function ajustesDeFila(fila: Record<string, unknown>): ClipSettings {
  const out = { ...CLIP_DEFAULTS }
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const valor = Number(fila[COLUMNAS[key]])
    if (Number.isFinite(valor)) out[key] = valor
  }
  /*
   * Los dos campos que no son numeros, cada uno con su trampa.
   *
   * La booleana: una fila creada antes de la migracion 004 trae la columna como
   * undefined, y Boolean(undefined) apagaria los subtitulos en silencio. Solo
   * se pisa el valor por defecto si hay algo escrito.
   *
   * La fuente: se comprueba contra la lista al LEER, no solo al guardar. Una
   * fila escrita a mano con psql, o una que sobreviva a que se quite una fuente
   * de FUENTES, produciria un .ass con una tipografia no prevista.
   */
  if (fila[COLUMNAS.subtitles] !== undefined && fila[COLUMNAS.subtitles] !== null) {
    out.subtitles = Boolean(fila[COLUMNAS.subtitles])
  }
  const fuente = fila[COLUMNAS.subFont]
  if (typeof fuente === 'string' && FUENTES.includes(fuente as (typeof FUENTES)[number])) {
    out.subFont = fuente
  }

  // La otra booleana, con la misma trampa que `subtitles`: una fila anterior a
  // la migracion 013 la trae vacia y Boolean(undefined) apagaria la animacion.
  if (fila[COLUMNAS.subAnimacion] !== undefined && fila[COLUMNAS.subAnimacion] !== null) {
    out.subAnimacion = Boolean(fila[COLUMNAS.subAnimacion])
  }

  /*
   * Los de texto se comprueban al LEER, igual que la fuente y por lo mismo.
   *
   * Un color escrito a mano en la base acabaria tal cual en la linea `Style:`
   * del .ass; una plantilla sin {titulo} produciria publicaciones sin pie. Es
   * mas barato caer al valor por defecto que generar cien videos mal.
   */
  const color = fila[COLUMNAS.subColor]
  if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) out.subColor = color.toUpperCase()
  const borde = fila[COLUMNAS.subColorBorde]
  if (typeof borde === 'string' && /^#[0-9A-Fa-f]{6}$/.test(borde)) {
    out.subColorBorde = borde.toUpperCase()
  }
  const plantilla = fila[COLUMNAS.textoPlantilla]
  if (typeof plantilla === 'string' && plantilla.includes('{titulo}')) out.textoPlantilla = plantilla
  const fijos = fila[COLUMNAS.hashtagsFijos]
  if (typeof fijos === 'string') out.hashtagsFijos = fijos
  const priv = fila[COLUMNAS.privacidad]
  if (typeof priv === 'string' && PRIVACIDADES.includes(priv as (typeof PRIVACIDADES)[number])) {
    out.privacidad = priv
  }
  const prov = fila[COLUMNAS.proveedor]
  if (typeof prov === 'string' && PROVEEDORES.includes(prov as (typeof PROVEEDORES)[number])) {
    out.proveedor = prov
  }
  const modo = fila[COLUMNAS.modo]
  if (typeof modo === 'string' && MODOS.includes(modo as (typeof MODOS)[number])) out.modo = modo
  const sel = fila[COLUMNAS.selector]
  if (typeof sel === 'string' && SELECTORES.includes(sel as (typeof SELECTORES)[number])) {
    out.selector = sel
  }

  /*
   * El rotulo, con las mismas cautelas que todo lo de arriba.
   *
   * La booleana cae al valor por defecto si la columna no existe -- una fila
   * anterior a la migracion 014 -- en vez de apagarse por Boolean(undefined).
   * Da igual que el defecto sea false y el resultado parezca el mismo: el dia
   * que el defecto cambie, este codigo seguira siendo correcto.
   */
  if (fila[COLUMNAS.tituloActivo] !== undefined && fila[COLUMNAS.tituloActivo] !== null) {
    out.tituloActivo = Boolean(fila[COLUMNAS.tituloActivo])
  }
  const rotulo = fila[COLUMNAS.tituloTexto]
  if (typeof rotulo === 'string' && rotulo.includes('{titulo}')) out.tituloTexto = rotulo
  const tColor = fila[COLUMNAS.tituloColor]
  if (typeof tColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(tColor)) {
    out.tituloColor = tColor.toUpperCase()
  }
  const tBorde = fila[COLUMNAS.tituloColorBorde]
  if (typeof tBorde === 'string' && /^#[0-9A-Fa-f]{6}$/.test(tBorde)) {
    out.tituloColorBorde = tBorde.toUpperCase()
  }

  return out
}

export async function loadClipSettings(db: DbLike, ownerId: string): Promise<ClipSettings> {
  const filas = await db.query(`select * from settings where owner_id = $1`, [ownerId])
  const fila = filas[0] as Record<string, unknown> | undefined
  if (fila === undefined) return { ...CLIP_DEFAULTS }
  return ajustesDeFila(fila)
}

export async function saveClipSettings(
  db: DbLike,
  ownerId: string,
  input: Partial<ClipSettings>,
): Promise<ClipSettings> {
  const merged = validateClipSettings({ ...(await loadClipSettings(db, ownerId)), ...input })

  const columnas = Object.values(COLUMNAS)
  const valores = (Object.keys(COLUMNAS) as (keyof ClipSettings)[]).map((k) => merged[k])

  /*
   * El insert lleva owner_id y nada mas de la otra mitad de la fila: si el
   * propietario todavia no tiene ajustes de publicacion, esas columnas se
   * quedan con sus valores por defecto, que son los de siempre. No hace falta
   * crear la fila de flujo primero.
   */
  await db.query(
    `insert into settings (owner_id, ${columnas.join(', ')})
     values ($1, ${columnas.map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (owner_id) do update set
       ${columnas.map((c) => `${c} = excluded.${c}`).join(', ')},
       updated_at = now()`,
    [ownerId, ...valores],
  )

  return merged
}

/**
 * Cuantos momentos saldran de un VOD, aproximadamente.
 *
 * Es la unica cifra que importa de esta pantalla y no se deduce mirando las
 * perillas: depende de cuantos trozos salen del VOD, que a su vez depende del
 * solape. Sin esto, "3 por trozo" no dice nada sobre un video de dos horas.
 */
export function clipsEstimados(s: ClipSettings, duracionSec: number): number {
  const OVERLAP_SEC = 120 // select/window.ts, DEFAULT_OVERLAP_SEC
  const avance = s.windowSec - OVERLAP_SEC
  const trozos = Math.max(1, Math.ceil(duracionSec / avance))
  return trozos * s.perWindow
}
