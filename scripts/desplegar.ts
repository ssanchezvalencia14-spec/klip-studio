/**
 * Sube el panel a Hostinger y lanza la construccion.
 *
 *   npm run desplegar
 *
 * Existe porque el despliegue se hacia a mano cada vez: construir, empaquetar
 * con rutas en barra normal, pedir credenciales, subir por TUS y arrancar el
 * build. Cinco pasos, y olvidar uno deja el sitio caido o construyendo contra
 * un paquete viejo.
 *
 * NO EMPAQUETA CON LA UTILIDAD DE WINDOWS. Compress-Archive escribe las rutas
 * con barra invertida y el descompresor del servidor las toma como parte del
 * nombre: todo acaba plano en la raiz y el build no encuentra package.json.
 * Por eso el zip se escribe aqui a mano.
 *
 * NECESITA HOSTINGER_API_TOKEN en el .env. Es el mismo token del panel de
 * Hostinger (Cuenta, API). Da control total sobre la cuenta, asi que vive en el
 * .env y no en ningun sitio versionado.
 *
 * Comprueba ANTES de construir que el paquete llego: el build consume el
 * archivo, y si arranca sin fuentes falla en ocho segundos con el registro
 * vacio, que es de los errores mas dificiles de leer.
 */
import { createWriteStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { crc32 } from 'node:zlib'
import { loadEnv, requireEnv, ROOT } from '../src/lib/env.js'

loadEnv()

/*
 * A donde se despliega. Sale del entorno, no del codigo.
 *
 * Estaban escritos aqui, y el repositorio es publico: el dominio del panel y
 * el usuario de la cuenta de Hostinger juntos son dos de los tres datos que
 * hacen falta para hostigar esa cuenta. El tercero es el token, que nunca ha
 * estado en el repositorio.
 *
 * Ademas cada cual despliega al suyo: con los valores cosidos, un companero
 * que clone esto y ejecute `npm run desplegar` publicaria en el servidor de
 * otro sin enterarse.
 */
const DOMINIO = requireEnv('HOSTINGER_DOMINIO')
const USUARIO = requireEnv('HOSTINGER_USUARIO')

/** Lo que nunca viaja: secretos, material pesado y lo regenerable. */
const FUERA = new Set(['node_modules', 'dist', '.git', 'work', 'out', 'state', '.claude', 'graphify-out'])
const RAICES = ['src', 'scripts', 'db']
const SUELTOS = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']

async function listar(dir: string): Promise<string[]> {
  const salida: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (FUERA.has(e.name) || e.name.startsWith('.env')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) salida.push(...(await listar(p)))
    else salida.push(p)
  }
  return salida
}

async function empaquetar(destino: string): Promise<number> {
  const archivos: string[] = []
  for (const r of RAICES) archivos.push(...(await listar(join(ROOT, r))))
  for (const f of SUELTOS) archivos.push(join(ROOT, f))

  const out = createWriteStream(destino)
  const central: Buffer[] = []
  let offset = 0
  const escribir = (b: Buffer): Promise<void> =>
    new Promise((res) => {
      out.write(b, () => res())
    })

  for (const abs of archivos) {
    const datos = await readFile(abs)
    // Barras normales SIEMPRE, pase lo que pase en este sistema operativo.
    const nombre = relative(ROOT, abs).replaceAll('\\', '/')
    const nb = Buffer.from(nombre, 'utf8')
    const suma = crc32(datos)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // nombre en UTF-8
    local.writeUInt32LE(suma, 14)
    local.writeUInt32LE(datos.length, 18)
    local.writeUInt32LE(datos.length, 22)
    local.writeUInt16LE(nb.length, 26)
    await escribir(local)
    await escribir(nb)
    await escribir(datos)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt32LE(suma, 16)
    cen.writeUInt32LE(datos.length, 20)
    cen.writeUInt32LE(datos.length, 24)
    cen.writeUInt16LE(nb.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cen, nb]))
    offset += 30 + nb.length + datos.length
  }

  const dir = Buffer.concat(central)
  await escribir(dir)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(archivos.length, 8)
  fin.writeUInt16LE(archivos.length, 10)
  fin.writeUInt32LE(dir.length, 12)
  fin.writeUInt32LE(offset, 16)
  await escribir(fin)
  await new Promise((res) => out.end(res))

  console.log(`  ${archivos.length} archivos, ${(offset / 1048576).toFixed(2)} MB`)
  return archivos.length
}

async function api<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://developers.hostinger.com${ruta}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requireEnv('HOSTINGER_API_TOKEN')}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const cuerpo = (await res.json()) as T
  if (!res.ok) throw new Error(`${ruta}: HTTP ${res.status} ${JSON.stringify(cuerpo).slice(0, 200)}`)
  return cuerpo
}

const ZIP = join(ROOT, 'klip-deploy.zip')

console.log('1. Empaquetando fuentes...')
await empaquetar(ZIP)
const bytes = (await stat(ZIP)).size

console.log('2. Pidiendo credenciales de subida...')
/*
 * POST con cuerpo, y la ruta SIN usuario ni dominio dentro.
 *
 * Hostinger reorganizo su API: lo que era
 * `GET /subscriptions/{usuario}/files/upload-url?domain=X` es ahora
 * `POST /files/upload-urls` con los dos datos en el cuerpo, y en plural.
 *
 * El 2026-10-05 el despliegue murio aqui con un 404 pelado. Probar siete rutas
 * parecidas a ojo dio otros siete 404: la buena solo sale de la especificacion,
 * en https://developers.hostinger.com/openapi/openapi.json. Si esto vuelve a
 * dar 404, ese fichero es el sitio donde mirar, no la documentacion en prosa.
 */
const cred = await api<{ url: string; auth_key: string; rest_auth_key: string }>(
  '/api/hosting/v1/files/upload-urls',
  { method: 'POST', body: JSON.stringify({ username: USUARIO, domain: DOMINIO }) },
)

console.log('3. Subiendo...')
const cab = {
  'X-Auth': cred.auth_key,
  'X-Auth-Rest': cred.rest_auth_key,
  'Tus-Resumable': '1.0.0',
}
const crear = await fetch(`${cred.url}/klip.zip?override=true`, {
  method: 'POST',
  headers: { ...cab, 'Upload-Length': String(bytes), 'Upload-Offset': '0' },
})
if (crear.status !== 201) throw new Error(`crear subida: HTTP ${crear.status}`)

const enviar = await fetch(`${cred.url}/klip.zip?override=true`, {
  method: 'PATCH',
  headers: { ...cab, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': '0' },
  body: await readFile(ZIP),
})
const subido = Number(enviar.headers.get('upload-offset') ?? 0)
if (subido !== bytes) throw new Error(`subida incompleta: ${subido} de ${bytes}`)
console.log(`  ${subido} bytes confirmados`)

console.log('4. Lanzando la construccion...')
/*
 * Estos parametros NO se improvisan.
 *
 * `output_directory` vacio es lo unico que ha funcionado: con "dist" el
 * servidor aplana el directorio, el fichero de entrada desaparece y el sitio
 * se cae. Paso el 2026-09-24 y costo 82 segundos de produccion.
 */
// La misma reorganizacion: el usuario y el dominio van en la ruta, bajo
// /accounts/{usuario}/websites/{dominio}/, no como parametros sueltos.
const build = await api<{ uuid: string }>(
  `/api/hosting/v1/accounts/${USUARIO}/websites/${DOMINIO}/nodejs/builds`,
  {
    method: 'POST',
    body: JSON.stringify({
      node_version: 24,
      app_type: 'express',
      root_directory: '',
      output_directory: '',
      build_script: 'build',
      entry_file: 'dist/scripts/review.js',
      package_manager: 'npm',
      source_type: 'archive',
      source_options: { archive_path: 'klip.zip' },
    }),
  },
)
console.log(`  build ${build.uuid}`)
console.log('')
console.log('Listo. Comprueba con: npm run tiktok -- estado, y abre el panel.')
