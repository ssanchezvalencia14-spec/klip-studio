import { createLogger } from '../lib/logger.js'
import type { Db } from '../store/db.js'
import type { Cola } from './cola.js'

const log = createLogger('reparto')

/**
 * El eslabon que faltaba despues de la compuerta.
 *
 * La cadena automatica llega hasta subir los clips para revisarlos y ahi para,
 * a proposito: aprobar es la unica decision humana del programa. Pero DESPUES
 * de aprobar tambien paraba, y eso no era una decision, era un hueco. Quien
 * revisaba desde el movil terminaba con un monton de clips aprobados que no
 * salian a ninguna parte hasta que alguien abria una terminal y escribia
 * `npm run variants` y `npm run schedule`.
 *
 * Esto cierra el hueco: en cuanto un VOD no tiene nada pendiente de revisar, se
 * reparte solo.
 *
 * CUANDO SE DISPARA: cuando el VOD se queda con CERO clips pendientes. No a los
 * dos minutos de la ultima aprobacion ni despues de N clips. Se eligio asi
 * porque es la unica condicion que el usuario puede ver en la pantalla: la
 * bandeja de ese video se vacia y el reparto arranca. Un temporizador seria
 * invisible y pareceria que arranca solo cuando le da la gana.
 *
 * Quien deja clips a medias no dispara nada, y eso es correcto: todavia esta
 * decidiendo. Para ese caso el panel ofrece el boton de repartir a mano.
 */

/** Los pasos que llevan un clip aprobado hasta la cola de publicacion. */
export const PASOS_REPARTO = ['variants', 'schedule'] as const

export interface Reparto {
  /** Lo que se hizo, para poder contarlo en el panel. */
  encolado: boolean
  /** Por que no se hizo, cuando no se hizo. */
  motivo: 'quedan-pendientes' | 'nada-aprobado' | 'ya-en-marcha' | null
  aprobados: number
}

/**
 * Mira si toca repartir ese VOD y, si toca, lo encola.
 *
 * Devuelve el motivo en vez de un simple booleano porque el panel lo enseña:
 * "quedan 3 por revisar" es una respuesta util, "no" no lo es.
 */
export async function repartirSiToca(
  db: Db,
  cola: Cola,
  ownerId: string,
  sourceId: string,
): Promise<Reparto> {
  const filas = await db.query<{ status: string; n: string }>(
    `select status, count(*)::text n from clips
      where owner_id = $1 and source_id = $2 group by status`,
    [ownerId, sourceId],
  )

  const cuenta = (s: string): number => Number(filas.find((f) => f.status === s)?.n ?? '0')
  const pendientes = cuenta('pending')
  const aprobados = cuenta('approved')

  if (pendientes > 0) return { encolado: false, motivo: 'quedan-pendientes', aprobados }

  /*
   * Un VOD con todo descartado no es un error, es una decision.
   *
   * Hasta ahora encolaba las variantes igualmente y el trabajo moria con
   * "Importa los clips a la compuerta: npm run review", que ademas de mandar a
   * una terminal decia algo falso: los clips SI estaban importados, lo que
   * pasaba es que estaban todos descartados. Se vio el 2026-10-05 con
   * kick-cuenta-ejemplo, que reintento cinco veces algo que no podia salir bien.
   */
  if (aprobados === 0) return { encolado: false, motivo: 'nada-aprobado', aprobados }

  if (await cola.hayActiva(PASOS_REPARTO, sourceId)) {
    return { encolado: false, motivo: 'ya-en-marcha', aprobados }
  }

  await cola.encolar('variants', [sourceId], `Preparar copias por cuenta de ${sourceId}`)
  log.info(`${sourceId}: ${aprobados} aprobado(s) y nada pendiente, se reparte solo`)
  return { encolado: true, motivo: null, aprobados }
}
