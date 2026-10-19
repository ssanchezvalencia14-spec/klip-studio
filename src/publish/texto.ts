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

/** Maximo de etiquetas por publicacion, sumando las del clip y las fijas. */
export const MAX_HASHTAGS = 5
/** Limite de TikTok para el texto. */
export const MAX_TEXTO = 2200

/** Clave para comparar etiquetas: sin mayusculas ni tildes. */
function claveHashtag(h: string): string {
  return h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * La lista final de etiquetas.
 *
 * Fase 5. Lo que salia mal y por que:
 *
 * - "#MúsicaColombiana" tres veces: la comparacion distinguia tildes, asi que
 *   "MusicaColombiana" y "MúsicaColombiana" eran dos; y no miraba las que ya
 *   venian escritas dentro de la descripcion.
 * - "#TikT": un trozo de otra etiqueta. Un fragmento que es el principio de
 *   otra etiqueta de la lista (TikT de TikTok) se descarta.
 * - Mas de cinco: ahora el tope es MAX_HASHTAGS. Las fijas (de marca) entran
 *   primero, porque se pusieron a proposito; despues las del clip.
 */
export function elegirHashtags(delClip: readonly string[], fijos: readonly string[], caption = ''): string[] {
  const enDescripcion = new Set(
    [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => claveHashtag(m[1] ?? '')),
  )
  const limpias = (lista: readonly string[]) => lista.map(limpiar).filter((h) => h.length >= 2)
  const fijas = limpias(fijos)
  const clip = limpias(delClip)
  const todasClaves = [...fijas, ...clip].map(claveHashtag)

  // Como se escribe cada una: gana la forma del clip si esta en los dos sitios.
  const forma = new Map<string, string>()
  for (const h of [...clip, ...fijas]) if (!forma.has(claveHashtag(h))) forma.set(claveHashtag(h), h)
  const esFragmento = (clave: string) =>
    todasClaves.some((otra) => otra !== clave && otra.length > clave.length && otra.startsWith(clave))

  // Primero se reserva sitio para las fijas; despues entran las del clip.
  const vistas = new Set<string>(enDescripcion)
  const reservadas: string[] = []
  for (const h of fijas) {
    const clave = claveHashtag(h)
    if (reservadas.length >= MAX_HASHTAGS || vistas.has(clave) || esFragmento(clave)) continue
    vistas.add(clave)
    reservadas.push(clave)
  }
  const delClipElegidas: string[] = []
  for (const h of clip) {
    const clave = claveHashtag(h)
    if (reservadas.length + delClipElegidas.length >= MAX_HASHTAGS) break
    if (vistas.has(clave) && !reservadas.includes(clave)) continue
    if (esFragmento(clave)) continue
    // Si tambien es fija, va en el orden del clip y no ocupa otro sitio.
    if (reservadas.includes(clave)) {
      reservadas.splice(reservadas.indexOf(clave), 1)
    } else {
      vistas.add(clave)
    }
    delClipElegidas.push(clave)
  }
  // Las del clip delante y las fijas detras, como estaban antes.
  return [...delClipElegidas, ...reservadas].map((c) => '#' + (forma.get(c) ?? c))
}

/**
 * Recorta sin partir nada: primero sobran etiquetas del final, despues
 * palabras. Nunca deja media etiqueta ("#TikT") ni media palabra.
 */
export function recortarTexto(texto: string, max = MAX_TEXTO): string {
  if (texto.length <= max) return texto
  const trozos = texto.split(/(\s+)/)
  while (trozos.join('').trimEnd().length > max && trozos.length > 1) {
    trozos.pop()
  }
  const resultado = trozos.join('').trimEnd()
  // Una sola "palabra" mas larga que el limite (no pasa con texto real): se
  // corta, pero nunca es una etiqueta, porque las etiquetas van separadas.
  return resultado.length <= max ? resultado : resultado.slice(0, max)
}

/**
 * Arma el texto final.
 *
 * El recorte a 2200 caracteres es el limite de TikTok y se mantiene: pasarse
 * no da error, la plataforma corta por donde quiere y suele llevarse las
 * etiquetas del final, que es justo lo que no interesa perder.
 */
export function construirTexto(o: TextoOpciones): string {
  const siempre = o.fijos.split(',')
  const todas = elegirHashtags(o.hashtags, siempre, o.caption)

  const texto = o.plantilla
    .replaceAll('{titulo}', o.caption)
    .replaceAll('{hashtags}', todas.join(' '))

  // Espacios de sobra: una plantilla "{titulo} {hashtags}" sin etiquetas deja
  // un espacio colgando al final, y "{titulo}\n\n{hashtags}" deja dos saltos.
  return recortarTexto(
    texto
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  )
}
