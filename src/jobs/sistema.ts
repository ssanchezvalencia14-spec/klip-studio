import { existsSync, rmSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { bin, paths } from '../lib/env.js'
import { createLogger } from '../lib/logger.js'
import { run } from '../lib/proc.js'
import { limpiarRutas } from '../lib/limpiar.js'
import type { Db } from '../store/db.js'
import { respaldar } from '../store/respaldo.js'
import { crearNube } from '../store/nube.js'

const log = createLogger('sistema')

/**
 * Lo que el trabajador cuida del PC, ademas de las tareas.
 *
 * - yt-dlp al dia: una version de mas de unas semanas falla con errores que
 *   parecen de permisos (CONTEXT.md, 6c). Se comprueba una vez por semana.
 * - El disco: un render a medias por falta de sitio es el peor fallo posible,
 *   asi que se avisa al pasar del 80 %.
 * - La retencion: el video original pesa gigas y, una vez revisado entero, ya
 *   no hace falta. Se borra pasados N dias si se pidio en Ajustes.
 *
 * El resultado se guarda en `estado_sistema` para que el panel lo enseñe.
 */

export const NAVEGADORES_COOKIES = ['', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'] as const
export const UMBRAL_DISCO = 0.8
const SEMANA_MS = 7 * 86_400_000
/** yt-dlp con mas de esto se considera viejo. */
const DIAS_YTDLP_VIEJO = 30

export interface AjustesProcesador {
  ytdlpCookies: string
  retencionDias: number
}

export function createSistema(db: Db, ownerId: string) {
  async function guardar(clave: string, valor: unknown): Promise<void> {
    await db.query(
      `insert into estado_sistema (owner_id, clave, valor, actualizado_en) values ($1, $2, $3, now())
       on conflict (owner_id, clave) do update set valor = excluded.valor, actualizado_en = now()`,
      [ownerId, clave, JSON.stringify(valor)],
    )
  }

  return {
    async ajustes(): Promise<AjustesProcesador> {
      const filas = await db.query<{ ytdlp_cookies: string; retencion_dias: number }>(
        `select ytdlp_cookies, retencion_dias from settings where owner_id = $1`,
        [ownerId],
      )
      const f = filas[0]
      return { ytdlpCookies: f?.ytdlp_cookies ?? '', retencionDias: Number(f?.retencion_dias ?? 0) }
    },

    async guardarAjustes(a: Partial<AjustesProcesador>): Promise<AjustesProcesador> {
      if (a.ytdlpCookies !== undefined && !(NAVEGADORES_COOKIES as readonly string[]).includes(a.ytdlpCookies)) {
        throw new Error('Ese navegador no se puede usar.')
      }
      if (a.retencionDias !== undefined && (!Number.isInteger(a.retencionDias) || a.retencionDias < 0 || a.retencionDias > 365)) {
        throw new Error('Los días tienen que estar entre 0 y 365.')
      }
      await db.query(`insert into settings (owner_id) values ($1) on conflict (owner_id) do nothing`, [ownerId])
      await db.query(
        `update settings set
           ytdlp_cookies = coalesce($2, ytdlp_cookies),
           retencion_dias = coalesce($3, retencion_dias),
           updated_at = now()
         where owner_id = $1`,
        [ownerId, a.ytdlpCookies ?? null, a.retencionDias ?? null],
      )
      return this.ajustes()
    },

    async estado(): Promise<Record<string, { valor: unknown; actualizadoEn: string }>> {
      const filas = await db.query<{ clave: string; valor: unknown; actualizado_en: string }>(
        `select clave, valor, actualizado_en from estado_sistema where owner_id = $1`,
        [ownerId],
      )
      return Object.fromEntries(filas.map((f) => [
        f.clave,
        { valor: typeof f.valor === 'string' ? JSON.parse(f.valor) : f.valor, actualizadoEn: new Date(f.actualizado_en).toISOString() },
      ]))
    },

    async debeHacerse(clave: string, cadaMs: number): Promise<boolean> {
      const filas = await db.query<{ actualizado_en: string }>(
        `select actualizado_en from estado_sistema where owner_id = $1 and clave = $2`,
        [ownerId, clave],
      )
      const f = filas[0]
      return f === undefined || Date.now() - new Date(f.actualizado_en).getTime() >= cadaMs
    },

    guardar,

    /**
     * yt-dlp: version, edad y, si es vieja, intento de actualizarlo.
     *
     * `yt-dlp -U` funciona con el ejecutable suelto. Instalado por winget
     * responde que se actualice por winget; eso se guarda tal cual para que
     * se vea en Sistema, sin tocar nada mas.
     */
    async comprobarYtdlp(): Promise<void> {
      let version = ''
      try {
        version = (await run(bin.ytdlp, ['--version'], { timeoutMs: 30_000 })).stdout.trim()
      } catch (e) {
        await guardar('ytdlp', { ok: false, mensaje: 'No se encontró yt-dlp en el procesador.' })
        log.warn(`yt-dlp no responde: ${limpiarRutas(e instanceof Error ? e.message : String(e))}`)
        return
      }
      const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version)
      const fecha = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
      const dias = fecha ? Math.floor((Date.now() - fecha.getTime()) / 86_400_000) : null
      let actualizacion = ''
      if (dias !== null && dias > DIAS_YTDLP_VIEJO) {
        try {
          const r = await run(bin.ytdlp, ['-U'], { timeoutMs: 120_000 })
          actualizacion = limpiarRutas(`${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-1)[0] ?? '')
        } catch (e) {
          actualizacion = limpiarRutas((e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '')
        }
      }
      await guardar('ytdlp', {
        ok: dias === null || dias <= DIAS_YTDLP_VIEJO,
        version,
        dias,
        ...(actualizacion ? { actualizacion } : {}),
      })
    },

    /** Espacio en el disco donde estan los videos. */
    async comprobarDisco(): Promise<{ usado: number } | null> {
      try {
        const s = statfsSync(paths.work)
        const total = s.blocks * s.bsize
        const libre = s.bavail * s.bsize
        const usado = total > 0 ? 1 - libre / total : 0
        await guardar('disco', { usado, libreGb: Math.round((libre / 1e9) * 10) / 10, totalGb: Math.round((total / 1e9) * 10) / 10 })
        return { usado }
      } catch {
        return null
      }
    },

    /**
     * Borra el video original (y su audio) de los videos ya revisados enteros
     * hace mas de N dias, y los clips descartados. La transcripcion, los
     * momentos y los clips aprobados se quedan: son pequeños y hacen falta.
     */
    async aplicarRetencion(dias: number): Promise<{ videos: number; clips: number; mb: number }> {
      if (dias <= 0) return { videos: 0, clips: 0, mb: 0 }
      const fuentes = await db.query<{ id: string }>(
        `select s.id from sources s
          where s.owner_id = $1 and s.created_at < now() - make_interval(days => $2)
            and not exists (select 1 from clips c where c.owner_id = s.owner_id and c.source_id = s.id and c.status = 'pending')`,
        [ownerId, dias],
      )
      let videos = 0
      let bytes = 0
      for (const { id } of fuentes) {
        let tocado = false
        for (const nombre of ['source.mp4', 'source.mkv', 'source.webm', 'audio.wav']) {
          const ruta = join(paths.work, id, nombre)
          if (!existsSync(ruta)) continue
          bytes += statSync(ruta).size
          rmSync(ruta, { force: true })
          tocado = true
        }
        if (tocado) videos += 1
      }
      const descartados = await db.query<{ master_path: string }>(
        `select master_path from clips c join sources s on s.id = c.source_id and s.owner_id = c.owner_id
          where c.owner_id = $1 and c.status = 'rejected' and c.master_path <> ''
            and s.created_at < now() - make_interval(days => $2)`,
        [ownerId, dias],
      )
      let clips = 0
      for (const { master_path: ruta } of descartados) {
        if (!existsSync(ruta)) continue
        bytes += statSync(ruta).size
        rmSync(ruta, { force: true })
        clips += 1
      }
      const mb = Math.round(bytes / 1_048_576)
      await guardar('retencion', { videos, clips, mb, dias })
      if (videos + clips > 0) log.info(`Retención: ${videos} video(s) y ${clips} clip(s) borrados, ${mb} MB liberados.`)
      return { videos, clips, mb }
    },

    /**
     * Respaldo diario de la base (Fase 8). Copia local y, si hay Supabase
     * Storage, otra en el cubo privado.
     */
    async respaldoDiario(): Promise<void> {
      const r = await respaldar(db)
      let enNube = false
      const nube = crearNube()
      if (nube !== null) {
        try {
          // Un cubo creado antes de la Fase 8 no admite .gz: se pone al dia antes.
          await nube.asegurarCubo()
          await nube.subir(`respaldos/${r.nombre}`, r.fichero, 'application/gzip')
          enNube = true
        } catch (e) {
          log.warn(`No se pudo subir el respaldo a la nube: ${limpiarRutas(e instanceof Error ? e.message : String(e))}`)
        }
      }
      await guardar('respaldo', { nombre: r.nombre, tablas: r.tablas, filas: r.filas, kb: r.kb, nube: enNube })
      log.info(`Respaldo ${r.nombre}: ${r.filas} filas, ${r.kb} KB${enNube ? ', copia en la nube' : ''}.`)
    },

    /** Lo que el trabajador hace de vez en cuando, cada cosa a su ritmo. */
    async mantenimiento(): Promise<void> {
      try {
        if (await this.debeHacerse('respaldo', 86_400_000)) await this.respaldoDiario()
        if (await this.debeHacerse('ytdlp', SEMANA_MS)) await this.comprobarYtdlp()
        if (await this.debeHacerse('disco', 30 * 60_000)) await this.comprobarDisco()
        if (await this.debeHacerse('retencion', 86_400_000)) {
          const { retencionDias } = await this.ajustes()
          if (retencionDias > 0) await this.aplicarRetencion(retencionDias)
          else await guardar('retencion', { videos: 0, clips: 0, mb: 0, dias: 0 })
        }
      } catch (e) {
        log.error('Fallo en el mantenimiento del procesador', e)
      }
    },
  }
}

export type Sistema = ReturnType<typeof createSistema>
