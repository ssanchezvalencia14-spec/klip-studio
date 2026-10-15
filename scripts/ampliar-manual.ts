/**
 * Amplia clips.manual.json con una pasada completa del transcript.
 *
 *   npx tsx scripts/ampliar-manual.ts [--escribir]
 *
 * Los tramos se declaran por INDICE de segmento, no por segundos, por la misma
 * razon que la Fase 2: un indice o existe o no existe, un segundo inventado es
 * indetectable. El script resuelve los indices a tiempos reales, comprueba que
 * la cita del gancho aparece de verdad dentro del tramo y que la duracion cae
 * en el rango util. Sin --escribir solo informa.
 *
 * Los 6 clips que ya estaban se conservan intactos y con su mismo orden, para
 * que no cambien de identificador ni haya que volver a renderizarlos.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readJson } from '../src/lib/fsx.js'
import type { Transcript } from '../src/types.js'

const MIN_SEC = 20
const MAX_SEC = 90

interface Pick {
  from: number
  to: number
  hook: string
  reason: string
  caption: string
  hashtags: string[]
  score: number
}

const TAGS_BASE = ['arcangel', 'chenteydrach', 'podcast']

const PICKS: Pick[] = [
  {
    from: 273, to: 290,
    hook: 'Con mi mejor producto musical.',
    reason: 'Llama fracaso a lo que el mismo considera su mejor disco. La contradiccion se sostiene sola y no necesita saber de que disco habla.',
    caption: 'Su mejor disco fue también su mayor fracaso',
    hashtags: [...TAGS_BASE, 'reggaeton'], score: 88,
  },
  {
    from: 371, to: 384,
    hook: 'Yo no quiero cambiar.',
    reason: 'Distingue entre cambiar quien eres y aprender a controlarte. Es la clase de frase que se recorta sola y circula como cita.',
    caption: 'Nadie debería cambiar, hay que aprender a controlarse',
    hashtags: [...TAGS_BASE, 'mentalidad'], score: 90,
  },
  {
    from: 383, to: 401,
    hook: 'rompí la pista, cabrón.',
    reason: 'Arrogancia contada con humor y detalle concreto: llama al productor antes de grabar. El detalle es lo que lo hace gracioso.',
    caption: 'Llama al productor para decirle que le rompió la pista',
    hashtags: [...TAGS_BASE, 'estudio'], score: 84,
  },
  {
    from: 456, to: 477,
    hook: 'un duende que es malvado',
    reason: 'Explica su lado agresivo como reaccion, no como caracter. La imagen del duende es memorable y da titulo al clip.',
    caption: 'El duende que saca cuando lo faltan al respeto',
    hashtags: [...TAGS_BASE, 'respeto'], score: 86,
  },
  {
    from: 479, to: 490,
    hook: 'yo caí hasta en una mini depresión de par de días',
    reason: 'Admision de vulnerabilidad de alguien que lleva media entrevista diciendo que es el mas duro. El contraste es el gancho.',
    caption: 'Cayó en depresión cuando Polaco le tiró',
    hashtags: [...TAGS_BASE, 'tiradera'], score: 89,
  },
  {
    from: 516, to: 523,
    hook: 'yo tengo 20 años escuchándote como fanático',
    reason: 'Cuenta la traicion desde el lado del fan. Emocional y autoconclusivo.',
    caption: '20 años siendo su fan y llegó a quitarle su momento',
    hashtags: [...TAGS_BASE, 'reggaeton'], score: 85,
  },
  {
    from: 637, to: 643,
    hook: 'Como nunca me lo mamaron a mí cuando yo hice eso primero.',
    reason: 'Queja con nombre y fecha: hizo el tema electronico antes y se lo celebran a otros. Tema recurrente que aqui sale en una sola frase.',
    caption: 'Hizo el tema electrónico primero y nadie se lo reconoció',
    hashtags: [...TAGS_BASE, 'chicavirtual'], score: 83,
  },
  {
    from: 701, to: 717,
    hook: 'se lo debemos a la academia',
    reason: 'Sarcasmo sostenido durante casi un minuto sin romperlo nunca. Funciona incluso sin saber el contexto del premio.',
    caption: 'Su mensaje sarcástico a los Grammy',
    hashtags: [...TAGS_BASE, 'grammys'], score: 93,
  },
  {
    from: 786, to: 799,
    hook: 'Esa palabra también la traje',
    reason: 'Senala a los que ahora presumen de origen dominicano despues de esconderlo. Polemico y directo.',
    caption: 'Los que ahora dicen que son dominicanos porque está de moda',
    hashtags: [...TAGS_BASE, 'dominicana'], score: 87,
  },
  {
    from: 872, to: 884,
    hook: 'yo tuve un tipo que me maltrató sin saber',
    reason: 'La humillacion contada desde el fanatismo previo. Cierra con que nunca se arrodillo, que es el giro.',
    caption: 'Lo maltrató sin saber que era su fan',
    hashtags: [...TAGS_BASE, 'hectorelfather'], score: 86,
  },
  {
    from: 923, to: 933,
    hook: 'Ahí fue que yo me di cuenta',
    reason: 'Momento concreto y visualizable: gente mirandolo con odio y el entendiendo que eso era poder. Historia completa en 20 segundos.',
    caption: 'Vio tanto odio que entendió lo poderoso que era',
    hashtags: [...TAGS_BASE, 'calle'], score: 88,
  },
  {
    from: 994, to: 1019,
    hook: 'yo estaba',
    reason: 'Reconoce que se cago de miedo una vez y cuenta exactamente cuando dejo de tenerlo. La honestidad es lo que lo hace fuerte.',
    caption: 'El día que dejó de tenerle miedo',
    hashtags: [...TAGS_BASE, 'calle'], score: 84,
  },
  {
    from: 1037, to: 1051,
    hook: 'Me faltaste el respeto.',
    reason: 'Resume todo el conflicto en una condicional: si me hubiese respetado, seria su aliado. Frase de cierre perfecta.',
    caption: 'Pudo haber sido su mejor aliado',
    hashtags: [...TAGS_BASE, 'respeto'], score: 87,
  },
  {
    from: 1075, to: 1085,
    hook: 'el que falló fui yo',
    reason: 'Unico momento de toda la entrevista donde admite culpa propia sin matices. Raro en el y por eso valioso.',
    caption: 'Admite que el que falló fue él',
    hashtags: [...TAGS_BASE, 'tempo'], score: 91,
  },
  {
    from: 1093, to: 1106,
    hook: 'yo le enseñé a muchas',
    reason: 'Explica que su estilo viene de alguien que estaba preso y que el se encargo de que se supiera. Generosidad poco comun en el genero.',
    caption: 'Le enseñó a toda una generación quién era Tempo',
    hashtags: [...TAGS_BASE, 'tempo'], score: 85,
  },
  {
    from: 1115, to: 1145,
    hook: 'Don Omar',
    reason: 'Acusa a otro artista de no reconocer a los de su propia isla por ego. Nombres propios y polemica inmediata.',
    caption: 'Por qué nunca va a decir que Don Omar le mete',
    hashtags: [...TAGS_BASE, 'donomar'], score: 89,
  },
  {
    from: 1153, to: 1164,
    hook: 'Yo soy el más hijo de puta.',
    reason: 'Define el oficio del rapero como creerselo de verdad, y lo demuestra en la misma frase. Autorreferencial y gracioso.',
    caption: 'El trabajo de un rapero es creérselo',
    hashtags: [...TAGS_BASE, 'rap'], score: 82,
  },
  {
    from: 1518, to: 1532,
    hook: 'yo soy el más duro',
    reason: 'El entrevistador le responde que lleva 45 minutos diciendolo. La reaccion esta dentro del clip y hace de remate.',
    caption: 'Lleva 45 minutos diciendo que es el más duro',
    hashtags: [...TAGS_BASE, 'reggaeton'], score: 86,
  },
  {
    from: 1984, to: 1997,
    hook: 'el día que tú y yo seamos enemigos',
    reason: 'Idea inquietante y concreta: hay amigos con los que ya sabe que no habria vuelta atras. Se entiende sin contexto.',
    caption: 'Tiene amigos con los que nunca podría reconciliarse',
    hashtags: [...TAGS_BASE, 'amistad'], score: 88,
  },
  {
    from: 2070, to: 2087,
    hook: 'mi ataque al corazón',
    reason: 'Desmiente a los medios sobre la causa de su infarto sin negar el consumo. Matiz que lo hace creible.',
    caption: 'Aclara que su infarto no fue por drogas',
    hashtags: [...TAGS_BASE, 'salud'], score: 85,
  },
  {
    from: 2119, to: 2130,
    hook: 'lambebichos millonarios',
    reason: 'Frase lapidaria sobre la industria con una imagen que se recuerda. De las mas citables de toda la entrevista.',
    caption: 'Esta industria está llena de lambebichos millonarios',
    hashtags: [...TAGS_BASE, 'industria'], score: 92,
  },
  {
    from: 2267, to: 2284,
    hook: 'yo siempre fui bien humilde',
    reason: 'Imita a los raperos que mienten en entrevistas. La imitacion hace el trabajo y no necesita explicacion.',
    caption: 'Imita las mentiras que dicen los raperos en entrevistas',
    hashtags: [...TAGS_BASE, 'medios'], score: 86,
  },
  {
    from: 2292, to: 2301,
    hook: 'soy fácil de coger de pendejo',
    reason: 'Se define como facil de enganar pero implacable despues. Contradiccion que retrata su caracter entero.',
    caption: 'Es fácil de engañar pero castiga al que lo hace',
    hashtags: [...TAGS_BASE, 'mentalidad'], score: 84,
  },
  {
    from: 2419, to: 2428,
    hook: 'tienen que hablar mexicanos',
    reason: 'Critica cultural concreta y graciosa sobre las presentadoras que fingen acento. Remata con De Bayamon, Mexico.',
    caption: 'Las presentadoras boricuas que hablan mexicano',
    hashtags: [...TAGS_BASE, 'puertorico'], score: 87,
  },
  {
    from: 2596, to: 2614,
    hook: 'que soy un hater',
    reason: 'Explica la trampa: si reclama lo que hizo primero lo llaman resentido. Queja que muchos creadores reconocen.',
    caption: 'Si reclama lo suyo lo llaman hater',
    hashtags: [...TAGS_BASE, 'reggaeton'], score: 83,
  },
  {
    from: 2631, to: 2642,
    hook: 'que sea respetar a quien se merece su respeto',
    reason: 'Convierte el respeto generacional en una moda a imitar. Positivo y compartible, contrasta con el resto.',
    caption: 'Propone que la nueva moda sea el respeto',
    hashtags: [...TAGS_BASE, 'respeto'], score: 85,
  },
  {
    from: 2667, to: 2683,
    hook: 'Michael Jordan',
    reason: 'Dato concreto y verificable usado como argumento sobre legado frente a dinero. Sale del tema musical y por eso alcanza otro publico.',
    caption: 'Jordan nunca hizo 100 millones jugando al baloncesto',
    hashtags: [...TAGS_BASE, 'jordan'], score: 88,
  },
  {
    from: 2726, to: 2749,
    hook: 'yo prefiero',
    reason: 'Elige legado sobre dinero con un ejemplo que cualquiera entiende. Cierra el argumento anterior y funciona por separado.',
    caption: 'Prefiere ser Jordan que Curry',
    hashtags: [...TAGS_BASE, 'jordan'], score: 84,
  },
  {
    // Termina en 2833 y no en 2834: el segmento siguiente es exactamente donde
    // arranca el clip que ya existe ("yo vengo de muchas desilusiones"), y por
    // redondeo del final los dos tramos se tocaban.
    from: 2821, to: 2833,
    hook: 'este género es una mierda',
    reason: 'Le da la razon a Residente y lo dice sin suavizarlo. Es la declaracion mas polemica de toda la entrevista.',
    caption: 'Le da la razón a René: este género es una mierda',
    hashtags: [...TAGS_BASE, 'residente'], score: 94,
  },
  {
    from: 2900, to: 2919,
    hook: 'tú le diste la mano',
    reason: 'Le reprocha a un amigo haber perdonado a quienes lo humillaron. Lealtad contada con un caso concreto.',
    caption: 'Lo que le dijo a Nicky Jam sobre perdonar',
    hashtags: [...TAGS_BASE, 'nickyjam'], score: 86,
  },
  {
    from: 3010, to: 3024,
    hook: 'porque yo no le debo a nadie',
    reason: 'Cierre de la entrevista. Contesta a lo de las redes sociales citando a Tego y rematando con una frase de salida.',
    caption: 'Su respuesta sobre por qué no persigue seguidores',
    hashtags: [...TAGS_BASE, 'tego'], score: 82,
  },
]

const t = readJson<Transcript>('work/qlopnOiwLvk/transcript.json')
const seg = t.segments
const path = 'work/qlopnOiwLvk/clips.manual.json'
const file = JSON.parse(readFileSync(path, 'utf8')) as {
  clips: { start: number; end: number; hook: string }[]
}

const ts = (s: number): string => {
  const x = Math.floor(s)
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}

const problems: string[] = []
const resolved: Record<string, unknown>[] = []

for (const p of PICKS) {
  const a = seg[p.from]
  const b = seg[p.to]
  if (a === undefined || b === undefined) {
    problems.push(`${p.from}-${p.to}: indice fuera de rango`)
    continue
  }

  const dur = b.end - a.start
  if (dur < MIN_SEC || dur > MAX_SEC) {
    problems.push(`${p.from}-${p.to}: dura ${dur.toFixed(1)}s, fuera de [${MIN_SEC}, ${MAX_SEC}]`)
    continue
  }

  // La cita tiene que estar de verdad en el tramo. Sin esto, un gancho mal
  // copiado produce un clip que promete algo que el video no dice.
  const texto = seg.slice(p.from, p.to + 1).map((s) => s.text).join(' ')
  if (!texto.toLowerCase().includes(p.hook.toLowerCase())) {
    problems.push(`${p.from}-${p.to}: el gancho no aparece en el tramo -> "${p.hook}"`)
    continue
  }

  // Solapamiento con lo que ya existe.
  const choca = file.clips.find((c) => a.start < c.end && b.end > c.start)
  if (choca !== undefined) {
    problems.push(`${p.from}-${p.to}: solapa con el clip existente "${choca.hook.slice(0, 40)}"`)
    continue
  }

  resolved.push({
    sourceId: 'qlopnOiwLvk',
    windowIndex: 0,
    start: Number(a.start.toFixed(1)),
    end: Number(b.end.toFixed(1)),
    hook: p.hook,
    reason: p.reason,
    caption: p.caption,
    hashtags: p.hashtags,
    score: p.score,
  })

  console.log(
    `  OK  ${ts(a.start)}-${ts(b.end)}  ${String(Math.round(dur)).padStart(2)}s  ` +
      `score ${p.score}  ${p.caption}`,
  )
}

console.log('')
for (const x of problems) console.log(` FALLO  ${x}`)

console.log('')
console.log(`${resolved.length} de ${PICKS.length} tramos validos`)
console.log(`Total tras anadir: ${file.clips.length + resolved.length} clips`)

if (process.argv.includes('--escribir') && problems.length === 0) {
  const out = { ...file, clips: [...file.clips, ...resolved] }
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  console.log(`\nEscrito ${path}`)
} else if (problems.length > 0) {
  console.log('\nNo se escribe nada mientras haya fallos.')
  process.exitCode = 1
}
