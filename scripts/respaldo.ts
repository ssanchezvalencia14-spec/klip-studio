/**
 * Respaldo y restauracion de la base de datos (Fase 8).
 *
 *   npm run respaldo                              hace un respaldo ahora
 *   npm run restaurar -- <fichero.json.gz>        dice que restauraria
 *   npm run restaurar -- <fichero.json.gz> --confirmar
 *
 * El trabajador ya hace uno al dia solo; esto es para hacerlo a mano antes de
 * algo delicado (una migracion, cambiar de proyecto de Supabase).
 *
 * Restaurar no borra ni pisa nada: inserta lo que falte. Para volver a un
 * estado anterior en una base con datos, primero vacia las tablas a mano.
 */
import { parseArgs } from 'node:util'
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { connect } from '../src/store/db.js'
import { leerRespaldo, respaldar, restaurar } from '../src/store/respaldo.js'

loadEnv()
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { restaurar: { type: 'boolean', default: false }, confirmar: { type: 'boolean', default: false } },
})

const db = await connect(requireEnv('DATABASE_URL'))
try {
  if (!values.restaurar) {
    const r = await respaldar(db)
    console.log(`Respaldo hecho: ${r.nombre} (${r.tablas} tablas, ${r.filas} filas, ${r.kb} KB).`)
    console.log('Contiene datos sensibles: guárdalo como el .env, nunca en git ni en un chat.')
  } else {
    const fichero = positionals[0]
    if (fichero === undefined) {
      console.log('Uso: npm run restaurar -- <fichero.json.gz> [--confirmar]')
      process.exitCode = 1
    } else {
      const r = leerRespaldo(fichero)
      const total = Object.values(r.tablas).reduce((n, f) => n + f.length, 0)
      console.log(`Respaldo del ${r.fecha.slice(0, 10)}: ${Object.keys(r.tablas).length} tablas, ${total} filas.`)
      if (!values.confirmar) {
        console.log('No se ha tocado nada. Añade --confirmar para insertar lo que falte (no pisa ni borra nada).')
      } else {
        const res = await restaurar(db, r)
        for (const t of res.filter((x) => x.insertadas > 0)) console.log(`  ${t.tabla}: ${t.insertadas} fila(s) recuperadas`)
        console.log(`Restaurado: ${res.reduce((n, x) => n + x.insertadas, 0)} fila(s) nuevas.`)
      }
    }
  }
} finally {
  await db.close()
}
