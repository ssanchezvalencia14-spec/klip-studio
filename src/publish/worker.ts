import { randomUUID } from 'node:crypto'
import { createLogger, formatDuration } from '../lib/logger.js'
import { construirTexto } from './texto.js'
import {
  markAccountPublished,
  posts,
  queue,
  setAccountStatus,
  type Account,
  type AccountStatus,
  type Post,
  type QueueItem,
} from '../store/store.js'
import { TIKTOK_LIMITS, type PublishMode, type PublishProvider } from './types.js'

const log = createLogger('worker')

/**
 * Intentos maximos por publicacion antes de darla por fallida.
 *
 * Cuatro cubre un fallo transitorio del proveedor sin convertir un problema
 * permanente en un bucle que consume cuota durante horas.
 */
const MAX_ATTEMPTS = 4

/** Fallos de autenticacion seguidos antes de sacar la cuenta de rotacion. */
const AUTH_FAILURES_BEFORE_PAUSE = 2

/** Fallos seguidos del mismo tipo antes de dar la pasada por perdida. */
const CORTE_SEGUIDOS = 3

/**
 * Donde vive el estado que el worker lee y escribe.
 *
 * SE INYECTA PORQUE HAY DOS ALMACENES. El worker corre en este ordenador y
 * escribia en los ficheros de state/; el panel vive en un servidor y lee
 * Postgres. El resultado era que el panel no veia ni una publicacion: seis
 * clips entregados y la tarjeta de TikTok diciendo "sin conectar".
 *
 * Con esto el worker no sabe cual de los dos usa. La implementacion de ficheros
 * sigue siendo la de por defecto para que las pruebas no necesiten una base de
 * datos, y quien publica de verdad pasa la de Postgres.
 *
 * Todo asincrono aunque la de ficheros no lo necesite: una consulta por red no
 * puede devolverse de inmediato, y tener dos formas distintas segun el almacen
 * obligaria a que el worker supiera cual tiene delante.
 */
export interface EstadoWorker {
  /**
   * Lo que toca publicar ya.
   *
   * Tambien se inyecta, y no es un detalle: leer la cola de los ficheros y
   * escribir el resultado en Postgres dejaria las dos mitades del trabajo en
   * almacenes distintos, y la cola de ficheros no se vaciaria nunca.
   */
  vencidos: (now: Date, tope?: number) => Promise<QueueItem[]>
  /**
   * Rescata los envios que se quedaron a medias.
   *
   * Un item pasa a 'publishing' justo antes de subir, y vuelve a 'pending' o
   * 'published' al terminar. Si el proceso muere entremedias (la subida dura
   * medio minuto) se queda ahi para siempre: `vencidos` solo mira 'pending', a
   * proposito, para no subir dos veces lo mismo.
   *
   * El resultado era perdida silenciosa. El 2026-10-09 habia dos envios
   * encallados desde hacia cuatro dias, de cuando se mataron los procesos
   * duplicados del trabajador.
   *
   * No se rescata a ciegas: se mira si la entrega llego a anotarse en `posts`.
   * Si esta anotada, lo unico que fallo fue escribir el estado y se cierra como
   * publicada; si no, no se entrego y vuelve a la cola. Asi no se sube nada dos
   * veces, que era el motivo de no tocarlos.
   */
  rescatarEncallados: (antesDe: Date) => Promise<{ reencolados: number; cerrados: number }>
  /*
   * Toma un envio para esta pasada, de forma atomica.
   *
   * Devuelve true si lo cogio y false si ya no estaba disponible.
   *
   * Antes el worker leia los vencidos y despues escribia 'publishing' en dos
   * pasos. Entre uno y otro cabe otra pasada -- la tarea programada corre cada
   * media hora y una pasada larga se solapa con la siguiente -- y las dos
   * subirian el mismo video. El indice unico de la cola no protege de esto:
   * protege de ENCOLAR dos veces, no de entregar dos veces lo encolado.
   *
   * La condicion `status = 'pending'` dentro del propio UPDATE es lo que lo
   * hace seguro: PostgreSQL serializa las dos escrituras sobre la misma fila y
   * la segunda no encuentra nada que actualizar.
   */
  tomar: (id: string) => Promise<boolean>

  /** Cuantas publicaciones lleva esa cuenta desde ese instante. Para la cadencia. */
  publicacionesDesde: (accountId: string, desde: Date) => Promise<number>
  queue: (id: string, patch: Partial<QueueItem>) => Promise<void>
  post: (row: Post) => Promise<void>
  published: (accountId: string, at: Date) => Promise<void>
  accountStatus: (
    accountId: string,
    status: AccountStatus,
    token?: Account['tokenStatus'],
  ) => Promise<void>
}

/**
 * El almacen de ficheros, que es el de siempre.
 *
 * Sirve a las pruebas y al uso en este mismo ordenador sin base de datos.
 */
export const estadoEnFicheros: EstadoWorker = {
  vencidos: async (now, tope) => (tope === undefined ? queue.due(now) : queue.due(now).slice(0, tope)),
  // El almacen de ficheros es el camino viejo y local; no se rescata nada ahi
  // porque el publicador que encalla corre siempre contra Postgres.
  rescatarEncallados: async () => ({ reencolados: 0, cerrados: 0 }),
  /*
   * En ficheros no hay atomicidad que ofrecer, y no hace falta: ese camino es
   * local, de un solo proceso y ya no lo usa el publicador. Se marca y se
   * sigue, que es exactamente lo que hacia antes de que esto existiera.
   */
  tomar: async (id) => {
    queue.update(id, { status: 'publishing' })
    return true
  },
  publicacionesDesde: async (accountId, desde) => posts.since(accountId, desde).length,
  queue: async (id, patch) => queue.update(id, patch),
  post: async (row) => posts.add(row),
  published: async (accountId, at) => markAccountPublished(accountId, at),
  accountStatus: async (accountId, status, token) => setAccountStatus(accountId, status, token),
}

/**
 * Escrituras del worker, envueltas para respetar el modo en seco.
 *
 * Existe para que el modo en seco no sea una rama aparte del codigo. El worker
 * llama siempre a los mismos metodos; lo unico que cambia es si escriben.
 * Ramificar por dry-run dentro de la logica acabaria con caminos que solo se
 * ejecutan en produccion y por tanto nunca se prueban.
 */
interface WriteSet {
  /*
   * Tomar tambien pasa por aqui, y no es opcional.
   *
   * `estado.tomar` escribe 'publishing' en la base. Llamarlo directo desde el
   * worker se saltaba el modo en seco: una simulacion dejaba la cola marcada
   * como si se estuviera publicando y la prueba "Modo en seco no escribe"
   * fallaba con estado=publishing. En seco se devuelve true sin tocar nada,
   * que es lo que el worker necesita para seguir recorriendo.
   */
  tomar: (id: string) => Promise<boolean>
  queue: (id: string, patch: Partial<QueueItem>) => Promise<void>
  post: (row: Post) => Promise<void>
  published: (accountId: string, at: Date) => Promise<void>
  accountStatus: (
    accountId: string,
    status: AccountStatus,
    token?: Account['tokenStatus'],
  ) => Promise<void>
}

export interface WorkerOptions {
  provider: PublishProvider
  mode: PublishMode
  now?: Date
  /** Tope de publicaciones de esta pasada. Util para probar sin vaciar la cola. */
  limit?: number
  /**
   * Si false, el worker recorre todo pero no escribe estado.
   *
   * Es lo que hace que el modo en seco sea util de verdad: se ejercita la
   * cadencia, la clasificacion de fallos y los reintentos sobre la cola real,
   * sin dejarla consumida. Un dry-run que ademas marca todo como publicado
   * obligaria a regenerar la cola despues de cada prueba.
   */
  persist?: boolean
  /** Donde leer y escribir. Sin esto, los ficheros de state/ de siempre. */
  estado?: EstadoWorker
  /**
   * Como se arma el texto y quien lo ve. Sale de Ajustes.
   *
   * Sin esto, cada proveedor componia el texto a su manera con una copia de la
   * misma linea, y la privacidad estaba fijada en PUBLIC_TO_EVERYONE dentro del
   * codigo. Es opcional para no romper las llamadas sueltas de las pruebas.
   */
  texto?: { plantilla: string; fijos: string; privacidad: string }
  /** Cadencia por cuenta. Sin esto, los topes de TIKTOK_LIMITS. */
  cadencia?: { porMinuto: number; porDia: number }
  /**
   * Cuantas CUENTAS se atienden a la vez. Sin esto, una (como siempre).
   *
   * Nunca se publican dos envios de la misma cuenta a la vez, pase lo que
   * pase aqui: el paralelismo es entre cuentas, que es donde no hay topes
   * compartidos. Subir esto acelera la pasada; no afloja ningun limite.
   */
  concurrencia?: number
}

export interface WorkerReport {
  attempted: number
  published: number
  rateLimited: number
  retried: number
  failed: number
  skippedByCadence: number
  pausedAccounts: string[]
  elapsedMs: number
}

/**
 * Comprueba la cadencia de una cuenta contra el historial real de publicaciones.
 *
 * Se consulta el historial persistido y no un contador en memoria porque el
 * worker puede ejecutarse muchas veces al dia desde procesos distintos. Un
 * contador en memoria daria via libre a la primera ejecucion de cada proceso.
 */
async function cadenceBlock(
  estado: EstadoWorker,
  accountId: string,
  now: Date,
  // Sin topes configurados se usan los de siempre, que son los de TikTok con
  // un margen por debajo.
  topes: { porMinuto: number; porDia: number } = {
    porMinuto: TIKTOK_LIMITS.maxPerMinute,
    porDia: TIKTOK_LIMITS.maxPer24h,
  },
): Promise<string | null> {
  const lastMinute = await estado.publicacionesDesde(accountId, new Date(now.getTime() - 60_000))
  if (lastMinute >= topes.porMinuto) {
    return `${lastMinute} publicaciones en el ultimo minuto (tope ${topes.porMinuto})`
  }

  const lastDay = await estado.publicacionesDesde(
    accountId,
    new Date(now.getTime() - 24 * 3_600_000),
  )
  if (lastDay >= topes.porDia) {
    return `${lastDay} publicaciones en 24 h (tope ${topes.porDia})`
  }

  return null
}

/** Espera antes de reintentar, creciente con el numero de intentos. */
function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** attempt, 900)
}

/**
 * Recorre la cola y publica lo que toca.
 *
 * El worker no decide QUE publicar ni CUANDO: eso lo fijo el planificador. Aqui
 * solo se ejecuta lo vencido respetando los limites y se registra el resultado.
 */
export async function runWorker(options: WorkerOptions): Promise<WorkerReport> {
  const startedAt = performance.now()
  const now = options.now ?? new Date()
  const persist = options.persist !== false

  /*
   * El reloj de la cadencia, que NO es `now`.
   *
   * `now` se congela a proposito para elegir los vencidos: si cambiara a mitad
   * de pasada, el conjunto de items crecerian bajo los pies del bucle.
   *
   * La cadencia necesita lo contrario. Cada subida tarda uno o dos minutos, asi
   * que al llegar al sexto item el `now` del arranque lleva ocho minutos viejo,
   * y la ventana de "ultimo minuto" sigue anclada al principio: cuenta como
   * recientes publicaciones que ya son antiguas. Medido el 2026-09-26: cinco
   * subidas repartidas entre las 21:08 y las 21:15 bloquearon las seis
   * siguientes con "5 publicaciones en el ultimo minuto".
   *
   * Sigue siendo inyectable para las pruebas: con options.now puesto, se
   * comporta como un reloj parado, que es justo lo que quiere un test.
   */
  const reloj = (): Date => options.now ?? new Date()

  // Envoltorios de escritura. Con persist=false el worker se comporta igual
  // pero no toca el estado.
  const estado = options.estado ?? estadoEnFicheros
  const write: WriteSet = {
    tomar: async (id) => (persist ? estado.tomar(id) : true),
    queue: async (id, patch) => {
      if (persist) await estado.queue(id, patch)
    },
    post: async (row) => {
      if (persist) await estado.post(row)
    },
    published: async (accountId, at) => {
      if (persist) await estado.published(accountId, at)
    },
    accountStatus: async (accountId, status, token) => {
      if (persist) await estado.accountStatus(accountId, status, token)
    },
  }

  const report: WorkerReport = {
    attempted: 0,
    published: 0,
    rateLimited: 0,
    retried: 0,
    failed: 0,
    skippedByCadence: 0,
    pausedAccounts: [],
    elapsedMs: 0,
  }

  /*
   * Antes de nada, rescatar lo que se quedo a medias.
   *
   * Media hora de margen sobre una subida que tarda medio minuto: sesenta veces
   * mas de lo que puede durar. Si algo lleva mas que eso en 'publishing', no
   * hay ninguna pasada subiendolo, hubo un corte.
   *
   * Solo cuando se escribe de verdad. Con persist=false esto seria una
   * simulacion que cambia la base, que es lo contrario de una simulacion.
   */
  if (persist) {
    const limite = new Date(reloj().getTime() - 30 * 60_000)
    const { reencolados, cerrados } = await estado.rescatarEncallados(limite)
    if (reencolados > 0) log.warn(`${reencolados} envio(s) encallado(s) devueltos a la cola`)
    if (cerrados > 0) log.info(`${cerrados} envio(s) ya entregados, solo faltaba anotarlos`)
  }

  /*
   * El tope viaja a la consulta, no se aplica despues.
   *
   * Se traian TODAS las filas vencidas y se recortaban en memoria con
   * `slice`. Con las seis de hoy da igual; con doscientas cuentas serian
   * seiscientas filas cruzando la red para usar doce. El limite lo pone ahora
   * PostgreSQL, que es quien puede dejar de leerlas.
   */
  const due = await estado.vencidos(now, options.limit)

  log.info(
    `${due.length} publicacion(es) vencida(s) | proveedor=${options.provider.name} | modo=${options.mode}`,
  )

  /*
   * EN PARALELO ENTRE CUENTAS, EN SERIE DENTRO DE CADA UNA.
   *
   * Hasta aqui era un solo bucle en serie sobre todos los envios. Con dos
   * cuentas activas eso son seis envios al dia y da igual. Con doscientas
   * serian seiscientos: a quince segundos por subida, dos horas y media por
   * pasada, y la tarea programada corre cada treinta minutos. Las pasadas se
   * solapan y el sistema deja de funcionar por como esta escrito el bucle, no
   * por ningun limite real.
   *
   * La division por cuenta no es un detalle de implementacion, es lo que hace
   * que esto sea correcto:
   *
   *   - Los topes de TikTok son POR CUENTA (5 por minuto, 13 al dia). Dos
   *     cuentas distintas publicando a la vez no violan nada.
   *   - Dos envios de la MISMA cuenta si se pisarian: cadenceBlock cuenta lo
   *     publicado hasta ese instante, y lanzados a la vez los dos leerian el
   *     mismo recuento y pasarian los dos.
   *   - authFailures cuenta fallos de permiso por cuenta para pausarla. Con
   *     una cadena por cuenta, ese contador no lo tocan dos a la vez.
   *
   * Y de paso resuelve el otro cuello: las dos consultas de cadencia por
   * envio dejan de sumarse una detras de otra y se solapan entre cadenas.
   */
  const porCuenta = new Map<string, QueueItem[]>()
  for (const item of due) {
    const lista = porCuenta.get(item.accountId)
    if (lista === undefined) porCuenta.set(item.accountId, [item])
    else lista.push(item)
  }

  const authFailures = new Map<string, number>()

  /*
   * El corte en seco, ahora compartido entre las cadenas.
   *
   * Antes era un `break` sobre el unico bucle. Con varias cadenas a la vez
   * hace falta una bandera que todas miren ANTES de empezar el siguiente
   * envio: lo que se quiere es no gastar una llamada por item cuando el
   * problema es del sistema, y eso vale igual con una cadena que con ocho.
   *
   * No aborta lo que ya esta en vuelo; esas subidas terminan y se anotan.
   */
  const corte = { seguidos: 0, parar: false }

  async function cadenaDeCuenta(items: QueueItem[]): Promise<void> {
    for (const item of items) {
      if (corte.parar) return

      const blocked = await cadenceBlock(estado, item.accountId, reloj(), options.cadencia)
      if (blocked !== null) {
        // No es un fallo: la publicacion sigue pendiente y entra en la
        // siguiente pasada. Contarla como intento fallido gastaria reintentos
        // por nada. Y el resto de la cadena de ESTA cuenta tampoco va a pasar
        // la cadencia, asi que se corta aqui en vez de preguntar otra vez.
        log.warn(`${item.accountId}: pospuesta por cadencia, ${blocked}`)
        report.skippedByCadence += items.length - items.indexOf(item)
        return
      }

      /*
       * Tomarlo antes de subir, y si otro se lo llevo, saltarlo.
       *
       * Esto es lo que impide la doble entrega entre pasadas solapadas.
       */
      if (!(await write.tomar(item.id))) {
        log.warn(`${item.id}: ya lo cogio otra pasada, se salta`)
        continue
      }

      report.attempted += 1
      await procesarEnvio(item)
    }
  }

  /*
   * Cuantas cadenas a la vez.
   *
   * Acotado por el numero de cuentas que de verdad tienen algo pendiente: con
   * tres cuentas no tiene sentido abrir ocho cadenas. El valor sale de los
   * ajustes y no de una constante, que es justo lo que pedia no repetir el
   * error del tope de cuentas.
   */
  const cuentas = [...porCuenta.values()]
  const aLaVez = Math.max(1, Math.min(options.concurrencia ?? 1, cuentas.length))
  log.info(`${cuentas.length} cuenta(s) con envios, ${aLaVez} en paralelo`)

  let siguiente = 0
  await Promise.all(
    Array.from({ length: aLaVez }, async () => {
      // Cada hilo coge la siguiente cuenta libre en cuanto termina la suya.
      // Repartir las cuentas de antemano dejaria hilos parados mientras otro
      // arrastra la cuenta con mas envios.
      for (;;) {
        const i = siguiente
        siguiente += 1
        const items = cuentas[i]
        if (items === undefined) return
        await cadenaDeCuenta(items)
      }
    }),
  )

  /*
   * Un envio, de principio a fin. Es el cuerpo del bucle de antes, tal cual.
   *
   * Se saca a una funcion porque ahora hay varias cadenas llamandolo y porque
   * el corte en seco dejo de ser un `break` para ser una bandera compartida.
   */
  async function procesarEnvio(item: QueueItem): Promise<void> {
    const result = await options.provider.publish({
      accountId: item.accountId,
      videoPath: item.variantPath,
      caption: item.caption,
      hashtags: item.hashtags,
      mode: options.mode,
      ...(options.texto === undefined
        ? {}
        : {
            texto: construirTexto({
              caption: item.caption,
              hashtags: item.hashtags,
              plantilla: options.texto.plantilla,
              fijos: options.texto.fijos,
            }),
            privacidad: options.texto.privacidad,
          }),
    })

    if (result.ok) {
      const publishedAt = new Date()
      await write.queue(item.id, { status: 'published', lastError: null })
      await write.post({
        id: randomUUID(),
        queueItemId: item.id,
        sourceId: item.sourceId,
        clipId: item.clipId,
        accountId: item.accountId,
        externalId: result.externalId,
        provider: options.provider.name,
        mode: result.mode,
        publishedAt: publishedAt.toISOString(),
      })
      await write.published(item.accountId, publishedAt)
      authFailures.delete(item.accountId)
      report.published += 1
      corte.seguidos = 0
      return
    }

    await handleFailure(item, result, report, authFailures, write)

    /*
     * Corte en seco cuando el fallo es del sistema, no del item.
     *
     * Hay rechazos que no dependen del video ni de la cuenta: la app sin
     * auditar, el proveedor caido. Seguir recorriendo la cola entera es gastar
     * una llamada por item para recibir exactamente la misma negativa. Con 110
     * publicaciones repartidas eso son 110 peticiones inutiles y una cola
     * reprogramada a lo tonto.
     *
     * Tres seguidos y se para. Tres y no uno porque un fallo aislado puede ser
     * de ese archivo o de esa cuenta; tres del mismo tipo seguidos ya no.
     */
    corte.seguidos =
      result.kind === 'rate_limit' || result.kind === 'transient' ? corte.seguidos + 1 : 0
    if (corte.seguidos >= CORTE_SEGUIDOS && !corte.parar) {
      corte.parar = true
      log.warn(
        `${corte.seguidos} fallos seguidos del mismo tipo. Se para la pasada: el problema no ` +
          'es de un video concreto. Ultimo mensaje: ' + result.message,
      )
    }
  }


  report.elapsedMs = performance.now() - startedAt
  return report
}

async function handleFailure(
  item: QueueItem,
  result: Extract<Awaited<ReturnType<PublishProvider['publish']>>, { ok: false }>,
  report: WorkerReport,
  authFailures: Map<string, number>,
  write: WriteSet,
): Promise<void> {
  const nextAttempt = item.attemptCount + 1

  switch (result.kind) {
    case 'rate_limit': {
      // El proveedor dice cuanto esperar. Reintentar antes solo consigue otro
      // rechazo, asi que se reprograma y NO se consume un intento.
      const waitSec = result.retryAfterSec ?? 60
      const nextAt = new Date(Date.now() + waitSec * 1000)
      await write.queue(item.id, {
        status: 'pending',
        scheduledAt: nextAt.toISOString(),
        lastError: result.message,
      })
      log.warn(`${item.accountId}: limite alcanzado, reprogramada en ${waitSec} s`)
      report.rateLimited += 1
      return
    }

    case 'auth': {
      const count = (authFailures.get(item.accountId) ?? 0) + 1
      authFailures.set(item.accountId, count)
      await write.queue(item.id, {
        status: 'pending',
        attemptCount: nextAttempt,
        lastError: result.message,
      })

      if (count >= AUTH_FAILURES_BEFORE_PAUSE) {
        // Seguir intentando con un token invalido gasta cuota y ensucia el log.
        // Sacar la cuenta de rotacion es lo unico util aqui.
        await write.accountStatus(item.accountId, 'error', 'expired')
        report.pausedAccounts.push(item.accountId)
        log.error(`${item.accountId}: pausada tras ${count} fallos de autenticacion`)
      }
      report.failed += 1
      return
    }

    case 'media':
    case 'permanent': {
      // Reintentar no cambia el resultado: el archivo o la peticion son
      // invalidos. Se marca como fallida para que aparezca en la revision.
      await write.queue(item.id, {
        status: 'failed',
        attemptCount: nextAttempt,
        lastError: result.message,
      })
      log.error(`${item.accountId}/${item.clipId}: fallo definitivo, ${result.message}`)
      report.failed += 1
      return
    }

    case 'transient': {
      if (nextAttempt >= MAX_ATTEMPTS) {
        await write.queue(item.id, {
          status: 'failed',
          attemptCount: nextAttempt,
          lastError: `Agotados ${MAX_ATTEMPTS} intentos: ${result.message}`,
        })
        log.error(`${item.accountId}: agotados los reintentos`)
        report.failed += 1
        return
      }

      const waitSec = backoffSeconds(nextAttempt)
      await write.queue(item.id, {
        status: 'pending',
        attemptCount: nextAttempt,
        scheduledAt: new Date(Date.now() + waitSec * 1000).toISOString(),
        lastError: result.message,
      })
      log.warn(
        `${item.accountId}: intento ${nextAttempt}/${MAX_ATTEMPTS}, ` +
          `reintenta en ${formatDuration(waitSec * 1000)}`,
      )
      report.retried += 1
      return
    }
  }
}
