/**
 * Por que no respondio la IA, en terminos que deciden que hacer.
 *
 * La distincion que importa es entre lo que se arregla solo esperando (el
 * limite de uso de la suscripcion), lo que necesita a una persona (iniciar
 * sesion, instalar el CLI) y lo que puede ir mejor en el siguiente intento.
 * Las dos primeras PAUSAN la cola de IA: reintentar no sirve y cada intento
 * gasta tiempo y, con el limite, empeora las cosas.
 */
export type ClaseErrorIA =
  | 'sin_sesion'
  | 'limite'
  | 'no_encontrado'
  | 'tiempo'
  | 'respuesta_invalida'
  | 'otro'

export class ErrorIA extends Error {
  constructor(
    readonly clase: ClaseErrorIA,
    mensaje: string,
    /** Cuando dice el proveedor que vuelve a haber uso. Solo para 'limite'. */
    readonly reanudarEn?: Date,
    /** Texto original, para el registro. Nunca para la pantalla. */
    readonly detalle?: string,
  ) {
    super(mensaje)
    this.name = 'ErrorIA'
  }

  /** Esperar o pedir ayuda: reintentar en el acto daria lo mismo. */
  get pausaLaCola(): boolean {
    return this.clase === 'sin_sesion' || this.clase === 'limite' || this.clase === 'no_encontrado'
  }
}

/** Mensajes para quien usa el panel. Sin rutas, sin variables, sin jerga. */
export function mensajeIA(clase: ClaseErrorIA, reanudarEn?: Date): string {
  switch (clase) {
    case 'sin_sesion':
      return 'La IA no tiene sesión. Abre Claude Code en el ordenador que procesa y ejecuta /login.'
    case 'limite':
      return reanudarEn === undefined
        ? 'La IA llegó al límite de uso de la suscripción. Pulsa "Reintentar" cuando vuelva a estar disponible.'
        : `La IA llegó al límite de uso. Vuelve a las ${horaCorta(reanudarEn)} y seguirá sola.`
    case 'no_encontrado':
      return 'Claude Code no está instalado en el ordenador que procesa.'
    case 'tiempo':
      return 'La IA tardó demasiado en responder. Se puede reintentar.'
    case 'respuesta_invalida':
      return 'La IA respondió algo que no se pudo leer, también al reintentar.'
    case 'otro':
      return 'La IA no pudo responder. Se puede reintentar.'
  }
}

export function horaCorta(fecha: Date): string {
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`
}

/**
 * Lee la hora de vuelta de un mensaje de limite.
 *
 * El CLI la ha dado de dos formas. La antigua, "Claude AI usage limit
 * reached|1760000000", con segundos Unix tras la barra. La actual, en texto:
 * "resets 3pm", "resets at 3:30 pm (America/Bogota)". La zona horaria del
 * texto se ignora: el CLI escribe la hora local de la maquina en la que corre,
 * que es la misma en la que corre esto.
 *
 * Una hora que ya paso hoy se entiende como de mañana.
 */
export function leerHoraDeVuelta(texto: string, ahora = new Date()): Date | undefined {
  const epoch = /\|\s*(\d{10})\b/.exec(texto)
  if (epoch?.[1] !== undefined) return new Date(Number(epoch[1]) * 1000)

  const m = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(texto)
  if (m?.[1] === undefined) return undefined

  let h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  const sufijo = m[3]?.toLowerCase()
  if (sufijo === 'pm' && h < 12) h += 12
  if (sufijo === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return undefined

  const vuelta = new Date(ahora)
  vuelta.setHours(h, min, 0, 0)
  if (vuelta.getTime() <= ahora.getTime()) vuelta.setDate(vuelta.getDate() + 1)
  return vuelta
}

/**
 * Clasifica una respuesta fallida del CLI.
 *
 * MEDIDO con Claude Code 2.1.299 sin sesion: sale con codigo 1 y un JSON con
 * `is_error: true` y `result: "Not logged in · Please run /login"`. El resto
 * de patrones son los que el CLI ha usado para el limite de la suscripcion y
 * para una sesion caducada.
 *
 * `status` es `api_error_status` del JSON, cuando lo trae.
 */
export function clasificarSalidaCli(texto: string, status?: number | null): ErrorIA {
  const t = texto.toLowerCase()

  if (
    status === 401 ||
    /not logged in|please run \/login|run \/login|invalid api key|oauth token (?:has )?(?:expired|revoked)|authentication_error|credentials? (?:not found|missing)/.test(t)
  ) {
    return new ErrorIA('sin_sesion', mensajeIA('sin_sesion'), undefined, texto)
  }

  if (
    status === 429 ||
    /usage limit|hit your limit|limit reached|rate[ _-]?limit|out of (?:extra )?usage|resets? (?:at )?\d/.test(t)
  ) {
    const vuelta = leerHoraDeVuelta(texto)
    return new ErrorIA('limite', mensajeIA('limite', vuelta), vuelta, texto)
  }

  return new ErrorIA('otro', mensajeIA('otro'), undefined, texto)
}
