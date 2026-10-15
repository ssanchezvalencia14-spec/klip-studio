/**
 * Contrato unico de publicacion.
 *
 * Todo el sistema habla SOLO con esta interfaz, nunca con un proveedor
 * directamente. Es la pieza que permite arrancar sobre una app de terceros ya
 * auditada por TikTok y migrar despues a una app propia sin reescribir la cola,
 * el planificador ni el worker.
 *
 * Si algun dia aparece un `import` de un proveedor fuera de src/publish/,
 * ese es el momento en que se rompio el diseño.
 */

/**
 * Modo de publicacion.
 *
 * `direct` publica en el perfil sin intervencion. Es lo unico compatible con un
 * sistema desatendido.
 *
 * `draft` deja el video en los borradores de la cuenta y alguien tiene que
 * abrir la app y publicarlo. Los proveedores lo recomiendan porque afirman que
 * publicar desde la app nativa consigue mas alcance organico que hacerlo por
 * API. Es una afirmacion suya, no un dato verificado, y tiene un coste enorme:
 * con 20 cuentas y 3 publicaciones diarias son 60 acciones manuales al dia.
 */
export type PublishMode = 'direct' | 'draft'

export interface PublishRequest {
  accountId: string
  videoPath: string
  caption: string
  hashtags: string[]
  mode: PublishMode
  /**
   * El texto ya armado, si quien llama lo trae hecho.
   *
   * Cada proveedor componia el suyo con la misma linea repetida, de modo que
   * la forma del texto vivia en dos ficheros a la vez y cambiarla pedia tocar
   * los dos. Ahora lo arma `construirTexto` a partir de la plantilla que haya
   * en Ajustes, y el proveedor solo lo escribe.
   *
   * Opcional para que una llamada suelta (una prueba, un script) siga
   * funcionando sin tener que montar la plantilla.
   */
  texto?: string
  /** Quien puede verlo. Solo cuenta en publicacion directa. */
  privacidad?: string
}

export interface PublishSuccess {
  ok: true
  /** Identificador de la publicacion en el proveedor, para rastrear metricas. */
  externalId: string
  mode: PublishMode
}

export interface PublishFailure {
  ok: false
  /**
   * Clasificacion del fallo. Determina que hace el worker, asi que importa
   * mas que el mensaje.
   *
   * - `rate_limit`   espera y reintenta; no cuenta como intento fallido
   * - `auth`         el token de la cuenta no sirve; se pausa la cuenta
   * - `media`        el archivo no cumple; reintentar no arregla nada
   * - `transient`    fallo de red o del proveedor; reintenta con espera
   * - `permanent`    rechazo definitivo; no reintentar
   */
  kind: 'rate_limit' | 'auth' | 'media' | 'transient' | 'permanent'
  message: string
  /** Segundos que pide esperar el proveedor, si lo indica. */
  retryAfterSec?: number
}

export type PublishResult = PublishSuccess | PublishFailure

export interface PublishProvider {
  readonly name: string
  /** Publica un video. Nunca lanza: los fallos vuelven como PublishFailure. */
  publish(request: PublishRequest): Promise<PublishResult>
}

/**
 * Limites de cadencia de TikTok, por token de usuario.
 *
 * TikTok admite 6 peticiones por minuto y 15 publicaciones en 24 horas. Aqui se
 * usan margenes por debajo a proposito: agotar el limite exacto no aporta nada
 * cuando el objetivo son 3 publicaciones diarias por cuenta, y deja sitio para
 * reintentos sin chocar contra el techo.
 */
export const TIKTOK_LIMITS = {
  maxPerMinute: 5,
  maxPer24h: 13,
} as const
