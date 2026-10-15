/**
 * Lista las cuentas del ALMACEN DE FICHERO. Ya no crea ninguna.
 *
 *   npm run accounts      lista lo que haya en state/accounts.json
 *
 * CUIDADO CON ESTE GUION. Lee `state/accounts.json`, que es el almacen viejo:
 * el programa dejo de usarlo el 2026-09-13 y desde entonces las cuentas de
 * verdad viven en Postgres. El fichero sigue ahi, congelado en el 26 de
 * septiembre, y lo que enseña no es lo que publica.
 *
 * Se conserva solo para poder mirar ese fichero cuando haga falta comparar.
 *
 * `--init` se quito a proposito. Creaba cuentas en el fichero muerto y decia
 * "20 cuentas creadas" sin que apareciera ninguna en el panel ni recibiera
 * ningun video: un comando que dice que funciono y no hace nada es peor que
 * uno que no existe. Ademas era el unico sitio sin tope, asi que por aqui se
 * creaban las que fueran y despues el panel se negaba.
 *
 * Las cuentas se crean en el panel: Ajustes, Cuentas. El tope lo pone
 * `maxCuentas` en Horarios.
 */
import { parseArgs } from 'node:util'
import { loadEnv } from '../src/lib/env.js'
import { accounts } from '../src/store/store.js'

function formatHour(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour % 1) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

async function main(): Promise<void> {
  loadEnv()

  const { values } = parseArgs({
    options: {
      // Se sigue aceptando para poder explicar por que ya no hace nada.
      init: { type: 'string' },
    },
  })

  if (values.init !== undefined) {
    console.error('--init ya no existe: creaba cuentas en un fichero que el programa no lee.')
    console.error('Crealas en el panel, en Ajustes > Cuentas.')
    process.exitCode = 1
    return
  }

  const rows = accounts.all()
  if (rows.length === 0) {
    console.log('No hay ninguna cuenta. Creala en Ajustes, en Cuentas.')
    return
  }

  console.log('')
  console.log(`${'ID'.padEnd(8)} ${'ESTADO'.padEnd(8)} ${'TOKEN'.padEnd(8)} FRANJAS`)
  console.log('-'.repeat(52))
  for (const account of rows) {
    console.log(
      `${account.id.padEnd(8)} ${account.status.padEnd(8)} ${account.tokenStatus.padEnd(8)} ` +
        account.slots.map(formatHour).join('  '),
    )
  }
  console.log('')
  console.log(`Total: ${rows.length} cuentas, ${rows.length * (rows[0]?.slots.length ?? 0)} huecos diarios.`)
}

await main()
