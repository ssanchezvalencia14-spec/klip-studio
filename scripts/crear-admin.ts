/**
 * Crea un administrador del panel.
 *
 *   npm run crear-admin -- correo@ejemplo.com "Nombre"
 *
 * Es como se crea el PRIMER usuario: el panel no tiene registro publico. Los
 * siguientes se pueden crear desde el propio panel (Ajustes, Usuarios).
 *
 * La contraseña se pide por teclado y NO se ve al escribirla. Nunca va en la
 * linea de comandos: quedaria en el historial de la consola. Para
 * automatizarlo se puede pasar por la entrada estandar:
 *
 *   echo "contraseña-larga" | npm run crear-admin -- correo@ejemplo.com
 *
 * Usa la DATABASE_URL del .env, la misma base que lee el panel.
 */
import { loadEnv, requireEnv } from '../src/lib/env.js'
import { OWNER_ID } from '../src/lib/owner.js'
import { connect } from '../src/store/db.js'
import { createAuth, ErrorUsuarios, MIN_CONTRASENA, emailValido, normalizarEmail } from '../src/auth/auth.js'

loadEnv()

/** Lee una linea sin mostrarla. Si no hay consola (tuberia), la lee tal cual. */
async function leerOculto(pregunta: string): Promise<string> {
  const entrada = process.stdin
  if (!entrada.isTTY) {
    let texto = ''
    entrada.setEncoding('utf8')
    for await (const t of entrada) texto += t
    return texto.split(/\r?\n/)[0] ?? ''
  }
  process.stdout.write(pregunta)
  entrada.setRawMode(true)
  entrada.resume()
  entrada.setEncoding('utf8')
  return new Promise((resolve) => {
    let valor = ''
    const alPulsar = (c: string): void => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') {
          entrada.setRawMode(false)
          entrada.pause()
          entrada.off('data', alPulsar)
          process.stdout.write('\n')
          resolve(valor)
          return
        }
        if (ch === '\u0003') process.exit(130) // Ctrl+C
        if (ch === '\u007f' || ch === '\b') valor = valor.slice(0, -1)
        else valor += ch
      }
    }
    entrada.on('data', alPulsar)
  })
}

const email = normalizarEmail(process.argv[2] ?? '')
const nombre = process.argv[3] ?? ''

if (!emailValido(email)) {
  console.error('Uso: npm run crear-admin -- correo@ejemplo.com "Nombre"')
  process.exit(1)
}

const db = await connect(requireEnv('DATABASE_URL'))
try {
  const auth = createAuth(db, OWNER_ID)
  const contrasena = await leerOculto(`Contraseña para ${email} (mínimo ${MIN_CONTRASENA} caracteres): `)
  if (process.stdin.isTTY) {
    const otra = await leerOculto('Repítela: ')
    if (otra !== contrasena) {
      console.error('No coinciden. No se ha creado nada.')
      process.exitCode = 1
    }
  }
  if (process.exitCode !== 1) {
    const u = await auth.crear({ email, nombre, rol: 'admin', contrasena })
    console.log(`Administrador creado: ${u.email}. Ya puede entrar en /login.`)
  }
} catch (e) {
  if (e instanceof ErrorUsuarios) {
    console.error(e.message)
    process.exitCode = 1
  } else {
    throw e
  }
} finally {
  await db.close()
}
