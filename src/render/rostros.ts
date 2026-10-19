import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { bin, fromRoot, optionalEnv, ROOT } from '../lib/env.js'
import { workDir } from '../lib/fsx.js'
import { createLogger } from '../lib/logger.js'
import { probe } from '../lib/proc.js'

const log = createLogger('rostros')

/**
 * Reencuadre vertical siguiendo la cara (Fase 6).
 *
 * SIN PYTHON, como el resto del proyecto: los fotogramas los saca ffmpeg, las
 * caras las detecta YuNet (modelo ONNX de OpenCV, ~230 KB) con onnxruntime en
 * Node, y el recorte lo hace ffmpeg con `sendcmd` + `crop`, moviendo la
 * ventana vertical a lo largo del clip.
 *
 * Con dos o mas personas se sigue a QUIEN HABLA, aproximado por el movimiento
 * de la boca: la distancia de la boca a la nariz varia mas en quien habla. Es
 * una aproximacion visual (no se mira el audio), con histeresis para no saltar
 * de una cara a otra en cada fotograma.
 *
 * Si algo falta (onnxruntime, el modelo) o no se ve ninguna cara, devuelve
 * null y el render usa el modo clasico (fondo borroso), sin fallar.
 *
 * SIN PROBAR CON VIDEO REAL: el PC donde se escribio no tiene ffmpeg. La
 * logica de seguimiento esta cubierta por verify:fase6 con datos sinteticos.
 */

export const MODELO_YUNET = 'face_detection_yunet_2023mar.onnx'

export function rutaModeloRostros(): string {
  return fromRoot(optionalEnv('YUNET_MODEL_PATH') ?? join('models', MODELO_YUNET))
}

export interface Cara {
  x: number
  y: number
  w: number
  h: number
  score: number
  /** 5 puntos: ojo der., ojo izq., nariz, comisura der., comisura izq. (x,y). */
  kps: number[]
}

// --- Deteccion (YuNet) ---------------------------------------------------------------

const STRIDES = [8, 16, 32]
/** Lado de la entrada del modelo. */
export const LADO_YUNET = 640

/**
 * Decodifica las salidas de YuNet 2023mar.
 *
 * Por cada paso (8, 16, 32) hay una rejilla de (W/s) x (H/s) anclas con
 * cls, obj, bbox (4) y kps (10). La caja se reconstruye como en OpenCV
 * (FaceDetectorYN): centro = (columna + dx) * s, tamaño = exp(dw) * s.
 */
export function decodificar(
  salidas: Record<string, { data: ArrayLike<number> }>,
  ancho: number,
  alto: number,
  umbral = 0.6,
): Cara[] {
  const caras: Cara[] = []
  for (const s of STRIDES) {
    const cls = salidas[`cls_${s}`]?.data
    const obj = salidas[`obj_${s}`]?.data
    const bbox = salidas[`bbox_${s}`]?.data
    const kps = salidas[`kps_${s}`]?.data
    if (!cls || !obj || !bbox || !kps) continue
    const cols = Math.floor(ancho / s)
    const filas = Math.floor(alto / s)
    for (let i = 0; i < cols * filas; i += 1) {
      const c = Math.min(1, Math.max(0, Number(cls[i])))
      const o = Math.min(1, Math.max(0, Number(obj[i])))
      const score = Math.sqrt(c * o)
      if (score < umbral) continue
      const fila = Math.floor(i / cols)
      const col = i % cols
      const cx = (col + Number(bbox[i * 4])) * s
      const cy = (fila + Number(bbox[i * 4 + 1])) * s
      const w = Math.exp(Number(bbox[i * 4 + 2])) * s
      const h = Math.exp(Number(bbox[i * 4 + 3])) * s
      const puntos: number[] = []
      for (let k = 0; k < 5; k += 1) {
        puntos.push((col + Number(kps[i * 10 + k * 2])) * s, (fila + Number(kps[i * 10 + k * 2 + 1])) * s)
      }
      caras.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, kps: puntos })
    }
  }
  return nms(caras)
}

function iou(a: Cara, b: Cara): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.w * a.h + b.w * b.h - inter
  return union <= 0 ? 0 : inter / union
}

export function nms(caras: Cara[], umbral = 0.3): Cara[] {
  const orden = [...caras].sort((a, b) => b.score - a.score)
  const quedan: Cara[] = []
  for (const c of orden) if (quedan.every((q) => iou(q, c) < umbral)) quedan.push(c)
  return quedan
}

/**
 * Lo poco que se usa de onnxruntime-node, tipado aqui: el paquete vive en
 * vendor/rostros, fuera de node_modules, y tsc no puede ver sus tipos.
 */
interface Sesion {
  inputNames: readonly string[]
  run(entradas: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
}
interface Ort {
  InferenceSession: { create(ruta: string): Promise<Sesion> }
  Tensor: new (tipo: 'float32', datos: Float32Array, forma: number[]) => unknown
}

/** El nombre en una variable: si no, tsc exige los tipos del paquete. */
const PAQUETE_ORT = 'onnxruntime-node'

interface Detector {
  detectar(bgr: Uint8Array, ancho: number, alto: number): Promise<Cara[]>
}

/** El detector, o null si falta onnxruntime o el modelo. */
export async function crearDetector(): Promise<Detector | null> {
  let ort: Ort
  try {
    ort = (await import(PAQUETE_ORT)) as Ort
  } catch {
    /*
     * Lo normal: instalado aparte en vendor/rostros (npm run instalar-rostros),
     * fuera de package.json. Pesa ~290 MB con los binarios de todas las
     * plataformas, y el panel de Hostinger no lo necesita para nada.
     */
    try {
      const requerir = createRequire(join(ROOT, 'vendor', 'rostros', 'package.json'))
      ort = requerir(PAQUETE_ORT) as Ort
    } catch {
      log.info('onnxruntime-node no está instalado (npm run instalar-rostros): modo clásico.')
      return null
    }
  }
  let sesion: Sesion
  try {
    sesion = await ort.InferenceSession.create(rutaModeloRostros())
  } catch {
    log.info('No está el modelo de rostros (npm run instalar-rostros): modo clásico.')
    return null
  }
  return {
    async detectar(bgr, ancho, alto) {
      // El YuNet 2023mar publicado tiene la entrada FIJA en 640x640 (medido:
      // con 640x384 onnxruntime lo rechaza). Se rellena abajo y a la derecha.
      const W = LADO_YUNET
      const H = LADO_YUNET
      if (ancho > W || alto > H) throw new Error(`fotograma de ${ancho}x${alto}: mayor que ${W}x${H}`)
      const plano = new Float32Array(3 * W * H)
      for (let y = 0; y < alto; y += 1) {
        for (let x = 0; x < ancho; x += 1) {
          const o = (y * ancho + x) * 3
          const d = y * W + x
          plano[d] = bgr[o] ?? 0
          plano[W * H + d] = bgr[o + 1] ?? 0
          plano[2 * W * H + d] = bgr[o + 2] ?? 0
        }
      }
      const entrada = new ort.Tensor('float32', plano, [1, 3, H, W])
      const nombre = sesion.inputNames[0] ?? 'input'
      const salidas = await sesion.run({ [nombre]: entrada })
      return decodificar(salidas, W, H)
    },
  }
}

// --- Seguimiento -----------------------------------------------------------------------

export interface Muestra {
  /** Segundos desde el inicio del clip. */
  t: number
  caras: Cara[]
}

interface Pista {
  id: number
  puntos: { t: number; cx: number; boca: number }[]
}

/** Apertura relativa de la boca: comisuras respecto a la nariz, por alto de cara. */
function boca(c: Cara): number {
  const narizY = c.kps[5] ?? 0
  const bocaY = ((c.kps[7] ?? 0) + (c.kps[9] ?? 0)) / 2
  return c.h > 0 ? (bocaY - narizY) / c.h : 0
}

/** Une las caras de cada muestra en pistas, por cercania del centro. */
export function seguir(muestras: Muestra[], anchoFrame: number): Pista[] {
  const pistas: Pista[] = []
  let siguiente = 0
  const umbral = anchoFrame * 0.15
  for (const m of muestras) {
    const libres = new Set(pistas.filter((p) => m.t - (p.puntos.at(-1)?.t ?? -99) < 2))
    for (const c of [...m.caras].sort((a, b) => b.score - a.score)) {
      const cx = c.x + c.w / 2
      let mejor: Pista | null = null
      let dist = Infinity
      for (const p of libres) {
        const d = Math.abs((p.puntos.at(-1)?.cx ?? 0) - cx)
        if (d < dist) { dist = d; mejor = p }
      }
      if (mejor !== null && dist < umbral) {
        mejor.puntos.push({ t: m.t, cx, boca: boca(c) })
        libres.delete(mejor)
      } else {
        pistas.push({ id: siguiente++, puntos: [{ t: m.t, cx, boca: boca(c) }] })
      }
    }
  }
  return pistas
}

function actividad(p: Pista, t: number, ventana = 1): number {
  const v = p.puntos.filter((x) => Math.abs(x.t - t) <= ventana).map((x) => x.boca)
  if (v.length < 2) return 0
  const media = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((a, b) => a + (b - media) ** 2, 0) / v.length)
}

/**
 * A quien se encuadra en cada muestra.
 *
 * Una cara: esa. Varias: la que mas mueve la boca, pero solo se cambia si la
 * otra lo hace claramente mas (x1,4) y lleva al menos 1,5 s con la actual.
 * Sin caras: se mantiene el ultimo encuadre.
 */
export function elegirCentros(muestras: Muestra[], anchoFrame: number): { t: number; cx: number }[] {
  const pistas = seguir(muestras, anchoFrame)
  const salida: { t: number; cx: number }[] = []
  let actual: Pista | null = null
  let desde = -Infinity
  let ultimo = anchoFrame / 2
  for (const m of muestras) {
    const presentes = pistas.filter((p) => p.puntos.some((x) => x.t === m.t))
    if (presentes.length === 0) {
      salida.push({ t: m.t, cx: ultimo })
      continue
    }
    if (actual === null || !presentes.includes(actual)) {
      actual = presentes.reduce((a, b) => (actividad(b, m.t) > actividad(a, m.t) ? b : a))
      desde = m.t
    } else if (presentes.length > 1 && m.t - desde >= 1.5) {
      const mas = presentes.reduce((a, b) => (actividad(b, m.t) > actividad(a, m.t) ? b : a))
      if (mas !== actual && actividad(mas, m.t) > actividad(actual, m.t) * 1.4 + 0.002) {
        actual = mas
        desde = m.t
      }
    }
    const cx = actual.puntos.find((x) => x.t === m.t)?.cx ?? ultimo
    ultimo = cx
    salida.push({ t: m.t, cx })
  }
  return salida
}

/** Media movil: la camara no tiembla con cada fotograma. Un cambio de persona se hace en ~1 s. */
export function suavizar(puntos: { t: number; cx: number }[], ventana = 0.6): { t: number; cx: number }[] {
  return puntos.map((p) => {
    const cerca = puntos.filter((q) => Math.abs(q.t - p.t) <= ventana)
    return { t: p.t, cx: cerca.reduce((a, b) => a + b.cx, 0) / cerca.length }
  })
}

/**
 * Los comandos de `sendcmd` que mueven el `crop` a lo largo del clip.
 *
 * Se interpola cada `paso` segundos entre las muestras para que el movimiento
 * sea continuo. `x` es el borde izquierdo de la ventana en pixeles del video
 * original, siempre dentro de la imagen.
 */
export function comandosCrop(
  centros: { t: number; cx: number }[],
  escala: number,
  anchoFuente: number,
  anchoCrop: number,
  duracion: number,
  paso = 0.1,
): { x0: number; texto: string } {
  const max = Math.max(0, anchoFuente - anchoCrop)
  const xEn = (t: number): number => {
    if (centros.length === 0) return max / 2
    if (t <= (centros[0]?.t ?? 0)) return (centros[0]?.cx ?? 0) * escala - anchoCrop / 2
    for (let i = 1; i < centros.length; i += 1) {
      const a = centros[i - 1]!
      const b = centros[i]!
      if (t <= b.t) {
        const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
        return (a.cx + (b.cx - a.cx) * k) * escala - anchoCrop / 2
      }
    }
    return (centros.at(-1)?.cx ?? 0) * escala - anchoCrop / 2
  }
  const limitar = (x: number) => Math.round(Math.min(max, Math.max(0, x)) / 2) * 2
  const lineas: string[] = []
  for (let t = 0; t <= duracion + 1e-9; t += paso) lineas.push(`${t.toFixed(2)} crop x ${limitar(xEn(t))};`)
  return { x0: limitar(xEn(0)), texto: lineas.join('\n') + '\n' }
}

// --- De punta a punta ------------------------------------------------------------------

/** Fotogramas del tramo, a `fps` por segundo y `ancho` px, en BGR crudo. */
async function muestrear(fuente: string, inicio: number, duracion: number, ancho: number, alto: number, fps: number): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const hijo = spawn(bin.ffmpeg, [
      '-v', 'error', '-ss', inicio.toFixed(3), '-t', duracion.toFixed(3), '-i', fuente,
      '-vf', `fps=${fps},scale=${ancho}:${alto}`, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-',
    ], { shell: false, windowsHide: true })
    const tam = ancho * alto * 3
    const frames: Uint8Array[] = []
    let resto = Buffer.alloc(0)
    hijo.stdout.on('data', (c: Buffer) => {
      resto = Buffer.concat([resto, c])
      while (resto.length >= tam) {
        frames.push(new Uint8Array(resto.subarray(0, tam)))
        resto = resto.subarray(tam)
      }
    })
    let err = ''
    hijo.stderr.on('data', (c: Buffer) => { err += c.toString() })
    hijo.on('error', reject)
    hijo.on('close', (codigo) => (codigo === 0 ? resolve(frames) : reject(new Error(err.split('\n')[0] || `ffmpeg ${codigo}`))))
  })
}

export interface PlanEncuadre {
  anchoCrop: number
  altoCrop: number
  x0: number
  rutaComandos: string
  caras: number
}

/**
 * El plan de recorte de un clip, o null para usar el modo clasico.
 *
 * null si: falta onnxruntime o el modelo, el video ya es vertical, o en
 * menos de un tercio de las muestras hay alguna cara.
 */
export async function planificarEncuadre(
  fuente: string,
  sourceId: string,
  indice: number,
  inicio: number,
  duracion: number,
): Promise<PlanEncuadre | null> {
  const detector = await crearDetector()
  if (detector === null) return null
  const info = await probe(fuente)
  const video = info.streams.find((s) => (s as { codec_type?: string }).codec_type === 'video') as
    | { width?: number; height?: number }
    | undefined
  const anchoFuente = Number(video?.width ?? 0)
  const altoFuente = Number(video?.height ?? 0)
  if (anchoFuente <= 0 || altoFuente <= 0) return null
  const anchoCrop = Math.round((altoFuente * 9) / 16 / 2) * 2
  if (anchoFuente <= anchoCrop) return null

  // El fotograma cabe en 640x640 por su lado mayor (casi siempre, el ancho).
  const porAncho = anchoFuente >= altoFuente
  const ancho = porAncho ? LADO_YUNET : Math.round((LADO_YUNET * anchoFuente) / altoFuente / 2) * 2
  const alto = porAncho ? Math.round((LADO_YUNET * altoFuente) / anchoFuente / 2) * 2 : LADO_YUNET
  const fps = 3
  const frames = await muestrear(fuente, inicio, duracion, ancho, alto, fps)
  const muestras: Muestra[] = []
  for (const [i, f] of frames.entries()) muestras.push({ t: i / fps, caras: await detector.detectar(f, ancho, alto) })

  const conCara = muestras.filter((m) => m.caras.length > 0).length
  if (muestras.length === 0 || conCara < muestras.length / 3) {
    log.info(`Clip ${indice}: caras en ${conCara} de ${muestras.length} muestras; modo clásico.`)
    return null
  }

  const centros = suavizar(elegirCentros(muestras, ancho))
  const { x0, texto } = comandosCrop(centros, anchoFuente / ancho, anchoFuente, anchoCrop, duracion)
  const rutaComandos = join(workDir(sourceId), `clip-${String(indice).padStart(2, '0')}.encuadre.txt`)
  writeFileSync(rutaComandos, texto, 'utf8')
  log.info(`Clip ${indice}: siguiendo la cara (${conCara} de ${muestras.length} muestras con cara).`)
  return { anchoCrop, altoCrop: altoFuente, x0, rutaComandos, caras: conCara }
}
