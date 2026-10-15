/**
 * Vacia el CONTENIDO del panel y conserva la configuracion.
 *
 *   npm run vaciar              <- solo cuenta, no borra nada
 *   npm run vaciar -- --de-verdad
 *
 * Se escribio para cerrar la fase de pruebas: despues de semanas probando hay
 * VODs de prueba, clips descartados a mano, publicaciones simuladas y metricas
 * que no significan nada, y todo eso ensucia las cifras de los primeros dias de
 * operacion real.
 *
 * QUE BORRA
 *   sources   los videos de origen
 *   clips     los momentos (caen solos por la clave ajena, pero se cuentan)
 *   queue     la cola de publicacion
 *   posts     lo publicado
 *   metrics   sus metricas (caen solas con posts)
 *   jobs      las tareas lanzadas
 *   runs      el historial de ejecuciones
 *
 * QUE NO TOCA, y es lo importante
 *   accounts       las cuentas, CON su enlace de TikTok. Volver a autorizar
 *                  ocho perfiles a mano es media tarde.
 *   tiktok_tokens  los permisos ya concedidos.
 *   clientes       y campanas.
 *   settings       y plantillas: los ajustes afinados no se tiran.
 *
 * Tampoco toca NINGUN fichero: los MP4 de work/ y out/ y las copias en la nube
 * se quedan donde estan. Para esas hay otro guion, limpiar-nube.ts.
 *
 * SIN --de-verdad solo cuenta. Un borrado irreversible no puede ser el
 * comportamiento por defecto de un comando que se teclea con prisa.
 */
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { connect } from '../src/store/db.js'
import { OWNER_ID } from '../src/lib/owner.js'

loadEnv()

/*
 * El orden importa aunque la base tenga borrado en cascada.
 *
 * metrics cuelga de posts y clips de sources, asi que borrar el padre se
 * llevaria al hijo por delante. Se hace explicito igualmente para poder CONTAR
 * cada tabla: un "borrados 14" que en realidad se llevo 85 clips y 225
 * publicaciones no es un informe, es una sorpresa.
 */
const TABLAS = ['metrics', 'posts', 'queue', 'clips', 'sources', 'jobs', 'runs'] as const

/** Lo que tiene que seguir en pie al terminar. Se comprueba, no se supone. */
const INTOCABLES = ['accounts', 'tiktok_tokens', 'clientes', 'campanas', 'settings', 'plantillas'] as const

const deVerdad = process.argv.includes('--de-verdad')

const db = await connect(requireEnv('DATABASE_URL'))

async function contar(tabla: string): Promise<number> {
  const filas = await db.query<{ n: string }>(
    `select count(*)::text as n from ${tabla} where owner_id = $1`,
    [OWNER_ID],
  )
  return Number(filas[0]?.n ?? 0)
}

const antes: Record<string, number> = {}
for (const t of [...TABLAS, ...INTOCABLES]) antes[t] = await contar(t)

console.log('')
console.log('SE BORRA')
for (const t of TABLAS) console.log(`  ${t.padEnd(10)} ${antes[t]}`)
console.log('')
console.log('SE CONSERVA')
for (const t of INTOCABLES) console.log(`  ${t.padEnd(14)} ${antes[t]}`)
console.log('')

if (!deVerdad) {
  console.log('Esto ha sido solo el recuento. Para borrarlo de verdad:')
  console.log('  npm run vaciar -- --de-verdad')
  console.log('')
  process.exit(0)
}

/*
 * Todo en UNA sentencia, que es lo que la hace atomica aqui.
 *
 * El primer intento abria una transaccion con BEGIN y el driver la rechazo:
 * sobre un grupo de conexiones no puede garantizar que las siguientes ordenes
 * vayan por el mismo socket, asi que un BEGIN suelto podria quedarse abierto
 * en una conexion y las bajas irse por otra. Es una proteccion suya, y tiene
 * razon.
 *
 * Un solo SELECT con siete CTE que borran es equivalente y no necesita
 * transaccion explicita: PostgreSQL ejecuta la sentencia entera o ninguna
 * parte de ella. Y de paso devuelve la cuenta de cada tabla, que es lo que se
 * queria del RETURNING.
 *
 * Que metrics cuelgue de posts en cascada no estorba: las filas que ya se
 * llevo su propia CTE simplemente no estan cuando la cascada pasa por ahi.
 */
const [cuenta] = await db.query<Record<string, string>>(
  `with
     m as (delete from metrics where owner_id = $1 returning 1),
     p as (delete from posts   where owner_id = $1 returning 1),
     q as (delete from queue   where owner_id = $1 returning 1),
     c as (delete from clips   where owner_id = $1 returning 1),
     s as (delete from sources where owner_id = $1 returning 1),
     j as (delete from jobs    where owner_id = $1 returning 1),
     r as (delete from runs    where owner_id = $1 returning 1)
   select (select count(*)::text from m) as metrics,
          (select count(*)::text from p) as posts,
          (select count(*)::text from q) as queue,
          (select count(*)::text from c) as clips,
          (select count(*)::text from s) as sources,
          (select count(*)::text from j) as jobs,
          (select count(*)::text from r) as runs`,
  [OWNER_ID],
)

for (const t of TABLAS) console.log(`  ${t.padEnd(10)} ${cuenta?.[t] ?? '?'} borrados`)

console.log('')

/*
 * Se vuelve a contar DESPUES, y tambien lo que no se debia tocar.
 *
 * Es la unica forma de decir "la configuracion sigue ahi" sin que sea una
 * suposicion. Una clave ajena en cascada mal puesta en una migracion futura se
 * llevaria las cuentas por delante al borrar las fuentes, y esto lo cazaria el
 * mismo dia en vez de el dia que alguien intente publicar.
 */
let mal = false
for (const t of INTOCABLES) {
  const ahora = await contar(t)
  const ok = ahora === antes[t]
  if (!ok) mal = true
  console.log(`  ${ok ? 'OK ' : 'MAL'}  ${t.padEnd(14)} ${antes[t]} -> ${ahora}`)
}

console.log('')
if (mal) {
  console.error('ALGO DE LA CONFIGURACION SE PERDIO. Mirarlo antes de publicar nada.')
  process.exit(1)
}
console.log('Panel vacio. Las cuentas, los clientes y los ajustes siguen en su sitio.')
console.log('Los MP4 de work/ y out/ no se han tocado.')
console.log('')
