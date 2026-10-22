import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { arrancarCadena } from '../jobs/cadena.js'
import { createCola, type Job } from '../jobs/cola.js'
import { repartirSiToca, type Reparto } from '../jobs/reparto.js'
import { proveedorActivo } from '../publish/proveedor.js'
import { createLogger } from '../lib/logger.js'
import { createRunsStore } from '../store/runs-pg.js'
import { createStore, type Store } from '../store/pg.js'
import type { Db } from '../store/db.js'
import {
  flowMath,
  InvalidSettings,
  loadSettingsDb,
  saveSettingsDb,
  type FlowSettings,
} from '../queue/settings.js'
import {
  clipsEstimados,
  FUENTES,
  InvalidClipSettings,
  loadClipSettings,
  saveClipSettings,
  type ClipSettings,
} from '../select/ajustes.js'
import {
  borrarPlantilla,
  guardarPlantilla,
  InvalidPlantilla,
  leerPlantilla,
  listarPlantillas,
} from '../select/plantillas.js'
import { canjearCodigo, credenciales, enlaceAutorizacion } from '../publish/tiktok/oauth.js'
import { TikTokProvider } from '../publish/providers/tiktok.js'
import { crearTokens } from '../publish/tiktok/tokens.js'
import { crearProyectos, ProyectoError } from '../store/proyectos.js'
import { canalesConfigurados } from '../alertas/canales.js'
import { iniciarVigia, probarAlertas, ultimasAlertas } from '../alertas/vigia.js'
import { paginaPrivacidad, paginaTerminos } from './legal.js'
import { crearNube, type Nube } from '../store/nube.js'
import { PLATAFORMAS, repartirFranjas, type Plataforma } from '../store/store.js'
import type { ClipRecord, ClipStatus, Post } from '../store/store.js'
import { PLANES_UPLOAD_POST, describirTope, planDe } from '../publish/planes.js'
import { renderPage, SCRIPT_PANEL } from './page.js'
import {
  aplicarCabeceras,
  anotarAuditoria,
  claseDePeticion,
  crearLimitador,
  direccionDe,
  DURACION_ENLACE_S,
  firmarEnlace,
  huellaScript,
  leerAuditoria,
  verificarEnlace,
} from './seguridad.js'
import { limpiarRutas } from '../lib/limpiar.js'
import { renderPerdido } from './perdido.js'
import { BadRequest, buildJob } from './pipeline.js'
import { storeUpload, UploadError } from './upload.js'
import { createEstadoIA, iaPausada, textoEstadoIA } from '../llm/estado.js'
import { createAuth, ErrorUsuarios, permitido, type Auth } from '../auth/auth.js'
import { createSistema, NAVEGADORES_COOKIES } from '../jobs/sistema.js'
import { rutaFotograma } from '../render/render.js'
import {
  atenderAcceso,
  esCifrada,
  galletaSesion,
  legadoActivo,
  mismoOrigen,
  negarPermiso,
  pedirLogin,
  quienEs,
  sinLoginActivo,
  type Quien,
} from './acceso.js'

const log = createLogger('review')

/**
 * Panel de revision.
 *
 * Servidor propio sin dependencias en lugar de Next.js. El panel necesita tres
 * cosas: listar clips, reproducir un MP4 y guardar una decision. Montar React,
 * un bundler y un framework para eso añadiria cientos de dependencias a un
 * proyecto que hoy tiene tres, y no haria nada que esto no haga.
 *
 * TODO EL ESTADO VIVE EN POSTGRES. Antes estaba en ficheros JSON y en memoria,
 * y funcionaba mientras el panel y el trabajo pesado eran el mismo proceso en
 * el mismo ordenador. Ya no lo son: el panel corre en un servidor sin tarjeta
 * grafica y el render en el PC de casa. Dos procesos escribiendo un JSON se
 * pisan en silencio; la base de datos es lo que los coordina.
 *
 * El panel NO EJECUTA NADA. Apunta la tarea en la tabla `jobs` y el trabajador
 * la recoge cuando pregunta. Por eso todas las rutas de trabajos devuelven en
 * cuanto encolan, sin esperar resultado.
 */

/**
 * Si este panel corre lejos de los archivos de video.
 *
 * En el servidor no existen ni los MP4 ni el directorio de trabajo, y las dos
 * funciones que dependen de ellos (reproducir un clip y subir un VOD desde el
 * ordenador) no pueden funcionar ahi. Se apagan con un mensaje claro en vez de
 * fallar con un 404 o un archivo que nadie recogera nunca.
 *
 * SE LEE EN CADA LLAMADA, no una vez al cargar el modulo. En ESM los imports se
 * evaluan antes que el cuerpo del fichero que importa, asi que una constante
 * aqui congelaria el valor antes de que el proceso que arranca el panel tenga
 * ocasion de ponerla. Se detecto porque el arranque decia estar en modo local
 * teniendo PANEL_REMOTO=1 puesto.
 */
function esRemoto(): boolean {
  return process.env.PANEL_REMOTO === '1'
}

interface ClipView extends ClipRecord {
  hasFile: boolean
  durationSec: number
}

function toView(clip: ClipRecord): ClipView {
  /*
   * Hay video si se puede reproducir, venga de donde venga.
   *
   * En este ordenador, del master en disco. En el servidor no hay disco que
   * mirar (preguntar por el fichero seria mirar el disco equivocado), asi que
   * lo que cuenta es si existe la copia subida.
   *
   * Es una sola propiedad a proposito: al panel le da igual de donde salga el
   * video, solo necesita saber si pinta un reproductor o un aviso.
   */
  const enDisco = !esRemoto() && clip.masterPath !== '' && existsSync(clip.masterPath)
  return {
    ...clip,
    hasFile: enDisco || clip.proxyPath !== '',
    durationSec: Number((clip.end - clip.start).toFixed(1)),
  }
}

/**
 * Fase 8: una tarea tal como la ve el navegador. Los argumentos pueden llevar
 * la ruta completa de un MP4 subido (C:Users...), que no debe salir del
 * servidor: se recorta igual que la salida de las tareas.
 */
function jobParaPanel<T extends { args: string[] } | null | undefined>(job: T): T {
  if (job === null || job === undefined) return job
  return { ...job, args: job.args.map((a) => limpiarRutas(a)) }
}

/** Fase 8: la huella del script del panel, para la politica de contenido. */
const HUELLA_PANEL = huellaScript(SCRIPT_PANEL)
const limitador = crearLimitador()

/** Lo mas que se acepta en un cuerpo JSON. Los videos van por /api/upload. */
const MAX_CUERPO = 2 * 1024 * 1024

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  /*
   * Fase 8: ningun mensaje de error sale con rutas del disco ni claves.
   * Muchos vienen de excepciones (error.message) y de la salida de las
   * tareas; limpiarlos aqui cubre todos los caminos de una vez.
   */
  if (body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    body = { ...(body as Record<string, unknown>), error: limpiarRutas((body as { error: string }).error) }
  }
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

const REVIEW_USER = 'revisor'

/**
 * Compara dos cadenas sin filtrar informacion por el tiempo que tarda.
 *
 * Se comparan los hashes y no las cadenas porque timingSafeEqual exige que los
 * dos buffers midan lo mismo, y la longitud de la contraseña no debe deducirse
 * del error. El hash iguala el tamaño siempre.
 */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  )
}

/** Nombre de la galleta donde se guarda la llave una vez usada. */
const GALLETA = 'klip_llave'

/** Lee una galleta de la cabecera, sin dependencias. */
function leerGalleta(req: IncomingMessage, nombre: string): string | undefined {
  for (const trozo of (req.headers.cookie ?? '').split(';')) {
    const igual = trozo.indexOf('=')
    if (igual === -1) continue
    if (trozo.slice(0, igual).trim() !== nombre) continue
    return decodeURIComponent(trozo.slice(igual + 1).trim())
  }
  return undefined
}

/**
 * Quien puede entrar.
 *
 * Hay dos formas, y las dos son opcionales. Sin ninguna configurada el panel no
 * pide nada, y por eso el arranque solo escucha entonces en la interfaz local:
 * ver startReviewServer. Un panel sin proteccion en 0.0.0.0 es ejecucion remota
 * para cualquiera que llegue.
 *
 *   REVIEW_KEY       una llave larga que viaja en el enlace (?k=...). Al
 *                    acertar se guarda en una galleta y el enlace deja de hacer
 *                    falta. No sale ningun dialogo.
 *
 *   REVIEW_PASSWORD  la autenticacion basica de siempre, con su dialogo.
 *
 * LA LLAVE EXISTE PORQUE EL DIALOGO ESTORBA, no porque sobre la contraseña. Con
 * una llave de 32 bytes al azar, adivinarla es tan improbable como adivinar la
 * contraseña, y se puede guardar en favoritos. Lo que NO es, es secreto frente a
 * quien mire por encima del hombro: va en la direccion la primera vez.
 *
 * La comprobacion va antes de CUALQUIER ruta, incluida la del video. Protegerla
 * solo en el HTML dejaria los MP4 accesibles a quien adivinara la ruta, que es
 * justo lo que hay que evitar al abrir esto al exterior.
 */
/**
 * La unica ruta que atiende sin llave, y por que tiene que ser asi.
 *
 * Cuando una cuenta autoriza la app, TikTok devuelve el navegador a nuestra
 * direccion de retorno. Esa peticion viene de una redireccion de tiktok.com y
 * no lleva ni la llave ni la galleta del panel, asi que exigirlas convertiria
 * el enlace en un 403 justo al final del flujo.
 *
 * Lo que la protege no es la llave, es el `state`: un valor de un solo uso que
 * emitio este mismo sistema, que caduca en una hora y que se comprueba contra
 * la base antes de canjear nada. Sin un state valido, la ruta no hace nada.
 *
 * No sirve nada ni lee nada: solo acepta un codigo, lo canjea y responde una
 * pagina de texto.
 */
function esRetornoDeTikTok(url: URL): boolean {
  return url.pathname === '/auth/tiktok/callback'
}

/**
 * Las paginas legales son publicas, y tienen que serlo.
 *
 * TikTok las exige para auditar la app, y quien las revisa no tiene la llave
 * del panel. Una politica de privacidad detras de una contraseña no cumple su
 * funcion: existe justo para que la lea alguien de fuera.
 *
 * No leen ni sirven nada: componen texto fijo a partir de variables de entorno.
 */
function esPaginaLegal(url: URL): boolean {
  return url.pathname === '/legal/terminos' || url.pathname === '/legal/privacidad'
}

/**
 * Escapa para HTML.
 *
 * Solo se usa en la pagina de retorno de TikTok, que es la unica que este
 * modulo compone a mano. Todo lo demas sale por sendJson, que ya escapa. Y lo
 * que se pinta aqui viene de la direccion, asi que sin esto seria XML inyectado
 * desde fuera en la unica ruta que atiende sin llave.
 */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function authorized(req: IncomingMessage, url: URL): boolean {
  if (esRetornoDeTikTok(url) || esPaginaLegal(url)) return true

  const llave = process.env.REVIEW_KEY
  const clave = process.env.REVIEW_PASSWORD
  const hayLlave = llave !== undefined && llave !== ''
  const hayClave = clave !== undefined && clave !== ''

  if (!hayLlave && !hayClave) return true

  if (hayLlave) {
    const enviada = url.searchParams.get('k') ?? leerGalleta(req, GALLETA)
    if (enviada !== null && enviada !== undefined && safeEqual(enviada, llave)) return true
  }

  if (hayClave) {
    const header = req.headers.authorization ?? ''
    if (!header.startsWith('Basic ')) return false

    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator === -1) return false

    // Las dos comparaciones se evaluan siempre, sin cortocircuito, para no
    // revelar por el tiempo si el fallo estuvo en el usuario o en la clave.
    const userOk = safeEqual(decoded.slice(0, separator), REVIEW_USER)
    const passOk = safeEqual(decoded.slice(separator + 1), clave)
    return userOk && passOk
  }

  return false
}

/**
 * Canales abiertos hacia los navegadores conectados.
 *
 * Existe para avisar de cambios en los DATOS, no solo en los trabajos. Aprobar
 * un video cambia cuentas que se ven en cuatro secciones distintas; sin este
 * aviso, cada pestaña abierta sigue enseñando el numero viejo hasta que alguien
 * navega a otra parte.
 */
const oyentes = new Set<(event: string, data: unknown) => void>()

function emitir(event: string, data: unknown): void {
  for (const send of oyentes) {
    try {
      send(event, data)
    } catch {
      // Un navegador que ya se fue no debe romper el aviso a los demas.
    }
  }
}

/** Avisa a todos los navegadores de que algo cambio y toca releer. */
function avisarCambio(que: string): void {
  emitir('datos', { que })
}

/**
 * Vigila la tabla de tareas y avisa de lo que cambia.
 *
 * ES UN SONDEO, y eso es nuevo. Antes el panel lanzaba los procesos y se
 * enteraba del progreso por el canal de salida del hijo. Ahora quien los
 * ejecuta es el trabajador, en otro ordenador: la unica forma de enterarse es
 * mirar la tabla que el trabajador va escribiendo.
 *
 * Solo se sondea si hay alguien mirando. Un panel abierto en ninguna pestaña no
 * tiene a quien avisar, y consultar la base cada tres segundos las veinticuatro
 * horas por si acaso es gasto puro.
 */
function vigilarTareas(cola: ReturnType<typeof createCola>): () => void {
  const INTERVALO_MS = 3_000
  const visto = new Map<string, string>()

  const huella = (j: Job): string => `${j.status}|${j.lastLine}|${j.attemptCount}`

  const mirar = async (): Promise<void> => {
    if (oyentes.size === 0) return

    for (const job of await cola.recientes(20)) {
      const ahora = huella(job)
      if (visto.get(job.id) === ahora) continue
      visto.set(job.id, ahora)
      // Sin el registro completo: son cientos de kilobytes y el panel solo
      // enseña la ultima linea hasta que alguien abre los detalles.
      const { log: _log, ...resto } = job
      emitir('job', jobParaPanel(resto))
    }
  }

  const timer = setInterval(() => {
    void mirar().catch((error: unknown) => log.error('No se pudo leer la cola', error))
  }, INTERVALO_MS)
  timer.unref()

  return () => clearInterval(timer)
}

/**
 * Progreso en vivo por Server-Sent Events.
 *
 * Se elige SSE y no WebSocket porque el flujo va en un solo sentido: el
 * servidor cuenta lo que pasa y el navegador escucha. SSE es HTTP normal, va
 * sobre el mismo puerto, atraviesa el tunel sin configuracion y el navegador
 * reconecta solo cuando se corta. Un WebSocket exigiria una dependencia y
 * manejar reconexion a mano para no ganar nada.
 */
function streamEvents(
  req: IncomingMessage,
  res: ServerResponse,
  activo: string | null,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Sin esto, un proxy intermedio acumula la respuesta y el progreso llega a
    // golpes al final en vez de en vivo.
    'x-accel-buffering': 'no',
  })

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  send('hello', { active: activo })
  oyentes.add(send)

  // Latido cada 25 segundos. Cloudflare corta las conexiones ociosas alrededor
  // de los 100, y sin trafico un trabajo largo y silencioso perderia el canal.
  const beat = setInterval(() => res.write(': beat\n\n'), 25_000)

  const close = (): void => {
    clearInterval(beat)
    oyentes.delete(send)
    res.end()
  }
  req.on('close', close)
  req.on('error', close)
}

/**
 * Resumen de rendimiento para la vista de metricas.
 *
 * Devuelve estructura vacia y no un error cuando todavia no se ha publicado
 * nada, que es el caso hoy: la vista debe poder enseñar "aun no hay datos" en
 * vez de romperse. La correlacion entre la puntuacion del modelo y las vistas
 * reales es lo unico que dira si esas notas valen algo.
 */
async function buildMetrics(store: Store): Promise<Record<string, unknown>> {
  const [allPosts, snapshots] = await Promise.all([store.posts.all(), store.metrics.all()])

  if (allPosts.length === 0) {
    return { published: 0, snapshots: 0, byClip: [], byAccount: [], semana: null, lastCapture: null }
  }

  // Ultima lectura de cada publicacion: las anteriores son historia y para el
  // resumen solo interesa el estado mas reciente.
  const latest = new Map<string, (typeof snapshots)[number]>()
  for (const snap of snapshots) {
    const prev = latest.get(snap.postId)
    if (prev === undefined || snap.capturedAt > prev.capturedAt) latest.set(snap.postId, snap)
  }

  // Las notas de todos los clips de una vez. Antes se buscaba clip a clip, que
  // contra un fichero en memoria era gratis y contra una base remota son tantas
  // idas y vueltas como publicaciones haya.
  const notas = new Map((await store.clips.all()).map((c) => [`${c.sourceId}/${c.clipId}`, c.score]))

  /*
   * El titulo del VOD acompaña a cada fila.
   *
   * Los identificadores de clip se repiten entre VOD distintos: cada uno empieza
   * en clip-01. La tabla agrupaba bien (la clave es fuente/clip) pero enseñaba
   * solo el clip, asi que salian dos 'clip-01' con notas distintas y no habia
   * forma de saber cual era cual.
   */
  const titulos = new Map((await store.sources.all()).map((f) => [f.sourceId, f.title]))

  // Fase 7: likes y comentarios ademas de vistas, y la misma tabla por cuenta.
  type Cifras = { posts: number; views: number; likes: number; comments: number }
  const sumar = (row: Cifras, postId: string): void => {
    const s = latest.get(postId)
    row.posts += 1
    row.views += s?.views ?? 0
    row.likes += s?.likes ?? 0
    row.comments += s?.comments ?? 0
  }

  const byClip = new Map<string, { clipId: string; fuente: string; score: number } & Cifras>()
  const alias = new Map((await store.accounts.all()).map((a) => [a.id, a.alias ?? '']))
  const byAccount = new Map<string, { accountId: string; alias: string } & Cifras>()
  for (const post of allPosts) {
    const key = `${post.sourceId}/${post.clipId}`
    const row = byClip.get(key) ?? {
      clipId: post.clipId,
      fuente: titulos.get(post.sourceId) ?? post.sourceId,
      score: notas.get(key) ?? 0,
      posts: 0,
      views: 0,
      likes: 0,
      comments: 0,
    }
    sumar(row, post.id)
    byClip.set(key, row)

    const cuenta = byAccount.get(post.accountId) ?? {
      accountId: post.accountId,
      alias: alias.get(post.accountId) ?? '',
      posts: 0,
      views: 0,
      likes: 0,
      comments: 0,
    }
    sumar(cuenta, post.id)
    byAccount.set(post.accountId, cuenta)
  }

  /*
   * Resumen semanal: lo publicado en los ultimos 7 dias contra los 7 de
   * antes, cada publicacion con su ultima lectura. Compara semanas de
   * publicacion, no de lectura: es lo que dice si los clips de esta semana
   * funcionan mejor que los de la anterior.
   */
  const ahora = Date.now()
  const semana = (desde: number, hasta: number): Cifras => {
    const row = { posts: 0, views: 0, likes: 0, comments: 0 }
    for (const p of allPosts) {
      const t = new Date(p.publishedAt).getTime()
      if (t >= ahora - desde * 86_400_000 && t < ahora - hasta * 86_400_000) sumar(row, p.id)
    }
    return row
  }

  const captures = snapshots.map((s) => s.capturedAt).sort()

  return {
    published: allPosts.length,
    snapshots: snapshots.length,
    lastCapture: captures.at(-1) ?? null,
    byClip: [...byClip.values()].sort((a, b) => b.views - a.views),
    byAccount: [...byAccount.values()].sort((a, b) => b.views - a.views),
    semana: { actual: semana(7, 0), anterior: semana(14, 7) },
  }
}

/**
 * La cola agrupada por VOD.
 *
 * Se agrupa por origen y no por fecha porque la pregunta que se hace uno al
 * mirar la cola es "de que video sale todo esto y cuanto ha rendido", no "que
 * toca a las 14:30". El detalle por hora esta dentro de cada grupo.
 */
/**
 * Cuantas publicaciones futuras se listan una por una.
 *
 * La cola puede tener cientos. Nadie planifica mirando la numero 180, y
 * mandarlas todas al navegador solo para pintar un scroll infinito es peso
 * muerto en una conexion de movil.
 */
const PROXIMAS = 40

async function buildQueue(store: Store): Promise<Record<string, unknown>> {
  const [items, fuentes] = await Promise.all([store.queue.all(), store.sources.all()])
  const sources = new Map<
    string,
    {
      sourceId: string
      title: string
      clips: Set<string>
      items: number
      byStatus: Record<string, number>
      next: string | null
      accounts: Set<string>
    }
  >()

  const titles = new Map(fuentes.map((s) => [s.sourceId, s.title]))

  for (const item of items) {
    const row = sources.get(item.sourceId) ?? {
      sourceId: item.sourceId,
      title: titles.get(item.sourceId) ?? item.sourceId,
      clips: new Set<string>(),
      items: 0,
      byStatus: {},
      next: null,
      accounts: new Set<string>(),
    }

    row.clips.add(item.clipId)
    row.accounts.add(item.accountId)
    row.items += 1
    row.byStatus[item.status] = (row.byStatus[item.status] ?? 0) + 1

    // Solo cuenta como "proximo" lo que sigue pendiente: una fecha ya publicada
    // no dice nada de lo que viene.
    if (item.status === 'pending' && (row.next === null || item.scheduledAt < row.next)) {
      row.next = item.scheduledAt
    }

    sources.set(item.sourceId, row)
  }

  /*
   * El calendario: que sale, en que cuenta y cuando.
   *
   * Es lo que la seccion prometia por su nombre y no enseñaba. Antes solo habia
   * un resumen por VOD ("este se repite 4,2 veces"), util para juzgar si la
   * cola esta sana pero incapaz de responder a "que se publica esta tarde".
   *
   * Vencidas primero y luego por fecha: lo que tenia que haber salido y sigue
   * ahi es lo unico de esta pantalla que pide una decision.
   */
  const ahora = new Date().toISOString()
  const proximas = items
    .filter((i) => i.status === 'pending')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, PROXIMAS)
    .map((i) => ({
      clipId: i.clipId,
      sourceId: i.sourceId,
      title: titles.get(i.sourceId) ?? i.sourceId,
      accountId: i.accountId,
      caption: i.caption,
      scheduledAt: i.scheduledAt,
      vencida: i.scheduledAt < ahora,
    }))

  const pendientes = items.filter((i) => i.status === 'pending').length

  return {
    total: items.length,
    pendientes,
    vencidas: proximas.filter((p) => p.vencida).length,
    /** Cuantas quedan fuera de la lista, para poder decirlo en vez de ocultarlo. */
    masAlla: Math.max(0, pendientes - proximas.length),
    proximas,
    sources: [...sources.values()]
      .map((r) => ({
        sourceId: r.sourceId,
        title: r.title,
        clips: r.clips.size,
        accounts: r.accounts.size,
        items: r.items,
        byStatus: r.byStatus,
        next: r.next,
      }))
      .sort((a, b) => b.items - a.items),
  }
}

/** La tarea que se esta ejecutando ahora mismo, si la hay. */
function enMarcha(jobs: Job[]): Job | null {
  return jobs.find((j) => j.status === 'running') ?? jobs.find((j) => j.status === 'queued') ?? null
}

/**
 * Lo que el panel enseña de la IA: estado, frase lista para pintar, si esta
 * en pausa y cuantas tareas la esperan. Lo escribe el trabajador del PC.
 */
async function resumenIA(db: Db, ownerId: string): Promise<Record<string, unknown>> {
  const info = await createEstadoIA(db, ownerId).leer()
  const filas = await db.query<{ n: string }>(
    `select count(*) as n from jobs where owner_id = $1 and status = 'en_espera_ia'`,
    [ownerId],
  )
  return {
    ...info,
    texto: textoEstadoIA(info),
    pausada: iaPausada(info),
    enEspera: Number(filas[0]?.n ?? 0),
    // Con la suscripcion el coste no se calcula.
    coste: info.proveedor === 'anthropic-api' ? 'Según uso de la API' : 'Incluido en la suscripción',
  }
}

/** Estado general para la vista de monitorizacion. */
async function buildOverview(
  store: Store,
  cola: ReturnType<typeof createCola>,
  db: Db,
  ownerId: string,
): Promise<Record<string, unknown>> {
  // Todo en paralelo: son consultas independientes y encadenarlas
  // multiplicaria la latencia de la pantalla que mas se carga.
  const [all, items, fuentes, cuentas, variants, settings, jobs, ritmo, posts] =
    await Promise.all([
      store.clips.all(),
      store.queue.all(),
      store.sources.all(),
      store.accounts.publicables(),
      store.sources.contarVariantes(),
      loadSettingsDb(db, ownerId),
      cola.recientes(1),
      contarPorFecha(db, ownerId),
      store.posts.all(),
    ])

  const counts = {
    pending: all.filter((c) => c.status === 'pending').length,
    approved: all.filter((c) => c.status === 'approved').length,
    rejected: all.filter((c) => c.status === 'rejected').length,
  }

  const byStatus: Record<string, number> = {}
  for (const item of items) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1

  /*
   * Cuantos clips de cada VOD tienen ya copia en la nube, y cuanto ocupan.
   *
   * Se cuenta aqui sobre los clips que ya estan cargados en vez de pedirselo a
   * la base con otra consulta: son las mismas filas, ya en memoria.
   */
  const subidos: Record<string, number> = {}
  let nubeBytes = 0
  for (const c of all) {
    if (c.proxyPath === '') continue
    subidos[c.sourceId] = (subidos[c.sourceId] ?? 0) + 1
    nubeBytes += c.proxyBytes
  }

  /*
   * DONDE cae cada momento dentro de su VOD.
   *
   * Es lo que dibuja la linea de tiempo compacta de cada ficha. Sale de la
   * misma lista de clips que ya esta cargada aqui arriba para los contadores,
   * asi que no cuesta ninguna consulta mas.
   *
   * Solo viajan tres numeros por clip -- principio, fin y estado -- y no el
   * clip entero: con ochenta y cinco clips, mandar los pies y las etiquetas
   * para pintar unas rayas serian decenas de kilobytes en la pantalla que mas
   * se abre.
   */
  const momentos: Record<string, { s: number; e: number; t: string }[]> = {}
  for (const c of all) {
    ;(momentos[c.sourceId] ??= []).push({
      s: Number(c.start.toFixed(1)),
      e: Number(c.end.toFixed(1)),
      t: c.status === 'approved' ? 'si' : c.status === 'rejected' ? 'no' : 'pend',
    })
  }
  for (const lista of Object.values(momentos)) lista.sort((a, b) => a.s - b.s)

  return {
    sources: fuentes,
    momentos,
    clips: counts,
    /*
     * Las que PUEDEN publicar, no las que existen.
     *
     * Inicio dice "tus videos se reparten entre N cuentas" y decia 20, que son
     * las creadas; solo 8 tienen permiso de TikTok. Las otras 12 no reciben
     * nada, asi que el numero prometia un alcance que no existia.
     */
    accounts: cuentas.length,
    queue: { total: items.length, byStatus },
    /*
     * Cuantos envios tiene programados cada VOD.
     *
     * Es lo que permite a Inicio saber que un video ya esta repartido y
     * plegarlo. Antes se miraba `variants_count`, y ese contador solo se
     * escribe cuando el reparto pasa por el trabajador: repartir desde una
     * terminal dejaba el contador a cero y el panel seguia enseñando como "a
     * medias" videos que llevaban doscientos envios colocados.
     *
     * La cola es el dato de verdad: si hay envios, esta repartido.
     */
    enCola: items.reduce<Record<string, number>>((acc, q) => {
      acc[q.sourceId] = (acc[q.sourceId] ?? 0) + 1
      return acc
    }, {}),
    activeJob: jobParaPanel(enMarcha(jobs)),
    // Si el ordenador que procesa esta escuchando. Viaja siempre para que el
    // panel pueda avisar ANTES de que alguien pegue un enlace, no despues.
    trabajador: await cola.trabajadorVivo(),
    // El estado de la IA, para el aviso unico de Inicio y para Ajustes, IA.
    ia: await resumenIA(db, ownerId),
    /*
     * El objetivo diario, calculado sobre las cuentas QUE HAY.
     *
     * Viaja con el resto del estado para que el panel pueda decir "te faltan
     * N" sin pedir los ajustes por separado.
     *
     * `settings.accounts` es una cifra guardada que no tiene por que parecerse
     * a la realidad -- /api/settings ya la pisa con el recuento real al
     * servirla, pero aqui se usaba cruda. Con veinte guardadas y dos activas,
     * Inicio pedia clips para veinte cuentas mientras Horarios, en la misma
     * sesion, decia dos. El numero de cuentas se cuenta, no se teclea.
     */
    target: flowMath({ ...settings, accounts: Math.max(1, cuentas.length) }).clipsNeededPerDay,
    variants,
    remoto: esRemoto(),
    // Cuantos momentos se han sacado esta semana y en total. Los contadores de
    // arriba dicen en que estado estan los clips, no cuanto se ha producido:
    // con todo aprobado y repartido, "0 por revisar" se lee igual que no haber
    // hecho nada en la vida.
    ritmo,
    // Resumen de plataformas, para el badge de Inicio. El detalle esta en
    // /api/plataformas; aqui solo cabe la cifra.
    // `cuentas` ya son las publicables, o sea las que pueden recibir video
    // con el proveedor activo. Esa es la nocion de "conectada" que importa.
    plataformas: resumirPlataformas(posts, cuentas.length, cuentas.length, { proveedor: proveedorActivo(), cuentas }),
    // Copias de revision subidas, por VOD, y lo que ocupan en total.
    subidos,
    nubeBytes,
    // Si este panel puede pedir videos a la nube. El panel remoto sin clave
    // enseña reproductores que no cargarian nunca, y mas vale decirlo.
    hayNube: crearNube() !== null,
  }
}

/**
 * Clips creados esta semana y en total.
 *
 * Con SQL y no contando en memoria sobre store.clips.all() porque ClipRecord no
 * lleva la fecha de creacion: mapearla obligaria a tocar la interfaz y las dos
 * implementaciones del almacen para una cifra que solo usa esta pantalla.
 */
async function contarPorFecha(db: Db, ownerId: string): Promise<{ semana: number; total: number }> {
  const filas = await db.query<{ semana: unknown; total: unknown }>(
    `select count(*) filter (where created_at >= now() - interval '7 days') as semana,
            count(*) as total
       from clips where owner_id = $1`,
    [ownerId],
  )
  // count() vuelve como bigint, que el driver de Postgres entrega en texto para
  // no perder precision. Sin Number() el panel concatenaria en vez de sumar.
  return {
    semana: Number(filas[0]?.semana ?? 0),
    total: Number(filas[0]?.total ?? 0),
  }
}

/**
 * Estado de cada plataforma, deducido de lo que de verdad ha pasado.
 *
 * NO HAY UN CAMPO "CONECTADO" EN NINGUNA PARTE, y no se inventa uno. La
 * pregunta "esta conectado" se responde con la unica prueba que no puede
 * mentir: si alguna vez salio una publicacion de verdad por ahi.
 *
 * Es una prueba honesta y ademas util: una credencial que caduco ayer seguiria
 * marcada como "conectada" en cualquier campo de configuracion, y aqui se ve
 * enseguida que hace tres semanas que no sale nada.
 *
 * Quien esta enlazado y quien no se ve en la lista de cuentas, que sale de
 * tiktok_tokens. Esto de aqui es otra cosa: si la tuberia entrega.
 */
/**
 * Cuantas cuentas hay de verdad, y cuantas pueden publicar.
 *
 * EL NUMERO DE CUENTAS NO SE ESCRIBE, SE CUENTA. Hasta aqui `settings.accounts`
 * era una cifra que alguien tecleaba en Horarios, y no tenia por que parecerse
 * a la realidad: el 2026-09-28 decia 13 mientras habia 20 cuentas creadas y
 * UNA sola enlazada con TikTok. La seccion planificaba 39 subidas diarias entre
 * trece cuentas que no existian como tales.
 *
 * `publicables` es lo unico que sostiene un calendario: una cuenta sin permiso
 * de TikTok no puede subir nada, por muy creada que este. Se deja un minimo de
 * 1 para que las cuentas de la seccion no salgan todas a cero antes de enlazar
 * la primera, que se leeria como una averia.
 */
async function contarCuentasReales(
  db: Db,
  ownerId: string,
): Promise<{ creadas: number; enlazadas: number; publicables: number }> {
  /*
   * "Enlazada" depende de por donde se publique (Fase 5). Con upload-post el
   * permiso lo tiene su perfil y basta con que la cuenta este activa; con la
   * API directa hace falta el permiso de TikTok. Es la misma regla que
   * store.accounts.publicables, la que usa Inicio: los dos numeros coinciden.
   */
  const porUploadPost = proveedorActivo() === 'upload-post'
  const filas = await db.query<{ creadas: string; enlazadas: string }>(
    porUploadPost
      ? `select (select count(*) from accounts where owner_id = $1) as creadas,
                (select count(*) from accounts where owner_id = $1 and status = 'active') as enlazadas`
      : `select (select count(*) from accounts where owner_id = $1) as creadas,
                (select count(*) from accounts a
                   join tiktok_tokens t
                     on t.owner_id = a.owner_id and t.account_id = a.id
                  where a.owner_id = $1 and a.status = 'active') as enlazadas`,
    [ownerId],
  )
  const creadas = Number(filas[0]?.creadas ?? 0)
  const enlazadas = Number(filas[0]?.enlazadas ?? 0)
  return { creadas, enlazadas, publicables: Math.max(1, enlazadas) }
}

/*
 * ENLAZADAS, no publicaciones.
 *
 * El estado salia de si habia algo publicado. Al vaciar el historial para
 * empezar a operar de verdad, Inicio paso a decir "sin ninguna plataforma
 * conectada todavia" con las ocho cuentas enlazadas y sus permisos intactos,
 * y ofrecia enlazar una cuenta que ya lo estaba.
 *
 * Son dos hechos distintos: si TikTok esta conectado lo dice que haya cuentas
 * con permiso, y cuanto se ha publicado es historia. Un panel recien vaciado
 * esta igual de conectado que ayer.
 */
function resumirPlataformas(
  posts: Post[],
  cuentas: number,
  enlazadas: number,
  extras: { proveedor: string; cuentas: { plataformas?: string[] }[] } = { proveedor: proveedorActivo(), cuentas: [] },
): PlataformaEstado[] {
  /*
   * Los dos proveedores cuentan.
   *
   * Antes se filtraba solo por 'upload-post' y la tarjeta decia "sin conectar"
   * con seis clips ya entregados por la API directa, porque esos se guardan con
   * provider 'tiktok'. Lo que NO cuenta es 'simulacion': son los simulacros del
   * boton Probar, y contarlos diria "conectado" justo tras pulsar el unico
   * boton que no sube nada.
   */
  const REALES = new Set(['tiktok', 'upload-post'])
  const deTikTok = posts.filter((p) => REALES.has(p.provider))
  const ultima = deTikTok
    .map((p) => p.publishedAt)
    .sort()
    .at(-1)

  const directa = deTikTok.filter((p) => p.provider === 'tiktok').length

  return [
    {
      id: 'tiktok',
      nombre: 'TikTok',
      estado: enlazadas > 0 ? 'conectado' : 'sin-conectar',
      cuentas,
      publicaciones: deTikTok.length,
      ultima: ultima ?? null,
      via: directa > 0 || deTikTok.length === 0 ? 'API de TikTok' : 'upload-post',
      /*
       * Tres situaciones, no dos: sin enlazar, enlazado sin estrenar, y en
       * marcha. La de en medio es la de un panel recien vaciado, y antes no
       * existia: se confundia con la primera.
       */
      nota:
        enlazadas === 0
          ? 'Enlaza una cuenta más abajo para empezar. La autorización se hace en ' +
            'tiktok.com: el programa nunca ve tu contraseña.'
          : deTikTok.length === 0
            ? 'Conectado y sin publicar nada todavía. En cuanto apruebes videos ' +
              'empezaran a salir solos.'
            : null,
    },
    plataformaExtra('youtube', 'YouTube Shorts', extras),
    plataformaExtra('instagram', 'Instagram Reels', extras),
  ]
}

/**
 * Shorts y Reels (Fase 7).
 *
 * Solo upload-post sabe publicarlos: con la API directa de TikTok siguen en
 * "Proximamente". Con upload-post se cuentan las cuentas que los tienen
 * marcados en Cuentas > Editar.
 */
function plataformaExtra(
  id: 'youtube' | 'instagram',
  nombre: string,
  extras: { proveedor: string; cuentas: { plataformas?: string[] }[] },
): PlataformaEstado {
  if (extras.proveedor !== 'upload-post') {
    return {
      id, nombre, estado: 'no-disponible', cuentas: 0, publicaciones: 0, ultima: null, via: null,
      nota: 'Próximamente: solo se puede publicar en ' + nombre + ' a través de upload-post.',
    }
  }
  const n = extras.cuentas.filter((c) => (c.plataformas ?? []).includes(id)).length
  return {
    id,
    nombre,
    estado: n > 0 ? 'conectado' : 'sin-conectar',
    cuentas: n,
    publicaciones: 0,
    ultima: null,
    via: 'upload-post',
    nota:
      n > 0
        ? null
        : 'Conecta ' + nombre + ' en el perfil de upload-post de cada cuenta y márcalo en Cuentas › Editar.',
  }
}

/**
 * Cuantos momentos saldrian con los ajustes puestos.
 *
 * La estimacion se calcula sobre un VOD REAL del usuario y no sobre una
 * duracion inventada: "3 por trozo" no significa nada hasta que se convierte en
 * "de tu directo de 2 h saldrian unos 48". Se usa el mas largo porque es el que
 * marca el techo del gasto y el tiempo de render.
 *
 * Sin VOD todavia no hay nada honesto que decir, y devolver un ejemplo de una
 * hora inventada haria creer que esa cifra es la suya.
 */
function estimacion(
  ajustes: ClipSettings,
  fuentes: { title: string; durationMin: number | null }[],
): { ejemplo: { titulo: string; minutos: number; clips: number } | null } {
  const conDuracion = fuentes.filter((f) => f.durationMin !== null && f.durationMin > 0)
  if (conDuracion.length === 0) return { ejemplo: null }

  const masLargo = conDuracion.reduce((a, b) => ((b.durationMin ?? 0) > (a.durationMin ?? 0) ? b : a))
  const minutos = masLargo.durationMin ?? 0

  return {
    ejemplo: {
      titulo: masLargo.title,
      minutos,
      clips: clipsEstimados(ajustes, minutos * 60),
    },
  }
}

interface PlataformaEstado {
  id: string
  nombre: string
  estado: 'conectado' | 'sin-conectar' | 'no-disponible'
  cuentas: number
  publicaciones: number
  ultima: string | null
  via: string | null
  nota: string | null
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    // Fase 8: un cuerpo enorme no se guarda entero en memoria.
    if (total > MAX_CUERPO) {
      ;(req as { cuerpo?: unknown }).cuerpo = {}
      return {}
    }
    chunks.push(chunk as Buffer)
  }
  let cuerpo: unknown = {}
  if (chunks.length > 0) {
    try {
      cuerpo = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      cuerpo = {}
    }
  }
  // Para el registro de auditoria, que lo lee al terminar la peticion.
  ;(req as { cuerpo?: unknown }).cuerpo = cuerpo
  return cuerpo
}

/**
 * Sirve el MP4 admitiendo peticiones de rango.
 *
 * La ruta NO se toma de la URL. Se busca el clip en el almacen y se usa la ruta
 * que este guarda. Aceptar una ruta del cliente permitiria pedir cualquier
 * archivo del disco cambiando la direccion a mano.
 */
function streamVideo(req: IncomingMessage, res: ServerResponse, clip: ClipRecord): void {
  const path = clip.masterPath

  if (path === '' || !existsSync(path)) {
    sendJson(res, 404, { error: 'El archivo de este clip no está en este ordenador. Vuelve a armarlo.' })
    return
  }

  const total = statSync(path).size
  const range = req.headers.range

  if (range === undefined) {
    res.writeHead(200, {
      'content-type': 'video/mp4',
      'content-length': total,
      'accept-ranges': 'bytes',
    })
    createReadStream(path).pipe(res)
    return
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range)
  const start = Number(match?.[1] ?? 0)
  const end = match?.[2] === undefined || match[2] === '' ? total - 1 : Number(match[2])

  if (Number.isNaN(start) || Number.isNaN(end) || start >= total || end >= total || start > end) {
    res.writeHead(416, { 'content-range': `bytes */${total}` })
    res.end()
    return
  }

  res.writeHead(206, {
    'content-type': 'video/mp4',
    'content-range': `bytes ${start}-${end}/${total}`,
    'accept-ranges': 'bytes',
    'content-length': end - start + 1,
  })
  createReadStream(path, { start, end }).pipe(res)
}

interface Contexto {
  store: Store
  cola: ReturnType<typeof createCola>
  runs: ReturnType<typeof createRunsStore>
  db: Db
  ownerId: string
  /**
   * La nube, o null si no hay credenciales.
   *
   * Se construye una vez al arrancar y no en cada peticion: no tiene estado ni
   * conexion abierta, y rehacerla treinta veces por pantalla solo repetiria la
   * misma lectura del entorno. Null es un estado valido: el panel arranca sin
   * clave y lo dice cuando alguien pide un video, en vez de no arrancar.
   */
  nube: Nube | null
  /** Usuarios y sesiones. */
  auth: Auth
}

async function handle(req: IncomingMessage, res: ServerResponse, ctx: Contexto): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // --- Fase 8: cabeceras de seguridad y limite de peticiones ------------------
  aplicarCabeceras(req, res, HUELLA_PANEL)
  const clase = claseDePeticion(req.method ?? 'GET', url.pathname)
  if (clase !== null) {
    const espera = limitador.comprobar(direccionDe(req), clase)
    if (espera !== null) {
      res.setHeader('retry-after', String(espera))
      sendJson(res, 429, { error: 'Demasiadas peticiones seguidas. Espera un momento y vuelve a intentarlo.' })
      return
    }
  }

  // --- Quien entra -------------------------------------------------------------
  //
  // Publicas, sin sesion: el retorno de TikTok (lo protege su `state`), las
  // paginas legales (las lee quien audita la app) y la propia entrada.
  /*
   * Fase 8: descarga con enlace firmado. Sin sesion a proposito (se puede
   * pasar a un cliente), pero solo con una firma buena y sin caducar.
   */
  const descarga = /^\/descarga\/([^/]+)\/([^/]+)$/.exec(url.pathname)
  if (descarga !== null && req.method === 'GET') {
    await servirDescarga(req, res, ctx, decodeURIComponent(descarga[1] ?? ''), decodeURIComponent(descarga[2] ?? ''), url)
    return
  }

  const publica = esRetornoDeTikTok(url) || esPaginaLegal(url)
  if (!publica && (await atenderAcceso(req, res, url, ctx.auth))) return

  let quien: Quien | null = null
  if (!publica) {
    const hayLlaveOClave = (process.env.REVIEW_KEY ?? '') !== '' || (process.env.REVIEW_PASSWORD ?? '') !== ''
    const acceso = await quienEs(req, ctx.auth, () => hayLlaveOClave && authorized(req, url))
    if (acceso === null) {
      pedirLogin(req, res, url)
      return
    }
    quien = acceso.quien
    // La sesion se alarga mientras se usa: la galleta vuelve con 7 dias mas.
    if (acceso.renovar && quien.token !== undefined) {
      res.setHeader('set-cookie', galletaSesion(quien.token, esCifrada(req)))
    }
    // Con contraseña provisional, primero se cambia.
    if (quien.usuario?.debeCambiar === true) {
      if (url.pathname.startsWith('/api/')) sendJson(res, 403, { error: 'Antes tienes que cambiar tu contraseña.' })
      else {
        res.writeHead(303, { location: '/cuenta/contrasena' })
        res.end()
      }
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !mismoOrigen(req)) {
      sendJson(res, 403, { error: 'Petición rechazada: no viene de este panel.' })
      return
    }
    if (!permitido(quien.rol, req.method ?? 'GET', url.pathname)) {
      negarPermiso(res)
      return
    }

    /*
     * Fase 8: registro de auditoria de todo lo que cambia algo por la API.
     * Se anota al terminar, con el codigo de la respuesta, para que conste
     * tambien lo que se rechazo.
     */
    const metodo = req.method ?? 'GET'
    if (url.pathname.startsWith('/api/') && metodo !== 'GET' && metodo !== 'HEAD') {
      const actor = quien.usuario?.email ?? (quien.tipo === 'legado' ? 'llave antigua' : 'sin login (local)')
      res.on('finish', () => {
        void anotarAuditoria(ctx.db, ctx.ownerId, actor, metodo, url.pathname,
          (req as { cuerpo?: unknown }).cuerpo ?? null, res.statusCode)
      })
    }
  }

  /*
   * La llave llego en la direccion: se guarda y se quita de ahi.
   *
   * SOLO DURANTE LA TRANSICION (LEGACY_KEY_ENABLED=true). Se borrara junto con
   * todo lo de la llave cuando el login este confirmado.
   *
   * Se guarda porque la pagina hace decenas de peticiones (datos, progreso en
   * vivo, videos) y ninguna llevaria el `?k=`. Y se quita de la barra porque una
   * direccion se comparte, se pega en un chat y acaba en el historial: la
   * galleta la mantiene fuera de la vista a partir de la primera visita.
   */
  if (quien?.tipo === 'legado' && url.searchParams.has('k')) {
    const llave = url.searchParams.get('k') ?? ''
    url.searchParams.delete('k')
    // `secure` solo cuando de verdad se viaja cifrado. En el ordenador de casa
    // el panel va por http y una galleta `secure` no se guardaria nunca.
    const cifrado = (req.headers['x-forwarded-proto'] ?? '') === 'https'
    res.writeHead(302, {
      location: url.pathname + (url.search === '' ? '' : url.search),
      'set-cookie':
        `${GALLETA}=${encodeURIComponent(llave)}; Path=/; HttpOnly; SameSite=Lax; ` +
        `Max-Age=31536000${cifrado ? '; Secure' : ''}`,
      'cache-control': 'no-store',
    })
    res.end()
    return
  }

  const { store, cola, runs, db, ownerId, nube, auth } = ctx
  const path = url.pathname

  // --- Usuarios -------------------------------------------------------------------

  /** Quien soy: el panel lo usa para el menu y para esconder lo que no puedo tocar. */
  if (path === '/api/yo' && req.method === 'GET') {
    sendJson(res, 200, {
      email: quien?.usuario?.email ?? null,
      nombre: quien?.usuario?.nombre ?? '',
      rol: quien?.rol ?? 'admin',
      tipo: quien?.tipo ?? 'local',
    })
    return
  }

  // Solo administradores: `permitido` ya ha cortado a los demas.
  if (path === '/api/usuarios' && req.method === 'GET') {
    sendJson(res, 200, { usuarios: await auth.listar() })
    return
  }

  if (path === '/api/usuarios' && req.method === 'POST') {
    const b = (await readBody(req)) as Record<string, unknown>
    try {
      const u = await auth.crear({
        email: String(b.email ?? ''),
        nombre: String(b.nombre ?? ''),
        rol: b.rol === 'admin' ? 'admin' : 'operador',
        contrasena: String(b.contrasena ?? ''),
        // La pone el administrador: la persona la cambia al entrar.
        debeCambiar: true,
      })
      sendJson(res, 201, { usuario: u })
    } catch (e) {
      if (e instanceof ErrorUsuarios) sendJson(res, 400, { error: e.message })
      else throw e
    }
    return
  }

  const usuarioRuta = /^\/api\/usuarios\/([0-9a-f-]{36})(\/contrasena)?$/.exec(path)
  if (usuarioRuta !== null && req.method === 'POST') {
    const id = usuarioRuta[1] ?? ''
    const b = (await readBody(req)) as Record<string, unknown>
    try {
      if (usuarioRuta[2] !== undefined) {
        // Recuperar contraseña sin correo: el administrador pone una nueva.
        await auth.restablecer(id, String(b.contrasena ?? ''))
        sendJson(res, 200, { ok: true })
      } else {
        if (id === quien?.usuario?.id && (b.activo === false || b.rol === 'operador')) {
          sendJson(res, 400, { error: 'No puedes quitarte a ti el acceso de administrador.' })
          return
        }
        const u = await auth.actualizar(id, {
          ...(b.rol === 'admin' || b.rol === 'operador' ? { rol: b.rol } : {}),
          ...(typeof b.activo === 'boolean' ? { activo: b.activo } : {}),
        })
        sendJson(res, 200, { usuario: u })
      }
    } catch (e) {
      if (e instanceof ErrorUsuarios) sendJson(res, 400, { error: e.message })
      else throw e
    }
    return
  }

  if (path === '/' && req.method === 'GET') {
    const html = renderPage()
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      /*
       * Sin cachear, y es importante.
       *
       * El panel entero (interfaz y guion) es ESTE documento: no hay ficheros
       * .js aparte a los que cambiarles el nombre para forzar la recarga. Sin
       * esta cabecera el navegador se lo queda, y despues de desplegar el
       * equipo sigue viendo la version anterior hasta que alguien hace un
       * refresco forzado.
       *
       * El 2026-10-09 costo un rato entender por que una correccion desplegada
       * dos veces seguia sin aparecer en pantalla: estaba desplegada, pero el
       * navegador servia lo viejo.
       */
      'cache-control': 'no-store',
    })
    res.end(html)
    return
  }

  if (path === '/api/clips' && req.method === 'GET') {
    const status = url.searchParams.get('status') as ClipStatus | null
    // Una sola consulta para todo: los tres contadores salen de la misma lista
    // que se va a devolver, y pedirlos por separado eran cuatro viajes.
    const todos = await store.clips.all()
    const counts = {
      pending: todos.filter((c) => c.status === 'pending').length,
      approved: todos.filter((c) => c.status === 'approved').length,
      rejected: todos.filter((c) => c.status === 'rejected').length,
    }
    const rows = status === null ? todos : todos.filter((c) => c.status === status)
    sendJson(res, 200, {
      counts,
      clips: rows.sort((a, b) => b.score - a.score).map(toView),
    })
    return
  }

  /*
   * UN VOD CON SUS MOMENTOS COLOCADOS EN EL TIEMPO.
   *
   * Lo que el panel no podia enseñar hasta ahora: donde cayeron los quince
   * momentos dentro de las dos horas de directo. La lista de Inicio dice
   * cuantos hay; esto dice si estan repartidos o apelotonados en el primer
   * cuarto de hora, que es lo que explica por que el resto del VOD no dio nada.
   *
   * Se devuelve el VOD entero con sus clips ordenados por POSICION, no por
   * puntuacion: aqui el eje es el tiempo. La puntuacion viaja igual, para
   * pintar los marcadores con mas o menos peso.
   */
  const detalle = /^\/api\/sources\/([^/]+)$/.exec(path)
  if (detalle !== null && req.method === 'GET') {
    const sourceId = decodeURIComponent(detalle[1] ?? '')
    const fuentes = await store.sources.all()
    const fuente = fuentes.find((f) => f.sourceId === sourceId)
    if (fuente === undefined) {
      sendJson(res, 404, { error: `No existe el video ${sourceId}.` })
      return
    }
    const todos = await store.clips.all()
    const suyos = todos.filter((c) => c.sourceId === sourceId)
    /*
     * La duracion en segundos, no en minutos.
     *
     * sources.all() redondea a minutos para la lista, y con eso la linea de
     * tiempo de un VOD de 45:02 colocaria el ultimo clip fuera del eje. Si no
     * la sabemos, el final del ultimo clip es la mejor cota disponible.
     */
    const porClips = suyos.reduce((max, c) => Math.max(max, c.end), 0)
    const duracionSec = (fuente.durationMin ?? 0) > 0 ? (fuente.durationMin ?? 0) * 60 : porClips
    sendJson(res, 200, {
      sourceId,
      title: fuente.title,
      durationSec: Math.max(duracionSec, porClips),
      duracionCierta: (fuente.durationMin ?? 0) > 0,
      hasTranscript: fuente.hasTranscript,
      rendered: fuente.rendered,
      variants: fuente.variants,
      clips: suyos
        .sort((a, b) => a.start - b.start)
        .map((c) => ({
          ...toView(c),
          // El pie puede ser largo; para el eje basta la primera linea.
          hook: c.hook,
        })),
    })
    return
  }

  /*
   * DECIDIR VARIOS CLIPS DE UNA VEZ.
   *
   * Revisar cuarenta y cinco clips de uno en uno son cuarenta y cinco viajes
   * al servidor y cuarenta y cinco repintados. Cuando ya has visto el VOD
   * entero y sabes que los ocho del tramo aburrido no valen, marcarlos y
   * descartarlos de golpe es un gesto, no ocho.
   *
   * Hay un tope de 100 por peticion. No es un limite de la base: es que una
   * lista sin tope llegada de fuera es una invitacion a que alguien mande
   * cincuenta mil y deje el panel colgado mientras los recorre.
   *
   * El reparto se lanza UNA vez por VOD al final, no una por clip. Es lo que
   * hace que el lote valga la pena: con el reparto dentro del bucle, aprobar
   * quince clips del mismo video dispararia quince repartos de los que
   * catorce no harian nada.
   */
  if (path === '/api/clips/lote' && req.method === 'POST') {
    const body = (await readBody(req)) as {
      status?: string
      items?: { sourceId?: string; clipId?: string }[]
    }

    if (body.status !== 'approved' && body.status !== 'rejected' && body.status !== 'pending') {
      sendJson(res, 400, { error: 'Elige aprobar, descartar o devolver a revisar.' })
      return
    }
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      sendJson(res, 400, { error: 'No se mandó ningún clip.' })
      return
    }
    if (items.length > 100) {
      sendJson(res, 400, { error: 'Como mucho 100 clips por vez.' })
      return
    }

    let hechos = 0
    const fallidos: string[] = []
    const vods = new Set<string>()
    for (const it of items) {
      const sourceId = String(it.sourceId ?? '')
      const clipId = String(it.clipId ?? '')
      if (sourceId === '' || clipId === '') {
        fallidos.push(`${sourceId}/${clipId}`)
        continue
      }
      /*
       * Un clip que falla no tumba el lote.
       *
       * Si uno de los quince ya no existe -- lo borro otra pestaña mientras
       * revisabas -- devolver un 404 para todo el lote tiraria las catorce
       * decisiones buenas. Se cuentan los que fallaron y se dicen al final.
       */
      const updated = await store.clips.setStatus(sourceId, clipId, body.status, {})
      if (updated === undefined) {
        fallidos.push(`${sourceId}/${clipId}`)
        continue
      }
      hechos += 1
      vods.add(sourceId)
    }

    log.info(`lote: ${hechos} clips -> ${body.status}` +
      (fallidos.length > 0 ? ` (${fallidos.length} sin encontrar)` : ''))

    const repartos: Reparto[] = []
    for (const sourceId of vods) {
      try {
        const r = await repartirSiToca(db, cola, ownerId, sourceId)
        if (r !== null) repartos.push(r)
      } catch (error) {
        log.error(`No se pudo encolar el reparto de ${sourceId}`, error)
      }
    }

    avisarCambio('clips')
    sendJson(res, 200, { hechos, fallidos, repartos })
    return
  }

  /*
   * Editor ligero de un clip (Fase 6): titulo, subtitulos y, si se pide,
   * volver a armar solo ese clip. El corte (inicio y fin) va por su camino de
   * siempre: la tarea render con --solo y --clip.
   */
  /*
   * Enlace de descarga de un clip (Fase 8): firmado y con caducidad. Se pide
   * con POST para que quede en el registro de auditoria quien lo saco.
   */
  const pideEnlace = /^\/api\/clips\/([^/]+)\/([^/]+)\/enlace$/.exec(path)
  if (pideEnlace !== null && req.method === 'POST') {
    await readBody(req)
    const sourceId = decodeURIComponent(pideEnlace[1] ?? '')
    const clipId = decodeURIComponent(pideEnlace[2] ?? '')
    if ((await store.clips.find(sourceId, clipId)) === undefined) {
      sendJson(res, 404, { error: 'Ese clip ya no existe.' })
      return
    }
    sendJson(res, 200, { ruta: firmarEnlace(sourceId, clipId), horas: DURACION_ENLACE_S / 3600 })
    return
  }

  const edicion = /^\/api\/clips\/([^/]+)\/([^/]+)\/editar$/.exec(path)
  if (edicion !== null && req.method === 'POST') {
    const sourceId = decodeURIComponent(edicion[1] ?? '')
    const clipId = decodeURIComponent(edicion[2] ?? '')
    const body = (await readBody(req)) as { titulo?: unknown; subtitulos?: unknown; rearmar?: unknown }

    let titulo: string | undefined
    if (body.titulo !== undefined) {
      titulo = String(body.titulo).replace(/\s+/g, ' ').trim()
      if (titulo.split(' ').filter(Boolean).length > 8) {
        sendJson(res, 400, { error: 'El título admite como mucho 8 palabras.' })
        return
      }
      if (titulo.length > 90) {
        sendJson(res, 400, { error: 'El título es demasiado largo.' })
        return
      }
    }

    let subtitulos: { start: number; end: number; text: string }[] | null | undefined
    if (body.subtitulos === null) subtitulos = null
    else if (Array.isArray(body.subtitulos)) {
      subtitulos = []
      for (const x of body.subtitulos.slice(0, 400)) {
        const l = x as { start?: unknown; end?: unknown; text?: unknown }
        const start = Number(l.start)
        const end = Number(l.end)
        const text = String(l.text ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          sendJson(res, 400, { error: 'Hay una línea de subtítulo con tiempos que no cuadran.' })
          return
        }
        if (text !== '') subtitulos.push({ start, end, text })
      }
    }

    const editado = await store.clips.editar(sourceId, clipId, {
      ...(titulo === undefined ? {} : { titulo }),
      ...(subtitulos === undefined ? {} : { subtitulos }),
    })
    if (editado === undefined) {
      sendJson(res, 404, { error: 'Ese clip ya no existe.' })
      return
    }

    let encolada: unknown = null
    if (body.rearmar === true) {
      const built = buildJob(
        'render',
        { sourceId, clipId },
        new Set([sourceId]),
        await loadClipSettings(db, ownerId),
      )
      if (!(await cola.hayActiva(['render'], sourceId))) {
        encolada = await cola.encolar(built.kind, built.args, built.label)
        avisarCambio('trabajos')
      }
    }
    avisarCambio('clips')
    sendJson(res, 200, { clip: toView(editado), encolada })
    return
  }

  const decision = /^\/api\/clips\/([^/]+)\/([^/]+)$/.exec(path)
  if (decision !== null && req.method === 'POST') {
    const sourceId = decodeURIComponent(decision[1] ?? '')
    const clipId = decodeURIComponent(decision[2] ?? '')
    const body = (await readBody(req)) as {
      status?: string
      caption?: string
      hashtags?: string[]
    }

    if (body.status !== 'approved' && body.status !== 'rejected' && body.status !== 'pending') {
      sendJson(res, 400, { error: 'Elige aprobar, descartar o devolver a revisar.' })
      return
    }

    const updated = await store.clips.setStatus(sourceId, clipId, body.status, {
      ...(body.caption === undefined ? {} : { caption: body.caption }),
      ...(body.hashtags === undefined ? {} : { hashtags: body.hashtags }),
    })

    if (updated === undefined) {
      sendJson(res, 404, { error: 'Ese clip ya no existe.' })
      return
    }

    log.info(`${sourceId}/${clipId} -> ${body.status}`)

    /*
     * Revisado el ultimo clip del VOD, el reparto arranca solo.
     *
     * Es lo que convierte la compuerta en el UNICO gesto manual del programa.
     * Antes, terminar de aprobar dejaba los clips quietos hasta que alguien
     * abria una terminal y escribia `npm run variants` y `npm run schedule`.
     *
     * Un fallo aqui no se le devuelve al usuario como error: el clip SI quedo
     * guardado, que es lo que acaba de pedir. El reparto se puede relanzar.
     */
    let reparto: Reparto | null = null
    try {
      reparto = await repartirSiToca(db, cola, ownerId, sourceId)
    } catch (error) {
      log.error(`No se pudo encolar el reparto de ${sourceId}`, error)
    }

    // Aprobar cambia contadores que se ven en Inicio, Horarios y Programacion.
    avisarCambio('clips')
    sendJson(res, 200, { ...toView(updated), reparto })
    return
  }

  // --- Tuberia y trabajos ----------------------------------------------------

  if (path === '/api/overview' && req.method === 'GET') {
    sendJson(res, 200, await buildOverview(store, cola, db, ownerId))
    return
  }

  // --- Procesador ----------------------------------------------------------------

  /*
   * Lo que el trabajador sabe del PC (yt-dlp, disco, limpieza) y sus ajustes
   * (cookies para yt-dlp, dias de retencion). Cambiarlos es de administrador.
   */
  if (path === '/api/sistema' && req.method === 'GET') {
    const sis = createSistema(db, ownerId)
    sendJson(res, 200, {
      ajustes: await sis.ajustes(),
      estado: await sis.estado(),
      trabajador: await cola.trabajadorVivo(),
      navegadores: NAVEGADORES_COOKIES,
      alertas: await resumenAlertas(db, ownerId),
    })
    return
  }

  /*
   * Alertas (Fase 7): encender o apagar, y mandar una de prueba.
   *
   * Los destinos no se configuran aqui: son claves (token de Telegram, clave
   * del correo) y viven en el .env. El panel solo dice si estan puestas.
   */
  /*
   * Registro de auditoria (Fase 8). Solo administradores: dice quien hizo
   * que, y un operador no necesita ver lo que hacen los demas.
   */
  if (path === '/api/auditoria' && req.method === 'GET') {
    if (quien !== null && quien.rol !== 'admin') {
      sendJson(res, 403, { error: 'Solo un administrador puede ver el registro de cambios.' })
      return
    }
    try {
      sendJson(res, 200, { registro: await leerAuditoria(db, ownerId) })
    } catch {
      sendJson(res, 200, { registro: [] })
    }
    return
  }

  if (path === '/api/sistema/alertas' && req.method === 'PUT') {
    const b = (await readBody(req)) as { activas?: unknown }
    await db.query(
      `insert into settings (owner_id, alertas_activas) values ($1, $2)
       on conflict (owner_id) do update set alertas_activas = excluded.alertas_activas`,
      [ownerId, b.activas !== false],
    )
    sendJson(res, 200, await resumenAlertas(db, ownerId))
    return
  }

  if (path === '/api/sistema/alertas/probar' && req.method === 'POST') {
    const conf = canalesConfigurados()
    if (!conf.telegram && !conf.correo) {
      sendJson(res, 400, {
        error: 'No hay ningún destino configurado. Añade TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (o la clave de correo) al .env del panel.',
      })
      return
    }
    const resultados = await probarAlertas(db, ownerId)
    sendJson(res, 200, { resultados, ...(await resumenAlertas(db, ownerId)) })
    return
  }

  if (path === '/api/sistema' && req.method === 'PUT') {
    const b = (await readBody(req)) as { ytdlpCookies?: unknown; retencionDias?: unknown }
    try {
      const ajustes = await createSistema(db, ownerId).guardarAjustes({
        ...(typeof b.ytdlpCookies === 'string' ? { ytdlpCookies: b.ytdlpCookies } : {}),
        ...(b.retencionDias !== undefined ? { retencionDias: Number(b.retencionDias) } : {}),
      })
      sendJson(res, 200, { ajustes })
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : 'No se pudo guardar.' })
    }
    return
  }

  // --- IA -----------------------------------------------------------------------

  if (path === '/api/ia' && req.method === 'GET') {
    sendJson(res, 200, await resumenIA(db, ownerId))
    return
  }

  /*
   * "Reintentar": quita la pausa y devuelve a la cola lo que esperaba.
   *
   * No llama a la IA desde aqui: el panel no la tiene, vive en el PC. Si sigue
   * sin estar, la primera tarea lo dira otra vez, una sola vez.
   */
  if (path === '/api/ia/reintentar' && req.method === 'POST') {
    const reanudadas = await createEstadoIA(db, ownerId).reanudar(true)
    avisarCambio('trabajos')
    sendJson(res, 200, { reanudadas })
    return
  }

  /*
   * Fallos agrupados: reintentar o descartar el grupo entero.
   *
   * Un mismo paso de un mismo video que falla cuatro veces se enseña como UNA
   * tarjeta ("falló 4 veces"). Reintentar encola el paso una sola vez y retira
   * los fallos del grupo; descartar solo los retira. No se borra nada: pasan a
   * 'cancelled' y siguen en el historial.
   */
  if ((path === '/api/jobs/reintentar' || path === '/api/jobs/descartar') && req.method === 'POST') {
    const body = (await readBody(req)) as { ids?: unknown }
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200)
      : []
    if (ids.length === 0) {
      sendJson(res, 400, { error: 'No se indicó qué tareas.' })
      return
    }
    let encolada: unknown = null
    if (path === '/api/jobs/reintentar') {
      const base = await cola.porId(ids[0] ?? '')
      if (base === null) {
        sendJson(res, 404, { error: 'Esa tarea ya no existe.' })
        return
      }
      const sourceId = base.args[0]
      const yaEsta = sourceId !== undefined && (await cola.hayActiva([base.kind], sourceId))
      if (!yaEsta) encolada = await cola.encolar(base.kind, base.args, base.label)
    }
    await db.query(
      `update jobs set status = 'cancelled', ended_at = coalesce(ended_at, now())
        where owner_id = $1 and id = any($2::text[]) and status = 'error'`,
      [ownerId, ids],
    )
    avisarCambio('trabajos')
    sendJson(res, 200, { encolada })
    return
  }

  if (path === '/api/runs' && req.method === 'GET') {
    const [rows, totals] = await Promise.all([runs.recientes(60), runs.resumen()])
    sendJson(res, 200, { runs: rows, totals })
    return
  }

  if (path === '/api/queue' && req.method === 'GET') {
    sendJson(res, 200, await buildQueue(store))
    return
  }

  if (path === '/api/upload' && req.method === 'POST') {
    /*
     * Subir un archivo aqui solo sirve si quien lo va a procesar puede leerlo.
     *
     * En el servidor no puede: el que transcribe y renderiza es el PC de casa,
     * y no ve el disco del servidor. Aceptar la subida dejaria un fichero de
     * novecientos megas parado para siempre y una tarea encolada que fallaria
     * al no encontrarlo. Se dice antes de gastar la subida.
     */
    if (esRemoto()) {
      sendJson(res, 501, {
        error:
          'Este panel no guarda videos. Pega el enlace del VOD en su lugar, ' +
          'o sube el archivo desde el ordenador que hace el trabajo.',
      })
      return
    }

    try {
      /*
       * La campaña elegida en el desplegable, por cabecera.
       *
       * El cuerpo de esta peticion es el video en crudo, asi que no hay sitio
       * donde meter un campo mas. Se valida como uuid antes de tocarla: acaba
       * en la linea de comando del trabajo, y ahi no entra nada sin comprobar.
       * Que la campaña exista y sea de este propietario lo verifica despues
       * publicarFuente, contra la base.
       */
      const cabecera = req.headers['x-campana']
      const campana = Array.isArray(cabecera) ? cabecera[0] : cabecera
      const esUuid =
        campana !== undefined && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(campana)

      const stored = await storeUpload(req)
      // El trabajo se encola con la ruta que eligio el servidor, no con una que
      // haya mandado el cliente: la subida y el arranque son un solo paso para
      // que ningun path viaje por la red.
      // El tipo de video viaja en otra cabecera: x-tipo: musica.
      const musica = req.headers['x-tipo'] === 'musica' ? ['--musica'] : []
      const args = [...(esUuid ? [stored.path, '--campana', campana] : [stored.path]), ...musica]
      const job = await cola.encolar('ingest', args, `Transcribir ${stored.name}`)
      avisarCambio('trabajos')
      // Sin la ruta del disco: el navegador solo necesita el nombre.
      sendJson(res, 202, { job: jobParaPanel(job), upload: { name: stored.name, bytes: stored.bytes } })
    } catch (error) {
      if (error instanceof UploadError) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  if (path === '/api/settings' && req.method === 'GET') {
    const [guardados, aprobados, plantilla] = await Promise.all([
      loadSettingsDb(db, ownerId),
      store.clips.byStatus('approved'),
      contarCuentasReales(db, ownerId),
    ])
    const settings = { ...guardados, accounts: plantilla.publicables }
    sendJson(res, 200, {
      settings,
      math: flowMath(settings),
      approved: aprobados.length,
      cuentas: plantilla,
      /*
       * Los planes viajan desde el servidor, no se copian en el guion.
       *
       * El tope de cuentas se elige por plan de upload-post, y la tabla de
       * planes vive en publish/planes.ts porque es conocimiento del
       * proveedor. Duplicarla en el navegador garantizaria que un dia digan
       * cosas distintas; es la misma razon por la que la lista de
       * tipografias tambien se manda desde aqui.
       */
      planes: PLANES_UPLOAD_POST,
      proveedor: proveedorActivo(),
    })
    return
  }

  if (path === '/api/settings' && req.method === 'PUT') {
    const body = (await readBody(req)) as Record<string, unknown>
    try {
      /*
       * `accounts` NO se acepta del cliente.
       *
       * Es un dato que se cuenta, no que se elige: ver contarCuentasReales. Si
       * llegara del navegador volveriamos a tener dos versiones del mismo
       * numero y a que se separaran en cuanto alguien enlazara una cuenta.
       */
      const { accounts: _ignorado, ...editables } = body as Record<string, unknown>
      const guardados = await saveSettingsDb(db, ownerId, editables as Partial<FlowSettings>)
      const reales = await contarCuentasReales(db, ownerId)
      const settings = { ...guardados, accounts: reales.publicables }

      // Las franjas viven en cada cuenta, asi que cambiar la forma del dia
      // obliga a recalcularlas. Se hace aqui y no en el planificador para que
      // el usuario vea el efecto en el acto.
      //
      // Se reparten sobre TODAS las cuentas creadas, no solo las que pueden
      // publicar: una cuenta sin enlazar sigue necesitando sus horas para el
      // dia que se enlace, y pasar aqui el numero de publicables pausaria las
      // diecinueve restantes de golpe.
      const cuentas = await store.accounts.all()
      /*
       * Se reparten las horas, NO se decide quien esta activa.
       *
       * recalcularFranjas forzaba a 'active' todas las cuentas del cupo, asi
       * que guardar un horario reactivaba en silencio las que alguien hubiera
       * pausado. El 2026-10-09 se pausaron dieciocho para probar con dos y
       * volvieron solas al tocar otra cosa.
       */
      const { rows, kept } = repartirFranjas(
        settings.postsPerDay,
        settings.dayStartHour,
        settings.dayEndHour,
        cuentas,
      )
      const applied = { kept, added: 0, deactivated: 0 }
      await store.accounts.save(rows)

      log.info(
        `ajustes guardados: ${settings.accounts}x${settings.postsPerDay} ` +
          `${settings.dayStartHour}-${settings.dayEndHour}h ` +
          `(${applied.kept} mantenidas, ${applied.added} nuevas, ${applied.deactivated} desactivadas)`,
      )

      avisarCambio('ajustes')
      sendJson(res, 200, {
        settings,
        math: flowMath(settings),
        // Tambien en la respuesta del guardado: la pantalla se repinta con
        // esto y sin los planes el desplegable del tope saldria vacio.
        planes: PLANES_UPLOAD_POST,
        proveedor: proveedorActivo(),
        applied,
        // Las mismas cifras que el GET: la pantalla se repinta con esta
        // respuesta y sin ellas el bloque de cuentas desapareceria al guardar.
        cuentas: reales,
        approved: (await store.clips.byStatus('approved')).length,
      })
    } catch (error) {
      if (error instanceof InvalidSettings) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  /*
   * Ajustes de corte. Ruta aparte de /api/settings a proposito.
   *
   * Guardar en /api/settings recalcula las franjas horarias de todas las
   * cuentas, porque cambiar cuantas cuentas hay o a que horas se publica las
   * invalida. Subir la duracion maxima de un clip no invalida ningun horario, y
   * meterlo en la misma ruta significaria rehacer veinte franjas cada vez que
   * alguien mueve un deslizador.
   */
  if (path === '/api/ajustes' && req.method === 'GET') {
    // Las plantillas viajan con los ajustes y no en una peticion aparte: se
    // pintan en la misma pantalla, y dos peticiones darian medio segundo en el
    // que la fila de pastillas esta vacia y parece que no hay ninguna.
    const [ajustes, vods, plantillas, clips] = await Promise.all([
      loadClipSettings(db, ownerId),
      store.sources.all(),
      listarPlantillas(db, ownerId),
      store.clips.all(),
    ])

    /*
     * Un clip de verdad para la vista previa.
     *
     * Con texto inventado la vista previa no sirve: lo que hay que ver es si
     * ESTE pie cabe en dos lineas con ESTA tipografia, y si las etiquetas del
     * programa mas las fijas dan un texto razonable. Se prefiere uno que tenga
     * copia en la nube, que es la unica que el panel puede reproducir desde un
     * servidor sin los ficheros.
     */
    const conVideo = clips.filter((c) => c.proxyPath !== '')
    const m = conVideo.find((c) => c.status === 'approved') ?? conVideo[0] ?? clips[0]
    const muestra =
      m === undefined
        ? null
        : {
            sourceId: m.sourceId,
            clipId: m.clipId,
            caption: m.caption,
            hashtags: m.hashtags,
            hook: m.hook,
            hayVideo: m.proxyPath !== '',
          }

    sendJson(res, 200, {
      ajustes,
      ...estimacion(ajustes, vods),
      plantillas,
      fuentes: FUENTES,
      muestra,
    })
    return
  }

  /*
   * "Volver a armar" los clips pendientes con el estilo actual (Fase 5).
   *
   * Cambiar el estilo solo afecta a lo que se arma DESPUES. Esto rehace lo que
   * aun espera revision: lo aprobado y lo descartado no se toca, porque ya se
   * decidio sobre el video tal como estaba. Un video con todos sus clips
   * pendientes se rehace de una vez; si no, clip a clip.
   */
  if (path === '/api/ajustes/rearmar' && req.method === 'POST') {
    const ajustes = await loadClipSettings(db, ownerId)
    const todos = await store.clips.all()
    const porVideo = new Map<string, { pendientes: string[]; total: number }>()
    for (const c of todos) {
      if (c.masterPath === '' && c.status !== 'pending') continue
      const v = porVideo.get(c.sourceId) ?? { pendientes: [], total: 0 }
      v.total += 1
      if (c.status === 'pending') v.pendientes.push(c.clipId)
      porVideo.set(c.sourceId, v)
    }
    let tareas = 0
    let clips = 0
    for (const [sourceId, v] of porVideo) {
      if (v.pendientes.length === 0) continue
      if (await cola.hayActiva(['render'], sourceId)) continue
      const conocidos = new Set([sourceId])
      const lotes = v.pendientes.length === v.total ? [undefined] : v.pendientes
      for (const clipId of lotes) {
        const built = buildJob('render', { sourceId, ...(clipId ? { clipId } : {}) }, conocidos, ajustes)
        await cola.encolar(built.kind, built.args, built.label)
        tareas += 1
      }
      clips += v.pendientes.length
    }
    avisarCambio('trabajos')
    sendJson(res, 200, { tareas, clips })
    return
  }

  if (path === '/api/ajustes' && req.method === 'PUT') {
    const body = (await readBody(req)) as Record<string, unknown>
    try {
      const ajustes = await saveClipSettings(db, ownerId, body as Partial<ClipSettings>)
      const [vods, plantillas] = await Promise.all([
        store.sources.all(),
        listarPlantillas(db, ownerId),
      ])

      log.info(
        `ajustes de corte: ${ajustes.minSec}-${ajustes.maxSec}s, ` +
          `${ajustes.perWindow} por trozo de ${ajustes.windowSec}s, ` +
          `subtitulos ${ajustes.subtitles ? `${ajustes.subFont} ${ajustes.subSize}px` : 'no'}`,
      )

      // Los ajustes no cambian ningun clip ya hecho, asi que no se avisa a los
      // demas navegadores: no hay dato suyo que se haya quedado viejo.
      sendJson(res, 200, {
        ajustes,
        ...estimacion(ajustes, vods),
        plantillas,
        fuentes: FUENTES,
      })
    } catch (error) {
      if (error instanceof InvalidClipSettings) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  /*
   * Plantillas: juegos de ajustes con nombre.
   *
   * Las tres operaciones devuelven SIEMPRE la lista entera y los ajustes
   * vigentes. Son listas de cinco elementos, no de cinco mil, y asi el panel no
   * tiene que reconstruir su estado a partir de una respuesta parcial: aplicar
   * una plantilla cambia los ajustes Y la pastilla marcada, y con un 204 el
   * navegador tendria que adivinar las dos cosas.
   */
  if (path === '/api/plantillas' && req.method === 'GET') {
    sendJson(res, 200, {
      plantillas: await listarPlantillas(db, ownerId),
      fuentes: FUENTES,
    })
    return
  }

  if (path === '/api/plantillas' && req.method === 'POST') {
    const body = (await readBody(req)) as { nombre?: unknown }
    try {
      // Se guardan los ajustes VIGENTES, no unos que mande el navegador: el
      // boton dice "guardar estos ajustes", y estos son los de la base.
      const actuales = await loadClipSettings(db, ownerId)
      const plantilla = await guardarPlantilla(db, ownerId, body.nombre, actuales)
      log.info(`plantilla guardada: ${plantilla.nombre}`)
      sendJson(res, 201, {
        plantilla,
        plantillas: await listarPlantillas(db, ownerId),
      })
    } catch (error) {
      if (error instanceof InvalidPlantilla || error instanceof InvalidClipSettings) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  const aplicar = /^\/api\/plantillas\/([A-Za-z0-9-]+)\/aplicar$/.exec(path)
  if (aplicar !== null && req.method === 'POST') {
    try {
      const valores = await leerPlantilla(db, ownerId, aplicar[1] ?? '')
      const ajustes = await saveClipSettings(db, ownerId, valores)
      const fuentes = await store.sources.all()
      log.info(`plantilla aplicada: ${ajustes.minSec}-${ajustes.maxSec}s, ${ajustes.subFont}`)
      sendJson(res, 200, {
        ajustes,
        ...estimacion(ajustes, fuentes),
        plantillas: await listarPlantillas(db, ownerId),
      })
    } catch (error) {
      if (error instanceof InvalidPlantilla || error instanceof InvalidClipSettings) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  const borrar = /^\/api\/plantillas\/([A-Za-z0-9-]+)$/.exec(path)
  if (borrar !== null && req.method === 'DELETE') {
    const habia = await borrarPlantilla(db, ownerId, borrar[1] ?? '')
    if (!habia) {
      sendJson(res, 404, { error: 'Esa plantilla ya no existe.' })
      return
    }
    // Borrar una plantilla NO cambia los ajustes vigentes: si la tenias
    // aplicada, sigues trabajando con esos valores. Solo desaparece el atajo.
    sendJson(res, 200, { plantillas: await listarPlantillas(db, ownerId) })
    return
  }

  // Paginas legales. Publicas: TikTok las audita sin credenciales.
  if (esPaginaLegal(url) && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // Se cachean una hora: son texto fijo y un revisor puede recargarlas
      // varias veces. No llevan nada personal, asi que la cache es publica.
      'cache-control': 'public, max-age=3600',
    })
    res.end(path === '/legal/terminos' ? paginaTerminos() : paginaPrivacidad())
    return
  }

  /*
   * Vuelta del flujo de autorizacion de TikTok.
   *
   * Responde HTML y no JSON porque quien llega aqui es una persona con el
   * navegador abierto, no el panel: un objeto JSON en pantalla despues de
   * autorizar una cuenta no dice si salio bien.
   */
  if (path === '/auth/tiktok/callback' && req.method === 'GET') {
    const pagina = (titulo: string, detalle: string, ok: boolean): void => {
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<title>${esc(titulo)}</title>` +
          `<body style="font:16px/1.5 system-ui,sans-serif;max-width:34em;margin:14vh auto;padding:0 6vw;color:#0D0D0D;background:#FAFAFA">` +
          `<h1 style="font-size:20px;margin:0 0 .6em">${esc(titulo)}</h1>` +
          `<p style="color:#52525B;margin:0">${esc(detalle)}</p></body>`,
      )
    }

    // TikTok manda el motivo aqui cuando el usuario cancela o deniega.
    const errorTikTok = url.searchParams.get('error')
    if (errorTikTok !== null) {
      pagina(
        'No se autorizo la cuenta',
        `TikTok respondio: ${errorTikTok}. ${url.searchParams.get('error_description') ?? ''}`,
        false,
      )
      return
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (code === null || state === null) {
      pagina('Falta información', 'La dirección no trae el código o el state.', false)
      return
    }

    const tokens = crearTokens(db, ownerId)
    // El state se canjea ANTES de hablar con TikTok: si no es nuestro, no
    // gastamos ni una peticion. Y vale una sola vez.
    const accountId = await tokens.canjearPendiente(state)
    if (accountId === null) {
      pagina(
        'Este enlace ya no vale',
        'O se uso antes, o caduco, o no lo emitio este sistema. Vuelve a lanzar el enlace.',
        false,
      )
      return
    }

    // Fuera del try para que el manejador de errores pueda decir A QUE cuenta
    // pertenece ya un open_id repetido. Dentro, no estaria en su alcance.
    let openId = ''

    try {
      const cred = credenciales()
      if (cred === null) throw new Error('Faltan las credenciales de la app de TikTok.')

      const permiso = await canjearCodigo(cred, code)
      openId = permiso.openId
      await tokens.guardar(accountId, permiso)
      log.info(`TikTok enlazado: ${accountId} -> ${permiso.openId}`)
      pagina(
        'Cuenta enlazada',
        `${accountId} ya puede publicar. Puedes cerrar esta pestaña y enlazar la siguiente.`,
        true,
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`TikTok callback (${accountId}): ${msg}`)

      /*
       * El choque contra el indice unico, dicho en castellano.
       *
       * `tiktok_tokens_open_id_idx` impide que la misma cuenta de TikTok quede
       * enlazada a dos cuentas nuestras; sin el, un despiste repartiria el
       * doble de publicaciones sobre el mismo perfil. La guarda es correcta,
       * pero el mensaje que salia era el SQL en crudo:
       *
       *   duplicate key value violates unique constraint "tiktok_tokens_open_id_idx"
       *
       * Quien lo lee esta en el movil a mitad de enlazar veinte cuentas y lo
       * unico que necesita saber es que repitio cuenta, casi siempre porque el
       * navegador reutilizo una sesion abierta. Se busca a cual pertenece ya
       * para poder nombrarla.
       */
      if (/duplicate key|tiktok_tokens_open_id_idx/i.test(msg)) {
        let yaEn = ''
        try {
          const filas = await db.query<{ account_id: string; username: string }>(
            `select account_id, username from tiktok_tokens where owner_id = $1 and open_id = $2`,
            [ownerId, openId],
          )
          const f = filas[0]
          if (f !== undefined) {
            yaEn = f.username === '' ? ` (${f.account_id})` : ` (${f.account_id}, @${f.username})`
          }
        } catch {
          // Si tampoco se puede consultar, el mensaje general ya sirve.
        }
        pagina(
          'Esa cuenta ya estaba enlazada',
          `Esta cuenta de TikTok${yaEn} ya pertenece a otra cuenta del sistema, asi que no se ` +
            `puede asignar tambien a ${accountId}. Suele pasar cuando el navegador reutiliza una ` +
            'sesión abierta: abre una ventana de incognito nueva e inicia sesión con la cuenta ' +
            'que querias enlazar. Pide otro enlace, porque este ya se ha gastado.',
          false,
        )
        return
      }

      pagina('No se pudo completar', msg, false)
    }
    return
  }

  if (path === '/api/plataformas' && req.method === 'GET') {
    /*
     * publicables(), no all().
     *
     * Esta pantalla decia "20 cuentas" contando las dieciocho pausadas, que no
     * reciben nada. Inicio ya contaba las publicables, asi que las dos
     * pantallas daban numeros distintos para la misma pregunta.
     */
    const [posts, cuentas] = await Promise.all([
      store.posts.all(),
      store.accounts.publicables(),
    ])
    // El proveedor viaja con los datos: la lista de cuentas dice cosas distintas
    // segun por donde se publique, y sin esto el navegador tendria que adivinarlo.
    sendJson(res, 200, {
      plataformas: resumirPlataformas(posts, cuentas.length, cuentas.length, { proveedor: proveedorActivo(), cuentas }),
      proveedor: proveedorActivo(),
    })
    return
  }

  /*
   * Proyectos: clientes, campañas y a quien pertenece cada cosa.
   *
   * Dos rutas y no ocho. Las mutaciones llegan todas por el mismo POST con un
   * campo `accion`, en vez de una ruta por operacion con el identificador en el
   * camino. Son nueve operaciones sobre dos tablas; nueve expresiones regulares
   * para extraer un uuid de la ruta serian mas codigo y mas sitios donde
   * equivocarse al validarlo.
   *
   * Las dos devuelven SIEMPRE el estado entero, como plantillas y ajustes. Un
   * cambio aqui toca varias listas a la vez (borrar un cliente deja cuentas sin
   * asignar y se lleva sus campañas), y con una respuesta parcial el navegador
   * tendria que deducir el resto.
   */
  if (path === '/api/proyectos' && (req.method === 'GET' || req.method === 'POST')) {
    const proyectos = crearProyectos(db, ownerId)

    try {
      if (req.method === 'POST') {
        const body = (await readBody(req)) as Record<string, unknown>
        const id = typeof body.id === 'string' ? body.id : ''
        // null explicito significa "quitar la asignacion", que no es lo mismo
        // que no mandar el campo. Por eso se distingue de undefined.
        const destino = body.destino === null ? null : String(body.destino ?? '')

        switch (body.accion) {
          case 'crear-cliente':
            await proyectos.crearCliente(body.nombre, body.notas)
            break
          case 'editar-cliente':
            await proyectos.editarCliente(id, body)
            break
          case 'borrar-cliente':
            await proyectos.borrarCliente(id)
            break
          case 'crear-campana':
            await proyectos.crearCampana(String(body.clienteId ?? ''), body.nombre, body.notas)
            break
          case 'editar-campana':
            await proyectos.editarCampana(id, body)
            break
          case 'borrar-campana':
            await proyectos.borrarCampana(id)
            break
          case 'asignar-cuenta':
            await proyectos.asignarCuenta(id, destino === '' ? null : destino)
            break
          case 'asignar-vod':
            await proyectos.asignarVod(id, destino === '' ? null : destino)
            break
          default:
            sendJson(res, 400, { error: 'Esa acción no existe.' })
            return
        }
      }

      const [clientes, campanas, asignaciones] = await Promise.all([
        proyectos.clientes(true),
        proyectos.campanas(),
        proyectos.asignaciones(),
      ])
      sendJson(res, 200, { clientes, campanas, ...asignaciones })
    } catch (error) {
      // ProyectoError lleva un mensaje escrito para que lo lea una persona.
      // Cualquier otra cosa es un fallo de verdad y debe subir como 500.
      if (error instanceof ProyectoError) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  /*
   * Cuentas de TikTok: enlazar, comprobar y desenlazar.
   *
   * Hasta aqui esto era solo linea de comando, lo que obligaba a estar delante
   * del PC para dar de alta una cuenta. Las tres operaciones funcionan igual de
   * bien en el panel remoto: ninguna toca disco ni video, solo la base y la API
   * de TikTok. Y la vuelta de la autorizacion ya aterriza en este servidor.
   */
  if (path === '/api/cuentas' && req.method === 'POST') {
    const body = (await readBody(req)) as Record<string, unknown>
    const accountId = typeof body.id === 'string' ? body.id : ''
    const tokens = crearTokens(db, ownerId)

    if (body.accion === 'enlazar') {
      const cred = credenciales()
      if (cred === null) {
        sendJson(res, 400, {
          error: 'Faltan TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET o TIKTOK_REDIRECT_URI.',
        })
        return
      }
      const cuentas = await store.accounts.all()
      if (!cuentas.some((c) => c.id === accountId)) {
        sendJson(res, 400, { error: `No existe la cuenta ${accountId}.` })
        return
      }

      const { url, state: estado } = enlaceAutorizacion(cred, accountId)
      await tokens.anotarPendiente(estado, accountId)
      /*
       * Se devuelve la URL para que la abra el navegador, no se redirige.
       *
       * Quien pulsa el boton esta en el panel con SU sesion de TikTok, que casi
       * nunca es la de la cuenta que quiere enlazar. Devolverla deja que el
       * panel avise de que conviene abrirla en una ventana de incognito, que es
       * el error que mas veces ha costado repetir el proceso.
       */
      sendJson(res, 200, { url })
      return
    }

    if (body.accion === 'olvidar') {
      const habia = await tokens.olvidar(accountId)
      sendJson(res, 200, {
        mensaje: habia
          ? `Permiso de ${accountId} borrado. Revocalo tambien desde los ajustes de esa cuenta de TikTok.`
          : `${accountId} no tenia ningun permiso guardado.`,
      })
      return
    }

    /*
     * Pausar una cuenta es lo que decide si entra en el reparto.
     *
     * Con upload-post hace falta de verdad: alli solo existen los perfiles que
     * tengas contratados, y el programa no puede saber cuales son sin
     * preguntarselo en cada reparto. Una cuenta activa sin perfil al otro lado
     * se lleva su parte de los videos y luego falla una por una.
     *
     * Hasta ahora esto solo se podia cambiar escribiendo en la base.
     */
    /*
     * Cuantas cuentas maneja el programa, desde el panel.
     *
     * Hasta ahora solo se podian crear por consola, con
     * `npm run accounts -- --init 20`, y ese numero quedaba fijo desde el
     * primer dia. Subirlo o bajarlo era tocar una terminal en el ordenador de
     * casa, que es justo lo que el panel existe para evitar.
     */
    if (body.accion === 'crear') {
      const cuantas = Number(body.cuantas ?? 1)
      if (!Number.isInteger(cuantas) || cuantas < 1) {
        sendJson(res, 400, { error: 'Hay que crear al menos una cuenta.' })
        return
      }

      /*
       * El tope sale de los ajustes, no de un numero escrito aqui.
       *
       * Estaba en dos lineas de este fichero (50 por tanda y 100 en total) y
       * en una tercera dentro de queue/settings.ts, y el guion de consola no
       * respetaba ninguna: por terminal se creaban las que fueran y despues
       * el panel se negaba a crear la 101. Ahora hay un solo numero, en la
       * base, y se cambia desde Horarios.
       */
      const [existentes, ajustes] = await Promise.all([
        store.accounts.all(),
        loadSettingsDb(db, ownerId),
      ])
      if (existentes.length + cuantas > ajustes.maxCuentas) {
        /*
         * El error dice el PLAN, no solo el numero.
         *
         * "El tope esta en 25" invita a subir el numero en el panel y volver
         * a intentarlo, y entonces las cuentas se crean y fallan una por una
         * al publicar, porque upload-post no tiene perfil para ellas. Lo que
         * hay que hacer es contratar otro plan; eso es lo que tiene que
         * decir el mensaje.
         */
        const plan = planDe(ajustes.maxCuentas)
        sendJson(res, 400, {
          error:
            `Serian ${existentes.length + cuantas} cuentas y tu tope es de ` +
            `${describirTope(ajustes.maxCuentas)}. ` +
            (plan === undefined
              ? 'Cambialo en Ajustes, Horarios.'
              : 'Para tener más, contrata un plan mayor en upload-post y elige ese ' +
                'plan en Ajustes, Horarios.'),
        })
        return
      }

      /*
       * La numeracion sigue por donde iba, sin reutilizar huecos.
       *
       * Si se borra acc-07 y luego se crea una, llamarla acc-07 otra vez
       * heredaria su nombre en los registros viejos y en los perfiles del
       * servicio de publicacion, donde el nombre de la cuenta ES el
       * identificador del perfil.
       */
      let siguiente = 0
      for (const c of existentes) {
        const n = Number(/^acc-(\d+)$/.exec(c.id)?.[1] ?? '0')
        if (n > siguiente) siguiente = n
      }

      const nuevas = Array.from({ length: cuantas }, (_, i) => ({
        id: `acc-${String(siguiente + i + 1).padStart(2, '0')}`,
        label: `Cuenta ${siguiente + i + 1}`,
        status: 'active' as const,
        slots: [] as number[],
        tokenStatus: 'unknown' as const,
        lastPublishedAt: null,
      }))
      await store.accounts.save(nuevas)

      // Las franjas se reparten entre TODAS, no solo las nuevas: meter una
      // cuenta mas cambia el hueco que le toca a cada una. Los ajustes ya se
      // leyeron arriba para comprobar el tope; no hacen falta otra vez.
      const todas = await store.accounts.all()
      const { rows } = repartirFranjas(
        ajustes.postsPerDay,
        ajustes.dayStartHour,
        ajustes.dayEndHour,
        todas,
      )
      await store.accounts.save(rows)

      avisarCambio('cuentas')
      sendJson(res, 200, {
        mensaje: `${cuantas} cuenta(s) creada(s): ${nuevas.map((n) => n.id).join(', ')}.`,
      })
      return
    }

    /*
     * Borrar solo lo que no deja huella.
     *
     * Una cuenta con publicaciones o con permiso de TikTok guardado NO se
     * borra: su historial es la unica prueba de lo que se publico en ella, y
     * el permiso costo una autorizacion manual del titular. Para dejar de
     * usarla esta Pausar, que es reversible.
     */
    if (body.accion === 'borrar') {
      const [{ n: publicaciones } = { n: '0' }] = await db.query<{ n: string }>(
        `select count(*)::text n from posts where owner_id = $1 and account_id = $2`,
        [ownerId, accountId],
      )
      if (Number(publicaciones) > 0) {
        sendJson(res, 409, {
          error: `${accountId} tiene ${publicaciones} publicacion(es) a su nombre. Pausala en vez de borrarla: asi conserva su historial y puede volver.`,
        })
        return
      }
      if ((await tokens.todos()).some((t) => t.accountId === accountId)) {
        sendJson(res, 409, {
          error: `${accountId} tiene un permiso de TikTok guardado. Desenlazala primero.`,
        })
        return
      }

      const borradas = await db.query(
        `delete from accounts where owner_id = $1 and id = $2 returning id`,
        [ownerId, accountId],
      )
      if (borradas.length === 0) {
        sendJson(res, 404, { error: `No existe la cuenta ${accountId}.` })
        return
      }
      // Lo que tuviera en la cola deja de tener destino.
      await db.query(
        `delete from queue where owner_id = $1 and account_id = $2 and status = 'pending'`,
        [ownerId, accountId],
      )

      avisarCambio('cuentas')
      sendJson(res, 200, { mensaje: `${accountId} borrada.` })
      return
    }

    if (body.accion === 'pausar' || body.accion === 'activar') {
      const nuevo = body.accion === 'activar' ? 'active' : 'paused'
      const existe = await store.accounts.setStatus(accountId, nuevo)
      if (!existe) {
        sendJson(res, 404, { error: `No existe la cuenta ${accountId}.` })
        return
      }
      // Cambia a cuantas cuentas se reparte, que sale en Inicio y en Cuentas.
      avisarCambio('cuentas')
      sendJson(res, 200, {
        mensaje:
          nuevo === 'active'
            ? `${accountId} vuelve al reparto.`
            : `${accountId} queda fuera del reparto. Lo ya programado no se toca.`,
      })
      return
    }

    /*
     * Editar alias, tope diario y plataformas de una cuenta (Fase 7).
     *
     * Todo se valida aqui: el alias acaba en la lista y en los avisos, el tope
     * en el reparto, y las plataformas en la peticion a upload-post.
     */
    if (body.accion === 'editar') {
      const cambios: { alias?: string; limiteDiario?: number | null; plataformas?: Plataforma[] } = {}
      if (body.alias !== undefined) {
        const alias = typeof body.alias === 'string' ? body.alias.trim().replace(/\s+/g, ' ') : ''
        if (alias.length > 40) {
          sendJson(res, 400, { error: 'El alias no puede pasar de 40 caracteres.' })
          return
        }
        cambios.alias = alias
      }
      if (body.limiteDiario !== undefined) {
        if (body.limiteDiario === null || body.limiteDiario === '') {
          cambios.limiteDiario = null
        } else {
          const n = Number(body.limiteDiario)
          if (!Number.isInteger(n) || n < 1 || n > 10) {
            sendJson(res, 400, { error: 'El tope diario va de 1 a 10 publicaciones.' })
            return
          }
          cambios.limiteDiario = n
        }
      }
      if (body.plataformas !== undefined) {
        const lista = Array.isArray(body.plataformas) ? body.plataformas : []
        if (!lista.every((p) => (PLATAFORMAS as readonly unknown[]).includes(p))) {
          sendJson(res, 400, { error: 'Esa plataforma no existe.' })
          return
        }
        // TikTok va siempre: es la plataforma principal y la que mide el reparto.
        cambios.plataformas = [...new Set<Plataforma>(['tiktok', ...(lista as Plataforma[])])]
      }
      const existe = await store.accounts.editar(accountId, cambios)
      if (!existe) {
        sendJson(res, 404, { error: `No existe la cuenta ${accountId}.` })
        return
      }
      avisarCambio('cuentas')
      sendJson(res, 200, { mensaje: `${accountId} guardada.` })
      return
    }

    if (body.accion === 'revisar') {
      const provider = new TikTokProvider(tokens)
      try {
        const info = await provider.creatorInfo(accountId)
        // Se aprovecha para guardar el @: el flujo de OAuth no lo devuelve y
        // esta es la unica llamada que lo trae.
        await tokens.anotarUsuario(accountId, info.username)
        sendJson(res, 200, {
          username: info.username,
          nickname: info.nickname,
          privacyLevels: info.privacyLevels,
          maxDurationSec: info.maxDurationSec,
        })
      } catch (error) {
        // El detalle de TikTok va al registro; en pantalla, lo que hay que hacer.
        log.warn(`Comprobar ${accountId}: ${limpiarRutas(error instanceof Error ? error.message : String(error))}`)
        sendJson(res, 400, {
          error: 'TikTok no respondió por esta cuenta. Si vuelve a pasar, desenlázala y vuelve a enlazarla.',
        })
      }
      return
    }

    sendJson(res, 400, { error: 'Esa acción no existe.' })
    return
  }

  /*
   * Quitar un video de la lista.
   *
   * Solo los que no llegaron a nada: sin momentos encontrados. El VOD se apunta
   * en cuanto se conoce su identificador, antes de tener el fichero, asi que
   * una descarga fallida dejaba una ficha a cero que no avanzaba ni se podia
   * borrar. El 2026-10-09 una de esas era lo primero que se leia al entrar.
   *
   * Uno con momentos NO se borra aunque esten descartados: esa es la decision
   * de alguien sobre ese material, y perderla significaria que el programa
   * vuelva a proponer lo mismo la proxima vez.
   */
  const quitarVod = /^\/api\/sources\/([^/]+)$/.exec(path)
  if (quitarVod !== null && req.method === 'DELETE') {
    const sourceId = decodeURIComponent(quitarVod[1] ?? '')

    const [{ n } = { n: '0' }] = await db.query<{ n: string }>(
      `select count(*)::text n from clips where owner_id = $1 and source_id = $2`,
      [ownerId, sourceId],
    )
    if (Number(n) > 0) {
      sendJson(res, 409, {
        error: `${sourceId} tiene ${n} momento(s) encontrados. No se quita: perderias lo que ya decidiste sobre ellos.`,
      })
      return
    }

    const borradas = await db.query(
      `delete from sources where owner_id = $1 and id = $2 returning id`,
      [ownerId, sourceId],
    )
    if (borradas.length === 0) {
      sendJson(res, 404, { error: `No existe el video ${sourceId}.` })
      return
    }

    avisarCambio('fuentes')
    sendJson(res, 200, { mensaje: `${sourceId} quitado de la lista.` })
    return
  }

  if (path === '/api/metrics' && req.method === 'GET') {
    sendJson(res, 200, await buildMetrics(store))
    return
  }

  if (path === '/api/jobs' && req.method === 'GET') {
    // Sin el registro: el listado se pide a menudo y la salida completa de
    // varios trabajos son cientos de kilobytes que nadie mira.
    const jobs = await cola.recientes(40)
    sendJson(res, 200, {
      active: enMarcha(jobs)?.id ?? null,
      jobs: jobs.map(({ log: texto, ...rest }) => ({
        ...jobParaPanel(rest),
        lineCount: texto === '' ? 0 : texto.split('\n').length,
      })),
    })
    return
  }

  if (path === '/api/jobs' && req.method === 'POST') {
    const body = (await readBody(req)) as { kind?: unknown; params?: Record<string, unknown> }

    /*
     * EL PANEL REMOTO SI PUEDE ENCOLAR. Esto antes lo prohibia, y era un error.
     *
     * El razonamiento viejo era: "descargar y renderizar necesitan ffmpeg y la
     * tarjeta grafica, y en Hostinger no hay ninguna de las dos". Cierto, pero
     * irrelevante: el panel no ejecuta nada. Escribe la tarea en la tabla
     * `jobs` y el trabajador de casa la recoge cuando pregunta -- es el PC
     * quien pregunta, no el servidor quien llama. Encolar desde el movil y que
     * el ordenador lo procese es exactamente como esta pensado el sistema.
     *
     * De donde venia el error: cuando se escribio, el servidor del panel
     * ejecutaba los trabajos EL MISMO, en su propio proceso. Ahi si moria. Al
     * mover la cola a Postgres con un trabajador aparte, esta comprobacion
     * dejo de tener sentido y nadie la quito. El sintoma era que pegar un
     * enlace de YouTube desde el telefono contestaba "lanzala desde el
     * ordenador que hace el trabajo", que es justo lo que uno NO quiere tener
     * que hacer.
     *
     * Lo que SI sigue sin poder hacerse en remoto es subir un fichero, porque
     * ahi el video tiene que acabar en un disco que el trabajador pueda leer.
     * Eso lo cubre la comprobacion propia de /api/upload, mas arriba.
     *
     * Si no hay ningun trabajador escuchando, la tarea se encola igual y se
     * avisa: queda esperando a que enciendas el ordenador, que es un estado
     * legitimo y muy distinto de un fallo.
     */

    try {
      // La lista de VOD conocidos sale de la base, que es la unica que el panel
      // puede consultar desde donde esta.
      const conocidos = new Set((await store.sources.all()).map((s) => s.sourceId))
      // Los ajustes de corte se leen aqui, no llegan del navegador: lo guardado
      // en Ajustes es lo que se aplica, aunque la pestaña lleve abierta un dia.
      const built = buildJob(
        body.kind,
        body.params ?? {},
        conocidos,
        await loadClipSettings(db, ownerId),
      )
      const job = await cola.encolar(built.kind, built.args, built.label)
      avisarCambio('trabajos')
      /*
       * Se devuelve si hay alguien al otro lado para recogerla.
       *
       * Sin esto, encolar desde el movil con el ordenador apagado se veria
       * exactamente igual que encolar con el encendido: un 202 y una tarea
       * que no avanza nunca. El panel usa este dato para decirlo en el acto.
       */
      const trabajador = await cola.trabajadorVivo()
      sendJson(res, 202, { ...job, trabajador })
    } catch (error) {
      if (error instanceof BadRequest) {
        sendJson(res, 400, { error: error.message })
        return
      }
      throw error
    }
    return
  }

  const jobDetail = /^\/api\/jobs\/([A-Za-z0-9-]+)$/.exec(path)
  if (jobDetail !== null && req.method === 'GET') {
    const job = await cola.porId(jobDetail[1] ?? '')
    if (job === null) {
      sendJson(res, 404, { error: 'Esa tarea ya no existe.' })
      return
    }
    // El panel espera un array de lineas. En la base el registro es un solo
    // texto porque asi cabe en una columna y se escribe de una vez.
    sendJson(res, 200, { ...job, lines: job.log === '' ? [] : job.log.split('\n') })
    return
  }

  const jobCancel = /^\/api\/jobs\/([A-Za-z0-9-]+)\/cancel$/.exec(path)
  if (jobCancel !== null && req.method === 'POST') {
    const ok = await cola.cancelar(jobCancel[1] ?? '')
    if (ok) avisarCambio('trabajos')
    sendJson(res, ok ? 200 : 409, ok ? { ok: true } : { error: 'No se pudo cancelar la tarea: puede que ya haya terminado.' })
    return
  }

  if (path === '/api/events' && req.method === 'GET') {
    const activo = enMarcha(await cola.recientes(1))?.id ?? null
    streamEvents(req, res, activo)
    return
  }

  /*
   * El fotograma limpio de un clip, para la vista previa de Estilo (Fase 5).
   * Mismo camino que el video: el archivo en este ordenador, o una URL firmada
   * de un minuto de la copia en la nube.
   */
  const foto = /^\/fotograma\/([^/]+)\/([^/]+)$/.exec(path)
  if (foto !== null && req.method === 'GET') {
    const clip = await store.clips.find(decodeURIComponent(foto[1] ?? ''), decodeURIComponent(foto[2] ?? ''))
    if (clip === undefined) {
      sendJson(res, 404, { error: 'Ese clip ya no existe.' })
      return
    }
    const local = clip.masterPath === '' ? '' : rutaFotograma(clip.masterPath)
    if (!esRemoto() && local !== '' && existsSync(local)) {
      const datos = readFileSync(local)
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': datos.length, 'cache-control': 'no-store' })
      res.end(datos)
      return
    }
    if (clip.proxyPath === '' || nube === null) {
      sendJson(res, 404, { error: 'Este clip no tiene fotograma.' })
      return
    }
    try {
      const firmada = await nube.firmar(clip.proxyPath.replace(/\.mp4$/i, '.jpg'), 60)
      res.writeHead(302, { location: firmada, 'cache-control': 'no-store' })
      res.end()
    } catch {
      sendJson(res, 404, { error: 'Este clip no tiene fotograma.' })
    }
    return
  }

  const video = /^\/video\/([^/]+)\/([^/]+)$/.exec(path)
  if (video !== null && req.method === 'GET') {
    const clip = await store.clips.find(
      decodeURIComponent(video[1] ?? ''),
      decodeURIComponent(video[2] ?? ''),
    )
    if (clip === undefined) {
      sendJson(res, 404, { error: 'Ese clip ya no existe.' })
      return
    }

    /*
     * En este ordenador se sirve el master directamente.
     *
     * Es mejor en todo: calidad completa, sin recodificar, sin red de por
     * medio y sin gastar transferencia de la nube. La copia existe para cuando
     * el que mira no es la maquina que renderiza.
     */
    if (!esRemoto() && clip.masterPath !== '' && existsSync(clip.masterPath)) {
      streamVideo(req, res, clip)
      return
    }

    if (clip.proxyPath === '') {
      sendJson(res, 501, {
        error:
          'Este video todavía no esta subido. En el ordenador que los crea, ' +
          'entra en Inicio y pulsa "Subir para revisar".',
      })
      return
    }

    if (nube === null) {
      sendJson(res, 501, {
        error:
          'Falta la clave de Supabase en este servidor (SUPABASE_SERVICE_ROLE_KEY), ' +
          'así que el panel no puede pedir los videos subidos.',
      })
      return
    }

    /*
     * Una URL firmada nueva en cada peticion, y de un minuto.
     *
     * No se guarda la firma en la base: una URL de larga duracion es una copia
     * del permiso, y basta con que alguien la comparta por error para que el
     * clip quede accesible sin pasar por la llave del panel. Firmar cuesta una
     * peticion y el navegador ya se ha ganado el acceso al llegar aqui.
     *
     * Un minuto alcanza para empezar a reproducir; a partir de ahi la conexion
     * ya esta abierta y no se vuelve a comprobar.
     */
    try {
      const firmada = await nube.firmar(clip.proxyPath, 60)
      res.writeHead(302, { location: firmada, 'cache-control': 'no-store' })
      res.end()
    } catch (error) {
      log.error(`firmar ${clip.proxyPath}: ${String(error)}`)
      sendJson(res, 502, { error: 'No se pudo pedir el video a la nube.' })
    }
    return
  }

  /*
   * Lo que no es ninguna ruta.
   *
   * Dos respuestas distintas segun quien pregunte. Un GET de navegador (acepta
   * HTML) recibe una pagina que explica el fallo y ofrece la vuelta; cualquier
   * otra cosa -- una llamada de la API, un POST, un fetch -- recibe el JSON de
   * siempre, porque un cliente de API que reciba HTML no sabe que hacer con el.
   */
  const quiereHtml =
    req.method === 'GET' && String(req.headers.accept ?? '').includes('text/html')
  if (quiereHtml) {
    const html = renderPerdido(path)
    res.writeHead(404, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      'cache-control': 'no-store',
    })
    res.end(html)
    return
  }
  sendJson(res, 404, { error: 'Esa dirección no existe en el panel.' })
}

/** La descarga con enlace firmado: el MP4 como adjunto, o la nube firmada. */
async function servirDescarga(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Contexto,
  sourceId: string,
  clipId: string,
  url: URL,
): Promise<void> {
  if (!verificarEnlace(sourceId, clipId, url.searchParams.get('exp') ?? '', url.searchParams.get('firma') ?? '')) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('Este enlace de descarga no es válido o ha caducado. Pide uno nuevo en el panel.')
    return
  }
  const clip = await ctx.store.clips.find(sourceId, clipId)
  if (clip === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Ese clip ya no existe.')
    return
  }
  const nombre = `${sourceId}-${clipId}.mp4`.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!esRemoto() && clip.masterPath !== '' && existsSync(clip.masterPath)) {
    res.setHeader('content-disposition', `attachment; filename="${nombre}"`)
    streamVideo(req, res, clip)
    return
  }
  if (clip.proxyPath !== '' && ctx.nube !== null) {
    try {
      const firmada = await ctx.nube.firmar(clip.proxyPath, 60)
      res.writeHead(302, { location: firmada, 'cache-control': 'no-store' })
      res.end()
      return
    } catch (error) {
      log.error(`firmar descarga ${clip.proxyPath}: ${String(error)}`)
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('El archivo de este clip no está disponible ahora mismo.')
}

/** Direcciones IPv4 de la maquina, para abrir el panel desde el movil. */
function localAddresses(): string[] {
  const found: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address)
    }
  }
  return found
}

/** Lo que Ajustes > Sistema enseña de las alertas. Nunca las claves. */
async function resumenAlertas(db: Db, ownerId: string): Promise<Record<string, unknown>> {
  try {
    const filas = await db.query<{ alertas_activas: boolean | null }>(
      `select alertas_activas from settings where owner_id = $1`,
      [ownerId],
    )
    return {
      canales: canalesConfigurados(),
      activas: filas[0]?.alertas_activas !== false,
      ultimas: await ultimasAlertas(db, ownerId),
    }
  } catch {
    // Sin la migracion 024.
    return { canales: canalesConfigurados(), activas: false, ultimas: [] }
  }
}

export interface ReviewServerOptions {
  port: number
  db: Db
  ownerId: string
}

export function startReviewServer({ port, db, ownerId }: ReviewServerOptions): void {
  const ctx: Contexto = {
    store: createStore(db, ownerId),
    cola: createCola(db, ownerId),
    runs: createRunsStore(db, ownerId),
    db,
    ownerId,
    nube: crearNube(),
    auth: createAuth(db, ownerId),
  }

  // Subir un video dispara por si solo la busqueda de momentos y el render.
  // Cada paso encadenado lleva los ajustes guardados, igual que si se pulsara
  // el boton en el panel (Fase 5: antes iban sin ellos).
  //
  // SOLO buscar momentos y armar clips dependen de los ajustes. El resto
  // (subir, momentos, schedule) usa sus argumentos de siempre: buildJob para
  // 'schedule' es el boton manual "Planificar la cola", sin video, y encadenado
  // fallaba con "Uso: npm run schedule -- <sourceId>" (visto con un video real).
  arrancarCadena(ctx.cola, () => avisarCambio('trabajos'), async (kind, sourceId) =>
    kind === 'select' || kind === 'render'
      ? buildJob(kind, { sourceId }, new Set([sourceId]), await loadClipSettings(db, ownerId)).args
      : null,
  )
  vigilarTareas(ctx.cola)
  // Alertas por Telegram o correo: el panel vigila, porque si el que se cae es
  // el procesador alguien de fuera tiene que darse cuenta (Fase 7).
  iniciarVigia(db, ownerId)

  const server = createServer((req, res) => {
    handle(req, res, ctx).catch((error: unknown) => {
      log.error('Fallo al atender la peticion', error)
      if (!res.headersSent) sendJson(res, 500, { error: 'Algo falló en el panel. Vuelve a intentarlo en un momento.' })
    })
  })

  /*
   * Sin contraseña, solo la interfaz local.
   *
   * Antes escuchaba siempre en 0.0.0.0 y la contraseña era opcional: bastaba
   * arrancar sin REVIEW_PASSWORD para dejar el panel abierto a toda la red
   * local, con un aviso por consola que es facil no leer. Y este panel no es
   * un visor: encola tareas, acepta archivos y cambia los horarios de
   * publicacion. Abierto equivale a ejecucion remota.
   *
   * Ahora el enlace depende de si hay proteccion, sea llave o contraseña. Quien
   * quiera exponerlo sin ninguna tiene que pedirlo a proposito con
   * REVIEW_ALLOW_OPEN=1, que es un gesto deliberado y no un descuido.
   */
  /*
   * Con login, el panel escucha en todas las interfaces: nada se ve sin
   * sesion. La unica excepcion es KLIP_SIN_LOGIN=1 (vista previa de
   * desarrollo), que entonces solo escucha en este ordenador.
   */
  const sinLogin = sinLoginActivo()
  const host = sinLogin ? '127.0.0.1' : '0.0.0.0'

  void ctx.auth.contar().then((n) => {
    if (n === 0 && !sinLogin) {
      console.log('  AVISO  : no hay ningún usuario. Crea el primero con: npm run crear-admin')
    }
  }).catch(() => {})

  server.listen(port, host, () => {
    console.log('')
    console.log('Panel de revisión en marcha:')
    console.log(`  local  : http://localhost:${port}`)
    if (host === '0.0.0.0') {
      for (const address of localAddresses()) {
        console.log(`  movil  : http://${address}:${port}`)
      }
    }
    console.log('')
    if (sinLogin) {
      console.log('  acceso : SIN LOGIN y solo desde este ordenador (KLIP_SIN_LOGIN=1).')
    } else {
      console.log('  acceso : correo y contraseña (/login).')
      if (legadoActivo()) {
        console.log('           También la llave antigua (LEGACY_KEY_ENABLED=true). Quitala al confirmar el login.')
      }
    }
    if (esRemoto()) {
      console.log('')
      console.log('  modo   : remoto. Sin videos ni subida de archivos (PANEL_REMOTO=1).')
    }
    console.log('')
    console.log('Ctrl+C para parar.')
  })
}
