import { readFile } from 'node:fs/promises'
import { optionalEnv } from '../lib/env.js'

/**
 * Supabase Storage, por su API REST y sin SDK.
 *
 * Son tres operaciones: crear el cubo, subir un fichero y firmar una URL
 * temporal. `@supabase/supabase-js` las hace tambien, pero arrastra la libreria
 * entera (realtime, auth, postgrest) a un proyecto que tiene cinco
 * dependencias y que ya habla con Postgres por su cuenta. Sesenta lineas de
 * fetch no necesitan mantenimiento y no cambian de forma entre versiones
 * mayores.
 *
 * LA CLAVE ES service_role. Salta las politicas de acceso por diseño: es la
 * que permite subir sin montar reglas y firmar URLs de un cubo privado. Vive
 * en el .env del PC y en las variables del servidor, nunca en el codigo.
 */

/** Cubo privado. Privado y no publico: son clips sin publicar todavia. */
export const CUBO = 'revision'

export class NubeNoConfigurada extends Error {}

export interface Nube {
  subir(ruta: string, fichero: string, tipo?: string): Promise<void>
  firmar(ruta: string, segundos: number): Promise<string>
  borrar(rutas: string[]): Promise<void>
  asegurarCubo(): Promise<'creado' | 'ya estaba'>
  url: string
}

/**
 * Construye el cliente, o explica que falta.
 *
 * Devuelve null en vez de lanzar cuando no hay credenciales, porque el panel
 * tiene que arrancar igual sin ellas: sin nube se comporta como antes de que
 * esto existiera, avisando de que no hay video, en vez de no arrancar.
 */
export function crearNube(): Nube | null {
  // La URL se deduce de DATABASE_URL si no se da: el usuario de la base es
  // `postgres.<ref>` y el ref es el subdominio del proyecto. Una variable
  // menos que copiar mal.
  const explicita = optionalEnv('SUPABASE_URL')
  const clave = optionalEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (clave === undefined) return null

  const url = explicita ?? urlDesdeBase()
  if (url === null) return null

  const base = url.replace(/\/+$/, '') + '/storage/v1'
  const cabeceras = {
    authorization: `Bearer ${clave}`,
    apikey: clave,
  }

  /**
   * Lee el cuerpo del error aunque no sea JSON.
   *
   * Storage responde con JSON en casi todos los fallos, pero un 502 del
   * balanceador llega como HTML. Un `await res.json()` ahi lanza un error de
   * sintaxis que tapa el de verdad y deja el mensaje "Unexpected token <".
   */
  const fallo = async (res: Response, que: string): Promise<never> => {
    const texto = await res.text().catch(() => '')
    let detalle = texto.slice(0, 300)
    try {
      const j = JSON.parse(texto) as { message?: string; error?: string }
      detalle = j.message ?? j.error ?? detalle
    } catch {
      /* no era JSON; se queda el texto recortado */
    }
    throw new Error(`${que}: HTTP ${res.status} ${detalle}`)
  }

  return {
    url,

    async asegurarCubo() {
      const existe = await fetch(`${base}/bucket/${CUBO}`, { headers: cabeceras })
      if (existe.ok) {
        /*
         * Un cubo creado antes de la Fase 5 solo admite MP4, y el fotograma de
         * la vista previa es JPEG. Se actualiza; si falla, se sigue igual: sin
         * fotograma la vista previa enseña el video. Fase 8: tambien los
         * respaldos de la base (.json.gz).
         */
        await fetch(`${base}/bucket/${CUBO}`, {
          method: 'PUT',
          headers: { ...cabeceras, 'content-type': 'application/json' },
          body: JSON.stringify({
            id: CUBO,
            name: CUBO,
            public: false,
            file_size_limit: 25 * 1024 * 1024,
            allowed_mime_types: ['video/mp4', 'image/jpeg', 'application/gzip'],
          }),
        }).catch(() => undefined)
        return 'ya estaba'
      }

      /*
       * Un cubo que no existe responde 400, no 404.
       *
       * Medido contra el servicio real: `{"statusCode":"404","error":"Bucket
       * not found"}` dentro de una respuesta HTTP 400. El codigo de estado y el
       * del cuerpo no coinciden.
       *
       * Asi que se mira el MENSAJE y no el numero. Un 400 por cualquier otro
       * motivo (clave mal formada, nombre invalido) sigue siendo un error de
       * verdad y se lanza, en vez de intentar crear el cubo a ciegas y fallar
       * mas adelante con algo que no se parece a la causa.
       */
      const cuerpo = await existe.clone().text()
      const noExiste = /not found/i.test(cuerpo)
      if (!noExiste) await fallo(existe, 'Consultar el cubo')

      const res = await fetch(`${base}/bucket`, {
        method: 'POST',
        headers: { ...cabeceras, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: CUBO,
          name: CUBO,
          // Privado: las URLs se firman una a una y caducan. Un cubo publico
          // dejaria los clips sin publicar accesibles para siempre a quien
          // adivinara la ruta, y la ruta es el id del clip.
          public: false,
          file_size_limit: 25 * 1024 * 1024,
          // JPEG para el fotograma limpio de la vista previa (Fase 5).
          allowed_mime_types: ['video/mp4', 'image/jpeg', 'application/gzip'],
        }),
      })
      if (!res.ok) await fallo(res, 'Crear el cubo')
      return 'creado'
    },

    async subir(ruta, fichero, tipo = 'video/mp4') {
      const datos = await readFile(fichero)
      // POST con x-upsert en vez de PUT: PUT falla con 404 si el objeto no
      // existe todavia, asi que reintentar una subida a medias requeriria
      // saber si es la primera vez. Con upsert, subir es idempotente.
      const res = await fetch(`${base}/object/${CUBO}/${ruta}`, {
        method: 'POST',
        headers: {
          ...cabeceras,
          'content-type': tipo,
          'cache-control': 'max-age=3600',
          'x-upsert': 'true',
        },
        body: new Uint8Array(datos),
      })
      if (!res.ok) await fallo(res, `Subir ${ruta}`)
    },

    async firmar(ruta, segundos) {
      const res = await fetch(`${base}/object/sign/${CUBO}/${ruta}`, {
        method: 'POST',
        headers: { ...cabeceras, 'content-type': 'application/json' },
        body: JSON.stringify({ expiresIn: segundos }),
      })
      if (!res.ok) await fallo(res, `Firmar ${ruta}`)
      const { signedURL } = (await res.json()) as { signedURL: string }
      // Llega relativa ("/object/sign/..."), no absoluta.
      return `${base}${signedURL.replace(/^\/storage\/v1/, '')}`
    },

    async borrar(rutas) {
      if (rutas.length === 0) return
      const res = await fetch(`${base}/object/${CUBO}`, {
        method: 'DELETE',
        headers: { ...cabeceras, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: rutas }),
      })
      if (!res.ok) await fallo(res, 'Borrar copias')
    },
  }
}

/**
 * Deduce la URL del proyecto a partir de la cadena de conexion.
 *
 * El usuario de Postgres en Supabase es `postgres.<ref>` y el proyecto vive en
 * `https://<ref>.supabase.co`. Si algun dia cambia ese formato, se pone
 * SUPABASE_URL a mano y esta funcion deja de usarse; por eso devuelve null en
 * vez de adivinar.
 */
function urlDesdeBase(): string | null {
  const cadena = optionalEnv('DATABASE_URL')
  if (cadena === undefined) return null
  try {
    const usuario = new URL(cadena).username
    const ref = usuario.split('.')[1]
    if (ref === undefined || ref === '') return null
    return `https://${ref}.supabase.co`
  } catch {
    return null
  }
}

/** La ruta de un clip dentro del cubo. Un sitio, para que subir y firmar coincidan. */
export function rutaClip(ownerId: string, sourceId: string, clipId: string): string {
  return `${ownerId}/${sourceId}/${clipId}.mp4`
}
