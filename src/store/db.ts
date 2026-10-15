/**
 * La conexion a Postgres, detras de una interfaz minima.
 *
 * El adaptador no habla con el paquete `postgres` directamente, sino con este
 * `Db` de dos metodos. Es lo que permite ejecutar EL MISMO codigo contra la
 * base real y contra PGlite, que es Postgres compilado a WebAssembly y corre
 * dentro de Node sin instalar nada.
 *
 * Sin esta capa, las pruebas tendrian que imitar a mano lo que hace Postgres, y
 * una imitacion nunca falla igual que la cosa real: las restricciones, los
 * tipos de columna y los borrados en cascada solo se comprueban de verdad
 * contra un motor de verdad.
 */

export interface Db {
  /** Consulta con parametros numerados ($1, $2...). Devuelve las filas. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

/**
 * Conexion a la base de datos real.
 *
 * Se importa el paquete de forma perezosa para que los scripts que no tocan la
 * base (render, variants) no carguen el cliente ni abran sockets.
 */
export async function connect(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres')

  const sql = postgres(url, {
    // `max: 4` y no el valor por defecto: el panel y el trabajador comparten la
    // base, y el plan gratuito de Supabase corta en 60 conexiones. Cuatro por
    // proceso deja sitio de sobra para varios procesos a la vez.
    max: 4,
    prepare: false,

    /*
     * Los avisos se descartan.
     *
     * Aplicar el esquema imprime un NOTICE por cada tabla e indice que ya
     * existe ("relation X already exists, skipping"), que es exactamente lo
     * que se le pidio con "if not exists". Son treinta bloques de texto que
     * parecen errores y no lo son, y entre ellos se pierde un error de verdad.
     */
    onnotice: () => {},
  })

  return {
    query: async <T>(text: string, params: unknown[] = []): Promise<T[]> => {
      const rows = await sql.unsafe(text, params as never[])
      return rows as unknown as T[]
    },
    close: async (): Promise<void> => {
      await sql.end({ timeout: 5 })
    },
  }
}
