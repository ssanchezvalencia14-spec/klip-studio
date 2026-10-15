/**
 * Como se arma el texto que acompaña a cada video.
 *
 * Estaba escrito dentro de CADA proveedor de publicacion, con la misma linea
 * repetida en dos sitios:
 *
 *   const title = [caption, ...hashtags.map((h) => `#${h}`)].join(' ').slice(0, 2200)
 *
 * Eso significaba que cambiar el orden, meter una linea fija o añadir etiquetas
 * de marca obligaba a tocar codigo en dos ficheros y volver a desplegar. Ahora
 * la plantilla vive en los ajustes y esto es el unico sitio que la interpreta,
 * asi que los dos proveedores no pueden divergir.
 */

/** Lo que se puede poner en la plantilla. */
export const MARCAS = ['{titulo}', '{hashtags}'] as const

export interface TextoOpciones {
  /** Pie que propuso el modelo. */
  caption: string
  /** Etiquetas del clip, sin almohadilla. */
  hashtags: readonly string[]
  /** Plantilla con {titulo} y {hashtags}. */
  plantilla: string
  /** Etiquetas que se añaden siempre, separadas por comas y sin almohadilla. */
  fijos: string
}

/**
 * Limpia una etiqueta para que TikTok la reconozca.
 *
 * Se quitan almohadillas y espacios: un "#zoti" escrito por el usuario en las
 * etiquetas fijas produciria "##zoti", y un "musica urbana" con espacio corta
 * la etiqueta en la primera palabra y deja la segunda como texto suelto.
 */
function limpiar(bruto: string): string {
  return bruto
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
}

/**
 * Arma el texto final.
 *
 * El recorte a 2200 caracteres es el limite de TikTok y se mantiene: pasarse
 * no da error, la plataforma corta por donde quiere y suele llevarse las
 * etiquetas del final, que es justo lo que no interesa perder.
 */
export function construirTexto(o: TextoOpciones): string {
  const delClip = o.hashtags.map(limpiar).filter((h) => h !== '')
  const siempre = o.fijos
    .split(',')
    .map(limpiar)
    .filter((h) => h !== '')

  // Sin repetir: si el modelo ya propuso "zoti" y ademas esta en las fijas,
  // saldria dos veces en el mismo texto.
  const vistas = new Set<string>()
  const todas: string[] = []
  for (const h of [...delClip, ...siempre]) {
    const clave = h.toLowerCase()
    if (vistas.has(clave)) continue
    vistas.add(clave)
    todas.push('#' + h)
  }

  const texto = o.plantilla
    .replaceAll('{titulo}', o.caption)
    .replaceAll('{hashtags}', todas.join(' '))

  // Espacios de sobra: una plantilla "{titulo} {hashtags}" sin etiquetas deja
  // un espacio colgando al final, y "{titulo}\n\n{hashtags}" deja dos saltos.
  return texto
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2200)
}
