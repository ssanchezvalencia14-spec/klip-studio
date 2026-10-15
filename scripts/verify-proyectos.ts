/**
 * Comprueba clientes y campañas contra la base real.
 *
 *   npm run verify:proyectos
 *
 * Contra la base de verdad y no contra una simulada: lo que se quiere verificar
 * son los indices unicos y el ON DELETE SET NULL, que viven en Postgres. Un
 * doble de pruebas los daria por buenos sin ejecutarlos.
 *
 * Crea filas con un prefijo reconocible y las borra al final, pase lo que pase.
 */
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { connect } from '../src/store/db.js'
import { crearProyectos, ProyectoError } from '../src/store/proyectos.js'

loadEnv()

const PREFIJO = '__verify__'
let fallos = 0

function ok(bien: boolean, que: string): void {
  console.log(`  ${bien ? 'ok  ' : 'FALLO'} ${que}`)
  if (!bien) fallos++
}

/** Espera que la promesa reviente con ProyectoError. */
async function rechaza(fn: () => Promise<unknown>, que: string): Promise<void> {
  try {
    await fn()
    ok(false, `${que} (no dio error)`)
  } catch (error) {
    ok(error instanceof ProyectoError, `${que}${error instanceof ProyectoError ? '' : ` (dio ${error})`}`)
  }
}

const db = await connect(requireEnv('DATABASE_URL'))
const p = crearProyectos(db, OWNER_ID)

/** Se restaura al final para no dejar tocada una cuenta real. */
const CUENTA = 'acc-20'

/*
 * A que cliente pertenecia ANTES de empezar.
 *
 * Se guarda y se devuelve tal cual al terminar. Poner null a pelo, que es lo
 * que hacia la primera version, borra la asignacion el dia que esa cuenta
 * tenga dueño: la prueba pasaria igual y el dato se perderia sin ruido.
 */
const clientePrevio = (
  await db.query<{ cliente_id: string | null }>(
    `select cliente_id from accounts where owner_id = $1 and id = $2`,
    [OWNER_ID, CUENTA],
  )
)[0]?.cliente_id ?? null

try {
  console.log('Nombres')
  await rechaza(() => p.crearCliente('   '), 'un nombre en blanco se rechaza')
  await rechaza(() => p.crearCliente('x'.repeat(81)), 'un nombre larguisimo se rechaza')

  console.log('')
  console.log('Clientes')
  const a = await p.crearCliente(`${PREFIJO}-uno`, 'notas de prueba')
  ok(a.id !== undefined && a.cuentas === 0, 'se crea y empieza sin cuentas')
  await rechaza(() => p.crearCliente(`${PREFIJO}-UNO`), 'no admite el mismo nombre en otra caja')

  const b = await p.crearCliente(`${PREFIJO}-dos`)

  console.log('')
  console.log('Campañas')
  const c1 = await p.crearCampana(a.id, 'Lanzamiento')
  await rechaza(() => p.crearCampana(a.id, 'lanzamiento'), 'no se repite dentro del mismo cliente')
  const c2 = await p.crearCampana(b.id, 'Lanzamiento')
  ok(c2.id !== c1.id, 'el mismo nombre si vale en otro cliente')
  await rechaza(
    () => p.crearCampana('00000000-0000-0000-0000-000000000000', 'X'),
    'una campaña de un cliente inexistente se rechaza',
  )

  console.log('')
  console.log('Asignaciones')
  await p.asignarCuenta(CUENTA, a.id)
  const conCuenta = (await p.clientes()).find((x) => x.id === a.id)
  ok(conCuenta?.cuentas === 1, 'la cuenta cuenta en su cliente')
  ok(conCuenta?.campanas === 1, 'y la campaña tambien, sin inflarse entre si')

  await rechaza(() => p.asignarCuenta('acc-noexiste', a.id), 'una cuenta inexistente se rechaza')

  /*
   * Un VOD QUE NO TENGA CAMPAÑA, y se restaura igualmente.
   *
   * La primera version cogia `limit 1` sin mirar, lo asignaba a la campaña de
   * prueba y lo dejaba en null al terminar. Eso no es una prueba: es un borrado
   * silencioso de datos reales cada vez que alguien la ejecuta. Se comio la
   * campaña de tres de las cuatro canciones de ZOTI antes de que se notara,
   * porque el sintoma solo se ve mirando el panel.
   */
  const algunVod = await db.query<{ id: string }>(
    `select id from sources where owner_id = $1 and campana_id is null limit 1`,
    [OWNER_ID],
  )
  const vod = algunVod[0]?.id
  if (vod !== undefined) {
    await p.asignarVod(vod, c1.id)
    const campanas = await p.campanas(a.id)
    ok(campanas[0]?.vods === 1, 'el VOD cuenta en su campaña')
    await p.asignarVod(vod, null)
    ok((await p.campanas(a.id))[0]?.vods === 0, 'y se puede desasignar')
  } else {
    console.log('  (sin VOD en la base, no se comprueba esa parte)')
  }

  console.log('')
  console.log('Borrado')
  await rechaza(() => p.borrarCliente(a.id), 'no deja borrar un cliente con campañas')

  await p.borrarCampana(c1.id)
  await p.borrarCliente(a.id)

  /*
   * Lo importante de todo el fichero.
   *
   * La cuenta guarda el permiso de TikTok en tiktok_tokens. Si borrar un
   * cliente se llevara la cuenta por delante, ese permiso quedaria huerfano y
   * habria que pedirle al titular que volviera a autorizar por un borrado que
   * nadie penso que tocara eso.
   */
  const sobrevive = await db.query<{ cliente_id: string | null }>(
    `select cliente_id from accounts where owner_id = $1 and id = $2`,
    [OWNER_ID, CUENTA],
  )
  ok(sobrevive.length === 1, 'borrar el cliente NO borra su cuenta')
  ok(sobrevive[0]?.cliente_id === null, 'la cuenta queda sin asignar, no apuntando a un fantasma')

  const token = await db.query(
    `select 1 from tiktok_tokens where owner_id = $1 and account_id = 'acc-01'`,
    [OWNER_ID],
  )
  ok(token.length === 1, 'el permiso de acc-01 sigue intacto')
} finally {
  // Pase lo que pase: nada con el prefijo se queda, y la cuenta vuelve a como
  // estaba. Un fallo a medias no debe dejar basura en la base de produccion.
  await db.query(
    `delete from campanas where owner_id = $1
      and cliente_id in (select id from clientes where owner_id = $1 and nombre like $2)`,
    [OWNER_ID, `${PREFIJO}%`],
  )
  await db.query(`delete from clientes where owner_id = $1 and nombre like $2`, [
    OWNER_ID,
    `${PREFIJO}%`,
  ])
  await db.query(`update accounts set cliente_id = $3 where owner_id = $1 and id = $2`, [
    OWNER_ID,
    CUENTA,
    clientePrevio,
  ])
  await db.close()
}

console.log('')
console.log(fallos === 0 ? 'Todo correcto.' : `${fallos} comprobacion(es) fallaron.`)
process.exitCode = fallos === 0 ? 0 : 1
