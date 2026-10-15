import { optionalEnv } from '../lib/env.js'

/**
 * Por donde se publica. Un solo sitio donde decidirlo.
 *
 * Estaba repetido en publish.ts y metrics.ts, cada uno con su propio valor por
 * defecto, y ninguno de los dos lo sabian las fases ANTERIORES a publicar. Ese
 * era el fallo de fondo: repartir y generar copias elegian las cuentas como si
 * siempre se publicara por la API de TikTok, da igual lo que dijera la variable.
 *
 * Los dos caminos piden cosas distintas de una cuenta:
 *
 *   tiktok       la cuenta tiene que haber autorizado NUESTRA app. Sin token no
 *                se puede subir nada en su nombre.
 *   upload-post  lo que hace falta es un perfil con ese mismo nombre dado de
 *                alta en upload-post. El token de TikTok no pinta nada: quien
 *                tiene la sesion de la cuenta es upload-post, no nosotros.
 *
 * Por eso no se puede filtrar igual en los dos casos, y por eso esto existe.
 */
export type Proveedor = 'tiktok' | 'upload-post'

/**
 * upload-post es el camino principal.
 *
 * La API propia de TikTok esta montada pero a medias: sin pasar la auditoria
 * solo deja dejar el video en la bandeja de entrada, nunca publicarlo. Mientras
 * eso siga asi, el que entrega de verdad es upload-post.
 */
export const POR_DEFECTO: Proveedor = 'upload-post'

function validar(v: string): Proveedor {
  if (v !== 'tiktok' && v !== 'upload-post') {
    throw new Error(`PUBLISH_PROVIDER="${v}" no existe. Usa "tiktok" o "upload-post".`)
  }
  return v
}

/**
 * El proveedor segun el entorno.
 *
 * Se mantiene para quien no tiene la base a mano: una llamada suelta, un script
 * de prueba, o el filtro de cuentas de `publicables()` cuando nadie le pasa
 * nada. Lo que manda de verdad es lo guardado en Ajustes, y eso se lee con
 * `proveedorConfigurado`.
 */
export function proveedorActivo(): Proveedor {
  return validar(optionalEnv('PUBLISH_PROVIDER') ?? POR_DEFECTO)
}

/**
 * El proveedor que toca, mirando primero el entorno y luego la base.
 *
 * EL ENTORNO GANA, a proposito. Lo normal es que no este puesto y mande lo que
 * diga el panel; cuando esta, es porque alguien lo puso para una pasada
 * concreta desde una terminal, y una variable que se escribe a mano y se ignora
 * es peor que no tenerla.
 *
 * Se le pasa lo ya leido de la base en vez de leerlo aqui para no obligar a
 * este modulo a conocer el almacen: lo llaman sitios que ya tienen los ajustes
 * delante.
 */
export function proveedorConfigurado(guardado: string | undefined): Proveedor {
  const env = optionalEnv('PUBLISH_PROVIDER')
  if (env !== undefined) return validar(env)
  return validar(guardado ?? POR_DEFECTO)
}

/** Lo mismo para el modo, con la misma regla: el entorno gana. */
export function modoConfigurado(guardado: string | undefined): 'direct' | 'draft' {
  const v = optionalEnv('PUBLISH_MODE') ?? guardado ?? 'direct'
  return v === 'draft' ? 'draft' : 'direct'
}
