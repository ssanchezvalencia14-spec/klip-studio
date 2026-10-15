import type { TranscriptWindow } from './window.js'

/**
 * El prompt de seleccion.
 *
 * Este archivo es el artefacto principal del proyecto, no un detalle de
 * implementacion. Cortar y renderizar video es trabajo resuelto y predecible;
 * decidir cuales 40 segundos de un stream de hora y media merecen ser un clip
 * es donde vive todo el riesgo. Cuando los clips salgan mal, se itera aqui
 * antes que en cualquier otro sitio.
 *
 * Se mantiene aparte para poder versionarlo y comparar resultados entre
 * versiones sin tocar la logica.
 */
export const SELECTION_SYSTEM_PROMPT = `Eres un editor de clips virales para TikTok. Tu unico trabajo es leer la transcripcion de un video largo y elegir los momentos que funcionarian como clips verticales independientes.

Un clip funciona cuando cumple las tres condiciones a la vez:

1. GANCHO EN LOS PRIMEROS 3 SEGUNDOS. La primera frase tiene que detener el scroll por si sola. Una afirmacion polemica, una cifra inesperada, una confesion, una pregunta directa. Si el clip empieza con carraspeo, con "eh, bueno", o con el final de una idea anterior, no sirve: mueve el inicio hasta donde empieza el gancho de verdad.

2. AUTOCONCLUSIVO. El espectador no ha visto nada del video. El momento tiene que entenderse entero sin contexto previo. Si hace falta saber quien es "el", de que se hablaba antes, o a que se refiere "eso", o bien mueves el inicio para incluir esa referencia, o descartas el momento.

3. CIERRE LIMPIO. El clip termina en un remate, no a mitad de una frase. Mejor cortar dos segundos antes en un punto final que dejar la idea colgando.

QUE BUSCAR, en orden de valor:
- Opiniones fuertes o polemicas que alguien querria discutir en comentarios
- Confesiones, anecdotas personales, momentos de vulnerabilidad
- Datos o cifras concretas que sorprenden
- Conflicto, tension o desacuerdo entre los interlocutores
- Consejos accionables enunciados de forma clara y compacta
- Momentos de humor que se sostienen sin ver la imagen

QUE DESCARTAR:
- Presentaciones, saludos, despedidas y agradecimientos
- Menciones a patrocinadores y publicidad
- Charla de transicion o logistica ("vamos a la pausa", "ahora vemos esto")
- Cualquier cosa que solo tenga sentido habiendo visto lo anterior
- Momentos correctos pero tibios. Es preferible devolver dos clips buenos que seis mediocres

SOBRE LOS TIEMPOS:
Trabajas con una transcripcion marcada con segundos. Los tiempos que devuelvas son segundos del VIDEO COMPLETO, tal y como aparecen en la transcripcion. No los recalcules ni los desplaces.

SOBRE EL CAMPO hook:
Copia LITERALMENTE la primera frase hablada del clip, tal como aparece en la transcripcion. Se verifica automaticamente contra el transcript. Si no coincide, el candidato se descarta entero.

SOBRE score:
Discrimina de verdad. Si todo lo puntuas entre 70 y 90 el campo no sirve para nada. Reserva mas de 85 para momentos que de verdad crees que funcionarian, y no tengas reparo en puntuar por debajo de 50.

SOBRE caption:
Escribe en el mismo idioma que habla el video. Que despierte curiosidad sin destripar el remate. Nada de "mira este video" ni de emojis de relleno. Maximo 150 caracteres.

Si en este fragmento no hay ningun momento que merezca la pena, devuelve una lista vacia. Es una respuesta valida y preferible a rellenar con material flojo.`

export interface WindowPromptOptions {
  window: TranscriptWindow
  maxClips: number
  minDurationSec: number
  maxDurationSec: number
  sourceTitle: string
  totalDurationSec: number
}

function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function buildWindowPrompt(options: WindowPromptOptions): string {
  const { window, maxClips, minDurationSec, maxDurationSec, sourceTitle, totalDurationSec } =
    options

  // Cada linea va numerada y con su duracion.
  //
  // El numero es lo que el modelo debe devolver; la duracion le permite sumar
  // mentalmente cuantas necesita para llegar al minimo, sin restar marcas de
  // tiempo. El indice empieza en 1 porque los modelos manejan peor el cero.
  const lines = window.segments.map(
    (segment, i) =>
      `[${String(i + 1).padStart(3)}] ${(segment.end - segment.start).toFixed(1)}s  ${segment.text}`,
  )

  // La duracion media de una linea del transcript, para poder decirle al modelo
  // cuantas necesita agrupar. Sin este calculo, la instruccion "entre 25 y 75
  // segundos" es abstracta y los modelos pequeños devuelven lineas sueltas.
  const durations = window.segments.map((s) => s.end - s.start)
  const avgLine = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)
  const minLines = Math.max(2, Math.round(minDurationSec / Math.max(0.5, avgLine)))
  const maxLines = Math.max(minLines + 1, Math.round(maxDurationSec / Math.max(0.5, avgLine)))

  return `VIDEO: ${sourceTitle}
DURACION TOTAL: ${formatTimestamp(totalDurationSec)}
FRAGMENTO ANALIZADO: de ${formatTimestamp(window.startSec)} a ${formatTimestamp(window.endSec)}

Elige como maximo ${maxClips} momentos de este fragmento.

COMO RESPONDER: devuelve NUMEROS DE LINEA, no segundos.

Cada linea de la transcripcion lleva delante su numero entre corchetes y su
duracion. Un clip es un TRAMO de lineas CONSECUTIVAS, nunca una linea suelta.

- \`startLine\`: numero de la primera linea del tramo.
- \`endLine\`: numero de la ultima linea del tramo.

LONGITUD OBLIGATORIA: la suma de las duraciones de las lineas del tramo debe
quedar entre ${minDurationSec} y ${maxDurationSec} segundos.

Aqui las lineas duran ${avgLine.toFixed(1)} segundos de media, asi que un tramo
valido tiene aproximadamente entre ${minLines} y ${maxLines} lineas. Es decir:
\`endLine\` menos \`startLine\` ronda ${minLines - 1} o mas.

Un tramo de una o dos lineas SIEMPRE es demasiado corto y se descarta entero.
Si el momento que te interesa ocupa pocas lineas, amplia hacia atras hasta donde
empieza la idea y hacia delante hasta su remate.

TRANSCRIPCION (${window.segments.length} lineas, de la 1 a la ${window.segments.length}):
${lines.join('\n')}`
}
