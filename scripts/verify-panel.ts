/**
 * Verificacion del panel contra la base de datos.
 *
 *   npm run verify:panel
 *
 * El panel dejo de leer ficheros JSON y de lanzar procesos: ahora consulta
 * Postgres y encola tareas en una tabla. Eso no se comprueba con un typecheck,
 * porque lo que puede romperse es SQL y rutas HTTP, y el compilador no ve
 * ninguna de las dos cosas.
 *
 * Levanta el servidor de verdad sobre un Postgres de verdad en memoria (PGlite)
 * y le habla por HTTP como lo haria el navegador. No toca la base real: este
 * guion crea, cambia y borra datos, y eso no debe pasar en produccion.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { loadEnv, ROOT } from '../src/lib/env.js'
import { OWNER_ID as OWNER } from '../src/lib/owner.js'
import type { Db } from '../src/store/db.js'
import { startReviewServer } from '../src/review/server.js'

/*
 * El entorno se fija aqui, no se hereda.
 *
 * loadEnv() solo lee el .env la primera vez, asi que hay que forzarlo ANTES de
 * borrar nada: si no, el primer acceso posterior repuebla las variables desde
 * el fichero y estas lineas no sirven de nada. Esta prueba fallo exactamente
 * asi el dia que se configuro la clave de Supabase en el .env.
 */
loadEnv()

// El encadenado automatico lanzaria tareas de su cuenta a mitad de las
// comprobaciones y los recuentos bailarian. Se apaga a proposito.
process.env.AUTO_CHAIN = '0'
process.env.PANEL_REMOTO = '1'
delete process.env.REVIEW_PASSWORD
// Estas pruebas miran el panel, no la entrada: sin login (solo 127.0.0.1).
// La entrada con usuarios se prueba en verify-acceso.
process.env.KLIP_SIN_LOGIN = '1'

/*
 * Sin nube, a proposito.
 *
 * Una de las comprobaciones mide que el panel avise cuando hay copias subidas
 * pero le falta la clave para pedirlas. Con la clave de verdad puesta, el panel
 * firmaria una URL contra Supabase y la prueba mediria otra cosa (y ademas
 * hablaria con un servicio real desde una bateria que debe correr sin red).
 */
delete process.env.SUPABASE_SERVICE_ROLE_KEY

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const pg = new PGlite()
const db: Db = {
  query: async <T>(sql: string, params: unknown[] = []) =>
    (await pg.query(sql, params)).rows as T[],
  close: async () => pg.close(),
}

for (const f of readdirSync(join(ROOT, 'db')).filter((n) => n.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(join(ROOT, 'db', f), 'utf8'))
}

// --- Datos de partida -------------------------------------------------------

await pg.exec(`
  insert into owners (id, email, label)
    values ('${OWNER}', 'yo@ejemplo.com', 'Yo');

  insert into sources (id, owner_id, title, duration_sec, has_transcript, variants_count)
    values ('vod-uno', '${OWNER}', 'Directo del lunes', 7200, true, 4);

  insert into clips (owner_id, source_id, clip_id, start_sec, end_sec, hook, reason,
                     caption, hashtags, score, status, master_path)
    values
      ('${OWNER}', 'vod-uno', 'clip-01', 10, 40, 'gancho a', 'razon a', 'pie a',
       '{uno}', 91, 'pending', 'C:/falso/clip-01.mp4'),
      ('${OWNER}', 'vod-uno', 'clip-02', 60, 95, 'gancho b', 'razon b', 'pie b',
       '{dos}', 74, 'approved', 'C:/falso/clip-02.mp4'),
      ('${OWNER}', 'vod-uno', 'clip-03', 120, 150, 'gancho c', 'razon c', 'pie c',
       '{tres}', 55, 'rejected', '');

  insert into accounts (owner_id, id, label, slots)
    values ('${OWNER}', 'acc-01', 'Cuenta 1', '{10,14,18}'),
           ('${OWNER}', 'acc-02', 'Cuenta 2', '{11,15,19}');

  -- Con permiso de TikTok, porque una cuenta sin el no recibe nada.
  --
  -- El reparto (variants y schedule) trabaja sobre las cuentas PUBLICABLES, y
  -- desde que el panel cuenta lo mismo que ellos, un montaje con cuentas sin
  -- enlazar describiria una situacion en la que no se publica nunca.
  insert into tiktok_tokens (owner_id, account_id, open_id, access_token,
                             refresh_token, access_expires_at, refresh_expires_at)
    values ('${OWNER}', 'acc-01', 'open-1', 'tok-1', 'ref-1',
            now() + interval '1 day', now() + interval '365 days'),
           ('${OWNER}', 'acc-02', 'open-2', 'tok-2', 'ref-2',
            now() + interval '1 day', now() + interval '365 days');

  insert into queue (id, owner_id, source_id, clip_id, account_id, variant_path,
                     checksum, scheduled_at, status)
    values ('q1', '${OWNER}', 'vod-uno', 'clip-02', 'acc-01', 'v1.mp4', 'aaa',
            now() + interval '1 hour', 'pending'),
           ('q2', '${OWNER}', 'vod-uno', 'clip-02', 'acc-02', 'v2.mp4', 'bbb',
            now() + interval '2 hours', 'pending');

  insert into runs (id, owner_id, kind, label, started_at, ended_at, duration_ms,
                    status, input, output, input_tokens, output_tokens, cost_usd)
    values ('r1', '${OWNER}', 'select', 'Elegir momentos', now(), now(), 522000,
            'ok', '{"segmentos": 3027}', '{"clips": 32}', 91578, 4200, 1.5100),
           ('r2', '${OWNER}', 'render', 'Renderizar', now(), now(), 180000,
            'ok', '{}', '{"archivos": 32}', 0, 0, 0);
`)

// --- Arranque ---------------------------------------------------------------

const PUERTO = 4399
startReviewServer({ port: PUERTO, db, ownerId: OWNER })

const base = `http://127.0.0.1:${PUERTO}`
const pedir = async (
  ruta: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> => {
  const res = await fetch(base + ruta, init)
  const texto = await res.text()
  let body: unknown = texto
  try {
    body = JSON.parse(texto)
  } catch {
    // Una respuesta no-JSON es un resultado valido: la portada es HTML.
  }
  return { status: res.status, body }
}

// El servidor escucha de forma asincrona; sin esta espera la primera peticion
// llega antes de que haya socket.
await new Promise((r) => setTimeout(r, 400))

// --- 1. La portada sigue sirviendose ----------------------------------------

const portada = await pedir('/')
check(
  'La portada responde HTML',
  portada.status === 200 && String(portada.body).includes('<html'),
  `${portada.status}, ${String(portada.body).length} bytes`,
)

// --- 1b. La plantilla de la pagina sigue entera -----------------------------
//
// page.ts es una sola plantilla de texto de 1.700 lineas. Una comilla invertida
// suelta en un comentario la cierra a media altura y el resto del fichero pasa
// a interpretarse como codigo. Ha ocurrido tres veces. El compilador lo detecta,
// pero con un error que no menciona ni comillas ni plantillas
// ("Module declaration names may only use quoted strings"), asi que se pierde
// media hora buscando en el sitio equivocado.
{
  const fuente = readFileSync(join(ROOT, 'src', 'review', 'page.ts'), 'utf8')
  const ini = fuente.indexOf('return ' + '`')
  const fin = fuente.lastIndexOf('`')
  const dentro = fuente.slice(ini + 8, fin)
  const sueltas = (dentro.match(/`/g) ?? []).length
  check(
    'Ninguna comilla invertida suelta dentro de la plantilla de la pagina',
    sueltas === 0,
    sueltas === 0 ? 'plantilla intacta' : `${sueltas} comilla(s) la cortan por la mitad`,
  )
}

// --- 2. Los clips salen de la base ------------------------------------------

const clips = await pedir('/api/clips')
check(
  'Cuenta los tres estados',
  clips.body.counts.pending === 1 &&
    clips.body.counts.approved === 1 &&
    clips.body.counts.rejected === 1,
  JSON.stringify(clips.body.counts),
)
check(
  'Ordena por nota descendente',
  clips.body.clips[0].clipId === 'clip-01' && clips.body.clips[0].score === 91,
  clips.body.clips.map((c: any) => `${c.clipId}:${c.score}`).join(' '),
)
check(
  'En modo remoto ningun clip dice tener archivo',
  clips.body.clips.every((c: any) => c.hasFile === false),
  'hasFile false en los 3',
)

const soloPendientes = await pedir('/api/clips?status=pending')
check(
  'El filtro por estado funciona',
  soloPendientes.body.clips.length === 1 &&
    soloPendientes.body.clips[0].clipId === 'clip-01',
  `${soloPendientes.body.clips.length} clip(s)`,
)

// --- 3. Aprobar escribe en la base ------------------------------------------

const aprobado = await pedir('/api/clips/vod-uno/clip-01', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'approved', caption: 'pie cambiado' }),
})
const [enBase] = await db.query<{ status: string; caption: string }>(
  `select status, caption from clips where clip_id = 'clip-01' and owner_id = $1`,
  [OWNER],
)
check(
  'Aprobar guarda estado y pie en la base',
  aprobado.status === 200 && enBase?.status === 'approved' && enBase.caption === 'pie cambiado',
  `${enBase?.status} / "${enBase?.caption}"`,
)

const inexistente = await pedir('/api/clips/vod-uno/clip-99', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'approved' }),
})
check('Un clip que no existe da 404', inexistente.status === 404, `${inexistente.status}`)

const malEstado = await pedir('/api/clips/vod-uno/clip-01', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ status: 'borrado' }),
})
check('Un estado invalido da 400', malEstado.status === 400, `${malEstado.status}`)

// --- 4. El resumen general --------------------------------------------------

const overview = await pedir('/api/overview')
check(
  'El resumen lista el VOD con sus cifras',
  overview.body.sources.length === 1 &&
    overview.body.sources[0].clips === 3 &&
    overview.body.sources[0].rendered === 2 &&
    overview.body.sources[0].durationMin === 120,
  JSON.stringify(overview.body.sources[0]),
)
check(
  'Las copias por cuenta salen de la base, no del disco',
  overview.body.variants['vod-uno'] === 4,
  `variants=${overview.body.variants['vod-uno']}`,
)
check(
  'Cuenta las cuentas y la cola',
  overview.body.accounts === 2 && overview.body.queue.total === 2,
  `${overview.body.accounts} cuentas, ${overview.body.queue.total} en cola`,
)

// --- 5. La cola agrupada ----------------------------------------------------

const cola = await pedir('/api/queue')
check(
  'La cola se agrupa por VOD con su titulo',
  cola.body.sources.length === 1 &&
    cola.body.sources[0].title === 'Directo del lunes' &&
    cola.body.sources[0].accounts === 2,
  JSON.stringify(cola.body.sources[0]),
)

// --- 6. El diario suma en la base -------------------------------------------

const registro = await pedir('/api/runs')
check(
  'El diario suma el costo total',
  Math.abs(registro.body.totals.costUsd - 1.51) < 0.0001 && registro.body.totals.count === 2,
  `$${registro.body.totals.costUsd} en ${registro.body.totals.count} pasadas`,
)
check(
  'El desglose por comando distingue los dos tipos',
  registro.body.totals.byKind.select.count === 1 &&
    registro.body.totals.byKind.render.count === 1,
  Object.keys(registro.body.totals.byKind).join(' '),
)
check(
  'Una pasada sin tokens los deja en null, no en cero',
  registro.body.runs.find((r: any) => r.id === 'r2').tokens === null &&
    registro.body.runs.find((r: any) => r.id === 'r1').tokens.inputTokens === 91578,
  'r2 null, r1 91578',
)

// --- 7. Los ajustes van y vuelven de la base --------------------------------

const guardados = await pedir('/api/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ accounts: 6, postsPerDay: 2, dayStartHour: 9, dayEndHour: 21 }),
})
const [ajustesEnBase] = await db.query<{ accounts: number; day_end_hour: number }>(
  `select accounts, day_end_hour from settings where owner_id = $1`,
  [OWNER],
)
check(
  'Guardar ajustes escribe la fila del propietario',
  guardados.status === 200 && ajustesEnBase?.day_end_hour === 21,
  `fin=${ajustesEnBase?.day_end_hour}`,
)

/*
 * El numero de cuentas NO se acepta del cliente.
 *
 * Antes esta prueba comprobaba lo contrario: que mandar accounts=6 guardaba un
 * 6. Eso era justo el fallo: la cifra no tenia por que parecerse a la realidad,
 * y en produccion llego a decir 13 con 20 cuentas creadas y una enlazada. Ahora
 * se cuenta, asi que lo que se verifica es que el valor del cliente se ignora.
 */
check(
  'El numero de cuentas se cuenta, no se acepta del cliente',
  guardados.body.settings.accounts !== 6,
  `mande 6 y quedo ${guardados.body.settings.accounts}`,
)
check(
  'La respuesta dice cuantas cuentas hay y cuantas pueden publicar',
  typeof guardados.body.cuentas?.creadas === 'number' &&
    typeof guardados.body.cuentas?.enlazadas === 'number',
  JSON.stringify(guardados.body.cuentas),
)

const cuentasTras = await db.query<{ id: string; status: string; slots: number[] }>(
  `select id, status, slots from accounts where owner_id = $1 order by id`,
  [OWNER],
)
check(
  'Cambiar la franja recalcula las franjas de las cuentas que hay',
  cuentasTras.length > 0 && cuentasTras.every((c) => c.slots.length === 2),
  `${cuentasTras.length} cuentas, ${cuentasTras[0]?.slots.length} franjas cada una`,
)
/*
 * Guardar ajustes ya NO crea cuentas.
 *
 * Antes el numero salia del formulario, asi que subirlo a 6 fabricaba cuatro
 * cuentas de la nada. Las cuentas se crean al enlazarlas, no al tocar un
 * horario: lo que se comprueba es que las que habia siguen ahi con su nombre.
 */
check(
  'Guardar ajustes no inventa ni borra cuentas',
  cuentasTras[0]?.id === 'acc-01' && cuentasTras.length === 2,
  `${cuentasTras.length} cuentas, primera ${cuentasTras[0]?.id}`,
)

const franjaInvertida = await pedir('/api/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ dayStartHour: 20, dayEndHour: 8 }),
})
check(
  'Una franja invertida se rechaza con explicacion',
  franjaInvertida.status === 400 && typeof franjaInvertida.body.error === 'string',
  franjaInvertida.body.error ?? '',
)

const fueraDeRango = await pedir('/api/settings', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  // postsPerDay y no accounts: aquel dejo de ser editable, asi que mandarlo
  // fuera de rango ya no prueba nada.
  body: JSON.stringify({ postsPerDay: 5000 }),
})
check(
  'Un valor fuera de limites se rechaza',
  fueraDeRango.status === 400,
  fueraDeRango.body.error ?? '',
)

// --- 8. Encolar tareas, no ejecutarlas --------------------------------------

/*
 * EL PANEL REMOTO ENCOLA. Esta prueba comprobaba lo contrario.
 *
 * Decia que en remoto un render tenia que devolver 501, porque en Hostinger no
 * hay ffmpeg. La premisa estaba mal: el panel no ejecuta nada, escribe la
 * tarea en la tabla y el trabajador de casa la recoge. Mientras la prueba
 * defendio aquel 501, pegar un enlace desde el movil contestaba "lanzala desde
 * el ordenador que hace el trabajo", que es justo lo que no se quiere.
 *
 * Lo que si tiene que hacer es DECIR si hay alguien escuchando, para que una
 * tarea que va a esperar tres dias no se vea igual que una que empieza ya.
 */
const remotoEncola = await pedir('/api/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'render', params: { sourceId: 'vod-uno' } }),
})
check(
  'El panel remoto encola y dice si hay quien lo recoja',
  remotoEncola.status === 202 &&
    typeof remotoEncola.body?.trabajador?.vivo === 'boolean' &&
    // Sin ningun trabajador latiendo, tiene que decir que no hay nadie.
    remotoEncola.body.trabajador.vivo === false,
  `${remotoEncola.status} vivo=${remotoEncola.body?.trabajador?.vivo}`,
)

/*
 * Y la tarea queda esperando de verdad, no se pierde.
 */
const [esperando] = await db.query<{ status: string; kind: string }>(
  `select status, kind from jobs where owner_id = $1 and kind = 'render'`,
  [OWNER],
)
check(
  'La tarea encolada en remoto queda esperando al trabajador',
  esperando?.status === 'queued',
  `${esperando?.kind} -> ${esperando?.status}`,
)

/*
 * Se borra antes de seguir: la siguiente prueba busca "el render" por su tipo
 * y con dos en la tabla leeria el que no es. Lo descubrio este mismo cambio,
 * cuando el remoto paso de rechazar a encolar y la prueba de los argumentos
 * empezo a leer la tarea sin --limit.
 */
await db.query(`delete from jobs where owner_id = $1 and kind = 'render'`, [OWNER])

// El resto de la seccion va en modo local: es donde esas tareas corren de
// verdad. esRemoto() se lee en cada peticion, asi que basta con cambiarlo.
process.env.PANEL_REMOTO = '0'

const encolada = await pedir('/api/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'render', params: { sourceId: 'vod-uno', limit: 5 } }),
})
/*
 * Se busca el render POR SU TIPO, no "la primera tarea que haya".
 *
 * Desde que aprobar el ultimo clip de un VOD encola el reparto solo, esta tabla
 * tiene mas de una fila, y sin `where kind` esta prueba leia la que no era.
 */
const [jobEnBase] = await db.query<{ kind: string; args: string[]; status: string }>(
  `select kind, args, status from jobs where owner_id = $1 and kind = 'render'`,
  [OWNER],
)
check(
  'Pedir un render lo deja encolado, no ejecutandose',
  encolada.status === 202 && jobEnBase?.status === 'queued' && jobEnBase.kind === 'render',
  `${jobEnBase?.kind} ${JSON.stringify(jobEnBase?.args)} -> ${jobEnBase?.status}`,
)
/*
 * No se compara con una lista exacta a proposito.
 *
 * El render arrastra ahora el estilo de subtitulos guardado en Ajustes, asi que
 * la linea crece cada vez que aparece una perilla nueva, y una igualdad literal
 * fallaria por un cambio correcto. Lo que hay que comprobar es lo que da nombre
 * a esta prueba: que el VOD va primero, que el limite que pidio el cliente
 * llega, y que TODO lo demas son banderas de una lista cerrada y no algo que
 * haya colado el navegador.
 */
const PERMITIDAS = new Set([
  '--limit', '--no-subs', '--sub-font', '--sub-size', '--sub-margin',
  '--sub-color', '--sub-color-borde', '--sub-borde', '--sub-words', '--sub-animate',
  '--max-per-window', '--window', '--min', '--max', '--solo', '--clip',
  '--titulo-texto', '--titulo-arriba', '--titulo-tam',
  '--titulo-color', '--titulo-color-borde', '--titulo-borde', '--encuadre',
])
const args = jobEnBase?.args ?? []
const banderas = args.filter((a) => a.startsWith('--'))
check(
  'Los argumentos se construyen en el servidor',
  args[0] === 'vod-uno' &&
    args[args.indexOf('--limit') + 1] === '5' &&
    banderas.length > 0 &&
    banderas.every((f) => PERMITIDAS.has(f)),
  JSON.stringify(args),
)

/*
 * REHACER UN SOLO MOMENTO: el identificador acaba en la linea de comando.
 *
 * El panel manda clipId, start y end, y el servidor los convierte en
 * --solo clip-03 --clip 340.00-380.00. Eso es texto del navegador llegando a
 * argv del trabajador, asi que la forma se comprueba, no se confia.
 */
{
  const malo = await pedir('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'render',
      params: { sourceId: 'vod-uno', clipId: 'clip-03; rm -rf /' },
    }),
  })
  check(
    'Un identificador de momento con forma rara se rechaza',
    malo.status === 400,
    `${malo.status} ${JSON.stringify(malo.body)}`,
  )

  const corto = await pedir('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'render',
      params: { sourceId: 'vod-uno', clipId: 'clip-03', start: 100, end: 102 },
    }),
  })
  check(
    'Un corte de dos segundos se rechaza',
    corto.status === 400,
    `${corto.status} ${JSON.stringify(corto.body)}`,
  )

  const alReves = await pedir('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'render',
      params: { sourceId: 'vod-uno', clipId: 'clip-03', start: 200, end: 100 },
    }),
  })
  check(
    'Un corte que acaba antes de empezar se rechaza',
    alReves.status === 400,
    `${alReves.status} ${JSON.stringify(alReves.body)}`,
  )

  await db.query(`delete from jobs where owner_id = $1 and kind = 'render'`, [OWNER])
  const bueno = await pedir('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'render',
      params: { sourceId: 'vod-uno', clipId: 'clip-03', start: 340, end: 380 },
    }),
  })
  const [soloJob] = await db.query<{ args: string[]; label: string }>(
    `select args, label from jobs where owner_id = $1 and kind = 'render'`,
    [OWNER],
  )
  const a = soloJob?.args ?? []
  check(
    'Rehacer un momento manda --solo y el corte, y no --limit',
    bueno.status === 202 &&
      a[0] === 'vod-uno' &&
      a[a.indexOf('--solo') + 1] === 'clip-03' &&
      a[a.indexOf('--clip') + 1] === '340.00-380.00' &&
      !a.includes('--limit') &&
      a.filter((f) => f.startsWith('--')).every((f) => PERMITIDAS.has(f)),
    JSON.stringify(a),
  )
}

const vodInventado = await pedir('/api/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'render', params: { sourceId: 'no-existe' } }),
})
check(
  'Un VOD que no esta en la base se rechaza',
  vodInventado.status === 400 && String(vodInventado.body.error).includes('no-existe'),
  vodInventado.body.error ?? '',
)

const travesia = await pedir('/api/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'render', params: { sourceId: '../../etc' } }),
})
check(
  'Un identificador con ../ se rechaza por caracteres',
  travesia.status === 400 && String(travesia.body.error).includes('caracteres'),
  travesia.body.error ?? '',
)

const tipoInventado = await pedir('/api/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'rm -rf', params: {} }),
})
check('Un tipo de tarea desconocido se rechaza', tipoInventado.status === 400, `${tipoInventado.status}`)

const publicarSimulacro = await pedir('/api/jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'publish', params: {} }),
})
const [jobPublish] = await db.query<{ args: string[] }>(
  `select args from jobs where owner_id = $1 and kind = 'publish'`,
  [OWNER],
)
check(
  'Publicar sin pedirlo expresamente NO lleva --live',
  publicarSimulacro.status === 202 && !(jobPublish?.args ?? []).includes('--live'),
  JSON.stringify(jobPublish?.args),
)

// Se devuelve al modo remoto, que es como arranca esta prueba.
process.env.PANEL_REMOTO = '1'

// --- 9. Listado, detalle y cancelacion --------------------------------------

const listado = await pedir('/api/jobs')
/*
 * Tres: el render y el publish que pide esta prueba, mas el reparto que se
 * encolo solo al aprobar el ultimo clip de vod-uno.
 */
check(
  'El listado devuelve las tareas encoladas',
  listado.body.jobs.length === 3 &&
    listado.body.jobs.map((j: any) => j.kind).sort().join(',') === 'publish,render,variants',
  `${listado.body.jobs.length} tareas: ${listado.body.jobs.map((j: any) => j.kind).join(', ')}`,
)
check(
  'El listado no arrastra el registro completo',
  listado.body.jobs.every((j: any) => j.log === undefined && typeof j.lineCount === 'number'),
  'sin campo log, con lineCount',
)

const idJob = listado.body.jobs[0].id
await pg.query(`update jobs set log = $1 where id = $2`, ['linea uno\nlinea dos', idJob])
const detalle = await pedir('/api/jobs/' + idJob)
check(
  'El detalle convierte el registro en lineas',
  Array.isArray(detalle.body.lines) && detalle.body.lines.length === 2,
  JSON.stringify(detalle.body.lines),
)

const cancelado = await pedir('/api/jobs/' + idJob + '/cancel', { method: 'POST' })
const [trasCancelar] = await db.query<{ status: string }>(
  `select status from jobs where id = $1`,
  [idJob],
)
check(
  'Cancelar marca la tarea en la base',
  cancelado.status === 200 && trasCancelar?.status === 'cancelled',
  `${trasCancelar?.status}`,
)

const recancelar = await pedir('/api/jobs/' + idJob + '/cancel', { method: 'POST' })
check(
  'Cancelar dos veces da 409 y no miente',
  recancelar.status === 409,
  `${recancelar.status}`,
)

// --- 10. Lo que el modo remoto tiene que negarse a hacer --------------------

/*
 * Se comprueba la intencion, no la frase exacta.
 *
 * Lo que no puede pasar es que el panel devuelva un 200 sin video y el
 * navegador pinte un reproductor que no carga nunca. El texto del aviso ha
 * cambiado ya una vez (antes decia "no guarda los videos", ahora explica que
 * hay que subirlos) y volvera a cambiar; el 501 es lo que importa.
 */
const video = await pedir('/video/vod-uno/clip-01')
check(
  'Un panel remoto no finge servir videos',
  video.status === 501 && String(video.body.error).length > 20,
  `${video.status}: ${video.body.error}`,
)

/*
 * Con copia subida pero sin clave en el servidor, tambien 501.
 *
 * Es el estado en el que queda el panel si se despliega el codigo sin poner
 * SUPABASE_SERVICE_ROLE_KEY en sus variables. Sin esta comprobacion, ese
 * despliegue a medias enseñaria treinta reproductores rotos en vez de decir
 * que falta una variable de entorno.
 */
await db.query(
  `update clips set proxy_path = $2 where owner_id = $1 and clip_id = 'clip-02'`,
  [OWNER, `${OWNER}/vod-uno/clip-02.mp4`],
)
const subidoSinClave = await pedir('/video/vod-uno/clip-02')
check(
  'Con video subido pero sin clave, lo dice en vez de romperse',
  subidoSinClave.status === 501 && String(subidoSinClave.body.error).includes('SUPABASE'),
  `${subidoSinClave.status}: ${subidoSinClave.body.error}`,
)

/*
 * --- 10b. Las paginas legales son publicas ----------------------------------
 *
 * TikTok las exige para auditar la app y quien las revisa NO tiene la llave.
 * Si algun dia alguien las mete detras de la autenticacion "por coherencia",
 * la auditoria falla y el motivo no seria evidente. De ahi esta comprobacion.
 */
/*
 * EL GUION DE LA PAGINA TIENE QUE SER JAVASCRIPT VALIDO.
 *
 * Toda la interfaz es un template literal gigante dentro de page.ts, asi que
 * las barras invertidas se escriben DOBLES: un \n suelto se convierte en un
 * salto de linea real al construir la cadena, parte la instruccion en dos y la
 * pagina entera deja de ejecutarse. El servidor responde 200, el HTML llega
 * completo y el navegador enseña un panel en blanco.
 *
 * Paso tres veces el 2026-10-09 en la misma sesion: con \s en una expresion
 * regular, con \t en otra y con un \n dentro de un texto de ayuda. El
 * typecheck no lo ve, porque para TypeScript es una cadena valida.
 *
 * Se compila el guion sin ejecutarlo. Falla justo donde esta el error y dice
 * en que linea, que es exactamente lo que faltaba.
 */

/*
 * LO QUE NO ES NINGUNA RUTA.
 *
 * Dos respuestas distintas segun quien pregunte. Un navegador recibe una
 * pagina; la API, el JSON de siempre. Antes todo el mundo recibia
 * {"error":"Ruta desconocida"}, y quien pegaba mal un enlace veia una llave y
 * una coma en una pantalla en blanco.
 */
{
  const comoNavegador = await pedir('/esta-ruta-no-existe', {
    headers: { accept: 'text/html,application/xhtml+xml' },
  })
  const html = typeof comoNavegador.body === 'string' ? comoNavegador.body : ''
  check(
    'Una direccion equivocada devuelve una pagina, no JSON',
    comoNavegador.status === 404 &&
      html.includes('Esa pagina no existe') &&
      html.includes('Volver al panel') &&
      // La ruta se enseña para poder decir cual fallo, pero escapada.
      html.includes('/esta-ruta-no-existe'),
    `${comoNavegador.status}, ${html.length} caracteres`,
  )

  const comoApi = await pedir('/api/no-existe')
  check(
    'La API sigue recibiendo JSON en una ruta desconocida',
    comoApi.status === 404 &&
      typeof comoApi.body === 'object' &&
      (comoApi.body as { error?: string }).error === 'Esa dirección no existe en el panel.',
    `${comoApi.status} ${JSON.stringify(comoApi.body)}`,
  )

  /*
   * La ruta no puede colarse como HTML.
   *
   * Es lo unico de esa pagina que viene de fuera, y va dentro de un <code>.
   */
  const conPicos = await pedir('/<script>alerta()</script>', {
    headers: { accept: 'text/html' },
  })
  const sucio = typeof conPicos.body === 'string' ? conPicos.body : ''
  check(
    'La ruta se escapa antes de enseñarla',
    conPicos.status === 404 &&
      !sucio.includes('<script>alerta') &&
      sucio.includes('&lt;script&gt;alerta'),
    `${conPicos.status}`,
  )
}

/*
 * LO QUE TIENE QUE ESTAR EN LA PAGINA PARA PODER USARLA SIN RATON.
 *
 * Las tres son estructura, no estilo, asi que se comprueban sobre el HTML
 * servido: si alguien quita el enlace de salto al reordenar la cabecera, esto
 * lo dice antes de que lo note quien navega con teclado, que no suele ser
 * quien toca el codigo.
 */
{
  const res = await pedir('/')
  const html = typeof res.body === 'string' ? res.body : ''
  const cuerpo = html.slice(html.indexOf('<body>'))

  check(
    'El enlace de salto es lo primero del cuerpo y lleva al contenido',
    /<body>\s*(<!--[\s\S]*?-->\s*)?<a class="salto" href="#view">/.test(cuerpo),
    cuerpo.slice(0, 40).replace(/\n/g, ' '),
  )
  check(
    'El buscador esta en la pagina y se anuncia como dialogo',
    html.includes('id="buscador"') &&
      html.includes('role="dialog"') &&
      html.includes('id="buscar"'),
    'buscador presente',
  )
  check(
    'El destino del salto existe',
    html.includes('<main id="view">'),
    'main#view presente',
  )
}

{
  const res = await pedir('/')
  // La portada no es JSON, asi que `pedir` deja el texto crudo en `body`.
  const html = typeof res.body === 'string' ? res.body : ''
  const guiones = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
  let error: string | null = null
  for (const [i, codigo] of guiones.entries()) {
    if (codigo.trim() === '') continue
    try {
      new Function(codigo)
    } catch (e) {
      error = `guion ${i + 1}: ${e instanceof Error ? e.message : String(e)}`
      break
    }
  }
  check(
    'El guion de la pagina compila como JavaScript',
    guiones.length > 0 && error === null,
    error ?? `${guiones.length} guion(es), todos validos`,
  )
}

/*
 * NINGUN COLOR DE TEMA ESCRITO A MANO EN EL CSS.
 *
 * El tema oscuro vive entero en un bloque de tokens. Una regla que escriba el
 * color directamente -- un rgba(250,250,250) de cabecera, un #FFF de tarjeta --
 * se queda en claro cuando el resto de la pagina se oscurece, y eso no lo
 * detecta ningun typecheck: es CSS valido que solo esta mal en un tema.
 *
 * Paso asi con la cabecera pegajosa, que se quedaba blanca sobre todo lo demas
 * en oscuro. Se permiten dos excepciones, las dos correctas en los dos temas:
 * el negro de las bandas del video (background: #000) y las sombras, que son
 * negro translucido a proposito.
 */
{
  const res = await pedir('/')
  const html = typeof res.body === 'string' ? res.body : ''
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
  // Fuera comentarios: los bloques de /* ... */ hablan de colores todo el rato.
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const sueltos: string[] = []
  for (const linea of limpio.split('\n')) {
    const propiedad = /(background|color|border[a-z-]*)\s*:\s*([^;]+)/gi
    let m: RegExpExecArray | null
    while ((m = propiedad.exec(linea)) !== null) {
      const valor = m[2] ?? ''
      if (/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b|rgba?\(/i.test(valor)) {
        // Las bandas del video y las sombras translucidas son correctas.
        if (/^\s*#000\b/.test(valor)) continue
        if (/rgba\(\s*(?:0|13)\s*,/.test(valor) && /shadow/i.test(linea)) continue
        sueltos.push(linea.trim())
      }
    }
  }
  check(
    'Ningun color de tema escrito a mano en el CSS',
    sueltos.length === 0,
    sueltos.length === 0 ? 'todo pasa por tokens' : sueltos.slice(0, 4).join(' | '),
  )
}

/*
 * UNA CUENTA PAUSADA SIGUE PAUSADA.
 *
 * El reparto de franjas forzaba a 'active' todas las cuentas del cupo, asi que
 * guardar cualquier cosa en Horarios, o crear una cuenta nueva, reactivaba en
 * silencio las que alguien hubiera pausado. El 2026-10-09 se pausaron dieciocho
 * para probar con dos cuentas y volvieron solas; se descubrio porque el
 * publicador decia que la siguiente publicacion era de una cuenta pausada.
 *
 * Pausar es la forma de decir "esta no publica". Mover una hora no lo desdice.
 */
{
  await pedir('/api/cuentas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accion: 'pausar', id: 'acc-02' }),
  })

  await pedir('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dayStartHour: 9 }),
  })

  const [tras] = await db.query<{ status: string }>(
    `select status from accounts where owner_id = $1 and id = 'acc-02'`,
    [OWNER],
  )
  check(
    'Guardar horarios NO reactiva una cuenta pausada',
    tras?.status === 'paused',
    `acc-02 quedo en ${tras?.status}`,
  )

  await pedir('/api/cuentas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accion: 'crear', cuantas: 1 }),
  })
  const [trasCrear] = await db.query<{ status: string }>(
    `select status from accounts where owner_id = $1 and id = 'acc-02'`,
    [OWNER],
  )
  check(
    'Crear una cuenta tampoco la reactiva',
    trasCrear?.status === 'paused',
    `acc-02 quedo en ${trasCrear?.status}`,
  )

  // Y la nueva nace activa y con sus horas puestas.
  const [nueva] = await db.query<{ id: string; status: string; slots: number[] }>(
    `select id, status, slots from accounts where owner_id = $1 order by id desc limit 1`,
    [OWNER],
  )
  check(
    'La cuenta creada nace activa y con horario',
    nueva?.status === 'active' && (nueva?.slots ?? []).length > 0,
    `${nueva?.id} ${nueva?.status}, ${(nueva?.slots ?? []).length} franja(s)`,
  )

  await pedir('/api/cuentas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accion: 'activar', id: 'acc-02' }),
  })
}

for (const ruta of ['/legal/terminos', '/legal/privacidad']) {
  const res = await fetch(base + ruta)
  const html = await res.text()
  check(
    `${ruta} se lee sin llave`,
    res.status === 200 && html.includes('<html') && html.length > 2000,
    `${res.status}, ${html.length} bytes`,
  )
}

// Y no pueden prometer cosas que el programa no hace.
const priv = await (await fetch(base + '/legal/privacidad')).text()
check(
  'La privacidad declara la galleta real',
  priv.includes('klip_sesion') && priv.includes('HttpOnly'),
  'klip_sesion, HttpOnly',
)
check(
  'Declara que la transcripcion viaja a Anthropic',
  priv.includes('Anthropic'),
  'Anthropic declarado',
)
/*
 * Se busca el hecho, no una frase.
 *
 * La redaccion de estas paginas cambia; lo que no puede desaparecer es la
 * afirmacion de que los originales se quedan en el PC, porque es cierta y
 * porque es lo que sostiene el resto de la politica. Una comprobacion sobre
 * texto literal ya fallo una vez por un recorte que no cambiaba el sentido.
 */
const bajo = priv.toLowerCase()
check(
  'Declara que los videos originales no salen del PC',
  bajo.includes('ordenador del titular') && bajo.includes("owner's computer"),
  'declarado en los dos idiomas',
)
check(
  'Declara que nunca se ve la contraseña de TikTok',
  bajo.includes('nunca se ve') && bajo.includes('never seen'),
  'declarado en los dos idiomas',
)

const subida = await pedir('/api/upload', {
  method: 'POST',
  headers: { 'x-file-name': 'vod.mp4' },
  body: 'contenido',
})
check(
  'Un panel remoto rechaza la subida antes de gastarla',
  subida.status === 501,
  `${subida.status}: ${subida.body.error}`,
)

const ruta = await pedir('/api/inventada')
check('Una ruta desconocida da 404', ruta.status === 404, `${ruta.status}`)


// --- 11. La llave del enlace ------------------------------------------------
//
// Es lo que sustituye al dialogo de contrasena. Se comprueba entera aqui porque
// es lo unico que separa el panel de internet: quien tenga la llave puede
// encolar tareas que se ejecutan en otro ordenador.

// Desde la Fase 2 la llave solo vale durante la transicion
// (LEGACY_KEY_ENABLED=true), y sin ella se pide iniciar sesion.
process.env.REVIEW_KEY = 'llave-de-prueba-muy-larga-1234567890'
process.env.LEGACY_KEY_ENABLED = 'true'
delete process.env.KLIP_SIN_LOGIN

const sinLlave = await pedir('/api/overview')
check(
  'Sin llave ni sesion no se entra, y sin sacar ningun dialogo',
  sinLlave.status === 401,
  `${sinLlave.status}, sin cabecera www-authenticate`,
)

// Llegar sin llave lleva a la pantalla de entrada, no a un callejon.
const portadaSinSesion = await fetch(base + "/", { redirect: "manual", headers: { accept: "text/html" } })
check(
  'La portada sin sesion lleva al login',
  portadaSinSesion.status === 303 && (portadaSinSesion.headers.get('location') ?? '').startsWith('/login'),
  `${portadaSinSesion.status} -> ${portadaSinSesion.headers.get('location')}`,
)

// La llave sigue funcionando mientras dure la transicion.
const desdeFormulario = await fetch(base + '/?k=' + process.env.REVIEW_KEY, {
  redirect: 'manual',
})
check(
  'Con LEGACY_KEY_ENABLED la llave antigua deja entrar',
  desdeFormulario.status === 302,
  `${desdeFormulario.status} -> ${desdeFormulario.headers.get('location')}`,
)

const llaveMala = await pedir('/api/overview?k=llave-equivocada')
check('Una llave que no es no entra', llaveMala.status === 401, `${llaveMala.status}`)

// La primera visita con la llave redirige y deja la galleta.
const conLlave = await fetch(base + '/?k=' + process.env.REVIEW_KEY, { redirect: 'manual' })
const galleta = conLlave.headers.get('set-cookie') ?? ''
check(
  'La llave correcta redirige y guarda la galleta',
  conLlave.status === 302 && galleta.includes('klip_llave='),
  `${conLlave.status} -> ${conLlave.headers.get('location')}`,
)
check(
  'La galleta es HttpOnly y SameSite, y la llave sale de la direccion',
  galleta.includes('HttpOnly') && galleta.includes('SameSite=Lax') &&
    !(conLlave.headers.get('location') ?? '').includes('k='),
  galleta.split(';').slice(1).join(';').trim(),
)

// Y a partir de ahi la galleta sola basta, que es lo que usa la pagina.
const valor = /klip_llave=([^;]+)/.exec(galleta)?.[1] ?? ''
const conGalleta = await fetch(base + '/api/overview', {
  headers: { cookie: 'klip_llave=' + valor },
})
check(
  'Con la galleta sola ya se entra, sin repetir el enlace',
  conGalleta.status === 200,
  `${conGalleta.status}`,
)

const galletaMala = await fetch(base + '/api/overview', {
  headers: { cookie: 'klip_llave=inventada' },
})
check('Una galleta falsificada no entra', galletaMala.status === 401, `${galletaMala.status}`)

// Sin LEGACY_KEY_ENABLED la misma llave ya no vale.
delete process.env.LEGACY_KEY_ENABLED
const sinTransicion = await fetch(base + '/api/overview', { headers: { cookie: 'klip_llave=' + valor } })
check('Sin LEGACY_KEY_ENABLED la llave antigua ya no entra', sinTransicion.status === 401, `${sinTransicion.status}`)

delete process.env.REVIEW_KEY


// --- Resultado --------------------------------------------------------------

console.log('')
console.log('='.repeat(78))
console.log('PANEL CONTRA POSTGRES')
console.log('='.repeat(78))
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLA'} ${c.name}`)
  console.log(`        ${c.detail}`)
}

const fallos = checks.filter((c) => !c.ok).length
console.log('')
console.log(`${checks.length - fallos}/${checks.length} comprobaciones pasan.`)
console.log('')

await db.close()
process.exit(fallos === 0 ? 0 : 1)
