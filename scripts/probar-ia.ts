/**
 * "Probar IA": una llamada minima a la IA configurada.
 *
 *   npm run probar-ia
 *
 * La encola el boton de Ajustes, IA, y la ejecuta el trabajador: la IA vive
 * en el PC, no en el servidor del panel. El resultado viaja en una linea
 * marcada que el trabajador guarda en `ia_estado`, y si la IA esta lista, las
 * tareas que esperaban vuelven solas a la cola.
 */
import { loadEnv } from '../src/lib/env.js'
import { MARCA_ESTADO_IA } from '../src/llm/estado.js'
import { probarIA } from '../src/llm/probar.js'

loadEnv()

const r = await probarIA()
console.log(`${MARCA_ESTADO_IA} ${JSON.stringify({
  estado: r.estado,
  mensaje: r.mensaje,
  proveedor: r.proveedor,
  modelo: r.modelo,
  ...(r.reanudarEn === undefined ? {} : { reanudarEn: r.reanudarEn }),
})}`)
console.log(r.estado === 'lista' ? `IA lista (${r.modelo}, ${(r.ms / 1000).toFixed(1)} s).` : r.mensaje)
process.exitCode = r.estado === 'lista' ? 0 : 1
