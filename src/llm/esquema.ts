import * as z from 'zod/v4'

/**
 * Lo que tiene que devolver la IA por cada momento, y como se comprueba.
 *
 * `inicio` y `fin` SON NUMEROS DE LINEA, no segundos. Es la misma decision que
 * ya tomaba el proyecto (ver src/select/schema.ts): un segundo inventado es un
 * valor plausible que nadie puede desmentir, y un numero de linea o existe en
 * la lista que se le dio o no existe. La conversion a segundos la hace
 * validate.ts contra la transcripcion real.
 *
 * `gancho` es la cita literal de la primera linea del tramo. Se compara con la
 * transcripcion y, si no aparece, el momento se descarta: es la comprobacion
 * contra respuestas inventadas.
 *
 * `descripcion` y `hashtags` no estan en el plan de la fase pero los necesita
 * la publicacion, que ya existe y funciona; sin ellos cada clip saldria sin
 * texto.
 */
export const VERSION_ESQUEMA = 1

const puntaje = z.number().min(0).max(100)

function palabras(texto: string): string[] {
  return texto.trim().split(/\s+/).filter((p) => p !== '')
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** El titulo no puede ser el arranque de la primera frase dicho otra vez. */
export function tituloRepiteGancho(titulo: string, gancho: string): boolean {
  const t = normalizar(titulo)
  const g = normalizar(gancho)
  if (t === '' || g === '') return false
  return g.startsWith(t) || t.startsWith(g)
}

export const MomentoSchema = z
  .object({
    inicio: z.number().int().min(1),
    fin: z.number().int().min(1),
    titulo: z.string().min(1).refine((t) => palabras(t).length <= 8, {
      message: 'el titulo tiene mas de 8 palabras',
    }),
    gancho: z.string().min(1),
    descripcion: z.string().max(200),
    hashtags: z.array(z.string().max(40)).max(5),
    puntaje_gancho: puntaje,
    puntaje_cierre: puntaje,
    puntaje_retencion: puntaje,
    puntaje_total: puntaje,
    motivo: z.string().min(1).max(400),
  })
  .superRefine((m, ctx) => {
    if (m.fin <= m.inicio) {
      ctx.addIssue({ code: 'custom', path: ['fin'], message: 'fin debe ser mayor que inicio' })
    }
    if (tituloRepiteGancho(m.titulo, m.gancho)) {
      ctx.addIssue({
        code: 'custom',
        path: ['titulo'],
        message: 'el titulo repite la primera frase; escribe uno distinto',
      })
    }
  })

export function momentosSchema(maximo: number) {
  return z.object({ momentos: z.array(MomentoSchema).max(maximo) })
}

export type Momento = z.infer<typeof MomentoSchema>

/** Instrucciones de formato que se añaden al prompt de cada bloque. */
export function instruccionesFormato(maximo: number): string {
  return `
FORMATO DE RESPUESTA (obligatorio):
Responde SOLO con un objeto JSON, sin texto antes ni despues y sin bloques de codigo:

{"momentos": [
  {
    "inicio": <numero de la PRIMERA linea del tramo>,
    "fin": <numero de la ULTIMA linea del tramo, mayor que inicio>,
    "titulo": "<titulo corto, maximo 8 palabras, DISTINTO de la primera frase>",
    "gancho": "<copia LITERAL del texto de la linea inicio>",
    "descripcion": "<texto para publicar, maximo 150 caracteres, sin hashtags>",
    "hashtags": ["<entre 3 y 5, sin #, sin repetir>"],
    "puntaje_gancho": <0-100, cuanto detiene el scroll la primera frase>,
    "puntaje_cierre": <0-100, si termina en un remate limpio>,
    "puntaje_retencion": <0-100, si se sostiene hasta el final>,
    "puntaje_total": <0-100, tu valoracion global>,
    "motivo": "<una frase: por que funciona>"
  }
]}

Como maximo ${maximo} momentos. Una lista vacia es una respuesta valida.

PREFERENCIAS:
- Duracion ideal entre 20 y 60 segundos. Mas de 60 solo si el momento lo pide de verdad.
- El clip NO empieza con una muletilla ("Si.", "Eh", "O sea", "Bueno", "Pues", "A ver"): mueve el inicio a la primera frase con contenido.
- El titulo resume la idea con otras palabras; nunca copia la primera frase.`
}

/**
 * Saca el JSON de la respuesta.
 *
 * Aunque se pide sin adornos, a veces llega envuelto en un bloque de codigo o
 * con una frase delante. Se toma del primer `{` al ultimo `}`.
 */
export function extraerJson(texto: string): unknown {
  const a = texto.indexOf('{')
  const b = texto.lastIndexOf('}')
  if (a === -1 || b <= a) throw new Error('la respuesta no contiene un objeto JSON')
  return JSON.parse(texto.slice(a, b + 1)) as unknown
}

/** Resume los errores de zod en pocas lineas, para devolverselos a la IA. */
export function resumirErrores(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `- ${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('\n')
}
