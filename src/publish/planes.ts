/**
 * Los planes de upload-post y cuantos perfiles admite cada uno.
 *
 * EXISTE PORQUE EL TOPE DE CUENTAS NO LO DECIDE ESTE PROGRAMA. Lo decide el
 * plan contratado: por muchas cuentas que el panel deje crear, una cuenta sin
 * perfil al otro lado falla al publicar, una por una y sin mas explicacion que
 * un error del proveedor. Antes el tope era un numero suelto (100, y antes 20)
 * que no se parecia a nada real.
 *
 * VERIFICADO EL 2026-10-11 contra dos fuentes de upload-post que coinciden:
 *   https://www.upload-post.com/llms-full.txt
 *   https://www.upload-post.com/pricing-comparison/
 *
 * Es una copia de datos ajenos y envejece: upload-post puede cambiar precios o
 * cupos cuando quiera. Por eso cada plan lleva su precio -- sirve para notar
 * de un vistazo que la tabla se quedo vieja -- y por eso existe 'otro', que
 * deja poner un tope a mano sin tocar codigo el dia que esta lista no case con
 * la realidad.
 *
 * El precio NO se usa para ningun calculo. Solo se enseña.
 */
export interface PlanProveedor {
  id: string
  nombre: string
  /** Precio mensual en USD, con facturacion mensual. */
  usd: number
  /** Cuantos perfiles admite. Es el tope real de cuentas. */
  perfiles: number
  /** Lo que haya que advertir antes de elegirlo. */
  aviso?: string
}

export const PLANES_UPLOAD_POST: readonly PlanProveedor[] = [
  {
    id: 'free',
    nombre: 'Gratis',
    usd: 0,
    perfiles: 2,
    /*
     * El plan gratuito NO SIRVE para este programa, y hay que decirlo donde se
     * elige y no en una nota al pie: no incluye TikTok y limita a diez subidas
     * al mes. Elegirlo deja el panel funcionando y la publicacion rota, que es
     * la peor combinacion posible.
     */
    aviso: 'Sin TikTok y 10 subidas al mes: no sirve para publicar aqui.',
  },
  { id: 'basic', nombre: 'Basic', usd: 24, perfiles: 5 },
  { id: 'professional', nombre: 'Professional', usd: 50, perfiles: 25 },
  { id: 'advanced', nombre: 'Advanced', usd: 147, perfiles: 75 },
  { id: 'business', nombre: 'Business', usd: 438, perfiles: 225 },
] as const

/**
 * El plan cuyo cupo coincide con un tope dado, si lo hay.
 *
 * Se busca por numero de perfiles y no se guarda "que plan tengo" como un
 * campo aparte. Dos campos para el mismo hecho se separan: alguien sube el
 * tope a mano, el campo del plan se queda en Professional y el panel pasa a
 * decir una cosa que no es. Con un solo numero guardado, el plan es una
 * lectura de ese numero y no puede discrepar.
 */
export function planDe(perfiles: number): PlanProveedor | undefined {
  return PLANES_UPLOAD_POST.find((p) => p.perfiles === perfiles)
}

/**
 * Como se describe el tope actual en una linea.
 *
 * Con un tope que no corresponde a ningun plan se dice el numero a secas, sin
 * inventar un nombre: es lo que pasa tras un cambio de precios de upload-post
 * o con un tope puesto a mano, y las dos cosas son legitimas.
 */
export function describirTope(perfiles: number): string {
  const plan = planDe(perfiles)
  if (plan === undefined) return `${perfiles} cuentas`
  return `${perfiles} cuentas (plan ${plan.nombre})`
}
