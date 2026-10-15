/**
 * Gestion de las cuentas de TikTok por la API directa.
 *
 *   npm run tiktok -- estado              que cuentas estan enlazadas
 *   npm run tiktok -- enlazar acc-01      genera el enlace de autorizacion
 *   npm run tiktok -- revisar             pregunta a TikTok que permite cada cuenta
 *   npm run tiktok -- subidas             que fue de cada video subido
 *   npm run tiktok -- olvidar acc-01      borra el permiso guardado
 *
 * `subidas` es el importante: el worker da por buena una subida en cuanto
 * terminan de viajar los bytes, y eso no es lo mismo que "TikTok la acepto".
 * Es el unico sitio donde se ve que paso de verdad con cada video.
 *
 * Ninguno de estos comandos sabe si la app paso la auditoria. Eso solo lo dice
 * intentar una publicacion directa y ver si TikTok la rechaza.
 */
import { parseArgs } from 'node:util'
import { loadEnv, optionalEnv, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { connect } from '../src/store/db.js'
import { createStore } from '../src/store/pg.js'
/*
 * Las publicaciones salen de Postgres, no de los ficheros de state/.
 *
 * El worker escribe en la base desde que el panel vive en un servidor. Este
 * comando seguia leyendo el almacen viejo y enseñaba una foto congelada: el
 * 2026-10-03 decia 6 entregas cuando en la base habia 11, asi que el unico
 * diagnostico que tenemos de las subidas mentia justo despues de automatizar
 * la publicacion.
 */
import { credenciales, enlaceAutorizacion, TikTokNoConfigurado } from '../src/publish/tiktok/oauth.js'
import { crearTokens } from '../src/publish/tiktok/tokens.js'
import { TikTokProvider } from '../src/publish/providers/tiktok.js'

function faltaConfiguracion(): void {
  console.error('Falta configurar la app de TikTok en el .env:')
  console.error('')
  for (const k of ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI']) {
    console.error(`  ${k}=${optionalEnv(k) === undefined ? '   <-- falta' : '   ok'}`)
  }
  console.error('')
  console.error('Las dos primeras salen del panel de TikTok for Developers, en tu app.')
  console.error('La tercera es la direccion de retorno, y debe ser exactamente la misma')
  console.error('que registraste alli, con https.')
}

async function main(): Promise<void> {
  loadEnv()

  const { positionals } = parseArgs({ allowPositionals: true, options: {} })
  const comando = positionals[0] ?? 'estado'

  const db = await connect(requireEnv('DATABASE_URL'))
  const tokens = crearTokens(db, OWNER_ID)
  const store = createStore(db, OWNER_ID)

  try {
    if (comando === 'estado') {
      const [enlazadas, cuentas] = await Promise.all([tokens.todos(), store.accounts.all()])
      const porCuenta = new Map(enlazadas.map((t) => [t.accountId, t]))

      console.log(`${cuentas.length} cuentas configuradas, ${enlazadas.length} enlazadas con TikTok`)
      console.log('')
      for (const c of cuentas) {
        const t = porCuenta.get(c.id)
        if (t === undefined) {
          console.log(`  ${c.id.padEnd(8)} sin enlazar`)
          continue
        }
        // Se enseña cuanto queda del permiso largo: el corto se renueva solo y
        // saber que caduca en 3 horas no sirve de nada.
        const dias = Math.round((t.refreshExpiresAt.getTime() - Date.now()) / 86400000)
        const quien = t.username !== '' ? `@${t.username}` : t.openId.slice(0, 12) + '...'
        console.log(`  ${c.id.padEnd(8)} ${quien.padEnd(24)} caduca en ${dias} dias`)
      }
      return
    }

    if (comando === 'enlazar') {
      const accountId = positionals[1]
      if (accountId === undefined) {
        console.error('Uso: npm run tiktok -- enlazar <accountId>   (por ejemplo acc-01)')
        process.exitCode = 1
        return
      }

      const cuentas = await store.accounts.all()
      if (!cuentas.some((c) => c.id === accountId)) {
        console.error(`No existe la cuenta ${accountId}. Las que hay: ${cuentas.map((c) => c.id).join(', ')}`)
        process.exitCode = 1
        return
      }

      const cred = credenciales()
      if (cred === null) {
        faltaConfiguracion()
        process.exitCode = 1
        return
      }

      const { url, state } = enlaceAutorizacion(cred, accountId)
      await tokens.anotarPendiente(state, accountId)

      console.log('')
      console.log(`Abre este enlace en el navegador donde tengas la sesion de ${accountId}:`)
      console.log('')
      console.log(url)
      console.log('')
      console.log('Autoriza la app y TikTok te devolvera a la pagina de retorno.')
      console.log('El enlace vale una sola vez y caduca en una hora.')
      console.log('')
      console.log('CONSEJO: usa una ventana de incognito por cuenta. Si ya hay otra')
      console.log('sesion abierta, TikTok autorizara esa sin preguntarte cual.')
      return
    }

    if (comando === 'olvidar') {
      const accountId = positionals[1]
      if (accountId === undefined) {
        console.error('Uso: npm run tiktok -- olvidar <accountId>')
        process.exitCode = 1
        return
      }
      const habia = await tokens.olvidar(accountId)
      console.log(
        habia
          ? `Permiso de ${accountId} borrado. Revocalo tambien desde los ajustes de esa cuenta de TikTok.`
          : `${accountId} no tenia ningun permiso guardado.`,
      )
      return
    }

    if (comando === 'revisar') {
      const enlazadas = await tokens.todos()
      if (enlazadas.length === 0) {
        console.log('No hay ninguna cuenta enlazada. Empieza con: npm run tiktok -- enlazar acc-01')
        return
      }

      const provider = new TikTokProvider(tokens)

      for (const t of enlazadas) {
        try {
          const info = await provider.creatorInfo(t.accountId)
          // Se aprovecha la consulta para guardar el @: es el unico sitio del
          // programa donde ya lo tenemos delante.
          await tokens.anotarUsuario(t.accountId, info.username)

          console.log('')
          console.log(`${t.accountId}  @${info.username}  (${info.nickname})`)
          /*
           * Se enseña tal cual, sin deducir nada de ello.
           *
           * Antes esta linea se leia como "la app paso la auditoria" y se
           * imprimia "Todo listo para publicar de verdad". Era falso: el
           * 2026-09-26, con @zotitan1 devolviendo PUBLIC_TO_EVERYONE aqui, la
           * publicacion directa se rechazo igualmente. Estos niveles describen
           * a la cuenta, no al permiso de la app.
           */
          console.log(`  privacidad de la cuenta : ${info.privacyLevels.join(', ') || '(ninguna)'}`)
          console.log(`  duracion maxima     : ${info.maxDurationSec}s`)
          if (info.commentDisabled || info.duetDisabled || info.stitchDisabled) {
            console.log(
              `  desactivado         : ${[
                info.commentDisabled ? 'comentarios' : '',
                info.duetDisabled ? 'duetos' : '',
                info.stitchDisabled ? 'stitch' : '',
              ]
                .filter(Boolean)
                .join(', ')}`,
            )
          }
        } catch (error) {
          console.log('')
          console.log(`${t.accountId}  FALLO: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      /*
       * Este comando NO sabe si la app esta auditada, y no finge saberlo.
       *
       * Lo unico que lo confirma es intentar una publicacion directa: si la app
       * no paso la auditoria, TikTok responde
       * `unaudited_client_can_only_post_to_private_accounts` y no publica nada.
       * Esa prueba cuesta una llamada y deja el resultado en la cola, asi que
       * se hace a proposito y no de paso al listar cuentas.
       */
      console.log('')
      console.log('='.repeat(72))
      console.log('Esto describe a las CUENTAS, no si la app esta auditada.')
      console.log('')
      console.log('Para saberlo hay que intentar publicar en directo:')
      console.log('  PUBLISH_PROVIDER=tiktok npm run publish -- --live --limit 1')
      console.log('Si sale "unaudited_client_can_only_post_to_private_accounts",')
      console.log('la auditoria sigue pendiente y solo sirve --mode draft.')
      console.log('')
      console.log('La auditoria se pide en:')
      console.log('  https://developers.tiktok.com/application/content-posting-api')
      console.log('='.repeat(72))
      return
    }

    /*
     * Que fue de cada subida.
     *
     * Existe porque el worker canta "subido" cuando acaban de viajar los bytes,
     * y eso no es lo mismo que "TikTok lo acepto". El 2026-09-26 se subieron
     * seis clips, el registro decia que todo bien, y no habia forma de
     * distinguir "esta en la bandeja del usuario" de "TikTok lo rechazo al
     * procesarlo" sin preguntarselo.
     */
    if (comando === 'subidas') {
      const mias = (await store.posts.all()).filter((p) => p.provider === 'tiktok')
      if (mias.length === 0) {
        console.log('No hay ninguna subida por la API directa todavia.')
        return
      }

      const provider = new TikTokProvider(tokens)
      const conteo = new Map<string, number>()

      for (const p of mias) {
        let linea: string
        try {
          const { status, failReason } = await provider.estadoSubida(p.accountId, p.externalId)
          conteo.set(status, (conteo.get(status) ?? 0) + 1)
          linea = failReason === '' ? status : `${status}  motivo=${failReason}`
        } catch (error) {
          linea = `no se pudo consultar: ${error instanceof Error ? error.message : String(error)}`
        }
        console.log(`  ${p.accountId}  ${p.sourceId}/${p.clipId}  ${linea}`)
      }

      console.log('')
      for (const [estado, n] of [...conteo].sort()) console.log(`  ${estado}: ${n}`)

      if ((conteo.get('SEND_TO_USER_INBOX') ?? 0) > 0) {
        console.log('')
        console.log('SEND_TO_USER_INBOX no es un borrador y no sale en el perfil.')
        console.log('El titular lo encuentra en la BANDEJA DE ENTRADA de la app movil,')
        console.log('como notificacion. Al tocarla se abre el editor con el video puesto.')
      }
      return
    }

    console.error(`Comando desconocido: ${comando}`)
    console.error('Usa: estado | enlazar <cuenta> | revisar | subidas | olvidar <cuenta>')
    process.exitCode = 1
  } finally {
    await db.close()
  }
}

try {
  await main()
} catch (error) {
  if (error instanceof TikTokNoConfigurado) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    throw error
  }
}
