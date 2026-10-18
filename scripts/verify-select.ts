/**
 * Verificacion de la Fase 2 sin llamar a ningun modelo.
 *
 *   npm run verify:select
 *
 * Comprueba las dos piezas que deciden que candidatos sobreviven: el rescate de
 * JSON cortado y la traduccion de indices de linea a segundos. Las dos son
 * silenciosas cuando fallan, que es lo peligroso: un rescate mal hecho pierde
 * clips buenos, y una traduccion mal hecha produce cortes que parecen correctos
 * y caen en el sitio equivocado.
 */
import { salvageTruncatedJson } from '../src/select/provider.js'
import { validateCandidates } from '../src/select/validate.js'
import type { ClipCandidate } from '../src/select/schema.js'
import type { Transcript } from '../src/types.js'
import type { TranscriptWindow } from '../src/select/window.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

// --- Rescate de JSON cortado -------------------------------------------------
{
  const cortado =
    '{"clips":[{"startLine":59,"endLine":72,"hook":"uno"},' +
    '{"startLine":146,"endLine":160,"hook":"con } llave y \\" comilla"},' +
    '{"startLine":200,"endLine":'

  const r = salvageTruncatedJson(cortado)
  check(
    'Rescata los objetos completos',
    r?.clips.length === 2,
    `${r?.clips.length ?? 0} de 3 (el tercero venia incompleto)`,
  )

  const segundo = r?.clips[1] as { hook?: string } | undefined
  check(
    'No se confunde con llaves dentro de cadenas',
    segundo?.hook === 'con } llave y " comilla',
    JSON.stringify(segundo?.hook),
  )

  check(
    'Sin objetos completos devuelve null',
    salvageTruncatedJson('{"clips":[{"startLine":') === null,
    'null',
  )

  check('Sin array devuelve null', salvageTruncatedJson('texto suelto') === null, 'null')
}

// --- Traduccion de indices a segundos ---------------------------------------
{
  // 20 lineas de 2 s cada una: de la 1 a la 20, de 0 s a 40 s.
  const segments = Array.from({ length: 20 }, (_, i) => ({
    start: i * 2,
    end: i * 2 + 2,
    text: `linea numero ${i + 1} con texto de prueba`,
  }))

  const window: TranscriptWindow = { index: 0, startSec: 0, endSec: 40, segments }
  const transcript: Transcript = {
    sourceId: 'test',
    language: 'es',
    durationSec: 40,
    hasWordTimestamps: false,
    segments,
  }
  const limits = { minDurationSec: 10, maxDurationSec: 30 }

  const base = { hook: 'linea numero 3 con texto de prueba', reason: 'r', caption: 'c', hashtags: [], score: 80 }

  const make = (startLine: number, endLine: number, hook?: string): ClipCandidate =>
    ({ ...base, startLine, endLine, ...(hook === undefined ? {} : { hook }) }) as ClipCandidate

  // Lineas 3 a 10 -> de 4 s a 20 s = 16 s, dentro de [10, 30].
  const ok = validateCandidates([make(3, 10)], window, transcript, limits)
  check(
    'Traduce indices a segundos reales',
    ok.accepted[0]?.start === 4 && ok.accepted[0]?.end === 20,
    `start=${ok.accepted[0]?.start} end=${ok.accepted[0]?.end} (esperado 4 y 20)`,
  )

  const fuera = validateCandidates([make(3, 50)], window, transcript, limits)
  check(
    'Rechaza indices fuera de la lista',
    fuera.accepted.length === 0 && (fuera.rejected[0]?.reason ?? '').includes('fuera del rango'),
    fuera.rejected[0]?.reason ?? 'no rechazado',
  )

  const unaLinea = validateCandidates([make(5, 5)], window, transcript, limits)
  check(
    'Rechaza el tramo de una sola linea',
    unaLinea.accepted.length === 0 && (unaLinea.rejected[0]?.reason ?? '').includes('una sola'),
    unaLinea.rejected[0]?.reason ?? 'no rechazado',
  )

  const corto = validateCandidates([make(3, 5)], window, transcript, limits)
  check(
    'Rechaza el tramo demasiado corto',
    corto.accepted.length === 0 && (corto.rejected[0]?.reason ?? '').includes('suman'),
    corto.rejected[0]?.reason ?? 'no rechazado',
  )

  const inventado = validateCandidates(
    [make(3, 10, 'esta frase no existe en ninguna parte del transcript')],
    window,
    transcript,
    limits,
  )
  check(
    'Rechaza el gancho inventado',
    inventado.accepted.length === 0 && (inventado.rejected[0]?.reason ?? '').includes('alucinacion'),
    inventado.rejected[0]?.reason ?? 'no rechazado',
  )

  const invertido = validateCandidates([make(10, 3)], window, transcript, limits)
  check(
    'Rechaza el tramo invertido',
    invertido.accepted.length === 0,
    invertido.rejected[0]?.reason ?? 'no rechazado',
  )
}


// --- Clasificacion de fallos del proveedor -----------------------------------
//
// Decide si se cortan las ventanas restantes o se sigue intentando. Equivocarse
// cuesta de las dos maneras: dar por definitivo un 429 aborta un VOD que habria
// salido solo esperando, y dar por pasajero un 401 gasta una llamada por
// ventana para recibir doce veces el mismo error.
{
  const { clasificarFallo } = await import('../src/select/fallo.js')

  // Lo que devolvio de verdad la API el 2026-10-18, con su forma de error del SDK.
  const err401 = Object.assign(
    new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
    { status: 401 },
  )
  const a = clasificarFallo(err401)
  check(
    'Una clave rechazada es definitiva y dice donde cambiarla',
    a.clase === 'auth' && a.definitivo && a.mensaje.includes('ANTHROPIC_API_KEY'),
    `${a.clase} definitivo=${a.definitivo}`,
  )

  // Saldo agotado llega como 400, no como 402: ya paso en este proyecto.
  const errSaldo = Object.assign(
    new Error('400 {"error":{"message":"Your credit balance is too low to access the API"}}'),
    { status: 400 },
  )
  const b = clasificarFallo(errSaldo)
  check(
    'Saldo agotado se distingue de una peticion mal formada',
    b.clase === 'saldo' && b.definitivo && b.mensaje.toLowerCase().includes('saldo'),
    `${b.clase} definitivo=${b.definitivo}`,
  )

  const c = clasificarFallo(Object.assign(new Error('429 rate_limit_error'), { status: 429 }))
  check(
    'Un limite de peticiones NO corta: merece reintentarse',
    c.clase === 'limite' && !c.definitivo,
    `${c.clase} definitivo=${c.definitivo}`,
  )

  const d = clasificarFallo(Object.assign(new Error('503 overloaded'), { status: 503 }))
  check(
    'Un 5xx tampoco corta',
    d.clase === 'limite' && !d.definitivo,
    `${d.clase} definitivo=${d.definitivo}`,
  )

  // Un Error pelado, sin status: lo que lanza el proveedor de Ollama y las
  // pruebas. No se puede clasificar, asi que se deja pasar y se reintenta.
  const e = clasificarFallo(new Error('Ollama no devolvio JSON valido: <html>'))
  check(
    'Un error sin status se trata como pasajero y conserva el texto',
    e.clase === 'pasajero' && !e.definitivo && e.mensaje.includes('Ollama'),
    `${e.clase}: ${e.mensaje.slice(0, 40)}`,
  )

  /*
   * El corte del bucle NO se prueba aqui, y es a proposito.
   *
   * selectClips crea su propio proveedor y escribe clips.json en el directorio
   * de trabajo, asi que ejercitarlo pediria inyectar el proveedor y simular el
   * disco: dos cambios de firma para probar un `break`. Se verifico ejecutando
   * el VOD real con la clave rechazada y comprobando en el registro que se
   * intenta UNA ventana y se anuncian las restantes como no intentadas.
   */
}

// --- Reporte -----------------------------------------------------------------
const width = Math.max(...checks.map((c) => c.name.length))
console.log('')
for (const c of checks) {
  console.log(`${c.ok ? '  OK  ' : ' FALLO'}  ${c.name.padEnd(width)}  ${c.detail}`)
}

const failed = checks.filter((c) => !c.ok)
console.log('')
console.log(`${checks.length - failed.length}/${checks.length} comprobaciones correctas`)
if (failed.length > 0) process.exitCode = 1
