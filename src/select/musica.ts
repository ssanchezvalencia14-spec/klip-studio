/**
 * Analisis de un video musical sin Python (Fase 6).
 *
 * El plan pedia Demucs y librosa. Se hace con lo que ya hay: el audio.wav
 * que extrae el ingest (PCM 16 bits, 16 kHz, mono) se lee aqui mismo, y la
 * letra sale de la transcripcion. Tres señales:
 *
 * 1. ENERGIA. Los drops y los estribillos suenan mas fuerte que los versos.
 *    Se mide el volumen RMS por medio segundo y se normaliza por percentiles
 *    de la propia cancion, porque un master moderno esta comprimido y lo que
 *    importa es lo relativo.
 * 2. ESTRIBILLO. Lo que se repite. Una linea de letra que aparece dos o mas
 *    veces (comparada sin tildes ni signos) es candidata a estribillo.
 * 3. DENSIDAD DE VOZ. La de siempre: un tramo con poca letra es instrumental.
 *
 * Y una cuarta para los subtitulos: la CONFIANZA de la letra. Whisper con
 * musica alucina (repite la misma frase en bucle, escribe "[Musica]"). Si la
 * letra no es fiable, el clip sale sin subtitulos: una letra inventada
 * quemada en el video es peor que ninguna.
 *
 * Todo son funciones puras salvo leerWav, para poder probarlas con datos
 * sinteticos (scripts/verify-fase6.ts).
 */
import { readFileSync } from 'node:fs'
import type { TranscriptSegment } from '../types.js'

/** Paso del analisis de energia, en segundos. */
export const PASO_ENERGIA = 0.5

/** Por debajo de esto la letra no se quema en el video. */
export const CONFIANZA_MINIMA = 0.5

/** Lo que whisper inventa en los tramos sin voz: tags de productor, *Musica*. */
export function esRuido(texto: string): boolean {
  const t = texto.trim()
  return t === '' || /^[[(*♪].*[\])*♪]$/.test(t) || /^[♪\s.]+$/.test(t)
}

/**
 * Lee un WAV PCM de 16 bits. Solo lo que produce extractAudio: no es un
 * lector general, y por eso falla claro con cualquier otra cosa.
 */
export function leerWav(ruta: string): { muestras: Int16Array; rate: number } {
  const b = readFileSync(ruta)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('El audio no es un WAV.')
  }
  let rate = 0
  let bits = 0
  let canales = 0
  let o = 12
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4)
    const tam = b.readUInt32LE(o + 4)
    if (id === 'fmt ') {
      canales = b.readUInt16LE(o + 10)
      rate = b.readUInt32LE(o + 12)
      bits = b.readUInt16LE(o + 22)
    } else if (id === 'data') {
      if (bits !== 16 || canales !== 1) throw new Error(`WAV de ${bits} bits y ${canales} canales: se esperaba 16 y 1.`)
      // ffmpeg escribe 0xFFFFFFFF de tamaño cuando no puede volver atras.
      const fin = Math.min(b.length, o + 8 + (tam === 0xffffffff ? b.length : tam))
      const datos = b.subarray(o + 8, fin - ((fin - o - 8) % 2))
      const muestras = new Int16Array(datos.buffer.slice(datos.byteOffset, datos.byteOffset + datos.length))
      return { muestras, rate }
    }
    o += 8 + tam + (tam % 2)
  }
  throw new Error('El WAV no tiene datos.')
}

/** Volumen RMS en dB por cada PASO_ENERGIA segundos. */
export function energia(muestras: ArrayLike<number>, rate: number, paso = PASO_ENERGIA): number[] {
  const n = Math.max(1, Math.round(rate * paso))
  const out: number[] = []
  for (let i = 0; i < muestras.length; i += n) {
    let suma = 0
    const fin = Math.min(muestras.length, i + n)
    for (let j = i; j < fin; j += 1) {
      const v = (muestras[j] ?? 0) / 32768
      suma += v * v
    }
    const rms = Math.sqrt(suma / Math.max(1, fin - i))
    out.push(20 * Math.log10(Math.max(rms, 1e-5)))
  }
  return out
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0
  const orden = [...valores].sort((a, b) => a - b)
  return orden[Math.min(orden.length - 1, Math.max(0, Math.round((orden.length - 1) * p)))]!
}

/**
 * Energia normalizada 0..1 respecto a la propia cancion: el percentil 10 es
 * 0 y el 95 es 1. Asi un master muy comprimido y uno dinamico se comparan
 * igual.
 */
export function normalizarEnergia(db: number[]): number[] {
  const bajo = percentil(db, 0.1)
  const alto = percentil(db, 0.95)
  const rango = Math.max(1, alto - bajo)
  return db.map((v) => Math.max(0, Math.min(1, (v - bajo) / rango)))
}

/**
 * Instantes de "drop": la energia de los 2 s siguientes supera en mas de
 * `salto` (0..1) a la de los 4 s anteriores. Son los arranques de estribillo
 * y las entradas de la base, el sitio natural para empezar un clip.
 *
 * Se queda con el punto de MAYOR salto de su entorno (4 s a cada lado): el
 * primer instante que pasa el umbral llega antes del golpe, porque la
 * ventana de despues ya lo ve venir.
 */
export function drops(norm: number[], paso = PASO_ENERGIA, salto = 0.3): number[] {
  const antes = Math.round(4 / paso)
  const despues = Math.round(2 / paso)
  const media = (a: number, b: number) => {
    let s = 0
    for (let i = a; i < b; i += 1) s += norm[i] ?? 0
    return s / Math.max(1, b - a)
  }
  const saltos = norm.map((_, i) =>
    i >= antes && i + despues <= norm.length ? media(i, i + despues) - media(i - antes, i) : -Infinity,
  )
  const entorno = Math.round(4 / paso)
  const out: number[] = []
  let ultimo = -Infinity
  saltos.forEach((d, i) => {
    if (d <= salto) return
    for (let j = Math.max(0, i - entorno); j <= Math.min(saltos.length - 1, i + entorno); j += 1) {
      if ((saltos[j] ?? -Infinity) > d) return
    }
    const t = i * paso
    if (t - ultimo > 8) {
      out.push(t)
      ultimo = t
    }
  })
  return out
}

/** Una linea comparable: minusculas, sin tildes, sin signos, sin espacios dobles. */
export function normalizarLinea(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parecidas(a: string, b: string): boolean {
  if (a === b) return true
  const pa = new Set(a.split(' '))
  const pb = new Set(b.split(' '))
  let comunes = 0
  for (const p of pa) if (pb.has(p)) comunes += 1
  return comunes / Math.max(pa.size, pb.size) >= 0.7
}

/**
 * Cuantas veces se repite cada segmento en la cancion (1 = no se repite).
 *
 * Las lineas de menos de tres palabras no cuentan: "oh oh", "yeah" se
 * repiten en cualquier tramo y no dicen donde esta el estribillo.
 */
export function repeticiones(segs: TranscriptSegment[]): number[] {
  const lineas = segs.map((s) => normalizarLinea(s.text))
  return lineas.map((l) => {
    if (l.split(' ').length < 3) return 1
    return lineas.filter((o) => o.split(' ').length >= 3 && parecidas(l, o)).length
  })
}

/**
 * Confianza 0..1 en la letra transcrita.
 *
 * Whisper con musica falla de tres maneras reconocibles, y cada una resta:
 * - tramos marcados como ruido ([Musica], ♪) en vez de letra;
 * - BUCLES: la misma linea cuatro o mas veces seguidas, que es como alucina
 *   cuando no entiende (un estribillo real se repite, pero no ocho veces
 *   pegado);
 * - poca letra para lo que dura: una cancion de tres minutos con dos frases
 *   no se ha entendido.
 */
export function confianzaLetra(segs: TranscriptSegment[], duracion: number): number {
  if (segs.length === 0) return 0
  const ruido = segs.filter((s) => esRuido(s.text)).length / segs.length

  const lineas = segs.map((s) => normalizarLinea(s.text))
  let enBucle = 0
  let racha = 1
  for (let i = 1; i <= lineas.length; i += 1) {
    if (i < lineas.length && lineas[i] !== '' && lineas[i] === lineas[i - 1]) {
      racha += 1
    } else {
      if (racha >= 4) enBucle += racha
      racha = 1
    }
  }
  const bucle = enBucle / segs.length

  const conVoz = segs.filter((s) => !esRuido(s.text))
  const cubierto = conVoz.reduce((n, s) => n + Math.max(0, s.end - s.start), 0)
  const cobertura = Math.min(1, cubierto / Math.max(1, duracion) / 0.4)

  const c = (1 - ruido) * (1 - bucle) * cobertura
  return Math.round(Math.max(0, Math.min(1, c)) * 100) / 100
}

/** Lo que se mide de un tramo candidato. */
export interface MedidaTramo {
  /** Energia media normalizada, 0..1. */
  energia: number
  /** Fraccion del tramo con lineas que se repiten en la cancion, 0..1. */
  estribillo: number
  /** Caracteres de letra por segundo. */
  densidad: number
  /** Si el tramo empieza en (o justo antes de) un drop. */
  conDrop: boolean
}

export function medirTramo(
  inicio: number,
  fin: number,
  norm: number[],
  segs: TranscriptSegment[],
  reps: number[],
  listaDrops: number[],
  paso = PASO_ENERGIA,
): MedidaTramo {
  const a = Math.max(0, Math.floor(inicio / paso))
  const b = Math.min(norm.length, Math.ceil(fin / paso))
  let e = 0
  for (let i = a; i < b; i += 1) e += norm[i] ?? 0
  const durTramo = Math.max(1, fin - inicio)
  let enEstribillo = 0
  let caracteres = 0
  segs.forEach((s, i) => {
    if (s.end <= inicio || s.start >= fin || esRuido(s.text)) return
    caracteres += s.text.trim().length
    if ((reps[i] ?? 1) >= 2) enEstribillo += Math.min(fin, s.end) - Math.max(inicio, s.start)
  })
  return {
    energia: b > a ? e / (b - a) : 0,
    estribillo: Math.min(1, enEstribillo / durTramo),
    densidad: caracteres / durTramo,
    conDrop: listaDrops.some((d) => d >= inicio - 2 && d <= inicio + 3),
  }
}

/**
 * Puntaje 0..100 de un tramo de cancion.
 *
 * Pesos: estribillo 35, energia 35, voz 20, drop al empezar 10. La densidad
 * satura en 12 caracteres por segundo: por encima ya es rap rapido y no por
 * eso es mejor clip.
 */
export function puntajeMusica(m: MedidaTramo): number {
  const voz = Math.min(1, m.densidad / 12)
  const p = 35 * m.estribillo + 35 * m.energia + 20 * voz + (m.conDrop ? 10 : 0)
  return Math.round(Math.max(0, Math.min(100, p)))
}
