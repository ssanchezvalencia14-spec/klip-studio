import { createLogger } from '../../lib/logger.js'
import type { Db } from '../../store/db.js'
import { credenciales, renovar, type Permiso } from './oauth.js'

const log = createLogger('tiktok-token')

/**
 * Los permisos de TikTok, guardados y renovados.
 *
 * El access_token dura 24 h y el de refresco 365 dias. Con publicaciones
 * diarias eso significa que CASI SIEMPRE el token guardado esta caducado
 * cuando toca publicar, asi que renovar no es un caso excepcional: es el
 * camino normal.
 *
 * Por eso la renovacion vive aqui dentro y no en el proveedor. Quien publica
 * pide "el token de acc-01" y recibe uno valido; si hizo falta renovarlo y
 * guardarlo, no se entera.
 */

export interface TokenCuenta {
  accountId: string
  openId: string
  username: string
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  refreshExpiresAt: Date
  scope: string
}

/**
 * Margen antes de dar un token por caducado.
 *
 * Un token que caduca dentro de treinta segundos es valido al comprobarlo e
 * invalido cuando TikTok termina de recibir un video de 30 MB. Se renueva antes
 * de llegar ahi: renovar de mas cuesta una peticion, renovar de menos cuesta
 * la subida entera y un reintento.
 */
const MARGEN_MS = 5 * 60 * 1000

function aToken(r: Record<string, unknown>): TokenCuenta {
  return {
    accountId: r.account_id as string,
    openId: r.open_id as string,
    username: (r.username ?? '') as string,
    accessToken: r.access_token as string,
    refreshToken: r.refresh_token as string,
    accessExpiresAt: new Date(r.access_expires_at as string),
    refreshExpiresAt: new Date(r.refresh_expires_at as string),
    scope: (r.scope ?? '') as string,
  }
}

export class SinPermiso extends Error {}
export class PermisoCaducado extends Error {}

export function crearTokens(db: Db, ownerId: string) {
  const guardar = async (
    accountId: string,
    permiso: Permiso,
    username?: string,
  ): Promise<void> => {
    await db.query(
      `insert into tiktok_tokens (owner_id, account_id, open_id, access_token, refresh_token,
                                  access_expires_at, refresh_expires_at, scope, username, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,''),now())
       on conflict (owner_id, account_id) do update set
         open_id = excluded.open_id,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         access_expires_at = excluded.access_expires_at,
         refresh_expires_at = excluded.refresh_expires_at,
         scope = excluded.scope,
         -- El nombre solo se pisa si viene uno nuevo: al renovar no se
         -- consulta el perfil, y poner '' borraria el que ya habia.
         username = case when excluded.username = '' then tiktok_tokens.username
                         else excluded.username end,
         updated_at = now()`,
      [
        ownerId,
        accountId,
        permiso.openId,
        permiso.accessToken,
        permiso.refreshToken,
        permiso.accessExpiresAt.toISOString(),
        permiso.refreshExpiresAt.toISOString(),
        permiso.scope,
        username ?? null,
      ],
    )
  }

  return {
    guardar,

    /**
     * Guarda el @ de la cuenta, que el flujo de autorizacion no da.
     *
     * La respuesta de OAuth trae un open_id opaco y nada legible. El nombre
     * solo se consigue preguntando por el perfil, asi que se anota cuando
     * alguien ya lo ha pedido por otro motivo en vez de gastar una llamada
     * aparte. Sin esto el panel enseña un hueco donde deberia ir "@zotitan1".
     */
    async anotarUsuario(accountId: string, username: string): Promise<void> {
      if (username === '') return
      await db.query(
        `update tiktok_tokens set username = $3
          where owner_id = $1 and account_id = $2 and username <> $3`,
        [ownerId, accountId, username],
      )
    },

    /**
     * Anota que hemos emitido un enlace de autorizacion.
     *
     * Es lo que despues permite comprobar que la vuelta desde tiktok.com
     * corresponde a una peticion nuestra. Se borran los viejos de paso: una
     * autorizacion que alguien abandono hace dias no debe seguir siendo
     * valida.
     */
    async anotarPendiente(state: string, accountId: string): Promise<void> {
      await db.query(`delete from tiktok_pendientes where created_at < now() - interval '1 hour'`)
      await db.query(
        `insert into tiktok_pendientes (state, owner_id, account_id) values ($1, $2, $3)`,
        [state, ownerId, accountId],
      )
    },

    /**
     * Canjea un state por la cuenta a la que pertenece, y lo invalida.
     *
     * Devuelve null si no existe, si ya se uso o si caduco. Un solo uso es
     * deliberado: el codigo de autorizacion tambien vale una vez, y dejar el
     * state vivo permitiria reintentar la vuelta con otro codigo.
     */
    async canjearPendiente(state: string): Promise<string | null> {
      const filas = await db.query<{ account_id: string }>(
        `delete from tiktok_pendientes
         where state = $1 and owner_id = $2 and created_at > now() - interval '1 hour'
         returning account_id`,
        [state, ownerId],
      )
      return filas[0]?.account_id ?? null
    },

    async todos(): Promise<TokenCuenta[]> {
      const filas = await db.query<Record<string, unknown>>(
        `select * from tiktok_tokens where owner_id = $1 order by account_id`,
        [ownerId],
      )
      return filas.map(aToken)
    },

    async olvidar(accountId: string): Promise<boolean> {
      const filas = await db.query(
        `delete from tiktok_tokens where owner_id = $1 and account_id = $2 returning account_id`,
        [ownerId, accountId],
      )
      return filas.length > 0
    },

    /**
     * Un access_token valido para esa cuenta, renovandolo si hace falta.
     *
     * Lanza en vez de devolver null: quien llama esta a punto de publicar, y
     * un null ahi se convierte en un fallo tres capas mas abajo sin decir cual
     * de las veinte cuentas es la del problema.
     */
    async vigente(accountId: string): Promise<string> {
      const filas = await db.query<Record<string, unknown>>(
        `select * from tiktok_tokens where owner_id = $1 and account_id = $2`,
        [ownerId, accountId],
      )
      const fila = filas[0]
      if (fila === undefined) {
        throw new SinPermiso(
          `La cuenta ${accountId} no ha autorizado TikTok todavia. ` +
            'Enlazala con: npm run tiktok -- enlazar ' + accountId,
        )
      }

      const token = aToken(fila)
      const ahora = Date.now()

      if (token.accessExpiresAt.getTime() - MARGEN_MS > ahora) return token.accessToken

      if (token.refreshExpiresAt.getTime() <= ahora) {
        throw new PermisoCaducado(
          `El permiso de ${accountId} caduco el ${token.refreshExpiresAt.toISOString().slice(0, 10)}. ` +
            'Hay que volver a autorizar esa cuenta.',
        )
      }

      const cred = credenciales()
      if (cred === null) {
        throw new SinPermiso('Faltan TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET o TIKTOK_REDIRECT_URI.')
      }

      log.info(`renovando el permiso de ${accountId}`)
      const permiso = await renovar(cred, token.refreshToken)
      // Se guarda ANTES de devolverlo. Si el proceso muere aqui, el token nuevo
      // ya esta a salvo; al reves, el viejo habria dejado de valer y no
      // tendriamos el nuevo, que es como se pierde una cuenta para siempre.
      await guardar(accountId, permiso)
      return permiso.accessToken
    },
  }
}

export type Tokens = ReturnType<typeof crearTokens>
