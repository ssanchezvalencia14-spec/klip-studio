/**
 * Libera espacio en la nube borrando copias que ya no hacen falta.
 *
 *   npm run limpiar                 enseña que borraria y cuanto libera
 *   npm run limpiar -- --aplicar    lo borra de verdad
 *
 * POR QUE HACE FALTA. El panel avisa al 70% del plan gratuito de que "las de
 * los VOD que ya no revises se pueden borrar", pero no habia ninguna forma de
 * hacerlo: el aviso pedia una accion que no existia. Cuando el cubo se llena,
 * `subir` falla y el equipo deja de poder revisar desde el movil.
 *
 * QUE SE BORRA Y QUE NO. Solo la copia de revision, nunca el master: ese sigue
 * en este ordenador y es lo que se publica. Borrar una copia solo significa que
 * ese clip deja de verse desde el movil.
 *
 *   descartados  el equipo ya dijo que no. No se van a volver a mirar.
 *   publicados   ya salieron a TikTok. Revisarlos otra vez no cambia nada.
 *
 * Los pendientes y los aprobados-sin-publicar NO se tocan: son justo los que
 * alguien tiene que poder ver.
 *
 * En seco por defecto. Borrar en la nube no se deshace.
 */
import { parseArgs } from 'node:util'
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { connect } from '../src/store/db.js'
import { crearNube } from '../src/store/nube.js'

loadEnv()

const { values } = parseArgs({ options: { aplicar: { type: 'boolean', default: false } } })

const db = await connect(requireEnv('DATABASE_URL'))
const nube = crearNube()

if (nube === null) {
  console.error('Falta SUPABASE_SERVICE_ROLE_KEY. Sin ella no se puede tocar la nube.')
  process.exitCode = 1
  await db.close()
  process.exit()
}

interface Fila {
  source_id: string
  clip_id: string
  proxy_path: string
  proxy_bytes: number
  status: string
}

/*
 * Un clip esta publicado si tiene alguna fila en `posts`.
 *
 * No basta con mirar su estado: 'approved' significa que alguien le dio el
 * visto bueno, no que haya salido. Lo que dice que ya salio es la tabla de
 * publicaciones.
 */
const filas = await db.query<Fila>(
  `select c.source_id, c.clip_id, c.proxy_path, c.proxy_bytes, c.status
     from clips c
    where c.owner_id = $1
      and c.proxy_path <> ''
      and (
        c.status = 'rejected'
        or (
          /*
           * Aprobado Y publicado. Las dos condiciones.
           *
           * No basta con que tenga publicaciones: hay clips en 'pending' que
           * salieron porque se encolaron a mano. Borrarles la copia los dejaria
           * en Revisar videos sin video que ver, que es justo la pantalla donde
           * alguien tiene que decidir sobre ellos.
           */
          c.status = 'approved'
          and exists (
            select 1 from posts p
             where p.owner_id = c.owner_id
               and p.source_id = c.source_id
               and p.clip_id = c.clip_id
          )
        )
      )
    order by c.source_id, c.clip_id`,
  [OWNER_ID],
)

const total = await db.query<{ n: string; bytes: string }>(
  `select count(*)::text n, coalesce(sum(proxy_bytes), 0)::text bytes
     from clips where owner_id = $1 and proxy_path <> ''`,
  [OWNER_ID],
)

const ocupado = Number(total[0]?.bytes ?? 0) / 1048576
const liberables = filas.reduce((n, f) => n + f.proxy_bytes, 0) / 1048576

console.log(`En la nube: ${total[0]?.n} copia(s), ${ocupado.toFixed(0)} MB de 1024`)
console.log('')

if (filas.length === 0) {
  console.log('No hay nada que liberar: ninguna copia pertenece a un clip descartado ni publicado.')
  await db.close()
  process.exit()
}

const porEstado = new Map<string, number>()
for (const f of filas) porEstado.set(f.status, (porEstado.get(f.status) ?? 0) + 1)

console.log(`Se pueden borrar ${filas.length} copia(s), ${liberables.toFixed(0)} MB:`)
for (const [estado, n] of porEstado) {
  console.log(`  ${n} ${estado === 'rejected' ? 'descartado(s)' : `${estado}, ya publicado(s)`}`)
}
console.log('')
console.log(`Quedaria en ${(ocupado - liberables).toFixed(0)} MB.`)

if (!values.aplicar) {
  console.log('')
  console.log('En seco. Para borrarlas de verdad: npm run limpiar -- --aplicar')
  await db.close()
  process.exit()
}

/*
 * Se borra en la nube ANTES de olvidar la ruta en la base.
 *
 * Al reves, un fallo a mitad dejaria ficheros en el cubo sin ninguna fila que
 * los nombre: ocupando sitio para siempre y sin forma de encontrarlos. Asi, un
 * fallo deja la fila intacta y basta con repetir el comando.
 */
await nube.borrar(filas.map((f) => f.proxy_path))

await db.query(
  `update clips set proxy_path = '', proxy_bytes = 0
    where owner_id = $1 and proxy_path = any($2)`,
  [OWNER_ID, filas.map((f) => f.proxy_path)],
)

console.log('')
console.log(`Borradas ${filas.length} copia(s). Liberados ${liberables.toFixed(0)} MB.`)
console.log('Los masters siguen intactos en este ordenador.')

await db.close()
