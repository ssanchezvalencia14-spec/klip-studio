import { randomUUID } from 'node:crypto'
import type { Db as DbLike } from '../store/db.js'
import {
  ajustesDeFila,
  COLUMNAS,
  InvalidClipSettings,
  validateClipSettings,
  type ClipSettings,
} from './ajustes.js'

/**
 * Juegos de ajustes con nombre.
 *
 * Existen porque distinto material quiere cortes distintos: un directo de juego
 * pide clips de 20 s con subtitulos grandes, un podcast pide 90 s y mas texto
 * por linea. Cambiar las ocho perillas a mano cada vez que se alterna es donde
 * se cometen los errores, y ademas no deja volver atras.
 *
 * Una plantilla guarda una COPIA de los valores. Aplicarla y luego retocar algo
 * no la modifica: si fuera una referencia, "volver a lo de antes" desapareceria
 * en cuanto tocas un desplegable.
 */
export interface Plantilla extends ClipSettings {
  id: string
  nombre: string
  createdAt: string
}

export class InvalidPlantilla extends Error {}

/**
 * El nombre lo escribe una persona, asi que hay que acotarlo.
 *
 * Se recorta y se limita a 40 caracteres porque es lo que cabe en una pastilla
 * sin partirse. No se filtran caracteres: el nombre solo se escribe en la
 * pagina, y todo lo que se pinta pasa por esc(). Filtrar aqui ademas impediria
 * llamar a una plantilla "podcast (2 camaras)".
 */
function requireNombre(value: unknown): string {
  if (typeof value !== 'string') throw new InvalidPlantilla('Falta el nombre.')
  const limpio = value.trim()
  if (limpio === '') throw new InvalidPlantilla('La plantilla necesita un nombre.')
  if (limpio.length > 40) throw new InvalidPlantilla('El nombre no puede pasar de 40 caracteres.')
  return limpio
}

const CAMPOS = Object.keys(COLUMNAS) as (keyof ClipSettings)[]

export async function listarPlantillas(db: DbLike, ownerId: string): Promise<Plantilla[]> {
  const filas = await db.query<Record<string, unknown>>(
    `select * from plantillas where owner_id = $1 order by created_at`,
    [ownerId],
  )
  return filas.map((f) => ({
    id: f.id as string,
    nombre: f.nombre as string,
    createdAt: new Date(f.created_at as string).toISOString(),
    ...ajustesDeFila(f),
  }))
}

/**
 * Guarda unos ajustes con nombre.
 *
 * Guardar con un nombre que ya existe SOBRESCRIBE. Dos plantillas con el mismo
 * nombre son indistinguibles en la lista y la segunda solo sirve para elegir la
 * equivocada; el indice unico de la migracion 005 lo garantiza y aqui se
 * convierte en lo que espera cualquiera al repetir un nombre.
 */
export async function guardarPlantilla(
  db: DbLike,
  ownerId: string,
  nombre: unknown,
  ajustes: ClipSettings,
): Promise<Plantilla> {
  const limpio = requireNombre(nombre)

  // Se validan aunque vengan de `settings`, donde ya pasaron por aqui: esta
  // funcion tambien la puede llamar cualquiera con un cuerpo a medida.
  const valores = validateClipSettings(ajustes)

  const columnas = CAMPOS.map((k) => COLUMNAS[k])
  const id = randomUUID()

  const filas = await db.query<Record<string, unknown>>(
    `insert into plantillas (id, owner_id, nombre, ${columnas.join(', ')})
     values ($1, $2, $3, ${columnas.map((_, i) => `$${i + 4}`).join(', ')})
     on conflict (owner_id, nombre) do update set
       ${columnas.map((c) => `${c} = excluded.${c}`).join(', ')}
     returning *`,
    [id, ownerId, limpio, ...CAMPOS.map((k) => valores[k])],
  )

  const fila = filas[0]
  if (fila === undefined) throw new InvalidPlantilla('No se pudo guardar la plantilla.')

  return {
    id: fila.id as string,
    nombre: fila.nombre as string,
    createdAt: new Date(fila.created_at as string).toISOString(),
    ...ajustesDeFila(fila),
  }
}

/** Los ajustes de una plantilla, para volcarlos sobre los actuales. */
export async function leerPlantilla(
  db: DbLike,
  ownerId: string,
  id: string,
): Promise<ClipSettings> {
  const filas = await db.query<Record<string, unknown>>(
    `select * from plantillas where owner_id = $1 and id = $2`,
    [ownerId, id],
  )
  const fila = filas[0]
  if (fila === undefined) throw new InvalidPlantilla('Esa plantilla ya no existe.')

  /*
   * Se revalida al leer.
   *
   * Una plantilla guardada hace meses puede quedar fuera de rango si algun
   * limite se estrecha. Aplicarla sin comprobar metería un valor invalido en
   * `settings`, y el fallo saldria mucho despues, en la linea de comando del
   * trabajador, sin nada que lo relacione con haber pulsado una pastilla.
   */
  try {
    return validateClipSettings(ajustesDeFila(fila))
  } catch (error) {
    if (error instanceof InvalidClipSettings) {
      throw new InvalidPlantilla(
        `La plantilla "${String(fila.nombre)}" tiene un valor que ya no se admite: ${error.message}`,
      )
    }
    throw error
  }
}

/** Devuelve false si no habia nada que borrar, para poder responder 404. */
export async function borrarPlantilla(
  db: DbLike,
  ownerId: string,
  id: string,
): Promise<boolean> {
  const filas = await db.query(
    `delete from plantillas where owner_id = $1 and id = $2 returning id`,
    [ownerId, id],
  )
  return filas.length > 0
}
