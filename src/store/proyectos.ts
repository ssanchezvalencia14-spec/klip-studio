import type { Db } from './db.js'

/**
 * Clientes y campañas.
 *
 * Dos niveles: el cliente paga y persiste, la campaña es un lanzamiento suyo y
 * termina. Las cuentas de TikTok cuelgan del cliente; los VOD, de la campaña.
 * El porque de ese reparto esta en db/008-proyectos.sql.
 *
 * Modulo aparte de pg.ts a proposito: aquel es el almacen del flujo de trabajo
 * (clips, cola, publicaciones) y ya pasa de las cuatrocientas lineas. Esto es
 * organizacion, se toca por otros motivos y en otros momentos.
 */

/** Lo que el panel enseña mal si se pasa por alto: nombres repetidos, vacios. */
export class ProyectoError extends Error {}

/**
 * El perfil de publicacion de un cliente.
 *
 * NULO SIGNIFICA "LO QUE DIGA EL AJUSTE GENERAL", no cero. Un cliente recien
 * creado se comporta como antes y solo se aparta cuando alguien lo aparta.
 */
export interface Perfil {
  postsPerDay: number | null
  dayStartHour: number | null
  dayEndHour: number | null
}

export interface Cliente {
  id: string
  nombre: string
  archivado: boolean
  notas: string
  /** Cuantas cuentas tiene asignadas. Lo pide la lista para no pedirlo aparte. */
  cuentas: number
  campanas: number
  perfil: Perfil
}

export interface Campana {
  id: string
  clienteId: string
  clienteNombre: string
  nombre: string
  estado: 'activa' | 'pausada' | 'terminada'
  notas: string
  /** VOD asignados a esta campaña. */
  vods: number
}

const ESTADOS = ['activa', 'pausada', 'terminada'] as const

/**
 * Deja un nombre en algo guardable, o explica por que no lo es.
 *
 * Se recorta antes de comprobar si esta vacio: "   " es un nombre vacio escrito
 * con espacios, y guardarlo produce una fila que en el panel no se ve pero
 * ocupa el hueco del nombre unico.
 */
function limpiarNombre(raw: unknown, que: string): string {
  if (typeof raw !== 'string') throw new ProyectoError(`Falta el nombre ${que}.`)
  const nombre = raw.trim().replace(/\s+/g, ' ')
  if (nombre === '') throw new ProyectoError(`El nombre ${que} no puede estar vacio.`)
  if (nombre.length > 80) throw new ProyectoError(`El nombre ${que} no puede pasar de 80 caracteres.`)
  return nombre
}

/**
 * Traduce el choque contra el indice unico a algo que se pueda leer.
 *
 * Sin esto el panel enseñaria "duplicate key value violates unique constraint
 * clientes_nombre_idx", que no le dice nada a quien solo queria crear un
 * cliente que ya existia.
 */
function esDuplicado(error: unknown): boolean {
  const e = error as { code?: string; message?: string }
  return e?.code === '23505' || /duplicate key/i.test(e?.message ?? '')
}

/** Una cuenta con a quien pertenece y si esta enlazada con TikTok. */
export interface CuentaAsignada {
  id: string
  label: string
  clienteId: string | null
  /** El @ de TikTok, vacio si nadie la ha autorizado todavia. */
  tiktok: string
  /**
   * Si entra en el reparto.
   *
   * Hace falta aqui porque es lo unico que decide si una cuenta recibe videos.
   * Con upload-post es ADEMAS el unico filtro que existe: alli el programa no
   * puede comprobar que el perfil este dado de alta, asi que una cuenta activa
   * de mas se lleva su parte del reparto y luego falla entrega por entrega.
   */
  activa: boolean
}

/** Un VOD con a que campaña pertenece. */
export interface VodAsignado {
  sourceId: string
  title: string
  campanaId: string | null
}

export interface Asignaciones {
  cuentas: CuentaAsignada[]
  vods: VodAsignado[]
}

export interface Proyectos {
  clientes(incluirArchivados?: boolean): Promise<Cliente[]>
  crearCliente(nombre: unknown, notas?: unknown): Promise<Cliente>
  editarCliente(
    id: string,
    campos: {
      nombre?: unknown
      notas?: unknown
      archivado?: unknown
      /** Cada uno admite null explicito, que significa "vuelve al ajuste general". */
      postsPerDay?: unknown
      dayStartHour?: unknown
      dayEndHour?: unknown
    },
  ): Promise<void>
  borrarCliente(id: string): Promise<void>

  campanas(clienteId?: string): Promise<Campana[]>
  crearCampana(clienteId: string, nombre: unknown, notas?: unknown): Promise<Campana>
  editarCampana(id: string, campos: { nombre?: unknown; notas?: unknown; estado?: unknown }): Promise<void>
  borrarCampana(id: string): Promise<void>

  /** Quien tiene asignado que. Lo que la seccion Proyectos pinta de una vez. */
  asignaciones(): Promise<Asignaciones>

  /** Cuelga una cuenta de un cliente, o la deja sin asignar con null. */
  asignarCuenta(accountId: string, clienteId: string | null): Promise<void>
  /** Cuelga un VOD de una campaña, o lo deja sin asignar con null. */
  asignarVod(sourceId: string, campanaId: string | null): Promise<void>
}

export function crearProyectos(db: Db, ownerId: string): Proyectos {
  return {
    clientes: async (incluirArchivados = false) => {
      /*
       * Los conteos con subconsultas y no con JOIN + GROUP BY.
       *
       * Con dos JOIN (cuentas y campañas) sobre la misma fila, cada cliente se
       * multiplica por el producto de ambos y los conteos salen inflados. Es el
       * fallo clasico del doble join, y se evita contando por separado.
       */
      const filas = await db.query(
        `select c.id, c.nombre, c.archivado, c.notas,
                c.posts_per_day, c.day_start_hour, c.day_end_hour,
                (select count(*) from accounts a
                  where a.owner_id = c.owner_id and a.cliente_id = c.id) as cuentas,
                (select count(*) from campanas k
                  where k.cliente_id = c.id) as campanas
           from clientes c
          where c.owner_id = $1
            and ($2 or not c.archivado)
          order by c.archivado, lower(c.nombre)`,
        [ownerId, incluirArchivados],
      )
      return filas.map((r) => ({
        id: r.id as string,
        nombre: r.nombre as string,
        archivado: r.archivado as boolean,
        notas: r.notas as string,
        cuentas: Number(r.cuentas),
        campanas: Number(r.campanas),
        perfil: {
          postsPerDay: r.posts_per_day === null ? null : Number(r.posts_per_day),
          dayStartHour: r.day_start_hour === null ? null : Number(r.day_start_hour),
          dayEndHour: r.day_end_hour === null ? null : Number(r.day_end_hour),
        },
      }))
    },

    crearCliente: async (nombreRaw, notasRaw = '') => {
      const nombre = limpiarNombre(nombreRaw, 'del cliente')
      const notas = typeof notasRaw === 'string' ? notasRaw.slice(0, 2000) : ''
      try {
        const filas = await db.query(
          `insert into clientes (owner_id, nombre, notas) values ($1, $2, $3) returning id`,
          [ownerId, nombre, notas],
        )
        return {
          id: filas[0]?.id as string,
          nombre,
          archivado: false,
          notas,
          cuentas: 0,
          campanas: 0,
          perfil: { postsPerDay: null, dayStartHour: null, dayEndHour: null },
        }
      } catch (error) {
        if (esDuplicado(error)) throw new ProyectoError(`Ya existe un cliente llamado "${nombre}".`)
        throw error
      }
    },

    editarCliente: async (id, campos) => {
      // Se construye solo con lo que viene. Un update que escriba las tres
      // columnas siempre borraria las notas al renombrar desde una pantalla
      // que no las tiene.
      const sets: string[] = []
      const params: unknown[] = [ownerId, id]
      if (campos.nombre !== undefined) {
        params.push(limpiarNombre(campos.nombre, 'del cliente'))
        sets.push(`nombre = $${params.length}`)
      }
      if (campos.notas !== undefined) {
        params.push(typeof campos.notas === 'string' ? campos.notas.slice(0, 2000) : '')
        sets.push(`notas = $${params.length}`)
      }
      if (campos.archivado !== undefined) {
        params.push(campos.archivado === true)
        sets.push(`archivado = $${params.length}`)
      }

      /*
       * El perfil. null explicito = "vuelve al ajuste general".
       *
       * Se distingue null de undefined a proposito: undefined es "esta pantalla
       * no trae ese campo" y null es "quita la excepcion". Tratarlos igual
       * impediria volver a heredar una vez apartado el cliente.
       */
      const perfil: [keyof typeof campos, string, number, number][] = [
        ['postsPerDay', 'posts_per_day', 1, 10],
        ['dayStartHour', 'day_start_hour', 0, 23],
        ['dayEndHour', 'day_end_hour', 1, 24],
      ]
      for (const [campo, columna, min, max] of perfil) {
        const valor = campos[campo]
        if (valor === undefined) continue
        if (valor === null || valor === '') {
          params.push(null)
          sets.push(`${columna} = $${params.length}`)
          continue
        }
        const n = Number(valor)
        if (!Number.isInteger(n) || n < min || n > max) {
          throw new ProyectoError(`${campo} debe ser un entero entre ${min} y ${max}.`)
        }
        params.push(n)
        sets.push(`${columna} = $${params.length}`)
      }

      if (sets.length === 0) return

      try {
        await db.query(
          `update clientes set ${sets.join(', ')}, updated_at = now()
            where owner_id = $1 and id = $2`,
          params,
        )
      } catch (error) {
        if (esDuplicado(error)) throw new ProyectoError('Ya existe otro cliente con ese nombre.')
        throw error
      }
    },

    /*
     * Borrar de verdad, con aviso de lo que se lleva por delante.
     *
     * Las campañas caen con el cliente (cascade). Las cuentas NO: su cliente_id
     * se pone a null y siguen enlazadas con TikTok. Los VOD tampoco. Eso esta
     * decidido en el esquema; aqui solo se cuenta lo que va a pasar para que el
     * panel pueda avisar antes.
     */
    borrarCliente: async (id) => {
      const filas = await db.query(
        `select (select count(*) from campanas where cliente_id = $2) as campanas,
                (select count(*) from accounts
                  where owner_id = $1 and cliente_id = $2) as cuentas`,
        [ownerId, id],
      )
      const campanas = Number(filas[0]?.campanas ?? 0)
      if (campanas > 0) {
        throw new ProyectoError(
          `Ese cliente tiene ${campanas} campaña(s). Borralas primero o archiva el cliente.`,
        )
      }
      await db.query(`delete from clientes where owner_id = $1 and id = $2`, [ownerId, id])
    },

    campanas: async (clienteId) => {
      const filas = await db.query(
        `select k.id, k.cliente_id, k.nombre, k.estado, k.notas, c.nombre as cliente_nombre,
                (select count(*) from sources s
                  where s.owner_id = k.owner_id and s.campana_id = k.id) as vods
           from campanas k
           join clientes c on c.id = k.cliente_id
          where k.owner_id = $1
            and ($2::uuid is null or k.cliente_id = $2::uuid)
          order by lower(c.nombre), lower(k.nombre)`,
        [ownerId, clienteId ?? null],
      )
      return filas.map((r) => ({
        id: r.id as string,
        clienteId: r.cliente_id as string,
        clienteNombre: r.cliente_nombre as string,
        nombre: r.nombre as string,
        estado: r.estado as Campana['estado'],
        notas: r.notas as string,
        vods: Number(r.vods),
      }))
    },

    crearCampana: async (clienteId, nombreRaw, notasRaw = '') => {
      const nombre = limpiarNombre(nombreRaw, 'de la campaña')
      const notas = typeof notasRaw === 'string' ? notasRaw.slice(0, 2000) : ''

      // Se comprueba el cliente antes de insertar para poder decir "ese cliente
      // no existe" en vez de dejar que reviente la clave foranea.
      const duenyo = await db.query(`select nombre from clientes where owner_id = $1 and id = $2`, [
        ownerId,
        clienteId,
      ])
      const clienteNombre = duenyo[0]?.nombre as string | undefined
      if (clienteNombre === undefined) throw new ProyectoError('Ese cliente no existe.')

      try {
        const filas = await db.query(
          `insert into campanas (owner_id, cliente_id, nombre, notas)
           values ($1, $2, $3, $4) returning id`,
          [ownerId, clienteId, nombre, notas],
        )
        return {
          id: filas[0]?.id as string,
          clienteId,
          clienteNombre,
          nombre,
          estado: 'activa',
          notas,
          vods: 0,
        }
      } catch (error) {
        if (esDuplicado(error)) {
          throw new ProyectoError(`"${clienteNombre}" ya tiene una campaña llamada "${nombre}".`)
        }
        throw error
      }
    },

    editarCampana: async (id, campos) => {
      const sets: string[] = []
      const params: unknown[] = [ownerId, id]
      if (campos.nombre !== undefined) {
        params.push(limpiarNombre(campos.nombre, 'de la campaña'))
        sets.push(`nombre = $${params.length}`)
      }
      if (campos.notas !== undefined) {
        params.push(typeof campos.notas === 'string' ? campos.notas.slice(0, 2000) : '')
        sets.push(`notas = $${params.length}`)
      }
      if (campos.estado !== undefined) {
        const estado = String(campos.estado)
        if (!ESTADOS.includes(estado as (typeof ESTADOS)[number])) {
          throw new ProyectoError(`Estado desconocido: ${estado}.`)
        }
        params.push(estado)
        sets.push(`estado = $${params.length}`)
      }
      if (sets.length === 0) return

      try {
        await db.query(
          `update campanas set ${sets.join(', ')}, updated_at = now()
            where owner_id = $1 and id = $2`,
          params,
        )
      } catch (error) {
        if (esDuplicado(error)) throw new ProyectoError('Ese cliente ya tiene una campaña con ese nombre.')
        throw error
      }
    },

    borrarCampana: async (id) => {
      await db.query(`delete from campanas where owner_id = $1 and id = $2`, [ownerId, id])
    },

    asignaciones: async () => {
      /*
       * El @ de TikTok sale de un LEFT JOIN, no de un JOIN.
       *
       * La mayoria de las cuentas no estan enlazadas todavia. Con un JOIN
       * normal desaparecerian de la lista, que es justo donde hace falta verlas
       * para asignarlas a un cliente.
       */
      const [cuentas, vods] = await Promise.all([
        db.query(
          `select a.id, a.label, a.cliente_id, a.status,
                  coalesce(t.username, '') as tiktok
             from accounts a
             left join tiktok_tokens t
               on t.owner_id = a.owner_id and t.account_id = a.id
            where a.owner_id = $1
            order by a.id`,
          [ownerId],
        ),
        db.query(
          `select id, title, campana_id from sources where owner_id = $1 order by updated_at desc`,
          [ownerId],
        ),
      ])

      return {
        cuentas: cuentas.map((r) => ({
          id: r.id as string,
          label: r.label as string,
          clienteId: (r.cliente_id as string | null) ?? null,
          tiktok: r.tiktok as string,
          activa: r.status === 'active',
        })),
        vods: vods.map((r) => ({
          sourceId: r.id as string,
          title: r.title as string,
          campanaId: (r.campana_id as string | null) ?? null,
        })),
      }
    },

    /*
     * Las dos asignaciones comprueban que el destino existe y es del mismo
     * propietario.
     *
     * Sin el filtro por owner_id, un identificador de otro propietario pasaria
     * la clave foranea (que no sabe de propietarios) y colgaria la cuenta del
     * cliente de otro. Hoy solo hay un propietario; esto es lo que hace que
     * siga siendo cierto cuando haya dos.
     */
    asignarCuenta: async (accountId, clienteId) => {
      if (clienteId !== null) {
        const existe = await db.query(`select 1 from clientes where owner_id = $1 and id = $2`, [
          ownerId,
          clienteId,
        ])
        if (existe.length === 0) throw new ProyectoError('Ese cliente no existe.')
      }
      const filas = await db.query(
        `update accounts set cliente_id = $3 where owner_id = $1 and id = $2 returning id`,
        [ownerId, accountId, clienteId],
      )
      if (filas.length === 0) throw new ProyectoError(`No existe la cuenta ${accountId}.`)
    },

    asignarVod: async (sourceId, campanaId) => {
      if (campanaId !== null) {
        const existe = await db.query(`select 1 from campanas where owner_id = $1 and id = $2`, [
          ownerId,
          campanaId,
        ])
        if (existe.length === 0) throw new ProyectoError('Esa campaña no existe.')
      }
      const filas = await db.query(
        `update sources set campana_id = $3 where owner_id = $1 and id = $2 returning id`,
        [ownerId, sourceId, campanaId],
      )
      if (filas.length === 0) throw new ProyectoError(`No existe el VOD ${sourceId}.`)
    },
  }
}
