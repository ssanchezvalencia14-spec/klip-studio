/**
 * Verificacion del proveedor de upload-post.
 *
 *   npm run verify:uploadpost
 *
 * Lo que se comprueba es UNA sola cosa, y es la que casi sale mal: que un 200
 * no se confunda con una entrega.
 *
 * upload-post responde 200 con `success: true` arriba y mete el resultado de
 * verdad en `results.<plataforma>`. El 2026-10-09 la primera prueba real contra
 * acc-02 devolvio 200 con la bandeja de TikTok llena dentro; el codigo de
 * entonces miraba solo el codigo HTTP y habria marcado el clip como publicado,
 * sacandolo de la cola para siempre sin que nadie lo volviera a intentar.
 *
 * Los cuerpos de abajo son COPIAS LITERALES de respuestas reales de ese dia, no
 * inventadas: el fallo consistia justamente en suponerle a la respuesta una
 * forma que no tenia.
 *
 * Contra un servidor local, sin tocar la API ni gastar subidas.
 */
import { createServer } from 'node:http'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { UploadPostProvider } from '../src/publish/providers/uploadPost.js'

const checks: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}

const BANDEJA_LLENA = JSON.stringify({
  success: true,
  results: {
    tiktok: {
      success: false,
      error: 'Spam_risk_too_many_pending_share. Please wait and try again later..',
      status: 'failed',
    },
  },
  request_id: '8150741948884371911d4e5542c9084f',
  job_id: '47de45f4b7b1497ab15a193922d9a20e',
  status: 'failed',
})

const ENTREGADA = JSON.stringify({
  success: true,
  results: { tiktok: { success: true, status: 'completed' } },
  request_id: '30f0b4b4516a4679845d04e0005a2432',
  job_id: '299d2dd15b6b46919a8c108abfe48b48',
})

const casos: readonly (readonly [string, number, string])[] = [
  ['bandeja', 200, BANDEJA_LLENA],
  ['buena', 200, ENTREGADA],
  ['ilegible', 200, 'no soy json'],
  ['credenciales', 401, '{"error":"invalid key"}'],
  ['servidor', 503, 'upstream down'],
]

const video = join(tmpdir(), 'klip-verify-uploadpost.mp4')
writeFileSync(video, Buffer.alloc(2048))

let i = 0
const srv = createServer((_req, res) => {
  const caso = casos[i]
  res.writeHead(caso?.[1] ?? 500, { 'content-type': 'application/json' })
  res.end(caso?.[2] ?? '')
})
await new Promise<void>((r) => srv.listen(0, r))
const puerto = (srv.address() as { port: number }).port

const correr = async () => {
  const p = new UploadPostProvider('clave-de-prueba', `http://127.0.0.1:${puerto}`)
  return p.publish({
    videoPath: video,
    accountId: 'acc-01',
    caption: 'prueba',
    hashtags: [],
    mode: 'draft',
  })
}

i = 0
const bandeja = await correr()
check(
  'Un 200 con la bandeja llena NO es una entrega',
  !bandeja.ok && bandeja.kind === 'rate_limit',
  `ok=${bandeja.ok} kind=${bandeja.ok ? '-' : bandeja.kind}`,
)
check(
  'Y se reintenta mas tarde, no se descarta',
  !bandeja.ok && bandeja.kind === 'rate_limit' && (bandeja.retryAfterSec ?? 0) > 0,
  `retryAfterSec=${bandeja.ok ? '-' : (bandeja.retryAfterSec ?? 'ninguno')}`,
)

i = 1
const buena = await correr()
check(
  'Una entrega de verdad se reconoce',
  buena.ok && buena.mode === 'draft',
  `ok=${buena.ok}`,
)
check(
  'Y guarda el identificador con el que buscarla despues',
  buena.ok && buena.externalId === '30f0b4b4516a4679845d04e0005a2432',
  `externalId="${buena.ok ? buena.externalId : ''}"`,
)

i = 2
const ilegible = await correr()
check(
  'Un 200 ilegible se reintenta en vez de darse por bueno',
  !ilegible.ok && ilegible.kind === 'transient',
  `ok=${ilegible.ok} kind=${ilegible.ok ? '-' : ilegible.kind}`,
)

i = 3
const auth = await correr()
check(
  'Un 401 se clasifica como credenciales',
  !auth.ok && auth.kind === 'auth',
  `kind=${auth.ok ? '-' : auth.kind}`,
)

i = 4
const caido = await correr()
check(
  'Un 503 es pasajero, no permanente',
  !caido.ok && caido.kind === 'transient',
  `kind=${caido.ok ? '-' : caido.kind}`,
)

srv.close()
rmSync(video, { force: true })

console.log('')
for (const c of checks) {
  console.log(`  ${c.ok ? 'OK  ' : 'FALLA'} ${c.name}`)
  if (!c.ok) console.log(`        ${c.detail}`)
}
const malos = checks.filter((c) => !c.ok).length
console.log('')
console.log(`${checks.length - malos} de ${checks.length} comprobaciones pasan.`)
if (malos > 0) process.exitCode = 1
