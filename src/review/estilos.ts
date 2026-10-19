/**
 * La hoja de estilos del panel, entera.
 *
 * Vivia dentro de page.ts, en el mismo literal que el HTML y los 3.200 renglones
 * de guion. Ese fichero unico llego a 4.830 lineas y se llevo por delante la
 * pagina seis veces: una comilla invertida o una barra mal escapada en
 * CUALQUIER punto del literal la rompe entera, y el typecheck no lo ve porque
 * para TypeScript sigue siendo una cadena valida.
 *
 * Separarlo no quita el riesgo, pero lo acota: ahora un fallo en el CSS no
 * puede romper el guion, y cada pieza se lee sin bajar cuatro mil lineas.
 */

/*
 * Fase 3: un solo tema, oscuro, con los tokens del rediseño.
 *
 * Antes habia dos temas (claro por defecto y oscuro por preferencia del
 * sistema) y cada pantalla nacia con los dos. El rediseño fija el oscuro como
 * unico por ahora, asi que los tokens viven directamente en :root y no hay
 * nada que se pueda desincronizar.
 *
 * Se conservan los NOMBRES de las variables (--bg, --panel, --azul...) porque
 * dos mil lineas de reglas las usan: cambiar el valor aqui recolorea todo el
 * panel sin tocar una sola regla de maqueta.
 *
 * Contraste medido sobre las tarjetas (#12141B): texto principal 15,9:1,
 * secundario 9,6:1, de apoyo 7,1:1, azul de texto 7,0:1. Todo por encima del
 * 4,5:1 de AA.
 */
export const CSS = `  :root {
    color-scheme: dark;

    /* Fondos: app, menu, tarjeta, elevado. */
    --bg: #0B0C10;
    --menu-fondo: #0E1016;
    --panel: #12141B;
    --raised: #181B24;
    /* Lo hundido (campos de texto, pistas) va un punto por debajo de la tarjeta. */
    --hueco: #0E1016;
    --bg-velado: rgba(11, 12, 16, .86);

    /* Bordes. */
    --line: #252A36;
    --linea-viva: #3A4258;
    --punto: #3A4258;

    /* Texto: principal, secundario, de apoyo. */
    --text: #ECEEF4;
    --txt: var(--text);
    --dim: #B3BACB;
    --faint: #9BA3B5;
    --mono: #B3BACB;

    /* Acento. Relleno, texto sobre oscuro, fondo suave y tarjeta destacada. */
    --azul: #5B7CFF;
    --azul-texto: #8FA5FF;
    /* Texto encima del azul de relleno. */
    --sobre-acento: #FFFFFF;
    --indigo: #8FA5FF;
    --indigo-texto: #B9C6FF;
    --azul-hueco: #1B2140;
    --azul-pastilla: rgba(91, 124, 255, .20);
    --azul-borde: rgba(91, 124, 255, .45);
    --destacada: #151A2E;
    --destacada-borde: #2D3550;
    --indigo-pastilla: rgba(143, 165, 255, .16);

    /* Estados, cada uno con su fondo tenue. */
    --ok-texto: #3DDC97;
    --ok-fondo: #12261E;
    --ok-borde: #1E4A37;
    --aviso-texto: #FFB454;
    --aviso-fondo: #171510;
    --aviso-borde: #3D3220;
    --error-texto: #FF7A7A;
    --error-fondo: #1A1111;
    --error-borde: #4A2424;
    --no: #FF7A7A;
    --no-pastilla: rgba(255, 122, 122, .14);
    --info-fondo: var(--azul-hueco);
    --info-texto: var(--azul-texto);
    --info-borde: var(--azul-borde);

    /* Lo que va encima de un fotograma de video no sigue el tema. */
    --sobre-video: rgba(11, 12, 16, .55);
    --barrido: rgba(255, 255, 255, .06);
    --velo: rgba(0, 0, 0, .62);
    /* El anillo de foco no es el azul de relleno: sobre un boton azul no se veria. */
    --foco: #B9C6FF;

    /* Nombres antiguos, apuntando al sistema nuevo. */
    --negro: #0B0C10;
    --blanco: #ECEEF4;
    --ok: var(--ok-texto);
    --accent: var(--azul);
    --live: var(--azul);
    --live-hueco: var(--azul-hueco);
    --live-hondo: var(--azul-texto);

    /*
     * Tipografia: Sora para titulos y cifras grandes, DM Sans para el texto,
     * JetBrains Mono para tiempos, identificadores y atajos.
     */
    --fuente-titulo: "Sora", "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --fuente-texto: "DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --fuente-dato: "JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;

    /* Sombras: casi nada; sobre oscuro separa el borde, no la sombra. */
    --sombra-accion: 0 0 0 1px var(--destacada-borde), 0 10px 30px -14px rgba(0, 0, 0, .8);
    --sombra-hover: 0 0 0 1px var(--linea-viva), 0 12px 28px -12px rgba(0, 0, 0, .8);
    --elev-plana: none;
    --elev-elevada: var(--sombra-hover);
    --elev-flotante: 0 24px 60px -20px rgba(0, 0, 0, .75), 0 0 0 1px var(--line);

    /* Radios: controles 12, tarjetas 18, paneles 20. */
    --r-control: 12px;
    --r-tarjeta: 18px;
    --r-panel: 20px;
    --r-pildora: 999px;
    /* Todo lo que se pulsa mide al menos esto de alto. */
    --alto-control: 44px;

    /* Escala tipografica. */
    --t-hero: 32px;
    --t-cifra: 26px;
    --t-titulo: 17px;
    --t-cuerpo: 15px;
    --t-meta: 13px;
    --t-micro: 12px;

    --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;

    /*
     * Movimiento. Entradas de 0,5 s subiendo 10 px, escalonadas 50 ms; cambio
     * de pantalla en 180 ms. Todo se apaga con prefers-reduced-motion.
     */
    --m-rapido: 150ms;
    --m-medio: 240ms;
    --m-entrada: 500ms;
    --m-lento: 420ms;
    --m-pantalla: 180ms;
    --e-salida: cubic-bezier(.22, .8, .2, 1);
    --e-muelle: cubic-bezier(.34, 1.4, .64, 1);
    --m-paso: 50ms;
  }


  /*
   * Las animaciones, en un solo sitio.
   *
   * Todas mueven unicamente transform y opacity. Animar top, left, width o
   * height obliga al navegador a recalcular la maqueta en cada fotograma, y en
   * un movil de gama media eso se ve a tirones. transform y opacity los resuelve
   * la tarjeta grafica.
   */
  @keyframes entra {
    from { opacity: 0; transform: translateY(10px) scale(.985); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes entra-lateral {
    from { opacity: 0; transform: translateX(-8px); }
    to   { opacity: 1; transform: none; }
  }
  /*
   * Latido del paso en curso: dice "esto esta pasando ahora".
   *
   * El halo parte del 12% y no del 6%: sobre blanco, el 6% del menu se pierde y
   * el punto parecia quieto. El extremo se va al 3%, no a cero, para que el
   * anillo se disuelva en vez de cortarse.
   */
  @keyframes late {
    0%, 100% { box-shadow: 0 0 0 3px var(--azul-pastilla); }
    50%      { box-shadow: 0 0 0 7px rgba(65, 96, 230, .03); }
  }
  /* Barrido del esqueleto de carga. */
  @keyframes barre {
    from { transform: translateX(-100%); }
    to   { transform: translateX(100%); }
  }
  @keyframes gira {
    to { transform: rotate(360deg); }
  }
  /* Salida de una tarjeta ya decidida: se va hacia el lado, no se desvanece. */
  @keyframes resuelta {
    to { opacity: 0; transform: translateX(var(--sale, 0)) scale(.96); }
  }
  /* El punto verde que "respira": algo esta vivo ahora mismo. */
  @keyframes respira {
    0%, 100% { box-shadow: 0 0 0 0 rgba(61, 220, 151, .45); }
    50%      { box-shadow: 0 0 0 6px rgba(61, 220, 151, 0); }
  }
  /* Brillo que recorre una barra mientras hay trabajo en curso. */
  @keyframes brillo {
    from { transform: translateX(-100%); }
    to   { transform: translateX(200%); }
  }
  /* La insignia de aprobado o descartado: aparece con un golpe corto. */
  @keyframes pop {
    0%   { opacity: 0; transform: scale(.6); }
    60%  { opacity: 1; transform: scale(1.12); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes fundido {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* Titulos y cifras grandes en Sora; datos en mono. */
  h1, h2, h3, .cifra, .stats b, .hook, .jobname, .srctitle, .seccion h2, .flujo b, .siguiente h2 {
    font-family: var(--fuente-titulo);
    letter-spacing: -.01em;
  }
  .dato, time, kbd, .mono { font-family: var(--fuente-dato); font-variant-numeric: tabular-nums; }
  kbd {
    display: inline-block; min-width: 1.6em; padding: 1px 6px; border-radius: 6px;
    border: 1px solid var(--line); background: var(--raised); color: var(--dim);
    font-size: 11.5px; line-height: 1.5; text-align: center;
  }

  /* Botones y campos: al menos 44 px de alto, tambien en el movil. */
  button.act, .chip, input:not([type="checkbox"]):not([type="radio"]):not([type="color"]):not([type="range"]),
  select, .subtab {
    min-height: var(--alto-control);
  }

  /* Iconos de trazo (lucide), del color del texto. */
  .ico-svg { width: 18px; height: 18px; flex: none; stroke: currentColor; fill: none;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

  /* Punto de estado vivo. */
  .vivo-punto { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--ok-texto); flex: none; animation: respira 2s ease-in-out infinite; }
  .vivo-punto.apagado { background: var(--no); animation: none; }
  .vivo-punto.espera { background: var(--aviso-texto); animation: none; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    /*
     * Instrument Sans, elegida, no heredada.
     *
     * system-ui no es una decision: es Segoe UI en Windows, San Francisco en
     * iPhone y Roboto en Android, asi que el panel se parecia a lo que hubiera
     * al lado. Esta es una grotesca de caja alta y terminaciones rectas, que es
     * lo que sostiene el tono de herramienta sin irse a lo decorativo.
     *
     * Detras va el sistema, no un sans generico: si la fuente no llega, el panel
     * se pinta con la del aparato y se sigue leyendo igual.
     */
    font: 15px/1.55 var(--fuente-texto);
    padding-bottom: env(safe-area-inset-bottom);
    -webkit-font-smoothing: antialiased;
    /*
     * Cifras de ancho fijo y cero rebanado.
     *
     * Los contadores cambian solos cuando llega un aviso del servidor. Con las
     * cifras proporcionales que trae la fuente por defecto, pasar de 9 a 10
     * mueve el texto de al lado y la fila entera da un salto. Con tnum cada
     * digito ocupa lo mismo y el numero cambia sin empujar nada.
     */
    font-variant-numeric: tabular-nums slashed-zero;
  }

  /*
   * Estados de los controles.
   *
   * No habia ninguno: ni hover, ni pulsado, ni foco de teclado. Un boton que no
   * responde al tocarlo se siente roto aunque funcione, y sin foco visible el
   * panel es inmanejable con teclado.
   */
  button, .chip, .tab, #nav button, summary {
    transition: background-color .16s ease, border-color .16s ease,
                color .16s ease, transform .12s ease;
  }
  button:not(:disabled):hover, .chip:not(:disabled):hover { border-color: var(--linea-viva); }
  .act:not(:disabled):hover { filter: brightness(1.07); }
  /* Hundir un pixel al pulsar: es lo que convierte un rectangulo en un boton. */
  button:not(:disabled):active, .chip:not(:disabled):active { transform: translateY(1px); }

  /*
   * Foco solo para quien navega con teclado.
   *
   * :focus-visible y no :focus, para que el anillo no salte al tocar con el
   * dedo, que es como se usa esto la mayor parte del tiempo.
   */
  :focus-visible {
    /*
     * Anillo de dos tonos, no un outline suelto.
     *
     * Un solo anillo depende de lo que tenga debajo: sobre el boton azul el
     * azul no se ve, y sobre una tarjeta blanca un anillo claro tampoco. El
     * halo interior del color del fondo separa el anillo de la superficie,
     * asi que funciona encima de cualquier cosa y en los dos temas.
     *
     * Va en box-shadow y no en outline porque outline no se puede apilar.
     * Se conserva un outline transparente para el modo de alto contraste de
     * Windows, que ignora box-shadow y dejaria el foco invisible.
     */
    outline: 2px solid transparent;
    outline-offset: 2px;
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--foco);
    border-radius: var(--r-control);
  }

  /*
   * Quien pida menos movimiento, lo recibe.
   *
   * Habia cuatro transiciones declaradas y ninguna consultaba esta preferencia.
   * Para alguien con sensibilidad al movimiento, una interfaz que se desliza
   * sin permiso va de molesta a mareante.
   */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: .01ms !important;
      scroll-behavior: auto !important;
      /*
       * Los retardos tambien, no solo las duraciones.
       *
       * Sin esta linea la cascada de una lista sigue escalonada: treinta clips
       * a 40 ms son mas de un segundo de aparicion por goteo. La animacion dura
       * nada pero la espera se mantiene, que para quien pidio menos movimiento
       * es igual de molesto y ademas parece que la pagina va lenta.
       */
      animation-delay: 0ms !important;
      transition-delay: 0ms !important;
    }
  }

  /*
   * Entrada en cascada.
   *
   * El retardo se pone con nth-child y no con una variable por elemento porque
   * el HTML se genera concatenando cadenas: un style inline por tarjeta
   * ensuciaria el marcado de la lista entera. Doce escalones bastan; a partir
   * de ahi todo entra junto, que es lo correcto porque ya esta fuera de
   * pantalla y nadie lo ve escalonarse.
   */
  .cascada > * {
    animation: entra var(--m-medio) var(--e-salida) both;
  }
  .cascada > *:nth-child(1)  { animation-delay: calc(var(--m-paso) * 0); }
  .cascada > *:nth-child(2)  { animation-delay: calc(var(--m-paso) * 1); }
  .cascada > *:nth-child(3)  { animation-delay: calc(var(--m-paso) * 2); }
  .cascada > *:nth-child(4)  { animation-delay: calc(var(--m-paso) * 3); }
  .cascada > *:nth-child(5)  { animation-delay: calc(var(--m-paso) * 4); }
  .cascada > *:nth-child(6)  { animation-delay: calc(var(--m-paso) * 5); }
  .cascada > *:nth-child(7)  { animation-delay: calc(var(--m-paso) * 6); }
  .cascada > *:nth-child(8)  { animation-delay: calc(var(--m-paso) * 7); }
  .cascada > *:nth-child(n+9) { animation-delay: calc(var(--m-paso) * 8); }

  /*
   * Un solo momento orquestado por pantalla, y solo al llegar los datos.
   *
   * En Inicio son dos piezas y en este orden: primero la tarjeta que dice que
   * toca hacer, y 90 ms despues las cifras que la respaldan. Eso es lo que hace
   * que se lea como una frase en vez de como dos cosas que aparecieron juntas.
   * Lo demas de la pantalla (añadir un video, la lista de VOD) entra sin
   * animacion a proposito: si todo se desliza al cargar, el orden deja de decir
   * nada y solo queda el retraso.
   *
   * 90 + 240 = 330 ms de principio a fin. Por debajo del tercio de segundo, que
   * es donde una secuencia todavia se percibe como una sola cosa y no como una
   * espera.
   *
   * En "Revisar" el momento equivalente es la cascada de la lista, que
   * ya esta arriba. Ninguna pantalla tiene dos.
   */
  .paso-1 { animation: entra var(--m-medio) var(--e-salida) both; }
  .paso-2 { animation: entra var(--m-medio) var(--e-salida) 90ms both; }

  /*
   * Esqueletos de carga.
   *
   * Antes cada vista decia "Cargando..." centrado en gris. Eso no informa de
   * nada y ademas salta: el texto ocupa una linea y lo que llega ocupa media
   * pantalla, asi que todo se recoloca de golpe. Un esqueleto con la forma de
   * lo que viene reserva el sitio y la llegada no mueve nada.
   */
  .hueso {
    position: relative; overflow: hidden;
    background: var(--raised); border-radius: var(--r-control);
    height: 13px; margin-bottom: var(--s2);
  }
  .hueso::after {
    content: ""; position: absolute; inset: 0;
    /* El barrido oscurece en el tema claro y aclara en el oscuro: sobre un
       hueso gris claro un brillo blanco no se ve, y al reves tampoco. */
    background: linear-gradient(90deg, transparent, var(--barrido), transparent);
    animation: barre 1.4s var(--e-salida) infinite;
  }
  .hueso.alto { height: 44px; }
  .hueso.titulo { height: 17px; width: 55%; margin-bottom: var(--s3); }
  .hueso.corto { width: 35%; }
  .hueso.medio { width: 70%; }

  /*
   * El indicador de que algo se esta procesando: la espiral de la marca.
   *
   * Empezo siendo un anillo partido girando, que es lo que se pone cuando no
   * hay glifo. Ahora es la espiral del logo, sacada del manual. Una espiral
   * girando funciona mejor que un anillo: el anillo necesita un hueco para que
   * se note el giro, la espiral ya tiene una direccion propia.
   *
   * Gira sobre el centro de su propio recuadro, no sobre el del glifo entero.
   * Con el lienzo completo el eje cae en el asta de la P y la espiral haria una
   * orbita en vez de girar sobre si misma.
   */
  .girando { display: flex; flex: none; color: var(--azul); }
  .girando .espiral {
    display: block;
    animation: gira 1100ms linear infinite;
    transform-origin: 50% 50%;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: var(--bg-velado);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
    /*
     * El relleno superior suma la zona segura. La pagina usa viewport-fit=cover
     * para llegar a los bordes, asi que sin esto el titulo queda debajo del
     * reloj y la bateria en un movil con muesca.
     */
    padding: calc(var(--s3) + env(safe-area-inset-top)) var(--s4) var(--s3);
  }
  /*
   * Sin margen inferior: el titulo vive dentro de una fila flex y el espacio
   * hasta lo de abajo ya lo pone el padding del encabezado. Con el margen, la
   * fila crecia por dentro y descuadraba el alto.
   */
  h1 { margin: 0; font-size: var(--t-titulo); font-weight: 600; letter-spacing: -.01em; }
  /*
   * Pestañas de seccion. Son navegacion, no filtros.
   *
   * Por eso se ven distintas de .tab: subrayado en vez de pildora. Las .tab
   * eligen QUE se mira dentro de una pantalla (pendientes, aprobados); estas
   * eligen QUE PANTALLA. Darles el mismo aspecto haria creer que Clientes y
   * Cuentas son dos filtros de la misma lista.
   *
   * Con scroll horizontal porque en Ajustes hay cinco y en un movil estrecho no
   * caben; envolverlas en dos lineas movería el contenido de sitio al cambiar.
   */
  .subtabs {
    display: flex; gap: 2px; margin: 0 0 18px; overflow-x: auto;
    border-bottom: 1px solid var(--line); scrollbar-width: none;
  }
  .subtabs::-webkit-scrollbar { display: none; }
  .subtab {
    flex: 0 0 auto; padding: 9px 14px; border: 0; border-bottom: 2px solid transparent;
    background: transparent; color: var(--dim); font: inherit; font-size: 14px;
    font-weight: 500; cursor: pointer; white-space: nowrap; transition: .15s;
  }
  .subtab:hover { color: var(--txt); }
  .subtab[aria-selected="true"] { color: var(--azul); border-bottom-color: var(--azul); font-weight: 600; }

  /*
   * Vista previa. El marco es 1080x1920 a escala 1/4.
   *
   * La medida importa: todo lo que se dibuja dentro viene en pixeles del
   * lienzo real y se multiplica por esa misma escala en el guion. Si se cambia
   * aqui el ancho, hay que cambiar la constante ESCALA de vistaPrevia o el
   * tamaño del subtitulo dejara de corresponderse con el del video final.
   */
  .pv-fila { display: flex; gap: var(--s4); flex-wrap: wrap; align-items: flex-start; }
  .pv-marco {
    position: relative; width: 270px; height: 480px; flex: 0 0 auto;
    border-radius: var(--r-control); overflow: hidden; background: #000;
  }
  .pv-video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pv-sinvideo {
    display: flex; align-items: center; justify-content: center; height: 100%;
    color: var(--faint); font-size: 13px; text-align: center; padding: 0 16px; line-height: 1.5;
  }
  /*
   * Centrado y con sombra, como lo pone libass.
   *
   * El borde de verdad lo dibuja -webkit-text-stroke desde el guion; la sombra
   * imita el Shadow 4 de la linea Style del .ass, que es lo que despega el
   * texto de un fondo claro cuando el borde es fino.
   */
  /*
   * Las dos capas de texto del lienzo: el subtitulo abajo y el rotulo arriba.
   *
   * Comparten todo menos de que borde cuelgan, que lo pone el guion en linea
   * junto con el cuerpo y los colores. Las dos van en mayusculas y centradas
   * porque asi las escribe el .ass.
   */
  .pv-sub, .pv-titulo {
    position: absolute; left: 7%; right: 7%; text-align: center;
    font-weight: 700; line-height: 1.15; text-transform: uppercase;
    text-shadow: 0 1px 2px rgba(0,0,0,.55);
    word-break: break-word;
  }
  /*
   * Agarrables, al contrario que antes.
   *
   * .pv-sub llevaba pointer-events:none para no estorbar a los controles del
   * video que hay debajo. Ahora se arrastran, asi que tienen que recibir el
   * puntero; lo que se evita es que el gesto se interprete como seleccionar
   * texto, que en un movil produce la lupa de copiar en vez de mover nada.
   */
  .pv-capa {
    cursor: grab; touch-action: none;
    user-select: none; -webkit-user-select: none;
  }
  .pv-capa.moviendo { cursor: grabbing; }
  /* Un contorno punteado al pasar y al enfocar: dice que esto se puede coger
     sin añadir un asidero que no sale en el video de verdad. */
  @media (hover: hover) {
    .pv-capa:hover { outline: 1px dashed var(--blanco); outline-offset: 4px; }
  }
  .pv-capa:focus-visible { outline: 2px solid var(--blanco); outline-offset: 4px; box-shadow: none; }
  .pv-datos { flex: 1 1 240px; min-width: 240px; }
  .pv-texto {
    margin: var(--s2) 0 0; font-size: var(--t-meta); line-height: 1.5;
    white-space: pre-wrap; word-break: break-word;
    background: var(--hueco); border-radius: var(--r-control); padding: 10px 12px;
  }
  input[type="color"] {
    width: 54px; height: 32px; padding: 2px; cursor: pointer;
    border: 1px solid var(--line); border-radius: var(--r-control); background: var(--hueco);
  }

  .tabs { display: flex; gap: 8px; }
  .tab {
    flex: 1; padding: 9px 6px; border: 1px solid var(--line); border-radius: var(--r-control);
    background: transparent; color: var(--dim); font-size: 13px; font-weight: 500;
    cursor: pointer; transition: .15s;
  }
  /*
   * El filtro elegido se marca como el item activo del menu, no con un gris.
   *
   * En oscuro bastaba con aclarar el fondo: el #141416 del panel se veia sobre
   * el negro. Sobre #FAFAFA, un #FFFFFF no es un estado, son dos blancos. Y
   * como lo que dice es donde estas, que es justo lo que dice el menu, lleva el
   * mismo tratamiento azul: la interfaz tiene una sola forma de decir "aqui".
   */
  .tab[aria-selected="true"] {
    background: var(--azul-hueco); color: var(--azul);
    border-color: var(--azul-borde); font-weight: 600;
  }
  .tab b { display: block; font-size: 17px; font-weight: 700; }
  main { padding: var(--s4); display: grid; gap: var(--s4); max-width: 560px; margin: 0 auto; }

  /*
   * En pantalla ancha el contenido ocupa el hueco, no una columna de movil.
   *
   * El panel nacio pensado para el telefono y la columna de 560 px se quedo
   * tambien en el escritorio: con el menu fijo ocupando 236 px, el resto de un
   * monitor de 1500 px quedaba en blanco a los dos lados.
   *
   * Dos columnas y no mas, aunque quepan tres. Las tarjetas llevan texto
   * explicativo y a 400 px de ancho se leen bien; a 300 cada frase se parte en
   * cinco lineas y cuesta mas leerlas que antes.
   *
   * Las columnas se alinean arriba para que una tarjeta corta no se estire
   * hasta la altura de la larga que tiene al lado.
   *
   * Y se miden con minmax(0, 1fr), no con 1fr a secas: un hijo ancho (una
   * tabla, un video) forzaria la columna a crecer y romperia la rejilla hacia
   * fuera de la pantalla.
   */
  @media (min-width: 1000px) {
    /*
     * Columnas fluidas, no rejilla.
     *
     * Con rejilla de dos columnas, una seccion con una sola tarjeta dejaba la
     * mitad derecha en blanco: la rejilla coloca por celdas y no rellena los
     * huecos con lo que viene despues. Las columnas de CSS si: el contenido
     * fluye y las dos quedan parejas aunque las tarjetas midan cosas distintas,
     * que es justo el caso de este panel.
     */
    main {
      display: block;
      max-width: 1240px;
      column-count: 2;
      column-gap: var(--s4);
    }
    /*
     * Ninguna tarjeta se parte por la mitad entre columnas, y un titulo de
     * seccion nunca se queda solo al final de una: arrastra consigo lo que
     * encabeza, que si no se leeria como titulo de otra cosa.
     */
    main > * { break-inside: avoid; margin-bottom: var(--s4); }
    /*
     * .seccion ADEMAS de .sectitle.
     *
     * Las cabeceras pasaron de ser una linea gris (.sectitle) a un bloque con
     * icono y explicacion (.seccion), y estas dos reglas se quedaron apuntando
     * a la clase vieja. Resultado en Ajustes: "El rotulo de arriba" se quedaba
     * al final de la columna izquierda y sus siete controles aparecian arriba
     * en la derecha, sin titulo. Ocho tarjetas sin saber cual era cual.
     */
    main > .sectitle,
    main > .seccion { break-after: avoid; }
    /*
     * Lo que ocupa el ancho entero.
     *
     * La fila de pestañas porque es la navegacion de la seccion. La vista
     * previa y el siguiente paso porque necesitan sitio para poner el video y
     * sus datos uno al lado del otro.
     */
    main > .subtabs,
    main > .ancho { column-span: all; }

    /*
     * Un estado vacio que es TODA la pantalla cruza las dos columnas.
     *
     * Se cae en cuenta con Agenda vacia: "Nada programado" salia metido en la
     * columna izquierda, 507 px de 1030, con la mitad derecha en negro. No es
     * una tarjeta mas entre otras, es lo unico que hay, asi que repartirlo en
     * columnas no significa nada.
     *
     * La regla mira el PARENTESCO y no una clase: cualquier estado vacio que
     * sea hijo directo de main es el de la pantalla entera, y uno metido
     * dentro de una tarjeta (una lista sin filas) no se ve afectado. Asi no
     * hay que acordarse de etiquetar el siguiente.
     *
     * Con el ancho acotado y centrado: dos frases centradas sobre mil pixeles
     * se leen de un extremo a otro de la pantalla.
     */
    main > .empty {
      column-span: all;
      max-width: 42rem;
      margin-left: auto; margin-right: auto;
    }

    /*
     * Revisar lleva columnas mas estrechas, y no por gusto.
     *
     * Las tarjetas de revision llevan un video vertical que ocupa el ancho de
     * su columna: a 596 px, cada video mide mas de mil de alto y con cuarenta
     * y cinco pendientes la pantalla pasaba de cuarenta mil pixeles. Revisar es
     * mirar y decidir deprisa, no leer: con columnas de unos 320 px caben
     * cuatro clips a la vez y se ve de que va cada uno sin bajar.
     */
    /*
     * En Revisar las tarjetas van en rejilla, no apiladas.
     *
     * La rejilla se le pone a .lista-clips y no a main: las tarjetas estan
     * envueltas en ese contenedor, asi que main solo ve dos hijos y repartirlo
     * a el no cambiaba nada. Cada tarjeta lleva un video vertical que ocupa el
     * ancho disponible; en una sola columna ancha la pantalla medi­a cuarenta y
     * seis mil pixeles con cuarenta y cinco pendientes.
     *
     * Revisar es mirar y decidir deprisa. Con columnas de unos 300 px caben
     * tres o cuatro clips a la vez.
     */
    main.vista-clips { column-count: 1; }
    .lista-clips {
      grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
      align-items: start;
    }
    /*
     * Rejilla y no columnas fluidas, SOLO aqui.
     *
     * Las columnas reparten bien contenido de alturas distintas, que es el
     * caso del resto del panel. Pero no saben partir una tarjeta de mil
     * pixeles que ademas pide no partirse: las cuarenta y cinco se apilaban en
     * la primera columna y la pantalla seguia midiendo cuarenta y seis mil
     * pixeles. Estas tarjetas son todas iguales, y para eso la rejilla es
     * exacta.
     */
    /*
     * Y el titulo de lo que ocupa el ancho entero, tambien.
     *
     * break-after no sirve aqui: lo que viene detras no cabe en la columna, asi
     * que el titulo se quedaba arriba en una columna y su tarjeta aparecia
     * abajo cruzando las dos. Parecian cosas distintas.
     */
    main > .sectitle:has(+ .ancho),
    main > .seccion:has(+ .ancho) { column-span: all; }
  }
  /*
   * Tres niveles de tarjeta, no uno.
   *
   * El panel tenia todo en el mismo tipo de caja, asi que la accion principal
   * y una nota al pie pesaban igual. Ahora hay una jerarquia explicita:
   * destacada para lo que toca hacer ahora, normal para el contenido, y plana
   * para lo que solo acompaña.
   */
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--r-tarjeta); overflow: hidden;
    transition: border-color var(--m-medio) var(--e-salida),
                transform var(--m-medio) var(--e-salida);
  }
  /*
   * La lista de clips, apilada con su propia separacion.
   *
   * Antes las tarjetas eran hijas directas de main y heredaban su rejilla. Al
   * meterlas en un contenedor para la cascada perdian la separacion, asi que la
   * lleva el contenedor.
   */
  .lista-clips { display: grid; gap: var(--s4); }
  /*
   * La tarjeta de clip reacciona al puntero. Un grado, no diez.
   *
   * Se ilumina el borde y se levanta un pixel. Levantar mas, o escalar, mueve
   * el video que hay dentro y da la sensacion de que la pagina flota.
   * En tactil no se aplica: sin puntero, un hover que se queda pegado tras
   * tocar se lee como que la tarjeta quedo seleccionada.
   */
  @media (hover: hover) {
    .lista-clips .card:hover {
      border-color: var(--linea-viva);
      transform: translateY(-1px);
      /*
       * La sombra aparece AL PASAR EL PUNTERO, no esta puesta de fondo.
       *
       * Es la diferencia entre una sombra que informa y una que decora: aqui
       * dice "esto responde", y solo la ven las tarjetas de clip, que son las
       * unicas de la interfaz con las que se interactua directamente.
       */
      box-shadow: var(--sombra-hover);
    }
  }
  .card:hover { transition-duration: var(--m-rapido); }
  /*
   * La tarjeta que pide accion, y la unica de la pantalla que se permite ser
   * llamativa.
   *
   * En oscuro se distinguia con un degradado, que en claro no funciona: entre
   * #FFFFFF y un gris al 2% no hay degradado, hay suciedad. Aqui el peso lo
   * lleva el borde azul y una sombra con una gota de indigo dentro, que es lo
   * que la levanta del fondo sin cambiarle el color al papel.
   */
  .card.hero {
    background: var(--panel);
    border-color: var(--azul-borde);
    box-shadow: var(--sombra-accion);
  }
  .card.flat {
    background: transparent; border: none; border-radius: 0;
    padding: 0 var(--s1);
  }
  .card.flat .body { padding: 0; }

  /* Nota plegada. La explicacion larga no debe competir con la accion. */
  details.nota { margin-top: var(--s3); }
  /*
   * La interrogacion va dentro de un circulo, no suelta delante del texto.
   *
   * Un "?" seguido de un espacio y una frase se lee como un caracter que no
   * cargo bien: en "? No tienes que hacer nada" el signo parece un fallo de
   * fuente, no un boton. Metido en un circulo del color del acento se lee por
   * lo que es, que es algo que se puede abrir.
   *
   * Y al abrirse pasa a un guion largo, no a una "x": una equis al lado de un
   * texto significa borrar en todas las demas pantallas de este panel.
   */
  details.nota summary {
    cursor: pointer; color: var(--faint); font-size: var(--t-meta);
    list-style: none; padding: var(--s1) 0;
    display: flex; align-items: center; gap: 7px;
  }
  details.nota summary::-webkit-details-marker { display: none; }
  details.nota summary::before {
    content: "?";
    flex: none; width: 16px; height: 16px; border-radius: 50%;
    display: grid; place-items: center;
    font-size: 11px; font-weight: 700; line-height: 1;
    background: var(--azul-hueco); color: var(--azul-texto);
  }
  details.nota[open] summary::before { content: "3"; }
  @media (hover: hover) {
    details.nota summary:hover { color: var(--text); }
    details.nota summary:hover::before { background: var(--azul-pastilla); }
  }
  details.nota p { color: var(--dim); font-size: var(--t-meta); margin: var(--s2) 0 0; }

  /*
   * Desplegable de contenido, no nota de ayuda.
   *
   * Las .nota llevan "?" porque son explicaciones opcionales. "13 videos
   * terminados" no explica nada: esconde una lista. Con el "?" delante se leia
   * como si fuera a contarte algo sobre los videos terminados en vez de
   * enseñartelos.
   */
  details.plegable > summary {
    cursor: pointer; list-style: none; padding: var(--s3) 0;
    color: var(--dim); font-size: var(--t-meta); font-weight: 500;
  }
  details.plegable > summary::-webkit-details-marker { display: none; }
  details.plegable > summary::before {
    content: "\\25B8"; display: inline-block; width: 1.1em;
    transition: transform .15s;
  }
  details.plegable[open] > summary::before { transform: rotate(90deg); }
  details.plegable > summary:hover { color: var(--txt); }

  /* Etiqueta de estado. */
  .badge {
    display: inline-block; padding: 3px 8px; border-radius: var(--r-pildora);
    font-size: var(--t-micro); font-weight: 600; letter-spacing: .02em;
    background: var(--line); color: var(--dim);
  }
  /*
   * Las etiquetas se alinean por fin con el sistema de significado.
   *
   * Quedaban tres rellenos a pelo de la paleta vieja: un verde #2ECC71, un
   * ambar #F4B942 y un rojo #E74C3C que no eran de la marca y que ademas
   * contradecian sus propias reglas (el ok iba en verde pero pintaba texto
   * indigo encima). Ahora cada una toma el color de lo que significa.
   */
  .badge.ok   { background: var(--indigo-pastilla); color: var(--indigo); }
  .badge.live { background: var(--azul-pastilla); color: var(--azul); }
  .badge.bad  { background: var(--no-pastilla); color: var(--no); }
  /* Ambar solo aqui: "algo justo" es de las pocas cosas que piden atencion. */
  .badge.wait { background: var(--aviso-fondo); color: var(--aviso-texto); }

  /*
   * La tuberia como pasos, no como botones sueltos.
   *
   * Descargar, elegir, renderizar, variantes y repartir son una secuencia con
   * estado. Enseñarlos como cinco botones iguales obliga a recordar el orden;
   * enseñarlos como pasos con su marca hace que se vea de un vistazo.
   */
  .steps { display: flex; gap: var(--s1); margin: var(--s3) 0; }
  .step {
    flex: 1; text-align: center; font-size: var(--t-micro);
    color: var(--faint); padding-top: 16px; position: relative;
    transition: color var(--m-medio) var(--e-salida);
  }
  .step::before {
    content: ""; position: absolute; top: 4px; left: 50%;
    width: 9px; height: 9px; border-radius: 50%; background: var(--punto);
    /* El translate va aqui y no en cada estado: si un estado redefine transform
       sin repetirlo, el punto se descoloca media anchura a la derecha. */
    transform: translateX(-50%);
    transition: background-color var(--m-medio) var(--e-salida);
  }
  .step::after {
    content: ""; position: absolute; top: 8px; left: 50%; width: 100%; height: 1px;
    background: var(--punto);
  }
  .step:last-child::after { display: none; }
  /*
   * El tramo cumplido se dibuja creciendo, no apareciendo.
   *
   * Se conserva la decision de color que ya estaba tomada aqui: lo terminado se
   * apaga y el paso en curso es lo unico con color. Pintar de azul los pasos
   * hechos parece mas vistoso, pero deja cuatro cosas azules compitiendo y la
   * que importa (donde estas) se pierde entre ellas.
   *
   * Lo que si cambia es que el tramo crece de izquierda a derecha en vez de
   * estar ahi de golpe, que es lo que convierte cuatro puntos sueltos en una
   * sola medida de avance. Con transform, no con width: asi lo resuelve la
   * tarjeta grafica y no hay recalculo de maqueta por fotograma.
   */
  .step::after { transform-origin: left; }
  .step.done::after { animation: llena var(--m-lento) var(--e-salida) both; }
  @keyframes llena {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  /*
   * Lo terminado se apaga; el paso en curso es lo unico con color.
   *
   * Antes lo hecho iba en verde y lo activo en el color de accion. Con el
   * acento nuevo los dos quedaban a un paso de distancia y costaba distinguir
   * cual era cual. Ademas el verde sobraba: en una secuencia, la posicion ya
   * dice que un paso esta cumplido. Guardar el color para el paso activo hace
   * que se encuentre sin buscarlo.
   */
  .step.done { color: var(--dim); }
  .step.done::before { background: var(--faint); }
  .step.done::after { background: var(--faint); opacity: .5; }
  .step.now { color: var(--live); font-weight: 600; }
  .step.now::before { background: var(--live); box-shadow: 0 0 0 3px var(--live-hueco); }
  /*
   * El latido solo cuando de verdad hay un proceso corriendo.
   *
   * Un punto latiendo significa "esto se esta moviendo". Si late tambien
   * mientras el VOD espera a que alguien pulse el boton, miente: da sensacion
   * de actividad donde no la hay, y cuando algo se mueve de verdad ya no se
   * distingue. La clase la pone el pintado segun el estado real.
   */
  .src.trabajando .step.now::before { animation: late 1.8s var(--e-salida) infinite; }
  video { width: 100%; display: block; background: #000; aspect-ratio: 9/16; max-height: 68vh; }
  .body { padding: var(--s3) var(--s4) var(--s4); }
  .meta { display: flex; gap: 10px; align-items: center; font-size: var(--t-meta); color: var(--faint); margin-bottom: var(--s2); }
  /*
   * El score no es un adorno, es un juicio.
   *
   * Antes iba siempre en ambar, dijera 95 o 38. Ahora el color lo dice: indigo
   * si el modelo lo considera bueno, gris si es flojo. Asi se distingue de un
   * vistazo sin leer el numero.
   */
  .score { color: var(--dim); font-weight: 700; }
  .score.alto { color: var(--indigo-texto); }
  .hook { font-size: var(--t-titulo); font-weight: 600; line-height: 1.35; margin: 0 0 var(--s2); letter-spacing: -.01em; }
  .reason { font-size: var(--t-meta); color: var(--dim); margin: 0 0 var(--s3); }
  .lead { font-size: var(--t-cuerpo); margin: 0 0 var(--s3); }
  .lead b { font-weight: 650; }
  /*
   * Etiquetas en minuscula, y no por gusto.
   *
   * Habia siete sitios en ALL CAPS con interletrado abierto: etiquetas de
   * campo, rotulos de seccion, cabeceras de tabla, estado del trabajo y tres
   * antetitulos. Es el adorno por defecto de cualquier panel, se lee mas lento
   * (en versalitas se pierde el perfil de la palabra) y ninguno de los siete
   * ganaba nada. El nivel lo marcan ahora el tamaño y el color.
   */
  label { display: block; font-size: var(--t-meta); color: var(--dim); margin-bottom: 5px; }
  textarea, input, select {
    width: 100%; background: var(--hueco); border: 1px solid var(--line); color: var(--text);
    border-radius: var(--r-control); padding: 9px 10px; font: inherit; font-size: 14px; resize: vertical;
  }
  /*
   * El borde azul marca el campo activo con el raton. El anillo de foco se
   * queda SOLO para el teclado.
   *
   * Antes esta regla llevaba outline:none a secas, que pesa mas que el
   * :focus-visible universal de arriba y se lo comia: quien recorria los
   * veinte ajustes con el tabulador no veia donde estaba. Ahora el
   * :not(:focus-visible) deja pasar el anillo cuando viene del teclado.
   */
  textarea:focus, input:focus, select:focus { border-color: var(--live); }
  textarea:focus:not(:focus-visible),
  input:focus:not(:focus-visible),
  select:focus:not(:focus-visible) { outline: none; box-shadow: none; }
  .count { font-size: 11px; color: var(--dim); text-align: right; margin-top: 3px; }
  .count.over { color: var(--no); }
  .field { margin-bottom: 11px; }
  .actions { display: flex; gap: 9px; margin-top: 4px; }
  /*
   * El boton base no decide el color del texto; lo decide cada variante.
   *
   * Antes la regla "button.act" fijaba texto negro, y como lleva elemento
   * ademas de clase, pesaba mas que el color blanco de ".go" que venia debajo.
   * Resultado: el boton principal salia con texto negro sobre azul, 3,74:1 de
   * contraste, por debajo del minimo legible. Sin color aqui, cada variante
   * manda sobre el suyo sin pelear.
   *
   * (Nada de acentos graves en estos comentarios: la pagina entera vive dentro
   * de una plantilla de texto y uno solo la cierra a media altura.)
   */
  /*
   * .act es el tamaño de un boton principal; el COLOR lo pone la clase que la
   * acompaña (.go, .approve, .reject). Aun asi lleva el azul por defecto: una
   * .act suelta salia con el gris del fondo y texto encima, indistinguible de
   * una caja vacia, y eso es una trampa esperando a la proxima pantalla.
   */
  /*
   * .act da el tamaño; el color lo pone la clase que la acompaña.
   *
   * El color por defecto va en :not() y no en la regla de arriba a proposito.
   * Puesto en button.act pesa mas que .approve -- una clase y una etiqueta
   * contra una clase -- y pintaba de azul los botones de aprobar y descartar,
   * que son justo los dos que NO pueden parecerse. Asi el azul solo alcanza a
   * una .act que no ha dicho de que color es.
   */
  button.act {
    flex: 1; padding: 13px; border: none; border-radius: var(--r-control);
    font-size: 15px; font-weight: 650; cursor: pointer;
  }
  button.act:not(.approve):not(.reject):not(.undo):not(.go) {
    background: var(--azul); color: var(--blanco);
  }
  button.act:disabled { opacity: .45; cursor: default; }
  /* Aprobar es el unico boton de exito: indigo de marca con texto blanco. */
  .approve { background: var(--indigo); color: var(--blanco); }
  .reject  { background: var(--no); color: var(--blanco); }
  .undo    { background: transparent; border: 1px solid var(--line); color: var(--dim); }
  .go      { background: var(--azul); color: var(--blanco); }
  /*
   * Nivel intermedio.
   *
   * Hacia falta: con solo "azul solido" y "borde tenue", un boton real como
   * "Descargar y transcribir" quedaba indistinguible de uno desactivado. Este
   * se ve pulsable sin robarle el protagonismo al siguiente paso.
   */
  .sec {
    background: var(--raised); color: var(--text); border: 1px solid var(--linea-viva);
  }
  .empty { text-align: center; color: var(--dim); padding: 56px 20px; }
  .empty b { display: block; font-size: 16px; color: var(--text); margin-bottom: 6px; }
  .warn { background: var(--aviso-fondo); border: 1px solid var(--aviso-borde); color: var(--aviso-texto);
          padding: 9px 11px; border-radius: var(--r-control); font-size: 12.5px; margin-bottom: 11px; }
  .hint { text-align: center; color: var(--dim); font-size: 11.5px; padding: 4px 0 18px; }
  /* Los atajos, los de verdad. Decia solo A y R; desde que hay foco movible y
     seleccion multiple se queda corto justo para quien los usaria. */
  @media (min-width: 620px) {
    .hint.kbd::after {
      content: " · flechas para moverte · espacio marca · A aprobar · R rechazar";
    }
  }

  /*
   * Menu lateral desplegable.
   *
   * Antes eran seis pestañas en una barra inferior. Con seis, cada una se queda
   * en 62 px en un movil de 375: los nombres no caben y los iconos abstractos
   * no dicen nada. En vertical cada opcion tiene su nombre completo y sitio
   * para crecer.
   */
  /*
   * Fila del encabezado: boton de menu y titulo.
   *
   * Se llama "cabecera" y no "barra" porque .barra ya existia para la barra de
   * progreso de las subidas. Al repetir el nombre, el encabezado heredaba de
   * ella una altura de 5 px y overflow oculto, y el titulo salia cortado.
   *
   * (Nada de acentos graves en estos comentarios: la pagina entera vive dentro
   * de una plantilla de texto y uno solo la cierra a media altura.)
   */
  .cabecera {
    display: flex; align-items: center; gap: var(--s3);
  }
  #menu {
    background: none; border: none; color: var(--text); cursor: pointer;
    font-size: 21px; line-height: 1; padding: 2px 4px; margin-left: -4px;
  }

  /*
   * Campana de avisos.
   *
   * Un trabajo tarda minutos y quien lo lanza se va a hacer otra cosa. Hasta
   * ahora el panel se refrescaba en silencio al terminar: los clips nuevos
   * aparecian sin que nada dijera que habian aparecido.
   */
  /*
   * El buscador empuja a los dos a la derecha; la campana ya no lo hace sola.
   */
  #abrir-buscar {
    margin-left: auto;
    background: none; border: none; color: var(--faint); cursor: pointer;
    font-size: 17px; line-height: 1; padding: 4px 6px;
  }
  @media (hover: hover) { #abrir-buscar:hover { color: var(--text); } }

  #campana {
    position: relative;
    background: none; border: none; color: var(--faint); cursor: pointer;
    font-size: 18px; line-height: 1; padding: 4px 6px;
  }
  @media (hover: hover) { #campana:hover { color: var(--text); } }
  #campana[aria-expanded="true"] { color: var(--text); }

  /* Cerrar sesion: el mismo peso que la campana, para no competir con nada. */
  #salir {
    color: var(--faint); text-decoration: none;
    font-size: 17px; line-height: 1; padding: 4px 6px;
  }
  @media (hover: hover) { #salir:hover { color: var(--text); } }
  /* El punto no lleva numero: cuantos avisos hay da igual, lo que importa es si
     hay algo sin mirar. Un "3" invita a contarlos en vez de abrirlos. */
  #campana .bolita {
    position: absolute; top: 1px; right: 2px;
    width: 8px; height: 8px; border-radius: 50%; background: var(--azul);
    box-shadow: 0 0 0 2px var(--bg);
  }
  #campana .bolita.cambia { animation: cuenta var(--m-medio) var(--e-muelle); }

  #avisos {
    position: absolute; z-index: 35; right: var(--s4);
    top: calc(100% + 6px);
    width: 310px; max-width: calc(100vw - var(--s4) * 2);
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--r-tarjeta); box-shadow: var(--sombra-hover);
    overflow: hidden;
    animation: cae var(--m-rapido) var(--e-salida) both;
  }
  @keyframes cae {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: none; }
  }
  #avisos .fila {
    display: block; width: 100%; text-align: left;
    padding: var(--s3) var(--s4); border: none; border-bottom: 1px solid var(--line);
    background: none; cursor: pointer; font: inherit; color: var(--text);
  }
  #avisos .fila:last-child { border-bottom: none; }
  @media (hover: hover) { #avisos .fila:hover { background: var(--hueco); } }
  #avisos .fila .que { display: block; font-size: 14px; font-weight: 500; }
  #avisos .fila .cuando { display: block; font-size: var(--t-meta); color: var(--faint); margin-top: 2px; }
  /* El que fallo lleva una barra roja: en una lista de seis, el que hay que
     mirar tiene que distinguirse sin leer las seis. */
  #avisos .fila.fallo { border-left: 3px solid var(--no); padding-left: calc(var(--s4) - 3px); }
  #avisos .vacio { padding: var(--s4); font-size: 13px; color: var(--faint); text-align: center; }
  #fondo {
    /* El velo lo pone el tema: en claro basta .38, porque sobre una pagina
       blanca uno mas denso apaga el contenido hasta parecer que se fue. */
    position: fixed; inset: 0; z-index: 25; background: var(--velo);
    opacity: 0; pointer-events: none; transition: opacity .2s;
  }
  #fondo.abierto { opacity: 1; pointer-events: auto; }
  /*
   * Por #nav y no por la etiqueta: hay otro <nav> en la pagina, el rastro
   * de migas del detalle de un video, y con el selector de etiqueta heredaba
   * la barra lateral entera -- 236 px de ancho, fuera de pantalla a la
   * izquierda y 800 de alto. El menu es UNO; lo que lo identifica es su id.
   */
  #nav {
    position: fixed; top: 0; bottom: 0; left: 0; z-index: 30;
    width: 236px; max-width: 78vw;
    background: var(--panel); border-right: 1px solid var(--line);
    transform: translateX(-100%); transition: transform .22s ease;
    display: flex; flex-direction: column;
    padding: calc(var(--s5) + env(safe-area-inset-top)) 0 env(safe-area-inset-bottom);
  }
  #nav.abierto { transform: translateX(0); }
  /*
   * El lockup de marca, arriba del menu.
   *
   * El glifo de la P sale del manual, en vectores. El resto es tipografia y no
   * una imagen: asi no hay una peticion extra que retrase el primer pintado, y
   * el nombre se puede seleccionar y leer con un lector de pantalla.
   *
   * Esta es la VERSION DE FONDO CLARO: asta negra, espiral azul. Cambiar el
   * fondo obliga a cambiar de version, y la regla del manual es que nunca se
   * mezclan. Aqui no pueden: el asta hereda currentColor del contenedor, asi
   * que siempre es del color del texto que tiene al lado.
   *
   * Y el color se queda solo en la espiral. El beige del tagline se va con el
   * fondo oscuro: sobre blanco MIDE 1,17:1, que es papel sobre papel. "studio"
   * pasa a gris, y con el wordmark en negro la espiral queda como unico acento
   * del lockup, que es lo que tiene que ser.
   */
  .marca {
    display: flex; align-items: center; gap: 9px;
    padding: 0 var(--s4) var(--s5);
    /*
     * --text, no --negro. El wordmark es del color del texto de la pagina, y
     * en el tema oscuro el negro de marca sobre la barra negra desaparece.
     * La espiral hereda currentColor, asi que esto la arrastra tambien.
     */
    color: var(--text);
  }
  .marca .glifo { display: block; flex: none; }
  .marca-texto { display: flex; align-items: baseline; gap: 5px; }
  .marca-klip {
    font-size: 19px; font-weight: 700; letter-spacing: -.02em;
    color: var(--text);
  }
  .marca-studio {
    font-size: 12.5px; font-style: italic; letter-spacing: .01em;
    color: var(--faint);
  }
  #nav .titulo {
    font-size: var(--t-meta); color: var(--faint); padding: 0 var(--s4) var(--s3);
  }
  #nav button {
    display: flex; align-items: center; gap: var(--s3);
    background: none; border: none; color: var(--faint); cursor: pointer;
    padding: var(--s3) var(--s4); font: inherit; font-size: var(--t-cuerpo);
    text-align: left; width: 100%; border-left: 3px solid transparent;
  }
  /* Lo inactivo esta en gris y se va a negro al pasar por encima. Un solo
     grado, y solo donde hay puntero. */
  @media (hover: hover) {
    #nav button:not([aria-current="true"]):hover { color: var(--text); }
  }
  /*
   * Un solo tratamiento para el activo en toda la app: linea azul a la
   * izquierda, fondo azul al 6% y el texto tambien azul.
   *
   * En oscuro el texto activo iba en blanco porque el azul no se leia sobre
   * negro. Aqui si (5,03:1), asi que las tres señales apuntan al mismo sitio en
   * vez de dos de color y una de contraste.
   */
  #nav button[aria-current="true"] {
    color: var(--azul); background: var(--azul-hueco);
    border-left-color: var(--azul); font-weight: 600;
  }
  #nav button i { font-style: normal; font-size: 17px; width: 22px; text-align: center; }
  /*
   * El contador de pendientes va en azul, no en ambar.
   *
   * Treinta videos esperando no son una alerta, son trabajo por hacer. El
   * ambar se guarda para lo que de verdad va mal.
   */
  #nav button b {
    margin-left: auto; font-size: var(--t-micro); font-weight: 700;
    background: var(--azul); color: var(--blanco);
    border-radius: var(--r-pildora); padding: 1px 7px;
  }
  /*
   * El contador solo se mueve cuando CAMBIA el numero.
   *
   * La clase la pone y la quita el pintado comparando con el valor anterior. Si
   * se animara en cada repintado, latiria cada vez que llega un aviso del
   * servidor (varias veces por minuto, casi siempre sin novedad) y dejaria de
   * significar "ha entrado uno nuevo" para significar "la pagina esta viva".
   */
  @keyframes cuenta {
    0%   { transform: none; }
    45%  { transform: scale(1.22); }
    100% { transform: none; }
  }
  #nav button b.cambia { animation: cuenta var(--m-medio) var(--e-muelle); }

  /* En pantalla ancha el menu se queda fijo: sobra sitio y ahorra un toque. */
  @media (min-width: 900px) {
    #menu, #fondo { display: none; }
    #nav { transform: none; }
    body { padding-left: 236px; }
    /*
     * La cabecera NO lleva el ancho del menu otra vez.
     *
     * Lo llevaba: padding-left de 236 + 16. Pero el relleno de body ya la ha
     * desplazado, porque la cabecera es sticky y va dentro del flujo, no
     * fijada al viewport. El resultado era que el titulo y las pestañas de
     * Revisar empezaban 252 px a la derecha de donde empieza el contenido,
     * con un hueco negro delante que no era de nadie.
     *
     * Se queda con el relleno normal, el mismo que tiene en el movil, que es
     * el que la alinea con las tarjetas de debajo.
     */
  }

  /* --- Cuadro de estadisticas --- */
  /*
   * Tres por fila, salvo cuando son cuatro.
   *
   * Con repeat(3,1fr) fijo, cuatro cifras dejaban la cuarta sola y un hueco
   * gris del tamaño de dos celdas al lado, que parece un fallo de carga. El
   * selector cuenta los hijos: exactamente cuatro se reparten en dos filas de
   * dos, que si cuadra.
   */
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); }
  .stats:has(> div:nth-child(4):last-child) { grid-template-columns: repeat(2, 1fr); }
  .stats div { background: var(--panel); padding: var(--s3) var(--s2); text-align: center; }
  .stats b { display: block; font-size: var(--t-cifra); font-weight: 700; letter-spacing: -.02em; line-height: 1.15; }
  .stats span { font-size: var(--t-meta); color: var(--faint); }
  .hero .stats div { background: transparent; }

  /* Una sola cifra enorme cuando esa cifra es la respuesta. */
  .cifra { font-size: var(--t-hero); font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  .cifra.acc { color: var(--azul-texto); }
  .cifra.ok  { color: var(--indigo-texto); }
  /* Informativo puro: un coste no es ni accion ni exito. */
  .cifra.info { color: var(--text); }

  /* --- Trabajo en curso --- */
  .job { border-left: 3px solid var(--live); }
  .job.ok    { border-left-color: var(--ok); }
  .job.error { border-left-color: var(--no); }
  .job.cancelled { border-left-color: var(--dim); }
  .joghead { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .jobname { font-size: 14px; font-weight: 600; }
  .jobstate { font-size: var(--t-meta); color: var(--dim); }
  .jobstate.running { color: var(--live); }
  .jobstate.ok { color: var(--ok); }
  .jobstate.error { color: var(--no); }
  .jobline {
    font: 11.5px/1.45 ui-monospace, "Cascadia Code", Consolas, monospace;
    color: var(--dim); margin-top: 7px; word-break: break-word;
    max-height: 3em; overflow: hidden;
  }
  .log {
    font: 11px/1.5 ui-monospace, "Cascadia Code", Consolas, monospace;
    background: var(--hueco); border: 1px solid var(--line); border-radius: var(--r-control);
    padding: 9px 10px; margin-top: 10px; max-height: 46vh; overflow: auto;
    white-space: pre-wrap; word-break: break-word; color: var(--mono);
  }
  .row { display: flex; gap: 9px; }
  .row > * { flex: 1; }
  .src {
    border-bottom: 1px solid var(--line); padding: 12px 14px;
    position: relative;
    transition: background-color var(--m-medio) var(--e-salida);
  }
  .src:last-child { border-bottom: none; }
  /*
   * El VOD en proceso se levanta del resto con un fondo apenas teñido.
   *
   * Muy apenas: al 4% no se lee como "seleccionado" ni compite con el resto,
   * pero basta para encontrarlo en una lista sin ir leyendo titulos.
   */
  .src.trabajando { background: var(--azul-hueco); }
  /* Filo azul a la izquierda, del alto de la tarjeta. Lo mismo, sin gritar. */
  .src.trabajando::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: var(--azul);
    animation: entra-lateral var(--m-medio) var(--e-salida) both;
  }
  .srchead { display: flex; align-items: center; gap: var(--s2); margin-bottom: 3px; }
  .srctitle { font-size: 13.5px; font-weight: 600; }
  .srcmeta { font-size: 11.5px; color: var(--dim); margin-bottom: 9px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    padding: 7px 11px; border-radius: var(--r-control); border: 1px solid var(--line);
    background: transparent; color: var(--text); font: inherit; font-size: 12.5px; cursor: pointer;
  }
  .chip:disabled { opacity: .4; cursor: default; }
  /*
   * Marca suave para el siguiente paso dentro de un bloque.
   *
   * NO se pinta de azul solido. El azul esta reservado al unico boton de
   * "Siguiente paso": si cuatro botones de la misma pantalla son azules, deja
   * de significar "pulsa aqui" y vuelve a haber que leerlo todo. Aqui basta con
   * un borde que lo distinga de los de al lado.
   */
  .chip.primario { border-color: var(--live); color: var(--live); }
  /* Mas apagadas: son rotulos de orientacion, no contenido. */
  /* Mismo arreglo que .seccion: el -4px de abajo metia lo siguiente dentro
     del titulo. Positivo y pequeño, que es lo que se queria decir. */
  .sectitle { font-size: var(--t-meta); font-weight: 600;
              color: var(--dim); margin: var(--s4) 0 var(--s2) 2px; }

  /*
   * Encabezado de seccion: icono, nombre y para que sirve.
   *
   * El .sectitle de arriba es una linea gris pequeña, del mismo peso que
   * cualquier otro texto de la pantalla. Con ocho secciones seguidas no se
   * distinguia donde empezaba cada cosa, y el nombre a secas ("Reparto",
   * "Plantillas") no dice nada a quien entra por primera vez.
   *
   * Esto lo usa gente que no monto el programa: un cliente que entra a aprobar
   * sus videos necesita leer que hace cada bloque sin preguntarle a nadie.
   *
   * El icono no decora: es un ancla para volver a encontrar la seccion sin
   * releer. Por eso cada uno es distinto y siempre el mismo para la misma cosa.
   */
  .seccion {
    display: flex; gap: 10px; align-items: flex-start;
    /*
     * Margenes positivos, y los dos a proposito.
     *
     * El de abajo era -8px, heredado de cuando la cabecera era una linea
     * suelta y habia que pegarla a lo de debajo. Pero la regla de main pone
     * 16px de separacion y la clase pesa mas, asi que el -8 ganaba: la tarjeta
     * empezaba OCHO PIXELES DENTRO de la caja de la cabecera y se comia la
     * ultima linea de la explicacion. Pasaba en las tres secciones de Inicio
     * y en las ocho de Ajustes.
     *
     * Ahora: 24 arriba para separarla de la tarjeta anterior, 12 abajo para
     * quedar pegada a la suya. Lo de arriba colapsa con el margen de la
     * tarjeta previa, asi que la separacion real es 24, no 40.
     */
    margin: var(--s5) 0 var(--s3) 0;
  }
  .seccion .ico {
    flex: 0 0 auto; width: 26px; height: 26px; border-radius: 8px;
    display: grid; place-items: center; font-size: 13px; font-style: normal;
    background: var(--azul-hueco); color: var(--azul-texto);
  }
  .seccion h2 {
    margin: 0; font-size: var(--t-cuerpo); font-weight: 650;
    /* --text, no --txt: ese nombre nunca ha existido, asi que el titulo de
       cada seccion se quedaba con el color heredado. */
    color: var(--text); line-height: 1.35;
  }
  .seccion p {
    margin: 1px 0 0; font-size: var(--t-meta); color: var(--dim); line-height: 1.45;
  }

  /*
   * La linea que explica la pantalla entera, antes de todo lo demas.
   *
   * Con borde a la izquierda y sin caja: tiene que leerse como una nota del
   * programa, no como otra tarjeta mas entre las que hay debajo.
   */
  .intro {
    margin: 0; padding: 2px 0 2px 12px;
    border-left: 3px solid var(--azul-borde);
    font-size: var(--t-meta); color: var(--dim); line-height: 1.5;
  }
  /*
   * Antetitulo de tarjeta ("Siguiente paso", "Ahora mismo").
   *
   * Existia cuatro veces como style inline copiado y pegado, las cuatro en ALL
   * CAPS. Al quitar las mayusculas tenia mas sentido darle nombre que repetir
   * el mismo atributo con una propiedad menos.
   */
  .ante { margin: 0 0 var(--s2); font-size: var(--t-meta); color: var(--faint); }

  /* Frase con la perilla dentro, para que se lea como una oracion. */
  /*
   * Rejilla de tres columnas y no flex con wrap.
   *
   * Con flex, en un movil de 375 px la unidad ("cuentas", "veces al dia") no
   * cabia detras del campo y caia a la linea siguiente, partiendo la frase por
   * la mitad. En rejilla, el texto se ajusta dentro de su columna y el campo y
   * su unidad se quedan siempre juntos a la derecha.
   */
  .linea {
    display: grid; grid-template-columns: 1fr 68px auto;
    align-items: center; gap: var(--s2);
    padding: var(--s3) 0; border-bottom: 1px solid var(--line);
    font-size: var(--t-cuerpo); line-height: 1.35;
  }
  .linea:last-of-type { border-bottom: none; }
  .linea input { width: 100%; text-align: center; padding: 7px 4px; }
  /*
   * El selector de color conserva su tamaño.
   *
   * La regla de arriba pesa lo mismo que input[type="color"] y va despues, asi
   * que ganaba: ancho del 100% de una columna 'auto', o sea de nada. En
   * Ajustes los dos colores salian como una raya de dos pixeles pegada al
   * borde derecho, imposible de pulsar y sin enseñar el color que tenian.
   */
  .linea input[type="color"] { width: 54px; flex: none; padding: 2px; }
  .unidad { color: var(--faint); font-size: var(--t-meta); white-space: nowrap; }

  /* Un desplegable ya dice su unidad dentro, asi que ocupa las dos columnas. */
  .linea.ancha { grid-template-columns: 1fr auto; }
  .linea select {
    width: auto; padding: 7px 10px; font-size: var(--t-meta);
    /* La flecha nativa de Windows no se puede colorear, asi que se dibuja con
       dos degradados y sigue al gris de los metadatos. */
    appearance: none; -webkit-appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--dim) 50%),
                      linear-gradient(135deg, var(--dim) 50%, transparent 50%);
    background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
    padding-right: 28px;
  }

  /* Barra de progreso de la subida. */
  .barra { height: 5px; background: var(--hueco); border-radius: 3px; overflow: hidden; margin-top: 9px; }
  .barra i { display: block; height: 100%; background: var(--live); width: 0; transition: width .2s; }
  .drop {
    border: 1px dashed var(--linea-viva); border-radius: var(--r-control); padding: 18px 14px;
    text-align: center; color: var(--dim); font-size: 13px; cursor: pointer;
  }
  .drop.over { border-color: var(--live); color: var(--text); }

  /*
   * Confirmacion de guardado.
   *
   * Antes, guardar en Horarios no decia nada: la pantalla se repintaba con los
   * mismos numeros y no habia forma de distinguir "guardado" de "no se entero
   * del clic". El aviso sale abajo, que en el movil es donde esta el pulgar, y
   * se va solo.
   *
   * Solo se animan transform y opacity, las dos que el navegador compone sin
   * volver a medir la pagina.
   */
  #aviso {
    position: fixed; left: 50%; bottom: 22px; z-index: 40;
    max-width: calc(100vw - 32px);
    padding: 11px 17px; border-radius: var(--r-control);
    /* Invertido respecto a la pagina: en claro sale negro, en oscuro sale
       claro. Un toast del color del fondo no es un toast. */
    background: var(--text); color: var(--bg);
    font-size: 13.5px; font-weight: 500; text-align: center;
    box-shadow: 0 8px 24px -6px rgba(13, 13, 13, .3);
    animation: asoma var(--m-medio) var(--e-salida) both;
  }
  @keyframes asoma {
    from { opacity: 0; transform: translate(-50%, 10px); }
    to   { opacity: 1; transform: translate(-50%, 0); }
  }
  #aviso.sale { animation: seva var(--m-rapido) var(--e-salida) both; }
  @keyframes seva {
    from { opacity: 1; transform: translate(-50%, 0); }
    to   { opacity: 0; transform: translate(-50%, 6px); }
  }

  /*
   * Plantilla: el nombre aplica, la cruz borra.
   *
   * Dos botones dentro de una sola pastilla y no un boton con un menu: son las
   * unicas dos cosas que se pueden hacer con una plantilla, y esconderlas
   * detras de un desplegable son dos gestos en vez de uno.
   */
  .pastilla { display: inline-flex; align-items: stretch; }
  .pastilla .chip { border-radius: var(--r-control) 0 0 var(--r-control); border-right: none; }
  .pastilla .quita {
    border: 1px solid var(--line); border-left: none;
    border-radius: 0 var(--r-control) var(--r-control) 0;
    background: var(--panel); color: var(--faint);
    padding: 0 9px; font-size: 15px; line-height: 1; cursor: pointer;
  }
  @media (hover: hover) {
    .pastilla .quita:hover { color: var(--no); border-color: var(--linea-viva); }
  }
  /* La que coincide con los ajustes de ahora. El chip va deshabilitado porque
     aplicarla otra vez no haria nada, y el color dice por que. */
  .pastilla.puesta .chip[disabled] {
    background: var(--azul-hueco); color: var(--azul);
    border-color: var(--azul-borde); font-weight: 600; opacity: 1;
  }
  .pastilla.puesta .quita { border-color: var(--azul-borde); }
  #nombre-plantilla { min-width: 0; }

  /* Estado de una plataforma. El punto lleva el color y el texto lo repite:
     el color solo no vale para quien no distingue el indigo del gris. */
  .plat { display: flex; align-items: center; gap: 9px; }
  .plat .nombre { font-weight: 600; font-size: 15px; flex: 1; }
  .punto-estado { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .punto-estado.si   { background: var(--indigo); }
  .punto-estado.no   { background: var(--faint); }
  .punto-estado.nada { background: var(--punto); }

  /* Proyectos: fila para crear y lista de campañas o cuentas. */
  .fila-nueva { display: flex; gap: 6px; }
  .fila-nueva input { flex: 1; min-width: 0; }

  .lista-campanas { list-style: none; margin: var(--s3) 0 0; padding: 0; }
  .lista-campanas li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
       padding: 9px 0; border-top: 1px solid var(--line); }
  /* El nombre empuja al resto a la derecha y se recorta si no cabe, en vez de
     desbordar la tarjeta en pantallas estrechas. */
  .lista-campanas .nombre { flex: 1; min-width: 7rem; font-weight: 600; font-size: 14px;
       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lista-campanas select { max-width: 11rem; }

  /* Programacion: una fila por publicacion prevista. */
  .fila-hora { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
       padding: 8px 0; border-top: 1px solid var(--line); }
  /* Ancho fijo y cifras de ancho fijo: asi las horas quedan en columna y se
     puede recorrer el dia de un vistazo sin leerlas una a una. */
  /*
   * Datos en monoespaciada: horas, duraciones, cifras y timecodes.
   *
   * No es un gusto. Una columna de horas en proporcional no alinea, y en una
   * pantalla que son cuarenta filas de "10:30 / 14:20 / 18:40" eso se nota al
   * leerla. La monoespaciada hace que las cifras caigan unas sobre otras.
   *
   * Se aplica SOLO a datos. En texto corrido convertiria el panel en una
   * terminal, que es otro aspecto de herramienta improvisada.
   */
  .fila-hora .hora,
  .stats b,
  .cifra,
  .srcmeta,
  .card .meta,
  .pv-datos .reason {
    font-family: var(--fuente-dato);
    font-variant-numeric: tabular-nums;
    letter-spacing: -.01em;
  }
  /* La cifra grande pierde el tracking negativo del titular: en monoespaciada
     aprieta demasiado y las cifras se tocan. */
  .cifra { letter-spacing: -.02em; }

  .fila-hora .hora { font-weight: 600;
       font-size: 14px; min-width: 3.2rem; }
  .fila-hora .quien { font-size: var(--t-meta); color: var(--dim); min-width: 4rem; }
  .fila-hora .que { flex: 1; min-width: 8rem; font-size: 13px; color: var(--dim);
       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fila-hora.vencida .hora { color: var(--no); }

  /* Segunda linea dentro de una celda: el VOD del que viene el clip. */
  td .sub { display: block; font-size: var(--t-meta); color: var(--faint); margin-top: 2px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: var(--t-meta);
       color: var(--faint); font-weight: 500; padding: 9px 14px; border-bottom: 1px solid var(--line); }
  td { padding: 9px 14px; border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: none; }
  /*
   * SALTAR AL CONTENIDO.
   *
   * Escondido hasta que recibe el foco, que es la unica forma de que no estorbe
   * a quien usa el raton y siga existiendo para quien usa el teclado. No se
   * oculta con display:none ni visibility: eso lo saca del orden de tabulacion
   * y lo deja inservible.
   */
  .salto {
    /*
     * fixed, no absolute.
     *
     * Con absolute el enlace vive a 16 px del principio del DOCUMENTO: si la
     * pagina esta bajada -- y en Revisar son cuarenta mil pixeles -- al
     * recibir el foco aparece fuera de la pantalla y no sirve para nada.
     * Fijo esta siempre arriba, que es donde se espera.
     */
    position: fixed; left: var(--s4); top: var(--s4); z-index: 60;
    transform: translateY(calc(-100% - var(--s5)));
    background: var(--azul); color: var(--blanco);
    padding: 9px 15px; border-radius: var(--r-control);
    font-size: var(--t-meta); font-weight: 600; text-decoration: none;
    transition: transform var(--m-rapido) var(--e-salida);
  }
  .salto:focus { transform: translateY(0); }

  /*
   * BUSCADOR.
   *
   * No es una pantalla mas: es la forma de llegar a algo concreto cuando hay
   * cuarenta y cinco clips pendientes y catorce videos y bajar scrolleando deja
   * de ser razonable.
   *
   * Se coloca arriba y no centrado a proposito. Un dialogo centrado desplaza la
   * mirada al medio de la pantalla y luego la lista crece hacia abajo, asi que
   * el primer resultado se mueve segun cuantos haya. Anclado arriba, el primer
   * resultado esta SIEMPRE en el mismo sitio, que es el que se pulsa el noventa
   * por ciento de las veces.
   */
  .buscador {
    position: fixed; inset: 0; z-index: 50;
    background: var(--velo);
    display: flex; justify-content: center;
    padding: 10vh var(--s4) var(--s4);
  }
  .buscador[hidden] { display: none; }
  .buscador-caja {
    width: 100%; max-width: 560px; align-self: flex-start;
    background: var(--panel); border: 1px solid var(--line);
    border-radius: var(--r-panel); overflow: hidden;
    box-shadow: var(--elev-flotante);
    animation: sube var(--m-medio) var(--e-salida) both;
  }
  #buscar {
    border: none; border-bottom: 1px solid var(--line); border-radius: 0;
    background: var(--panel); font-size: 16px; padding: 15px var(--s4);
  }
  #buscar:focus { border-color: var(--line); border-bottom-color: var(--line); }
  #buscar::-webkit-search-cancel-button { display: none; }
  .resultados { list-style: none; margin: 0; padding: 5px; max-height: 52vh; overflow-y: auto; }
  .resultados li {
    display: flex; align-items: baseline; gap: var(--s3);
    padding: 9px 11px; border-radius: var(--r-control); cursor: pointer;
  }
  /* El resaltado NO es :hover: con el teclado el raton no se mueve, y con el
     raton encima de un resultado las flechas seguirian marcando otro. Manda el
     indice, y el raton lo que hace es moverlo. */
  .resultados li[aria-selected="true"] { background: var(--azul-hueco); }
  .resultados .que {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em;
    color: var(--faint); flex: none; min-width: 62px;
  }
  .resultados .cual { color: var(--text); font-size: var(--t-cuerpo);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .resultados .nada { color: var(--dim); font-size: var(--t-meta); cursor: default; }
  .resultados .nada:hover { background: none; }
  @keyframes sube {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /*
   * RASTRO DE MIGAS.
   *
   * Solo en el detalle de un video, que es la unica pantalla por debajo de
   * otra. Ponerlo en todas seria repetir en dos sitios lo que el menu ya dice.
   */
  .migas {
    display: flex; align-items: center; gap: var(--s2);
    font-size: var(--t-meta); margin-bottom: var(--s3);
  }
  .migas button {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--azul-texto); font: inherit; font-size: var(--t-meta);
  }
  @media (hover: hover) { .migas button:hover { text-decoration: underline; } }
  .migas span { color: var(--punto); }
  /* min-width:0 es lo que deja encoger a un hijo de flex. Sin el, el
     text-overflow no llega a aplicarse nunca y el titulo desborda la caja. */
  .migas b {
    font-weight: 500; color: var(--dim); min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /*
   * LA LINEA DE TIEMPO.
   *
   * El directo entero dibujado a escala. La pista es el VOD; cada marca, un
   * momento, colocado donde ocurre y con el ancho que dura.
   *
   * Todo va en porcentajes sobre un contenedor relativo, asi que el dibujo se
   * reescala solo: la misma funcion sirve para los 600 px del detalle y para
   * los 240 de una ficha en el movil sin recalcular nada en JavaScript.
   */
  .eje { position: relative; margin: var(--s4) 0; }

  .eje .pista {
    position: relative; height: 34px;
    background: var(--hueco);
    border: 1px solid var(--line);
    border-radius: var(--r-control);
    overflow: hidden;
  }

  .eje .marca {
    position: absolute; top: 0; bottom: 0;
    min-width: 3px; padding: 0;
    border: none; border-radius: 2px;
    cursor: pointer;
    /* Solo transform y opacity: son las dos que el navegador compone sin
       volver a medir, y aqui puede haber cuarenta marcas a la vez. */
    transition: opacity var(--m-rapido) var(--e-salida), transform var(--m-rapido) var(--e-salida);
  }
  /* Sin revisar: el color de lo que pide tu accion, que es exactamente lo que
     es. Aprobado, indigo. Descartado, apagado y mas estrecho, porque sigue
     ocupando su sitio en el tiempo pero ya no cuenta. */
  .eje .marca.pend { background: var(--azul); }
  .eje .marca.si   { background: var(--indigo); }
  .eje .marca.no   { background: var(--punto); top: 11px; bottom: 11px; border-radius: 1px; }

  @media (hover: hover) {
    .eje .marca:hover { transform: scaleX(1.6); opacity: .85; }
  }
  .eje .marca.senalado {
    /* El resaltado no cambia el color -- el color significa el estado -- sino
       que saca la marca de la pista con un halo. */
    box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--text);
    z-index: 2; border-radius: 3px;
  }

  .eje .regla { position: relative; height: 15px; }
  .eje .tic { position: absolute; top: 0; transform: translateX(-50%); }
  .eje .tic i {
    display: block; width: 1px; height: 4px; margin: 0 auto;
    background: var(--punto);
  }
  .eje .tic b {
    display: block; font-family: var(--fuente-dato);
    font-size: 10px; font-weight: 400; color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  /* La primera y la ultima se pegan al borde en vez de salirse. */
  .eje .tic:first-child { transform: none; }
  .eje .tic:first-child i { margin: 0; }
  .eje .tic:last-child { transform: translateX(-100%); }
  .eje .tic:last-child i { margin: 0 0 0 auto; }

  .eje .leyenda {
    display: flex; gap: var(--s4); flex-wrap: wrap;
    margin: var(--s2) 0 0; font-size: var(--t-micro); color: var(--faint);
  }
  .eje .leyenda span { display: inline-flex; align-items: center; gap: 5px; }
  .eje .leyenda .pt { width: 9px; height: 9px; border-radius: 2px; display: block; }
  .eje .leyenda .pt.pend { background: var(--azul); }
  .eje .leyenda .pt.si { background: var(--indigo); }
  .eje .leyenda .pt.no { background: var(--punto); }

  /*
   * La compacta de la ficha: mas baja y sin eje.
   *
   * En una lista de catorce videos la pregunta no es "en que minuto" sino "se
   * reparte o se apelotona", y para eso sobran las etiquetas de tiempo.
   */
  .eje.compacto { margin: var(--s3) 0 0; }
  .eje.compacto .pista { height: 16px; border-radius: 5px; }
  .eje.compacto .marca.no { top: 5px; bottom: 5px; }

  /*
   * CABECERA DEL DETALLE.
   */
  .vodtit {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: var(--s4);
  }
  .vodtit h2 {
    margin: 0; font-size: var(--t-cifra); line-height: 1.2;
    letter-spacing: -.02em; font-weight: 650; text-wrap: balance;
  }
  .vodtit .cifra { flex: none; color: var(--dim); }

  /*
   * LOS MOMENTOS EN ORDEN.
   *
   * Cuatro columnas de ancho fijo salvo el texto, que se queda con lo que
   * sobre. Con la hora en monoespaciada las columnas alinean solas y la lista
   * se puede recorrer de arriba abajo leyendo solo la primera columna.
   */
  .momentos { list-style: none; margin: var(--s3) 0 0; padding: 0; }
  .momentos li {
    display: grid; grid-template-columns: auto 1fr auto auto;
    align-items: center; gap: var(--s3);
    padding: 8px 10px; border-radius: var(--r-control);
    cursor: pointer;
  }
  .momentos li + li { border-top: 1px solid var(--line); border-radius: 0; }
  @media (hover: hover) { .momentos li:hover { background: var(--hueco); } }
  .momentos li.senalado { background: var(--azul-hueco); }
  .momentos .cuando {
    font-family: var(--fuente-dato); font-size: var(--t-meta);
    font-variant-numeric: tabular-nums; color: var(--text);
  }
  .momentos .que {
    font-size: var(--t-cuerpo); color: var(--dim);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .momentos .dura {
    font-family: var(--fuente-dato); font-size: var(--t-micro);
    font-variant-numeric: tabular-nums; color: var(--faint);
  }

  /*
   * El titulo de un video en Inicio ahora es un boton, no un div. Se le quita
   * todo el aspecto de boton: sigue siendo el titulo, lo que gana es que se
   * puede pulsar con el teclado y que el lector de pantalla lo anuncia como
   * algo que lleva a otro sitio.
   */
  button.srctitle {
    background: none; border: none; padding: 0; margin: 0;
    font: inherit; text-align: left; cursor: pointer; color: inherit;
    width: 100%;
  }
  @media (hover: hover) { button.srctitle:hover { color: var(--azul-texto); } }

  /*
   * REVISAR EN LOTE.
   *
   * La barra se pega arriba, justo debajo de la cabecera. Al pie seria lo
   * habitual, pero en Revisar el pie esta a quince mil pixeles de scroll y la
   * mano que marca esta arriba, en las casillas.
   */
  .lote {
    position: sticky; top: 0; z-index: 12;
    display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap;
    padding: var(--s3);
    background: var(--bg-velado);
    backdrop-filter: blur(8px);
    border: 1px solid var(--azul-borde);
    border-radius: var(--r-control);
    margin-bottom: var(--s4);
  }
  .lote[hidden] { display: none; }
  .lote .cuantos {
    font-size: var(--t-meta); font-weight: 600; color: var(--text);
    margin-right: var(--s2);
  }
  /* Empuja los dos botones que deciden al extremo opuesto de los que
     seleccionan: no se pulsan por error uno por otro. */
  .lote .hueco { flex: 1 1 auto; }

  /*
   * La casilla de cada tarjeta.
   *
   * Encima del video, con su propio fondo oscuro porque debajo puede haber
   * cualquier fotograma: sobre un plano blanco una casilla blanca no existe.
   * El area pulsable es de 34 px aunque la casilla mida 17: en el movil, una
   * diana de 17 px al lado del boton de reproducir es una pulsacion fallida.
   */
  .elegir {
    position: absolute; top: 9px; left: 9px; z-index: 3;
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px;
    border-radius: var(--r-control);
    background: var(--sobre-video);
    backdrop-filter: blur(4px);
    cursor: pointer;
  }
  .elegir input { width: 17px; height: 17px; margin: 0; cursor: pointer; accent-color: var(--azul); }
  /* La tarjeta tiene que ser el origen de la posicion absoluta de la casilla. */
  .lista-clips .card { position: relative; }

  .card.elegida { box-shadow: 0 0 0 2px var(--azul); }
  /*
   * El foco del teclado se marca distinto que la seleccion, porque son cosas
   * distintas: una es "aqui estoy" y otra "esto he marcado". Si fueran el
   * mismo borde, moverse con las flechas pareceria ir marcando.
   */
  .card.enfoco { box-shadow: 0 0 0 2px var(--text); }
  .card.elegida.enfoco { box-shadow: 0 0 0 2px var(--text), 0 0 0 5px var(--azul); }

  /*
   * AJUSTAR EL CORTE, dentro de la tarjeta de un momento.
   *
   * Plegado por defecto. Un <details> y no un dialogo: lo que se ajusta esta
   * al lado del video que lo explica, y sacarlo a una ventana encima taparia
   * justo eso.
   */
  .corte { margin-top: var(--s3); border-top: 1px solid var(--line); padding-top: var(--s3); }
  .corte summary {
    cursor: pointer; font-size: var(--t-meta); font-weight: 600; color: var(--azul-texto);
    list-style: none;
  }
  .corte summary::-webkit-details-marker { display: none; }
  /* El triangulo se dibuja aqui para que gire al abrir; el del navegador no
     se puede animar y cambia de forma en cada sistema. */
  .corte summary::before {
    content: "\\25B8"; display: inline-block; margin-right: 6px;
    transition: transform var(--m-rapido) var(--e-salida);
  }
  .corte[open] summary::before { transform: rotate(90deg); }

  .corte-fila {
    display: flex; align-items: flex-end; gap: var(--s2); margin-bottom: var(--s2);
  }
  .corte-fila label {
    flex: 1 1 auto; margin: 0;
    font-size: var(--t-micro); color: var(--dim);
  }
  .corte-fila input {
    margin-top: 3px;
    font-family: var(--fuente-dato); font-variant-numeric: tabular-nums;
  }
  .corte-fila .chip { flex: none; }

  .corte-aviso {
    margin: var(--s2) 0; font-size: var(--t-micro); color: var(--dim);
    font-family: var(--fuente-dato); font-variant-numeric: tabular-nums;
  }
  .corte-aviso.mal { color: var(--error-texto); }

  /*
   * La fila que el buscador acaba de encontrar.
   *
   * Un fondo que se apaga solo, no un borde permanente: dice "es esta" y se
   * quita, que es lo que hace falta. Dura 2,2 s, lo justo para encontrarla
   * con la vista despues de que la pagina termine de desplazarse.
   */
  .linea.resaltado, .resaltado {
    animation: senala 2.2s var(--e-salida) both;
    border-radius: var(--r-control);
  }
  @keyframes senala {
    0%, 55% { background: var(--azul-pastilla); }
    100% { background: transparent; }
  }
  @media (prefers-reduced-motion: reduce) {
    /* Sin desvanecido, pero el resalte sigue existiendo: quitarlo del todo
       dejaria a quien pide menos movimiento sin saber cual encontro. */
    .linea.resaltado, .resaltado { animation: none; background: var(--azul-pastilla); }
  }

  /*
   * CAMBIO DE PANTALLA.
   *
   * Un desvanecido corto con dos pixeles de subida. No es decoracion: sin el,
   * pasar de Revisar a Agenda es un parpadeo en el que el contenido viejo y
   * el nuevo ocupan el mismo sitio en el mismo fotograma, y cuesta un
   * instante entender que se cambio de sitio y no que algo se recargo.
   *
   * Solo al CAMBIAR de vista, no en cada repintado. render() corre cada vez
   * que llega un aviso del servidor -- varias veces por minuto mientras hay
   * un trabajo en marcha -- y animar eso seria una pagina que palpita sola.
   * La clase la pone y la quita el guion, que es quien sabe si cambio.
   *
   * Solo opacity y transform: las dos que el navegador compone sin volver a
   * medir la pagina. Animar la altura con cuarenta y cinco videos dentro
   * dejaria el cambio de pantalla en diez fotogramas por segundo.
   */
  main.cambia {
    animation: pasa var(--m-medio) var(--e-salida) both;
  }
  @keyframes pasa {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: none; }
  }

  /*
   * Lo que lleva el video, al lado del marco de la vista previa.
   *
   * Un punto de estado por linea, del mismo juego que usa el resto del panel
   * para "esta puesto" y "no esta puesto": asi se lee en diagonal sin tener
   * que entender cada frase.
   */
  .pv-lista { list-style: none; margin: 0; padding: 0; }
  .pv-lista li {
    display: flex; align-items: center; gap: var(--s2);
    padding: 5px 0; font-size: var(--t-meta); color: var(--dim);
  }
  .pv-lista .punto-estado { flex: none; }

  /*
   * LA CASILLA DE CADA MOMENTO, dibujada y no la del sistema.
   *
   * La nativa sobre el velo oscuro salia como un cuadrado gris plano: no se
   * distinguia de un icono roto y no se veia si estaba marcada hasta mirarla
   * de cerca. Esta es un cuadrado con borde blanco que se rellena de azul y
   * saca una marca de verificacion.
   */
  .elegir input {
    appearance: none; -webkit-appearance: none;
    width: 19px; height: 19px; margin: 0; cursor: pointer;
    border: 2px solid var(--blanco); border-radius: 5px;
    background: transparent;
    display: grid; place-items: center;
    transition: background var(--m-rapido) var(--e-salida);
  }
  .elegir input::after {
    content: "¹3";
    font-size: 13px; font-weight: 700; line-height: 1;
    color: var(--blanco);
    /* La marca existe siempre y se revela con opacidad: creandola al marcar,
       el navegador tiene que recalcular la caja y el cambio llega tarde. */
    opacity: 0;
    transition: opacity var(--m-rapido) var(--e-salida);
  }
  .elegir input:checked { background: var(--azul); border-color: var(--azul); }
  .elegir input:checked::after { opacity: 1; }

  /*
   * BUSCADOR Y FILTROS DE CUENTAS.
   *
   * Aparecen a partir de seis cuentas y no antes: con tres, tres controles
   * para elegir entre tres cosas que ya se ven enteras estorban mas de lo que
   * ayudan.
   *
   * El campo de texto se lleva el espacio sobrante y los desplegables ocupan
   * lo suyo. En movil cada uno cae a su linea, que es mejor que tres
   * controles de setenta pixeles.
   */
  .cuentas-barra {
    display: flex; flex-wrap: wrap; gap: var(--s2);
    margin: var(--s3) 0 0;
  }
  .cuentas-barra input[type="search"] { flex: 1 1 200px; min-width: 0; }
  .cuentas-barra select { flex: 0 0 auto; width: auto; }
  .cuentas-barra input::-webkit-search-cancel-button { display: none; }

  /*
   * La casilla de cada cuenta.
   *
   * Dibujada, no la del sistema, por el mismo motivo que la de los clips: la
   * nativa sale como un cuadro gris plano que no se distingue de un icono
   * roto. Aqui va sobre la tarjeta, no sobre un video, asi que el borde es
   * del color de las lineas y no blanco.
   */
  .marca-cuenta { display: flex; align-items: center; flex: none; }
  .marca-cuenta input {
    appearance: none; -webkit-appearance: none;
    width: 17px; height: 17px; margin: 0; cursor: pointer;
    border: 2px solid var(--linea-viva); border-radius: 5px;
    background: transparent;
    display: grid; place-items: center;
    transition: background var(--m-rapido) var(--e-salida);
  }
  .marca-cuenta input::after {
    content: "\\2713";
    font-size: 12px; font-weight: 700; line-height: 1; color: var(--blanco);
    opacity: 0; transition: opacity var(--m-rapido) var(--e-salida);
  }
  .marca-cuenta input:checked { background: var(--azul); border-color: var(--azul); }
  .marca-cuenta input:checked::after { opacity: 1; }

  /*
   * La barra de lote de cuentas reutiliza .lote, la de Revisar, pero dentro
   * de una tarjeta: no se pega arriba ni necesita el velo, porque la lista
   * que gobierna empieza tres pixeles mas abajo.
   */
  .lote.puesta { position: static; backdrop-filter: none; background: var(--azul-hueco); }
  .lote select { width: auto; flex: 0 0 auto; }

  /*
   * Un boton que se lee como un enlace.
   *
   * "Marcar las 37" es una accion, pero ponerla de chip la igualaria con
   * Pausar y Activar, que son las que de verdad hacen algo. Va dentro de una
   * frase, asi que se comporta como parte de la frase.
   */
  .enlace {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--azul-texto); font: inherit; text-decoration: underline;
  }

  /* =====================================================================
   * Fase 3: estructura. Menu de seis secciones, cabecera y barra movil.
   *
   * Va al final a proposito: manda sobre las reglas antiguas del menu
   * desplegable sin tener que reescribirlas una por una.
   * ===================================================================== */

  /* Cabecera: titulo, Añadir video, buscar, avisos, salir, mas opciones. */
  header { background: var(--bg-velado); border-bottom-color: var(--line); }
  .cabecera { gap: var(--s2); min-height: var(--alto-control); }
  #title { font-size: 20px; font-weight: 650; margin-right: auto; }
  .icono-boton {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-width: var(--alto-control); min-height: var(--alto-control); padding: 0 10px;
    border-radius: var(--r-control); border: 1px solid transparent;
    background: none; color: var(--dim); cursor: pointer; text-decoration: none;
    font: inherit; font-size: var(--t-meta);
  }
  @media (hover: hover) { .icono-boton:hover { color: var(--text); background: var(--raised); } }
  #abrir-buscar { margin-left: 0; font-size: inherit; }
  #abrir-buscar kbd { margin-left: 2px; }
  #campana, #salir { font-size: inherit; padding: 0 10px; }
  #campana[aria-expanded="true"] { color: var(--text); background: var(--raised); }
  .anadir {
    display: inline-flex; align-items: center; gap: 8px;
    border-radius: var(--r-control); padding: 0 16px; font-weight: 600;
  }
  .anadir .ico-svg { width: 17px; height: 17px; }
  #menu { font-size: inherit; margin-left: 0; color: var(--dim); }

  /* El menu. Columna izquierda de 248 px en pantalla ancha. */
  #nav {
    width: 248px; max-width: none; background: var(--menu-fondo);
    border-right: 1px solid var(--line); gap: 2px;
    padding: calc(var(--s5) + env(safe-area-inset-top)) var(--s3) var(--s4);
  }
  .marca { padding: 0 var(--s2) var(--s5); gap: 10px; }
  .marca-k { display: block; flex: none; }
  .marca-klip { font-family: var(--fuente-titulo); font-size: 18px; letter-spacing: -.01em; }
  .marca-studio { font-style: normal; font-size: 14px; color: var(--faint); font-weight: 500; }
  #nav button {
    min-height: var(--alto-control); border-radius: var(--r-control);
    border-left: 0; padding: 0 var(--s3); gap: var(--s3);
    color: var(--dim); font-weight: 500;
  }
  @media (hover: hover) {
    #nav button:not([aria-current="true"]):hover { color: var(--text); background: var(--raised); }
  }
  #nav button[aria-current="true"] {
    color: var(--indigo-texto); background: var(--azul-hueco); font-weight: 600;
  }
  #nav button[aria-current="true"] .ico-svg { color: var(--azul-texto); }
  #nav button b { background: var(--azul); color: var(--sobre-acento); font-family: var(--fuente-dato); }

  /* Estado del procesador, abajo del menu. */
  .nav-estado {
    margin-top: auto; padding: var(--s3); border-radius: var(--r-control);
    background: var(--panel); border: 1px solid var(--line);
    font-size: var(--t-meta); color: var(--dim);
    display: flex; flex-direction: column; gap: 6px;
  }
  .nav-estado:empty { display: none; }
  .nav-estado .fila-estado { display: flex; align-items: center; gap: 8px; }

  /* Mas opciones: una hoja pequeña bajo la cabecera. */
  .hoja {
    position: fixed; z-index: 40; top: calc(64px + env(safe-area-inset-top)); right: var(--s4);
    min-width: 220px; padding: 6px; border-radius: var(--r-tarjeta);
    background: var(--raised); border: 1px solid var(--line); box-shadow: var(--elev-flotante);
    display: flex; flex-direction: column; gap: 2px;
    animation: entra var(--m-medio) var(--e-salida) both;
  }
  .hoja[hidden] { display: none; }
  .hoja button, .hoja a {
    display: flex; align-items: center; gap: var(--s3); min-height: var(--alto-control);
    padding: 0 var(--s3); border-radius: var(--r-control); border: 0; background: none;
    color: var(--text); text-decoration: none; font: inherit; cursor: pointer; text-align: left;
  }
  @media (hover: hover) { .hoja button:hover, .hoja a:hover { background: var(--panel); } }

  /* Cambio de pantalla: un fundido corto. */
  main.cambia { animation: fundido var(--m-pantalla) ease-out both; }

  /* Pestañas de seccion con el acento nuevo. */
  .subtab { color: var(--dim); }
  .subtab[aria-selected="true"] { color: var(--indigo-texto); border-bottom-color: var(--azul); }

  /* --- Pantalla ancha ------------------------------------------------- */
  @media (min-width: 900px) {
    #nav { transform: none; }
    body { padding-left: 248px; }
    #menu, #fondo, .hoja { display: none !important; }
    .solo-estrecho { display: none !important; }
  }

  /* --- Movil: barra inferior de cinco iconos ---------------------------- */
  @media (max-width: 899px) {
    .solo-ancho { display: none !important; }
    .anadir span { display: none; }
    .anadir { padding: 0; width: var(--alto-control); justify-content: center; }
    #nav {
      top: auto; bottom: 0; left: 0; right: 0; width: auto; height: auto;
      transform: none; flex-direction: row; gap: 0;
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom));
      border-right: 0; border-top: 1px solid var(--line);
      background: var(--bg-velado); backdrop-filter: blur(10px);
    }
    #nav .marca, #nav .titulo, .nav-estado { display: none; }
    #nav button {
      flex: 1 1 0; flex-direction: column; justify-content: center; gap: 3px;
      min-height: 56px; padding: 4px 2px; font-size: 11.5px; position: relative;
    }
    #nav button b {
      position: absolute; top: 4px; left: calc(50% + 6px); margin: 0; padding: 0 6px;
    }
    body { padding-bottom: calc(76px + env(safe-area-inset-bottom)); }
  }

  /* =====================================================================
   * Fase 3: Inicio y Videos.
   * ===================================================================== */

  main#view { max-width: 1240px; margin: 0 auto; padding: var(--s5) var(--s4) var(--s6); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-tarjeta); }
  .card .body { padding: var(--s5); }
  .ante {
    font-size: var(--t-micro); font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
    color: var(--faint); margin: 0 0 var(--s3);
  }
  .chip { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--r-control); }
  .chip .ico-svg, .act .ico-svg { width: 16px; height: 16px; }
  button.act { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: var(--r-control); }
  .act.go { background: var(--azul); color: var(--sobre-acento); border: 0; font-weight: 600; }

  /* Las cuatro tarjetas del flujo. */
  .flujo { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s3); margin-bottom: var(--s4); }
  .paso-flujo {
    display: grid; grid-template-columns: 1fr auto; grid-template-areas: "cab cab" "num num" "nombre unidad";
    gap: 2px var(--s2); text-align: left; cursor: pointer;
    padding: var(--s4); border-radius: var(--r-tarjeta);
    background: var(--panel); border: 1px solid var(--line); color: var(--text); font: inherit;
  }
  @media (hover: hover) { .paso-flujo:hover { border-color: var(--linea-viva); background: var(--raised); } }
  .paso-flujo.pide { background: var(--destacada); border-color: var(--destacada-borde); }
  .paso-cab { grid-area: cab; display: flex; align-items: center; justify-content: space-between; color: var(--dim); }
  .paso-flujo.pide .paso-cab { color: var(--azul-texto); }
  .paso-num { font-size: var(--t-micro); color: var(--faint); }
  .paso-flujo b { grid-area: num; font-family: var(--fuente-titulo); font-size: 34px; font-weight: 650; line-height: 1.1; letter-spacing: -.02em; }
  .paso-nombre { grid-area: nombre; font-weight: 600; font-size: var(--t-cuerpo); }
  .paso-unidad { grid-area: unidad; align-self: end; font-size: var(--t-meta); color: var(--faint); }

  /* Inicio: dos columnas. */
  .rejilla-inicio { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: var(--s4); align-items: start; }
  .col-principal, .col-lateral { display: flex; flex-direction: column; gap: var(--s4); }
  .col-principal section { display: flex; flex-direction: column; gap: var(--s3); }
  .siguiente { background: var(--destacada); border-color: var(--destacada-borde); }
  .siguiente h2 { font-size: 24px; font-weight: 650; margin: 0 0 var(--s2); line-height: 1.25; }
  .siguiente .reason { margin: 0; color: var(--dim); }
  .siguiente .actions { margin-top: var(--s4); }

  .estado-lista { list-style: none; margin: 0 0 var(--s4); padding: 0; display: flex; flex-direction: column; gap: var(--s3); }
  .estado-lista li { display: flex; align-items: center; gap: var(--s3); color: var(--dim); }
  .estado-nombre { color: var(--text); font-weight: 600; min-width: 84px; }
  .estado-texto { flex: 1; font-size: var(--t-meta); }

  .actividad { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .actividad li { display: flex; align-items: center; gap: var(--s3); padding: 10px 0; border-top: 1px solid var(--line); }
  .actividad li:first-child { border-top: 0; padding-top: 0; }
  .actividad li .ico-svg { color: var(--ok-texto); }
  .actividad li span { flex: 1; }
  .actividad time { font-size: var(--t-meta); color: var(--faint); }

  /* Añadir video. */
  .segmento {
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; margin-bottom: var(--s4);
    background: var(--hueco); border: 1px solid var(--line); border-radius: var(--r-control);
  }
  .segmento button {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px;
    border: 0; border-radius: 9px; background: none; color: var(--dim); font: inherit; font-weight: 500; cursor: pointer;
  }
  .segmento button[aria-selected="true"] { background: var(--raised); color: var(--text); font-weight: 600; }
  .tipos { border: 0; padding: 0; margin: 0 0 var(--s3); display: flex; flex-wrap: wrap; gap: var(--s2); }
  .tipos legend { font-size: var(--t-meta); color: var(--dim); margin-bottom: var(--s2); padding: 0; }
  .tipo { display: inline-flex; }
  .tipo input { position: absolute; opacity: 0; pointer-events: none; }
  .tipo span {
    display: inline-flex; align-items: center; min-height: var(--alto-control); padding: 0 14px; cursor: pointer;
    border-radius: var(--r-pildora); border: 1px solid var(--line); color: var(--dim); background: var(--panel);
  }
  .tipo input:checked + span { border-color: var(--azul-borde); background: var(--azul-hueco); color: var(--indigo-texto); font-weight: 600; }
  .tipo input:focus-visible + span { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--foco); }
  .fila-input { display: flex; gap: var(--s2); }
  .fila-input input { flex: 1; min-width: 0; }
  .drop {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s2);
    min-height: 120px; padding: var(--s4); text-align: center; cursor: pointer;
    border: 1.5px dashed var(--linea-viva); border-radius: var(--r-tarjeta); color: var(--dim); background: var(--hueco);
  }
  .drop .ico-svg { width: 24px; height: 24px; color: var(--azul-texto); }
  .drop.over { border-color: var(--azul); background: var(--azul-hueco); }

  /* Videos. */
  .rejilla-videos { display: grid; grid-template-columns: minmax(0, 380px) minmax(0, 1fr); gap: var(--s4); align-items: start; }
  .col-anadir { position: sticky; top: 84px; }
  .col-lista { display: flex; flex-direction: column; gap: var(--s3); }
  .col-lista .cascada { display: flex; flex-direction: column; gap: var(--s3); }
  .filtros { display: flex; gap: var(--s2); flex-wrap: wrap; }
  .filtros .tab {
    display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px;
    border-radius: var(--r-pildora); border: 1px solid var(--line); background: var(--panel); color: var(--dim);
    font: inherit; cursor: pointer;
  }
  .filtros .tab[aria-selected="true"] { background: var(--azul-hueco); border-color: var(--azul-borde); color: var(--indigo-texto); font-weight: 600; }
  .filtros .tab .dato { font-size: var(--t-micro); color: var(--faint); }

  .video-cab { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s3); }
  .video-cab .srctitle { font-size: 17px; font-weight: 600; text-align: left; }
  .video-meta { margin: 4px 0 var(--s4); font-size: var(--t-meta); color: var(--faint); }
  .video-nota { margin: var(--s3) 0; color: var(--dim); font-size: var(--t-meta); }

  .estado-chip {
    display: inline-flex; align-items: center; gap: 6px; flex: none; white-space: nowrap;
    padding: 4px 10px; border-radius: var(--r-pildora); font-size: var(--t-micro); font-weight: 600;
    background: var(--raised); color: var(--dim); border: 1px solid var(--line);
  }
  .estado-chip .ico-svg { width: 14px; height: 14px; }
  .estado-chip.ok { background: var(--ok-fondo); color: var(--ok-texto); border-color: var(--ok-borde); }
  .estado-chip.error { background: var(--error-fondo); color: var(--error-texto); border-color: var(--error-borde); }
  .estado-chip.aviso { background: var(--aviso-fondo); color: var(--aviso-texto); border-color: var(--aviso-borde); }
  .estado-chip.info { background: var(--azul-hueco); color: var(--indigo-texto); border-color: var(--azul-borde); }

  .etapas { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s2); }
  .etapa { display: flex; flex-direction: column; gap: 6px; font-size: var(--t-micro); color: var(--faint); }
  .etapa-barra { position: relative; height: 6px; border-radius: var(--r-pildora); background: var(--raised); overflow: hidden; }
  .etapa-barra i { position: absolute; inset: 0; width: 0; border-radius: inherit; background: var(--azul); }
  .etapa.hecha { color: var(--dim); }
  .etapa.hecha .etapa-barra i { width: 100%; background: var(--ok-texto); }
  .etapa.actual, .etapa.activa { color: var(--text); font-weight: 600; }
  .etapa.actual .etapa-barra i { width: 12%; }
  .etapa.activa .etapa-barra i { width: 55%; }
  /* El brillo solo mientras hay trabajo de verdad en esa etapa. */
  .etapa.activa .etapa-barra::after {
    content: ""; position: absolute; inset: 0; width: 50%;
    background: linear-gradient(90deg, transparent, var(--barrido), transparent);
    animation: brillo 1.4s ease-in-out infinite;
  }
  .etapa.fallo { color: var(--error-texto); font-weight: 600; }
  .etapa.fallo .etapa-barra i { width: 100%; background: var(--error-texto); }
  .video-card.trabajando { border-color: var(--destacada-borde); }

  /* Entrada de tarjetas: subir 10 px y aparecer, escalonado. */
  .cascada > * { animation: entra var(--m-entrada) var(--e-salida) both; }

  @media (max-width: 1099px) {
    .rejilla-inicio, .rejilla-videos { grid-template-columns: minmax(0, 1fr); }
    .col-anadir { position: static; }
  }
  @media (max-width: 640px) {
    main#view { padding: var(--s4) var(--s4) var(--s6); }
    .flujo { grid-template-columns: repeat(2, 1fr); }
    .card .body { padding: var(--s4); }
    .etapas { grid-template-columns: repeat(2, 1fr); row-gap: var(--s3); }
    .siguiente h2 { font-size: 21px; }
  }

  /* Las pantallas rediseñadas llevan su propia rejilla: nada de columnas de texto. */
  main.vista-proceso, main.vista-videos, main.vista-clips, main.vista-cola, main.vista-metricas,
  main.vista-plataformas, main.vista-proyectos, main.vista-ia, main.vista-usuarios,
  main.vista-registro, main.vista-flujo, main.vista-ajustes {
    column-count: 1;
  }
  .cabecera .anadir { flex: none; padding: 0 16px; }
  @media (max-width: 899px) { .cabecera .anadir { padding: 0; } }

  /* Repintar la misma pantalla no vuelve a animar la entrada. */
  main.quieto .cascada > *, main.quieto .paso-1, main.quieto .paso-2 { animation: none; }
`
