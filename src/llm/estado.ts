import type { Db } from '../store/db.js'
import { horaCorta } from './errores.js'

/**
 * El estado de la IA, compartido entre el trabajador y el panel.
 *
 * Vive en la tabla `ia_estado` porque el panel (en Hostinger) y la IA (en el
 * PC) no comparten nada mas que la base. El trabajador lo escribe al terminar
 * cada tarea de IA; el panel lo lee para decir "IA lista" o "IA con limite".
 */

/** Linea que imprime una tarea cuando la IA no esta disponible. */
export const MARCA_ESPERA_IA = '[klip-ia-espera]'
/** Linea que imprime "Probar IA" o una seleccion que funciono. */
export const MARCA_ESTADO_IA = '[klip-ia-estado]'
/** Codigo de salida de una tarea que espera a la IA (EX_TEMPFAIL). */
export const SALIDA_ESPERA_IA = 75

/** Tareas que necesitan la IA y que se pausan con ella. "Probar IA" no: es como se sabe que volvio. */
export const KINDS_DE_IA = ['select'] as const

export type EstadoIA =
  | 'lista' | 'limite' | 'sin_sesion' | 'no_encontrado' | 'tiempo' | 'error' | 'desconocido'

export interface InfoIA {
  estado: EstadoIA
  mensaje: string
  reanudarEn: string | null
  proveedor: string
  modelo: string
  comprobadoEn: string | null
}

export interface MarcaIA {
  estado: EstadoIA
  mensaje?: string
  reanudarEn?: string
  proveedor?: string
  modelo?: string
}

const ESTADOS: readonly EstadoIA[] = ['lista', 'limite', 'sin_sesion', 'no_encontrado', 'tiempo', 'error', 'desconocido']

/** Busca la ultima marca de estado en la salida de una tarea. */
export function leerMarca(lineas: readonly string[]): { espera: boolean; marca: MarcaIA } | null {
  for (let i = lineas.length - 1; i >= 0; i -= 1) {
    const l = lineas[i] ?? ''
    for (const [prefijo, espera] of [[MARCA_ESPERA_IA, true], [MARCA_ESTADO_IA, false]] as const) {
      const at = l.indexOf(prefijo)
      if (at === -1) continue
      try {
        const m = JSON.parse(l.slice(at + prefijo.length).trim()) as MarcaIA
        if (ESTADOS.includes(m.estado)) return { espera, marca: m }
      } catch {
        // Una marca rota no dice nada; se sigue buscando.
      }
    }
  }
  return null
}

/** Lo que la pantalla dice de la IA, en una frase. */
export function textoEstadoIA(info: Pick<InfoIA, 'estado' | 'reanudarEn'>): string {
  switch (info.estado) {
    case 'lista':
      return 'IA lista'
    case 'limite':
      return info.reanudarEn === null
        ? 'IA con límite de uso'
        : `IA con límite, vuelve a las ${horaCorta(new Date(info.reanudarEn))}`
    case 'sin_sesion':
      return 'IA sin sesión (abre Claude Code en tu PC y ejecuta /login)'
    case 'no_encontrado':
      return 'Claude Code no está instalado en el PC que procesa'
    case 'tiempo':
      return 'La IA tardó demasiado en la última prueba'
    case 'error':
      return 'La IA falló en la última prueba'
    case 'desconocido':
      return 'IA sin comprobar'
  }
}

/** Pausada: no se cogen tareas de IA. */
export function iaPausada(info: Pick<InfoIA, 'estado' | 'reanudarEn'>, ahora = new Date()): boolean {
  if (info.estado === 'sin_sesion' || info.estado === 'no_encontrado') return true
  if (info.estado === 'limite') {
    return info.reanudarEn === null || new Date(info.reanudarEn).getTime() > ahora.getTime()
  }
  return false
}

function aInfo(f: Record<string, unknown> | undefined): InfoIA {
  if (f === undefined) {
    return { estado: 'desconocido', mensaje: '', reanudarEn: null, proveedor: '', modelo: '', comprobadoEn: null }
  }
  return {
    estado: f.estado as EstadoIA,
    mensaje: String(f.mensaje ?? ''),
    reanudarEn: f.reanudar_en === null || f.reanudar_en === undefined ? null : new Date(f.reanudar_en as string).toISOString(),
    proveedor: String(f.proveedor ?? ''),
    modelo: String(f.modelo ?? ''),
    comprobadoEn: f.comprobado_en === null || f.comprobado_en === undefined ? null : new Date(f.comprobado_en as string).toISOString(),
  }
}

export function createEstadoIA(db: Db, ownerId: string) {
  return {
    async leer(): Promise<InfoIA> {
      const filas = await db.query(`select * from ia_estado where owner_id = $1`, [ownerId])
      return aInfo(filas[0])
    },

    async guardar(m: MarcaIA): Promise<void> {
      await db.query(
        `insert into ia_estado (owner_id, estado, mensaje, reanudar_en, proveedor, modelo, comprobado_en)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (owner_id) do update set
           estado = excluded.estado, mensaje = excluded.mensaje, reanudar_en = excluded.reanudar_en,
           proveedor = case when excluded.proveedor = '' then ia_estado.proveedor else excluded.proveedor end,
           modelo = case when excluded.modelo = '' then ia_estado.modelo else excluded.modelo end,
           comprobado_en = now()`,
        [ownerId, m.estado, (m.mensaje ?? '').slice(0, 300), m.reanudarEn ?? null, m.proveedor ?? '', m.modelo ?? ''],
      )
    },

    /**
     * Vuelve a encolar lo que esperaba a la IA.
     *
     * Sin `forzar`, solo si la hora de vuelta ya paso: es lo que hace el
     * trabajador en cada vuelta. Con `forzar` es el boton "Reintentar". En los
     * dos casos se olvida el estado de pausa; si la IA sigue sin estar, la
     * primera tarea lo volvera a decir, una sola vez.
     */
    async reanudar(forzar = false): Promise<number> {
      // Sin forzar, basta con que la IA no este pausada: la hora de vuelta paso,
      // o "Probar IA" la encontro lista.
      const info = await this.leer()
      if (!forzar && iaPausada(info)) return 0
      if (forzar || info.estado === 'limite') {
        await db.query(
          `update ia_estado set estado = 'desconocido', mensaje = '', reanudar_en = null where owner_id = $1`,
          [ownerId],
        )
      }
      const filas = await db.query(
        `update jobs set status = 'queued', claimed_by = null
         where owner_id = $1 and status = 'en_espera_ia' returning id`,
        [ownerId],
      )
      return filas.length
    },
  }
}

export type EstadoIAStore = ReturnType<typeof createEstadoIA>
