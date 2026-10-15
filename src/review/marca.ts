/**
 * El isotipo de KLIP studio.
 *
 * Los contornos NO estan dibujados a mano: salen del manual de marca
 * (KLIP Studio.pdf), extraidos de los operadores de dibujo del propio PDF y
 * normalizados a un lienzo de 100x100. Son los mismos vectores que uso el
 * disenador, no una imitacion.
 *
 * El glifo tiene dos piezas: el asta vertical de la P y la espiral que hace de
 * ojo. En el manual se colorean asi:
 *
 *   fondo oscuro   asta blanca  (#FAFAFA) + espiral azul (#4160E6)
 *   fondo claro    asta indigo  (#1C23A6) + espiral azul (#4160E6)
 *
 * AQUI EL COLOR NO SE FIJA, se hereda. El asta usa currentColor y la espiral
 * una variable con el azul por defecto. Asi la variante la decide el sitio
 * donde se coloca el glifo, y no hay forma de equivocarse mezclando la version
 * clara sobre fondo oscuro: no existen dos versiones que confundir, existe una
 * que se adapta.
 *
 * El lockup completo (wordmark + tagline) no se extrae de aqui. En el manual el
 * tagline "studio" es texto vivo con una fuente incrustada, no contornos, asi
 * que no se puede recuperar leyendo trazos. Se compone con texto en el panel,
 * que ademas queda nitido a cualquier tamano y es seleccionable.
 */

/** El asta vertical de la P. */
const ASTA =
  'M 17.982 0 L 17.982 88.181 L 17.961 88.181 L 17.961 100 L 30.961 100 ' +
  'L 30.961 88.821 L 30.995 88.821 L 30.995 0 Z'

/** La espiral que forma el ojo de la P. */
const ESPIRAL =
  'M 73.069 53.202 C 71.559 54.711 60.857 65.413 47.768 61.303 C 39.096 58.583 ' +
  '31.199 49.8 31.924 40.138 C 32.913 26.938 49.397 19.511 50.556 20.585 ' +
  'C 50.599 20.619 50.616 20.67 50.642 20.79 C 50.787 21.395 51.273 23.484 ' +
  '50.548 25.164 C 49.874 26.725 48.501 27.62 47.197 28.038 C 43.794 29.129 ' +
  '40.972 31.781 39.88 35.32 C 38.064 41.23 41.594 47.745 47.768 49.416 ' +
  'C 48.842 49.552 57.046 50.371 63.279 44.317 C 66.775 40.923 68.532 35.951 ' +
  '68.532 29.402 C 68.532 23.646 66.775 19.289 63.279 16.33 C 59.774 13.371 ' +
  '54.598 11.887 47.768 11.887 L 32.018 11.887 L 32.044 0 L 47.768 0 ' +
  'C 58.896 0 67.338 2.481 73.069 7.444 C 78.807 12.407 81.664 19.724 ' +
  '81.664 29.402 C 81.664 32.472 82.039 44.223 73.069 53.202'

/**
 * El isotipo completo, para el encabezado y la barra colapsada.
 *
 * aria-hidden porque al lado siempre va el nombre en texto: leerlo dos veces
 * con un lector de pantalla no anade nada.
 */
export function isotipo(alto = 22): string {
  return (
    '<svg class="glifo" viewBox="0 0 100 100" height="' + alto + '" ' +
    'aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="currentColor" d="' + ASTA + '"/>' +
    '<path fill="var(--glifo-espiral, #4160E6)" d="' + ESPIRAL + '"/>' +
    '</svg>'
  )
}

/**
 * Solo la espiral, encajada en su propio recuadro y centrada.
 *
 * Es la pieza del indicador de proceso. Se recorta al recuadro de la espiral y
 * no al del glifo entero para que al girar lo haga sobre su centro: con el
 * lienzo completo, el eje cae en el asta y la espiral describiria una orbita en
 * vez de girar sobre si misma.
 */
export function espiral(alto = 16): string {
  return (
    '<svg class="espiral" viewBox="29.8 -0.4 54 54" height="' + alto + '" ' +
    'aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="currentColor" d="' + ESPIRAL + '"/>' +
    '</svg>'
  )
}

/**
 * El favicon, como URI de datos.
 *
 * Va incrustado y no como archivo aparte porque el panel se sirve como una sola
 * pagina sin recursos estaticos: anadir una ruta solo para el icono obligaria a
 * tocar el servidor. Un SVG de 1 KB en la cabecera sale mas barato que la
 * peticion que se ahorraria.
 *
 * Aqui SI se fijan los colores: el navegador pinta la pestana sin contexto y no
 * hay currentColor que valga. Se usa la version de fondo oscuro con su fondo
 * propio, que es la que se distingue tanto en pestanas claras como oscuras.
 */
export function favicon(): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" rx="20" fill="#0D0D0D"/>' +
    '<g transform="translate(8 6) scale(.84)">' +
    '<path fill="#FAFAFA" d="' + ASTA + '"/>' +
    '<path fill="#4160E6" d="' + ESPIRAL + '"/>' +
    '</g></svg>'
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}
