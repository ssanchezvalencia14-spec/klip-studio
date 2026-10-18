/**
 * Por que fallo una llamada, y si tiene sentido seguir intentandolo.
 *
 * EL PROBLEMA QUE RESUELVE. Un VOD se parte en ventanas y cada una es una
 * llamada. Si lo que falla es la CLAVE, falla igual en todas: el 2026-10-18 un
 * VOD de tres ventanas gasto tres llamadas para recibir tres veces el mismo
 * 401, y lo que vio el usuario fueron tres bloques de JSON crudo. Con un
 * directo largo serian doce o veinte.
 *
 * Nada de esto arregla la causa -- una clave invalida hay que cambiarla -- pero
 * la diferencia entre "fallaron 3 de 3 ventanas" con tres JSON y "tu clave de
 * Anthropic no vale, cambiala en el .env" es la diferencia entre media hora de
 * investigacion y treinta segundos.
 */
export type ClaseDeFallo = 'auth' | 'saldo' | 'modelo' | 'limite' | 'pasajero'

export interface FalloSelect {
  clase: ClaseDeFallo
  /** Si da igual reintentar: el resto de ventanas van a fallar igual. */
  definitivo: boolean
  /** Que le decimos a quien pulso el boton. */
  mensaje: string
}

/**
 * Clasifica un error del proveedor.
 *
 * Se mira el `status` del SDK cuando esta, y el texto como respaldo: las
 * pruebas y el proveedor de Ollama lanzan Error normales sin status.
 */
export function clasificarFallo(error: unknown): FalloSelect {
  const status = (error as { status?: number } | null)?.status
  const texto = error instanceof Error ? error.message : String(error)
  const bajo = texto.toLowerCase()

  if (status === 401 || status === 403 || bajo.includes('invalid x-api-key') ||
      bajo.includes('authentication_error')) {
    return {
      clase: 'auth',
      definitivo: true,
      mensaje:
        'La clave de Anthropic no vale: la API la rechaza. Pon una nueva en ANTHROPIC_API_KEY ' +
        'dentro del .env (se sacan en platform.claude.com, en API keys) y vuelve a lanzarlo. ' +
        'Mientras tanto, si el video es musica, el boton "Es musica: buscar estribillos" no ' +
        'usa la API.',
    }
  }

  /*
   * Saldo agotado llega como 400, no como 402.
   *
   * Ya paso en este proyecto: la clave autenticaba y `models.retrieve`
   * funcionaba -- es gratuito -- pero `messages.create` devolvia 400 con
   * "credit balance is too low". Sin esta rama se leeria como un error de
   * peticion mal formada y se buscaria el fallo en el prompt.
   */
  if (bajo.includes('credit balance') || bajo.includes('insufficient') ||
      bajo.includes('billing')) {
    return {
      clase: 'saldo',
      definitivo: true,
      mensaje:
        'La cuenta de Anthropic no tiene saldo. El credito de la API es una bolsa aparte de ' +
        'cualquier suscripcion de Claude: se recarga en platform.claude.com, en Billing. ' +
        'Si el video es musica, el boton "Es musica: buscar estribillos" no usa la API.',
    }
  }

  if (status === 404 || bajo.includes('model') && bajo.includes('not_found')) {
    return {
      clase: 'modelo',
      definitivo: true,
      mensaje:
        'El modelo configurado no existe o tu cuenta no tiene acceso. Revisa SELECT_MODEL en ' +
        'el .env.',
    }
  }

  // 429 y 5xx si merecen reintentarse: son del momento, no de la configuracion.
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return {
      clase: 'limite',
      definitivo: false,
      mensaje: 'El proveedor esta ocupado o limitando peticiones. Vuelve a lanzarlo en un rato.',
    }
  }

  return { clase: 'pasajero', definitivo: false, mensaje: texto.split('\n')[0] ?? texto }
}
