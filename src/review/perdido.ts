/**
 * La pagina de "esto no existe".
 *
 * Hasta ahora cualquier direccion equivocada devolvia {"error":"Ruta
 * desconocida"} en JSON. Para una peticion de la API eso esta bien; para
 * alguien que pego mal un enlace en la barra del navegador, es una pantalla
 * blanca con una llave y una coma. Un cliente que reciba un enlace cortado por
 * el correo acaba justo ahi.
 *
 * Es una pagina suelta, sin el guion ni la hoja del panel: no hace falta
 * cargar 4.700 lineas para decir una frase y ofrecer la puerta de vuelta. Los
 * estilos van en linea por lo mismo, y con los mismos colores de marca.
 */
import { favicon, isotipo } from './marca.js'

export function renderPerdido(ruta: string): string {
  /*
   * La ruta se enseña para que quien avisa pueda decir cual fallo.
   *
   * Se descodifica primero: una direccion con acentos o espacios llega como
   * %C3%B1 y %20, y enseñar eso no ayuda a nadie a reconocer el enlace que
   * pego. decodeURIComponent lanza con un porcentaje suelto, que es algo que
   * cualquiera puede teclear, asi que un fallo deja la version cruda.
   *
   * Y DESPUES se escapa, que es cuando hace falta de verdad: descodificar
   * puede sacar < y > de un %3C, y esto acaba dentro del HTML.
   */
  let legible = ruta
  try {
    legible = decodeURIComponent(ruta)
  } catch {
    // Mal codificada. Se enseña tal cual, que sigue siendo informacion.
  }
  const segura = legible.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  )
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Esa pagina no existe - KLIP studio</title>
<link rel="icon" href="${favicon()}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400&family=JetBrains+Mono:wght@400&display=swap">
<style>
  :root {
    --bg: #FAFAFA; --panel: #FFFFFF; --line: #E6E6E8;
    --text: #0D0D0D; --dim: #5B5B63; --azul: #4160E6;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0F0F11; --panel: #17171A; --line: #2A2A30;
      --text: #F2F2F3; --dim: #A6A6AE; --azul: #5B76EE;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100dvh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: var(--bg); color: var(--text);
    font-family: "Instrument Sans", system-ui, sans-serif;
    font-size: 15px; line-height: 1.55;
  }
  main { max-width: 420px; }
  .marca { display: flex; align-items: center; gap: 9px; margin-bottom: 28px; color: var(--text); }
  .klip { font-size: 19px; font-weight: 700; letter-spacing: -.02em; }
  .studio { font-size: 12.5px; font-style: italic; color: var(--dim); }
  h1 { font-size: 26px; line-height: 1.15; letter-spacing: -.02em; margin: 0 0 10px; }
  p { color: var(--dim); margin: 0 0 10px; text-wrap: pretty; }
  code {
    font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12.5px;
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 7px; padding: 2px 6px; word-break: break-all;
  }
  a.volver {
    display: inline-block; margin-top: 18px;
    background: var(--azul); color: #FAFAFA; text-decoration: none;
    padding: 11px 19px; border-radius: 9px; font-weight: 600; font-size: 14px;
  }
  a.volver:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <div class="marca">
    ${isotipo(26)}
    <span><span class="klip">KLIP</span> <span class="studio">studio</span></span>
  </div>
  <h1>Esa pagina no existe</h1>
  <p>No hay nada en <code>${segura}</code>. Puede que el enlace llegara cortado,
     o que apunte a algo que ya se borro.</p>
  <p>Todo el panel cuelga de la portada: los videos, los clips por revisar, la
     agenda y los ajustes.</p>
  <a class="volver" href="/">Volver al panel</a>
</main>
</body>
</html>`
}
