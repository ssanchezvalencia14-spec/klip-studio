/**
 * Verificacion del texto que acompaña a cada publicacion.
 *
 *   npm run verify:texto
 *
 * Esto antes era una linea repetida dentro de cada proveedor:
 *
 *   [caption, ...hashtags.map((h) => '#' + h)].join(' ').slice(0, 2200)
 *
 * Al sacarlo a una plantilla configurable aparecen casos que esa linea no
 * tenia: etiquetas que el usuario escribe ya con almohadilla, etiquetas con
 * espacios, repetidas entre las del clip y las fijas, y plantillas que dejan
 * espacios colgando cuando no hay etiquetas. Son todos silenciosos: producen
 * un texto feo o una etiqueta rota, nunca un error.
 */
import { construirTexto } from '../src/publish/texto.js'
import { aColorAss } from '../src/render/ass.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const POR_DEFECTO = { plantilla: '{titulo} {hashtags}', fijos: '' }

// --- Lo de siempre sigue saliendo igual -------------------------------------
const base = construirTexto({ caption: 'Mi clip', hashtags: ['zoti', 'medellin'], ...POR_DEFECTO })
check(
  'Sin tocar nada sale lo mismo que antes',
  base === 'Mi clip #zoti #medellin',
  `"${base}"`,
)

// --- La plantilla manda -----------------------------------------------------
const alReves = construirTexto({
  caption: 'Mi clip',
  hashtags: ['zoti'],
  plantilla: '{hashtags}\n\n{titulo}',
  fijos: '',
})
check(
  'La plantilla decide el orden y los saltos de linea',
  alReves === '#zoti\n\nMi clip',
  JSON.stringify(alReves),
)

// --- Etiquetas fijas --------------------------------------------------------
const conFijas = construirTexto({
  caption: 'Mi clip',
  hashtags: ['zoti'],
  plantilla: '{titulo} {hashtags}',
  fijos: 'musicaurbana, medellin',
})
check(
  'Las etiquetas fijas se añaden detras de las del clip',
  conFijas === 'Mi clip #zoti #musicaurbana #medellin',
  `"${conFijas}"`,
)

/*
 * Repetidas. El modelo propone "zoti" y el usuario tiene "zoti" entre las
 * fijas: sin deduplicar saldria dos veces en el mismo texto.
 */
const repetida = construirTexto({
  caption: 'Mi clip',
  hashtags: ['zoti'],
  plantilla: '{titulo} {hashtags}',
  fijos: 'ZOTI, medellin',
})
check(
  'Una etiqueta repetida no sale dos veces, aunque cambie la caja',
  repetida === 'Mi clip #zoti #medellin',
  `"${repetida}"`,
)

/*
 * El usuario escribe las fijas a mano, asi que llegan como le salga: con
 * almohadilla delante y con espacios en medio. Sin limpiar, "#zoti" produce
 * "##zoti" y "musica urbana" corta la etiqueta en la primera palabra.
 */
const sucias = construirTexto({
  caption: 'Mi clip',
  hashtags: [],
  plantilla: '{titulo} {hashtags}',
  fijos: '#zoti , musica urbana ,,  ',
})
check(
  'Limpia almohadillas, espacios y entradas vacias',
  sucias === 'Mi clip #zoti #musicaurbana',
  `"${sucias}"`,
)

// --- Sin etiquetas no deja huecos -------------------------------------------
const vacio = construirTexto({ caption: 'Mi clip', hashtags: [], ...POR_DEFECTO })
check('Sin etiquetas no deja espacios colgando', vacio === 'Mi clip', `"${vacio}"`)

// --- El limite de TikTok ----------------------------------------------------
const largo = construirTexto({
  caption: 'x'.repeat(3000),
  hashtags: ['zoti'],
  ...POR_DEFECTO,
})
check('Recorta al limite de 2200 caracteres', largo.length === 2200, `${largo.length} caracteres`)

// --- Colores del .ass -------------------------------------------------------
/*
 * En un .ass los colores van &HAABBGGRR: los bytes AL REVES. Escribir el
 * #RRGGBB tal cual produce el color complementario, que no se ve en el codigo
 * y si en el video.
 */
check(
  'El blanco se traduce igual en los dos sentidos',
  aColorAss('#FFFFFF') === '&H00FFFFFF',
  aColorAss('#FFFFFF'),
)
check(
  'Un color asimetrico invierte los bytes, no los copia',
  aColorAss('#FF0000') === '&H000000FF' && aColorAss('#0000FF') === '&H00FF0000',
  `rojo=${aColorAss('#FF0000')} azul=${aColorAss('#0000FF')}`,
)
check(
  'Un valor corrupto cae en blanco en vez de romper la linea Style',
  aColorAss('rojo') === '&H00FFFFFF',
  aColorAss('rojo'),
)

// --- Reporte ----------------------------------------------------------------
console.log('')
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLA'} ${c.name}`)
  if (!c.ok) console.log(`        ${c.detail}`)
}
const malos = checks.filter((c) => !c.ok).length
console.log('')
console.log(`${checks.length - malos} de ${checks.length} comprobaciones pasan.`)
if (malos > 0) process.exitCode = 1
