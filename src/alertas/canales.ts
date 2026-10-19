/**
 * Por donde salen las alertas: Telegram y correo (Fase 7).
 *
 * Los dos por HTTP con fetch, sin dependencias nuevas. Las claves viven SOLO
 * en el .env y no se escriben nunca en el registro: un error de Telegram trae
 * la URL con el token dentro, asi que lo que se cuenta es el codigo de estado,
 * no el mensaje crudo.
 *
 *   TELEGRAM_BOT_TOKEN   el token de @BotFather
 *   TELEGRAM_CHAT_ID     a quien escribe el bot (tu chat o un grupo)
 *
 *   RESEND_API_KEY       clave de resend.com (el correo sale por su API)
 *   ALERTAS_CORREO_PARA  a quien llega
 *   ALERTAS_CORREO_DE    remitente verificado en Resend (opcional)
 */
import { optionalEnv } from '../lib/env.js'

export type Canal = 'telegram' | 'correo'

export interface CanalesConfigurados {
  telegram: boolean
  correo: boolean
}

export function canalesConfigurados(): CanalesConfigurados {
  return {
    telegram: optionalEnv('TELEGRAM_BOT_TOKEN') !== undefined && optionalEnv('TELEGRAM_CHAT_ID') !== undefined,
    correo: optionalEnv('RESEND_API_KEY') !== undefined && optionalEnv('ALERTAS_CORREO_PARA') !== undefined,
  }
}

export interface ResultadoEnvio {
  canal: Canal
  ok: boolean
  /** Frase para la pantalla, sin claves ni rutas. */
  detalle: string
}

/** Lo que se inyecta en las pruebas en lugar de la red. */
export type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>

const ESPERA_MS = 10_000

async function conTiempo(f: Fetch, url: string, init: RequestInit): Promise<{ ok: boolean; status: number }> {
  const corte = new AbortController()
  const t = setTimeout(() => corte.abort(), ESPERA_MS)
  try {
    return await f(url, { ...init, signal: corte.signal })
  } finally {
    clearTimeout(t)
  }
}

async function telegram(texto: string, f: Fetch): Promise<ResultadoEnvio> {
  const token = optionalEnv('TELEGRAM_BOT_TOKEN') ?? ''
  const chat = optionalEnv('TELEGRAM_CHAT_ID') ?? ''
  try {
    const r = await conTiempo(f, `https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
    })
    return r.ok
      ? { canal: 'telegram', ok: true, detalle: 'Enviada por Telegram.' }
      : {
          canal: 'telegram',
          ok: false,
          detalle:
            r.status === 401 || r.status === 404
              ? 'Telegram rechazó el token del bot. Revisa TELEGRAM_BOT_TOKEN.'
              : r.status === 400 || r.status === 403
                ? 'Telegram no puede escribir a ese chat. Escribe primero al bot o revisa TELEGRAM_CHAT_ID.'
                : `Telegram respondió con un error (${r.status}).`,
        }
  } catch {
    return { canal: 'telegram', ok: false, detalle: 'No se pudo llegar a Telegram (sin conexión o tardó demasiado).' }
  }
}

async function correo(asunto: string, texto: string, f: Fetch): Promise<ResultadoEnvio> {
  try {
    const r = await conTiempo(f, 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${optionalEnv('RESEND_API_KEY') ?? ''}`,
      },
      body: JSON.stringify({
        from: optionalEnv('ALERTAS_CORREO_DE') ?? 'KLIP studio <onboarding@resend.dev>',
        to: (optionalEnv('ALERTAS_CORREO_PARA') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
        subject: asunto,
        text: texto,
      }),
    })
    return r.ok
      ? { canal: 'correo', ok: true, detalle: 'Enviada por correo.' }
      : {
          canal: 'correo',
          ok: false,
          detalle:
            r.status === 401 || r.status === 403
              ? 'El servicio de correo rechazó la clave. Revisa RESEND_API_KEY y el remitente.'
              : `El servicio de correo respondió con un error (${r.status}).`,
        }
  } catch {
    return { canal: 'correo', ok: false, detalle: 'No se pudo llegar al servicio de correo.' }
  }
}

/** Manda el texto por todos los canales configurados. Nunca lanza. */
export async function enviarAlerta(asunto: string, texto: string, f: Fetch = fetch): Promise<ResultadoEnvio[]> {
  const conf = canalesConfigurados()
  const envios: Promise<ResultadoEnvio>[] = []
  if (conf.telegram) envios.push(telegram(`KLIP studio: ${asunto}\n\n${texto}`, f))
  if (conf.correo) envios.push(correo(`KLIP studio: ${asunto}`, texto, f))
  return Promise.all(envios)
}
