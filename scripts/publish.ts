/**
 * Fase 6: cola -> TikTok
 *
 *   npm run publish -- --dry-run          simula la pasada completa, no escribe
 *   npm run publish -- --limit 1          publica de verdad, una sola
 *   npm run publish --                    publica todo lo vencido
 *
 * El modo en seco es el predeterminado a proposito. Publicar es la unica accion
 * irreversible de todo el pipeline: una vez el video esta en TikTok no hay
 * vuelta atras desde aqui.
 */
import { parseArgs } from 'node:util'
import { modoConfigurado, proveedorConfigurado } from '../src/publish/proveedor.js'
import { CLIP_DEFAULTS, loadClipSettings } from '../src/select/ajustes.js'
import { loadEnv, optionalEnv, requireEnv } from '../src/lib/env.js'
import { formatDuration } from '../src/lib/logger.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { DryRunProvider, UploadPostProvider } from '../src/publish/providers/uploadPost.js'
import { TikTokProvider } from '../src/publish/providers/tiktok.js'
import { credenciales } from '../src/publish/tiktok/oauth.js'
import { crearTokens } from '../src/publish/tiktok/tokens.js'
import type { PublishMode, PublishProvider } from '../src/publish/types.js'
import { runWorker } from '../src/publish/worker.js'
import { connect, type Db } from '../src/store/db.js'
import { crearEstadoPg } from '../src/publish/estado-pg.js'
import { createStore } from '../src/store/pg.js'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function main(): Promise<void> {
  loadEnv()

  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      limit: { type: 'string' },
      mode: { type: 'string' },
    },
  })

  // Publicar de verdad exige --live explicito. Sin el, se simula.
  const live = values.live && !values['dry-run']

  // El modo se decide mas abajo, cuando ya esta abierta la base: lo que manda
  // es lo guardado en Ajustes, y la bandera o la variable solo lo pisan.
  let mode: PublishMode = 'direct'
  // Los ajustes se leen una vez y se usan en dos sitios: aqui para elegir
  // proveedor y modo, y mas abajo para el texto y la cadencia.
  let ajustesPublicar = CLIP_DEFAULTS

  /*
   * La base, siempre, y ANTES de mirar la cola.
   *
   * Antes solo se abria para el proveedor de TikTok, que es donde viven los
   * permisos. Ahora tambien es donde se lleva la cuenta de lo publicado: el
   * worker escribe ahi para que el panel remoto vea lo que ha pasado de verdad.
   * Sin esto escribia en los ficheros de este ordenador y el panel enseñaba
   * "sin conectar" con seis clips ya entregados.
   *
   * Y el resumen de aqui abajo tiene que salir del MISMO sitio del que el
   * worker saca el trabajo. Leyendolo de los ficheros, este script podia decir
   * "nada vencido" y terminar sin publicar mientras en la base habia items
   * esperando, o al reves.
   */
  const db: Db = await connect(requireEnv('DATABASE_URL'))
  const estado = crearEstadoPg(db, OWNER_ID)
  const store = createStore(db, OWNER_ID)

  const ahora = new Date()
  const all = await store.queue.all()
  const pending = all.filter((i) => i.status === 'pending')
  const due = pending.filter((i) => new Date(i.scheduledAt) <= ahora)

  console.log('')
  console.log(`Cola: ${all.length} items | ${pending.length} pendientes | ${due.length} vencidos`)

  if (due.length === 0) {
    console.log('Nada vencido. La proxima publicacion programada es:')
    const next = [...pending].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0]
    console.log(
      next === undefined
        ? '  (no hay nada pendiente)'
        : `  ${formatDateTime(next.scheduledAt)}  ${next.accountId}  ${next.clipId}`,
    )
    await db.close()
    return
  }

  let provider: PublishProvider

  if (live) {
    /*
     * Que proveedor usa el sistema.
     *
     * `tiktok` habla con la API de TikTok directamente y el permiso es nuestro.
     * `upload-post` pasa por un intermediario ya auditado, con cuota mensual.
     *
     * Se elige con una variable y no se adivina mirando que credenciales hay:
     * durante una migracion estan las dos puestas a la vez, y elegir sola la
     * primera que encuentre significa publicar por donde no esperabas.
     */
    /*
     * Lo guardado en Ajustes manda; la variable de entorno lo pisa.
     *
     * Antes solo existia la variable, en el .env y en publicar.cmd, o sea en el
     * ordenador de casa: cambiar de proveedor era editar dos ficheros a mano.
     */
    ajustesPublicar = await loadClipSettings(db, OWNER_ID)
    const cual = proveedorConfigurado(ajustesPublicar.proveedor)
    mode = values.mode === 'draft' ? 'draft'
      : values.mode === 'direct' ? 'direct'
      : modoConfigurado(ajustesPublicar.modo)

    if (cual === 'tiktok') {
      if (credenciales() === null) {
        console.error('PUBLISH_PROVIDER=tiktok pero faltan las credenciales de la app.')
        console.error('Faltan en el .env del servidor. En Ajustes, Cuentas, se ve')
        console.error('cuales estan enlazadas.')
        process.exitCode = 1
        await db.close()
        return
      }
      provider = new TikTokProvider(crearTokens(db, OWNER_ID))
    } else if (cual === 'upload-post') {
      const apiKey = optionalEnv('UPLOAD_POST_API_KEY')
      if (apiKey === undefined) {
        console.error('Falta UPLOAD_POST_API_KEY en .env. Sin ella no se puede publicar.')
        process.exitCode = 1
        await db.close()
        return
      }
      provider = new UploadPostProvider(apiKey)
    } else {
      console.error(`PUBLISH_PROVIDER="${cual}" no existe. Usa "tiktok" o "upload-post".`)
      process.exitCode = 1
      await db.close()
      return
    }

    console.log('')
    console.log('!'.repeat(72))
    console.log(`PUBLICACION REAL por ${provider.name}, modo "${mode}". No se puede deshacer.`)
    console.log('!'.repeat(72))
  } else {
    provider = new DryRunProvider()
    console.log(`Modo en seco: se recorre el worker completo sin llamar a la API ni escribir.`)
  }

  console.log('')
  try {
    await publicar()
  } finally {
    // Se cierra aqui y no tras runWorker: la salud de las cuentas se consulta
    // despues del informe y necesita la conexion viva.
    await db.close()
  }

  async function publicar(): Promise<void> {
  /*
   * La forma del texto y la cadencia salen de Ajustes, no del codigo.
   *
   * Antes el texto lo componia cada proveedor por su cuenta y los topes vivian
   * en publish/types.ts, asi que cambiar cualquiera de las dos cosas era tocar
   * codigo y volver a desplegar.
   */
  // Fase 7: Shorts y Reels de cada cuenta, marcados en Cuentas > Editar.
  const plataformas = new Map((await store.accounts.all()).map((a) => [a.id, a.plataformas ?? ['tiktok']]))
  const report = await runWorker({
    provider,
    mode,
    plataformasDe: (id) => plataformas.get(id),
    persist: live,
    estado,
    texto: {
      plantilla: ajustesPublicar.textoPlantilla,
      fijos: ajustesPublicar.hashtagsFijos,
      privacidad: ajustesPublicar.privacidad,
    },
    cadencia: { porMinuto: ajustesPublicar.maxPorMinuto, porDia: ajustesPublicar.maxPorDia },
    concurrencia: ajustesPublicar.concurrencia,
    ...(values.limit === undefined ? {} : { limit: Number(values.limit) }),
  })

  console.log('')
  console.log('='.repeat(72))
  console.log(`Intentadas          : ${report.attempted}`)
  console.log(`Publicadas          : ${report.published}`)
  console.log(`Pospuestas cadencia : ${report.skippedByCadence}`)
  console.log(`Limite alcanzado    : ${report.rateLimited}`)
  console.log(`Reintentos          : ${report.retried}`)
  console.log(`Fallidas            : ${report.failed}`)
  console.log(`Tiempo              : ${formatDuration(report.elapsedMs)}`)
  if (report.pausedAccounts.length > 0) {
    console.log(`Cuentas pausadas    : ${report.pausedAccounts.join(', ')}`)
  }
  console.log('='.repeat(72))

  const health = await store.accounts.all()
  const broken = health.filter((a) => a.status !== 'active')
  if (broken.length > 0) {
    console.log('')
    console.log('Cuentas fuera de rotacion:')
    for (const a of broken) console.log(`  ${a.id}: ${a.status} (token ${a.tokenStatus})`)
  }

  if (!live) {
    console.log('')
    console.log('No se ha publicado nada ni se ha tocado la cola.')
    console.log('Para publicar de verdad: npm run publish -- --live --limit 1')
  }
  }
}

await main()
