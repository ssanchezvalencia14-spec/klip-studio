/**
 * Rellena el checksum de los items de cola que se encolaron sin el.
 *
 *   npm run arreglar:checksums -- [--aplicar]
 *
 * POR QUE HIZO FALTA. La cola tiene un indice unico sobre
 * (owner_id, account_id, checksum) para que el mismo archivo no se publique dos
 * veces en la misma cuenta. Los doce clips de ZOTI se encolaron con un script
 * de mano que dejaba el checksum vacio, asi que para ese indice los doce eran
 * el mismo video: solo cabia uno, y los once restantes no llegaban a Postgres.
 *
 * El indice no esta mal; lo que estaba mal era encolar sin calcular el dato del
 * que depende.
 *
 * En seco por defecto: enseña lo que haria y no toca nada.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { loadEnv } from '../src/lib/env.js'
import { queue } from '../src/store/store.js'

/** sha256 del archivo, leido por trozos: un master ronda los 20 MB. */
async function hash(path: string): Promise<string> {
  const h = createHash('sha256')
  for await (const trozo of createReadStream(path)) h.update(trozo as Buffer)
  return h.digest('hex')
}

loadEnv()

const { values } = parseArgs({ options: { aplicar: { type: 'boolean', default: false } } })

const todos = queue.all()
const sinChecksum = todos.filter((q) => q.checksum === '')

console.log(`${todos.length} items en la cola, ${sinChecksum.length} sin checksum`)
if (sinChecksum.length === 0) process.exit(0)

const nuevos = new Map<string, string>()
let perdidos = 0

for (const q of sinChecksum) {
  if (!existsSync(q.variantPath)) {
    console.log(`  ${q.id}: FALTA el archivo ${q.variantPath}`)
    perdidos++
    continue
  }
  const suma = await hash(q.variantPath)
  nuevos.set(q.id, suma)
  console.log(`  ${q.id}  ${suma.slice(0, 12)}`)
}

/*
 * Se comprueba que no salgan dos iguales ANTES de escribir.
 *
 * Si dos items apuntan al mismo archivo y a la misma cuenta, el indice los
 * rechazaria igual y volveriamos a quedarnos a medias. Mejor verlo aqui, con el
 * nombre de los dos delante, que en un error de clave duplicada.
 */
const vistos = new Map<string, string>()
let choques = 0
for (const q of sinChecksum) {
  const suma = nuevos.get(q.id)
  if (suma === undefined) continue
  const clave = `${q.accountId}|${suma}`
  const antes = vistos.get(clave)
  if (antes !== undefined) {
    console.log(`  CHOQUE: ${q.id} y ${antes} son el mismo archivo para ${q.accountId}`)
    choques++
  }
  vistos.set(clave, q.id)
}

console.log('')
console.log(`Calculados ${nuevos.size} | sin archivo ${perdidos} | choques ${choques}`)

if (!values.aplicar) {
  console.log('')
  console.log('En seco. Para escribirlo: npm run arreglar:checksums -- --aplicar')
  process.exit(0)
}

if (choques > 0) {
  console.error('Hay choques. No se escribe nada: resuelvelos antes.')
  process.exit(1)
}

for (const [id, suma] of nuevos) queue.update(id, { checksum: suma })
console.log(`Escritos ${nuevos.size} checksums. Ahora: npm run db:migrate`)
