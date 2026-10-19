/**
 * Verificacion de los ajustes de corte.
 *
 *   npm run verify:ajustes
 *
 * Comprueba lo unico que de verdad decide si esta seccion sirve: que lo que se
 * guarda en la pantalla acabe en la linea de comando del trabajador. Un panel
 * que guarda bien y luego corta con los valores de siempre es peor que no tener
 * la pantalla, porque parece que funciona.
 *
 * Corre contra un Postgres de verdad en memoria (PGlite) y no contra la base
 * real: escribe ajustes, y eso no debe tocar produccion.
 */
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { ROOT } from '../src/lib/env.js'
import type { Db } from '../src/store/db.js'
import {
  CLIP_DEFAULTS,
  clipsEstimados,
  InvalidClipSettings,
  loadClipSettings,
  saveClipSettings,
  validateClipSettings,
} from '../src/select/ajustes.js'
import {
  borrarPlantilla,
  guardarPlantilla,
  InvalidPlantilla,
  leerPlantilla,
  listarPlantillas,
} from '../src/select/plantillas.js'
import { buildAss } from '../src/render/ass.js'
import { buildJob } from '../src/review/pipeline.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const pg = new PGlite()
const db: Db = {
  query: async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}

for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}

const OWNER = '11111111-1111-1111-1111-111111111111'
await pg.exec(`insert into owners (id, email, label)
               values ('${OWNER}', 'yo@ejemplo.com', 'Yo')`)

const CONOCIDOS = new Set(['vod-uno'])

// --- Por defecto ------------------------------------------------------------
//
// Un propietario sin fila tiene que comportarse como el programa de siempre. Si
// esto falla, actualizar rompe a todo el que ya lo estaba usando.
const inicial = await loadClipSettings(db, OWNER)
check(
  'Sin ajustes guardados salen los de siempre',
  JSON.stringify(inicial) === JSON.stringify(CLIP_DEFAULTS),
  `${inicial.minSec}-${inicial.maxSec}s, ${inicial.perWindow} por trozo, subtitulos ${inicial.subtitles}`,
)

// --- Guardar y releer -------------------------------------------------------
const guardado = await saveClipSettings(db, OWNER, {
  minSec: 15,
  maxSec: 45,
  perWindow: 5,
  windowSec: 600,
  subtitles: false,
})
const releido = await loadClipSettings(db, OWNER)
check(
  'Lo guardado se relee igual',
  JSON.stringify(guardado) === JSON.stringify(releido),
  `${releido.minSec}-${releido.maxSec}s, ${releido.perWindow} por trozo de ${releido.windowSec}s`,
)

/*
 * La booleana es el caso que mas facil se rompe en silencio.
 *
 * Postgres devuelve `false`, pero una implementacion que hiciera
 * `Boolean(fila[col] ?? true)` sobre un false lo dejaria en false por
 * casualidad y sobre un undefined lo dejaria en true. Se comprueba el false
 * explicitamente porque es el valor que el usuario tuvo que elegir a mano.
 */
check(
  'Apagar los subtitulos sobrevive a la ida y vuelta',
  releido.subtitles === false,
  `subtitles = ${releido.subtitles}`,
)

// --- Guardado parcial -------------------------------------------------------
//
// El panel manda el formulario entero, pero la API admite campos sueltos. Un
// parcial no debe pisar con valores por defecto lo que no venia.
await saveClipSettings(db, OWNER, { perWindow: 2 })
const parcial = await loadClipSettings(db, OWNER)
check(
  'Guardar un campo suelto no borra el resto',
  parcial.perWindow === 2 && parcial.minSec === 15 && parcial.subtitles === false,
  `${parcial.perWindow} por trozo, minimo sigue en ${parcial.minSec}s, subtitulos ${parcial.subtitles}`,
)

// --- Validacion -------------------------------------------------------------
let rangoInvertido = false
try {
  validateClipSettings({ ...CLIP_DEFAULTS, minSec: 60, maxSec: 30 })
} catch (error) {
  rangoInvertido = error instanceof InvalidClipSettings
}
check('Un rango invertido se rechaza', rangoInvertido, 'minimo 60s con maximo 30s no pasa')

let fueraDeRango = false
try {
  await saveClipSettings(db, OWNER, { perWindow: 99 })
} catch (error) {
  fueraDeRango = error instanceof InvalidClipSettings
}
check('Un valor fuera de rango se rechaza', fueraDeRango, '99 momentos por trozo no pasa')

const trasElFallo = await loadClipSettings(db, OWNER)
check(
  'Un guardado rechazado no deja nada a medias',
  trasElFallo.perWindow === 2,
  `sigue en ${trasElFallo.perWindow} por trozo`,
)

// --- Lo que llega al trabajador ---------------------------------------------
//
// El corazon de todo esto. Los ajustes viven en la base; el trabajador solo ve
// una linea de comando.
const ajustes = await loadClipSettings(db, OWNER)
const select = buildJob('select', { sourceId: 'vod-uno' }, CONOCIDOS, ajustes)
const args = select.args.join(' ')
check(
  'Los ajustes guardados viajan a la orden de buscar momentos',
  args.includes('--min 15') &&
    args.includes('--max 45') &&
    args.includes('--max-per-window 2') &&
    args.includes('--window 600'),
  args,
)

/*
 * Un parametro explicito gana a lo guardado.
 *
 * Es lo que permite probar un corte distinto sin guardar nada, y es tambien la
 * unica forma de que un cambio en esta pantalla no rompa quien llame a la API
 * con parametros a mano.
 */
const conOverride = buildJob(
  'select',
  { sourceId: 'vod-uno', minSec: 30 },
  CONOCIDOS,
  ajustes,
)
check(
  'Un parametro explicito pisa lo guardado',
  conOverride.args.join(' ').includes('--min 30'),
  conOverride.args.join(' '),
)

// Sin ajustes, la orden tiene que seguir siendo la de siempre.
const porDefecto = buildJob('select', { sourceId: 'vod-uno' }, CONOCIDOS)
check(
  'Sin ajustes se cortan como siempre',
  porDefecto.args.join(' ') === 'vod-uno --max-per-window 3 --window 900 --min 20 --max 90',
  porDefecto.args.join(' '),
)

// --- Subtitulos -------------------------------------------------------------
const sinSubs = buildJob('render', { sourceId: 'vod-uno' }, CONOCIDOS, ajustes)
check(
  'Apagar los subtitulos llega al render',
  sinSubs.args.includes('--no-subs'),
  sinSubs.args.join(' '),
)

const conSubs = buildJob('render', { sourceId: 'vod-uno' }, CONOCIDOS, {
  ...ajustes,
  subtitles: true,
})
check(
  'Con subtitulos encendidos no se manda --no-subs',
  !conSubs.args.includes('--no-subs'),
  conSubs.args.join(' '),
)

// --- Estimacion -------------------------------------------------------------
//
// Es la cifra grande de la pantalla, asi que conviene que sea la de verdad.
// Con trozos de 15 min y solape de 2, el avance es de 13: un video de 120 min
// da ceil(120/13) = 10 trozos, y a 3 por trozo, 30 momentos.
const est = clipsEstimados(CLIP_DEFAULTS, 120 * 60)
check('La estimacion cuadra con el solape', est === 30, `${est} momentos para 120 min`)

// Un video mas corto que un trozo sigue siendo un trozo, no cero.
const corto = clipsEstimados(CLIP_DEFAULTS, 5 * 60)
check('Un video corto cuenta como un trozo', corto === 3, `${corto} momentos para 5 min`)

// --- Estilo de los subtitulos -----------------------------------------------
//
// La fuente acaba escrita tal cual en la linea Style: de un .ass, que es un
// formato separado por comas. Es el unico campo de texto libre de todo esto.
let fuenteMala = false
try {
  validateClipSettings({ ...CLIP_DEFAULTS, subFont: 'Comic Sans, 999' })
} catch (error) {
  fuenteMala = error instanceof InvalidClipSettings
}
check('Una tipografia fuera de la lista se rechaza', fuenteMala, 'con coma dentro, no pasa')

// La misma puerta, una capa mas abajo: buildAss tambien tiene que negarse, que
// es donde llega quien use la linea de comando sin pasar por el panel.
const assPath = join(tmpdir(), `klip-verify-${process.pid}.ass`)
const segmentos = [{ start: 0, end: 2, text: 'hola' }]
let assMala = false
try {
  buildAss(segmentos, 0, 2, assPath, { fontName: 'Wingdings' })
} catch {
  assMala = true
}
check('El generador de .ass tampoco la acepta', assMala, 'Wingdings se rechaza, no se sustituye')

/*
 * Que el estilo llegue al fichero es lo unico que importa de esta parte.
 *
 * Se lee el .ass generado en vez de confiar en que la opcion viaja: el campo va
 * en una posicion concreta de una linea separada por comas, y equivocarse de
 * posicion pondria el tamaño donde va el color sin que nada fallara.
 */
buildAss(segmentos, 0, 2, assPath, { fontName: 'Verdana', fontSize: 90, marginV: 500 })
const linea = readFileSync(assPath, 'utf8').split('\n').find((l) => l.startsWith('Style:')) ?? ''
const campos = linea.slice('Style: '.length).split(',')
check(
  'El estilo pedido acaba en el fichero .ass',
  campos[1] === 'Verdana' && campos[2] === '90' && campos.at(-2) === '500',
  `fuente ${campos[1]}, cuerpo ${campos[2]}, margen ${campos.at(-2)}`,
)
rmSync(assPath, { force: true })

// Y que viaje desde la base hasta la linea de comando del render.
const conEstilo = await saveClipSettings(db, OWNER, {
  subtitles: true,
  subFont: 'Tahoma',
  subSize: 60,
  subMargin: 450,
  subColor: '#FFEE00',
  subColorBorde: '#101010',
  subBorde: 12,
  subPalabras: 4,
  subAnimacion: false,
})
const render = buildJob('render', { sourceId: 'vod-uno' }, CONOCIDOS, conEstilo)
/*
 * Se comprueba valor por valor, no contra la linea entera.
 *
 * La igualdad literal fallaba cada vez que aparecia una perilla nueva, aunque
 * el cambio fuera correcto: paso al añadir color, borde y palabras por rotulo.
 * Lo que importa es que CADA ajuste guardado llegue con su valor.
 */
const sigue = (bandera: string): string | undefined => {
  const i = render.args.indexOf(bandera)
  return i === -1 ? undefined : render.args[i + 1]
}
check(
  'El estilo guardado viaja a la orden de renderizar',
  render.args[0] === 'vod-uno' &&
    sigue('--sub-font') === 'Tahoma' &&
    sigue('--sub-size') === '60' &&
    sigue('--sub-margin') === '450' &&
    sigue('--sub-color') === '#FFEE00' &&
    sigue('--sub-color-borde') === '#101010' &&
    sigue('--sub-borde') === '12' &&
    sigue('--sub-words') === '4',
  render.args.join(' '),
)
check(
  'Y la animacion apagada NO viaja',
  !render.args.includes('--sub-animate'),
  render.args.includes('--sub-animate') ? 'viajo igualmente' : 'ausente, correcto',
)

// Sin subtitulos no tiene sentido mandar su estilo.
const apagados = buildJob('render', { sourceId: 'vod-uno' }, CONOCIDOS, {
  ...conEstilo,
  subtitles: false,
})
check(
  'Con los subtitulos apagados no se manda su estilo',
  apagados.args.join(' ') === 'vod-uno --no-subs',
  apagados.args.join(' '),
)

// --- Plantillas -------------------------------------------------------------
const podcast = await guardarPlantilla(db, OWNER, '  Podcast  ', {
  ...CLIP_DEFAULTS,
  minSec: 45,
  maxSec: 120,
  perWindow: 2,
})
check('Guarda una plantilla y le quita los espacios', podcast.nombre === 'Podcast', `"${podcast.nombre}"`)

await guardarPlantilla(db, OWNER, 'Juego', {
  ...CLIP_DEFAULTS,
  minSec: 15,
  maxSec: 30,
  subSize: 90,
})
const lista = await listarPlantillas(db, OWNER)
check('Las lista en el orden en que se crearon', lista.length === 2 && lista[0]?.nombre === 'Podcast',
  lista.map((p) => p.nombre).join(', '))

// Repetir nombre sobrescribe: dos iguales en la lista solo sirven para elegir
// la equivocada.
await guardarPlantilla(db, OWNER, 'Podcast', { ...CLIP_DEFAULTS, minSec: 50, maxSec: 150 })
const trasRepetir = await listarPlantillas(db, OWNER)
check(
  'Repetir el nombre sobrescribe en vez de duplicar',
  trasRepetir.length === 2 && trasRepetir.find((p) => p.nombre === 'Podcast')?.minSec === 50,
  `${trasRepetir.length} plantillas, Podcast en ${trasRepetir.find((p) => p.nombre === 'Podcast')?.minSec}s`,
)

let sinNombre = false
try {
  await guardarPlantilla(db, OWNER, '   ', CLIP_DEFAULTS)
} catch (error) {
  sinNombre = error instanceof InvalidPlantilla
}
check('Una plantilla sin nombre se rechaza', sinNombre, 'solo espacios, no pasa')

// Aplicar: los valores de la plantilla pasan a ser los vigentes.
const juego = trasRepetir.find((p) => p.nombre === 'Juego')
const valores = await leerPlantilla(db, OWNER, juego?.id ?? '')
const aplicados = await saveClipSettings(db, OWNER, valores)
check(
  'Aplicar una plantilla cambia los ajustes vigentes',
  aplicados.minSec === 15 && aplicados.maxSec === 30 && aplicados.subSize === 90,
  `${aplicados.minSec}-${aplicados.maxSec}s, cuerpo ${aplicados.subSize}`,
)

/*
 * La copia es copia, no referencia.
 *
 * Es la propiedad que hace util una plantilla: aplicarla, retocar algo y poder
 * volver. Si retocar modificara la plantilla, "volver a lo de antes" dejaria de
 * existir en cuanto tocas un desplegable.
 */
await saveClipSettings(db, OWNER, { minSec: 25 })
const juegoDespues = (await listarPlantillas(db, OWNER)).find((p) => p.nombre === 'Juego')
check(
  'Retocar los ajustes no toca la plantilla aplicada',
  juegoDespues?.minSec === 15,
  `la plantilla sigue en ${juegoDespues?.minSec}s con los ajustes en 25s`,
)

const borrada = await borrarPlantilla(db, OWNER, juego?.id ?? '')
const trasBorrar = await listarPlantillas(db, OWNER)
const vigentes = await loadClipSettings(db, OWNER)
check(
  'Borrarla no cambia los ajustes que ya estaban puestos',
  borrada && trasBorrar.length === 1 && vigentes.subSize === 90,
  `${trasBorrar.length} plantilla, cuerpo sigue en ${vigentes.subSize}`,
)

const otraVez = await borrarPlantilla(db, OWNER, juego?.id ?? '')
check('Borrar dos veces no rompe, devuelve que no habia', otraVez === false, 'false')

// Aislamiento: las plantillas de otro propietario no se ven ni se borran.
const AJENO = '22222222-2222-2222-2222-222222222222'
await pg.exec(`insert into owners (id, email, label) values ('${AJENO}', 'otro@ejemplo.com', 'Otro')`)
await guardarPlantilla(db, AJENO, 'Suya', CLIP_DEFAULTS)
const mias = await listarPlantillas(db, OWNER)
check(
  'Las plantillas de otro propietario no se ven',
  mias.every((p) => p.nombre !== 'Suya'),
  `${mias.length} mias, ninguna suya`,
)


// --- Los planes de upload-post ----------------------------------------------
//
// La tabla es dato AJENO, copiado de la web de upload-post el 2026-10-11. No
// se puede comprobar que siga siendo cierta sin salir a internet, y estas
// pruebas no salen. Lo que si se comprueba es que siga siendo COHERENTE, que
// es lo que se rompe cuando alguien la actualiza con prisa: un cupo repetido
// haria que dos planes distintos se vieran iguales en el desplegable, y uno
// desordenado pondria el caro antes que el barato.
{
  const { PLANES_UPLOAD_POST, planDe, describirTope } = await import('../src/publish/planes.js')

  check(
    'Hay planes y ninguno repite cupo',
    PLANES_UPLOAD_POST.length > 0 &&
      new Set(PLANES_UPLOAD_POST.map((p) => p.perfiles)).size === PLANES_UPLOAD_POST.length,
    `${PLANES_UPLOAD_POST.length} planes`,
  )

  const ordenados = PLANES_UPLOAD_POST.every(
    (p, i) => i === 0 || (p.perfiles > (PLANES_UPLOAD_POST[i - 1]?.perfiles ?? 0) &&
      p.usd >= (PLANES_UPLOAD_POST[i - 1]?.usd ?? 0)),
  )
  check(
    'Van de menos a mas, en cupo y en precio',
    ordenados,
    PLANES_UPLOAD_POST.map((p) => `${p.nombre}:${p.perfiles}/${p.usd}`).join(' '),
  )

  /*
   * El plan gratuito TIENE que llevar aviso.
   *
   * No incluye TikTok, asi que elegirlo deja el panel entero funcionando y la
   * publicacion rota. Si alguien quita ese aviso al actualizar la tabla, esto
   * lo dice antes de que lo descubra un usuario.
   */
  const gratis = PLANES_UPLOAD_POST.find((p) => p.usd === 0)
  check(
    'El plan gratuito avisa de que no sirve aqui',
    gratis === undefined || (gratis.aviso ?? '') !== '',
    gratis === undefined ? 'no hay plan gratuito' : (gratis.aviso ?? 'SIN AVISO'),
  )

  check(
    'El tope se traduce a su plan, y uno a mano no inventa nombre',
    planDe(25)?.nombre === 'Professional' &&
      planDe(37) === undefined &&
      describirTope(25).includes('Professional') &&
      describirTope(37) === '37 cuentas',
    `${describirTope(25)} | ${describirTope(37)}`,
  )

  /*
   * Y lo que de verdad importa: que el tope de cada plan quepa en el rango que
   * valida el servidor. Un plan con mas perfiles que el maximo admitido seria
   * una opcion del desplegable que al guardarse da error.
   */
  const { DEFAULTS } = await import('../src/queue/settings.js')
  const cabenTodos = PLANES_UPLOAD_POST.every((p) => p.perfiles >= 1 && p.perfiles <= 1000)
  check(
    'Todos los planes caben en el rango que valida el servidor',
    cabenTodos && DEFAULTS.maxCuentas === 25,
    `maximo del mayor plan=${Math.max(...PLANES_UPLOAD_POST.map((p) => p.perfiles))} defecto=${DEFAULTS.maxCuentas}`,
  )
}

await pg.close()

const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}
const fallos = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - fallos.length}/${checks.length} comprobaciones correctas`)
if (fallos.length > 0) process.exitCode = 1
