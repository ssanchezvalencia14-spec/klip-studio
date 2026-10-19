/**
 * Estado de cada pieza del sistema, en una pantalla.
 *
 *   npm run check-health
 *
 * No sustituye a `npm run doctor`, que entra en detalle (filtros de ffmpeg,
 * NVENC, modelos, GPU). Esto contesta una sola pregunta por pieza: funciona o
 * no, y que hacer si no. Lo puede leer quien no conoce el codigo.
 *
 * NO IMPRIME RUTAS NI CLAVES. Los mensajes de error de un proceso o de una
 * libreria suelen llevar la ruta completa del binario, que incluye el usuario
 * de Windows; se limpian antes de enseñarlos.
 *
 * Cada comprobacion tiene su tiempo maximo: una red caida no debe dejar este
 * comando colgado.
 *
 * Sale con codigo 1 si falla alguna pieza obligatoria, para poder usarlo en
 * una tarea programada o antes de desplegar.
 */
import { spawn } from 'node:child_process'
import { loadEnv, optionalEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'

loadEnv()

type Estado = 'ok' | 'fallo' | 'aviso' | 'sin configurar'

interface Resultado {
  pieza: string
  estado: Estado
  detalle: string
  /** Si falla, el sistema no puede trabajar. */
  obligatoria: boolean
}

const TIEMPO_MS = 15_000

/** Quita rutas de archivos y lo que va detras de un usuario de Windows o Unix. */
function limpiar(texto: string): string {
  return texto
    .split('\n')[0]!
    .replace(/[A-Za-z]:[\\/][^\s'"]*/g, '[ruta]')
    .replace(/\/(?:Users|home)\/[^\s'"]*/g, '[ruta]')
    .replace(/(sk-ant-|Apikey\s+)[A-Za-z0-9_-]+/g, '$1***')
    .slice(0, 160)
}

function conTiempo<T>(promesa: Promise<T>, ms = TIEMPO_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`tiempo agotado (${ms / 1000} s)`)), ms)
    promesa.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))) },
    )
  })
}

/** Lanza un binario sin shell y devuelve stdout + stderr. */
function ejecutar(comando: string, args: string[]): Promise<string> {
  return conTiempo(
    new Promise((resolve, reject) => {
      const hijo = spawn(comando, args, { shell: false, windowsHide: true })
      let salida = ''
      hijo.stdout.on('data', (c: Buffer) => { salida += c.toString('utf8') })
      hijo.stderr.on('data', (c: Buffer) => { salida += c.toString('utf8') })
      hijo.on('error', (e: NodeJS.ErrnoException) => {
        reject(new Error(e.code === 'ENOENT' ? 'no está instalado o no se encuentra' : e.message))
      })
      hijo.on('close', (codigo) => {
        if (codigo === 0) resolve(salida)
        // La cola de la salida va en el error: sin ella no se sabe por que fallo.
        else reject(new Error(`terminó con código ${codigo}: ${salida.trim().slice(-2000)}`))
      })
    }),
  )
}

// --- Comprobaciones ----------------------------------------------------------

async function baseDeDatos(): Promise<Resultado[]> {
  const url = optionalEnv('DATABASE_URL')
  if (url === undefined) {
    return [
      { pieza: 'Base de datos', estado: 'sin configurar', detalle: 'falta DATABASE_URL en .env', obligatoria: true },
      { pieza: 'Procesador (trabajador)', estado: 'sin configurar', detalle: 'necesita la base de datos', obligatoria: false },
    ]
  }

  const { connect } = await import('../src/store/db.js')
  let db: Awaited<ReturnType<typeof connect>> | undefined
  try {
    db = await conTiempo(connect(url))
    await conTiempo(db.query('select 1'))
    const base: Resultado = { pieza: 'Base de datos', estado: 'ok', detalle: 'conecta y responde', obligatoria: true }

    /*
     * El latido del trabajador. Late en cada vuelta de su bucle (cada 5 s), asi
     * que mas de cinco minutos de silencio es un PC apagado o un trabajador
     * caido. No es obligatorio: el panel funciona sin el, solo que no procesa.
     */
    let trabajador: Resultado
    try {
      const filas = await conTiempo(
        db.query<{ visto_en: string }>(
          'select max(visto_en) as visto_en from trabajadores where owner_id = $1',
          [OWNER_ID],
        ),
      )
      const visto = filas[0]?.visto_en
      if (visto === null || visto === undefined) {
        trabajador = { pieza: 'Procesador (trabajador)', estado: 'aviso', detalle: 'nunca se ha conectado', obligatoria: false }
      } else {
        const min = Math.round((Date.now() - new Date(visto).getTime()) / 60_000)
        trabajador = min <= 5
          ? { pieza: 'Procesador (trabajador)', estado: 'ok', detalle: 'conectado', obligatoria: false }
          : { pieza: 'Procesador (trabajador)', estado: 'aviso', detalle: `desconectado hace ${min} min`, obligatoria: false }
      }
    } catch (e) {
      trabajador = { pieza: 'Procesador (trabajador)', estado: 'aviso', detalle: `no se pudo leer el latido: ${limpiar(String(e))}`, obligatoria: false }
    }
    return [base, trabajador]
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e)
    const detalle =
      /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|tiempo agotado/i.test(texto) ? 'no se puede conectar: revisa la dirección o la red' :
      /password authentication|SASL/i.test(texto) ? 'la contraseña de DATABASE_URL no vale' :
      limpiar(texto)
    return [
      { pieza: 'Base de datos', estado: 'fallo', detalle, obligatoria: true },
      { pieza: 'Procesador (trabajador)', estado: 'sin configurar', detalle: 'necesita la base de datos', obligatoria: false },
    ]
  } finally {
    await db?.close().catch(() => {})
  }
}

/**
 * Un binario por su variable, o por el PATH si no esta.
 *
 * El proyecto fija la ruta a proposito (hay dos ffmpeg en el PATH tras instalar
 * yt-dlp), pero aqui se acepta el PATH como respaldo para poder decir "esta
 * instalado, aunque falta fijar la ruta" en vez de solo "falta la variable".
 */
async function binario(pieza: string, variables: string | string[], porDefecto: string, args: string[], extra?: (salida: string) => string | null): Promise<Resultado> {
  // Varios nombres valen para la misma ruta (YT_DLP_PATH es el del plan,
  // YTDLP_PATH el de siempre): se usa el primero que este puesto.
  const nombres = Array.isArray(variables) ? variables : [variables]
  const variable = nombres[0]!
  const ruta = nombres.map((n) => optionalEnv(n)).find((v) => v !== undefined)
  try {
    const salida = await ejecutar(ruta ?? porDefecto, args)
    const version = limpiar(salida.trim().split('\n')[0] ?? '')
    const problema = extra?.(salida) ?? null
    if (problema !== null) return { pieza, estado: 'fallo', detalle: problema, obligatoria: true }
    if (ruta === undefined) {
      return { pieza, estado: 'aviso', detalle: `${version} (encontrado por el PATH; fija ${variable} en .env)`, obligatoria: true }
    }
    return { pieza, estado: 'ok', detalle: version, obligatoria: true }
  } catch (e) {
    const motivo = limpiar(e instanceof Error ? e.message : String(e))
    return {
      pieza,
      estado: ruta === undefined ? 'sin configurar' : 'fallo',
      detalle: ruta === undefined ? `falta ${variable} en .env y ${motivo}` : motivo,
      obligatoria: true,
    }
  }
}

async function ffmpeg(): Promise<Resultado> {
  const r = await binario('ffmpeg', 'FFMPEG_PATH', 'ffmpeg', ['-hide_banner', '-version'])
  if (r.estado === 'fallo' || r.estado === 'sin configurar') return r
  // Sin el filtro whisper no hay transcripcion: es el ffmpeg equivocado.
  try {
    const filtros = await ejecutar(optionalEnv('FFMPEG_PATH') ?? 'ffmpeg', ['-hide_banner', '-filters'])
    if (!/\swhisper\s/.test(filtros)) {
      return { ...r, estado: 'fallo', detalle: 'este ffmpeg no trae el filtro whisper: hace falta el full build' }
    }
  } catch {
    // Si la version respondio y esto no, lo dira `npm run doctor`.
  }
  /*
   * Fase 8: NVENC de verdad, codificando un fotograma. Que el codificador
   * aparezca en la lista no basta: con un driver de NVIDIA viejo aparece y
   * luego cada render falla. Esta comprobacion daba verde en ese caso.
   */
  try {
    await ejecutar(optionalEnv('FFMPEG_PATH') ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1',
      '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-',
    ])
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e)
    const minimo = /minimum required Nvidia driver for nvenc is ([\d.]+)/i.exec(texto)?.[1]
    return {
      ...r,
      estado: 'fallo',
      detalle: minimo
        ? `el driver de NVIDIA es demasiado viejo para codificar con la tarjeta: actualízalo a la versión ${minimo} o más nueva`
        : 'ffmpeg no puede codificar con la tarjeta NVIDIA (NVENC): comprueba el driver y que la tarjeta la soporte',
    }
  }
  return r
}

async function ytdlp(): Promise<Resultado> {
  return binario('yt-dlp', ['YT_DLP_PATH', 'YTDLP_PATH'], 'yt-dlp', ['--version'])
}

async function ia(): Promise<Resultado[]> {
  /*
   * La misma prueba que el boton "Probar IA" del panel (src/llm/probar.ts):
   * una llamada minima con el proveedor configurado. Con la suscripcion
   * distingue lista / sin sesion / limite / CLI no encontrado / tiempo agotado.
   */
  const { probarIA } = await import('../src/llm/probar.js')
  const { textoEstadoIA } = await import('../src/llm/estado.js')
  const r = await probarIA()
  const pieza = r.proveedor === 'claude-cli' ? 'IA (suscripción, Claude Code)' : r.proveedor === 'ollama' ? 'IA (Ollama)' : 'IA (API de Anthropic)'
  const texto = r.estado === 'lista'
    ? `lista, con ${r.modelo} en ${(r.ms / 1000).toFixed(1)} s`
    : r.estado === 'error'
      ? r.mensaje
      : textoEstadoIA({ estado: r.estado, reanudarEn: r.reanudarEn ?? null })
  return [{ pieza, estado: r.estado === 'lista' ? 'ok' : 'fallo', detalle: limpiar(texto), obligatoria: true }]
}

async function uploadPost(): Promise<Resultado> {
  const clave = optionalEnv('UPLOAD_POST_API_KEY')
  if (clave === undefined) {
    return { pieza: 'Publicación (upload-post)', estado: 'sin configurar', detalle: 'falta UPLOAD_POST_API_KEY', obligatoria: true }
  }
  /*
   * El historial con una sola fila: es una lectura, no publica nada, y es el
   * mismo endpoint que ya usa la recogida de metricas.
   */
  try {
    const r = await conTiempo(
      fetch('https://api.upload-post.com/api/uploadposts/history?page=1&limit=1', {
        headers: { Authorization: `Apikey ${clave}` },
      }),
    )
    if (r.ok) return { pieza: 'Publicación (upload-post)', estado: 'ok', detalle: 'la clave autentica', obligatoria: true }
    const detalle = r.status === 401 || r.status === 403 ? `la clave no vale (${r.status})` : `respondió HTTP ${r.status}`
    return { pieza: 'Publicación (upload-post)', estado: 'fallo', detalle, obligatoria: true }
  } catch (e) {
    return { pieza: 'Publicación (upload-post)', estado: 'fallo', detalle: `no responde: ${limpiar(String(e))}`, obligatoria: true }
  }
}

// --- Informe -----------------------------------------------------------------

const resultados = (
  await Promise.all([baseDeDatos(), ffmpeg(), ytdlp(), ia(), uploadPost()])
).flat()

const ETIQUETA: Record<Estado, string> = {
  ok: 'OK',
  fallo: 'FALLO',
  aviso: 'AVISO',
  'sin configurar': 'FALTA',
}

const ancho = Math.max(...resultados.map((r) => r.pieza.length))
console.log('')
for (const r of resultados) {
  console.log(`${r.pieza.padEnd(ancho)}  ${ETIQUETA[r.estado].padEnd(5)}  ${r.detalle}`)
}

const rotas = resultados.filter((r) => r.obligatoria && r.estado !== 'ok' && r.estado !== 'aviso')
console.log('')
if (rotas.length === 0) {
  console.log('Todo listo para trabajar.')
} else {
  console.log(`${rotas.length === 1 ? 'Falta 1 pieza' : `Faltan ${rotas.length} piezas`}: ${rotas.map((r) => r.pieza).join(', ')}.`)
  process.exitCode = 1
}
