/**
 * Panel de control, servido como una sola pagina.
 *
 * Se escribe a mano en lugar de usar un framework porque lo que hace es
 * acotado: lanzar comandos, seguir su progreso y decidir sobre clips. El diseño
 * es primero para movil: la revision se hace con el telefono en la mano.
 *
 * Tres secciones. PROCESO lanza la tuberia y la vigila, CLIPS es la compuerta
 * de aprobacion y METRICAS mide que funciono. El progreso de los trabajos se ve
 * desde cualquiera de las tres porque duran minutos y no tiene sentido obligar
 * a quedarse mirando una pestaña concreta.
 */
import { CSS } from './estilos.js'
import { GUION } from './guion.js'
import { favicon, isotipo } from './marca.js'

export function renderPage(): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="Panel de KLIP studio: convierte directos largos en clips verticales.">
<title>KLIP studio</title>
<link rel="icon" href="${favicon()}">
<!--
  Instrument Sans, no la fuente del sistema.
  VERIFICADO contra fonts.googleapis.com (v4): existe con itálica 400 (la del
  tagline) y trae la feature OpenType 'tnum', que es la que sostiene las cifras
  de ancho fijo de los contadores. No trae 'zero' (cero rebanado); esa parte de
  font-variant-numeric queda inerte y se cae sola al sistema.
  preconnect porque son dos hosts distintos: sin el, la descarga del .ttf espera
  al handshake de gstatic despues de haber resuelto googleapis.
  display=swap: si la red falla, se pinta con la del sistema y no se ve nada en
  blanco. En un panel que se abre desde el movil eso no es negociable.
-->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!--
  JetBrains Mono solo para DATOS: horas, duraciones, timecodes y cifras.
  Dos pesos y nada mas (400 para el dato, 500 para destacarlo), porque cada
  peso extra es otra descarga en un panel que se abre desde el movil.
  Va en la misma peticion que Instrument Sans: dos familias en una URL es un
  solo viaje, y el preconnect de arriba ya cubre los dos hosts.
-->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
${CSS}
</style>
</head>
<body>
<!--
  Saltar al contenido: el primer tabulador de la pagina.
  Sin el, quien navega con teclado recorre las cuatro entradas del menu antes
  de llegar a lo que vino a hacer, en CADA pantalla.
-->
<a class="salto" href="#view">Saltar al contenido</a>
<header>
  <div class="cabecera">
    <button id="menu" aria-label="Abrir el menu">&#9776;</button>
    <h1 id="title">Inicio</h1>
    <button id="abrir-buscar" aria-label="Buscar" title="Buscar (Ctrl+K)">&#9906;</button>
    <button id="campana" aria-label="Avisos" aria-expanded="false" aria-controls="avisos">&#9737;</button>
  </div>
  <div class="tabs" id="tabs"></div>
</header>

<main id="view"></main>
<p class="hint" id="hint"></p>

<div id="fondo"></div>
<nav id="nav">
  <div class="marca">
    ${isotipo(26)}
    <span class="marca-texto">
      <span class="marca-klip">KLIP</span><span class="marca-studio">studio</span>
    </span>
  </div>
  <p class="titulo">Panel</p>
  <button data-seccion="inicio" aria-current="true"><i>&#9654;</i>Inicio</button>
  <button data-seccion="revisar"><i>&#9635;</i>Revisar<b id="pend" hidden></b></button>
  <button data-seccion="agenda"><i>&#9776;</i>Agenda</button>
  <button data-seccion="config"><i>&#9881;</i>Ajustes</button>
</nav>

<!--
  Buscador. Se abre con Ctrl+K (o Cmd+K) y con el boton de la cabecera.
  El dialogo vive en el HTML y no se crea desde el guion para que exista antes
  de que llegue ningun dato: se abre vacio al instante y se llena despues.
-->
<div id="buscador" class="buscador" role="dialog" aria-modal="true" aria-label="Buscar" hidden>
  <div class="buscador-caja">
    <input id="buscar" type="search" autocomplete="off" spellcheck="false"
           placeholder="Buscar una pantalla, un video o una cuenta"
           aria-controls="resultados" aria-expanded="true" role="combobox">
    <ul id="resultados" class="resultados" role="listbox" aria-label="Resultados"></ul>
  </div>
</div>

<script>
${GUION}
</script>
</body>
</html>`
}
