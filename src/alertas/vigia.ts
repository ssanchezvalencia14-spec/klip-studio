/**
 * El vigilante de alertas (Fase 7).
 *
 * Corre en el PANEL, no en el procesador: si el que se cae es el procesador,
 * alguien de fuera tiene que darse cuenta. Cada minuto mira la base y avisa
 * de cinco cosas:
 *
 * 1. Una cuenta con el permiso de TikTok caducado o en error.
 * 2. La cola de publicaciones vacia: no queda nada programado.
 * 3. Publicaciones que fallaron.
 * 4. El procesador desconectado.
 * 5. La IA en el limite (o sin sesion).
 *
 * Cada alerta tiene un tipo y una clave (la cuenta, la hora del corte...) y
 * se guarda en la tabla `alertas`: la misma no se repite hasta que pasa su
 * espera. Sin eso, un procesador apagado una noche serian quinientos mensajes.
 *
 * `detectar` es pura para poder probarla sin base ni red.
 */
import type { Db } from '../store/db.js'
import { createLogger } from '../lib/logger.js'
import { iaPausada, type InfoIA } from '../llm/estado.js'
import { enviarAlerta, type ResultadoEnvio } from './canales.js'

const log = createLogger('alertas')

export type TipoAlerta = 'token' | 'cola' | 'publicacion' | 'procesador' | 'ia' | 'prueba'

export interface Alerta {
  tipo: TipoAlerta
  clave: string
  asunto: string
  texto: string
}

/** Lo que se mira de la base en cada vuelta. */
export interface Foto {
  ahora: Date
  trabajador: { vivo: boolean; vistoEn: string | null }
  ia: Pick<InfoIA, 'estado' | 'reanudarEn'>
  /** Cuentas activas o en error con el permiso caducado. */
  cuentasSinPermiso: { id: string; alias: string }[]
  cuentasActivas: number
  /** Publicaciones pendientes con fecha futura. */
  colaFutura: number
  /** Si alguna vez se publico o programo algo: un panel nuevo no avisa. */
  haPublicado: boolean
  /** Fallos definitivos de la ultima hora, el mas reciente primero. */
  fallos: { id: string; accountId: string; clipId: string; error: string }[]
}

/** Cuanto esperar para repetir la misma alerta (tipo + clave), en horas. */
export const ESPERA_HORAS: Record<TipoAlerta, number> = {
  token: 24,
  cola: 12,
  publicacion: 24,
  procesador: 24,
  ia: 24,
  prueba: 0,
}

/** El procesador cuenta como caido tras 3 minutos sin latido. */
const CAIDO_MS = 3 * 60_000

const nombre = (c: { id: string; alias: string }): string => (c.alias ? `${c.alias} (${c.id})` : c.id)

export function detectar(f: Foto): Alerta[] {
  const out: Alerta[] = []

  for (const c of f.cuentasSinPermiso) {
    out.push({
      tipo: 'token',
      clave: c.id,
      asunto: `la cuenta ${nombre(c)} no puede publicar`,
      texto:
        `El permiso de TikTok de ${nombre(c)} caducó o falló. ` +
        'Entra en Cuentas y pulsa Comprobar; si sigue igual, vuelve a enlazarla.',
    })
  }

  if (f.cuentasActivas > 0 && f.colaFutura === 0 && f.haPublicado) {
    out.push({
      tipo: 'cola',
      clave: 'cola',
      asunto: 'no quedan clips programados',
      texto:
        'La agenda está vacía: las cuentas no tienen nada que publicar. ' +
        'Aprueba clips en Revisar para que se repartan.',
    })
  }

  const ultimo = f.fallos[0]
  if (ultimo !== undefined) {
    const lineas = f.fallos.slice(0, 5).map((x) => `- ${x.accountId} / ${x.clipId}: ${x.error.split('\n')[0]}`)
    out.push({
      tipo: 'publicacion',
      clave: ultimo.id,
      asunto: f.fallos.length === 1 ? 'falló una publicación' : `fallaron ${f.fallos.length} publicaciones`,
      texto: `${lineas.join('\n')}\n\nLos detalles están en Agenda.`,
    })
  }

  if (!f.trabajador.vivo && f.trabajador.vistoEn !== null &&
      f.ahora.getTime() - new Date(f.trabajador.vistoEn).getTime() > CAIDO_MS) {
    out.push({
      tipo: 'procesador',
      clave: f.trabajador.vistoEn,
      asunto: 'el procesador está desconectado',
      texto:
        'El ordenador que procesa los videos no responde desde ' +
        `${new Date(f.trabajador.vistoEn).toLocaleString('es-ES')}. ` +
        'Lo que se añada espera hasta que vuelva. Comprueba que esté encendido y con el trabajador en marcha.',
    })
  }

  if (iaPausada(f.ia, f.ahora)) {
    out.push({
      tipo: 'ia',
      clave: f.ia.estado === 'limite' ? `limite:${f.ia.reanudarEn ?? 'sin-hora'}` : f.ia.estado,
      asunto: f.ia.estado === 'limite' ? 'la IA llegó al límite' : 'la IA no tiene sesión',
      texto:
        f.ia.estado === 'limite'
          ? 'La búsqueda de momentos espera a que vuelva la IA' +
            (f.ia.reanudarEn ? ` (hacia las ${new Date(f.ia.reanudarEn).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}).` : '.') +
            ' El resto sigue funcionando.'
          : 'Claude Code no tiene la sesión iniciada en el procesador. Entra con "claude" y escribe /login.',
    })
  }

  return out
}

/** Lee de la base todo lo que necesita `detectar`. */
export async function fotografiar(db: Db, ownerId: string, ahora = new Date()): Promise<Foto> {
  const [trab, ia, sinPermiso, activas, futura, alguna, fallos] = await Promise.all([
    db.query<{ visto_en: string; vivo: boolean }>(
      `select visto_en, (visto_en > now() - interval '90 seconds') as vivo
         from trabajadores where owner_id = $1 order by visto_en desc limit 1`,
      [ownerId],
    ),
    db.query<{ estado: string; reanudar_en: string | null }>(
      `select estado, reanudar_en from ia_estado where owner_id = $1`,
      [ownerId],
    ),
    db.query<{ id: string; alias: string | null }>(
      `select id, alias from accounts
        where owner_id = $1 and (token_status = 'expired' or status = 'error')
        order by id`,
      [ownerId],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from accounts where owner_id = $1 and status = 'active'`,
      [ownerId],
    ),
    db.query<{ n: number }>(
      `select count(*)::int as n from queue where owner_id = $1 and status = 'pending' and scheduled_at > now()`,
      [ownerId],
    ),
    db.query<{ n: number }>(`select count(*)::int as n from queue where owner_id = $1`, [ownerId]),
    db.query<{ id: string; account_id: string; clip_id: string; last_error: string | null }>(
      `select id, account_id, clip_id, last_error from queue
        where owner_id = $1 and status = 'failed' and updated_at > now() - interval '1 hour'
        order by updated_at desc limit 20`,
      [ownerId],
    ),
  ])
  const t = trab[0]
  const i = ia[0]
  return {
    ahora,
    trabajador: { vivo: Boolean(t?.vivo), vistoEn: t ? new Date(t.visto_en).toISOString() : null },
    ia: {
      estado: (i?.estado ?? 'desconocido') as InfoIA['estado'],
      reanudarEn: i?.reanudar_en ? new Date(i.reanudar_en).toISOString() : null,
    },
    cuentasSinPermiso: sinPermiso.map((c) => ({ id: c.id, alias: c.alias ?? '' })),
    cuentasActivas: Number(activas[0]?.n ?? 0),
    colaFutura: Number(futura[0]?.n ?? 0),
    haPublicado: Number(alguna[0]?.n ?? 0) > 0,
    fallos: fallos.map((x) => ({ id: x.id, accountId: x.account_id, clipId: x.clip_id, error: x.last_error ?? '' })),
  }
}

export interface Enviada extends Alerta {
  resultados: ResultadoEnvio[]
}

/**
 * Una vuelta: detecta, quita las ya avisadas hace poco, envia y anota.
 *
 * Se anota aunque no haya ningun canal configurado: asi el panel enseña el
 * historial y quien configure Telegram luego no recibe de golpe lo de ayer.
 */
export async function revisarAlertas(
  db: Db,
  ownerId: string,
  enviar: typeof enviarAlerta = enviarAlerta,
  ahora = new Date(),
): Promise<Enviada[]> {
  const conf = await db.query<{ alertas_activas: boolean | null }>(
    `select alertas_activas from settings where owner_id = $1`,
    [ownerId],
  )
  if (conf[0]?.alertas_activas === false) return []

  const candidatas = detectar(await fotografiar(db, ownerId, ahora))
  const enviadas: Enviada[] = []
  for (const a of candidatas) {
    const previa = await db.query<{ enviada_en: string }>(
      `select enviada_en from alertas where owner_id = $1 and tipo = $2 and clave = $3`,
      [ownerId, a.tipo, a.clave],
    )
    const p = previa[0]
    if (p && ahora.getTime() - new Date(p.enviada_en).getTime() < ESPERA_HORAS[a.tipo] * 3_600_000) continue
    const resultados = await enviar(a.asunto, a.texto)
    await anotar(db, ownerId, a, resultados, ahora)
    enviadas.push({ ...a, resultados })
  }
  return enviadas
}

async function anotar(db: Db, ownerId: string, a: Alerta, resultados: ResultadoEnvio[], ahora: Date): Promise<void> {
  const canales = resultados.filter((r) => r.ok).map((r) => r.canal).join(',')
  await db.query(
    `insert into alertas (owner_id, tipo, clave, texto, enviada_en, canales)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (owner_id, tipo, clave) do update set
       texto = excluded.texto, enviada_en = excluded.enviada_en, canales = excluded.canales`,
    [ownerId, a.tipo, a.clave, `${a.asunto}. ${a.texto}`.slice(0, 1000), ahora.toISOString(), canales],
  )
}

/** El boton "Enviar una prueba" de Ajustes > Sistema. */
export async function probarAlertas(
  db: Db,
  ownerId: string,
  enviar: typeof enviarAlerta = enviarAlerta,
): Promise<ResultadoEnvio[]> {
  const a: Alerta = {
    tipo: 'prueba',
    clave: 'prueba',
    asunto: 'alerta de prueba',
    texto: 'Si lees esto, las alertas de KLIP studio llegan bien.',
  }
  const resultados = await enviar(a.asunto, a.texto)
  await anotar(db, ownerId, a, resultados, new Date())
  return resultados
}

/** Las ultimas alertas, para el panel. */
export async function ultimasAlertas(db: Db, ownerId: string): Promise<{ tipo: string; texto: string; enviadaEn: string; canales: string }[]> {
  const filas = await db.query<{ tipo: string; texto: string; enviada_en: string; canales: string }>(
    `select tipo, texto, enviada_en, canales from alertas where owner_id = $1 order by enviada_en desc limit 10`,
    [ownerId],
  )
  return filas.map((f) => ({ tipo: f.tipo, texto: f.texto, enviadaEn: new Date(f.enviada_en).toISOString(), canales: f.canales }))
}

/** Arranca la vuelta de cada minuto. Devuelve la funcion para pararla. */
export function iniciarVigia(db: Db, ownerId: string, cadaMs = 60_000): () => void {
  let enCurso = false
  const vuelta = async (): Promise<void> => {
    if (enCurso) return
    enCurso = true
    try {
      const enviadas = await revisarAlertas(db, ownerId)
      for (const e of enviadas) {
        const ok = e.resultados.filter((r) => r.ok).map((r) => r.canal)
        log.info(`alerta ${e.tipo}: ${e.asunto}${ok.length ? ` (por ${ok.join(' y ')})` : ' (sin destino configurado)'}`)
      }
    } catch (error) {
      // Una base sin la migracion 024 todavia, o caida un momento: no es
      // motivo para tumbar el panel.
      log.warn(`No se pudieron revisar las alertas: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    } finally {
      enCurso = false
    }
  }
  const timer = setInterval(() => void vuelta(), cadaMs)
  timer.unref()
  return () => clearInterval(timer)
}
