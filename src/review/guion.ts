/**
 * El guion del panel: estado, peticiones, pintado y eventos.
 *
 * Se sirve tal cual dentro de una etiqueta script. No se compila ni se empaqueta
 * -- el navegador lo recibe como esta escrito aqui -- asi que el typecheck NO lo
 * mira: para TypeScript esto es una cadena. Lo que si lo mira es `verify:panel`,
 * que lo compila con `new Function` sin ejecutarlo y falla en la linea exacta.
 *
 * Salio de page.ts por el mismo motivo que el CSS, explicado en estilos.ts.
 */
import { espiral } from './marca.js'
import { ICONOS } from './iconos.js'

export const GUION = `/*
 * Cuatro secciones, no nueve.
 *
 * El menu llego a tener nueve entradas y era imposible saber donde mirar:
 * "Ajustes" y "Horarios" eran los dos ajustes, "Proyectos" y "Cuentas" eran los
 * dos cuentas, y "Programacion", "Historial" y "Resultados" eran tres sitios
 * distintos para la misma pregunta de "que ha pasado".
 *
 * Las vistas de dentro NO se tocaron: cada una sigue siendo la que era. Lo que
 * cambia es como se llega a ellas. Agrupar es reversible y no arriesga nada;
 * reescribir nueve pantallas por un problema de navegacion, si.
 *
 * El orden es el del dia a dia: subir un video, revisarlo, ver cuando sale.
 * Todo lo que se toca una vez y no se vuelve a mirar vive en Ajustes.
 */
/*
 * FASE 3: seis secciones, en el orden del flujo.
 *
 * Añadir (Videos) -> Procesar -> Revisar -> Publicar (Agenda), con Inicio
 * diciendo que toca ahora y Cuentas y Ajustes para lo que se configura una vez.
 * Videos y Cuentas salen de Inicio y de Ajustes, donde estaban mezclados con
 * otras cosas.
 */
const SECCIONES = {
  inicio:  { titulo: 'Inicio',   vistas: [['proceso', 'Inicio']] },
  videos:  { titulo: 'Videos',   vistas: [['videos', 'Videos']] },
  revisar: { titulo: 'Revisar',  vistas: [['clips', 'Revisar']] },
  agenda:  { titulo: 'Agenda',   vistas: [['cola', 'Calendario'], ['metricas', 'Resultados']] },
  cuentas: { titulo: 'Cuentas',  vistas: [['plataformas', 'Cuentas'], ['proyectos', 'Clientes']] },
  config:  { titulo: 'Ajustes',  vistas: [
    ['ajustes', 'Estilo'],
    ['ia', 'IA'],
    ['flujo', 'Horarios'],
    ['registro', 'Sistema'],
    ['usuarios', 'Usuarios'],
  ] },
};

/*
 * Lo que un operador no ve.
 *
 * Revisa, aprueba y mira la agenda; la configuracion es del administrador. El
 * servidor ya rechaza los cambios (ver permitido() en src/auth/auth.ts): esto
 * solo evita enseñar pantallas cuyos botones no van a funcionar.
 */
const SOLO_ADMIN = ['proyectos', 'plataformas', 'flujo', 'ajustes', 'ia', 'usuarios'];

/**
 * Que es cada pantalla, en una linea.
 *
 * Se escribe para alguien que entra por primera vez y no monto el programa.
 * Por eso no se usan las palabras de dentro ("cola", "variantes", "fuente"):
 * se dice que vera y que puede hacer alli.
 */
const INTROS = {
  proceso: 'Desde aquí se añaden videos y se ve en qué punto va cada uno. Lo demás lo hace el programa solo.',
  clips: 'Los momentos que el programa ha encontrado. Aprueba los que valgan y descarta el resto: es la única decisión que no toma el programa.',
  cola: 'Lo que va a salir, con su día y su hora. No hay que lanzarlo: se publica solo.',
  metricas: 'Cómo le va a lo ya publicado.',
  proyectos: 'Cada cliente con sus cuentas, sus campañas y su ritmo de publicación.',
  plataformas: 'Las cuentas donde se publica y en qué estado está cada una.',
  flujo: 'A qué hora y con qué frecuencia sale cada video.',
  ajustes: 'Cómo se cortan los videos, cómo se ven los subtítulos y qué texto los acompaña.',
  registro: 'Todo lo que ha hecho el programa, lo que tardó y lo que costó.',
  ia: 'La IA que elige los mejores momentos: si está lista y cómo probarla.',
  usuarios: 'Quién puede entrar al panel y qué puede hacer cada uno.',
};

/** De que seccion es cada vista. Se deriva del mapa para no repetirlo. */
const SECCION_DE = Object.fromEntries(
  Object.entries(SECCIONES).flatMap(([id, s]) => s.vistas.map(([v]) => [v, id])),
);

/*
 * El detalle de un VOD no es una entrada del menu: es una profundidad mas.
 *
 * Cuelga de Inicio, que es donde estan los videos, pero NO aparece como
 * pestaña. Si estuviera en SECCIONES saldria en la barra de la seccion y
 * habria una pestaña que no lleva a ningun sitio mientras no haya un VOD
 * elegido. Aqui se dice a mano de quien depende, y el rastro de migas de arriba
 * se encarga del camino de vuelta.
 */
SECCION_DE.vod = 'videos';

/* Los iconos de trazo, servidos una vez con el guion. */
const ICONOS = ${JSON.stringify(ICONOS)};

const state = {
  view: 'proceso',
  filter: 'pending',
  counts: {},
  clips: [],
  overview: null,
  metrics: null,
  settings: null,
  ajustes: null,
  plataformas: null,
  proyectos: null,
  campanaElegida: localStorage.getItem('klip:campana') ?? '',
  /** Donde estabas en cada seccion, para volver ahi. */
  ultimaVista: {},
  runs: null,
  queue: null,
  jobs: [],
  openLog: null,
  /** Buscador y filtros de la lista de cuentas. */
  filtroCuentas: { texto: '', estado: '', cliente: '' },
  /** Cuentas marcadas para una accion en lote. */
  selCuentas: new Set(),
  // Fase 7: la cuenta con el editor abierto (alias, tope, plataformas).
  editCuenta: null,
  /** El ajuste que el buscador pidio resaltar, hasta que se pinte. */
  resaltar: null,
  /** Los clips marcados para decidir en lote. Llave: fuente + clip. */
  sel: new Set(),
  /** Indice de la tarjeta en foco dentro de la rejilla de Revisar. */
  foco: 0,
  /** Si el resaltado de foco se esta usando. Se apaga al tocar con el raton. */
  conTeclado: false,
  /** El VOD abierto en detalle, con sus clips colocados en el tiempo. */
  vod: null,
  /** Su identificador, que se conserva mientras carga para no parpadear. */
  vodId: null,
  /*
   * Avisos.
   *
   * No hay tabla de notificaciones ni la va a haber: un aviso ES un trabajo que
   * termino, y esos ya estan en la base. Inventar una tabla paralela seria
   * mantener dos versiones de la misma verdad y esperar a que se separen.
   *
   * Lo unico que no sabe el servidor es que has mirado ya, y eso es de este
   * aparato, no de la cuenta: haber visto el aviso en el movil no significa
   * haberlo visto en el portatil. Por eso va en localStorage.
   */
  vistos: localStorage.getItem('klip:vistos') ?? '',
  avisos: false,
};

/*
 * Como se desplaza la pagina, segun lo que haya pedido el usuario.
 *
 * La regla CSS de movimiento reducido pone scroll-behavior:auto en todo, pero
 * eso NO alcanza a scrollIntoView({behavior:'smooth'}): la opcion del metodo
 * pesa mas que la propiedad, asi que el desplazamiento animado seguia pasando
 * justo para quien habia pedido que no pasara.
 *
 * Se consulta en cada llamada y no una vez al cargar: la preferencia se puede
 * cambiar con la pagina abierta.
 */
function comoDesplazar() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * Concordancia de numero.
 *
 * "1 clips aprobados" se lee como un error de programa y resta confianza en
 * todo lo demas que diga el panel.
 */
function plural(n, singular, pluralForma) {
  return n + ' ' + (n === 1 ? singular : (pluralForma ?? singular + 's'));
}

function hora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Cuanto hace, en cristiano.
 *
 * Una hora exacta obliga a restar mentalmente. En una lista de avisos lo que se
 * quiere saber es si es de hace un momento o de ayer, y a partir del dia la
 * hora exacta ya no dice nada util, asi que se pasa a la fecha.
 */
/** Minutos transcurridos desde un instante ISO. */
function minutosDesde(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function hace(iso) {
  if (!iso) return '';
  const seg = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seg < 90) return 'hace un momento';
  const min = Math.round(seg / 60);
  if (min < 60) return 'hace ' + plural(min, 'minuto');
  const h = Math.round(min / 60);
  if (h < 24) return 'hace ' + plural(h, 'hora');
  const d = Math.round(h / 24);
  if (d < 7) return 'hace ' + plural(d, 'dia');
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

/** Un trabajo esta vivo mientras no haya terminado de una forma u otra. */
function vivo(job) {
  return job && (job.status === 'running' || job.status === 'queued');
}

// --- Avisos ---------------------------------------------------------------

/*
 * A donde lleva cada trabajo cuando termina.
 *
 * El aviso no sirve de nada si al pulsarlo te deja donde estabas. Lo util de
 * "los videos ya estan" es ir a verlos.
 */
const DESTINO = {
  ingest: 'proceso',
  select: 'clips',
  render: 'clips',
  variants: 'proceso',
  schedule: 'cola',
  publish: 'cola',
  metrics: 'metricas',
  accounts: 'proceso',
  doctor: 'registro',
};

/** Lo que de verdad le importa a quien lo lee, no el nombre interno del paso. */
const PASO = {
  ingest: 'Ya esta transcrito',
  select: 'Momentos encontrados',
  render: 'Videos creados',
  variants: 'Copias por cuenta hechas',
  schedule: 'Reparto rehecho',
  publish: 'Envío terminado',
  metrics: 'Números actualizados',
  accounts: 'Cuentas revisadas',
  doctor: 'Revisión terminada',
};

/**
 * Los trabajos terminados, del mas reciente al mas antiguo.
 *
 * Cancelados fuera: cancelar ya es una accion tuya y el panel se actualizo
 * delante de ti. Avisarte de algo que acabas de hacer es ruido.
 */
function listaAvisos() {
  return state.jobs
    .filter(j => j.status === 'ok' || j.status === 'error')
    .sort((a, b) => String(b.endedAt ?? '').localeCompare(String(a.endedAt ?? '')))
    .slice(0, 8);
}

/** Cuantos hay posteriores a la ultima vez que se abrio la campana. */
function sinVer() {
  return listaAvisos().filter(j => String(j.endedAt ?? '') > state.vistos).length;
}

function pintarAvisos() {
  const lista = listaAvisos();

  const panel = document.getElementById('avisos');
  if (!state.avisos) { panel?.remove(); }
  else if (!panel) {
    const el = document.createElement('div');
    el.id = 'avisos';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Avisos');
    el.innerHTML = lista.length === 0
      ? '<p class="vacio">Nada todavía. Aquí te aviso cuando termine un trabajo.</p>'
      : lista.map(j =>
          // Un fallo lleva SIEMPRE al Historial, sea del paso que sea: lo que
          // quiere quien lo pulsa es saber por que fallo, y eso esta en el
          // registro. Mandarlo a Inicio porque el paso era "descargar" le
          // enseña justo lo que no necesita.
          '<button class="fila' + (j.status === 'error' ? ' fallo' : '') + '" data-ir="' +
            (j.status === 'error' ? 'registro' : DESTINO[j.kind] ?? 'registro') + '">' +
            '<b class="que">' +
              (j.status === 'error' ? 'Fallo: ' + esc(j.label) : esc(PASO[j.kind] ?? j.label)) +
            '</b>' +
            '<span class="cuando">' + hace(j.endedAt) + '</span>' +
          '</button>'
        ).join('');
    document.querySelector('header').appendChild(el);
  }

  document.getElementById('campana').setAttribute('aria-expanded', String(state.avisos));

  /*
   * El punto, y la animacion solo cuando el numero cambia.
   *
   * Mismo truco que el contador del menu: render() corre con cada aviso del
   * servidor, casi siempre sin novedad. El valor anterior vive en el nodo para
   * no llevar otra variable de estado, y el reflow forzado es lo que permite
   * repetir la animacion sin que el navegador agrupe los dos cambios.
   */
  const boton = document.getElementById('campana');
  const n = sinVer();
  let punto = boton.querySelector('.bolita');
  if (n === 0) { punto?.remove(); return; }
  if (!punto) {
    punto = document.createElement('i');
    punto.className = 'bolita';
    boton.appendChild(punto);
  }
  const antes = punto.dataset.n;
  if (antes !== undefined && antes !== String(n)) {
    punto.classList.remove('cambia');
    void punto.offsetWidth;
    punto.classList.add('cambia');
  }
  punto.dataset.n = String(n);
}

/** Abrir la campana marca todo como visto. Cerrarla no deshace eso. */
function abrirAvisos(abrir) {
  state.avisos = abrir;
  if (abrir) {
    const ultimo = listaAvisos()[0];
    if (ultimo?.endedAt) {
      state.vistos = ultimo.endedAt;
      localStorage.setItem('klip:vistos', state.vistos);
    }
  }
  pintarAvisos();
}

/** Abre o cierra el menu lateral. */
function menu(abrir) {
  const mas = document.getElementById('mas');
  if (mas) mas.hidden = !abrir;
  document.getElementById('menu')?.setAttribute('aria-expanded', String(Boolean(abrir)));
  document.getElementById('fondo').classList.toggle('abierto', abrir);
}

// Escapar cierra lo que este abierto: es lo que espera cualquiera en un
// escritorio. Primero los avisos, que es lo que esta por encima.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (state.avisos) { abrirAvisos(false); return; }
  menu(false);
});

/*
 * Una mutacion de proyectos: manda, refresca y avisa.
 *
 * La respuesta trae el estado entero, asi que se guarda tal cual en vez de
 * volver a pedirlo. El error se enseña con avisar() y NO se repinta: si el
 * nombre estaba repetido, borrar lo que el usuario escribio le obliga a
 * teclearlo otra vez para corregir una letra.
 */
/*
 * La campaña elegida en Inicio, si la hay.
 *
 * Se recuerda en el aparato: al subir cinco videos de la misma campaña,
 * volver a elegirla cada vez es donde se cuela el error de asignar uno mal.
 */
function campanaElegida() {
  // 'campana-vod' y no 'campana': ese id ya es el de la campana de avisos.
  const sel = document.getElementById('campana-vod');
  if (!sel) return '';
  state.campanaElegida = sel.value;
  localStorage.setItem('klip:campana', sel.value);
  return sel.value;
}

async function proyectoAccion(body, hecho) {
  try {
    state.proyectos = await api('/api/proyectos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    render();
    avisar(hecho);
  } catch (err) {
    avisar(err.message);
  }
}

async function api(path, options) {
  const res = await fetch(path, options);
  // La sesion caduco o se cerro en otro sitio: a la entrada, sin mas.
  if (res.status === 401) {
    location.href = '/login';
    throw new Error('Tu sesión terminó. Vuelve a entrar.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// --- Carga de datos -------------------------------------------------------

async function cargarProceso() {
  // Tambien las campañas: el desplegable de 'Añadir un video' vive aqui.
  const [overview, jobs, proyectos] = await Promise.all([
    api('/api/overview'), api('/api/jobs'), api('/api/proyectos'),
  ]);
  state.overview = overview;
  state.jobs = jobs.jobs;
  state.proyectos = proyectos;
}

async function cargarClips() {
  const data = await api('/api/clips?status=' + state.filter);
  state.counts = data.counts;
  state.clips = data.clips;
}

async function cargarMetricas() {
  state.metrics = await api('/api/metrics');
}

/*
 * La campana se alimenta de state.jobs, que llena cargarProceso() en el primer
 * refresco (la vista siempre arranca en Inicio) y mantiene vivo el canal de
 * eventos, que escucha en las ocho secciones. No hace falta pedir los trabajos
 * en cada cambio de seccion.
 */
async function refrescar() {
  if (state.view === 'proceso' || state.view === 'videos') await cargarProceso();
  if (state.view === 'clips') await cargarClips();
  if (state.view === 'cola') {
    const [cola, overview] = await Promise.all([api('/api/queue'), api('/api/overview')]);
    state.queue = cola;
    state.overview = overview;
  }
  if (state.view === 'registro') {
    const esAdmin = !state.yo || state.yo.rol === 'admin';
    const [runs, sistema, auditoria] = await Promise.all([
      api('/api/runs'),
      api('/api/sistema'),
      // Fase 8: el registro de cambios, solo para administradores.
      esAdmin ? api('/api/auditoria').catch(() => null) : Promise.resolve(null),
    ]);
    state.runs = runs;
    state.sistema = sistema;
    state.auditoria = auditoria;
  }
  if (state.view === 'ia') {
    // Las tareas tambien: "Probar IA" es una tarea y hay que ver si sigue en marcha.
    const [ia, jobs] = await Promise.all([api('/api/ia'), api('/api/jobs')]);
    state.ia = ia;
    state.jobs = jobs.jobs;
  }
  if (state.view === 'usuarios') state.usuarios = await api('/api/usuarios');
  if (state.view === 'flujo') state.settings = await api('/api/settings');
  if (state.view === 'ajustes') state.ajustes = await api('/api/ajustes');
  if (state.view === 'proyectos') {
    // Tambien los ajustes: el perfil de cada cliente enseña entre parentesis
    // que valor hereda, y ese valor vive en Horarios.
    const [pr, se] = await Promise.all([api('/api/proyectos'), api('/api/settings')]);
    state.proyectos = pr;
    state.settings = se;
  }
  /*
   * Cuentas necesita las tres: /api/plataformas da el resumen de
   * publicaciones, /api/proyectos quien es cada cuenta y de que cliente, y
   * /api/settings el tope del plan, que es lo que decide cuantas se pueden
   * crear todavia.
   */
  if (state.view === 'plataformas') {
    const [p, pr, se] = await Promise.all([
      api('/api/plataformas'),
      api('/api/proyectos'),
      api('/api/settings'),
    ]);
    state.plataformas = p;
    state.proyectos = pr;
    state.settings = se;
  }
  if (state.view === 'metricas') {
    // Tambien el estado general: el vacio depende de si hay cuentas que publican.
    const [, overview] = await Promise.all([cargarMetricas(), api('/api/overview')]);
    state.overview = overview;
  }
  /*
   * El detalle se pide cada vez que se entra, no se cachea.
   *
   * Los clips cambian de estado mientras se revisa y la linea de tiempo pinta
   * ese estado. Un detalle guardado enseñaria quince momentos "sin revisar"
   * despues de haber aprobado la mitad.
   */
  if (state.view === 'vod' && state.vodId) {
    state.vod = await api('/api/sources/' + encodeURIComponent(state.vodId));
  }
  render();
}

/*
 * Aviso breve de que algo se guardo.
 *
 * Se reemplaza el aviso anterior en vez de apilar: dos clics seguidos en
 * Guardar producian dos mensajes iguales uno encima de otro, que se lee como un
 * fallo. El temporizador se guarda en el propio elemento para no llevar una
 * variable suelta por esto.
 */
function avisar(texto) {
  document.getElementById('aviso')?.remove();
  const el = document.createElement('div');
  el.id = 'aviso';
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.appendChild(el);

  setTimeout(() => {
    el.classList.add('sale');
    // No se espera al evento de fin de animacion: con movimiento reducido dura
    // 0,01 ms y con animaciones desactivadas del todo no llegaria nunca.
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

/*
 * Esqueleto de carga, con la forma de lo que va a llegar.
 *
 * Sustituye al "Cargando..." que habia en las seis vistas. Aquel texto ocupaba
 * una linea y lo que llegaba ocupaba media pantalla, asi que al aparecer los
 * datos todo daba un salto. El esqueleto reserva el sitio y la llegada no mueve
 * nada.
 *
 * El parametro filas es cuantas tarjetas fingir; conCifras anade la banda de
 * tres numeros que llevan Inicio y Metricas.
 */
/*
 * Encabezado de seccion.
 *
 * Sustituye al rotulo gris suelto. Lleva tres cosas y las tres hacen falta:
 * un icono para reconocer la seccion de un vistazo al volver, el nombre, y una
 * linea que diga PARA QUE sirve.
 *
 * Esa linea es lo que mas se nota: "Reparto" no significa nada para quien
 * entra por primera vez, y esta gente son clientes, no quien monto esto.
 */
function seccion(icono, titulo, explica) {
  return '<div class="seccion">' +
    '<i class="ico">' + icono + '</i>' +
    '<div>' +
      '<h2>' + esc(titulo) + '</h2>' +
      (explica ? '<p>' + esc(explica) + '</p>' : '') +
    '</div>' +
  '</div>';
}

function esqueleto(filas, conCifras) {
  let h = '';
  if (conCifras) {
    h += '<article class="card"><div class="body">' +
      '<div class="hueso alto"></div>' +
    '</div></article>';
  }
  for (let i = 0; i < filas; i += 1) {
    h += '<article class="card"><div class="body">' +
      '<div class="hueso titulo"></div>' +
      '<div class="hueso"></div>' +
      '<div class="hueso medio"></div>' +
      '<div class="hueso corto"></div>' +
    '</div></article>';
  }
  // aria-busy se lo dice a quien navega con lector de pantalla, que no ve el
  // barrido. Sin esto, la espera es silencio.
  return '<div class="cascada" aria-busy="true" aria-label="Cargando">' + h + '</div>';
}

// --- Vista: proceso -------------------------------------------------------

function pintarJob(job, destacado) {
  const abierto = state.openLog === job.id;
  // "En cola" es informativo, no una alerta: va en gris, que es la etiqueta
  // sin clase. Antes salia en ambar y competia con los avisos de verdad.
  const clase = {queued:'', running:'live', ok:'ok', error:'bad', cancelled:''}[job.status] || '';
  return '<article class="card job ' + job.status + (destacado ? ' hero paso-1' : '') + '">' +
    '<div class="body">' +
      (destacado
        ? '<p class="ante">Ahora mismo</p>'
        : '') +
      '<div class="joghead">' +
        '<span class="jobname">' + esc(job.label) + '</span>' +
        '<span class="badge ' + clase + '">' +
          ({queued:'esperando', running:'trabajando', ok:'listo', error:'fallo', cancelled:'cancelado',
            en_espera_ia:'esperando a la IA'}[job.status]) +
        '</span>' +
      '</div>' +
      (job.lastLine ? '<div class="jobline">' + esc(job.lastLine) + '</div>' : '') +

      /*
       * Encolado y sin nadie que lo coja: hay que decirlo.
       *
       * El panel encola, pero quien ejecuta es el trabajador del ordenador con
       * tarjeta grafica. Si no esta corriendo, la tarea se queda en "esperando"
       * para siempre con "(sin salida)" debajo, y eso se lee como que el
       * programa esta roto. No lo esta: no hay nadie escuchando.
       *
       * Un minuto de margen: el trabajador pregunta cada cinco segundos, asi
       * que si en sesenta no lo ha cogido es que no esta.
       */
      (job.status === 'queued' && !job.claimedBy && minutosDesde(job.createdAt) >= 1
        ? '<div class="warn" style="margin:10px 0 0">' +
            '<b>Nadie la ha recogido.</b> Esta tarea la ejecuta el ordenador que tiene los ' +
            'videos, y ahí no hay ningún trabajador escuchando. Arráncalo con ' +
            '<i>npm run worker</i> y la cogera en unos segundos.' +
          '</div>'
        : '') +

      '<div class="actions" style="margin-top:10px">' +
        '<button class="chip" data-log="' + job.id + '">' + (abierto ? 'Ocultar detalles' : 'Ver detalles') + '</button>' +
        (vivo(job) ? '<button class="chip" data-cancel="' + job.id + '">Cancelar</button>' : '') +
      '</div>' +
      (abierto
        ? '<div class="log" id="log-' + job.id + '">' +
            '<div class="hueso medio"></div><div class="hueso"></div>' +
            '<div class="hueso corto"></div>' +
          '</div>'
        : '') +
    '</div>' +
  '</article>';
}

/**
 * Que toca hacer ahora mismo.
 *
 * Es la pieza que mas acelera el uso del panel. Antes habia que mirar seis
 * bloques y deducir en que punto estaba todo; ahora el panel lo deduce y lo
 * dice en una frase con un solo boton.
 *
 * El orden de las comprobaciones es el de la tuberia, asi que siempre sale el
 * primer hueco sin cubrir y no el ultimo.
 */
function siguientePaso(o) {
  if (o.sources.length === 0) {
    return { texto: 'Empieza con un video', sub: 'Pega un enlace de YouTube o sube uno de tu móvil.', accion: null };
  }

  for (const s of o.sources) {
    /*
     * Un VOD revisado entero y descartado entero ya no tiene siguiente paso.
     *
     * Sin esto se quedaba atascado el primero de la lista: kick-cuenta-ejemplo
     * tenia sus 15 clips descartados y el panel insistia en "Subir 15 videos
     * para poder revisarlos", que es trabajo para nada sobre material que
     * alguien ya dijo que no. Y al ser el primero, tapaba el siguiente paso de
     * todos los demas videos.
     */
    if (s.clips > 0 && s.rejected >= s.clips) continue;

    /*
     * Una descarga fallida NO es el siguiente paso.
     *
     * Antes lo era, y ocupaba el sitio principal del panel: con cuarenta y
     * cinco videos esperando revision, lo primero que se leia al entrar era
     * "Falta sacar el texto de qlopnOiwLvk", sobre un video que no existe y que
     * no se podia ni relanzar ni quitar.
     *
     * Es un estorbo que limpiar, no trabajo que hacer. Se salta aqui y se
     * resuelve en su propia ficha, que ahora tiene boton para quitarlo.
     */
    if (!s.hasTranscript) continue;
    if (s.clips === 0) {
      return {
        texto: 'Buscar los mejores momentos',
        sub: s.title,
        accion: { kind: 'select', source: s.sourceId, label: 'Buscar momentos' },
      };
    }
    if (s.rendered === 0) {
      return {
        texto: 'Armar los clips de ' + plural(s.clips, 'momento'),
        sub: s.title,
        accion: { kind: 'render', source: s.sourceId, label: 'Armar clips' },
      };
    }
    /*
     * Subir es un paso mas de la tuberia, no un extra.
     *
     * Sin copia en la nube, revisar desde el movil enseña tarjetas sin video,
     * que es justo el estado en el que estuvo el panel hasta ahora. Va aqui,
     * antes de mirar si hay pendientes, porque revisar sin verlos no se puede.
     */
    /*
     * Se cuenta lo REVISABLE, no lo renderizado.
     *
     * La subida se salta los descartados desde que dejo 110 MB de clips que
     * nadie iba a ver ocupando la nube. El panel seguia contando los
     * renderizados a secas, asi que pedia subir mas videos de los que iba a
     * subir de verdad.
     */
    const revisables = Math.max(0, s.rendered - s.rejected);
    if (revisables > 0 && (o.subidos?.[s.sourceId] ?? 0) === 0) {
      return {
        texto: 'Subir ' + plural(revisables, 'video') + ' para poder revisarlos',
        sub: s.title + '. Sin esto no se ven desde el móvil.',
        accion: { kind: 'subir', source: s.sourceId, label: 'Subir para revisar' },
      };
    }
  }

  if (o.clips.pending > 0) {
    return {
      texto: plural(o.clips.pending, 'video espera', 'videos esperan') + ' que lo veas',
      sub: 'Es lo único que no puede hacer el programa solo.',
      accion: { vista: 'clips', label: 'Revisar ahora' },
    };
  }

  if (o.clips.approved === 0) {
    return { texto: 'No has aprobado ningún video', sub: 'Hasta que apruebes alguno no hay nada que subir.', accion: null };
  }

  /*
   * El reparto ya no se pide, se cuenta.
   *
   * Aqui habia dos pasos seguidos, "Hacer una copia para cada cuenta" y
   * "Repartir entre las cuentas", cada uno con su boton. Los dos los hace ahora
   * el programa en cuanto un video se queda sin nada por revisar. Dejarlos como
   * siguiente paso pedia trabajo que ya estaba hecho, o peor, animaba a lanzar
   * a mano algo que estaba a punto de lanzarse solo.
   *
   * Queda el aviso de que esta en marcha, que si es util: entre aprobar el
   * ultimo clip y ver aparecer las fechas pasan un par de minutos, y sin esto
   * ese hueco parece que no paso nada.
   */
  const sinRepartir = o.sources.find(
    s => s.approved > 0 && ((o.enCola ?? {})[s.sourceId] ?? 0) === 0,
  );
  if (sinRepartir) {
    return {
      texto: 'Preparando el reparto',
      sub: 'Las copias por cuenta y las fechas se hacen solas. Tarda un par de minutos.',
      accion: { vista: 'cola', label: 'Ver la agenda' },
    };
  }

  if (o.clips.approved < o.target) {
    return {
      texto: 'Te faltan videos aprobados',
      sub: 'Tienes ' + o.clips.approved + ' y hacen falta ' + o.target + ' al día. Se repetiran de más.',
      accion: { vista: 'clips', label: 'Seguir revisando' },
    };
  }

  return { texto: 'Todo listo', sub: plural(o.queue.total, 'subida programada', 'subidas programadas') + ' y videos de sobra.', accion: null, ok: true };
}

function pintarSiguiente(o, ocupado) {
  const p = siguientePaso(o);

  let boton = '';
  if (p.accion && !ocupado) {
    const attrs = p.accion.vista
      ? 'data-ir="' + p.accion.vista + '"'
      : 'data-run="' + p.accion.kind + '"' + (p.accion.source ? ' data-source="' + esc(p.accion.source) + '"' : '');
    boton = '<div class="actions" style="margin-top:var(--s4)">' +
      '<button class="act go" ' + attrs + '>' + p.accion.label + '</button></div>';
  }

  return '<article class="card hero ancho paso-1"><div class="body">' +
    '<p class="ante">Siguiente paso</p>' +
    '<p class="hook" style="font-size:19px;margin-bottom:var(--s1)' +
      (p.ok ? ';color:var(--ok)' : '') + '">' + esc(p.texto) + '</p>' +
    '<p class="reason" style="margin:0">' + esc(p.sub) + '</p>' +
    boton +
  '</div></article>';
}

/*
 * Una tarjeta de VOD.
 *
 * enCurso no es lo mismo que ocupado. Ocupado significa que hay ALGUN trabajo
 * corriendo, y con eso se apagan todos los botones para no encolar dos cosas a
 * la vez. En curso significa que el trabajo es sobre ESTE video, y es lo unico
 * que justifica animar su paso activo: si late en los tres VOD a la vez, el
 * latido deja de senalar nada.
 *
 * (Sin acentos graves en estos comentarios: la pagina entera vive dentro de una
 * plantilla de texto y uno solo la cierra a media altura. Ya ha pasado.)
 */
function pintarFuente(s, ocupado, variantes, enCurso, subidos) {
  /*
   * Cinco estados en secuencia. El primero sin cubrir es "ahora"; los
   * anteriores estan hechos y los siguientes aun no tocan.
   *
   * "En la nube" va entre los videos y las copias por cuenta porque ese es el
   * orden real: primero se renderiza, luego se sube para poder revisarlo desde
   * el movil, y solo lo aprobado merece que se generen veinte variantes.
   */
  const hechos = [s.hasTranscript, s.clips > 0, s.rendered > 0, subidos > 0, variantes > 0];
  const etiquetas = ['Texto', 'Momentos', 'Videos', 'En la nube', 'Copias'];
  const ahora = hechos.indexOf(false);

  const cifras = [null, s.clips, s.rendered, subidos, variantes];

  const acciones = [
    null,
    ['select', 'Buscar los mejores momentos'],
    ['render', 'Armar clips'],
    ['subir', 'Subir para revisar'],
    ['variants', 'Hacer una copia por cuenta'],
  ];
  /*
   * Tres situaciones distintas, no dos.
   *
   * La version anterior solo distinguia "queda algo" de "esta todo", y el paso
   * 0 (sin transcripcion) caia en el mismo saco que "esta todo" porque su
   * accion es null: transcribir no se lanza desde aqui, viene con el video.
   * Resultado: un VOD todavia descargandose ofrecia el boton de renderizar, y
   * al pulsarlo fallaba con "No existe transcript.json".
   */
  const sinEmpezar = ahora === 0
  const terminado = ahora === -1

  /*
   * Cuatro, en realidad: tambien "no queda nada que hacer AQUI".
   *
   * Los pasos que siguen a los momentos solo tienen sentido sobre material que
   * alguien pueda aprobar, y aprobar no se hace en esta ficha sino en Revisar
   * videos. Sin esta comprobacion, un VOD con sus quince clips descartados
   * seguia ofreciendo botones: al pulsarlos la tarea arrancaba, fallaba con "No
   * hay clips aprobados" y encima remitia a un comando de consola que ya no
   * existe. Paso el 2026-10-03 con kick-cuenta-ejemplo-114acf735a.
   *
   * Dos casos distintos y se distinguen a proposito:
   *
   *   todo descartado   se reviso y no valia nada. No hay vuelta: no hay
   *                     material. Ofrecer "subir para revisar" es absurdo.
   *   falta aprobar     hay clips sin mirar. La accion existe, pero esta en
   *                     otra pantalla.
   */
  const revisables = s.clips - (s.rejected ?? 0)
  const todoDescartado = s.clips > 0 && revisables === 0
  const faltanAprobados = acciones[ahora]?.[0] === 'variants' && (s.approved ?? 0) === 0
  const sinMaterial = todoDescartado || faltanAprobados
  const siguiente = sinEmpezar || terminado || sinMaterial ? null : acciones[ahora]

  /*
   * Los momentos de ESTE video, para la linea de tiempo compacta.
   *
   * Vienen del overview con tres numeros por clip; aqui se traducen a la forma
   * que entiende lineaTiempo(), que es la misma que usa el detalle. Asi las
   * dos lineas -- la de la ficha y la grande -- son literalmente el mismo
   * dibujo a dos tamaños y no pueden discrepar.
   */
  const dur = (s.durationMin ?? 0) * 60;
  const suyos = (state.overview?.momentos?.[s.sourceId] ?? [])
    .map(m => ({ start: m.s, end: m.e, id: '', hook: '',
                 status: m.t === 'si' ? 'approved' : m.t === 'no' ? 'rejected' : 'pending' }));

  return '<div class="src' + (enCurso ? ' trabajando' : '') + '">' +
    '<div class="srchead">' +
      // El titulo abre el detalle. Es el gesto que ya se espera en una lista:
      // pinchas el nombre de la cosa y ves la cosa.
      '<button class="srctitle" data-vod="' + esc(s.sourceId) + '">' + esc(s.title) + '</button>' +
      (enCurso ? '<span class="girando" role="img" aria-label="Procesando">${espiral(15)}</span>' : '') +
    '</div>' +
    '<div class="srcmeta">' + (s.durationMin !== null ? s.durationMin + ' min' : 'duración desconocida') + '</div>' +
    /*
     * La linea de tiempo, solo si sabemos cuanto dura el VOD y ya hay
     * momentos. Sin duracion no hay escala, y una barra vacia no dice nada
     * que no diga ya el paso "Momentos" de abajo.
     */
    (dur > 0 && suyos.length > 0 ? lineaTiempo(dur, suyos, true) : '') +

    '<div class="steps">' +
      etiquetas.map((label, i) =>
        '<div class="step ' + (hechos[i] ? 'done' : i === ahora ? 'now' : '') + '">' +
          label + (cifras[i] ? '<br>' + cifras[i] : '') +
        '</div>'
      ).join('') +
    '</div>' +

    (siguiente
      ? '<div class="chips">' +
          '<button class="chip primario" data-run="' + siguiente[0] + '" data-source="' + esc(s.sourceId) + '"' +
          (ocupado ? ' disabled' : '') + '>' + siguiente[1] + '</button>' +
          /*
           * El atajo para musica, al lado del normal.
           *
           * Buscar momentos le pregunta a un modelo y eso gasta saldo; cuando
           * se acaba, falla entero y no hay forma de seguir. Para un VOD de
           * musica el atajo mide los picos de voz del propio audio y no gasta
           * nada. Antes solo se mencionaba en el texto del error, que ademas
           * remitia a una terminal.
           */
          (siguiente[0] === 'select'
            ? '<button class="chip" data-run="momentos" data-source="' + esc(s.sourceId) + '"' +
              (ocupado ? ' disabled' : '') + ' title="Para música. Busca los estribillos midiendo el audio, sin gastar saldo.">' +
              'Es música: buscar estribillos</button>'
            : '') +
          // Rehacer un paso ya dado es legitimo (cambiaste los ajustes), pero
          // no es lo normal, asi que va detras y sin destacar.
          // Aqui 'ahora' solo puede ser 1, 2 o 3, asi que basta con mirar si hay
          // un paso anterior que repetir.
          (ahora > 1
            ? '<button class="chip" data-run="' + acciones[ahora - 1][0] +
              '" data-source="' + esc(s.sourceId) + '"' + (ocupado ? ' disabled' : '') + '>Repetir el paso anterior</button>'
            : '') +
        '</div>'
      : sinMaterial
        // Lo que falta no se hace aqui: hay que ir a aprobar. Se dice donde, y
        // se distingue "nadie lo ha mirado" de "se miro y se descarto todo",
        // que son situaciones muy distintas.
        ? '<p class="reason" style="margin:0">' +
            (todoDescartado
              ? (s.clips === 1 ? 'Se descartó su único momento' : 'Se descartaron sus ' + s.clips + ' momentos') + ', así que no queda nada que publicar.'
              : 'Falta aprobar alguno en Revisar para poder copiarlo a las cuentas.') +
          '</p>'
      : sinEmpezar
        // Sin transcripcion no hay nada que lanzar: o sigue procesandose o
        // fallo. Ofrecer un boton aqui solo lleva a un error incomprensible.
        ? (ocupado
            ? '<p class="reason" style="margin:0">Trabajando en el. ' +
              'Cuando acabe te esperará en Revisar.</p>'
            /*
             * Una descarga fallida dejaba una ficha muerta y sin salida.
             *
             * El VOD se apunta en cuanto se conoce su identificador, antes de
             * tener el video. Si la descarga falla, queda una ficha a cero que
             * no avanza, no se puede relanzar porque no hay fichero, y tampoco
             * se podia quitar: el 2026-10-09 una de esas era lo primero que se
             * leia al abrir el panel.
             */
            : '<p class="reason" style="margin:0 0 var(--s3)">' +
              'La descarga no llego a terminar, así que no hay nada que cortar. ' +
              'Vuelve a añadirlo desde arriba, o quítalo de la lista.</p>' +
              '<div class="chips">' +
                '<button class="chip" data-quitar-vod="' + esc(s.sourceId) + '">' +
                'Quitar de la lista</button>' +
              '</div>')
        : '<div class="chips">' +
            '<button class="chip" data-run="render" data-source="' + esc(s.sourceId) + '"' +
            (ocupado ? ' disabled' : '') + '>Volver a crear los videos</button>' +
          '</div>') +
  '</div>';
}

/**
 * Produccion acumulada y estado de las plataformas, en una linea.
 *
 * Responde a dos preguntas que los contadores de estado no responden: cuanto
 * llevas hecho, y si eso tiene por donde salir. Con todo aprobado y repartido,
 * "0 por revisar" se lee igual que no haber hecho nada nunca.
 */
function pintarRitmo(o) {
  const r = o.ritmo ?? { semana: 0, total: 0 };
  const plats = o.plataformas ?? [];

  // Solo las que existen de verdad. Listar aqui "YouTube Shorts: no disponible"
  // llenaria la pantalla de cosas que no se pueden hacer.
  const reales = plats.filter(p => p.estado !== 'no-disponible');
  const conectadas = reales.filter(p => p.estado === 'conectado');

  const salida = reales.length === 0
    ? ''
    : conectadas.length > 0
      ? conectadas.map(p => esc(p.nombre)).join(' y ') + ' conectado' + (conectadas.length === 1 ? '' : 's')
      : 'Sin ninguna plataforma conectada todavía';

  return '<article class="card flat paso-2"><div class="body">' +
    '<p class="reason" style="margin:0">' +
      (r.total === 0
        ? 'Todavía no has sacado ningún momento.'
        : plural(r.semana, 'momento') + ' esta semana, ' + r.total + ' en total.') +
    '</p>' +
    (salida
      ? '<div class="plat" style="margin-top:var(--s2)">' +
          '<span class="punto-estado ' + (conectadas.length > 0 ? 'si' : 'no') + '"></span>' +
          '<span class="reason" style="margin:0;flex:1">' + salida + '</span>' +
          '<button class="chip" data-ir="plataformas">Ver</button>' +
        '</div>'
      : '') +
  '</div></article>';
}

/**
 * Cuanto ocupan las copias de revision, y el aviso si falta la clave.
 *
 * Solo aparece cuando hay algo que decir. Un contador de espacio permanente en
 * la pantalla principal es ruido: lo unico que importa es cuando se acerca al
 * limite, y entonces deja de ser informacion y pasa a ser un aviso.
 */
function pintarNube(o) {
  const bytes = o.nubeBytes ?? 0;
  const mb = bytes / 1048576;
  const LIMITE = 1024;

  // El panel remoto sin clave enseña reproductores que no cargarian nunca.
  if (o.remoto && o.hayNube === false && bytes > 0) {
    return '<article class="card"><div class="body"><div class="warn" style="margin:0">' +
      '<b>Falta la clave de Supabase en el servidor.</b> Hay videos subidos, pero este panel ' +
      'no puede pedirlos sin SUPABASE_SERVICE_ROLE_KEY en sus variables de entorno.' +
    '</div></div></article>';
  }

  if (mb < LIMITE * 0.7) return '';

  return '<article class="card"><div class="body"><div class="warn" style="margin:0">' +
    '<b>Las copias ocupan ' + mb.toFixed(0) + ' MB de ' + LIMITE + '.</b> ' +
    'Cuando se llene no se podrán subir videos nuevos. Las de los videos que ya no revises ' +
    'se pueden borrar sin perder nada: los originales siguen en tu ordenador.' +
  '</div></div></article>';
}

// --- Fase 3: Inicio y Videos ------------------------------------------------

/** Un icono de trazo (lucide). La lista viene de src/review/iconos.ts. */
function ico(nombre, clase) {
  return '<svg class="ico-svg' + (clase ? ' ' + clase : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    (ICONOS[nombre] || '') + '</svg>';
}

/*
 * En que punto esta un video, en cuatro etapas.
 *
 * Descargar y transcribir son una sola tarea por dentro, pero se enseñan por
 * separado porque son las dos esperas que se notan: la duracion aparece al
 * descargar y el texto al transcribir.
 */
const ETAPAS = ['Descargar', 'Transcribir', 'Buscar momentos', 'Armar clips'];

function estadoVideo(s, o) {
  const activo = state.jobs.find(j => vivo(j) && j.args && j.args[0] === s.sourceId);
  const hechos = [
    s.durationMin !== null || s.hasTranscript,
    s.hasTranscript,
    s.clips > 0,
    s.rendered > 0,
  ];
  const ahora = hechos.indexOf(false);
  // Un fallo cuenta si es lo ULTIMO que paso con este video.
  const suyos = state.jobs.filter(j => j.args && j.args[0] === s.sourceId);
  const ultimo = suyos[0];
  const error = !activo && ultimo && ultimo.status === 'error' ? ultimo : null;
  const esperaIA = suyos.some(j => j.status === 'en_espera_ia');
  const pendientes = Math.max(0, s.clips - (s.approved ?? 0) - (s.rejected ?? 0));
  const listo = ahora === -1;
  return { activo, hechos, ahora, error, esperaIA, pendientes, listo };
}

function notaVideo(s, e, o) {
  if (e.error) return 'Algo falló en «' + (ETAPAS[Math.max(0, e.ahora)] || 'el último paso') + '». Puedes reintentarlo.';
  if (e.esperaIA) return o.ia ? textoIA(o.ia) + '.' : 'Esperando a la IA.';
  if (e.activo && e.activo.status === 'queued' && e.activo.noAntesDe && new Date(e.activo.noAntesDe) > new Date()) {
    return 'Falló; se reintenta sola a las ' + horaCortaDe(e.activo.noAntesDe) + '.';
  }
  if (e.listo) {
    return e.pendientes > 0
      ? (e.pendientes === 1 ? '1 clip espera tu revisión.' : e.pendientes + ' clips esperan tu revisión.')
      : (s.clips > 0 && (s.rejected ?? 0) >= s.clips ? 'Se descartaron todos sus clips.' : 'Revisado. Lo aprobado ya va a la agenda.');
  }
  if (e.ahora === 0) {
    return e.activo ? 'Descargando el video.' : 'La descarga no terminó. Vuelve a añadirlo o sube el MP4.';
  }
  const textos = ['', 'Sacando el texto de lo que se dice.', 'Buscando los mejores momentos.', 'Armando los clips.'];
  return e.activo ? textos[e.ahora] : 'En cola: empezará en cuanto el procesador esté libre.';
}

/**
 * El aviso de un video musical: derechos de autor y, si ya se midio, si la
 * letra era fiable para quemarla en los clips.
 */
function avisoMusica(s) {
  const letra = s.confianzaLetra === null || s.confianzaLetra === undefined ? ''
    : s.confianzaLetra < 0.5
      ? ' La letra no se entendió bien, así que los clips salen sin subtítulos.'
      : ' La letra se entendió bien y va en subtítulos.';
  return '<p class="video-aviso">' + ico('alerta') +
    '<span>La música con derechos de autor puede ser bloqueada o silenciada por las plataformas.' + letra + '</span></p>';
}

/** Tarjeta de un video, con sus cuatro etapas. */
function pintarVideo(s, o) {
  const e = estadoVideo(s, o);
  const etapas = ETAPAS.map((nombre, i) => {
    const hecha = e.hechos[i];
    const actual = i === e.ahora;
    const clase = hecha ? 'hecha' : actual ? (e.error ? 'fallo' : e.activo ? 'activa' : 'actual') : '';
    return '<li class="etapa ' + clase + '">' +
      '<span class="etapa-nombre">' + nombre + '</span>' +
      '<span class="etapa-barra"><i></i></span>' +
    '</li>';
  }).join('');

  const chip = e.error ? '<span class="estado-chip error">' + ico('alerta') + 'Con error</span>'
    : e.esperaIA ? '<span class="estado-chip aviso">' + ico('reloj') + 'Espera a la IA</span>'
    : e.listo ? '<span class="estado-chip ok">' + ico('hecho') + 'Listo</span>'
    : e.activo ? '<span class="estado-chip info"><span class="vivo-punto"></span>Procesando</span>'
    : '<span class="estado-chip">' + ico('reloj') + 'En cola</span>';

  const acciones = [];
  if (e.activo) acciones.push('<button class="chip" data-cancel="' + e.activo.id + '">' + ico('cerrar') + 'Cancelar</button>');
  if (e.error) acciones.push('<button class="chip" data-grupo-reintentar="' + e.error.id + '">' + ico('reintentar') + 'Reintentar</button>');
  if (e.ahora === 0 && !e.activo) {
    acciones.push('<button class="chip" data-ir="videos" data-modo="subir">' + ico('subir') + 'Subir MP4</button>');
    acciones.push('<button class="chip" data-quitar-vod="' + esc(s.sourceId) + '">Quitar</button>');
  }
  if (e.pendientes > 0) {
    acciones.push('<button class="chip primario" data-ir="clips">' + ico('revisar') + 'Revisar ' +
      (e.pendientes === 1 ? '1 clip' : e.pendientes + ' clips') + '</button>');
  }
  acciones.push('<button class="chip" data-vod="' + esc(s.sourceId) + '">Ver detalles</button>');

  return '<article class="card video-card' + (e.activo ? ' trabajando' : '') + '"><div class="body">' +
    '<div class="video-cab">' +
      '<button class="srctitle" data-vod="' + esc(s.sourceId) + '">' + esc(s.title) + '</button>' +
      (s.tipo === 'musica' ? '<span class="estado-chip">' + ico('musica') + 'Música</span>' : '') +
      chip +
    '</div>' +
    '<p class="video-meta">' +
      (s.durationMin !== null ? '<span class="dato">' + s.durationMin + ' min</span>' : 'Duración pendiente') +
      (s.clips > 0 ? ' · ' + plural(s.clips, 'momento') : '') +
    '</p>' +
    '<ol class="etapas">' + etapas + '</ol>' +
    '<p class="video-nota">' + esc(notaVideo(s, e, o)) + '</p>' +
    (s.tipo === 'musica' ? avisoMusica(s) : '') +
    '<div class="chips">' + acciones.join('') + '</div>' +
  '</div></article>';
}

/** Añadir un video: enlace o MP4, tipo y campaña. */
function bloqueAnadir(o, compacto) {
  const modo = state.anadirModo || 'enlace';
  const tipo = state.tipoVideo || 'entrevista';
  const campanas = state.proyectos?.campanas ?? [];
  const selectorCampana = campanas.length && !compacto
    ? '<div class="field"><label for="campana-vod">Campaña</label>' +
        '<select id="campana-vod">' + opcionesCampana(campanas, state.campanaElegida) + '</select></div>'
    : '';
  const tipos = [['entrevista', 'Entrevista'], ['stream', 'Stream'], ['musica', 'Video musical']];
  const apagado = o.trabajador && !o.trabajador.vivo
    ? '<p class="warn" style="margin:0 0 var(--s3)">El procesador está desconectado' +
        (o.trabajador.vistoEn ? ' desde ' + hace(o.trabajador.vistoEn) : '') +
        '. Puedes añadir el video igual: empezará en cuanto se conecte.</p>'
    : '';

  return '<article class="card anadir-card"><div class="body">' +
    (compacto ? '<p class="ante">Añadir video</p>' : '') +
    apagado +
    '<div class="segmento" role="tablist" aria-label="Cómo añadirlo">' +
      '<button role="tab" data-anadir-modo="enlace" aria-selected="' + (modo === 'enlace') + '">' + ico('enlace') + 'Enlace</button>' +
      '<button role="tab" data-anadir-modo="subir" aria-selected="' + (modo === 'subir') + '">' + ico('subir') + 'Subir MP4</button>' +
    '</div>' +
    (compacto ? '' :
      '<fieldset class="tipos"><legend>Tipo de video</legend>' +
        tipos.map(([v, t]) =>
          '<label class="tipo"><input type="radio" name="tipo-video" value="' + v + '"' + (tipo === v ? ' checked' : '') + '>' +
          '<span>' + t + '</span></label>').join('') +
      '</fieldset>' +
      (tipo === 'musica'
        ? '<p class="reason" style="margin:0 0 var(--s3)">Se buscan los estribillos midiendo el audio, sin usar la IA. ' +
          'La música con derechos de autor puede ser bloqueada o silenciada por las plataformas.</p>'
        : '')) +
    selectorCampana +
    // Fase 7: el contenido de terceros necesita permiso (docs/RIESGOS.md).
    (compacto ? '' : '<p class="reason aviso-licencia">Usa solo videos tuyos o con permiso de su autor. ' +
      'Publicar contenido ajeno sin licencia puede hacer que TikTok quite los clips o bloquee las cuentas.</p>') +
    (modo === 'enlace'
      ? '<div class="field"><label for="url">Enlace del video</label>' +
          '<div class="fila-input"><input id="url" type="url" inputmode="url" placeholder="https://youtube.com/…" autocomplete="off" spellcheck="false">' +
          '<button class="act go" id="ingest">Añadir</button></div></div>'
      : '<div class="drop" id="drop" role="button" tabindex="0">' + ico('subir') +
          '<span>Toca para elegir un MP4, o arrástralo aquí</span></div>' +
        '<input type="file" id="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm" hidden>' +
        '<div class="barra" id="barra" hidden><i></i></div>' +
        '<p class="reason" id="subiendo" style="margin:8px 0 0"></p>') +
  '</div></article>';
}

function vistaVideos() {
  const o = state.overview;
  if (!o) return esqueleto(3, false);

  const filtro = state.filtroVideos || 'todos';
  const conEstado = o.sources.map(s => ({ s, e: estadoVideo(s, o) }));
  const grupos = {
    todos: conEstado,
    proceso: conEstado.filter(x => !x.e.listo && !x.e.error),
    listos: conEstado.filter(x => x.e.listo),
    error: conEstado.filter(x => x.e.error),
  };
  const filtros = [['todos', 'Todos'], ['proceso', 'En proceso'], ['listos', 'Listos'], ['error', 'Con error']];
  const lista = grupos[filtro] || conEstado;

  return '<div class="rejilla-videos">' +
    '<section class="col-anadir">' + bloqueAnadir(o, false) + '</section>' +
    '<section class="col-lista">' +
      '<div class="filtros" role="tablist" aria-label="Filtrar videos">' +
        filtros.map(([v, t]) =>
          '<button class="tab" role="tab" data-filtro-videos="' + v + '" aria-selected="' + (filtro === v) + '">' +
            t + ' <span class="dato">' + grupos[v].length + '</span></button>').join('') +
      '</div>' +
      (lista.length === 0
        ? '<div class="empty"><b>' + (o.sources.length === 0 ? 'Todavía no hay videos' : 'Nada en este filtro') + '</b>' +
            (o.sources.length === 0 ? 'Pega un enlace o sube un MP4 para empezar.' : 'Prueba con «Todos».') + '</div>'
        : '<div class="cascada">' + lista.map(x => pintarVideo(x.s, o)).join('') + '</div>') +
    '</section>' +
  '</div>';
}

/** Las cuatro tarjetas del flujo, con su numero. */
function pintarFlujo(o) {
  const procesando = o.sources.filter(s => { const e = estadoVideo(s, o); return !e.listo && !e.error; }).length;
  const pasos = [
    ['procesando', 'Procesando', procesando, 'videos', 'procesando', procesando === 1 ? 'video' : 'videos'],
    ['revisar', 'Por revisar', o.clips.pending, 'clips', 'bandeja', o.clips.pending === 1 ? 'clip' : 'clips'],
    ['aprobados', 'Aprobados', o.clips.approved, 'clips', 'aprobado', o.clips.approved === 1 ? 'clip' : 'clips'],
    ['agenda', 'En agenda', o.queue.total, 'cola', 'agenda', o.queue.total === 1 ? 'salida' : 'salidas'],
  ];
  return '<div class="flujo cascada">' + pasos.map(([id, nombre, n, ir, icono, unidad], i) =>
    '<button class="paso-flujo' + (id === 'revisar' && n > 0 ? ' pide' : '') + '" data-ir="' + ir + '">' +
      '<span class="paso-cab">' + ico(icono) + '<span class="paso-num dato">' + (i + 1) + '</span></span>' +
      '<b data-contar="' + id + '">' + n + '</b>' +
      '<span class="paso-nombre">' + nombre + '</span>' +
      '<span class="paso-unidad">' + unidad + '</span>' +
    '</button>').join('') + '</div>';
}

/** La tarjeta grande: que te toca ahora. */
function pintarSiguienteNuevo(o) {
  let titulo, sub, boton;
  if (o.ia && o.ia.pausada) {
    titulo = textoIA(o.ia);
    sub = o.ia.estado === 'sin_sesion'
      ? 'En el ordenador que procesa, abre Claude Code y escribe /login. Después pulsa Reintentar.'
      : 'Lo que necesita la IA espera; el resto sigue funcionando.';
    boton = '<button class="act go" data-ia-reintentar="1">' + ico('reintentar') + 'Reintentar</button>';
  } else if (o.clips.pending > 0) {
    titulo = o.clips.pending === 1 ? '1 clip espera tu revisión' : o.clips.pending + ' clips esperan tu revisión';
    sub = 'Aprueba los que valgan y descarta el resto. Es lo único que no hace el programa solo.';
    boton = '<button class="act go" data-ir="clips">' + ico('revisar') + 'Revisar ahora</button>';
  } else if (o.sources.length === 0) {
    titulo = 'Añade un video para empezar';
    sub = 'Pega un enlace de YouTube o sube un MP4. El programa hace el resto.';
    boton = '<button class="act go" data-ir="videos">' + ico('mas') + 'Añadir video</button>';
  } else {
    const p = siguientePaso(o);
    titulo = p.texto;
    sub = p.sub;
    boton = p.accion
      ? '<button class="act go" ' + (p.accion.vista ? 'data-ir="' + p.accion.vista + '"'
          : 'data-run="' + p.accion.kind + '"' + (p.accion.source ? ' data-source="' + esc(p.accion.source) + '"' : '')) +
        '>' + p.accion.label + '</button>'
      : '';
  }
  return '<article class="card siguiente paso-1"><div class="body">' +
    '<p class="ante">Siguiente paso</p>' +
    '<h2>' + esc(titulo) + '</h2>' +
    '<p class="reason">' + esc(sub) + '</p>' +
    (boton ? '<div class="actions">' + boton + '</div>' : '') +
  '</div></article>';
}

/** Procesador, IA y TikTok, de un vistazo. */
function pintarSistema(o) {
  const t = o.trabajador;
  const plats = (o.plataformas ?? []).filter(p => p.estado !== 'no-disponible');
  const tiktok = plats.find(p => /tiktok/i.test(p.nombre || ''));
  const filas = [
    ['procesador', 'Procesador',
      t && t.vivo ? 'conectado' : t && t.vistoEn ? 'desconectado desde ' + hace(t.vistoEn) : 'sin conectar',
      t && t.vivo ? '' : 'apagado'],
    ['ia', 'IA', o.ia ? textoIA(o.ia).replace(/^IA /, '') : 'sin comprobar',
      !o.ia || o.ia.estado === 'lista' ? '' : o.ia.pausada ? 'apagado' : 'espera'],
    ['movil', 'TikTok', tiktok ? (tiktok.estado === 'conectado' ? 'conectado' : 'sin conectar') : 'sin conectar',
      tiktok && tiktok.estado === 'conectado' ? '' : 'espera'],
  ];
  return '<article class="card sistema"><div class="body">' +
    '<p class="ante">Estado del sistema</p>' +
    '<ul class="estado-lista">' + filas.map(([i, nombre, texto, clase]) =>
      '<li>' + ico(i) + '<span class="estado-nombre">' + nombre + '</span>' +
      '<span class="estado-texto">' + esc(texto) + '</span>' +
      '<span class="vivo-punto ' + clase + '" role="img" aria-label="' + (clase === '' ? 'Bien' : clase === 'apagado' ? 'Mal' : 'Atención') + '"></span></li>'
    ).join('') + '</ul>' +
    '<button class="chip" data-ir="registro">Probar el sistema</button>' +
  '</div></article>';
}

/** Lo ultimo que termino, en una lista corta. */
function pintarActividad() {
  const hechas = state.jobs.filter(j => j.status === 'ok' && j.endedAt).slice(0, 5);
  return '<article class="card"><div class="body">' +
    '<p class="ante">Actividad reciente</p>' +
    (hechas.length === 0
      ? '<p class="reason" style="margin:0">Todavía no ha terminado nada.</p>'
      : '<ul class="actividad">' + hechas.map(j =>
          '<li>' + ico('hecho') + '<span>' + esc(nombreTarea(j)) + '</span><time>' + hace(j.endedAt) + '</time></li>'
        ).join('') + '</ul>') +
  '</div></article>';
}

/** El nombre de una tarea como se dice en el panel. */
function nombreTarea(j) {
  const etiquetas = {
    ingest: 'Video descargado y transcrito', select: 'Momentos encontrados', momentos: 'Estribillos encontrados',
    render: 'Clips armados', subir: 'Clips listos para revisar', variants: 'Copias por cuenta hechas',
    schedule: 'Salidas repartidas en la agenda', publish: 'Clips publicados', metrics: 'Resultados actualizados',
    'probar-ia': 'IA probada', doctor: 'Sistema probado',
  };
  return etiquetas[j.kind] || j.label;
}


/*
 * El procesador lleva mas de cinco minutos sin dar señales.
 *
 * Un minuto puede ser un reinicio o una red que va y viene; cinco ya es que
 * el PC esta apagado o el trabajador no esta corriendo, y lo que se añada no
 * va a avanzar hasta que alguien lo arregle.
 */
function pintarAvisoProcesador(o) {
  const t = o.trabajador;
  if (!t || t.vivo) return '';
  const minutos = t.vistoEn ? (Date.now() - new Date(t.vistoEn).getTime()) / 60000 : Infinity;
  if (minutos < 5) return '';
  return '<article class="card"><div class="body"><div class="warn" style="margin:0">' +
    '<b>El procesador está desconectado' + (t.vistoEn ? ' desde ' + hace(t.vistoEn) : '') + '.</b> ' +
    'Lo que añadas espera hasta que se conecte. Comprueba que el ordenador que procesa esté encendido ' +
    'y con el trabajador en marcha.' +
  '</div></div></article>';
}

/** Hora corta (HH:MM) de una fecha. */
function horaCortaDe(iso) {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/*
 * Ajustes, Sistema: el procesador.
 *
 * Si esta conectado, que version de yt-dlp tiene, cuanto disco queda y que
 * se borra solo. Las cookies y los dias de retencion solo los cambia un
 * administrador (el servidor lo comprueba igual).
 */
function pintarProcesador(d) {
  if (!d) return '';
  const admin = !state.yo || state.yo.rol === 'admin';
  const t = d.trabajador || {};
  const ytdlp = (d.estado.ytdlp && d.estado.ytdlp.valor) || null;
  const disco = (d.estado.disco && d.estado.disco.valor) || null;
  const ret = (d.estado.retencion && d.estado.retencion.valor) || null;
  const resp = d.estado.respaldo || null;
  const usado = disco ? Math.round(disco.usado * 100) : null;
  const nombres = { '': 'Ninguno', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi', chromium: 'Chromium' };

  return '<article class="card procesador-card"><div class="body">' +
    '<p class="ante">Procesador</p>' +
    '<ul class="estado-lista">' +
      '<li>' + ico('procesador') + '<span class="estado-nombre">Conexión</span>' +
        '<span class="estado-texto">' + (t.vivo ? 'conectado' : t.vistoEn ? 'desconectado desde ' + hace(t.vistoEn) : 'nunca se ha conectado') + '</span>' +
        '<span class="vivo-punto' + (t.vivo ? '' : ' apagado') + '"></span></li>' +
      '<li>' + ico('videos') + '<span class="estado-nombre">yt-dlp</span>' +
        '<span class="estado-texto">' + (ytdlp
          ? (ytdlp.version ? '<span class="dato">' + esc(ytdlp.version) + '</span>' : '') +
            (ytdlp.dias !== null && ytdlp.dias !== undefined ? ' · hace ' + plural(ytdlp.dias, 'día') : '') +
            (ytdlp.mensaje ? esc(ytdlp.mensaje) : '') +
            (ytdlp.actualizacion ? '<br><span class="reason">' + esc(ytdlp.actualizacion) + '</span>' : '')
          : 'se comprueba una vez por semana') + '</span>' +
        '<span class="vivo-punto' + (!ytdlp || ytdlp.ok ? '' : ' espera') + '"></span></li>' +
      // Fase 8: el respaldo diario de la base.
      '<li>' + ico('hecho') + '<span class="estado-nombre">Respaldo</span>' +
        '<span class="estado-texto">' + (resp
          ? hace(resp.actualizadoEn) + ' · ' + plural(resp.valor.filas, 'fila') + ' · ' + resp.valor.kb + ' KB' +
            (resp.valor.nube ? ' · con copia en la nube' : ' · solo en el procesador')
          : 'todavía ninguno: lo hace el procesador una vez al día') + '</span>' +
        '<span class="vivo-punto' + (resp && Date.now() - new Date(resp.actualizadoEn).getTime() < 2 * 86400000 ? '' : ' espera') + '"></span></li>' +
      '<li>' + ico('actividad') + '<span class="estado-nombre">Disco</span>' +
        '<span class="estado-texto">' + (disco
          ? usado + ' % usado · ' + disco.libreGb + ' GB libres'
          : 'sin medir todavía') + '</span>' +
        '<span class="vivo-punto' + (usado !== null && usado >= 80 ? ' apagado' : '') + '"></span></li>' +
    '</ul>' +
    (usado !== null && usado >= 80
      ? '<p class="warn" style="margin:0 0 var(--s3)">El disco del procesador pasa del 80 %. ' +
        'Activa la limpieza de abajo o libera espacio antes de añadir más videos.</p>'
      : '') +
    '<div class="field"><label for="retencion">Borrar el video original revisado tras</label>' +
      '<div class="fila-input"><input id="retencion" type="number" min="0" max="365" step="1" value="' +
        d.ajustes.retencionDias + '"' + (admin ? '' : ' disabled') + '>' +
        '<span class="unidad">días</span>' +
        (admin ? '<button class="chip" data-sistema-guardar="retencion">Guardar</button>' : '') +
      '</div>' +
      '<p class="reason" style="margin:var(--s2) 0 0">0 = no borrar nunca. Solo se borra el video largo ' +
        'y los clips descartados; el texto y los clips aprobados se quedan.' +
        (ret && ret.mb ? ' Última limpieza: ' + ret.mb + ' MB liberados.' : '') + '</p>' +
    '</div>' +
    '<div class="field"><label for="cookies-ytdlp">Cookies del navegador para YouTube</label>' +
      '<select id="cookies-ytdlp" data-sistema="ytdlpCookies"' + (admin ? '' : ' disabled') + '>' +
        d.navegadores.map(n => '<option value="' + n + '"' + (n === d.ajustes.ytdlpCookies ? ' selected' : '') + '>' +
          (nombres[n] || n) + '</option>').join('') +
      '</select>' +
      '<p class="reason" style="margin:var(--s2) 0 0">Solo si YouTube pide confirmar que no eres un bot. ' +
        'yt-dlp usará la sesión de ese navegador en el ordenador que procesa; ciérralo antes de descargar.</p>' +
    '</div>' +
  '</div></article>';
}

/**
 * Las alertas (Fase 7): a donde llegan, si estan encendidas y las ultimas.
 *
 * Los destinos se ponen en el .env del panel, no aqui: son claves.
 */
/** Quien hizo que (Fase 8). Plegado: se consulta, no se mira a diario. */
function pintarAuditoria(d) {
  if (!d || !d.registro) return '';
  return '<article class="card"><div class="body">' +
    '<details class="nota"><summary>Registro de cambios: quién aprobó, publicó o cambió qué</summary>' +
      (d.registro.length === 0
        ? '<p class="reason">Todavía no hay nada anotado.</p>'
        : '<ul class="lista-alertas">' + d.registro.map(r =>
            '<li><b>' + esc(r.quien) + '</b> ' + esc(r.accion) + ' · ' + esc(hace(r.en)) +
              (r.estado >= 400 ? ' · <span class="badge error">rechazado</span>' : '') +
            '</li>').join('') + '</ul>') +
    '</details>' +
  '</div></article>';
}

function pintarAlertas(d) {
  if (!d || !d.alertas) return '';
  const a = d.alertas;
  const admin = !state.yo || state.yo.rol === 'admin';
  const destinos = [a.canales.telegram ? 'Telegram' : '', a.canales.correo ? 'correo' : ''].filter(Boolean);
  const NOMBRE = { token: 'Permiso de cuenta', cola: 'Agenda vacía', publicacion: 'Publicación fallida',
    procesador: 'Procesador', ia: 'IA', prueba: 'Prueba' };
  return '<article class="card"><div class="body">' +
    '<p class="ante">Alertas</p>' +
    '<p class="reason" style="margin:0 0 var(--s3)">' +
      'Avisa cuando falla el permiso de una cuenta, se vacía la agenda, falla una publicación, ' +
      'se desconecta el procesador o la IA llega al límite. La misma alerta no se repite en el día.</p>' +
    '<ul class="estado-lista">' +
      '<li>' + ico('alerta') + '<span class="estado-nombre">Destino</span>' +
        '<span class="estado-texto">' + (destinos.length
          ? destinos.join(' y ')
          : 'ninguno: añade TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID al .env del panel') + '</span>' +
        '<span class="vivo-punto' + (destinos.length ? '' : ' apagado') + '"></span></li>' +
    '</ul>' +
    (admin
      ? '<div class="chips">' +
          '<button class="chip" data-alertas-activas="' + (a.activas ? '0' : '1') + '">' +
            (a.activas ? 'Apagar las alertas' : 'Encender las alertas') + '</button>' +
          (destinos.length ? '<button class="chip primario" data-alertas-probar>Enviar una prueba</button>' : '') +
        '</div>'
      : '') +
    (a.ultimas.length
      ? '<details class="nota" style="margin-top:var(--s3)"><summary>Últimas alertas</summary><ul class="lista-alertas">' +
          a.ultimas.map(x => '<li><b>' + esc(NOMBRE[x.tipo] || x.tipo) + '</b> · ' + esc(hace(x.enviadaEn)) +
            (x.canales ? '' : ' · <span class="reason" style="margin:0">no salió: sin destino</span>') +
            '<br><span class="reason" style="margin:0">' + esc(x.texto) + '</span></li>').join('') +
        '</ul></details>'
      : '') +
  '</div></article>';
}

document.addEventListener('click', async e => {
  const activar = e.target.closest('[data-alertas-activas]');
  if (activar) {
    try {
      state.sistema.alertas = await api('/api/sistema/alertas', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activas: activar.dataset.alertasActivas === '1' }),
      });
      render();
    } catch (err) { alert(err.message); }
    return;
  }
  const probar = e.target.closest('[data-alertas-probar]');
  if (probar) {
    probar.disabled = true;
    try {
      const r = await api('/api/sistema/alertas/probar', { method: 'POST' });
      state.sistema.alertas = r;
      const mal = r.resultados.filter(x => !x.ok);
      avisar(mal.length === 0 ? 'Alerta de prueba enviada.' : mal.map(x => x.detalle).join(' '));
      render();
    } catch (err) {
      probar.disabled = false;
      alert(err.message);
    }
  }
});

async function guardarSistema(cambios) {
  try {
    await api('/api/sistema', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cambios),
    });
    avisar('Guardado.');
  } catch (err) {
    avisar(err.message);
  }
  refrescar();
}

document.addEventListener('change', e => {
  if (e.target.matches && e.target.matches('[data-sistema="ytdlpCookies"]')) guardarSistema({ ytdlpCookies: e.target.value });
});
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-sistema-guardar="retencion"]');
  if (!b) return;
  guardarSistema({ retencionDias: Number(document.getElementById('retencion').value) });
});

function vistaProceso() {
  const o = state.overview;
  if (!o) return esqueleto(2, true);

  const fallos = agruparFallos(state.jobs).slice(0, 3);
  // Con la IA en pausa, eso YA es el siguiente paso: no se repite abajo.
  const avisos = pintarAvisoProcesador(o) + (o.ia && o.ia.pausada ? '' : pintarAvisoIA(o.ia)) + fallos.map(pintarGrupoFallo).join('');

  return pintarFlujo(o) +
    '<div class="rejilla-inicio">' +
      '<div class="col-principal">' +
        pintarSiguienteNuevo(o) +
        (avisos ? '<section aria-label="Avisos"><p class="ante">Avisos</p>' + avisos + '</section>' : '') +
        pintarActividad() +
      '</div>' +
      '<div class="col-lateral">' +
        pintarSistema(o) +
        bloqueAnadir(o, true) +
        pintarNube(o) +
      '</div>' +
    '</div>';
}

/*
 * Numeros que cuentan al cambiar.
 *
 * Solo cuando el numero CAMBIA respecto a lo ultimo pintado: contar en cada
 * repintado (llega un aviso del servidor varias veces por minuto) convertiria
 * la señal en ruido. Con movimiento reducido se pone el valor sin mas.
 */
function animarCifras() {
  state.cifras = state.cifras || {};
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const el of document.querySelectorAll('[data-contar]')) {
    const clave = el.dataset.contar;
    const fin = Number(el.textContent) || 0;
    const ini = state.cifras[clave];
    state.cifras[clave] = fin;
    if (ini === undefined || ini === fin || quieto) continue;
    const t0 = performance.now();
    const dura = 450;
    const paso = (t) => {
      const k = Math.min(1, (t - t0) / dura);
      const suave = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(ini + (fin - ini) * suave));
      if (k < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
}

/** Estado del procesador en el menu. */
function pintarEstadoMenu() {
  const el = document.getElementById('nav-estado');
  const t = state.overview && state.overview.trabajador;
  if (!el || !t) return;
  el.innerHTML = '<div class="fila-estado"><span class="vivo-punto' + (t.vivo ? '' : ' apagado') + '"></span>' +
    (t.vivo ? 'Procesador conectado' : 'Procesador desconectado') + '</div>' +
    (!t.vivo && t.vistoEn ? '<span class="reason" style="margin:0">Visto ' + hace(t.vistoEn) + '</span>' : '');
}

/**
 * Los fallos, agrupados por paso y video.
 *
 * El mismo paso del mismo video fallando cuatro veces eran cuatro tarjetas
 * identicas (hubo un video con 28 intentos de "Elegir momentos"). Ahora es una
 * sola, con el contador, y con lo unico que se puede hacer: reintentar una vez
 * o quitarla de en medio.
 */
function agruparFallos(jobs) {
  const grupos = new Map();
  for (const j of jobs) {
    if (j.status !== 'error') continue;
    const clave = j.kind + '|' + (j.args || []).join('|');
    const g = grupos.get(clave);
    if (g) g.ids.push(j.id);
    else grupos.set(clave, { ultimo: j, ids: [j.id] });
  }
  return [...grupos.values()];
}

/**
 * Un fallo en palabras de persona (Fase 8, regla 6).
 *
 * El historial guarda el error tal cual (salida de yt-dlp, ffmpeg, la API), y
 * eso no se enseña a la vista: va plegado en "Ver detalles". Aqui se traducen
 * los fallos conocidos a que paso y que hacer. Un texto que ya es una frase
 * en castellano, sin restos tecnicos, se deja como esta.
 */
function fraseFallo(texto) {
  const t = String(texto || '');
  if (t === '') return 'Falló sin dar motivo. Mira el registro del procesador.';
  if (/HTTP Error 403|Forbidden|Sign in to confirm|not a bot/i.test(t)) {
    return 'YouTube bloqueó la descarga. Sube el MP4 directamente o activa las cookies del navegador en Sistema.';
  }
  if (/HTTP Error 404|Video unavailable|Private video|has been removed/i.test(t)) {
    return 'Ese video ya no está disponible en YouTube (borrado o privado).';
  }
  if (/Not logged in|\\/login|sin sesi/i.test(t)) {
    return 'La IA no tiene la sesión iniciada en el procesador: abre Claude Code allí y escribe /login.';
  }
  if (/credit balance|x-api-key|invalid_api_key|authentication_error|401/i.test(t)) {
    return 'La IA rechazó la clave o se quedó sin saldo. Revisa la configuración de la IA.';
  }
  if (/usage limit|rate.?limit|429|l[ií]mite/i.test(t)) {
    return 'La IA llegó a su límite de uso. Se reintenta sola cuando vuelva.';
  }
  if (/nvenc|driver/i.test(t)) {
    return 'La tarjeta gráfica no pudo codificar el clip. Actualiza el driver de NVIDIA del procesador.';
  }
  if (/ENOENT|no est[aá] instalado|not recognized|no se reconoce/i.test(t)) {
    return 'Falta un programa en el procesador. Ejecuta npm run check-health allí para ver cuál.';
  }
  if (/ETIMEDOUT|timed? ?out|tard[oó] demasiado/i.test(t)) {
    return 'Tardó demasiado y se cortó. Vuelve a intentarlo.';
  }
  if (/ECONN|fetch failed|network|socket hang up/i.test(t)) {
    return 'Se cortó la conexión a mitad. Vuelve a intentarlo.';
  }
  if (/ffmpeg/i.test(t)) return 'Falló ffmpeg al procesar el video. Los detalles dicen en qué punto.';
  const tecnico = /stderr|stdout|\\bat [\\w.<>]+ \\(|Error:|ERROR|Exception|errno|exit code|c[oó]digo \\d+/.test(t);
  return tecnico ? 'Falló. El detalle técnico está en "Ver detalles".' : t;
}

function pintarGrupoFallo(g) {
  const j = g.ultimo;
  const abierto = state.openLog === j.id;
  const n = g.ids.length;
  return '<article class="card job error"><div class="body">' +
    '<div class="joghead">' +
      '<span class="jobname">' + esc(j.label) + '</span>' +
      '<span class="badge bad">' + (n > 1 ? 'falló ' + n + ' veces' : 'falló') + '</span>' +
    '</div>' +
    (j.lastLine ? '<div class="jobline">' + esc(j.lastLine) + '</div>' : '') +
    '<div class="actions" style="margin-top:10px">' +
      '<button class="chip" data-grupo-reintentar="' + esc(g.ids.join(',')) + '">Reintentar</button>' +
      '<button class="chip" data-grupo-descartar="' + esc(g.ids.join(',')) + '">Descartar</button>' +
      '<button class="chip" data-log="' + j.id + '">' + (abierto ? 'Ocultar detalles' : 'Ver detalles') + '</button>' +
    '</div>' +
    (abierto
      ? '<div class="log" id="log-' + j.id + '"><div class="hueso medio"></div><div class="hueso"></div></div>'
      : '') +
  '</div></article>';
}

/**
 * Un solo aviso de la IA en Inicio, y solo cuando hace falta.
 *
 * Sin sesion o con limite, la cola de IA se pausa y las tareas esperan. Antes
 * cada una fallaba por su cuenta y el panel se llenaba de tarjetas iguales que
 * mandaban a editar el .env. Ahora es una frase, que hacer, y un boton.
 */
/*
 * La frase del estado, con la hora en la del navegador.
 *
 * El servidor ya manda una frase, pero el panel vive en Hostinger y su reloj
 * no tiene por que estar en la zona de quien mira: "vuelve a las 02:56" en UTC
 * seria una hora equivocada. Solo esa frase se rehace aqui.
 */
function textoIA(ia) {
  if (ia.estado === 'limite' && ia.reanudarEn) {
    return 'IA con límite, vuelve a las ' +
      new Date(ia.reanudarEn).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return ia.texto;
}

function pintarAvisoIA(ia) {
  if (!ia || (!ia.pausada && !ia.enEspera)) return '';
  // Con hora de vuelta, lo que espera sigue solo; sin ella, hace falta el boton.
  const sola = ia.estado === 'limite' && ia.reanudarEn;
  const espera = ia.enEspera > 0
    ? ' ' + (ia.enEspera === 1 ? '1 tarea espera' : ia.enEspera + ' tareas esperan') +
      (sola ? ' y ' + (ia.enEspera === 1 ? 'seguirá sola.' : 'seguirán solas.') : '. Pulsa "Reintentar" cuando esté arreglado.')
    : '';
  return '<article class="card"><div class="body"><div class="warn" style="margin:0">' +
    '<b>' + esc(textoIA(ia)) + '.</b>' + espera +
    '<div class="actions" style="margin-top:10px">' +
      '<button class="chip" data-ia-reintentar="1">Reintentar</button>' +
      '<button class="chip" data-ir="ia">Ver la IA</button>' +
    '</div>' +
  '</div></div></article>';
}

// --- Vista: usuarios --------------------------------------------------------

/**
 * Quien entra al panel. Solo la ve un administrador.
 *
 * No hay registro publico: las cuentas se crean aqui. La contraseña que se
 * pone es provisional y la persona la cambia al entrar. Si alguien la olvida,
 * se le pone otra nueva desde su fila: es la recuperacion mientras no haya
 * correo configurado.
 */
function vistaUsuarios() {
  const d = state.usuarios;
  if (!d) return esqueleto(2, false);
  const yo = state.yo && state.yo.email;

  let html = '<article class="card"><div class="body">' +
    '<p class="hook" style="margin-top:0">Añadir una persona</p>' +
    '<form id="usuario-nuevo" class="usuario-form" style="display:grid;gap:10px">' +
      '<input name="email" type="email" required placeholder="Correo" aria-label="Correo" autocomplete="off">' +
      '<input name="nombre" placeholder="Nombre (opcional)" aria-label="Nombre">' +
      '<select name="rol" aria-label="Rol">' +
        '<option value="operador">Operador: revisa, aprueba y ve la agenda</option>' +
        '<option value="admin">Administrador: todo, también la configuración</option>' +
      '</select>' +
      '<input name="contrasena" type="password" required minlength="10" autocomplete="new-password" ' +
        'placeholder="Contraseña provisional (mínimo 10)" aria-label="Contraseña provisional">' +
      '<button class="act go" type="submit">Crear</button>' +
    '</form>' +
    '<p class="reason" style="margin:var(--s3) 0 0">Dale la contraseña en persona o por un canal seguro. ' +
      'Al entrar, el panel le pedirá que elija la suya.</p>' +
  '</div></article>';

  html += seccion('&#9776;', d.usuarios.length === 1 ? '1 persona' : d.usuarios.length + ' personas', '') +
    d.usuarios.map(u => {
      const soyYo = u.email === yo;
      return '<article class="card"><div class="body">' +
        '<div class="joghead">' +
          '<span class="jobname">' + esc(u.nombre || u.email) + (soyYo ? ' (tú)' : '') + '</span>' +
          '<span class="badge' + (u.activo ? '' : ' bad') + '">' +
            (u.activo ? (u.rol === 'admin' ? 'administrador' : 'operador') : 'sin acceso') + '</span>' +
        '</div>' +
        '<p class="reason" style="margin:var(--s2) 0 0">' + esc(u.email) +
          (u.ultimoAcceso ? ' · entró por última vez ' + fecha(u.ultimoAcceso) : ' · todavía no ha entrado') +
          (u.debeCambiar ? ' · tiene contraseña provisional' : '') + '</p>' +
        (soyYo
          ? '<div class="actions" style="margin-top:10px"><a class="chip" href="/cuenta/contrasena">Cambiar mi contraseña</a></div>'
          : '<div class="actions" style="margin-top:10px">' +
              '<button class="chip" data-usuario="' + u.id + '" data-cambio="rol" data-valor="' +
                (u.rol === 'admin' ? 'operador' : 'admin') + '">' +
                (u.rol === 'admin' ? 'Pasar a operador' : 'Hacer administrador') + '</button>' +
              '<button class="chip" data-usuario="' + u.id + '" data-cambio="activo" data-valor="' + (!u.activo) + '">' +
                (u.activo ? 'Quitar acceso' : 'Devolver acceso') + '</button>' +
            '</div>' +
            '<details style="margin-top:10px"><summary class="reason">Ponerle una contraseña nueva</summary>' +
              '<form class="usuario-clave" data-usuario="' + u.id + '" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
                '<input name="contrasena" type="password" required minlength="10" autocomplete="new-password" ' +
                  'placeholder="Nueva, mínimo 10" aria-label="Contraseña nueva" style="flex:1;min-width:180px">' +
                '<button class="chip" type="submit">Guardar</button>' +
              '</form>' +
            '</details>') +
      '</div></article>';
    }).join('');

  return html;
}

// --- Vista: IA ------------------------------------------------------------

function vistaIA() {
  const ia = state.ia;
  if (!ia) return esqueleto(1, false);

  const probando = state.jobs.find(j => j.kind === 'probar-ia' && vivo(j));
  const ok = ia.estado === 'lista';
  const chip = ok ? 'ok' : ia.estado === 'desconocido' ? '' : 'bad';
  const nombre = {
    'claude-cli': 'Claude Code, con tu suscripción',
    'anthropic-api': 'API de Anthropic',
    'ollama': 'Modelo local',
  }[ia.proveedor] || 'Claude Code, con tu suscripción';

  let html = '<article class="card hero paso-1"><div class="body">' +
    '<div class="joghead">' +
      '<span class="jobname">' + esc(textoIA(ia)) + '</span>' +
      '<span class="badge ' + chip + '">' + (ok ? 'lista' : ia.estado === 'desconocido' ? 'sin comprobar' : 'no disponible') + '</span>' +
    '</div>' +
    (ia.mensaje && !ok ? '<p class="reason" style="margin:var(--s3) 0 0">' + esc(ia.mensaje) + '</p>' : '') +
    '<div style="margin-top:var(--s3);font-size:var(--t-meta);line-height:1.7">' +
      '<div><span style="color:var(--faint)">Proveedor</span>  ' + esc(nombre) + '</div>' +
      (ia.modelo ? '<div><span style="color:var(--faint)">Modelo</span>  ' + esc(ia.modelo) + '</div>' : '') +
      '<div><span style="color:var(--faint)">Coste</span>  ' + esc(ia.coste) + '</div>' +
      (ia.comprobadoEn ? '<div><span style="color:var(--faint)">Última comprobación</span>  ' + fecha(ia.comprobadoEn) + '</div>' : '') +
      (ia.enEspera > 0 ? '<div><span style="color:var(--faint)">Esperando</span>  ' + (ia.enEspera === 1 ? '1 tarea' : ia.enEspera + ' tareas') + '</div>' : '') +
    '</div>' +
    '<div class="actions" style="margin-top:var(--s4)">' +
      '<button class="act go" data-run="probar-ia"' + (probando ? ' disabled' : '') + '>' +
        (probando ? 'Probando…' : 'Probar IA') + '</button>' +
      (ia.pausada || ia.enEspera > 0 ? '<button class="chip" data-ia-reintentar="1">Reintentar</button>' : '') +
    '</div>' +
  '</div></article>';

  html += '<details class="nota"><summary>Si dice que no hay sesión</summary>' +
    '<p>La IA corre en el ordenador que procesa los videos. Ahí, abre Claude Code, ' +
    'escribe /login y entra con tu cuenta. Después pulsa "Probar IA".</p>' +
    '<p>"Probar IA" hace una pregunta mínima desde ese ordenador. Si está apagado, ' +
    'la prueba espera a que se encienda.</p>' +
  '</details>';

  return html;
}

// --- Vista: clips ---------------------------------------------------------

function renderTabs() {
  if (state.view !== 'clips') { document.getElementById('tabs').innerHTML = ''; return; }
  const tabs = [
    ['pending', 'Pendientes'],
    ['approved', 'Aprobados'],
    ['rejected', 'Descartados'],
  ];
  document.getElementById('tabs').innerHTML = tabs.map(([key, label]) =>
    '<button class="tab" role="tab" aria-selected="' + (state.filter === key) + '" data-filter="' + key + '">' +
    '<b>' + (state.counts[key] ?? 0) + '</b>' + label + '</button>'
  ).join('');
}

/*
 * FASE 3: Revisar en tres zonas.
 *
 * A la izquierda la cola, en el centro el clip en vertical y a la derecha lo
 * que hay que decidir. Antes era una rejilla de tarjetas enormes, cada una con
 * su video y sus campos: para decidir el clip diez habia que bajar nueve
 * pantallas.
 *
 * Los elementos de la cola son los ".card[data-clip]" de ".lista-clips", asi
 * que la seleccion en lote, la barra de lote y las flechas siguen funcionando
 * como antes. El clip abierto es el de state.foco. El detalle es OTRA
 * ".card" con los mismos datos, y es la que lleva la descripcion, las
 * etiquetas y el corte: decide() la lee de ahi.
 */
function itemCola(c, i) {
  const marcada = state.sel.has(llaveClip(c.sourceId, c.clipId));
  const activo = i === Math.min(state.foco, state.clips.length - 1);
  return '<div class="card item-clip' + (marcada ? ' elegida' : '') + (activo ? ' activo' : '') + '"' +
    ' data-source="' + esc(c.sourceId) + '" data-clip="' + esc(c.clipId) + '"' +
    ' data-start="' + c.start + '" data-end="' + c.end + '">' +
    '<label class="elegir"><input type="checkbox"' + (marcada ? ' checked' : '') +
      ' aria-label="Marcar ' + esc(c.clipId) + ' para decidir en lote"></label>' +
    '<button class="item-abrir" data-ver-clip="' + i + '"' + (activo ? ' aria-current="true"' : '') + '>' +
      '<span class="item-mini dato">' + c.durationSec + 's</span>' +
      '<span class="item-texto">' +
        '<span class="item-titulo">' + esc(c.hook) + '</span>' +
        '<span class="item-meta dato">' + fmt(c.start) + ' · ' + esc(c.clipId) + '</span>' +
      '</span>' +
      '<span class="puntaje' + (c.score >= 60 ? ' alto' : '') + ' dato" title="Puntaje">' + c.score + '</span>' +
    '</button>' +
  '</div>';
}

/** Gancho, cierre y retencion, cuando la IA los dio. */
function desglosePuntaje(c) {
  if (!c.puntajes) return '';
  const filas = [['Gancho', c.puntajes.gancho], ['Cierre', c.puntajes.cierre], ['Retención', c.puntajes.retencion]];
  return '<ul class="desglose">' + filas.map(([n, v]) =>
    '<li><span>' + n + '</span><span class="desglose-barra"><i style="width:' + Math.max(0, Math.min(100, v)) + '%"></i></span>' +
    '<b class="dato">' + v + '</b></li>').join('') + '</ul>';
}

/*
 * La linea de tiempo del corte: 30 s antes y despues del clip, con dos
 * deslizadores que mueven el inicio y el fin. Los campos numericos y los
 * botones "Empieza aqui" siguen debajo, y los tres caminos se sincronizan.
 */
function lineaCorte(c) {
  const min = Math.max(0, Math.floor(c.start - 30));
  const max = Math.ceil(c.end + 30);
  const pct = (v) => ((v - min) / (max - min) * 100).toFixed(2);
  return '<div class="linea-tiempo" data-min="' + min + '" data-max="' + max + '">' +
    '<div class="linea-pista"><span class="linea-sel" style="left:' + pct(c.start) + '%;right:' + (100 - Number(pct(c.end))).toFixed(2) + '%"></span></div>' +
    '<input type="range" class="rango-ini" min="' + min + '" max="' + max + '" step="0.1" value="' + c.start + '" aria-label="Inicio del clip">' +
    '<input type="range" class="rango-fin" min="' + min + '" max="' + max + '" step="0.1" value="' + c.end + '" aria-label="Fin del clip">' +
    '<div class="linea-marcas dato"><span>' + fmt(min) + '</span><span>' + fmt(max) + '</span></div>' +
  '</div>';
}

/*
 * Editar el texto de los subtitulos de ESTE clip.
 *
 * Parte de lo editado si lo hay, o de la transcripcion. Guardar vuelve a
 * armar solo este clip; "originales" descarta lo editado.
 */
function editorSubtitulos(c) {
  const lineas = (c.subtitulos && c.subtitulos.length ? c.subtitulos : (c.segmentos || []));
  if (lineas.length === 0) return '';
  return '<details class="corte editor-subs">' +
    '<summary>Editar subtítulos' + (c.subtitulos ? ' <span class="estado-chip info">editados</span>' : '') + '</summary>' +
    '<ol class="lineas-sub">' + lineas.map((l, i) =>
      '<li data-start="' + l.start + '" data-end="' + l.end + '">' +
        '<span class="dato">' + fmt(l.start) + '</span>' +
        '<input class="linea-sub" value="' + esc(l.text) + '" aria-label="Subtítulo ' + (i + 1) + '">' +
      '</li>').join('') + '</ol>' +
    '<div class="chips">' +
      (c.subtitulos ? '<button class="chip" data-subs-originales>Volver a los originales</button>' : '') +
      '<button class="chip primario" data-subs-guardar>Guardar y volver a armar</button>' +
    '</div>' +
  '</details>';
}

async function editarClip(card, cuerpo, aviso) {
  try {
    const r = await api('/api/clips/' + encodeURIComponent(card.dataset.source) + '/' + encodeURIComponent(card.dataset.clip) + '/editar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    avisar(aviso + (cuerpo.rearmar ? (r.encolada ? ' Se vuelve a armar el clip.' : ' Ya se estaba armando; espera a que termine.') : ''));
    refrescar();
  } catch (err) {
    avisar(err.message);
  }
}

document.addEventListener('click', e => {
  const card = e.target.closest && e.target.closest('.detalle-clip');
  if (!card) return;
  if (e.target.closest('[data-enlace-descarga]')) {
    api('/api/clips/' + encodeURIComponent(card.dataset.source) + '/' + encodeURIComponent(card.dataset.clip) + '/enlace', { method: 'POST' })
      .then(r => {
        const enlace = location.origin + r.ruta;
        const copiado = navigator.clipboard ? navigator.clipboard.writeText(enlace) : Promise.reject(new Error('sin portapapeles'));
        return copiado
          .then(() => avisar('Enlace copiado. Caduca en ' + r.horas + ' horas.'))
          .catch(() => { prompt('Copia el enlace (caduca en ' + r.horas + ' horas):', enlace); });
      })
      .catch(err => avisar(err.message));
    return;
  }
  if (e.target.closest('[data-guardar-titulo]')) {
    const titulo = card.querySelector('.titulo-clip').value.trim();
    if (titulo.split(/\\s+/).filter(Boolean).length > 8) { avisar('El título admite como mucho 8 palabras.'); return; }
    editarClip(card, { titulo }, 'Título guardado.');
    return;
  }
  if (e.target.closest('[data-subs-guardar]')) {
    const subtitulos = [...card.querySelectorAll('.lineas-sub li')].map(li => ({
      start: Number(li.dataset.start), end: Number(li.dataset.end), text: li.querySelector('.linea-sub').value,
    }));
    editarClip(card, { subtitulos, rearmar: true }, 'Subtítulos guardados.');
    return;
  }
  if (e.target.closest('[data-subs-originales]')) {
    editarClip(card, { subtitulos: null, rearmar: true }, 'Se vuelven a usar los subtítulos originales.');
  }
});

// El titulo avisa al pasar de 8 palabras, mientras se escribe.
document.addEventListener('input', e => {
  if (e.target.classList && e.target.classList.contains('titulo-clip')) {
    const n = e.target.value.trim().split(/\\s+/).filter(Boolean).length;
    const aviso = e.target.closest('.field').querySelector('.titulo-aviso');
    if (aviso) aviso.textContent = n > 8 ? 'Sobran ' + (n - 8) + (n - 8 === 1 ? ' palabra.' : ' palabras.') : '';
    return;
  }
  // Los deslizadores mueven los campos del corte, y al reves.
  const r = e.target.closest && e.target.closest('.rango-ini, .rango-fin');
  const card = e.target.closest && e.target.closest('.detalle-clip');
  if (!card) return;
  const ini = card.querySelector('.corte-ini');
  const fin = card.querySelector('.corte-fin');
  if (r) {
    if (r.classList.contains('rango-ini')) ini.value = r.value; else fin.value = r.value;
  } else if (e.target === ini || e.target === fin) {
    const ri = card.querySelector('.rango-ini');
    const rf = card.querySelector('.rango-fin');
    if (ri) ri.value = ini.value;
    if (rf) rf.value = fin.value;
  } else {
    return;
  }
  const linea = card.querySelector('.linea-tiempo');
  if (linea) {
    const min = Number(linea.dataset.min);
    const max = Number(linea.dataset.max);
    const sel = linea.querySelector('.linea-sel');
    const a = Math.max(min, Math.min(Number(ini.value), max));
    const b = Math.max(min, Math.min(Number(fin.value), max));
    sel.style.left = ((a - min) / (max - min) * 100) + '%';
    sel.style.right = (100 - (b - min) / (max - min) * 100) + '%';
  }
  pintarCorte(card);
});

function detalleClip(c) {
  const over = c.caption.length > 150;
  const pendiente = state.filter === 'pending';
  return '<section class="card detalle-clip" aria-label="Detalle del clip"' +
    ' data-source="' + esc(c.sourceId) + '" data-clip="' + esc(c.clipId) + '"' +
    ' data-start="' + c.start + '" data-end="' + c.end + '"><div class="body">' +
    '<p class="ante">Clip <span class="dato">' + esc(c.clipId) + '</span></p>' +
    '<h2 class="detalle-titulo">' + esc(c.titulo || c.hook) + '</h2>' +
    (c.titulo ? '<p class="gancho-cita">«' + esc(c.hook) + '»</p>' : '') +
    '<div class="rango">' +
      '<span>' + ico('reloj') + '<span class="dato">' + fmt(c.start) + ' – ' + fmt(c.end) + '</span></span>' +
      '<span class="dato">' + c.durationSec + ' s</span>' +
      (c.durationSec > 60 ? '<span class="estado-chip aviso">Más de 60 s</span>' : '') +
    '</div>' +
    '<div class="puntaje-grande">' +
      '<div class="puntaje-cab"><span>Puntaje</span><b class="dato">' + c.score + '<small>/100</small></b></div>' +
      '<span class="puntaje-barra"><i style="width:' + Math.max(0, Math.min(100, c.score)) + '%"></i></span>' +
      desglosePuntaje(c) +
    '</div>' +
    (c.reason ? '<p class="motivo"><b>Por qué:</b> ' + esc(c.reason) + '</p>' : '') +
    '<div class="field">' +
      '<label for="titulo-' + esc(c.clipId) + '">Título (máximo 8 palabras)</label>' +
      '<div class="fila-input"><input id="titulo-' + esc(c.clipId) + '" class="titulo-clip" maxlength="90" value="' + esc(c.titulo || '') + '"' +
        ' placeholder="Un título corto, distinto de la primera frase">' +
        '<button class="chip" data-guardar-titulo>Guardar</button></div>' +
      '<p class="reason titulo-aviso" style="margin:6px 0 0"></p>' +
    '</div>' +
    // Fase 8: un enlace para pasar el clip a quien no tiene acceso al panel.
    '<div class="chips" style="margin-bottom:var(--s3)">' +
      '<button class="chip" data-enlace-descarga>' + ico('enlace') + 'Copiar enlace de descarga</button>' +
    '</div>' +
    '<div class="field">' +
      '<label for="caption-' + esc(c.clipId) + '">Descripción del clip</label>' +
      '<textarea id="caption-' + esc(c.clipId) + '" rows="3" class="caption">' + esc(c.caption) + '</textarea>' +
      '<div class="count' + (over ? ' over' : '') + '">' + c.caption.length + ' / 150</div>' +
    '</div>' +
    '<div class="field">' +
      '<label for="tags-' + esc(c.clipId) + '">Etiquetas</label>' +
      '<input id="tags-' + esc(c.clipId) + '" class="tags" value="' + esc(c.hashtags.join(', ')) + '">' +
    '</div>' +
    '<details class="corte">' +
      '<summary>Ajustar inicio y fin</summary>' +
      lineaCorte(c) +
      '<div class="corte-fila"><label>Empieza en' +
        '<input type="number" class="corte-ini" step="0.1" min="0" value="' + c.start + '"></label>' +
        '<button class="chip" data-marcar="ini">Empieza aquí</button></div>' +
      '<div class="corte-fila"><label>Acaba en' +
        '<input type="number" class="corte-fin" step="0.1" min="0" value="' + c.end + '"></label>' +
        '<button class="chip" data-marcar="fin">Acaba aquí</button></div>' +
      '<p class="corte-aviso">Sin cambios.</p>' +
      '<div class="chips">' +
        '<button class="chip" data-corte-reset>Dejarlo como estaba</button>' +
        '<button class="chip primario" data-rehacer disabled>Volver a armar este clip</button>' +
      '</div>' +
    '</details>' +
    editorSubtitulos(c) +
    '<div class="decidir">' +
      (pendiente
        ? '<button class="act reject" data-do="rejected">' + ico('cerrar') + 'Descartar <kbd>R</kbd></button>' +
          '<button class="act approve" data-do="approved">' + ico('hecho') + 'Aprobar y siguiente <kbd>A</kbd></button>'
        : '<button class="act undo" data-do="pending">' + ico('reintentar') + 'Devolver a pendientes</button>') +
    '</div>' +
    '<p class="atajos">' +
      '<kbd>↑</kbd><kbd>↓</kbd> cambiar de clip · <kbd>Espacio</kbd> reproducir · <kbd>X</kbd> marcar' +
    '</p>' +
  '</div></section>';
}

function reproductorClip(c) {
  return '<section class="reproductor" aria-label="Vista previa del clip">' +
    '<div class="marco-vertical">' +
      (c.hasFile
        ? '<video id="video-clip" controls playsinline preload="metadata" src="/video/' +
            encodeURIComponent(c.sourceId) + '/' + encodeURIComponent(c.clipId) + '"></video>'
        : '<div class="sin-video">' + ico('videos') +
            '<p>' + (c.masterPath
              ? 'Este clip está armado pero todavía no se subió para revisarlo.'
              : 'Falta el archivo de este clip.') + '</p></div>') +
    '</div>' +
  '</section>';
}

function vistaClips() {
  const labels = { pending: 'por revisar', approved: 'aprobado', rejected: 'descartado' };
  if (state.clips.length === 0) {
    const vacios = {
      pending: ['Todo revisado', 'No queda ningún clip esperando tu decisión.', ['videos', 'Añadir otro video']],
      approved: ['Aún no has aprobado nada', 'Los clips que apruebes aparecen aquí y pasan solos a la agenda.', null],
      rejected: ['Nada descartado', 'Los clips que descartes se guardan aquí por si cambias de idea.', null],
    };
    const [titulo, sub, accion] = vacios[state.filter] ?? ['Nada por aquí', 'No hay ningún clip ' + labels[state.filter] + '.', null];
    return '<div class="empty"><b>' + titulo + '</b>' + sub +
      (accion ? '<div class="actions" style="justify-content:center;margin-top:var(--s4)">' +
        '<button class="act go" data-ir="' + accion[0] + '">' + accion[1] + '</button></div>' : '') +
      '</div>';
  }

  if (state.foco >= state.clips.length) state.foco = state.clips.length - 1;
  if (state.foco < 0) state.foco = 0;
  const actual = state.clips[state.foco];

  const barra = '<div id="lote" class="lote" role="region" aria-label="Decidir varios" hidden>' +
    '<span class="cuantos"></span>' +
    '<button class="chip" data-marca>Marcar todos</button>' +
    '<span class="hueco"></span>' +
    '<button class="chip" data-lote="rejected">Descartar</button>' +
    '<button class="chip primario" data-lote="approved">Aprobar</button>' +
  '</div>';

  return '<div class="revisar">' +
    '<aside class="cola-revisar" aria-label="Cola de clips">' +
      '<p class="ante">' + plural(state.clips.length, 'clip') + ' ' +
        ({ pending: 'por revisar', approved: state.clips.length === 1 ? 'aprobado' : 'aprobados',
           rejected: state.clips.length === 1 ? 'descartado' : 'descartados' })[state.filter] + '</p>' +
      barra +
      '<div class="lista-clips">' + state.clips.map(itemCola).join('') + '</div>' +
    '</aside>' +
    reproductorClip(actual) +
    detalleClip(actual) +
  '</div>';
}

/** El detalle (con la descripcion y las etiquetas) del clip abierto. */
function detalleAbierto() {
  return document.querySelector('.detalle-clip');
}

/** Abre otro clip de la cola. */
function abrirClip(i, conTeclado) {
  if (state.clips.length === 0) return;
  state.foco = Math.min(state.clips.length - 1, Math.max(0, i));
  if (conTeclado !== undefined) state.conTeclado = conTeclado;
  render();
  const item = document.querySelectorAll('.lista-clips .item-clip')[state.foco];
  item?.scrollIntoView({ block: 'nearest', behavior: comoDesplazar() });
}

/*
 * Aprobar o descartar, con insignia, siguiente y "Deshacer" durante 5 s.
 *
 * La insignia confirma la decision antes de que llegue la respuesta. Al
 * refrescar, el clip decidido sale de la lista de pendientes y el mismo
 * indice pasa a ser el siguiente: "aprobar y siguiente" no necesita mas.
 */
async function decidirClip(status) {
  const card = detalleAbierto();
  if (!card || card.dataset.decidiendo) return;
  card.dataset.decidiendo = '1';
  const sourceId = card.dataset.source;
  const clipId = card.dataset.clip;
  const marco = document.querySelector('.marco-vertical');
  if (marco && status !== 'pending') {
    const insignia = document.createElement('span');
    insignia.className = 'insignia ' + (status === 'approved' ? 'ok' : 'no');
    insignia.innerHTML = ico(status === 'approved' ? 'hecho' : 'cerrar') +
      (status === 'approved' ? 'Aprobado' : 'Descartado');
    marco.appendChild(insignia);
  }
  document.getElementById('video-clip')?.pause();
  const caption = card.querySelector('.caption')?.value ?? '';
  const tags = (card.querySelector('.tags')?.value ?? '')
    .split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
  try {
    await api('/api/clips/' + encodeURIComponent(sourceId) + '/' + encodeURIComponent(clipId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, caption, hashtags: tags }),
    });
  } catch (err) {
    avisar(err.message);
    delete card.dataset.decidiendo;
    return;
  }
  if (status !== 'pending') {
    avisarConDeshacer(status === 'approved' ? 'Clip aprobado.' : 'Clip descartado.', async () => {
      await api('/api/clips/' + encodeURIComponent(sourceId) + '/' + encodeURIComponent(clipId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'pending', caption, hashtags: tags }),
      });
      avisar('Deshecho. El clip vuelve a pendientes.');
      refrescar();
    });
  }
  setTimeout(refrescar, 320);
}

/** Un aviso con un boton "Deshacer" que dura 5 segundos. */
function avisarConDeshacer(texto, deshacer) {
  document.getElementById('aviso')?.remove();
  const el = document.createElement('div');
  el.id = 'aviso';
  el.className = 'con-accion';
  el.setAttribute('role', 'status');
  const t = document.createElement('span');
  t.textContent = texto;
  const b = document.createElement('button');
  b.textContent = 'Deshacer';
  b.className = 'aviso-boton';
  let hecho = false;
  b.addEventListener('click', async () => {
    if (hecho) return;
    hecho = true;
    el.remove();
    await deshacer();
  });
  el.append(t, b);
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('sale');
    setTimeout(() => el.remove(), 200);
  }, 5000);
}

document.addEventListener('click', e => {
  if (state.view !== 'clips') return;
  const abrir = e.target.closest('[data-ver-clip]');
  if (abrir) { abrirClip(Number(abrir.dataset.verClip), false); return; }
}, true);

/*
 * Atajos de Revisar. Fuera de los campos de texto:
 *   A aprobar y siguiente, R descartar, flechas cambiar de clip,
 *   Espacio reproducir o pausar, X marcar para el lote, Esc quitar marcas.
 */
document.addEventListener('keydown', e => {
  if (state.view !== 'clips') return;
  if (e.target.matches?.('textarea, input, select')) return;
  if (buscador.abierto) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); abrirClip(state.foco + 1, true); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); abrirClip(state.foco - 1, true); return; }

  if (e.key === 'Escape' && state.sel.size > 0) {
    e.preventDefault();
    state.sel.clear();
    pintarSeleccion();
    return;
  }

  if (e.key === ' ') {
    // Si el foco esta en un boton, el espacio lo pulsa; si no, reproduce.
    if (e.target.matches?.('button, a, summary, [role="button"]')) return;
    e.preventDefault();
    const v = document.getElementById('video-clip');
    if (v) { if (v.paused) v.play(); else v.pause(); }
    return;
  }

  const item = tarjetaEnFoco();
  if ((e.key === 'x' || e.key === 'X') && item) {
    e.preventDefault();
    state.conTeclado = true;
    elegir(item);
    return;
  }

  if (e.key !== 'a' && e.key !== 'A' && e.key !== 'r' && e.key !== 'R') return;
  if (state.filter !== 'pending') return;
  e.preventDefault();
  const status = (e.key === 'a' || e.key === 'A') ? 'approved' : 'rejected';
  if (state.sel.size > 0) { decidirLote(status); return; }
  decidirClip(status);
});

// --- Vista: cola ----------------------------------------------------------

/*
 * Programacion: que sale, en que cuenta y cuando.
 *
 * La version anterior solo tenia el resumen por VOD ("este se repite 4,2
 * veces"). Sirve para juzgar si la cola esta sana, pero no responde a la
 * pregunta que trae a alguien a una seccion llamada Programacion, que es
 * "¿que se publica hoy?". Ahora el calendario va primero y el resumen queda
 * detras, plegado.
 */
function diaDe(iso) {
  const d = new Date(iso);
  const hoy = new Date();
  const manana = new Date(hoy.getTime() + 86400000);
  const mismo = (a, b) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return 'Hoy';
  if (mismo(d, manana)) return 'Manana';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
}

function horaDe(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Tres cifras arriba del calendario. */
function pintarResumenAgenda(q) {
  const o = state.overview;
  const proximas = q.proximas ?? [];
  const semana = Date.now() + 7 * 86400000;
  const estaSemana = proximas.filter(p => new Date(p.scheduledAt).getTime() <= semana).length;
  const cuentas = new Set(proximas.map(p => p.accountId)).size;
  const aprobados = o ? o.clips.approved : null;
  const recomendados = o && o.target ? o.target : null;
  const tarjeta = (icono, cifra, nombre, nota, clase) =>
    '<div class="resumen-tarjeta' + (clase ? ' ' + clase : '') + '">' + ico(icono) +
      '<b class="dato">' + cifra + '</b><span class="resumen-nombre">' + nombre + '</span>' +
      (nota ? '<span class="resumen-nota">' + nota + '</span>' : '') + '</div>';
  return '<div class="resumen-agenda cascada">' +
    tarjeta('agenda', estaSemana, 'Salidas esta semana', q.vencidas > 0 ? q.vencidas + ' esperando turno' : '') +
    tarjeta('aprobado', aprobados === null ? '–' : aprobados, 'Clips aprobados',
      recomendados === null ? '' : 'Se recomiendan ' + recomendados + ' al día',
      recomendados !== null && aprobados !== null && aprobados < recomendados ? 'pide' : '') +
    tarjeta('cuentas', cuentas, cuentas === 1 ? 'Cuenta que publica' : 'Cuentas que publican', '') +
  '</div>';
}

/*
 * La semana en columnas: hoy y los seis dias siguientes.
 *
 * Cada salida es un chip con hora, cuenta y clip. En el movil las columnas se
 * apilan y se lee como una lista por dias.
 */
function pintarSemana(proximas, q) {
  const dias = [];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i += 1) dias.push(new Date(hoy.getTime() + i * 86400000));
  const mismoDia = (a, b) => a.toDateString() === b.toDateString();
  const columnas = dias.map((d, i) => {
    const suyas = proximas.filter(p => mismoDia(new Date(p.scheduledAt), d));
    const nombre = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : d.toLocaleDateString('es', { weekday: 'long' });
    return '<section class="dia' + (i === 0 ? ' hoy' : '') + '" aria-label="' + esc(nombre) + '">' +
      '<header class="dia-cab"><span class="dia-nombre">' + esc(nombre) + '</span>' +
        '<span class="dia-fecha dato">' + d.getDate() + '/' + (d.getMonth() + 1) + '</span></header>' +
      (suyas.length === 0
        ? '<p class="dia-vacio">Sin salidas</p>'
        : suyas.map(p =>
            '<div class="salida' + (p.vencida ? ' vencida' : '') + '">' +
              '<span class="salida-hora dato">' + horaDe(p.scheduledAt) + '</span>' +
              '<span class="salida-cuenta">' + esc(p.accountId) + '</span>' +
              '<span class="salida-clip">' + esc(p.caption || p.title) + '</span>' +
            '</div>').join('')) +
    '</section>';
  }).join('');
  const despues = proximas.filter(p => new Date(p.scheduledAt).getTime() >= hoy.getTime() + 7 * 86400000).length +
    (q.masAlla ?? 0);
  return '<div class="semana">' + columnas + '</div>' +
    (despues > 0 ? '<p class="reason" style="margin:var(--s3) 0 0">Y ' + despues + ' más después de esta semana.</p>' : '');
}

function vistaCola() {
  const q = state.queue;
  if (!q) return esqueleto(2, false);

  if (q.total === 0) {
    // Ya no se manda a pulsar nada: ese boton dejo de existir cuando el reparto
    // paso a hacerse solo al terminar de revisar un video.
    return pintarResumenAgenda(q) +
      '<div class="empty"><b>Todavía no hay salidas programadas</b>' +
      'Aprueba clips en Revisar: al terminar un video se reparten solos entre las cuentas y aparecen aquí.' +
      '<div class="actions" style="justify-content:center;margin-top:var(--s4)">' +
        '<button class="act go" data-ir="clips">' + ico('revisar') + 'Aprobar clips</button></div></div>';
  }

  let html = pintarResumenAgenda(q);
  const proximas = q.proximas ?? [];

  if (proximas.length === 0) {
    html += '<div class="card"><div class="body"><div class="warn" style="margin:0">' +
      '<b>No queda nada por publicar.</b> Las ' + q.total + ' entradas de la cola ya salieron ' +
      'o fallaron. Aprueba más videos y vuelve a repartir desde Inicio.' +
    '</div></div></div>';
  } else {
    /*
     * "Vencidas" casi nunca es una averia, y decir que lo es manda a buscar
     * fantasmas.
     *
     * Este aviso culpaba al trabajador o a una cuenta desenlazada. El 2026-10-05
     * habia 40 vencidas con el trabajador en marcha, el publicador entregando y
     * cero fallos: lo que pasaba es que cada cuenta admite 13 entregas al dia y
     * la cola iba por delante. Es el funcionamiento normal cuando se aprueba
     * mas rapido de lo que TikTok deja publicar.
     *
     * Se explica primero la causa corriente y solo despues las que si son
     * averias, que es el orden en que conviene mirarlas.
     */
    if (q.vencidas > 0) {
      html += '<div class="card"><div class="body"><div class="warn" style="margin:0">' +
        '<b>' + q.vencidas + ' esperando turno.</b> Tenian hora asignada y ya paso. ' +
        'Lo normal es que sea el ritmo: cada cuenta admite 13 entregas al día, y van ' +
        'saliendo en orden. Si no bajan en todo un día, mira que el ordenador de casa ' +
        'este encendido y que las cuentas sigan enlazadas.' +
      '</div></div></div>';
    }

    // Agrupado por dia: cuarenta horas seguidas no dejan ver donde acaba hoy y
    // empieza manana, que es justo lo que se viene a mirar.
    html += pintarSemana(proximas, q);
  }

  html += seccion('&#9679;', 'Salud de la cola', 'Si lo programado está saliendo al ritmo previsto.') +
    '<article class="card flat"><div class="body">' +
      '<details class="nota"><summary>Qué mide esto</summary>' +
        '<p>Cuántas veces se repite cada video entre las cuentas. Repetir mucho cansa ' +
        'a quien te sigue en varias. Por debajo de 4 esta bien; por encima de 8 conviene ' +
        'aprobar más videos.</p>' +
      '</details>' +
    '</div></article>';

  return html + q.sources.map(s => {
    // La repeticion media es el dato que dice si la cola esta sana. Se colorea
    // porque es lo primero que hay que ver, no un numero mas de la lista.
    const veces = s.items / s.clips;
    const salud = veces <= 4 ? 'ok' : veces <= 8 ? 'wait' : 'bad';
    const juicio = veces <= 4 ? 'bien repartido' : veces <= 8 ? 'algo justo' : 'se repite demasiado';
    // "Algo justo" ya lo dice la etiqueta ambar de al lado. Pintar tambien la
    // cifra de azul la haria parecer una accion, que no lo es: en indigo solo
    // va lo que salio bien, y el resto de cifras son negras.
    const color = { ok: 'ok', wait: '', bad: '' }[salud];

    // Una cola cuya proxima entrega ya paso no esta "proxima": esta vencida, y
    // decir "el proximo, el 10/9" cuando hoy es 11/9 es contradictorio.
    const vencida = s.next !== null && new Date(s.next) < new Date();

    return '<article class="card"><div class="body">' +
      '<p class="hook">' + esc(s.title) + '</p>' +
      '<div style="display:flex;align-items:baseline;gap:var(--s2);margin:var(--s3) 0 var(--s1)">' +
        '<span class="cifra ' + color + '"' + (salud === 'bad' ? ' style="color:var(--no)"' : '') + '>' +
          veces.toFixed(1) + '</span>' +
        '<span style="font-size:var(--t-cuerpo);color:var(--dim)">veces se repite cada video</span>' +
      '</div>' +
      '<span class="badge ' + salud + '">' + juicio + '</span>' +
      (vencida ? ' <span class="badge bad">cola vencida</span>' : '') +
      '<div class="stats" style="margin:var(--s4) calc(-1 * var(--s4)) 0;' +
        'border-top:1px solid var(--line)">' +
        '<div><b>' + s.clips + '</b><span>Videos</span></div>' +
        '<div><b>' + s.items + '</b><span>Subidas</span></div>' +
        '<div><b>' + s.accounts + '</b><span>Cuentas</span></div>' +
      '</div>' +
      '<p class="reason" style="margin:var(--s3) 0 0">' +
        Object.entries(s.byStatus).map(([k, v]) =>
          v + ' ' + ({pending:'en espera', published:'publicados', failed:'fallidos', skipped:'saltados'}[k] || k)
        ).join(', ') +
        (s.next
          ? (vencida
              ? '. El primero estaba previsto para ' + cuando(s.next) + ' y sigue sin salir'
              : '. El próximo, ' + cuando(s.next))
          : '') + '.' +
      '</p>' +
      (vencida
        ? '<details class="nota"><summary>Por qué no ha salido</summary>' +
          '<p>Estaba programado para una fecha que ya paso y nadie lo subió. ' +
          'Revisa en Cuentas que la cuenta siga enlazada, y vuelve a repartir ' +
          'desde Inicio.</p>' +
          '</details>'
        : '') +
    '</div></article>';
  }).join('');
}

/** Fecha en lenguaje natural: la hora sola no dice si es hoy o pasado mañana. */
function cuando(iso) {
  const d = new Date(iso);
  const hoy = new Date();
  const dias = Math.round((d.setHours(0,0,0,0) - hoy.setHours(0,0,0,0)) / 86400000);
  const hora = hora_(iso);
  if (dias === 0) return 'hoy a las ' + hora;
  if (dias === 1) return 'mañana a las ' + hora;
  if (dias < 0) return 'el ' + new Date(iso).toLocaleDateString('es') + ' a las ' + hora;
  return 'en ' + plural(dias, 'día') + ' a las ' + hora;
}

function hora_(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// --- Vista: registro ------------------------------------------------------

/** Duracion en algo legible. 522000 ms no dice nada; "8 min 42 s" si. */
function dur(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  return m + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : '');
}

/** Pares clave-valor como "3.027 segmentos · 7 ventanas". */
function pares(obj) {
  return Object.entries(obj)
    .map(([k, v]) => (typeof v === 'number' ? v.toLocaleString('es') : v) + ' ' + k)
    .join(' · ');
}

function fecha(iso) {
  const d = new Date(iso);
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + hora_(iso);
}

/*
 * El diagnostico vive aqui, no en Inicio.
 *
 * Es la herramienta de "algo falla y no se por que", asi que su sitio es al
 * lado del registro de lo que ha pasado. En Inicio ocupaba espacio permanente
 * para algo que se usa dos veces al año.
 */
function tarjetaDiagnostico() {
  const ocupado = Boolean(state.jobs.find(vivo));
  return '<article class="card flat"><div class="body">' +
      '<button class="chip" data-run="doctor"' + (ocupado ? ' disabled' : '') + '>' +
      'Probar el sistema</button>' +
      '<details class="nota"><summary>Cuándo usar esto</summary>' +
        '<p>Comprueba que el programa tiene todo lo que necesita para funcionar. ' +
        'Sirve cuando algo falla y no sabes por que.</p>' +
      '</details>' +
    '</div></article>';
}

function vistaRegistro() {
  const r = state.runs;
  if (!r) return esqueleto(3, true);

  if (r.runs.length === 0) {
    return tarjetaDiagnostico() +
      '<div class="empty"><b>Aún no hay nada</b>' +
      'Cada tarea que haga el programa quedará anotada aquí ' +
      'con lo que uso, lo que creo y lo que costó.</div>';
  }

  const t = r.totals;

  let html = tarjetaDiagnostico() +
    '<article class="card hero"><div class="body" style="text-align:center">' +
      '<p class="ante">Gastado hasta ahora</p>' +
      '<p class="cifra info" style="margin:0">$' + t.costUsd.toFixed(2) + '</p>' +
      '<p class="reason" style="margin:var(--s3) 0 0">' +
        plural(t.count, 'tarea') + ' · ' + dur(t.durationMs) + ' de proceso · ' +
        (t.inputTokens + t.outputTokens).toLocaleString('es') + ' tokens' +
      '</p>' +
    '</div></article>';

  // Desglose por comando: enseña de un vistazo que paso se lleva el dinero.
  const kinds = Object.entries(t.byKind).sort((a, b) => b[1].costUsd - a[1].costUsd);
  if (kinds.length > 1) {
    html += '<article class="card"><table>' +
      '<tr><th>Tarea</th><th>Veces</th><th>Tiempo</th><th>Costo</th></tr>' +
      kinds.map(([k, v]) =>
        '<tr><td>' + esc(NOMBRES[k] || k) + '</td><td>' + v.count + '</td>' +
        '<td>' + dur(v.durationMs) + '</td>' +
        '<td' + (v.costUsd > 0 ? '' : ' style="color:var(--faint)"') + '>' +
        (v.costUsd > 0 ? '$' + v.costUsd.toFixed(2) : '0') + '</td></tr>'
      ).join('') +
    '</table></article>';
  }

  html += seccion('&#9776;', 'Una por una', 'Cada envío con su hora y su cuenta, por día.') +
    r.runs.map(run =>
      '<article class="card' + (run.status === 'error' ? ' job error' : '') + '"><div class="body">' +
        '<div class="joghead">' +
          '<span class="jobname">' + esc(run.label) + '</span>' +
          '<span class="badge' + (run.status === 'error' ? ' bad' : '') + '">' + fecha(run.startedAt) + '</span>' +
        '</div>' +
        (run.status === 'error'
          ? '<p class="reason" style="margin:var(--s3) 0 0;color:var(--no)">' + esc(fraseFallo(run.error)) + '</p>' +
            (run.error && fraseFallo(run.error) !== run.error
              ? '<details class="nota" style="margin-top:var(--s2)"><summary>Ver detalles</summary>' +
                  '<pre class="log-crudo">' + esc(run.error) + '</pre></details>'
              : '')
          : '<div style="margin-top:var(--s3);font-size:var(--t-meta);line-height:1.7">' +
              (Object.keys(run.input).length
                ? '<div><span style="color:var(--faint)">uso</span>  ' + esc(pares(run.input)) + '</div>'
                : '') +
              (Object.keys(run.output).length
                ? '<div><span style="color:var(--faint)">creo</span>  ' + esc(pares(run.output)) + '</div>'
                : '') +
            '</div>') +
        '<p class="reason" style="margin:var(--s3) 0 0">' +
          dur(run.durationMs) +
          (run.costUsd > 0 ? ' · $' + run.costUsd.toFixed(4) : '') +
          // Con la suscripcion no hay coste por tarea que calcular.
          (run.output && run.output.coste === 'Incluido en la suscripción' ? ' · Incluido en la suscripción' : '') +
          (run.tokens
            ? ' · ' + run.tokens.inputTokens.toLocaleString('es') + ' / ' +
              run.tokens.outputTokens.toLocaleString('es') + ' tokens'
            : '') +
        '</p>' +
      '</div></article>'
    ).join('');

  return html;
}

const NOMBRES = {
  ingest: 'Descargar y transcribir', select: 'Buscar momentos', render: 'Armar clips',
  variants: 'Copias por cuenta', schedule: 'Repartir', publish: 'Publicar', metrics: 'Resultados',
};

// --- Vista: flujo ---------------------------------------------------------

/** Hora en formato de 12 horas, que es como la lee la gente. */
function hora12(h) {
  const H = Math.floor(h) % 24;
  const ampm = H < 12 ? 'AM' : 'PM';
  return (H % 12 === 0 ? 12 : H % 12) + ':00 ' + ampm;
}

/** Opciones de un desplegable de horas, de 6 AM a 11 PM. */
function opcionesHora(actual) {
  let out = '';
  for (let h = 6; h <= 23; h += 1) {
    out += '<option value="' + h + '"' + (Math.floor(actual) === h ? ' selected' : '') + '>' +
      hora12(h) + '</option>';
  }
  return out;
}

/**
 * Desplegable generico a partir de pares [valor, texto].
 *
 * Se compara como texto: con Number() las listas de palabras ('rostro',
 * 'direct') nunca marcaban la guardada. Las booleanas viajan como 1/0. Si el
 * valor guardado no esta en la lista, se añade: sin el, el navegador marcaba
 * la primera opcion y el siguiente Guardar escribia un valor que nadie eligio.
 */
function opciones(lista, actual) {
  const a = String(typeof actual === 'boolean' ? Number(actual) : actual);
  const esta = lista.some(([v]) => String(v) === a);
  const extra = esta || actual === undefined || actual === null || actual === ''
    ? '' : '<option value="' + esc(a) + '" selected>' + esc(a) + '</option>';
  return extra + lista.map(([v, t]) =>
    '<option value="' + v + '"' + (String(v) === a ? ' selected' : '') + '>' + t + '</option>'
  ).join('');
}

/**
 * Los ajustes, en lenguaje de persona.
 *
 * Dos cambios respecto a la version anterior, los dos por lo mismo: esto lo usa
 * quien gestiona las cuentas, no quien escribio el programa.
 *
 * 1. Horas en formato de 12 h. "23" es como lo guarda el sistema, pero nadie
 *    dice "las 23"; dice "las 11 de la noche".
 * 2. Desplegables en vez de campos numericos donde habia que conocer la unidad.
 *    "90 min" obliga a traducir mentalmente; "hora y media" no. Y de paso
 *    impide escribir un valor sin sentido.
 */
const BLOQUES = [
  {
    icono: '&#9636;', titulo: 'Cuánto se publica',
    pie: 'Cuántos videos salen al día y en qué horario.',
    campos: [
      /*
       * "Cuentas" YA NO SE ESCRIBE AQUI.
       *
       * Era un numero suelto que no tenia por que parecerse a la realidad: el
       * 2026-09-28 ponia 13 mientras habia 20 cuentas creadas y una sola
       * enlazada con TikTok, y toda la seccion calculaba sobre esas trece.
       * Ahora lo cuenta el servidor y se enseña arriba, con su explicacion.
       */
      { key: 'postsPerDay',  texto: 'Veces al día en cada una', tipo: 'num' },
      { key: 'dayStartHour', texto: 'Desde las',                tipo: 'hora' },
      { key: 'dayEndHour',   texto: 'Hasta las',                tipo: 'hora' },
      /*
       * El tope SI se escribe, al contrario que el numero de cuentas.
       *
       * No es una cifra que describa la realidad -- eso es lo que se cuenta --
       * sino una decision: hasta cuantas quieres poder llegar. Estaba escrita
       * a mano en tres sitios del codigo y habia que desplegar para cambiarla.
       *
       * Las opciones siguen a los planes reales del proveedor, no a numeros
       * redondos: 25 es el plan contratado de upload-post.
       */
      /*
       * El tope se elige por PLAN, no tecleando un numero.
       *
       * Quien decide cuantas cuentas caben no es este programa: es el plan
       * contratado de upload-post. Una cuenta de mas es una que falla al
       * publicar porque no tiene perfil al otro lado, y el error que llega no
       * dice "te falta plan", dice un rechazo del proveedor.
       *
       * Las opciones las manda el servidor desde publish/planes.ts; aqui solo
       * se marca que este campo las usa, igual que hace la tipografia.
       */
      { key: 'maxCuentas', texto: 'Tope de cuentas, según tu plan', planes: true },
    ],
  },
  {
    icono: '&#9888;', titulo: 'Para que no parezca spam',
    pie: 'Si el mismo video sale muchas veces seguidas, TikTok lo nota. Cuanto más lo separas, más videos distintos necesitas.',
    campos: [
      {
        key: 'clipCooldownMinutes',
        texto: 'Antes de repetir un video en otra cuenta, esperar',
        tipo: 'lista',
        lista: [[30, 'media hora'], [60, '1 hora'], [90, 'hora y media'],
                [120, '2 horas'], [180, '3 horas'], [240, '4 horas']],
      },
      {
        key: 'accountRepeatHours',
        texto: 'Antes de repetirlo en la misma cuenta, esperar',
        tipo: 'lista',
        lista: [[24, '1 día'], [48, '2 días'], [72, '3 días'],
                [120, '5 días'], [168, '1 semana'], [336, '2 semanas']],
      },
      {
        key: 'maxRepeticiones',
        texto: 'Publicar el mismo video, como mucho',
        tipo: 'lista',
        lista: [[3, '3 veces'], [5, '5 veces'], [10, '10 veces'], [20, '20 veces'], [50, '50 veces']],
      },
      {
        key: 'jitterMinutes',
        texto: 'Cambiar un poco la hora cada día',
        tipo: 'lista',
        lista: [[0, 'no, siempre igual'], [15, 'hasta 15 minutos'],
                [30, 'hasta media hora'], [40, 'hasta 40 minutos'], [60, 'hasta 1 hora']],
      },
    ],
  },
];

function vistaFlujo() {
  const d = state.settings;
  if (!d) return esqueleto(2, false);

  const m = d.math;
  const faltan = m.clipsNeededPerDay - d.approved;

  // Las dos consecuencias, arriba y en cristiano. Son lo unico que hay que
  // mirar despues de tocar cualquier perilla.
  // La cifra que responde a todo, sola y enorme. El resto es contexto.
  const cuentasN = d.settings.accounts;
  const dias = m.repeatDays;
  const usosVentana = Math.min(cuentasN, Math.floor(m.maxUsesPerClip * dias));
  let html = '<article class="card hero"><div class="body" style="text-align:center">' +
      '<p class="ante">Necesitas cada día</p>' +
      '<p class="cifra acc" style="margin:0">' + m.clipsNeededPerDay + '</p>' +
      '<p style="margin:var(--s2) 0 0;font-size:var(--t-cuerpo)">' +
        (m.clipsNeededPerDay === 1 ? 'video distinto nuevo' : 'videos distintos nuevos') + '</p>' +
      '<p class="reason" style="margin:var(--s3) 0 0">Y tener ' + plural(m.clipsEnRotacion, 'video distinto', 'videos distintos') +
        ' en reserva para ' + plural(m.slotsPerDay, 'subida', 'subidas') + ' al día entre ' +
        plural(cuentasN, 'cuenta que puede', 'cuentas que pueden') + ' publicar.</p>' +
      '<details class="nota" style="text-align:left">' +
        '<summary>¿Por qué ' + m.clipsNeededPerDay + '?</summary>' +
        '<p>Una cuenta no repite un video hasta pasados ' + plural(dias, 'día') + ', y entre dos cuentas el mismo ' +
        'video espera ' + d.settings.clipCooldownMinutes + ' min. En una franja de ' + m.windowHours + ' h, un video cabe ' +
        plural(m.maxUsesPerClip, 'vez', 'veces') + ' al día.</p>' +
        '<p class="dato" style="font-size:var(--t-meta)">' +
          'reserva = ' + cuentasN + ' cuentas × ' + d.settings.postsPerDay + ' al día × ' + dias + ' días ÷ ' + usosVentana +
          ' usos por video = ' + m.clipsEnRotacion + '<br>' +
          'nuevos al día = ' + m.clipsEnRotacion + ' ÷ ' + dias + ' días = ' + m.clipsNeededPerDay +
        '</p>' +
        '<p>Los usos por video son lo menor entre el número de cuentas (' + cuentasN + ') y las veces que cabe en ' +
        plural(dias, 'día') + ' (' + m.maxUsesPerClip + ' × ' + dias + ').</p>' +
      '</details>' +
    '</div></article>';

  /*
   * De donde sale el numero de cuentas, dicho aqui mismo.
   *
   * Es la pregunta que aparece en cuanto deja de ser un campo editable. Y la
   * diferencia entre creadas y enlazadas es justo lo que explica por que el
   * plan es mas pequeño de lo que uno esperaba.
   */
  const c = d.cuentas;
  if (c) {
    const sinEnlazar = c.creadas - c.enlazadas;
    html += '<article class="card"><div class="body">' +
      '<div class="plat">' +
        '<span class="punto-estado ' + (c.enlazadas > 0 ? 'si' : 'no') + '"></span>' +
        '<span class="nombre">Cuentas que pueden publicar</span>' +
        '<span class="badge ' + (c.enlazadas > 0 ? 'ok' : '') + '">' + c.enlazadas + ' de ' + c.creadas + '</span>' +
      '</div>' +
      '<p class="reason" style="margin:var(--s3) 0 0">' +
        (c.enlazadas === 0
          ? 'Ninguna cuenta esta enlazada con TikTok todavía, así que el plan de arriba es el mínimo. '
          : sinEnlazar > 0
            ? sinEnlazar + ' cuenta' + (sinEnlazar === 1 ? '' : 's') + ' sin enlazar no cuenta' +
              (sinEnlazar === 1 ? '' : 'n') + ' para el plan: sin permiso de TikTok no pueden subir nada. '
            : 'Todas las cuentas creadas están enlazadas. ') +
        'Este número no se escribe: sale de las cuentas enlazadas.' +
      '</p>' +
      '<div class="chips" style="margin-top:var(--s3)">' +
        '<button class="chip" data-ir="plataformas">Ir a Cuentas</button>' +
      '</div>' +
    '</div></article>';
  }

  if (faltan > 0) {
    html += '<div class="card"><div class="body"><div class="warn" style="margin:0">' +
      '<b>Te faltan videos.</b> Tienes ' + d.approved + ' aprobado' + (d.approved === 1 ? '' : 's') +
      ' y hacen falta ' + m.clipsNeededPerDay + ' al día. Hasta llegar ahí, los mismos videos ' +
      'se repetiran más de lo que deberian.' +
    '</div></div></div>';
  }

  html += BLOQUES.map(b =>
    seccion(b.icono ?? '&#9881;', b.titulo, b.pie) +
    '<article class="card"><div class="body">' +
      b.campos.map(c => {
        const valor = d.settings[c.key];
        const control =
          c.planes
            ? '<select data-set="' + c.key + '">' + opcionesPlan(d, valor) + '</select>'
            : c.tipo === 'hora'
              ? '<select data-set="' + c.key + '">' + opcionesHora(valor) + '</select>'
              : c.tipo === 'lista'
                ? '<select data-set="' + c.key + '">' + opciones(c.lista, valor) + '</select>'
                : '<input type="number" data-set="' + c.key + '" value="' + valor + '">';

        // Los desplegables ya llevan la unidad escrita dentro, asi que ocupan
        // las dos columnas de la derecha y no dejan un hueco vacio al lado.
        return '<div class="linea' + (c.tipo === 'num' ? '' : ' ancha') + '">' +
          '<span>' + c.texto + '</span>' + control +
        '</div>' +
          // Debajo del desplegable, lo que implica el plan elegido. Un numero
          // suelto no dice si da para lo que publicas.
          (c.planes ? notaDelPlan(d, valor) : '');
      }).join('') +
      /*
       * El pie NO se repite aqui.
       *
       * Ya lo dice la cabecera de la seccion, justo encima de esta tarjeta, y
       * salia dos veces palabra por palabra: una arriba y otra al pie. En
       * "Cuanto dura cada corte" y "Cuantos busca" se veia a simple vista y
       * hacia la pantalla el doble de larga sin decir nada nuevo.
       */
    '</div></article>'
  ).join('');

  html += '<article class="card"><div class="body">' +
      '<div class="actions">' +
        // Era .undo (texto tenue sobre transparente) y parecia desactivado.
        '<button class="act sec" id="reset">Dejarlo como estaba</button>' +
        '<button class="act go" id="guardar">Guardar</button>' +
      '</div>' +
      '<p class="reason" style="margin:var(--s3) 0 0">Al guardar se cambian los horarios. ' +
      'Las cuentas no se tocan: siguen siendo las mismas. ' +
      'Después, entra en Proceso y pulsa "Rehacer el reparto".</p>' +
    '</div></article>';

  return html;
}

/*
 * Los valores de fabrica de Horarios. Deben coincidir con DEFAULTS en
 * queue/settings.ts.
 *
 * El campo accounts NO se manda nunca: el servidor lo cuenta y rechaza el que
 * venga del cliente. Se deja aqui para que "Dejarlo como estaba" no lo borre de la
 * fila, pero su valor da igual.
 */
const BASE = {
  accounts: 20, postsPerDay: 3, dayStartHour: 10, dayEndHour: 23,
  jitterMinutes: 40, clipCooldownMinutes: 90, accountRepeatHours: 72,
  maxCuentas: 25, maxRepeticiones: 10,
};

async function guardarFlujo(valores) {
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valores),
    });
    render();
    // El servidor rehace las franjas de todas las cuentas al guardar esto, y
    // eso no se ve en ninguna cifra de la pantalla. Decirlo es la diferencia
    // entre "ha pasado algo" y "no se si le he dado bien".
    const a = state.settings.applied;
    avisar(a && a.added + a.deactivated > 0
      ? 'Guardado. ' + plural(a.kept, 'cuenta sigue', 'cuentas siguen') + ' igual, ' + plural(a.added, 'nueva', 'nuevas') + ', ' + plural(a.deactivated, 'desactivada', 'desactivadas') + '.'
      : 'Guardado. Los horarios se han recalculado.');
  } catch (error) {
    alert(error.message);
  }
}

// --- Vista: ajustes -------------------------------------------------------

/*
 * Como se cortan los videos.
 *
 * Mismo criterio que en Horarios: desplegables con la unidad escrita dentro en
 * vez de campos numericos. "90" obliga a adivinar si son segundos o minutos;
 * "minuto y medio" no, y de paso impide escribir un valor que el servidor
 * rechazaria.
 *
 * Las listas NO pueden salirse de los rangos de select/ajustes.ts. Si alguien
 * añade aqui una opcion de 4 minutos, el servidor la rechaza y el usuario ve un
 * error sin entender que ha hecho mal.
 */
const CORTES = [
  {
    icono: '&#8942;', titulo: 'Cuánto dura cada corte',
    pie: 'Los momentos que encuentre se ajustaran a esta horquilla. Más corto retiene mejor; más largo deja contar algo entero.',
    campos: [
      {
        key: 'minSec', texto: 'Como mínimo',
        lista: [[10, '10 segundos'], [15, '15 segundos'], [20, '20 segundos'],
                [30, 'medio minuto'], [45, '45 segundos'], [60, '1 minuto']],
      },
      {
        key: 'maxSec', texto: 'Como máximo',
        lista: [[30, 'medio minuto'], [45, '45 segundos'], [60, '1 minuto'],
                [90, 'minuto y medio'], [120, '2 minutos'], [180, '3 minutos']],
      },
    ],
  },
  {
    icono: '&#9636;', titulo: 'Cuántos busca',
    pie: 'El directo se parte en trozos y se buscan los mejores momentos de cada uno, uno por uno. ' +
         'Trozos más pequeños reparten la atención por todo el video y encuentran más, pero son más pasadas y cuestan más.',
    campos: [
      {
        key: 'perWindow', texto: 'Momentos por trozo, como mucho',
        lista: [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']],
      },
      {
        key: 'windowSec', texto: 'Cada trozo dura',
        lista: [[300, '5 minutos'], [600, '10 minutos'], [900, 'un cuarto de hora'],
                [1200, '20 minutos'], [1800, 'media hora']],
      },
    ],
  },
  {
    icono: '&#9634;', titulo: 'Cómo se encuadra',
    pie: 'El video horizontal se pasa a vertical. Siguiendo la cara, el encuadre acompaña a quien habla; ' +
         'si no se encuentra ninguna cara, ese clip sale en clásico.',
    campos: [
      {
        key: 'encuadre', texto: 'Encuadre',
        lista: [['rostro', 'Siguiendo la cara'], ['clasico', 'Clásico (fondo borroso)']],
        texto_valor: true,
      },
    ],
  },
  {
    icono: '&#9647;', titulo: 'Cómo salen los subtítulos',
    pie: 'En TikTok la mayoria mira sin sonido, así que quitarlos casi siempre cuesta visitas. ' +
         'La altura los deja por encima de la franja donde TikTok pone el texto y los botones.',
    campos: [
      {
        key: 'subtitles', texto: 'Subtítulos quemados en el video',
        lista: [[1, 'si'], [0, 'no']],
      },
      // La lista de fuentes la manda el servidor: es la misma que valida, asi
      // que el panel no puede ofrecer una que luego se rechace.
      { key: 'subFont', texto: 'Tipografia', fuentes: true },
      {
        key: 'subSize', texto: 'Tamaño',
        lista: [[48, 'pequeño'], [60, 'mediano'], [72, 'normal'], [90, 'grande'], [110, 'enorme']],
      },
      {
        key: 'subMargin', texto: 'Altura sobre el borde',
        // Desde 400: por debajo lo tapa la interfaz de TikTok (ZONA_SEGURA_PX).
        lista: [[400, 'lo más bajo posible'], [480, 'normal'], [580, 'alto'],
                [700, 'muy alto'], [900, 'casi en el centro']],
      },
      { key: 'subColor', texto: 'Color del texto', color: true },
      { key: 'subColorBorde', texto: 'Color del borde', color: true },
      {
        key: 'subBorde', texto: 'Grosor del borde',
        lista: [[0, 'sin borde'], [3, 'fino'], [7, 'normal'], [12, 'grueso'], [18, 'muy grueso']],
      },
      {
        key: 'subPalabras', texto: 'Palabras por rótulo',
        lista: [[1, '1, muy rápido'], [2, '2'], [3, '3, normal'], [4, '4'],
                [5, '5'], [7, '7, frases enteras']],
      },
      {
        key: 'subAnimacion', texto: 'Animación al aparecer',
        lista: [[1, 'si'], [0, 'no']],
      },
    ],
  },
  {
    icono: '&#9650;', titulo: 'El rótulo de arriba',
    pie: 'Una frase quemada en la parte de arriba del video, fija durante todo el clip. ' +
         'No es lo mismo que el texto de la publicación: ese se lee debajo y quien pasa deprisa no llega a verlo. ' +
         'El rótulo se ve en el primer segundo, que es lo que decide si alguien se queda. ' +
         '{titulo} es el pie que propone el programa para ese clip.',
    campos: [
      {
        key: 'tituloActivo', texto: 'Rótulo quemado en el video',
        lista: [[1, 'si'], [0, 'no']],
      },
      { key: 'tituloTexto', texto: 'Qué dice', textoLibre: true, pista: '{titulo}' },
      {
        key: 'tituloArriba', texto: 'Altura desde arriba',
        lista: [[120, 'arriba del todo'], [180, 'alto'], [240, 'normal'],
                [360, 'bajo'], [520, 'casi en el centro']],
      },
      {
        key: 'tituloTam', texto: 'Tamaño',
        lista: [[40, 'pequeño'], [52, 'mediano'], [64, 'normal'], [84, 'grande'], [104, 'enorme']],
      },
      { key: 'tituloColor', texto: 'Color del texto', color: true },
      { key: 'tituloColorBorde', texto: 'Color del borde', color: true },
      {
        key: 'tituloBorde', texto: 'Grosor del borde',
        lista: [[0, 'sin borde'], [3, 'fino'], [6, 'normal'], [12, 'grueso'], [18, 'muy grueso']],
      },
    ],
  },
  {
    icono: '&#9998;', titulo: 'El texto de la publicación',
    pie: 'Lo que acompaña al video en TikTok. {titulo} es el pie que propone el programa para ese clip ' +
         'y {hashtags} las etiquetas. Las fijas se añaden a todos los videos, sin repetir las que ya vengan.',
    campos: [
      // El salto va doble: dentro del template literal, un \\n suelto se
      // convierte en un salto de linea real y parte esta cadena en dos.
      { key: 'textoPlantilla', texto: 'Plantilla', textoLibre: true, multilinea: true,
        pista: '{titulo}\\n\\n{hashtags}' },
      { key: 'hashtagsFijos', texto: 'Etiquetas fijas', textoLibre: true, ancho: true,
        pista: 'zoti, medellin, musicaurbana' },
    ],
  },
  {
    icono: '&#9741;', titulo: 'Al publicar',
    pie: 'Directo publica en el perfil; borrador lo deja en la bandeja del móvil para que lo suba el titular. ' +
         'La API propia de TikTok no puede publicar directo hasta pasar la auditoria. ' +
         'El ritmo son topes por cuenta: TikTok admite hasta 6 por minuto y 15 al día.',
    campos: [
      {
        key: 'proveedor', texto: 'Por dónde se publica',
        lista: [['upload-post', 'upload-post'], ['tiktok', 'API propia de TikTok']],
        texto_valor: true,
      },
      {
        key: 'modo', texto: 'Qué se hace con el video',
        lista: [['direct', 'publicarlo'], ['draft', 'dejarlo en la bandeja']],
        texto_valor: true,
      },
      {
        key: 'privacidad', texto: 'Quién lo ve',
        lista: [['PUBLIC_TO_EVERYONE', 'todo el mundo'], ['MUTUAL_FOLLOW_FRIENDS', 'amigos'],
                ['FOLLOWER_OF_CREATOR', 'seguidores'], ['SELF_ONLY', 'solo yo, en privado']],
        texto_valor: true,
      },
      {
        key: 'maxPorDia', texto: 'Como mucho al día, por cuenta',
        lista: [[3, '3'], [5, '5'], [8, '8'], [10, '10'], [13, '13, normal'], [15, '15, el tope']],
      },
      {
        key: 'maxPorMinuto', texto: 'Como mucho por minuto, por cuenta',
        lista: [[1, '1'], [2, '2'], [3, '3'], [5, '5, normal'], [6, '6, el tope']],
      },
    ],
  },
];

/**
 * Plantillas: juegos de ajustes con nombre.
 *
 * Va DENTRO de Ajustes y no en su propia seccion del menu. Una plantilla no es
 * un sitio al que ir, es un atajo sobre los controles de abajo: separarlas
 * obligaria a saltar entre dos pantallas para ver que hace cada una, y el menu
 * ya tiene ocho entradas.
 *
 * La marcada es la que coincide exactamente con los ajustes vigentes. Se
 * compara por valor y no se guarda "cual apliqué": si aplicas una y cambias un
 * desplegable, la pastilla se apaga sola, que es la verdad.
 */
function pintarPlantillas(d) {
  const lista = d.plantillas ?? [];
  const a = d.ajustes;
  /*
   * La comparacion recorre TODOS los ajustes, no una lista a mano.
   *
   * Habia ocho nombres escritos aqui, de los veintisiete que existen ya. Una
   * plantilla que solo se diferenciara en el color del subtitulo o en el
   * rotulo salia marcada como "puesta" sin serlo, que es la clase de mentira
   * pequeña que hace que luego nadie se fie de la pastilla.
   *
   * BASE_CORTES tiene una clave por ajuste y es la misma lista que se manda
   * al guardar, asi que no puede quedarse corta al añadir el siguiente.
   */
  const igual = p => Object.keys(BASE_CORTES).every(k => p[k] === a[k]);

  return seccion('&#9737;', 'Plantillas', 'Guarda un juego de ajustes con nombre para volver a el de un clic.') +
    '<article class="card"><div class="body">' +
      (lista.length === 0
        ? '<p class="reason" style="margin:0 0 var(--s3)">Ninguna todavía. Deja los ajustes de abajo como los quieras ' +
          'y guardalos con un nombre; así puedes alternar entre, por ejemplo, ' +
          'cortes de directo de juego y de podcast sin tocar ocho desplegables.</p>'
        : '<div class="chips" style="margin-bottom:var(--s3)">' +
            lista.map(p =>
              '<span class="pastilla' + (igual(p) ? ' puesta' : '') + '">' +
                '<button class="chip" data-plantilla="' + esc(p.id) + '"' +
                  (igual(p) ? ' disabled' : '') + '>' + esc(p.nombre) + '</button>' +
                '<button class="quita" data-borrar="' + esc(p.id) + '" ' +
                  'aria-label="Borrar la plantilla ' + esc(p.nombre) + '">&times;</button>' +
              '</span>'
            ).join('') +
          '</div>') +

      '<div class="linea ancha">' +
        '<input id="nombre-plantilla" placeholder="Nombre de la plantilla" maxlength="40" ' +
          'autocomplete="off" spellcheck="false">' +
        '<button class="chip" id="guardar-plantilla">Guardar los de abajo</button>' +
      '</div>' +

      (lista.length > 0
        ? '<p class="reason" style="margin:var(--s3) 0 0">Guardar con un nombre que ya existe lo sobrescribe. ' +
          'Aplicar una plantilla cambia los ajustes al momento; borrarla no los toca.</p>'
        : '') +
    '</div></article>';
}

/*
 * Vista previa de como queda un clip con los ajustes actuales.
 *
 * Existe porque hasta ahora la unica forma de ver el efecto de cambiar la
 * tipografia o el color era guardar, renderizar un video entero (minutos de
 * GPU) y abrirlo. Con cinco perillas de estilo eso son cinco renders para
 * afinar una cosa, asi que en la practica nadie las tocaba.
 *
 * Se dibuja en el navegador sobre un lienzo de 1080x1920 escalado, con las
 * MISMAS cuentas que hace el generador del .ass: el cuerpo, el margen y el
 * grosor del borde estan en pixeles de ese lienzo, asi que basta multiplicar
 * por la escala. No es el render de verdad (libass reparte las lineas a su
 * manera), pero acierta en lo que se viene a mirar: si se lee, si tapa la
 * cara y si el color pega.
 *
 * El texto que se enseña es el de un clip REAL. Con texto de relleno no se ve
 * lo que importa, que es si el pie que propone el programa cabe.
 */
function vistaPrevia(d) {
  const a = d.ajustes;
  const m = d.muestra;

  if (!m) {
    return seccion('&#9654;', 'Vista previa', 'Cómo queda un clip tuyo con estos ajustes. Cambia algo y se actualiza al momento, sin guardar.') +
      '<article class="card"><div class="body">' +
        '<p class="hook">Todavía no hay ningún momento</p>' +
        '<p class="reason" style="margin-bottom:0">Cuando proceses un video, aquí verás ' +
        'como queda con estos ajustes antes de gastar GPU en renderizarlo.</p>' +
      '</div></article>';
  }

  // El estilo y el texto de cada capa salen de estiloCapa/textoCapa, que son
  // los mismos que usa el refresco en vivo. Tenerlo dos veces era garantizar
  // que la primera pintada y las siguientes acabaran discrepando.

  const video = m.hayVideo
    /*
     * Este si se reproduce solo, al contrario que los de Revisar.
     *
     * Parado en el fotograma cero casi siempre sale negro -- el corte empieza
     * en un fundido o en un plano oscuro -- y la vista previa parecia rota: un
     * rectangulo negro con una frase encima. En marcha se ve de que va el clip
     * y, sobre todo, si el texto tapa la cara cuando la cara se mueve.
     *
     * Va en silencio, en bucle y sin controles: es una muestra, no un
     * reproductor. Aqui hay UNO solo; en Revisar hay cuarenta y cinco y
     * arrancarlos todos seria insufrible.
     */
    /*
     * FASE 5: primero el fotograma LIMPIO, sin subtitulos.
     *
     * El video subido ya lleva los subtitulos quemados, y con los de la vista
     * previa encima se veian dos veces. El fotograma es el encuadre real del
     * clip sin texto: lo que se ve encima es exactamente lo que saldra con
     * estos ajustes. Si un clip todavia no tiene fotograma (armado antes de
     * esta fase), se cae al video, como antes.
     */
    ? '<img class="pv-video pv-foto" alt="Fotograma del clip" src="/fotograma/' +
        encodeURIComponent(m.sourceId) + '/' + encodeURIComponent(m.clipId) + '"' +
        ' data-video="/video/' + encodeURIComponent(m.sourceId) + '/' + encodeURIComponent(m.clipId) + '">'
    : '<div class="pv-sinvideo">Todavía no hay ningún clip subido.<br>La vista previa usará el primero que se arme.</div>';

  return seccion('&#9654;', 'Vista previa', 'Cómo queda un clip tuyo con estos ajustes. Cambia algo y se actualiza al momento, sin guardar.') +
    '<article class="card ancho"><div class="body">' +
      '<div class="pv-fila">' +
        '<div class="pv-marco">' +
          video +
          /*
           * Las dos capas, con tabindex para poder colocarlas sin raton.
           * El rotulo va antes que el subtitulo en el marcado por el mismo
           * motivo que va en la capa 1 del .ass: si llegaran a solaparse, el
           * que se lee entero es el de arriba.
           */
          capaHtml('titulo', a, m) +
          capaHtml('sub', a, m) +
          '<div class="pv-zona" aria-hidden="true"><span>Lo tapa TikTok</span></div>' +
        '</div>' +
        '<div class="pv-datos">' +
          '<p class="ante">Texto de la publicación</p>' +
          '<p class="pv-texto" id="pv-texto"></p>' +

          /*
           * Que esta encendido, en una lista corta.
           *
           * Esta columna tenia tres lineas al lado de un marco de 480 px de
           * alto, asi que media tarjeta era hueco. Y lo que faltaba era
           * precisamente esto: mirando el marco no se sabe si el rotulo esta
           * apagado o es que el clip no tiene pie, ni con que tipografia sale.
           */
          '<p class="ante" style="margin-top:var(--s4)">Qué lleva este video</p>' +
          '<ul class="pv-lista">' +
            '<li><span class="punto-estado ' + (a.subtitles ? 'si' : 'nada') + '"></span>' +
              (a.subtitles
                ? 'Subtítulos en ' + esc(a.subFont) + ', de ' + a.subPalabras +
                  (a.subPalabras === 1 ? ' palabra' : ' palabras')
                : 'Sin subtítulos') + '</li>' +
            '<li><span class="punto-estado ' + (a.tituloActivo ? 'si' : 'nada') + '"></span>' +
              (a.tituloActivo ? 'Rótulo arriba' : 'Sin rótulo arriba') + '</li>' +
            '<li><span class="punto-estado ' + (a.subAnimacion && a.subtitles ? 'si' : 'nada') + '"></span>' +
              (a.subAnimacion && a.subtitles ? 'Los rótulos entran animados' : 'Sin animación') + '</li>' +
          '</ul>' +

          '<p class="ante" style="margin-top:var(--s4)">De dónde sale</p>' +
          '<p class="reason" style="margin:0">' + esc(m.sourceId) + ' / ' + esc(m.clipId) + '</p>' +
        '</div>' +
      '</div>' +
      '<p class="reason" style="margin:var(--s4) 0 0">' +
        (a.subtitles || a.tituloActivo
          ? 'Arrastra el texto para colocarlo, o púlsalo y usa las flechas. Es aproximado: ' +
            'el render reparte las líneas a su manera. Sirve para ver si se lee, si tapa la ' +
            'cara y si el color pega.'
          : 'El rótulo y los subtítulos están apagados, así que el video sale limpio.') +
      '</p>' +
    '</div></article>';
}

/**
 * Arma el texto de la publicacion igual que lo hace el servidor.
 *
 * Es una copia de construirTexto (publish/texto.ts) y eso no es ideal, pero la
 * alternativa es pedirselo al servidor en cada tecla. Lo que se enseña aqui
 * debe coincidir con lo que se publica: si divergen, la vista previa miente,
 * que es peor que no tenerla.
 */
/*
 * El texto de la publicacion, para la vista previa de Estilo.
 *
 * Es una copia de construirTexto (src/publish/texto.ts) con las mismas
 * reglas: sin repetir etiquetas (ni por mayusculas ni por tildes, ni las que
 * ya estan en la descripcion), sin trozos de otra etiqueta, como mucho 5 (las
 * fijas primero) y sin cortar nada a medias. verify-fase5 comprueba que las
 * dos dan lo mismo.
 */
function textoPublicacion(a, m) {
  const MAX = 5;
  const limpiar = (x) => String(x).trim().replace(/^#+/, '').replace(/\\s+/g, '');
  const clave = (h) => h.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  const caption = m.caption || '';
  const fijas = String(a.hashtagsFijos || '').split(',').map(limpiar).filter(h => h.length >= 2);
  const clip = (m.hashtags || []).map(limpiar).filter(h => h.length >= 2);
  const claves = [...fijas, ...clip].map(clave);
  const forma = new Map();
  for (const h of [...clip, ...fijas]) if (!forma.has(clave(h))) forma.set(clave(h), h);
  const fragmento = (c) => claves.some(o => o !== c && o.length > c.length && o.startsWith(c));
  const vistas = new Set([...caption.matchAll(/#([\\p{L}\\p{N}_]+)/gu)].map(x => clave(x[1] || '')));
  const reservadas = [];
  for (const h of fijas) {
    const c = clave(h);
    if (reservadas.length >= MAX || vistas.has(c) || fragmento(c)) continue;
    vistas.add(c);
    reservadas.push(c);
  }
  const delClip = [];
  for (const h of clip) {
    const c = clave(h);
    if (reservadas.length + delClip.length >= MAX) break;
    if (vistas.has(c) && !reservadas.includes(c)) continue;
    if (fragmento(c)) continue;
    if (reservadas.includes(c)) reservadas.splice(reservadas.indexOf(c), 1);
    else vistas.add(c);
    delClip.push(c);
  }
  const todas = [...delClip, ...reservadas].map(c => '#' + (forma.get(c) || c));
  const texto = String(a.textoPlantilla || '{titulo} {hashtags}')
    .replaceAll('{titulo}', caption)
    .replaceAll('{hashtags}', todas.join(' '))
    .replace(/[ \\t]+/g, ' ')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
  if (texto.length <= 2200) return texto;
  const trozos = texto.split(/(\\s+)/);
  while (trozos.join('').trimEnd().length > 2200 && trozos.length > 1) trozos.pop();
  const r = trozos.join('').trimEnd();
  return r.length <= 2200 ? r : r.slice(0, 2200);
}

document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-rearmar]');
  if (!b) return;
  b.disabled = true;
  try {
    const r = await api('/api/ajustes/rearmar', { method: 'POST' });
    avisar(r.clips === 0
      ? 'No hay clips pendientes que volver a armar.'
      : (r.clips === 1 ? 'Se vuelve a armar 1 clip.' : 'Se vuelven a armar ' + r.clips + ' clips.') +
        ' Aparecerán en Revisar cuando estén listos.');
  } catch (err) {
    avisar(err.message);
  }
  b.disabled = false;
});

document.addEventListener('error', e => {
  const img = e.target;
  if (!img || !img.classList || !img.classList.contains('pv-foto')) return;
  const v = document.createElement('video');
  v.className = 'pv-video';
  v.autoplay = true;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = 'metadata';
  v.src = img.dataset.video;
  img.replaceWith(v);
}, true);

function vistaAjustes() {
  const d = state.ajustes;
  if (!d) return esqueleto(2, false);

  const a = d.ajustes;

  /*
   * La consecuencia primero, igual que en Horarios.
   *
   * "3 momentos por trozo de 15 minutos" no significa nada hasta que se
   * traduce a un numero sobre un video real del usuario. Y es la cifra que
   * decide si los ajustes sirven: si salen 12 y hacen falta 20 al dia, no hay
   * nada que revisar.
   */
  let html = d.ejemplo
    ? '<article class="card hero paso-1"><div class="body" style="text-align:center">' +
        '<p class="ante">De tu video más largo saldrian</p>' +
        '<p class="cifra acc" style="margin:0">' + d.ejemplo.clips + '</p>' +
        '<p style="margin:var(--s2) 0 0;font-size:var(--t-cuerpo)">momentos, más o menos</p>' +
        '<p class="reason" style="margin:var(--s3) 0 0">' +
          esc(d.ejemplo.titulo) + ', ' + d.ejemplo.minutos + ' min. ' +
          'De esos apruebas tu los que valgan.</p>' +
      '</div></article>'
    : '<article class="card paso-1"><div class="body">' +
        '<p class="hook">Todavía no hay ningún video</p>' +
        '<p class="reason" style="margin-bottom:0">Cuando subas uno, aquí te diré cuántos momentos ' +
        'saldrian con estos ajustes.</p>' +
      '</div></article>';

  html += vistaPrevia(d);
  // Cambiar el estilo no rehace lo ya armado. Esto si, para lo que aun espera.
  html += '<article class="card"><div class="body">' +
    '<p class="hook" style="margin-top:0">Aplicar el estilo a lo que ya está armado</p>' +
    '<p class="reason">Los clips ya armados conservan el estilo con el que se hicieron. ' +
      'Con este botón se vuelven a armar los que aún esperan revisión; lo aprobado y lo descartado no se toca.</p>' +
    '<div class="actions"><button class="act go" data-rearmar="1">' + ico('reintentar') +
      'Volver a armar los clips pendientes</button></div>' +
  '</div></article>';
  html += pintarPlantillas(d);

  html += CORTES.map(b =>
    seccion(b.icono ?? '&#9881;', b.titulo, b.pie) +
    '<article class="card"><div class="body">' +
      b.campos.map(c => {
        // La tipografia es la unica que no es un numero: su lista la manda el
        // servidor, que es quien la valida.
        if (c.fuentes) {
          const opts = (d.fuentes ?? []).map(f =>
            '<option value="' + esc(f) + '"' + (f === a.subFont ? ' selected' : '') + '>' + esc(f) + '</option>'
          ).join('');
          return '<div class="linea ancha">' +
            '<span>' + c.texto + '</span>' +
            '<select data-ajuste="subFont" data-texto="1">' + opts + '</select>' +
          '</div>';
        }
        // Un color necesita verse, no elegirse de una lista de nombres.
        if (c.color) {
          return '<div class="linea ancha">' +
            '<span>' + c.texto + '</span>' +
            '<input type="color" data-ajuste="' + c.key + '" data-texto="1" value="' +
              esc(a[c.key] ?? '#FFFFFF') + '">' +
          '</div>';
        }

        // Texto libre: la plantilla y las etiquetas fijas. Van en su propia
        // linea porque son largas y al lado de la etiqueta no caben.
        if (c.textoLibre) {
          /*
           * La plantilla va en un area de texto, no en un input de una linea.
           *
           * Un <input type="text"> DESCARTA los saltos de linea, asi que una
           * plantilla como "{hashtags}\\n\\n{titulo}" se guardaba con todo
           * pegado y el texto salia "#etiquetaTitulo". Se vio probando la vista
           * previa: las etiquetas y el titulo aparecian sin separacion.
           */
          if (c.multilinea) {
            return '<div class="field">' +
              '<label>' + c.texto + '</label>' +
              '<textarea data-ajuste="' + c.key + '" data-texto="1" rows="3" spellcheck="false"' +
                (c.pista ? ' placeholder="' + esc(c.pista) + '"' : '') + '>' +
                esc(a[c.key] ?? '') + '</textarea>' +
            '</div>';
          }
          return '<div class="field">' +
            '<label>' + c.texto + '</label>' +
            '<input type="text" data-ajuste="' + c.key + '" data-texto="1" spellcheck="false"' +
              ' value="' + esc(a[c.key] ?? '') + '"' +
              (c.pista ? ' placeholder="' + esc(c.pista) + '"' : '') + '>' +
          '</div>';
        }

        /*
         * Las booleanas viajan como tal y se enseñan como 1/0; la privacidad
         * es una lista de textos, no de numeros. La conversion se hace aqui y
         * al guardar, en los dos extremos del mismo sitio.
         */
        const esBooleana = BOOLEANOS.has(c.key);
        const valor = esBooleana ? (a[c.key] ? 1 : 0) : a[c.key];
        return '<div class="linea ancha">' +
          '<span>' + c.texto + '</span>' +
          '<select data-ajuste="' + c.key + '"' + (c.texto_valor ? ' data-texto="1"' : '') + '>' +
            opciones(c.lista, valor) + '</select>' +
        '</div>';
      }).join('') +
      /*
       * El pie NO se repite aqui.
       *
       * Ya lo dice la cabecera de la seccion, justo encima de esta tarjeta, y
       * salia dos veces palabra por palabra: una arriba y otra al pie. En
       * "Cuanto dura cada corte" y "Cuantos busca" se veia a simple vista y
       * hacia la pantalla el doble de larga sin decir nada nuevo.
       */
    '</div></article>'
  ).join('');

  html += '<article class="card"><div class="body">' +
      '<div class="actions">' +
        '<button class="act sec" id="reset-ajustes">Dejarlo como estaba</button>' +
        '<button class="act go" id="guardar-ajustes">Guardar</button>' +
      '</div>' +
      '<p class="reason" style="margin:var(--s3) 0 0">' +
        'Se aplica a los videos que proceses a partir de ahora. Los momentos ya ' +
        'encontrados no cambian: para rehacerlos con estos ajustes, entra en Inicio ' +
        'y vuelve a pulsar "Buscar los mejores momentos".</p>' +
    '</div></article>';

  // Lo que NO se puede tocar, dicho en vez de fingido con un control apagado.
  html += '<article class="card flat"><div class="body">' +
      '<details class="nota"><summary>Lo que no se puede cambiar todavía</summary>' +
        '<p><b>El formato es vertical 9:16</b> y no hay otra opción. El video se pone ' +
        'a lo ancho con el fondo desenfocado detrás, que es lo estandar en clips de ' +
        'directo y nunca corta la cabeza a nadie.</p>' +
        '<p><b>No hay marca de agua.</b> No esta hecha; poner aquí un interruptor que ' +
        'no hace nada seria mentir.</p>' +
        '<p><b>Los momentos los elige el modelo leyendo lo que se dice</b>, no los picos ' +
        'de volumen ni el chat. En un directo sin chat eso es lo único que hay, y ' +
        'entiende el remate de una historia, que un pico de audio no.</p>' +
      '</details>' +
    '</div></article>';

  return html;
}

/** Valores de fabrica. Son los mismos que CLIP_DEFAULTS en select/ajustes.ts. */
/*
 * Que ajustes son booleanos, en un solo sitio.
 *
 * Estaba escrito tres veces -- al pintar, al guardar y en la vista previa --
 * como una condicion con dos nombres. Al añadir el tercero (tituloActivo) dos
 * de las tres se habrian quedado viejas y el rotulo habria viajado como el
 * numero 1 a una columna booleana.
 */
const BOOLEANOS = new Set(['subtitles', 'subAnimacion', 'tituloActivo']);

const BASE_CORTES = {
  minSec: 20, maxSec: 90, perWindow: 3, windowSec: 900,
  subtitles: true, subFont: 'Impact', subSize: 72, subMargin: 480,
  subColor: '#FFFFFF', subColorBorde: '#000000', subBorde: 7,
  subPalabras: 3, subAnimacion: true,
  tituloActivo: false, tituloTexto: '{titulo}', tituloArriba: 240, tituloTam: 64,
  tituloColor: '#FFFFFF', tituloColorBorde: '#000000', tituloBorde: 6,
  encuadre: 'rostro',
  textoPlantilla: '{titulo} {hashtags}', hashtagsFijos: '',
  privacidad: 'PUBLIC_TO_EVERYONE', maxPorMinuto: 5, maxPorDia: 13,
  proveedor: 'upload-post', modo: 'direct',
};

async function guardarAjustes(valores) {
  try {
    state.ajustes = await api('/api/ajustes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valores),
    });
    render();
    const e = state.ajustes.ejemplo;
    avisar(e ? 'Guardado. Saldrían unos ' + plural(e.clips, 'momento') + '.' : 'Guardado.');
  } catch (error) {
    alert(error.message);
  }
}

/*
 * Las tres operaciones de plantilla comparten forma: llaman, se quedan con la
 * respuesta y repintan. Se escriben juntas porque la respuesta del servidor
 * trae siempre la lista entera, asi que ninguna tiene que remendar el estado a
 * mano; el unico cuidado es no perder el resto de state.ajustes cuando la
 * respuesta solo trae la lista, que es el caso de borrar.
 */
async function plantillaAccion(url, options, exito) {
  try {
    const data = await api(url, options);
    state.ajustes = { ...state.ajustes, ...data };
    render();
    avisar(exito(data));
  } catch (error) {
    alert(error.message);
  }
}

function guardarPlantilla() {
  const input = document.getElementById('nombre-plantilla');
  const nombre = input.value.trim();
  if (!nombre) { input.focus(); return; }
  plantillaAccion(
    '/api/plantillas',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre }) },
    d => 'Plantilla "' + d.plantilla.nombre + '" guardada.',
  );
}

// --- Vista: plataformas ---------------------------------------------------

// --- Vista: proyectos -----------------------------------------------------

/*
 * Clientes y campañas.
 *
 * Dos niveles y un cajon de "sin asignar". El cajon no es un descuido: al
 * aplicar el esquema, veinte cuentas y ocho VOD ya existian sin dueño, y
 * obligar a colocarlos antes de poder usar la seccion habria sido pedir
 * veintiocho decisiones de golpe. Lo que no esta asignado se ve, molesta un
 * poco, y se coloca cuando toca.
 */
function opcionesCampana(campanas, elegida) {
  return '<option value="">Sin asignar</option>' + campanas.map(k =>
    '<option value="' + k.id + '"' + (k.id === elegida ? ' selected' : '') + '>' +
      esc(k.clienteNombre) + ' / ' + esc(k.nombre) +
    '</option>'
  ).join('');
}

/** "14:00" a partir de una hora entera. */
function hhmm(h) {
  return String(h).padStart(2, '0') + ':00';
}

/**
 * Opciones de un campo del perfil, con la herencia dicha en claro.
 *
 * El valor vacio es "General": hereda de Horarios. Se enseña entre parentesis
 * lo que eso significa hoy, porque "General" a secas obliga a ir a la otra
 * seccion para saber que implica.
 */
function opcionPerfil(actual, valores, heredado, etiqueta) {
  let html = '<option value=""' + (actual === null ? ' selected' : '') + '>' +
    'General (' + etiqueta(heredado) + ')</option>';
  for (const v of valores) {
    html += '<option value="' + v + '"' + (actual === v ? ' selected' : '') + '>' +
      esc(etiqueta(v)) + '</option>';
  }
  return html;
}

function vistaProyectos() {
  const d = state.proyectos;
  if (!d) return esqueleto(3, false);

  const sinCuenta = d.cuentas.filter(c => !c.clienteId);
  const sinVod = d.vods.filter(v => !v.campanaId);

  // Lo que hereda quien no tiene perfil propio. Si aun no se cargo Horarios se
  // usan los valores de fabrica, que son los mismos que trae settings.ts.
  const general = state.settings?.settings ?? { postsPerDay: 3, dayStartHour: 10, dayEndHour: 23 };

  const nuevo =
    '<article class="card"><div class="body">' +
      '<h3 class="t">Nuevo cliente</h3>' +
      '<div class="fila-nueva">' +
        '<input id="nuevo-cliente" type="text" maxlength="80" placeholder="Nombre del cliente" ' +
          'autocomplete="off" aria-label="Nombre del cliente nuevo">' +
        '<button class="chip" data-pcrear-cliente="1">Crear</button>' +
      '</div>' +
    '</div></article>';

  const fichas = d.clientes.map(c => {
    const suyas = d.campanas.filter(k => k.clienteId === c.id);
    const cuentas = d.cuentas.filter(x => x.clienteId === c.id);

    return '<article class="card' + (c.archivado ? ' flat' : '') + '"><div class="body">' +
      '<div class="plat">' +
        '<span class="nombre">' + esc(c.nombre) + '</span>' +
        (c.archivado ? '<span class="badge">archivado</span>' : '') +
      '</div>' +

      '<div class="stats" style="margin-top:var(--s3)">' +
        '<div><b>' + cuentas.length + '</b><span>Cuentas</span></div>' +
        '<div><b>' + suyas.length + '</b><span>Campañas</span></div>' +
        '<div><b>' + suyas.reduce((n, k) => n + k.vods, 0) + '</b><span>Videos</span></div>' +
      '</div>' +

      /*
       * Las cuentas, una por fila y no separadas por comas.
       *
       * En una linea de texto no cabe nada accionable: ni saber cual esta sin
       * enlazar, ni sacar una del cliente. Con veinte cuentas y dos clientes,
       * "acc-01, acc-04, acc-07" obliga a ir a otra seccion para cada gesto.
       */
      '<p class="reason" style="margin:var(--s4) 0 0">Cuentas de este cliente</p>' +
      (cuentas.length
        ? '<ul class="lista-campanas">' + cuentas.map(x =>
            '<li>' +
              '<span class="punto-estado ' + (x.tiktok ? 'si' : 'no') + '"></span>' +
              '<span class="nombre">' + esc(x.id) + '</span>' +
              (x.tiktok
                ? '<span class="badge ok">@' + esc(x.tiktok) + '</span>'
                : '<span class="badge">sin enlazar</span>') +
              (x.tiktok
                ? '<button class="chip" data-crevisar="' + esc(x.id) + '">Comprobar</button>'
                : '<button class="chip" data-cenlazar="' + esc(x.id) + '">Enlazar</button>') +
              '<button class="chip" data-psacar="' + esc(x.id) + '" ' +
                'aria-label="Quitar ' + esc(x.id) + ' de ' + esc(c.nombre) + '">Quitar</button>' +
            '</li>'
          ).join('') + '</ul>'
        : '<p class="reason" style="margin:var(--s2) 0 0">Ninguna. Asignale una desde "Sin asignar".</p>') +

      /*
       * El perfil del cliente.
       *
       * "General" (valor vacio) significa heredar lo de Horarios, y es lo que
       * trae un cliente nuevo. Por eso cada campo enseña entre parentesis el
       * valor heredado: sin eso, "General" no dice nada y hay que ir a la otra
       * seccion a averiguar que implica.
       */
      '<p class="reason" style="margin:var(--s4) 0 0">Su ritmo de publicación</p>' +
      '<ul class="lista-campanas">' +
        '<li><span class="nombre">Veces al día</span>' +
          '<select data-pperfil="' + c.id + '" data-campo="postsPerDay">' +
            opcionPerfil(c.perfil.postsPerDay, [1,2,3,4,5,6], general.postsPerDay, n => n + ' al día') +
          '</select></li>' +
        '<li><span class="nombre">Desde las</span>' +
          '<select data-pperfil="' + c.id + '" data-campo="dayStartHour">' +
            opcionPerfil(c.perfil.dayStartHour, [6,8,9,10,11,12,14], general.dayStartHour, hhmm) +
          '</select></li>' +
        '<li><span class="nombre">Hasta las</span>' +
          '<select data-pperfil="' + c.id + '" data-campo="dayEndHour">' +
            opcionPerfil(c.perfil.dayEndHour, [18,20,21,22,23,24], general.dayEndHour, hhmm) +
          '</select></li>' +
      '</ul>' +

      (suyas.length
        ? '<ul class="lista-campanas">' + suyas.map(k =>
            '<li>' +
              '<span class="nombre">' + esc(k.nombre) + '</span>' +
              '<span class="badge">' + plural(k.vods, 'video') + '</span>' +
              '<select data-pestado="' + k.id + '" aria-label="Estado de ' + esc(k.nombre) + '">' +
                ['activa', 'pausada', 'terminada'].map(e =>
                  '<option value="' + e + '"' + (k.estado === e ? ' selected' : '') + '>' + e + '</option>'
                ).join('') +
              '</select>' +
              '<button class="chip" data-pborrar-campana="' + k.id + '" ' +
                'aria-label="Borrar la campaña ' + esc(k.nombre) + '">Borrar</button>' +
            '</li>'
          ).join('') + '</ul>'
        : '<p class="reason" style="margin:var(--s3) 0 0">Sin campañas todavía.</p>') +

      '<div class="fila-nueva" style="margin-top:var(--s3)">' +
        '<input id="nueva-campana-' + c.id + '" type="text" maxlength="80" ' +
          'placeholder="Nombre de la campaña" autocomplete="off" ' +
          'aria-label="Campaña nueva para ' + esc(c.nombre) + '">' +
        '<button class="chip" data-pcrear-campana="' + c.id + '">Añadir campaña</button>' +
      '</div>' +

      '<div class="chips" style="margin-top:var(--s3)">' +
        '<button class="chip" data-parchivar="' + c.id + '" data-valor="' + (c.archivado ? '0' : '1') + '">' +
          (c.archivado ? 'Desarchivar' : 'Archivar') +
        '</button>' +
        '<button class="chip" data-pborrar-cliente="' + c.id + '">Borrar</button>' +
      '</div>' +
    '</div></article>';
  }).join('');

  const pendientes = (sinCuenta.length || sinVod.length)
    ? '<article class="card"><div class="body">' +
        '<h3 class="t">Sin asignar</h3>' +

        (sinCuenta.length
          ? '<p class="reason">Cuentas</p><ul class="lista-campanas">' + sinCuenta.map(x =>
              '<li>' +
                '<span class="nombre">' + esc(x.id) + (x.tiktok ? ' (@' + esc(x.tiktok) + ')' : '') + '</span>' +
                '<select data-pasignar-cuenta="' + esc(x.id) + '" aria-label="Cliente de ' + esc(x.id) + '">' +
                  '<option value="">Sin asignar</option>' +
                  d.clientes.filter(c => !c.archivado).map(c =>
                    '<option value="' + c.id + '">' + esc(c.nombre) + '</option>'
                  ).join('') +
                '</select>' +
              '</li>'
            ).join('') + '</ul>'
          : '') +

        (sinVod.length
          ? '<p class="reason" style="margin-top:var(--s3)">Videos de origen</p>' +
            '<ul class="lista-campanas">' + sinVod.map(v =>
              '<li>' +
                '<span class="nombre">' + esc(v.title.slice(0, 44)) + '</span>' +
                '<select data-pasignar-vod="' + esc(v.sourceId) + '" aria-label="Campaña de ' + esc(v.title) + '">' +
                  opcionesCampana(d.campanas, null) +
                '</select>' +
              '</li>'
            ).join('') + '</ul>'
          : '') +
      '</div></article>'
    : '';

  return nuevo + fichas + pendientes +
    '<article class="card flat"><div class="body">' +
      '<details class="nota"><summary>Cómo se reparte cada cosa</summary>' +
        '<p>Las <b>cuentas</b> cuelgan del cliente y las <b>campañas</b> agrupan sus videos. ' +
        'Es a proposito: una cuenta de TikTok sigue siendo suya entre lanzamientos, y colgarla ' +
        'de la campaña obligaria a volver a autorizarla cada vez que empieza una nueva.</p>' +
        '<p>Borrar un cliente <b>no borra sus cuentas</b>: quedan sin asignar y conservan su ' +
        'permiso de TikTok. Los videos tampoco se borran.</p>' +
      '</details>' +
    '</div></article>';
}

// --- Vista: cuentas -------------------------------------------------------

/*
 * Cuantas cuentas publican frente a las que paga el plan.
 *
 * El tope sale de la configuracion (Horarios, plan del proveedor), nunca de un
 * numero escrito aqui: con pocas cuentas no tiene que parecer que faltan.
 */
function medidorCuentas() {
  const d = state.proyectos;
  const tope = state.settings?.settings?.maxCuentas;
  if (!d) return '';
  const total = d.cuentas.length;
  const activas = d.cuentas.filter(c => c.activa).length;
  const conTope = Number.isFinite(tope) && tope > 0;
  const pct = conTope ? Math.min(100, Math.round((activas / tope) * 100)) : 100;
  return '<article class="card medidor"><div class="body">' +
    '<div class="medidor-cab">' +
      '<span><b class="dato">' + activas + '</b>' + (conTope ? ' de <span class="dato">' + tope + '</span>' : '') +
        (activas === 1 ? ' cuenta publica' : ' cuentas publican') + '</span>' +
      (total > activas ? '<span class="reason" style="margin:0">' + plural(total - activas, 'cuenta pausada', 'cuentas pausadas') + '</span>' : '') +
    '</div>' +
    '<span class="medidor-barra" role="img" aria-label="' + activas + (conTope ? ' de ' + tope : '') + ' cuentas"><i style="width:' + pct + '%"></i></span>' +
    (conTope && tope - total > 0
      ? '<p class="reason" style="margin:var(--s2) 0 0">Tu plan admite ' + plural(tope - total, 'cuenta más', 'cuentas más') + '.</p>'
      : '') +
    revisionPlan(activas, tope) +
  '</div></article>';
}

/**
 * Revision del plan (Fase 7): cuantas cuentas publican de verdad frente a las
 * que se pagan, y si un plan mas barato bastaria.
 *
 * "Publican" son las activas: con upload-post no hay forma de saber desde
 * aqui si el perfil existe al otro lado, y las pausadas no reciben nada.
 * Solo se sugiere bajar si sobra al menos la mitad del cupo: con un margen
 * pequeño cambiar de plan por unos dolares no compensa.
 */
function revisionPlan(activas, tope) {
  const planes = state.settings?.planes ?? [];
  const actual = planes.find(p => p.perfiles === tope);
  if (!actual || activas === 0) return '';
  const basta = planes.filter(p => p.perfiles >= activas && !p.aviso).sort((x, y) => x.usd - y.usd)[0];
  if (!basta || basta.usd >= actual.usd || activas > tope / 2) return '';
  return '<p class="warn" style="margin:var(--s3) 0 0">Pagas el plan <b>' + esc(actual.nombre) + '</b> (' +
    actual.perfiles + ' cuentas, ' + actual.usd + ' USD al mes) y publican ' + activas + '. ' +
    'Con <b>' + esc(basta.nombre) + '</b> (' + basta.perfiles + ' cuentas) pagarías ' + basta.usd +
    ' USD al mes. Si cambias de plan en upload-post, elígelo también en Horarios.</p>';
}

function vistaPlataformas() {
  const d = state.plataformas;
  if (!d) return esqueleto(3, false);

  const punto = { conectado: 'si', 'sin-conectar': 'no', 'no-disponible': 'nada' };
  const etiqueta = { conectado: 'Conectado', 'sin-conectar': 'Sin conectar', 'no-disponible': 'Próximamente' };
  const clase = { conectado: 'ok', 'sin-conectar': '', 'no-disponible': '' };

  return medidorCuentas() + '<div class="plataformas-fila cascada">' + d.plataformas.map(p =>
    '<article class="card plataforma ' + p.estado + '"><div class="body">' +
      '<div class="plat">' +
        '<span class="punto-estado ' + punto[p.estado] + '"></span>' +
        '<span class="nombre">' + esc(p.nombre) + '</span>' +
        '<span class="badge ' + clase[p.estado] + '">' + etiqueta[p.estado] + '</span>' +
      '</div>' +

      (p.estado === 'conectado'
        ? '<div class="stats" style="margin-top:var(--s3)">' +
            '<div><b>' + p.cuentas + '</b><span>Cuentas</span></div>' +
            '<div><b>' + p.publicaciones + '</b><span>Subidos</span></div>' +
            '<div><b>' + hora(p.ultima) + '</b><span>Último</span></div>' +
          '</div>'
        : '') +

      (p.nota ? '<p class="reason" style="margin:var(--s3) 0 0">' + esc(p.nota) + '</p>' : '') +

    '</div></article>'
  ).join('') + '</div>' + listaCuentas() +

  '<article class="card flat"><div class="body">' +
    '<details class="nota"><summary>Qué pasa al enlazar una cuenta</summary>' +
      '<p>El programa <b>nunca ve tu contraseña</b>. Al pulsar Enlazar se abre tiktok.com, ' +
      'escribes la clave allí, y lo que vuelve es un permiso revocable desde los ajustes ' +
      'de esa misma cuenta.</p>' +
      '<p>Usa una <b>ventana de incognito</b> para cada cuenta. Si ya tienes otra sesión de ' +
      'TikTok abierta, TikTok autorizara esa sin preguntarte cual.</p>' +
      '<p><b>Comprobar</b> pregunta a TikTok por el perfil. Sirve para ver que el permiso ' +
      'sigue vivo y para refrescar el @. No dice si la app paso la auditoria: eso solo lo ' +
      'revela intentar una publicación directa.</p>' +
    '</details>' +
  '</div></article>';
}

/*
 * Una fila por cuenta, con su estado de enlace.
 *
 * Se apoya en state.proyectos y no en /api/plataformas porque aquel resumen
 * cuenta publicaciones por proveedor y no sabe que cuenta es cual. Las dos se
 * piden juntas al entrar en la seccion.
 */
function listaCuentas() {
  const d = state.proyectos;
  if (!d) return '';

  const nombre = {};
  for (const c of d.clientes) nombre[c.id] = c.nombre;

  /*
   * El punto verde es "entra en el reparto", no "tiene TikTok enlazado".
   *
   * Antes marcaba el enlace con TikTok, y eso solo significa algo cuando se
   * publica por la API propia. Con upload-post, doce cuentas perfectamente
   * utilizables salian en gris y con un boton de "Enlazar" que no hacia falta,
   * mientras que lo unico que de verdad decide si reciben videos (estar activa)
   * no se veia por ninguna parte.
   */
  // El proveedor viene de /api/plataformas, que esta vista pide a la vez que
  // /api/proyectos. De ahi que se lea de state.plataformas y no de la variable d.
  const porUploadPost = (state.plataformas?.proveedor ?? 'upload-post') === 'upload-post';
  const activas = d.cuentas.filter(c => c.activa).length;

  /*
   * A partir del umbral, la tarjeta cruza las dos columnas.
   *
   * Cada fila lleva hasta cinco botones. En media columna no caben y
   * "Desenlazar" se iba a una segunda linea en CADA fila, asi que cincuenta
   * cuentas eran cien renglones. Con pocas cuentas las filas son cortas y
   * ocupar el ancho entero solo dejaria hueco a la derecha.
   */
  const anchoEntero = d.cuentas.length >= CUENTAS_UMBRAL;

  return '<article class="card' + (anchoEntero ? ' ancho' : '') + '"><div class="body">' +
    '<h3 class="t">Cuentas</h3>' +
    /*
     * Cuantas maneja el programa, aqui mismo.
     *
     * Antes el numero se fijaba una sola vez por consola, al crear las cuentas,
     * y cambiarlo pedia una terminal en el ordenador de casa.
     */
    /*
     * Cuantas caben todavia, antes de ofrecer crear.
     *
     * El desplegable ofrecia crear hasta diez sin mirar el tope, y el
     * servidor las rechazaba despues con un error. Decir el hueco que queda
     * ANTES de pulsar evita el viaje entero, y de paso recuerda que el limite
     * no lo pone este programa sino el plan contratado.
     */
    (() => {
      // state.settings es la respuesta entera de /api/settings; los ajustes
      // van dentro, en .settings.
      const tope = state.settings?.settings?.maxCuentas;
      if (!Number.isFinite(tope)) return '';
      const libres = Math.max(0, tope - d.cuentas.length);
      return '<p class="reason" style="margin:0 0 var(--s3)">' +
        d.cuentas.length + ' de ' + plural(tope, 'cuenta') + ' de tu plan. ' +
        (libres === 0
          ? 'No queda hueco: sube de plan en upload-post y elige el nuevo en Horarios.'
          : 'Te quedan ' + plural(libres, 'cuenta') + ' por crear.') +
      '</p>';
    })() +

    '<div class="linea ancha" style="margin-bottom:var(--s4)">' +
      '<span>Añadir cuentas</span>' +
      '<span style="display:flex;gap:8px;align-items:center">' +
        '<select id="cuantas-cuentas">' +
          /*
           * Solo se ofrecen cantidades que caben.
           *
           * Ofrecer "10" con dos huecos libres es ofrecer un error. Si no
           * cabe ninguna, queda la opcion de 1 y el servidor da el mensaje
           * con el nombre del plan, que es donde se explica que hacer.
           */
          [1, 2, 3, 5, 10]
            .filter((n, i) => i === 0 ||
              n <= Math.max(1, (state.settings?.settings?.maxCuentas ?? 0) - d.cuentas.length))
            .map(n => '<option value="' + n + '">' + n + '</option>').join('') +
        '</select>' +
        '<button class="chip" id="crear-cuentas">Crear</button>' +
      '</span>' +
    '</div>' +
    '<p class="reason" style="margin-top:0">' +
      (porUploadPost
        ? 'Se publica por <b>upload-post</b>. Reciben videos las <b>' + activas + '</b> cuentas ' +
          'activas, y cada una necesita un perfil con ese mismo nombre dado de alta allí. ' +
          'Pausa las que no tengan perfil o fallaran una por una.'
        : 'Se publica por la <b>API de TikTok</b>. Solo reciben videos las cuentas activas ' +
          'que además hayan autorizado la app.') +
    '</p>' +
    /*
     * Herramientas solo a partir del umbral. Ver CUENTAS_UMBRAL.
     */
    (d.cuentas.length >= CUENTAS_UMBRAL ? herramientasCuentas(d.cuentas, d.clientes ?? []) : '') +
    (d.cuentas.length >= CUENTAS_UMBRAL ? loteCuentas(d.clientes ?? []) : '') +
    (() => {
      const visibles = d.cuentas.length >= CUENTAS_UMBRAL
        ? cuentasVisibles(d.cuentas)
        : d.cuentas;
      if (visibles.length === 0) {
        return '<p class="reason" style="margin:var(--s3) 0 0">' +
          'Ninguna cuenta con esos filtros.</p>';
      }
      const conCasilla = d.cuentas.length >= CUENTAS_UMBRAL;
      const pintadas = visibles.slice(0, CUENTAS_MAX_FILAS);
      const ocultas = visibles.length - pintadas.length;
      return (conCasilla && visibles.length > 1
          ? '<p class="reason" style="margin:var(--s3) 0 0">' +
            visibles.length + ' de ' + d.cuentas.length + '. ' +
            // "Marcar las N" marca TODAS las que pasan el filtro, no solo las
            // que caben en pantalla: lo que se ha filtrado es lo que se
            // quiere, y obligar a desplegarlas para poder marcarlas seria
            // deshacer el recorte.
            '<button class="enlace" data-ctodas>Marcar las ' + visibles.length + '</button></p>'
          : '') +
        gruposCuentas(pintadas, d.clientes ?? [], nombre, porUploadPost, conCasilla) +
        (ocultas > 0
          ? '<p class="reason" style="margin:var(--s3) 0 0">' +
            'Y ' + plural(ocultas, 'cuenta') + ' más. Busca o filtra para verlas.</p>'
          : '');
    })() +
  '</div></article>';
}

// --- Vista: metricas ------------------------------------------------------

function vistaMetricas() {
  const m = state.metrics;
  if (!m) return esqueleto(2, true);

  if (m.published === 0) {
    return '<div class="card"><div class="body">' +
      '<p class="hook">Aún no se ha publicado nada</p>' +
      '<p class="reason" style="margin-bottom:0">' +
        ((state.overview?.accounts ?? 0) > 0
          ? 'Esto se llena cuando salgan los primeros clips de la agenda.'
          : 'Esto se llena cuando salgan los primeros clips. Primero enlaza una cuenta en Cuentas.') +
      '</p>' +
    '</div></div>' +
    '<div class="card"><div class="body">' +
      '<div class="chips">' +
        '<button class="chip primario" data-run="metrics">Actualizar</button>' +
      '</div>' +
    '</div></div>';
  }

  /*
   * Publicado pero sin medir: hay que decir POR QUE.
   *
   * Sin esto la seccion enseña una tabla con ceros en todas las filas, que se
   * lee como "tus videos no los ve nadie" cuando en realidad significa "aun no
   * hemos podido preguntarlo". Son cosas opuestas y la diferencia importa.
   *
   * Las dos causas reales, en orden de probabilidad:
   *
   *  1. Falta el permiso video.list. Las autorizaciones actuales piden
   *     user.info.basic, video.upload y video.publish. Leer cifras necesita
   *     ademas video.list, y un permiso no se amplia solo: hay que añadirlo en
   *     el portal y volver a autorizar cada cuenta.
   *  2. El video sigue en la bandeja de entrada. Mientras nadie lo publique
   *     desde el movil no existe como publicacion y no tiene estadisticas.
   */
  const sinMedir = m.snapshots === 0;

  return (sinMedir
    ? '<div class="card"><div class="body"><div class="warn" style="margin:0">' +
        '<b>Hay ' + m.published + ' video(s) entregados pero ninguna medicion.</b> ' +
        'Los ceros de abajo no significan que nadie los vea: significan que todavía ' +
        'no hemos podido preguntarle a TikTok.' +
      '</div>' +
      '<details class="nota" style="margin-top:var(--s3)"><summary>Qué falta para tener cifras</summary>' +
        '<p><b>El permiso de lectura.</b> Las cuentas están autorizadas para publicar, ' +
        'pero no para leer estadísticas. Eso es otro permiso (<i>video.list</i>) que hay ' +
        'que añadir en el portal de TikTok y después volver a autorizar cada cuenta: ' +
        'un permiso ya concedido no se amplia solo.</p>' +
        '<p><b>Y que esten publicados de verdad.</b> Un video que sigue esperando en la ' +
        'bandeja de entrada del móvil no es una publicación todavía, así que no tiene ' +
        'cifras que consultar.</p>' +
      '</details>' +
    '</div></div>'
    : '') +
    resumenSemanal(m.semana) +
    '<div class="card"><div class="stats">' +
      '<div><b>' + m.published + '</b><span>Subidos</span></div>' +
      '<div><b>' + m.snapshots + '</b><span>Mediciones</span></div>' +
      '<div><b>' + hora(m.lastCapture) + '</b><span>Última</span></div>' +
    '</div></div>' +
    tablaResultados(m);
}

/** Esta semana contra la anterior (Fase 7). */
function resumenSemanal(s) {
  if (!s) return '';
  const cifra = (clave, nombre) => {
    const a = s.actual[clave];
    const b = s.anterior[clave];
    const cambio = b > 0 ? Math.round(((a - b) / b) * 100) : null;
    return '<div><b>' + a.toLocaleString('es') + '</b><span>' + nombre +
      (cambio === null ? '' : ' · <span class="' + (cambio >= 0 ? 'sube' : 'baja') + '">' +
        (cambio >= 0 ? '+' : '') + cambio + ' %</span>') + '</span></div>';
  };
  return '<div class="card"><div class="body" style="padding-bottom:0">' +
      '<p class="ante">Esta semana</p>' +
      '<p class="reason" style="margin:0">' + plural(s.actual.posts, 'clip publicado', 'clips publicados') +
        ' en los últimos 7 días' + (s.anterior.posts > 0 ? ', comparado con la semana anterior' : '') + '.</p>' +
    '</div>' +
    '<div class="stats">' + cifra('views', 'Vistas') + cifra('likes', 'Me gusta') + cifra('comments', 'Comentarios') + '</div>' +
  '</div>';
}

/**
 * La tabla, por clip o por cuenta, ordenable por cualquier columna (Fase 7).
 * El orden se recuerda en state mientras dure la sesion.
 */
function tablaResultados(m) {
  const vista = state.metricasVista || 'clip';
  const orden = state.metricasOrden || { col: 'views', dir: -1 };
  const filas = (vista === 'cuenta' ? (m.byAccount || []) : m.byClip).slice();
  filas.sort((a, b) => {
    const x = a[orden.col];
    const y = b[orden.col];
    const c = typeof x === 'string' ? String(x).localeCompare(String(y), 'es') : (x ?? 0) - (y ?? 0);
    return c * orden.dir;
  });
  const col = (clave, texto) =>
    '<th><button class="orden' + (orden.col === clave ? ' activo' : '') + '" data-morden="' + clave + '"' +
      ' aria-sort="' + (orden.col === clave ? (orden.dir < 0 ? 'descending' : 'ascending') : 'none') + '">' +
      texto + (orden.col === clave ? (orden.dir < 0 ? ' ↓' : ' ↑') : '') + '</button></th>';
  const num = n => '<td class="dato">' + (n ?? 0).toLocaleString('es') + '</td>';
  return '<div class="card">' +
    '<div class="body" style="padding-bottom:0"><div class="segmento" role="tablist" aria-label="Ver resultados">' +
      '<button role="tab" data-mvista="clip" aria-selected="' + (vista === 'clip') + '">Por clip</button>' +
      '<button role="tab" data-mvista="cuenta" aria-selected="' + (vista === 'cuenta') + '">Por cuenta</button>' +
    '</div></div>' +
    '<div class="tabla-desliza"><table>' +
      '<tr>' +
        (vista === 'cuenta' ? col('accountId', 'Cuenta') : col('clipId', 'Clip') + col('score', 'Nota')) +
        col('posts', 'Veces') + col('views', 'Vistas') + col('likes', 'Me gusta') + col('comments', 'Comentarios') +
      '</tr>' +
      filas.map(c =>
        '<tr>' +
          (vista === 'cuenta'
            ? '<td>' + esc(c.alias || c.accountId) + (c.alias ? '<br><span class="sub">' + esc(c.accountId) + '</span>' : '') + '</td>'
            // El titulo del video debajo del clip: sin el, dos 'clip-01' de
            // videos distintos se leen como el mismo.
            : '<td>' + esc(c.clipId) +
                (c.fuente ? '<br><span class="sub">' + esc(String(c.fuente).slice(0, 30)) + '</span>' : '') + '</td>' +
              '<td class="score' + (c.score >= 60 ? ' alto' : '') + '">' + c.score + '</td>') +
          num(c.posts) + num(c.views) + num(c.likes) + num(c.comments) +
        '</tr>'
      ).join('') +
    '</table></div></div>';
}

document.addEventListener('click', e => {
  const v = e.target.closest('[data-mvista]');
  if (v) { state.metricasVista = v.dataset.mvista; render(); return; }
  const o = e.target.closest('[data-morden]');
  if (o) {
    const actual = state.metricasOrden || { col: 'views', dir: -1 };
    const col = o.dataset.morden;
    // Texto de menos a mas; cifras de mas a menos, que es lo que se busca.
    const texto = col === 'clipId' || col === 'accountId';
    state.metricasOrden = actual.col === col ? { col, dir: -actual.dir } : { col, dir: texto ? 1 : -1 };
    render();
  }
});

// --- Pintado --------------------------------------------------------------

function render() {
  renderTabs();
  const seccion = SECCION_DE[state.view] ?? 'inicio';
  const vistas = SECCIONES[seccion].vistas;

  /*
   * El titulo es el de la pestaña cuando la seccion tiene varias.
   *
   * Poner siempre "Ajustes" dejaria cinco pantallas distintas con el mismo
   * encabezado, que es como no tener encabezado.
   */
  const etiqueta = vistas.find(([v]) => v === state.view)?.[1];
  document.getElementById('title').textContent =
    state.view === 'vod'
      // El detalle no esta en la lista de vistas de la seccion: su titulo es
      // el del propio video, que es lo que estas mirando.
      ? (state.vod?.title ?? 'Video')
      : (vistas.length > 1 && etiqueta !== SECCIONES[seccion].titulo
          ? SECCIONES[seccion].titulo + ' / ' + etiqueta
          : SECCIONES[seccion].titulo);

  for (const b of document.querySelectorAll('nav button[data-seccion]')) {
    b.setAttribute('aria-current', String(b.dataset.seccion === seccion));
  }

  // Pendientes de revisar, en el propio menu. Con el menu cerrado ya no se ve
  // el contador, asi que sin esto no hay forma de saber que hay trabajo.
  const pend = document.getElementById('pend');
  const n = state.overview?.clips.pending ?? state.counts.pending;
  pend.hidden = !n;
  if (n) {
    /*
     * Animar solo el cambio, no el repintado.
     *
     * render() corre cada vez que llega un aviso del servidor, casi siempre con
     * el mismo numero. El valor anterior se guarda en el propio nodo para no
     * llevar otra variable de estado por esto.
     *
     * El reflow forzado (offsetWidth) es lo que permite repetir la animacion:
     * sin el, quitar y poner la clase en el mismo fotograma no reinicia nada
     * porque el navegador agrupa los dos cambios y no ve diferencia.
     */
    const antes = pend.dataset.n;
    pend.textContent = n;
    if (antes !== undefined && antes !== String(n)) {
      pend.classList.remove('cambia');
      void pend.offsetWidth;
      pend.classList.add('cambia');
    }
    pend.dataset.n = String(n);
  }

  const view = document.getElementById('view');
  // La vista en el propio contenedor: hay pantallas que necesitan otra rejilla
  // y el CSS no puede saber cual se esta pintando de otra forma.
  view.className = 'vista-' + state.view;

  /*
   * Cambiar de pantalla empieza arriba.
   *
   * render() tambien corre al refrescar datos SIN cambiar de vista -- cada
   * aviso del servidor dispara uno -- y ahi subir seria intolerable: estas a
   * media lista de clips y la pagina salta al principio sola. Por eso se
   * compara con la ultima pintada y solo se sube cuando de verdad cambio.
   */
  /*
   * Las entradas animadas, solo al LLEGAR a una pantalla.
   *
   * render() corre tambien en cada aviso del servidor, varias veces por
   * minuto. Si las tarjetas entraran otra vez en cada uno, la pantalla
   * parpadearia sin que nada haya cambiado.
   */
  view.classList.toggle('quieto', render.ultima === state.view);
  if (render.ultima !== state.view) {
    render.ultima = state.view;
    scrollTo({ top: 0, behavior: 'instant' });
    /*
     * El desvanecido de entrada, reiniciado a mano.
     *
     * Quitar y poner la clase en el mismo fotograma no reinicia nada: el
     * navegador agrupa los dos cambios y no ve diferencia. El reflow forzado
     * (offsetWidth) es lo que separa los dos estados. Es el mismo truco que
     * usa el contador de pendientes del menu.
     */
    view.classList.remove('cambia');
    void view.offsetWidth;
    view.classList.add('cambia');
  }

  /*
   * Pestañas de la seccion, solo si hay mas de una.
   *
   * Se pintan dentro de #view y no en el encabezado para que hereden el ancho
   * de la columna de contenido: en el encabezado se irian al borde de la
   * pantalla y quedarian lejos de lo que cambian.
   */
  // En el detalle no hay pestañas: no es una vista hermana de las de Inicio,
  // esta por debajo, y el rastro de migas ya dice donde estas.
  const subtabs = vistas.length > 1 && state.view !== 'vod'
    ? '<div class="subtabs" role="tablist">' + vistas.map(([v, etiq]) =>
        '<button class="subtab" role="tab" aria-selected="' + (v === state.view) + '"' +
        ' data-subvista="' + v + '">' + etiq + '</button>').join('') + '</div>'
    : '';

  if (state.view === 'proceso') view.innerHTML = vistaProceso();
  if (state.view === 'videos') view.innerHTML = vistaVideos();
  animarCifras();
  pintarEstadoMenu();
  if (state.view === 'clips') view.innerHTML = vistaClips();
  if (state.view === 'cola') view.innerHTML = vistaCola();
  if (state.view === 'registro') view.innerHTML = pintarProcesador(state.sistema) + pintarAlertas(state.sistema) + pintarAuditoria(state.auditoria) + vistaRegistro();
  if (state.view === 'ia') view.innerHTML = vistaIA();
  if (state.view === 'usuarios') view.innerHTML = vistaUsuarios();
  if (state.view === 'flujo') view.innerHTML = vistaFlujo();
  if (state.view === 'ajustes') view.innerHTML = vistaAjustes();
  if (state.view === 'proyectos') view.innerHTML = vistaProyectos();
  if (state.view === 'plataformas') view.innerHTML = vistaPlataformas();
  if (state.view === 'metricas') view.innerHTML = vistaMetricas();
  if (state.view === 'vod') view.innerHTML = vistaVod();

  /*
   * Una linea al entrar que diga que es esta pantalla.
   *
   * El titulo de la cabecera dice "Agenda" o "Revisar", y eso no basta para
   * quien abre el panel por primera vez: un cliente que entra a aprobar sus
   * videos no sabe si "Agenda" son sus citas o lo que esta por salir.
   *
   * Va dentro de #view y no en la cabecera porque la cabecera es estrecha y
   * fija, y aqui hereda el ancho del contenido.
   */
  const intro = INTROS[state.view];
  if (intro) {
    view.insertAdjacentHTML('afterbegin',
      '<p class="intro ancho">' + esc(intro) + '</p>');
  }

  if (subtabs !== '') view.insertAdjacentHTML('afterbegin', subtabs);

  pintarAvisos();

  /*
   * La linea de atajos solo cuando hay algo que decidir.
   *
   * Con la lista vacia salia "0 videos" y, al lado, como aprobar y rechazar
   * con el teclado. Debajo de un "Todo revisado" eso son instrucciones para
   * un trabajo que no existe, y encima la unica linea de texto suelta de la
   * pantalla, flotando sin caja.
   */
  const hint = document.getElementById('hint');
  const hayClips = state.view === 'clips' && state.clips.length > 0;
  hint.className = 'hint' + (hayClips ? ' kbd' : '');
  hint.textContent = hayClips ? plural(state.clips.length, 'video') : '';

  if (state.view === 'clips') { lazyLoadVideos(); pintarSeleccion(); }
  /*
   * La vista previa necesita dos cosas despues de pintar el HTML.
   *
   * El texto de la publicacion se calcula en JavaScript (lleva deduplicado de
   * etiquetas y limpieza), asi que no cabe en la cadena del render. Y el video
   * usa el mismo cargado diferido que las tarjetas de Revisar: el src se pone
   * al entrar en pantalla, no antes, para no descargar un MP4 cada vez que se
   * repinta por tocar una perilla.
   */
  if (state.view === 'ajustes') {
    const destino = document.getElementById('pv-texto');
    if (destino && state.ajustes?.muestra) {
      destino.textContent = textoPublicacion(state.ajustes.ajustes, state.ajustes.muestra);
    }
    lazyLoadVideos();
  }
  if (state.openLog) pintarLog(state.openLog);

  /*
   * El ajuste que pidio el buscador: se lleva a la vista y se resalta.
   *
   * Se consume al usarlo (state.resaltar = null) para que un refresco
   * posterior -- y llegan solos cada vez que el servidor avisa de algo -- no
   * vuelva a saltar a esa perilla mientras tocas otra.
   */
  if (state.resaltar) {
    const campo = document.querySelector(
      '[data-ajuste="' + CSS.escape(state.resaltar) + '"], [data-set="' + CSS.escape(state.resaltar) + '"]',
    );
    state.resaltar = null;
    if (campo) {
      const fila = campo.closest('.linea') ?? campo;
      fila.classList.add('resaltado');
      fila.scrollIntoView({ block: 'center', behavior: comoDesplazar() });
      campo.focus({ preventScroll: true });
      // El resalte se va solo: dejarlo puesto convertiria una ayuda para
      // encontrar algo en una marca permanente sin significado.
      setTimeout(() => fila.classList.remove('resaltado'), 2200);
    }
  }
}

// --- Video diferido -------------------------------------------------------

// Carga el video solo cuando su tarjeta esta cerca de la pantalla.
//
// Se usa una comprobacion sobre scroll en lugar de IntersectionObserver a
// proposito. IO es mas elegante, pero depende de que el navegador produzca
// frames: en entornos sin composicion real (renderizado headless, pestañas en
// segundo plano) el callback no llega nunca y ningun video se carga. Medir la
// posicion a mano son diez lineas y funciona siempre.
const MARGIN = 300;

function loadVisibleVideos() {
  for (const v of document.querySelectorAll('video[data-src]')) {
    if (v.src) continue;
    const r = v.getBoundingClientRect();
    if (r.bottom > -MARGIN && r.top < innerHeight + MARGIN) {
      v.src = v.dataset.src;
      v.preload = 'metadata';
    }
  }
}

function lazyLoadVideos() {
  loadVisibleVideos();
  // Dos videos sonando a la vez hacen la revision inutil.
  for (const v of document.querySelectorAll('video')) {
    v.addEventListener('play', () => {
      for (const other of document.querySelectorAll('video')) {
        if (other !== v) other.pause();
      }
    });
  }
}

addEventListener('scroll', loadVisibleVideos, { passive: true });
addEventListener('resize', loadVisibleVideos);

// --- Acciones -------------------------------------------------------------

async function decide(card, status) {
  const caption = card.querySelector('.caption')?.value ?? '';
  const tags = (card.querySelector('.tags')?.value ?? '')
    .split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);

  await fetch('/api/clips/' +
    encodeURIComponent(card.dataset.source) + '/' + encodeURIComponent(card.dataset.clip), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, caption, hashtags: tags }),
  });

  /*
   * La tarjeta decidida se va hacia un lado, no se apaga.
   *
   * Desvanecerse no dice nada: aprobar y descartar se veian exactamente igual,
   * asi que no habia forma de saber que habia registrado el panel salvo
   * esperar a que el contador cambiara. Saliendo hacia la derecha lo aprobado y
   * hacia la izquierda lo descartado, la direccion confirma la decision antes
   * de que llegue ninguna respuesta.
   *
   * Quien pidio menos movimiento no ve el desplazamiento: la regla global deja
   * la animacion en 0,01 ms. Por eso el refresco NO espera a que termine la
   * animacion, sino un tiempo fijo corto: si esperase al evento de fin, con
   * movimiento reducido llegaria igual y con animaciones desactivadas del todo
   * en el navegador no llegaria nunca.
   */
  card.style.setProperty('--sale', status === 'approved' ? '18px' : '-18px');
  card.style.animation = 'resuelta var(--m-rapido) var(--e-salida) forwards';
  setTimeout(refrescar, 180);
}

async function lanzar(kind, params) {
  try {
    const r = await api('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, params: params ?? {} }),
    });
    /*
     * Se confirma lo que acaba de pasar, y se distingue encolar de empezar.
     *
     * Un aviso en vez de nada: el boton deja de verse pulsado y la tarea
     * aparece en la lista, pero si el ordenador esta apagado la lista no se
     * mueve y eso se lee como que no funciono. Decirlo aqui es la diferencia
     * entre "esta roto" y "esta esperando".
     */
    if (r?.trabajador && !r.trabajador.vivo) {
      avisar('Apuntado. Empezará en cuanto enciendas el ordenador que procesa los videos.');
    }
  } catch (error) {
    avisar(error.message);
  }
  await refrescar();
}

async function pintarLog(id) {
  const el = document.getElementById('log-' + id);
  if (!el) return;
  try {
    const job = await api('/api/jobs/' + id);
    el.textContent = job.lines.join('\\n') || '(sin salida)';
    el.scrollTop = el.scrollHeight;
  } catch {
    el.textContent = '(no se pudo leer la salida)';
  }
}

document.addEventListener('click', async e => {
  if (e.target.closest('#menu')) { menu(document.getElementById('mas').hidden); return; }
  if (e.target.id === 'fondo') { menu(false); return; }

  if (e.target.closest('#campana')) { abrirAvisos(!state.avisos); return; }

  /*
   * Un clic fuera cierra el panel de avisos.
   *
   * Sin velo de fondo a proposito: el velo del menu oscurece la pagina entera,
   * y eso para una lista de seis lineas es desproporcionado. La contrapartida
   * es que hay que cerrar a mano, y este es ese "a mano". Va antes que todo lo
   * demas para que el clic que cierra tambien haga lo que sea que pulsaste.
   */
  if (state.avisos && !e.target.closest('#avisos')) abrirAvisos(false);

  /*
   * El menu lleva a secciones; dentro de una seccion se recuerda donde estabas.
   *
   * Sin la memoria, quien mira Resultados y va a Ajustes vuelve a Agenda y cae
   * otra vez en Calendario. Con cinco pestañas dentro de Ajustes eso se nota.
   */
  // Abrir un video por su nombre, desde la lista de Inicio.
  const vod = e.target.closest('[data-vod]');
  if (vod) { abrirVod(vod.dataset.vod); return; }

  // Del menu y tambien de 'Mas opciones' (en el movil, Ajustes vive ahi).
  const nav = e.target.closest('#nav button[data-seccion], #mas button[data-seccion]');
  if (nav) {
    const id = nav.dataset.seccion;
    const vistas = SECCIONES[id].vistas;
    const recordada = state.ultimaVista[id];
    state.view = vistas.some(([v]) => v === recordada) ? recordada : vistas[0][0];
    state.openLog = null;
    menu(false);
    refrescar();
    return;
  }

  // La IA estaba en pausa: quitarla y devolver a la cola lo que esperaba.
  const iaReintentar = e.target.closest('[data-ia-reintentar]');
  if (iaReintentar) {
    iaReintentar.disabled = true;
    try {
      const r = await api('/api/ia/reintentar', { method: 'POST' });
      avisar(r.reanudadas > 0
        ? (r.reanudadas === 1 ? '1 tarea vuelve a la cola.' : r.reanudadas + ' tareas vuelven a la cola.')
        : 'Listo. La próxima tarea volverá a probar la IA.');
    } catch (err) {
      avisar(err.message);
    }
    refrescar();
    return;
  }

  // Un grupo de fallos iguales: reintentar una vez, o quitarlo de Inicio.
  const grupo = e.target.closest('[data-grupo-reintentar], [data-grupo-descartar]');
  if (grupo) {
    const reintentar = grupo.hasAttribute('data-grupo-reintentar');
    const ids = (reintentar ? grupo.dataset.grupoReintentar : grupo.dataset.grupoDescartar).split(',');
    grupo.disabled = true;
    try {
      await api(reintentar ? '/api/jobs/reintentar' : '/api/jobs/descartar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      avisar(reintentar ? 'Se vuelve a intentar.' : 'Quitado de Inicio. Sigue en Ajustes, Sistema.');
    } catch (err) {
      avisar(err.message);
    }
    refrescar();
    return;
  }

  const subtab = e.target.closest('[data-subvista]');
  if (subtab) {
    state.view = subtab.dataset.subvista;
    state.ultimaVista[SECCION_DE[state.view]] = state.view;
    state.openLog = null;
    refrescar();
    return;
  }

  // Botones que solo llevan a otra seccion, como el de "Siguiente paso" o una
  // fila de avisos. Si el clic vino del panel de avisos, ese panel se cierra:
  // lo pulsaste para ir a algun sitio, no para dejarlo abierto encima.
  const ir = e.target.closest('[data-ir]');
  if (ir) {
    if (ir.closest('#avisos')) abrirAvisos(false);
    state.view = ir.dataset.ir;
    // Para que al volver a esa seccion caiga donde el atajo te dejo.
    state.ultimaVista[SECCION_DE[state.view]] = state.view;
    state.openLog = null;
    refrescar();
    return;
  }

  const tab = e.target.closest('.tab');
  if (tab) {
    // Cambiar de pestaña vacia la seleccion: lo marcado en Pendientes no
    // tiene sentido en Aprobados, donde la unica accion es devolverlos.
    state.filter = tab.dataset.filter;
    state.sel.clear();
    state.foco = 0;
    refrescar();
    return;
  }

  // --- Proyectos ---------------------------------------------------------

  const crearCliente = e.target.closest('[data-pcrear-cliente]');
  if (crearCliente) {
    const input = document.getElementById('nuevo-cliente');
    await proyectoAccion({ accion: 'crear-cliente', nombre: input.value }, 'Cliente creado');
    return;
  }

  const crearCampana = e.target.closest('[data-pcrear-campana]');
  if (crearCampana) {
    const id = crearCampana.dataset.pcrearCampana;
    const input = document.getElementById('nueva-campana-' + id);
    await proyectoAccion({ accion: 'crear-campana', clienteId: id, nombre: input.value }, 'Campaña creada');
    return;
  }

  const archivar = e.target.closest('[data-parchivar]');
  if (archivar) {
    await proyectoAccion(
      { accion: 'editar-cliente', id: archivar.dataset.parchivar, archivado: archivar.dataset.valor === '1' },
      archivar.dataset.valor === '1' ? 'Cliente archivado' : 'Cliente recuperado',
    );
    return;
  }

  const borrarCliente = e.target.closest('[data-pborrar-cliente]');
  if (borrarCliente) {
    // Se avisa de lo que NO se borra, que es lo que la gente teme al pulsar.
    if (!confirm('Borrar este cliente. Sus cuentas quedan sin asignar y conservan su permiso de TikTok; sus videos tampoco se borran. Seguir?')) return;
    await proyectoAccion({ accion: 'borrar-cliente', id: borrarCliente.dataset.pborrarCliente }, 'Cliente borrado');
    return;
  }

  const borrarCampana = e.target.closest('[data-pborrar-campana]');
  if (borrarCampana) {
    if (!confirm('Borrar esta campaña. Sus videos quedan sin asignar, no se borran. Seguir?')) return;
    await proyectoAccion({ accion: 'borrar-campana', id: borrarCampana.dataset.pborrarCampana }, 'Campaña borrada');
    return;
  }

  // --- Cuentas -----------------------------------------------------------

  const sacar = e.target.closest('[data-psacar]');
  if (sacar) {
    await proyectoAccion(
      { accion: 'asignar-cuenta', id: sacar.dataset.psacar, destino: null },
      'Cuenta sin asignar',
    );
    return;
  }

  const enlazar = e.target.closest('[data-cenlazar]');
  if (enlazar) {
    try {
      const r = await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: 'enlazar', id: enlazar.dataset.cenlazar }),
      });
      /*
       * Se abre en otra pestaña, no se navega.
       *
       * Navegar dejaria el panel atras y, al volver TikTok a la pagina de
       * retorno, el usuario se quedaria en ella sin forma obvia de regresar.
       */
      window.open(r.url, '_blank', 'noopener');
      avisar('Autoriza en la pestaña nueva. Usa incognito si tienes otra sesión abierta.');
    } catch (err) {
      avisar(err.message);
    }
    return;
  }

  const revisarCuenta = e.target.closest('[data-crevisar]');
  if (revisarCuenta) {
    try {
      const r = await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: 'revisar', id: revisarCuenta.dataset.crevisar }),
      });
      avisar('@' + r.username + ' responde. Máximo ' + r.maxDurationSec + 's por video.');
      refrescar();
    } catch (err) {
      avisar(err.message);
    }
    return;
  }

  /*
   * Pausar y activar comparten manejador: cambia el verbo, no el gesto.
   *
   * Pausar no pide confirmacion porque no destruye nada y se deshace con el
   * boton de al lado. Lo ya programado sigue su curso; solo deja de entrar en
   * los repartos siguientes, y eso lo dice la respuesta del servidor.
   */
  const quitarVod = e.target.closest('[data-quitar-vod]');
  if (quitarVod) {
    const id = quitarVod.dataset.quitarVod;
    if (!confirm('Quitar ' + id + ' de la lista. Solo se puede porque no llego a dar ningún momento. Seguir?')) return;
    try {
      const r = await api('/api/sources/' + encodeURIComponent(id), { method: 'DELETE' });
      avisar(r.mensaje);
      refrescar();
    } catch (err) { avisar(err.message); }
    return;
  }

  if (e.target.id === 'crear-cuentas') {
    const cuantas = Number(document.getElementById('cuantas-cuentas').value);
    try {
      const r = await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: 'crear', cuantas }),
      });
      avisar(r.mensaje);
      refrescar();
    } catch (err) { avisar(err.message); }
    return;
  }

  const borrarCuenta = e.target.closest('[data-cborrar]');
  if (borrarCuenta) {
    const id = borrarCuenta.dataset.cborrar;
    // Borrar una cuenta no se deshace, a diferencia de pausarla.
    if (!confirm('Borrar ' + id + ' para siempre. Si solo quieres dejar de usarla, Pausar la conserva. Seguir?')) return;
    try {
      const r = await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: 'borrar', id }),
      });
      avisar(r.mensaje);
      refrescar();
    } catch (err) { avisar(err.message); }
    return;
  }

  const pausar = e.target.closest('[data-cpausar]');
  const activar = e.target.closest('[data-cactivar]');
  if (pausar || activar) {
    const id = pausar ? pausar.dataset.cpausar : activar.dataset.cactivar;
    try {
      const r = await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: pausar ? 'pausar' : 'activar', id }),
      });
      avisar(r.mensaje);
      refrescar();
    } catch (err) {
      avisar(err.message);
    }
    return;
  }

  const olvidar = e.target.closest('[data-colvidar]');
  if (olvidar) {
    if (!confirm('Desenlazar esta cuenta. Tendrás que volver a autorizarla en tiktok.com para publicar. Seguir?')) return;
    try {
      const r = await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accion: 'olvidar', id: olvidar.dataset.colvidar }),
      });
      avisar(r.mensaje);
      refrescar();
    } catch (err) {
      avisar(err.message);
    }
    return;
  }

  const btn = e.target.closest('[data-do]');
  if (btn) {
    if (btn.closest('.detalle-clip')) decidirClip(btn.dataset.do);
    else decide(btn.closest('.card'), btn.dataset.do);
    return;
  }

  const log = e.target.closest('[data-log]');
  if (log) {
    state.openLog = state.openLog === log.dataset.log ? null : log.dataset.log;
    render();
    return;
  }

  const cancel = e.target.closest('[data-cancel]');
  if (cancel) {
    await fetch('/api/jobs/' + cancel.dataset.cancel + '/cancel', { method: 'POST' });
    refrescar();
    return;
  }

  const run = e.target.closest('[data-run]');
  if (run && !run.disabled) {
    const kind = run.dataset.run;
    const params = {};
    if (run.dataset.source) params.sourceId = run.dataset.source;
    if (kind === 'metrics') params.mode = 'feedback';
    lanzar(kind, params);
    return;
  }

  if (e.target.closest('#drop')) { document.getElementById('file').click(); return; }

  if (e.target.id === 'guardar') {
    const valores = {};
    for (const input of document.querySelectorAll('[data-set]')) {
      valores[input.dataset.set] = Number(input.value);
    }
    guardarFlujo(valores);
    return;
  }

  if (e.target.id === 'reset') { guardarFlujo(BASE); return; }

  /*
   * Atributo propio (data-ajuste) y no el data-set de Horarios.
   *
   * Las dos vistas no se ven nunca a la vez, asi que compartir atributo
   * funcionaria hoy. Pero el recolector barre el documento entero, y el dia que
   * alguien enseñe las dos cosas en una pantalla, guardar en una mandaria los
   * campos de la otra a una ruta que no los conoce. Separarlos cuesta una
   * palabra.
   */
  if (e.target.id === 'guardar-ajustes') {
    const valores = {};
    for (const input of document.querySelectorAll('[data-ajuste]')) {
      const key = input.dataset.ajuste;
      valores[key] = input.dataset.texto ? input.value
        : BOOLEANOS.has(key) ? input.value === '1'
        : Number(input.value);
    }
    guardarAjustes(valores);
    return;
  }

  if (e.target.id === 'reset-ajustes') { guardarAjustes(BASE_CORTES); return; }

  if (e.target.id === 'guardar-plantilla') { guardarPlantilla(); return; }

  // Borrar antes que aplicar: la × vive DENTRO de la pastilla, asi que si se
  // mirara primero data-plantilla, la cruz aplicaria en vez de borrar.
  const borrar = e.target.closest('[data-borrar]');
  if (borrar) {
    const nombre = borrar.closest('.pastilla')?.querySelector('[data-plantilla]')?.textContent ?? 'esta plantilla';
    if (!confirm('Borrar "' + nombre + '"? Los ajustes de ahora no cambian.')) return;
    plantillaAccion('/api/plantillas/' + borrar.dataset.borrar, { method: 'DELETE' },
      () => 'Plantilla borrada.');
    return;
  }

  const aplicar = e.target.closest('[data-plantilla]');
  if (aplicar && !aplicar.disabled) {
    plantillaAccion('/api/plantillas/' + aplicar.dataset.plantilla + '/aplicar', { method: 'POST' },
      d => 'Aplicada. ' + (d.ejemplo ? 'Saldrían unos ' + plural(d.ejemplo.clips, 'momento') + '.' : ''));
    return;
  }

  if (e.target.id === 'ingest') {
    const input = document.getElementById('url');
    const url = input.value.trim();
    if (!url) { input.focus(); return; }
    input.value = '';
    lanzar('ingest', { url, campanaId: campanaElegida(), tipo: state.tipoVideo || 'entrevista' });
  }
});

// Los atajos de Revisar viven ahora en el bloque "Revisar en lote", al final
// de este fichero: la A y la R comparten reglas con la seleccion multiple.

document.addEventListener('input', e => {
  if (!e.target.matches?.('.caption')) return;
  const el = e.target.closest('.field').querySelector('.count');
  el.textContent = e.target.value.length + ' / 150';
  el.classList.toggle('over', e.target.value.length > 150);
});

// --- Subida de archivos ---------------------------------------------------

/**
 * Sube el archivo y arranca la transcripcion.
 *
 * Se usa XMLHttpRequest y no fetch por una razon concreta: fetch no informa del
 * progreso de subida. Para un archivo de 900 MB, una barra parada en "subiendo"
 * durante diez minutos es indistinguible de algo colgado.
 *
 * El cuerpo es el archivo en crudo y el nombre va en una cabecera. No hace
 * falta multipart: solo se manda un archivo y el unico cliente es esta pagina.
 */
function subir(file) {
  const barra = document.getElementById('barra');
  const texto = document.getElementById('subiendo');
  const relleno = barra.querySelector('i');
  barra.hidden = false;

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('content-type', 'application/octet-stream');
  // El nombre puede traer acentos o espacios, que no caben en una cabecera tal
  // cual. Se codifica aqui y el servidor lo descodifica.
  xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
  const campana = campanaElegida();
  if (campana) xhr.setRequestHeader('x-campana', campana);
  if (state.tipoVideo === 'musica') xhr.setRequestHeader('x-tipo', 'musica');

  const mb = b => (b / 1048576).toFixed(0);

  xhr.upload.addEventListener('progress', ev => {
    if (!ev.lengthComputable) return;
    const pct = (ev.loaded / ev.total) * 100;
    relleno.style.width = pct + '%';
    texto.textContent = 'Subiendo ' + mb(ev.loaded) + ' de ' + mb(ev.total) + ' MB (' + pct.toFixed(0) + '%)';
  });

  xhr.addEventListener('load', () => {
    barra.hidden = true;
    if (xhr.status === 202) {
      texto.textContent = 'Subido. Transcribiendo...';
      refrescar();
    } else {
      let msg = 'HTTP ' + xhr.status;
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      texto.textContent = 'No se pudo subir: ' + msg;
    }
  });

  xhr.addEventListener('error', () => {
    barra.hidden = true;
    texto.textContent = 'Se corto la conexión durante la subida.';
  });

  texto.textContent = 'Preparando ' + mb(file.size) + ' MB...';
  xhr.send(file);
}

/*
 * La vista previa se actualiza al tocar, antes de guardar.
 *
 * Es lo que la hace util: se prueba un color, se ve, y si no convence se
 * prueba otro sin dejar rastro. Si solo reflejara lo guardado habria que
 * confirmar cada tanteo, y ya no seria una prueba.
 *
 * Se escucha en 'input' y no en 'change' para que el selector de color
 * responda mientras se arrastra, que es como se elige un color.
 *
 * Solo se repinta lo que cambia, no la pantalla entera: un render completo
 * recrearia la etiqueta <video> y cortaria la reproduccion en cada tecla.
 */
/**
 * Los ajustes tal y como estan AHORA en los controles, sin guardar.
 *
 * Parte de los guardados y pisa con lo que haya en pantalla, que es lo que se
 * quiere previsualizar. Lo usan la vista previa y el arrastre.
 */
function ajustesDelFormulario() {
  const a = { ...state.ajustes.ajustes };
  for (const input of document.querySelectorAll('[data-ajuste]')) {
    const k = input.dataset.ajuste;
    a[k] = input.dataset.texto ? input.value
      : BOOLEANOS.has(k) ? input.value === '1'
      : Number(input.value);
  }
  return a;
}

function refrescarVistaPrevia() {
  if (state.view !== 'ajustes' || !state.ajustes?.muestra) return;

  const a = ajustesDelFormulario();

  const texto = document.getElementById('pv-texto');
  if (texto) texto.textContent = textoPublicacion(a, state.ajustes.muestra);

  const marco = document.querySelector('.pv-marco');
  if (!marco) return;
  // Las dos capas por el mismo camino: crear, actualizar o quitar.
  pintarCapa(marco, 'titulo', a, state.ajustes.muestra);
  pintarCapa(marco, 'sub', a, state.ajustes.muestra);
}

document.addEventListener('input', e => {
  if (e.target.closest('[data-ajuste]')) refrescarVistaPrevia();
});

document.addEventListener('change', e => {
  if (e.target.closest('[data-ajuste]')) refrescarVistaPrevia();

  // Desplegables de Proyectos. Van por 'change' y no por 'click' porque en el
  // movil el selector nativo no emite clicks sobre las opciones.
  const estado = e.target.closest('[data-pestado]');
  if (estado) {
    proyectoAccion({ accion: 'editar-campana', id: estado.dataset.pestado, estado: estado.value }, 'Estado guardado');
    return;
  }

  const perfil = e.target.closest('[data-pperfil]');
  if (perfil) {
    // Cadena vacia = 'General'. El servidor la traduce a null, que es lo que
    // devuelve al cliente a heredar del ajuste general.
    proyectoAccion({
      accion: 'editar-cliente',
      id: perfil.dataset.pperfil,
      [perfil.dataset.campo]: perfil.value === '' ? null : Number(perfil.value),
    }, 'Ritmo guardado');
    return;
  }

  const acuenta = e.target.closest('[data-pasignar-cuenta]');
  if (acuenta) {
    // Cadena vacia = "Sin asignar". El servidor la traduce a null; mandar la
    // cadena tal cual rompería la clave foranea.
    proyectoAccion({ accion: 'asignar-cuenta', id: acuenta.dataset.pasignarCuenta, destino: acuenta.value }, 'Cuenta asignada');
    return;
  }

  const avod = e.target.closest('[data-pasignar-vod]');
  if (avod) {
    proyectoAccion({ accion: 'asignar-vod', id: avod.dataset.pasignarVod, destino: avod.value }, 'Video asignado');
    return;
  }

  if (e.target.id !== 'file') return;
  const file = e.target.files[0];
  if (file) subir(file);
  e.target.value = '';
});

// Arrastrar y soltar. El navegador abre el archivo si no se cancelan los dos
// eventos, asi que hay que hacerlo tambien sobre el documento entero.
for (const ev of ['dragover', 'drop']) {
  document.addEventListener(ev, e => {
    const drop = e.target.closest?.('#drop');
    if (ev === 'dragover') { e.preventDefault(); if (drop) drop.classList.add('over'); return; }
    e.preventDefault();
    document.getElementById('drop')?.classList.remove('over');
    if (drop && e.dataTransfer.files[0]) subir(e.dataTransfer.files[0]);
  });
}

document.addEventListener('dragleave', e => {
  if (e.target.closest?.('#drop')) e.target.closest('#drop').classList.remove('over');
});

// --- Progreso en vivo -----------------------------------------------------

/**
 * Se escucha el canal de eventos siempre, no solo en la vista de proceso: un
 * trabajo dura minutos y quien lo lanza se va a revisar clips mientras tanto.
 * Al terminar hay que refrescar para que aparezcan los clips nuevos.
 */
function escuchar() {
  const es = new EventSource('/api/events');

  es.addEventListener('job', ev => {
    const job = JSON.parse(ev.data);
    const i = state.jobs.findIndex(j => j.id === job.id);
    if (i === -1) state.jobs.unshift(job);
    else state.jobs[i] = { ...state.jobs[i], ...job };

    // Un trabajo que acaba cambia lo que hay en disco, asi que toca releer.
    if (!vivo(job)) { refrescar(); return; }

    if (state.view === 'proceso') render();
    if (state.openLog === job.id) pintarLog(job.id);
  });

  /*
   * Aviso de que los datos cambiaron en el servidor.
   *
   * Sin esto los numeros solo se releian al cambiar de seccion: aprobar videos
   * desde el movil dejaba el contador del portatil congelado, y parecia que la
   * aprobacion no habia funcionado.
   */
  es.addEventListener('datos', () => { refrescar(); });

  // EventSource reconecta solo, pero si el servidor se cayo del todo conviene
  // no dejar la pagina enseñando datos viejos en silencio.
  es.addEventListener('error', () => {
    document.getElementById('hint').textContent = 'Sin conexión con el servidor. Reintentando...';
  });
  es.addEventListener('open', () => {
    if (state.view !== 'clips') document.getElementById('hint').textContent = '';
  });
}

/*
 * Red de seguridad: releer al volver a la pestaña.
 *
 * El aviso por SSE cubre el caso normal, pero un movil que estuvo con la
 * pantalla apagada puede haber perdido la conexion sin enterarse. Al volver a
 * mirar, lo primero que ve el usuario tiene que ser el dato de verdad.
 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refrescar();
});
addEventListener('focus', refrescar);

/*
 * Se pinta ANTES de pedir nada.
 *
 * Cada vista devuelve su esqueleto cuando no tiene datos, pero nadie los
 * llamaba hasta que la respuesta llegaba: la primera pintada ocurria DESPUES
 * del primer fetch. Con la base recien despierta -- Supabase tarda en abrir la
 * primera conexion, y se han medido mas de treinta segundos -- eso son treinta
 * segundos de pantalla negra sin un solo pixel que diga que algo esta pasando.
 *
 * Un render seco al arrancar cuesta nada y pone los huesos en su sitio.
 */
render();

/*
 * La primera carga, con red de seguridad.
 *
 * Si esta falla -- el servidor todavia arrancando, el movil sin cobertura al
 * abrir el enlace -- no habia nada que lo recogiera: el panel se quedaba en
 * una pantalla negra vacia, sin mensaje ni forma de reintentar, y la unica
 * salida era recargar a mano sin saber por que.
 *
 * Los refrescos POSTERIORES no llevan esto a proposito: ahi ya hay contenido
 * en pantalla y tapar lo que se esta leyendo con un error seria peor. Un
 * fallo pasajero se resuelve solo en el siguiente aviso del servidor.
 */
/*
 * Quien soy, antes de pintar nada.
 *
 * Un operador no ve las pestañas de configuracion. Se quitan de la lista de
 * vistas una sola vez, y con eso desaparecen del menu, de las pestañas y del
 * buscador, que leen todos de SECCIONES.
 */
async function cargarYo() {
  try {
    state.yo = await api('/api/yo');
  } catch {
    state.yo = null;
  }
  if (state.yo && state.yo.rol !== 'admin') {
    SECCIONES.config.vistas = SECCIONES.config.vistas.filter(([v]) => !SOLO_ADMIN.includes(v));
  }
  const salir = document.getElementById('salir');
  if (salir && state.yo && state.yo.email) salir.title = 'Cerrar sesión (' + state.yo.email + ')';
  // Sin sesion de usuario (vista previa o llave antigua) no hay nada que cerrar.
  if (salir && state.yo && state.yo.tipo !== 'usuario') salir.hidden = true;
}

/*
 * Usuarios: crear, poner contraseña, cambiar rol o quitar acceso.
 */
document.addEventListener('submit', async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id !== 'usuario-nuevo' && !form.classList.contains('usuario-clave')) return;
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(form));
  const destino = form.id === 'usuario-nuevo'
    ? '/api/usuarios'
    : '/api/usuarios/' + form.dataset.usuario + '/contrasena';
  try {
    await api(destino, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(datos),
    });
    avisar(form.id === 'usuario-nuevo'
      ? 'Usuario creado. Al entrar elegirá su contraseña.'
      : 'Contraseña cambiada. Se cerraron sus sesiones abiertas.');
    form.reset();
    refrescar();
  } catch (err) {
    avisar(err.message);
  }
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-usuario][data-cambio]');
  if (!b) return;
  const cuerpo = b.dataset.cambio === 'rol'
    ? { rol: b.dataset.valor }
    : { activo: b.dataset.valor === 'true' };
  b.disabled = true;
  try {
    await api('/api/usuarios/' + b.dataset.usuario, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    avisar('Hecho.');
  } catch (err) {
    avisar(err.message);
  }
  refrescar();
});

cargarYo().then(() => refrescar()).catch((error) => {
  document.getElementById('view').innerHTML =
    '<div class="empty ancho"><b>No se pudo cargar el panel</b>' +
    esc(error.message || 'No hubo respuesta del servidor.') +
    '<div class="actions" style="justify-content:center;margin-top:var(--s4)">' +
      '<button class="act go" id="reintentar">Reintentar</button>' +
    '</div></div>';
});

document.addEventListener('click', e => {
  if (e.target.id !== 'reintentar') return;
  e.target.disabled = true;
  e.target.textContent = 'Cargando...';
  location.reload();
});

escuchar();
// --- Buscador -------------------------------------------------------------

/*
 * Un sitio al que ir cuando ya no cabe bajar scrolleando.
 *
 * Con catorce videos y cuarenta y cinco clips pendientes, llegar a UNO concreto
 * son dos minutos de rueda. Esto lo deja en tres teclas.
 *
 * Busca sobre lo que el panel YA tiene cargado, no contra el servidor. Es
 * deliberado: la respuesta es instantanea mientras se teclea y no hay que
 * inventar un endpoint ni debounces. Lo que no este cargado todavia no sale, y
 * eso se dice en el estado vacio en vez de fingir que no existe.
 */
const buscador = {
  abierto: false,
  items: [],
  indice: 0,
  /** Donde estaba el foco antes de abrir, para devolverlo al cerrar. */
  antes: null,
};

/** Normaliza para comparar: sin acentos, sin mayusculas. */
function plano(t) {
  return String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Todo lo que se puede encontrar, en una lista plana.
 *
 * El orden importa y no es alfabetico: primero las pantallas, que es lo que se
 * busca la mayor parte de las veces y lo que siempre esta disponible. Despues
 * las cosas concretas.
 */
function buscables() {
  const out = [];

  for (const [id, sec] of Object.entries(SECCIONES)) {
    for (const [vista, etiqueta] of sec.vistas) {
      out.push({
        que: 'Pantalla',
        cual: sec.vistas.length > 1 ? sec.titulo + ' / ' + etiqueta : sec.titulo,
        // Las palabras de la explicacion tambien cuentan: quien busca
        // "hashtags" tiene que llegar a Marca y textos sin saber como se llama.
        texto: sec.titulo + ' ' + etiqueta + ' ' + (INTROS[vista] ?? ''),
        ir: vista,
      });
    }
  }

  for (const s of state.overview?.sources ?? []) {
    out.push({
      que: 'Video',
      cual: s.title,
      texto: s.title,
      // Al detalle del VOD, que es donde se ve entero.
      vod: s.id,
    });
  }

  for (const c of state.clips ?? []) {
    out.push({
      que: 'Clip',
      cual: c.caption || c.hook || c.id,
      texto: (c.caption ?? '') + ' ' + (c.hook ?? '') + ' ' + c.id,
      ir: 'clips',
    });
  }

  /*
   * Cada perilla de Ajustes, por su nombre.
   *
   * Son veintisiete repartidas en ocho tarjetas, y hasta ahora encontrar "el
   * color del borde" era bajar leyendo titulos. Al elegirla, el buscador
   * lleva a Ajustes y la resalta.
   *
   * CORTES y FLUJO son las mismas listas con las que se pinta la pantalla,
   * asi que no puede haber un ajuste buscable que no exista ni al reves.
   */
  for (const [lista, vista] of [[CORTES, 'ajustes'], [BLOQUES, 'flujo']]) {
    for (const b of lista ?? []) {
      for (const c of b.campos ?? []) {
        out.push({
          que: 'Ajuste',
          // Con el bloque delante: hay dos "Color del borde", el del
          // subtitulo y el del rotulo, y sin el no hay forma de elegir.
          cual: b.titulo + '  ·  ' + c.texto,
          // Tambien el titulo del bloque: quien busca "subtitulos" tiene que
          // encontrar el color y el tamaño, que no llevan esa palabra.
          texto: c.texto + ' ' + b.titulo + ' ' + (b.pie ?? ''),
          ir: vista,
          ajuste: c.key,
        });
      }
    }
  }

  /*
   * Las cuentas vienen de /api/proyectos, que es quien las trae con su
   * identificador y su arroba de TikTok. Solo estan cargadas si has pasado por
   * Clientes o Cuentas; mientras no, no salen, que es mejor que una lista a
   * medias.
   */
  for (const a of state.proyectos?.cuentas ?? []) {
    out.push({
      que: 'Cuenta',
      cual: a.tiktok ? a.id + '  @' + a.tiktok : a.id,
      texto: a.id + ' ' + (a.tiktok ?? ''),
      ir: 'plataformas',
    });
  }

  return out;
}

function filtrarBuscador(q) {
  const todo = buscables();
  /*
   * Todas las palabras, en cualquier orden, no la frase seguida.
   *
   * Con la frase entera, "rotulo borde" no encontraba "El rotulo de arriba /
   * Grosor del borde", que es exactamente lo que se estaba buscando. Nadie
   * teclea en el orden en que esta escrito: se teclean las dos palabras que
   * uno recuerda.
   */
  const partes = plano(q).split(' ').filter(Boolean);
  // Sin texto se enseñan las pantallas: abrir el buscador y ver una lista
  // vacia no dice que se puede hacer con el.
  if (partes.length === 0) return todo.filter(i => i.que === 'Pantalla');
  return todo
    .filter(i => { const t = plano(i.texto); return partes.every(p => t.includes(p)); })
    .slice(0, 20);
}

function pintarBuscador() {
  const ul = document.getElementById('resultados');
  if (buscador.items.length === 0) {
    ul.innerHTML = '<li class="nada">Nada con ese nombre entre lo que hay cargado.</li>';
    return;
  }
  ul.innerHTML = buscador.items.map((i, n) =>
    '<li role="option" data-n="' + n + '" aria-selected="' + (n === buscador.indice) + '">' +
    '<span class="que">' + i.que + '</span>' +
    '<span class="cual">' + esc(i.cual) + '</span></li>').join('');
  const activo = ul.querySelector('[aria-selected="true"]');
  if (activo) activo.scrollIntoView({ block: 'nearest' });
}

function abrirBuscador(abrir) {
  const caja = document.getElementById('buscador');
  const input = document.getElementById('buscar');
  buscador.abierto = abrir;
  caja.hidden = !abrir;
  if (abrir) {
    buscador.antes = document.activeElement;
    input.value = '';
    buscador.indice = 0;
    buscador.items = filtrarBuscador('');
    pintarBuscador();
    input.focus();
  } else if (buscador.antes) {
    // Devolver el foco donde estaba. Sin esto, cerrar con Escape manda el
    // tabulador al principio de la pagina y hay que recorrerla otra vez.
    buscador.antes.focus();
    buscador.antes = null;
  }
}

function elegirBuscador(i) {
  const item = buscador.items[i];
  if (!item) return;
  abrirBuscador(false);
  if (item.vod) { abrirVod(item.vod); return; }
  state.view = item.ir;
  state.ultimaVista[SECCION_DE[state.view]] = state.view;
  state.openLog = null;
  // La perilla concreta, para resaltarla cuando la pantalla este pintada.
  state.resaltar = item.ajuste ?? null;
  refrescar();
}

document.addEventListener('keydown', e => {
  // Ctrl+K en todas partes, Cmd+K en Mac. Es el atajo que ya espera cualquiera.
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    abrirBuscador(!buscador.abierto);
    return;
  }
  if (!buscador.abierto) return;
  if (e.key === 'Escape') { e.preventDefault(); abrirBuscador(false); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = buscador.items.length;
    if (n === 0) return;
    // Da la vuelta por los dos lados: desde el primero, Arriba lleva al ultimo.
    buscador.indice = (buscador.indice + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    pintarBuscador();
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); elegirBuscador(buscador.indice); }
});

document.addEventListener('input', e => {
  if (e.target.id !== 'buscar') return;
  buscador.items = filtrarBuscador(e.target.value);
  buscador.indice = 0;
  pintarBuscador();
});

document.addEventListener('click', e => {
  if (e.target.closest('#abrir-buscar')) { abrirBuscador(true); return; }
  if (!buscador.abierto) return;
  const fila = e.target.closest('.resultados li[data-n]');
  if (fila) { elegirBuscador(Number(fila.dataset.n)); return; }
  // Pinchar fuera de la caja cierra. Dentro, no.
  if (!e.target.closest('.buscador-caja')) abrirBuscador(false);
});

// Con el raton encima manda el raton: si no, las flechas marcarian un resultado
// y el puntero estaria sobre otro, y al pulsar se abriria el que no era.
document.addEventListener('mousemove', e => {
  if (!buscador.abierto) return;
  const fila = e.target.closest('.resultados li[data-n]');
  if (!fila) return;
  const n = Number(fila.dataset.n);
  if (n === buscador.indice) return;
  buscador.indice = n;
  pintarBuscador();
});

// --- La linea de tiempo ---------------------------------------------------

/*
 * El unico elemento que hace que esto parezca una herramienta de video.
 *
 * Todo lo demas de este panel son tarjetas, listas y cifras, que es lo que
 * tiene cualquier panel de administracion. Esto no: es el directo entero
 * dibujado a escala, con cada momento encontrado en el sitio donde ocurre.
 *
 * Y no es decorativa. Responde de un vistazo a la pregunta que nadie podia
 * contestar antes: por que un VOD de dos horas solo dio tres clips. Si los
 * marcadores se apelotonan en los primeros veinte minutos, el resto del
 * directo no tenia nada, y eso es informacion sobre el material, no sobre el
 * programa.
 *
 * Aparece en dos sitios y en ninguno mas: compacta en la ficha de cada video
 * de Inicio, completa en el detalle. En cualquier otro sitio seria adorno.
 */

/** mm:ss, o h:mm:ss cuando pasa de la hora. */
function reloj(sec) {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), g = t % 60;
  const mm = String(m).padStart(2, '0'), gg = String(g).padStart(2, '0');
  return h > 0 ? h + ':' + mm + ':' + gg : m + ':' + gg;
}

/**
 * Cada cuanto poner una marca para que salgan entre cuatro y ocho.
 *
 * Un paso fijo no sirve: diez minutos en un VOD de tres minutos no pinta
 * ninguna marca, y en uno de tres horas pinta dieciocho encimadas. Se elige
 * del juego de pasos redondos el primero que deja pocas marcas, porque una
 * marca en 7:30 no ayuda a nadie a situarse.
 */
function pasoEje(durSec) {
  for (const p of [15, 30, 60, 120, 300, 600, 900, 1800, 3600]) {
    if (durSec / p <= 8) return p;
  }
  return 7200;
}

/**
 * La linea de tiempo.
 *
 * compacta = la de la ficha de Inicio: sin eje ni etiquetas, solo la barra con
 * los momentos. Es un resumen que se lee de reojo mientras se baja la lista.
 */
function lineaTiempo(dur, clips, compacta) {
  if (!(dur > 0)) return '';

  const pct = t => Math.min(100, Math.max(0, (t / dur) * 100));

  const marcas = clips.map(c => {
    /*
     * Ancho minimo del 0,8%: un clip de 30 segundos dentro de un VOD de dos
     * horas mide un 0,4% y en una barra de 600 px eso son dos pixeles, que no
     * se ven y menos se pulsan. Se ensancha para poder tocarlo; la POSICION,
     * que es lo que informa, no se toca.
     */
    const izq = pct(c.start);
    const ancho = Math.max(0.8, pct(c.end) - izq);
    const estado = c.status === 'approved' ? 'si' : (c.status === 'rejected' ? 'no' : 'pend');
    const titulo = reloj(c.start) + '  ' + (c.hook || c.caption || c.id);
    return '<button class="marca ' + estado + '" style="left:' + izq.toFixed(3) + '%;width:' +
      ancho.toFixed(3) + '%" data-clip-eje="' + esc(c.id) + '"' +
      ' title="' + esc(titulo) + '" aria-label="' + esc(titulo) + '"></button>';
  }).join('');

  if (compacta) {
    return '<div class="eje compacto" role="img" aria-label="' +
      plural(clips.length, 'momento') + ' repartidos a lo largo de ' + reloj(dur) + '">' +
      '<div class="pista">' + marcas + '</div></div>';
  }

  const paso = pasoEje(dur);
  let reglas = '';
  for (let t = 0; t <= dur; t += paso) {
    reglas += '<span class="tic" style="left:' + pct(t).toFixed(3) + '%">' +
      '<i></i><b>' + reloj(t) + '</b></span>';
  }

  return '<div class="eje">' +
    '<div class="regla">' + reglas + '</div>' +
    '<div class="pista">' + marcas + '</div>' +
    '<p class="leyenda">' +
      '<span><i class="pt pend"></i>sin revisar</span>' +
      '<span><i class="pt si"></i>aprobado</span>' +
      '<span><i class="pt no"></i>descartado</span>' +
    '</p>' +
  '</div>';
}

// --- Vista: detalle de un video -------------------------------------------

function abrirVod(id) {
  state.vodId = id;
  state.vod = null;
  state.view = 'vod';
  state.openLog = null;
  refrescar();
}

function vistaVod() {
  const d = state.vod;
  if (!d) return esqueleto(2, false);

  const pend = d.clips.filter(c => c.status === 'pending').length;
  const ok = d.clips.filter(c => c.status === 'approved').length;
  const no = d.clips.filter(c => c.status === 'rejected').length;

  /*
   * El rastro de migas, no un boton de atras suelto.
   *
   * Esta es la unica pantalla del panel que esta por debajo de otra, asi que
   * es la unica que necesita decir de donde cuelga. Un atras a secas no dice a
   * donde vuelves; "Inicio / este video" si.
   */
  const migas = '<nav class="migas ancho" aria-label="Dónde estás">' +
    '<button data-ir="proceso">Inicio</button>' +
    '<span aria-hidden="true">/</span>' +
    '<b>' + esc(d.title) + '</b>' +
  '</nav>';

  if (d.clips.length === 0) {
    return migas +
      '<div class="empty ancho"><b>Todavía no hay momentos</b>' +
      (d.hasTranscript
        ? 'El texto ya esta. Falta buscar los momentos, y eso se lanza desde Inicio.'
        : 'Este video aún se está descargando o transcribiendo. Cuando acabe aparecerán aquí.') +
      '</div>';
  }

  const cuerpo =
    '<article class="card ancho vodcab"><div class="body">' +
      '<div class="vodtit">' +
        '<h2>' + esc(d.title) + '</h2>' +
        '<span class="cifra">' + reloj(d.durationSec) + '</span>' +
      '</div>' +
      (d.duracionCierta
        ? ''
        : '<p class="reason">La duración real de este video no se guardó, así que el eje ' +
          'llega hasta el final del último momento y no hasta el final del directo.</p>') +
      lineaTiempo(d.durationSec, d.clips, false) +
      '<div class="stats">' +
        '<div><b>' + d.clips.length + '</b><span>Momentos</span></div>' +
        '<div><b>' + pend + '</b><span>Sin revisar</span></div>' +
        '<div><b>' + ok + '</b><span>Aprobados</span></div>' +
        '<div><b>' + no + '</b><span>Descartados</span></div>' +
      '</div>' +
      (pend > 0
        ? '<div class="actions"><button class="act go" data-ir="clips">' +
          'Revisar los ' + pend + '</button></div>'
        : '<p class="reason">Ya los has revisado todos.</p>') +
    '</div></article>';

  /*
   * Debajo del eje, los mismos momentos como lista en orden de aparicion.
   *
   * El eje dice DONDE estan; la lista dice QUE son. Sin ella, para saber de
   * que va el momento de 12:40 hay que acertar con el puntero encima de un
   * marcador de tres pixeles, y desde el movil eso no se puede hacer.
   */
  const lista = '<article class="card ancho"><div class="body">' +
    '<h3 class="t">En orden de aparicion</h3>' +
    '<ul class="momentos">' + d.clips.map(c =>
      '<li data-clip-eje="' + esc(c.id) + '" tabindex="0">' +
        '<span class="cuando">' + reloj(c.start) + '</span>' +
        '<span class="que">' + esc(c.hook || c.caption || c.id) + '</span>' +
        '<span class="dura">' + Math.round(c.end - c.start) + 's</span>' +
        '<span class="punto-estado ' +
          (c.status === 'approved' ? 'si' : (c.status === 'rejected' ? 'no' : 'nada')) +
        '"></span>' +
      '</li>').join('') + '</ul>' +
  '</div></article>';

  return migas + cuerpo + lista;
}

/*
 * Pulsar un momento, en el eje o en la lista, resalta el otro.
 *
 * No navega a ningun sitio: en esta pantalla el eje y la lista son dos vistas
 * de lo mismo, y saltar a Revisar por tocar un marcador seria perder el sitio.
 * Para revisar esta el boton de arriba, que dice cuantos quedan.
 */
document.addEventListener('click', e => {
  const m = e.target.closest('[data-clip-eje]');
  if (!m || state.view !== 'vod') return;
  const id = m.dataset.clipEje;
  for (const el of document.querySelectorAll('[data-clip-eje]')) {
    el.classList.toggle('senalado', el.dataset.clipEje === id);
  }
  const fila = document.querySelector('.momentos [data-clip-eje="' + CSS.escape(id) + '"]');
  if (fila && !fila.contains(m)) fila.scrollIntoView({ block: 'nearest' });
});

// --- Revisar en lote ------------------------------------------------------

/*
 * Decidir varios de golpe, y moverse con el teclado.
 *
 * Revisar cuarenta y cinco clips de uno en uno es el cuello de botella real
 * del programa: todo lo demas va solo. Dos cosas lo acortan sin quitarle a
 * nadie el control:
 *
 *   1. Seleccionar varios y resolverlos juntos. Cuando ya has visto el VOD
 *      entero sabes que el tramo de la mitad no vale, y marcarlos es un gesto.
 *   2. Las manos en el teclado. Antes habia una A y una R que SIEMPRE actuaban
 *      sobre la primera tarjeta de la rejilla, asi que revisar era: mirar la
 *      primera, decidir, esperar a que se recoloque la rejilla, mirar la
 *      primera otra vez. Ahora hay una tarjeta en foco y se mueve.
 *
 * Nada de esto decide por ti: el lote hace exactamente lo que harian N clics.
 */

/** La llave de un clip. El cero no aparece en ningun identificador. */
function llaveClip(sourceId, clipId) {
  return sourceId + '\\u0000' + clipId;
}

/** Las tarjetas de la rejilla, en el orden en que se ven. */
function tarjetas() {
  return [...document.querySelectorAll('.lista-clips .card[data-clip]')];
}

function tarjetaEnFoco() {
  const t = tarjetas();
  if (t.length === 0) return null;
  return t[Math.min(state.foco, t.length - 1)] ?? null;
}

/**
 * Repinta seleccion y foco SIN volver a construir la rejilla.
 *
 * Es la diferencia entre que moverse con las flechas sea instantaneo o que
 * cada pulsacion vuelva a crear treinta reproductores de video y pierda la
 * posicion de reproduccion del que estabas viendo.
 */
function pintarSeleccion() {
  const t = tarjetas();
  if (state.foco >= t.length) state.foco = Math.max(0, t.length - 1);

  /*
   * Primero se tira lo marcado que ya no esta en la rejilla.
   *
   * Despues de decidir un lote la lista se repinta sin esos clips, pero sus
   * llaves seguirian en el conjunto y la barra diria "8 videos" con cero
   * tarjetas marcadas a la vista. Lo que manda es lo que se ve.
   */
  const presentes = new Set(t.map(c => llaveClip(c.dataset.source, c.dataset.clip)));
  for (const k of state.sel) if (!presentes.has(k)) state.sel.delete(k);

  t.forEach((card, i) => {
    const k = llaveClip(card.dataset.source, card.dataset.clip);
    const marcada = state.sel.has(k);
    card.classList.toggle('elegida', marcada);
    card.classList.toggle('enfoco', i === state.foco && state.conTeclado);
    const casilla = card.querySelector('.elegir input');
    if (casilla) casilla.checked = marcada;
  });

  const barra = document.getElementById('lote');
  if (!barra) return;
  const n = state.sel.size;
  barra.hidden = n === 0;
  if (n > 0) {
    barra.querySelector('.cuantos').textContent = plural(n, 'video') + ' sin decidir';
    const marca = barra.querySelector('[data-marca]');
    if (marca) marca.textContent = n >= t.length ? 'Quitar la marca' : 'Marcar todos';
  }
}

function elegir(card, marcar) {
  const k = llaveClip(card.dataset.source, card.dataset.clip);
  if (marcar === undefined) marcar = !state.sel.has(k);
  if (marcar) state.sel.add(k); else state.sel.delete(k);
  pintarSeleccion();
}

function moverFoco(paso) {
  const t = tarjetas();
  if (t.length === 0) return;
  state.conTeclado = true;
  state.foco = Math.min(t.length - 1, Math.max(0, state.foco + paso));
  pintarSeleccion();
  const card = t[state.foco];
  /*
   * Centrado, no "lo justo para que se vea".
   *
   * Una tarjeta de clip mide dos tercios de la pantalla. Con block:nearest la
   * siguiente queda pegada al borde de abajo y hay que bajar a mano para ver
   * el video, que es lo unico que hay que mirar para decidir.
   */
  card.scrollIntoView({ block: 'center', behavior: comoDesplazar() });
}

/** Cuantas tarjetas por fila hay ahora mismo, para que arriba y abajo vayan bien. */
function porFila() {
  const t = tarjetas();
  if (t.length < 2) return 1;
  const y = t[0].getBoundingClientRect().top;
  let n = 1;
  while (n < t.length && Math.abs(t[n].getBoundingClientRect().top - y) < 4) n += 1;
  return n;
}

async function decidirLote(status) {
  const items = [...state.sel].map(k => {
    const [sourceId, clipId] = k.split('\\u0000');
    return { sourceId, clipId };
  });
  if (items.length === 0) return;

  const barra = document.getElementById('lote');
  if (barra) for (const b of barra.querySelectorAll('button')) b.disabled = true;

  try {
    const r = await api('/api/clips/lote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, items }),
    });
    state.sel.clear();
    /*
     * Se dice cuantos, y tambien cuantos no.
     *
     * Un "listo" a secas despues de mandar quince cuando solo entraron trece
     * es exactamente la clase de silencio que hace que luego nadie entienda
     * por que faltan dos.
     */
    avisar(plural(r.hechos, 'video') + ' ' +
      (status === 'approved' ? 'aprobado' : status === 'rejected' ? 'descartado' : 'devuelto') +
      (r.hechos === 1 ? '' : 's') +
      (r.fallidos.length > 0 ? '. ' + plural(r.fallidos.length, 'no se encontró', 'no se encontraron') : '.'));
  } catch (error) {
    avisar(error.message);
  }
  await refrescar();
}

document.addEventListener('click', e => {
  if (state.view !== 'clips') return;

  const casilla = e.target.closest('.elegir input');
  if (casilla) {
    // El clic en la casilla no debe llegar al <article>, que abriria el video.
    e.stopPropagation();
    elegir(casilla.closest('.card'), casilla.checked);
    return;
  }

  const bot = e.target.closest('#lote [data-lote]');
  if (bot) { decidirLote(bot.dataset.lote); return; }

  if (e.target.closest('#lote [data-marca]')) {
    const todas = tarjetas();
    // Con todas marcadas, el boton desmarca. Es lo que dice su texto, que
    // tambien cambia.
    if (state.sel.size >= todas.length) state.sel.clear();
    else for (const c of todas) state.sel.add(llaveClip(c.dataset.source, c.dataset.clip));
    pintarSeleccion();
  }
});

// Los atajos de Revisar estan junto a la vista (Fase 3: tres zonas).

// Tocar con el raton apaga el resaltado del teclado: tener dos cosas marcadas
// a la vez -- una por el puntero y otra por las flechas -- no dice cual manda.
document.addEventListener('pointerdown', () => {
  if (!state.conTeclado) return;
  state.conTeclado = false;
  pintarSeleccion();
});

// --- Las dos capas de texto de la vista previa ----------------------------

/*
 * El subtitulo y el rotulo se dibujan con el mismo codigo.
 *
 * Son dos capas del mismo lienzo de 1080x1920 y se diferencian en tres cosas:
 * de que borde cuelgan, que ajustes las gobiernan y que texto llevan. Todo lo
 * demas -- la escala, el borde de cada letra, el orden de pintado -- es
 * identico, y tenerlo dos veces garantizaba que un dia se separaran.
 *
 * El lienzo se pinta a 270 px de ancho, asi que lo que viene en pixeles del
 * lienzo se multiplica por esta escala.
 */
const ESCALA_PV = 270 / 1080;

const CAPAS = {
  sub: {
    clase: 'pv-sub',
    // De abajo: es donde viven los subtitulos y donde TikTok pone su interfaz.
    lado: 'bottom',
    activa: 'subtitles',
    pos: 'subMargin',
    tam: 'subSize',
    color: 'subColor',
    borde: 'subColorBorde',
    grosor: 'subBorde',
    // Los limites son los mismos que valida el servidor. Arrastrar fuera de
    // rango produciria un ajuste que al guardar se rechaza, y el usuario veria
    // un error por haber movido el raton.
    // 400: por debajo lo tapa la interfaz de TikTok (zona segura, Fase 5).
    min: 400,
    max: 900,
  },
  titulo: {
    clase: 'pv-titulo',
    lado: 'top',
    activa: 'tituloActivo',
    pos: 'tituloArriba',
    tam: 'tituloTam',
    color: 'tituloColor',
    borde: 'tituloColorBorde',
    grosor: 'tituloBorde',
    min: 80,
    max: 700,
  },
};

/** El texto que lleva cada capa, con los ajustes y el clip de muestra. */
function textoCapa(cual, a, m) {
  const pie = String(m.hook || m.caption || '');
  if (cual === 'titulo') {
    // Lo mismo que hace renderClip: la plantilla con el pie dentro.
    const t = String(a.tituloTexto || '{titulo}').replaceAll('{titulo}', pie).trim();
    return t || 'el título del clip';
  }
  // Doble barra: este guion vive dentro de un template literal y un \\s suelto
  // llegaria al navegador como una s.
  const palabras = pie.split(/\\s+/).filter(Boolean);
  return palabras.slice(0, Math.max(1, a.subPalabras)).join(' ') || 'así se veran';
}

/** El estilo en linea de una capa, en pixeles ya escalados. */
function estiloCapa(cual, a) {
  const c = CAPAS[cual];
  return [
    // La fuente es la misma para las dos: el .ass declara los dos estilos con
    // el mismo Fontname, porque libass resuelve por nombre contra las
    // instaladas y mezclar dos familias pediria instalar otra.
    'font-family:' + JSON.stringify(a.subFont).slice(1, -1) + ',Impact,sans-serif',
    'font-size:' + (a[c.tam] * ESCALA_PV).toFixed(1) + 'px',
    'color:' + a[c.color],
    // El borde del .ass rodea cada letra por los cuatro lados. En el navegador
    // eso es -webkit-text-stroke, que se mide por el centro del trazo: la
    // mitad, para que el grosor aparente coincida.
    '-webkit-text-stroke:' + Math.max(0, a[c.grosor] * ESCALA_PV / 2).toFixed(2) + 'px ' + a[c.borde],
    'paint-order:stroke fill',
    c.lado + ':' + (a[c.pos] * ESCALA_PV).toFixed(1) + 'px',
  ].join(';');
}

/**
 * Crea, actualiza o quita una capa sin repintar la vista entera.
 *
 * Un render completo recrearia la etiqueta video y cortaria la reproduccion
 * en cada tecla, que es justo lo que no se quiere mientras se afina un color.
 */
function pintarCapa(marco, cual, a, m) {
  const c = CAPAS[cual];
  const existente = marco.querySelector('.' + c.clase);
  if (!a[c.activa]) { if (existente) existente.remove(); return; }

  const nodo = existente ?? marco.appendChild(Object.assign(
    document.createElement('div'),
    {
      className: c.clase + ' pv-capa',
      title: 'Arrastra para moverlo, o pulsa y usa las flechas',
      // tabindex aqui tambien: una capa creada al encenderla en vivo tiene
      // que poder colocarse con el teclado igual que una pintada de entrada.
      tabIndex: 0,
    },
  ));
  nodo.dataset.capa = cual;
  nodo.textContent = textoCapa(cual, a, m);
  nodo.setAttribute('style', estiloCapa(cual, a));
}

/*
 * ARRASTRAR PARA COLOCAR.
 *
 * Elegir la altura en un desplegable de cinco opciones es elegir a ciegas:
 * "alto" y "casi en el centro" no dicen si tapa la cara de quien habla. Aqui
 * se ve el video detras, se agarra el texto y se suelta donde va.
 *
 * El valor que sale del arrastre casi nunca coincide con una de las opciones
 * del desplegable, asi que se le AÑADE una opcion con ese numero y se
 * selecciona. De ese modo el desplegable sigue siendo la unica fuente de
 * verdad: guardar manda lo que ponga ahi, igual que antes, y no hay un estado
 * paralelo que pueda discrepar de lo que se ve.
 */
function fijarAjuste(key, valor) {
  const sel = document.querySelector('[data-ajuste="' + key + '"]');
  if (!sel) return;
  const v = String(valor);
  if (![...sel.options].some(o => o.value === v)) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = 'a mano (' + v + ')';
    sel.append(o);
  }
  sel.value = v;
}

let arrastre = null;

document.addEventListener('pointerdown', e => {
  const capa = e.target.closest('.pv-capa');
  if (!capa) return;
  const marco = capa.closest('.pv-marco');
  if (!marco) return;
  e.preventDefault();
  const c = CAPAS[capa.dataset.capa];
  const a = ajustesDelFormulario();
  arrastre = {
    capa,
    c,
    // Se guarda el punto de partida y se suma el desplazamiento, en vez de
    // colocar el texto donde esta el puntero: agarrar por el borde no debe
    // hacer que el texto salte para centrarse en el dedo.
    y0: e.clientY,
    desde: a[c.pos],
    alto: marco.getBoundingClientRect().height,
  };
  // Captura: el puntero puede salirse del texto -- que es pequeño -- sin que
  // el arrastre se corte a mitad.
  capa.setPointerCapture(e.pointerId);
  capa.classList.add('moviendo');
});

document.addEventListener('pointermove', e => {
  if (!arrastre) return;
  const { c, y0, desde, alto } = arrastre;
  // De pixeles de pantalla a pixeles del lienzo de 1920.
  const delta = ((e.clientY - y0) / alto) * 1920;
  // Arriba se mide desde el techo y abajo desde el suelo, asi que el mismo
  // gesto hacia abajo suma en una capa y resta en la otra.
  const crudo = c.lado === 'top' ? desde + delta : desde - delta;
  const valor = Math.round(Math.min(c.max, Math.max(c.min, crudo)));
  fijarAjuste(c.pos, valor);
  refrescarVistaPrevia();
});

for (const fin of ['pointerup', 'pointercancel']) {
  document.addEventListener(fin, () => {
    if (!arrastre) return;
    arrastre.capa.classList.remove('moviendo');
    arrastre = null;
    // No se guarda solo: el arrastre es tanteo, igual que mover un
    // desplegable. Lo guarda el boton de abajo, como todo lo demas.
  });
}

/*
 * Mover con el teclado lo mismo que con el raton.
 *
 * Sin esto, la altura del rotulo seria el unico ajuste del panel que no se
 * puede tocar sin raton. Las flechas mueven de 10 en 10 pixeles del lienzo, y
 * con Mayus de 50: a 10 px por pulsacion, recorrer los 620 px de rango serian
 * sesenta y dos pulsaciones.
 */
document.addEventListener('keydown', e => {
  const capa = e.target.closest?.('.pv-capa');
  if (!capa) return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const c = CAPAS[capa.dataset.capa];
  const a = ajustesDelFormulario();
  const paso = (e.shiftKey ? 50 : 10) * (e.key === 'ArrowDown' ? 1 : -1);
  const crudo = c.lado === 'top' ? a[c.pos] + paso : a[c.pos] - paso;
  fijarAjuste(c.pos, Math.round(Math.min(c.max, Math.max(c.min, crudo))));
  refrescarVistaPrevia();
  // El repintado reemplaza el contenido pero NO el nodo, asi que el foco se
  // queda donde estaba y se puede seguir pulsando la flecha.
  capa.focus();
});

/** La capa, en HTML, para la primera pintada de la vista previa. */
function capaHtml(cual, a, m) {
  const c = CAPAS[cual];
  if (!a[c.activa]) return '';
  return '<div class="' + c.clase + ' pv-capa" data-capa="' + cual + '" tabindex="0"' +
    ' title="Arrastra para moverlo, o pulsa y usa las flechas"' +
    ' style="' + estiloCapa(cual, a) + '">' + esc(textoCapa(cual, a, m)) + '</div>';
}

// --- Ajustar el corte de un momento ---------------------------------------

/*
 * Mover el principio y el final de un clip sin salir de Revisar.
 *
 * Hasta ahora un momento cortado dos segundos tarde no tenia arreglo desde el
 * panel: o se descartaba o se publicaba con el arranque flojo. La unica
 * alternativa era rehacer el VOD entero, que son veinte minutos de GPU para
 * corregir uno.
 *
 * El gesto NO es una forma de onda. Aqui no hace falta: el video ya esta
 * delante y reproduciendose, asi que lo natural es pararlo donde debe empezar
 * y decir "empieza aqui". Una onda obligaria a descargar y decodificar el
 * audio de cada clip para enseñar un dibujo del que, al final, se deduce lo
 * mismo que ya se ve y se oye.
 *
 * Los numeros son del VOD, no del clip: son los que entiende el render y los
 * que se ven en la cabecera de la tarjeta.
 */

/** Los dos campos de un recorte, leidos de la tarjeta. */
function corteDe(card) {
  const ini = card.querySelector('.corte-ini');
  const fin = card.querySelector('.corte-fin');
  if (!ini || !fin) return null;
  return { start: Number(ini.value), end: Number(fin.value) };
}

/** Pone al dia la duracion y si el boton se puede pulsar. */
function pintarCorte(card) {
  const c = corteDe(card);
  if (!c) return;
  const aviso = card.querySelector('.corte-aviso');
  const boton = card.querySelector('[data-rehacer]');
  const dur = c.end - c.start;

  let problema = '';
  if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) problema = 'Faltan los segundos.';
  else if (dur <= 0) problema = 'El final tiene que ir después del principio.';
  else if (dur < 5) problema = 'Menos de 5 segundos no da para un clip.';
  else if (dur > 180) problema = 'Más de 3 minutos no cabe en un corte.';

  // Sin cambios no hay nada que rehacer: el boton apagado dice eso mejor que
  // dejar lanzar un render que produce el mismo fichero.
  const igual = String(c.start) === card.dataset.start && String(c.end) === card.dataset.end;

  aviso.textContent = problema !== '' ? problema
    : igual ? 'Sin cambios.'
    : 'Quedaria en ' + dur.toFixed(1) + ' s.';
  aviso.classList.toggle('mal', problema !== '');
  boton.disabled = problema !== '' || igual;
}

/**
 * Lanza el rehacer de un solo clip.
 *
 * Primero lo devuelve a pendientes y solo despues encola el render. El orden
 * importa: un clip aprobado con el corte cambiado seguiria aprobado y se
 * publicaria un video que nadie ha visto, porque la aprobacion era del corte
 * viejo. Si el primer paso falla, el segundo no llega a lanzarse.
 */
async function rehacerCorte(card) {
  const c = corteDe(card);
  if (!c) return;
  const sourceId = card.dataset.source;
  const clipId = card.dataset.clip;
  const boton = card.querySelector('[data-rehacer]');
  boton.disabled = true;

  try {
    await api('/api/clips/' + encodeURIComponent(sourceId) + '/' + encodeURIComponent(clipId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    await api('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'render',
        params: { sourceId, clipId, start: c.start, end: c.end },
      }),
    });
    avisar('Rehaciendo ' + clipId + '. Tarda menos de un minuto; aparecerá con el corte nuevo.');
  } catch (error) {
    avisar(error.message);
    boton.disabled = false;
    return;
  }
  await refrescar();
}

document.addEventListener('click', e => {
  const card = e.target.closest('.card[data-clip]');
  if (!card) return;

  /*
   * "Empieza aqui" y "Acaba aqui" toman el instante del video.
   *
   * El reproductor va de 0 al final del clip; el corte se mide sobre el VOD.
   * Sumar el principio original traduce de uno a otro, y es la unica cuenta
   * que hay en todo esto.
   */
  const marca = e.target.closest('[data-marcar]');
  if (marca) {
    // En Revisar el video esta en la zona central, fuera del detalle.
    const video = card.querySelector('video') ?? document.getElementById('video-clip');
    if (!video) return;
    const base = Number(card.dataset.start);
    const t = Number((base + video.currentTime).toFixed(2));
    const campo = card.querySelector(marca.dataset.marcar === 'ini' ? '.corte-ini' : '.corte-fin');
    campo.value = String(t);
    pintarCorte(card);
    return;
  }

  if (e.target.closest('[data-rehacer]')) { rehacerCorte(card); return; }

  if (e.target.closest('[data-corte-reset]')) {
    card.querySelector('.corte-ini').value = card.dataset.start;
    card.querySelector('.corte-fin').value = card.dataset.end;
    pintarCorte(card);
  }
});

document.addEventListener('input', e => {
  if (!e.target.matches?.('.corte-ini, .corte-fin')) return;
  const card = e.target.closest('.card[data-clip]');
  if (card) pintarCorte(card);
});

// --- La lista de cuentas, que crece con el numero de cuentas ---------------

/*
 * La misma pantalla con una cuenta y con doscientas.
 *
 * Medido antes de tocar nada, inyectando cuentas falsas y midiendo el render
 * real: con 20 cuentas la lista media 1.776 px; con 200, 16.581 px y 495
 * botones. El pintado tardaba 8 ms, o sea que nunca fue un problema de
 * velocidad: eran veinte pantallas de scroll sin buscador, sin filtro y sin
 * forma de pausar diez de golpe.
 *
 * Pero meter buscador y filtros a quien tiene tres cuentas es peor que no
 * tenerlos: son tres controles para elegir entre tres cosas que ya se ven
 * enteras. Por eso el umbral: por debajo, la lista de siempre; a partir de
 * ahi, las herramientas. Nadie tiene que aprender nada hasta que le hace
 * falta.
 */
const CUENTAS_UMBRAL = 6;

/*
 * Cuantas filas se pintan como mucho.
 *
 * Con doscientas cuentas y sin filtrar, la lista mide dieciseis mil
 * setecientos pixeles: veinte pantallas de scroll. El buscador y los filtros
 * de arriba resuelven el caso de "quiero esta cuenta", pero el primer vistazo
 * seguia siendo un muro.
 *
 * Se corta en cincuenta y se dice cuantas quedan fuera. No es virtualizar:
 * virtualizar mantiene el scroll de las doscientas y aqui eso no aporta nada,
 * porque nadie recorre doscientas cuentas con la rueda. Lo que se hace con
 * doscientas cuentas es BUSCAR una, y para eso esta la barra.
 */
const CUENTAS_MAX_FILAS = 50;

/** Normaliza para buscar: sin acentos y sin mayusculas. */
function planoCuenta(t) {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Las cuentas que pasan el buscador y los filtros de ahora mismo. */
function cuentasVisibles(todas) {
  const f = state.filtroCuentas;
  const q = planoCuenta(f.texto).split(' ').filter(Boolean);
  return todas.filter(c => {
    if (f.estado === 'activas' && !c.activa) return false;
    if (f.estado === 'pausadas' && c.activa) return false;
    if (f.estado === 'sin-enlazar' && c.tiktok) return false;
    if (f.cliente === 'sin' && c.clienteId) return false;
    if (f.cliente !== '' && f.cliente !== 'sin' && c.clienteId !== f.cliente) return false;
    if (q.length === 0) return true;
    const texto = planoCuenta(c.id + ' ' + (c.alias ?? '') + ' ' + (c.tiktok ?? ''));
    return q.every(p => texto.includes(p));
  });
}

/** Una fila de cuenta. Es lo que habia, mas la casilla cuando toca. */
function filaCuenta(c, nombre, porUploadPost, conCasilla) {
  return '<li' + (c.activa ? '' : ' style="opacity:.55"') + '>' +
    (conCasilla
      ? '<label class="marca-cuenta"><input type="checkbox" data-ccheck="' + esc(c.id) + '"' +
        (state.selCuentas.has(c.id) ? ' checked' : '') +
        ' aria-label="Marcar ' + esc(c.id) + '"></label>'
      : '') +
    '<span class="punto-estado ' + (c.activa ? 'si' : 'no') + '"></span>' +
    '<span class="nombre">' + esc(c.alias || c.id) + '</span>' +
    (c.alias ? '<span class="dato id-cuenta">' + esc(c.id) + '</span>' : '') +
    (c.activa ? '' : '<span class="badge">en pausa</span>') +
    resultadoCuenta(c) +
    (c.limiteDiario ? '<span class="badge">' + c.limiteDiario + ' al día</span>' : '') +
    (c.plataformas ?? []).filter(p => p !== 'tiktok').map(p =>
      '<span class="badge">' + (p === 'youtube' ? 'Shorts' : 'Reels') + '</span>').join('') +
    (c.tiktok
      ? '<span class="badge ok">@' + esc(c.tiktok) + '</span>'
      : (porUploadPost ? '' : '<span class="badge">sin enlazar</span>')) +
    // El cliente ya no va en la fila: las cuentas se agrupan por cliente.
    (c.activa
      ? '<button class="chip" data-cpausar="' + esc(c.id) + '">Pausar</button>'
      : '<button class="chip" data-cactivar="' + esc(c.id) + '">Activar</button>' +
        // Borrar solo se ofrece en las pausadas: una cuenta en uso no se
        // borra por accidente, y el servidor rechaza igualmente las que
        // tengan historial o permiso guardado.
        '<button class="chip" data-cborrar="' + esc(c.id) + '">Borrar</button>') +
    (c.tiktok
      ? '<button class="chip" data-crevisar="' + esc(c.id) + '">Comprobar</button>' +
        '<button class="chip" data-colvidar="' + esc(c.id) + '">Desenlazar</button>'
      : (porUploadPost
          ? ''
          : '<button class="chip" data-cenlazar="' + esc(c.id) + '">Enlazar</button>')) +
    '<button class="chip" data-ceditar="' + esc(c.id) + '"' +
      (state.editCuenta === c.id ? ' aria-expanded="true"' : '') + '>Editar</button>' +
  '</li>' +
  (state.editCuenta === c.id ? editorCuenta(c) : '');
}

/**
 * Lo ultimo que paso al publicar en la cuenta (Fase 7).
 *
 * El error completo va en el title (Ver detalles al pasar el raton): en la
 * fila solo cabe si fue bien o mal y cuando.
 */
function resultadoCuenta(c) {
  if (!c.ultimoResultado) return '';
  if (c.ultimoResultado === 'ok') {
    return '<span class="badge ok">Publicó ' + esc(hace(c.ultimoResultadoEn)) + '</span>';
  }
  return '<span class="badge error" title="' + esc(c.ultimoError ?? '') + '">Falló ' +
    esc(hace(c.ultimoResultadoEn)) + '</span>';
}

/** Editor en linea: alias, tope diario y plataformas. */
function editorCuenta(c) {
  const plats = new Set(c.plataformas ?? ['tiktok']);
  const caja = (v, t, disponible) =>
    '<label class="opcion-plat"><input type="checkbox" data-cplat="' + v + '"' +
      (plats.has(v) ? ' checked' : '') + (disponible ? '' : ' disabled') + '> ' + t + '</label>';
  return '<li class="editor-cuenta">' +
    '<div class="field"><label for="alias-' + esc(c.id) + '">Alias</label>' +
      '<input id="alias-' + esc(c.id) + '" data-calias maxlength="40" value="' + esc(c.alias ?? '') + '"' +
      ' placeholder="' + esc(c.id) + '" autocomplete="off"></div>' +
    '<div class="field"><label for="tope-' + esc(c.id) + '">Publicaciones al día</label>' +
      '<select id="tope-' + esc(c.id) + '" data-ctope>' +
        '<option value="">Las del horario</option>' +
        [1, 2, 3, 4, 5, 6, 8, 10].map(n =>
          '<option value="' + n + '"' + (c.limiteDiario === n ? ' selected' : '') + '>Como mucho ' + n + '</option>').join('') +
      '</select></div>' +
    '<fieldset class="plats"><legend>Dónde publica</legend>' +
      caja('tiktok', 'TikTok', false) +
      caja('youtube', 'YouTube Shorts', plataformaLista('youtube')) +
      caja('instagram', 'Instagram Reels', plataformaLista('instagram')) +
    '</fieldset>' +
    '<p class="reason" style="margin:0">Shorts y Reels salen por el mismo perfil de upload-post: ' +
      'conéctalos allí antes de marcarlos.</p>' +
    '<div class="chips"><button class="chip primario" data-cguardar="' + esc(c.id) + '">Guardar</button>' +
      '<button class="chip" data-ceditar="' + esc(c.id) + '">Cancelar</button></div>' +
  '</li>';
}

/** Si una plataforma se puede marcar: solo las que el proveedor sabe publicar. */
function plataformaLista(id) {
  const p = (state.plataformas?.plataformas ?? []).find(x => x.id === id);
  return !!p && p.estado !== 'no-disponible';
}

/**
 * Las filas, agrupadas por cliente (Fase 7).
 *
 * Sin clientes creados es la lista de siempre: con dos cuentas y ningun
 * cliente, una caja "Sin cliente" seria un vacio que no explica nada.
 */
function gruposCuentas(cuentas, clientes, nombre, porUploadPost, conCasilla) {
  const fila = c => filaCuenta(c, nombre, porUploadPost, conCasilla);
  if (!clientes || clientes.length === 0) {
    return '<ul class="lista-campanas">' + cuentas.map(fila).join('') + '</ul>';
  }
  const grupos = clientes
    .map(k => ({ id: k.id, nombre: k.nombre, cuentas: cuentas.filter(c => c.clienteId === k.id) }))
    .filter(g => g.cuentas.length > 0);
  const sin = cuentas.filter(c => !c.clienteId);
  if (sin.length > 0) grupos.push({ id: 'sin', nombre: 'Sin cliente', cuentas: sin });
  return grupos.map(g => {
    const activas = g.cuentas.filter(c => c.activa).length;
    const enlazadas = g.cuentas.filter(c => c.tiktok).length;
    return '<section class="grupo-cuentas">' +
      '<div class="grupo-cab">' +
        '<h4>' + esc(g.nombre) + '</h4>' +
        '<span class="reason" style="margin:0">' + plural(g.cuentas.length, 'cuenta') +
          (activas < g.cuentas.length ? ', ' + activas + ' publican' : '') + '</span>' +
        '<span class="hueco"></span>' +
        (activas > 0 ? '<button class="chip" data-cgrupo="pausar" data-grupo="' + esc(g.id) + '">Pausar todas</button>' : '') +
        (activas < g.cuentas.length ? '<button class="chip" data-cgrupo="activar" data-grupo="' + esc(g.id) + '">Activar todas</button>' : '') +
        (enlazadas > 0 ? '<button class="chip" data-cgrupo="revisar" data-grupo="' + esc(g.id) + '">Comprobar todas</button>' : '') +
      '</div>' +
      '<ul class="lista-campanas">' + g.cuentas.map(fila).join('') + '</ul>' +
    '</section>';
  }).join('');
}

/** Buscador, filtros y barra de lotes. Solo a partir del umbral. */
function herramientasCuentas(todas, clientes) {
  const f = state.filtroCuentas;
  const activas = todas.filter(c => c.activa).length;
  const sinEnlazar = todas.filter(c => !c.tiktok).length;

  const opcion = (v, t, puesto) =>
    '<option value="' + v + '"' + (puesto === v ? ' selected' : '') + '>' + t + '</option>';

  /*
   * Una linea de resumen que ADEMAS filtra.
   *
   * El encargo pedia "18 activas, 2 necesitan reconexion" llevando directo a
   * resolverlo. Aqui el resumen y el filtro son lo mismo: pulsar "en pausa"
   * deja en pantalla solo esas, que es lo que se iba a hacer a continuacion.
   */
  return '<div class="cuentas-barra">' +
      '<input type="search" id="buscar-cuenta" placeholder="Buscar por nombre o arroba"' +
        ' value="' + esc(f.texto) + '" autocomplete="off" spellcheck="false">' +
      '<select data-cfiltro="estado">' +
        opcion('', 'Todas (' + todas.length + ')', f.estado) +
        opcion('activas', 'Activas (' + activas + ')', f.estado) +
        opcion('pausadas', 'En pausa (' + (todas.length - activas) + ')', f.estado) +
        opcion('sin-enlazar', 'Sin enlazar (' + sinEnlazar + ')', f.estado) +
      '</select>' +
      (clientes.length > 0
        ? '<select data-cfiltro="cliente">' +
            opcion('', 'Cualquier cliente', f.cliente) +
            opcion('sin', 'Sin asignar', f.cliente) +
            clientes.map(c => opcion(c.id, c.nombre, f.cliente)).join('') +
          '</select>'
        : '') +
    '</div>';
}

/** La barra de acciones en lote, visible solo con algo marcado. */
function loteCuentas(clientes) {
  const n = state.selCuentas.size;
  return '<div class="lote' + (n === 0 ? '' : ' puesta') + '"' + (n === 0 ? ' hidden' : '') + '>' +
      '<span class="cuantos">' + plural(n, 'cuenta') + '</span>' +
      '<button class="chip" data-clote="activar">Activar</button>' +
      '<button class="chip" data-clote="pausar">Pausar</button>' +
      (clientes.length > 0
        ? '<select data-clote-cliente>' +
            '<option value="">Asignar a cliente...</option>' +
            '<option value="sin">Quitar el cliente</option>' +
            clientes.map(c => '<option value="' + esc(c.id) + '">' + esc(c.nombre) + '</option>').join('') +
          '</select>'
        : '') +
      '<span class="hueco"></span>' +
      '<button class="chip" data-cnada>Quitar la marca</button>' +
    '</div>';
}

// --- Buscar, filtrar y actuar en lote sobre las cuentas --------------------

/*
 * El buscador NO repinta la pantalla entera.
 *
 * vistaPlataformas() vuelve a construir el HTML de la seccion, y eso recrea el
 * propio campo de texto: al teclear la segunda letra el foco ya no esta
 * dentro. Se repinta solo la lista y se le devuelve el cursor donde estaba.
 */
function repintarCuentas() {
  const vista = document.getElementById('view');
  if (!vista || state.view !== 'plataformas') return;
  const campo = document.getElementById('buscar-cuenta');
  const cursor = campo ? campo.selectionStart : null;
  vista.innerHTML = vistaPlataformas();
  const intro = INTROS[state.view];
  if (intro) vista.insertAdjacentHTML('afterbegin', '<p class="intro ancho">' + esc(intro) + '</p>');
  const nuevo = document.getElementById('buscar-cuenta');
  if (nuevo && campo) {
    nuevo.focus();
    if (cursor !== null) nuevo.setSelectionRange(cursor, cursor);
  }
}

document.addEventListener('input', e => {
  if (e.target.id !== 'buscar-cuenta') return;
  state.filtroCuentas.texto = e.target.value;
  repintarCuentas();
});

document.addEventListener('change', e => {
  const f = e.target.closest('[data-cfiltro]');
  if (f) {
    state.filtroCuentas[f.dataset.cfiltro] = f.value;
    repintarCuentas();
    return;
  }

  const asignar = e.target.closest('[data-clote-cliente]');
  if (asignar && asignar.value !== '') {
    const clienteId = asignar.value === 'sin' ? null : asignar.value;
    loteCuentasAccion('cliente', clienteId);
    asignar.value = '';
  }
});

document.addEventListener('click', e => {
  if (state.view !== 'plataformas') return;

  const casilla = e.target.closest('[data-ccheck]');
  if (casilla) {
    const id = casilla.dataset.ccheck;
    if (casilla.checked) state.selCuentas.add(id);
    else state.selCuentas.delete(id);
    repintarCuentas();
    return;
  }

  if (e.target.closest('[data-ctodas]')) {
    for (const c of cuentasVisibles(state.proyectos?.cuentas ?? [])) state.selCuentas.add(c.id);
    repintarCuentas();
    return;
  }

  if (e.target.closest('[data-cnada]')) {
    state.selCuentas.clear();
    repintarCuentas();
    return;
  }

  const lote = e.target.closest('[data-clote]');
  if (lote) loteCuentasAccion(lote.dataset.clote, null);
});

/**
 * Aplica una accion a todas las cuentas marcadas.
 *
 * Una peticion por cuenta y no una sola con la lista: el servidor ya tiene
 * las acciones de una en una, probadas y con sus reglas (una cuenta con
 * historial no se borra, pausar recalcula franjas). Inventar un endpoint de
 * lote duplicaria esas reglas en dos sitios para ahorrar unas peticiones que
 * aqui no cuestan nada: son decenas, no miles, y las lanza una persona
 * pulsando un boton.
 *
 * Se mandan EN SERIE. En paralelo, veinte escrituras simultaneas sobre la
 * misma tabla de franjas se pisarian entre ellas.
 */
document.addEventListener('click', async e => {
  const editar = e.target.closest('[data-ceditar]');
  if (editar) {
    state.editCuenta = state.editCuenta === editar.dataset.ceditar ? null : editar.dataset.ceditar;
    repintarCuentas();
    return;
  }

  const guardar = e.target.closest('[data-cguardar]');
  if (guardar) {
    const caja = guardar.closest('.editor-cuenta');
    const tope = caja.querySelector('[data-ctope]').value;
    guardar.disabled = true;
    try {
      await api('/api/cuentas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accion: 'editar',
          id: guardar.dataset.cguardar,
          alias: caja.querySelector('[data-calias]').value,
          limiteDiario: tope === '' ? null : Number(tope),
          plataformas: [...caja.querySelectorAll('[data-cplat]:checked')].map(x => x.dataset.cplat),
        }),
      });
      state.editCuenta = null;
      avisar('Cuenta guardada.');
      await refrescar();
    } catch (err) {
      guardar.disabled = false;
      alert(err.message);
    }
    return;
  }

  const grupo = e.target.closest('[data-cgrupo]');
  if (grupo) {
    const id = grupo.dataset.grupo;
    const accion = grupo.dataset.cgrupo;
    const cuentas = (state.proyectos?.cuentas ?? []).filter(c =>
      (id === 'sin' ? !c.clienteId : c.clienteId === id) &&
      (accion === 'pausar' ? c.activa : accion === 'activar' ? !c.activa : !!c.tiktok));
    state.selCuentas = new Set(cuentas.map(c => c.id));
    await loteCuentasAccion(accion);
  }
});

async function loteCuentasAccion(accion, clienteId) {
  const ids = [...state.selCuentas];
  if (ids.length === 0) return;

  const barra = document.querySelector('.lote');
  if (barra) for (const b of barra.querySelectorAll('button, select')) b.disabled = true;

  let hechas = 0;
  const fallos = [];
  for (const id of ids) {
    try {
      if (accion === 'cliente') {
        await api('/api/proyectos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // El servidor llama a este campo destino, no clienteId.
          body: JSON.stringify({ accion: 'asignar-cuenta', id, destino: clienteId }),
        });
      } else {
        await api('/api/cuentas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ accion, id }),
        });
      }
      hechas += 1;
    } catch (err) {
      fallos.push(id + ': ' + err.message);
    }
  }

  state.selCuentas.clear();
  // Se dicen las que fallaron, no solo las que salieron. Un "listo" despues de
  // mandar veinte cuando entraron dieciocho es como no decir nada.
  avisar(
    plural(hechas, 'cuenta') + ' ' +
    (accion === 'pausar' ? 'en pausa'
      : accion === 'activar' ? 'activada' + (hechas === 1 ? '' : 's')
      : accion === 'revisar' ? 'comprobada' + (hechas === 1 ? '' : 's')
      : 'reasignada' + (hechas === 1 ? '' : 's')) +
    (fallos.length > 0 ? '. ' + plural(fallos.length, 'fallo') + ': ' + fallos[0] : '.'),
  );
  await refrescar();
}

// --- El tope de cuentas, por plan de upload-post --------------------------

/*
 * El tope ya no se teclea: se elige el plan y el cupo viene con el.
 *
 * Quien decide cuantas cuentas caben no es este programa, es el plan
 * contratado. Una cuenta por encima del cupo es una que falla al publicar
 * porque no tiene perfil al otro lado, y lo que llega es un rechazo del
 * proveedor, no un "te falta plan".
 *
 * La tabla de planes la manda el servidor (publish/planes.ts). Aqui no hay
 * ninguna copia: duplicarla seria asegurarse de que un dia digan cosas
 * distintas.
 */

/** Una opcion por plan, con lo que cuesta y cuantos perfiles trae. */
function opcionesPlan(d, actual) {
  const planes = d.planes ?? [];
  const n = Number(actual);

  const opts = planes.map(p =>
    '<option value="' + p.perfiles + '"' + (n === p.perfiles ? ' selected' : '') + '>' +
      esc(p.nombre) + ' - ' + p.perfiles + ' cuenta' + (p.perfiles === 1 ? '' : 's') +
      ' - ' + (p.usd === 0 ? 'gratis' : p.usd + ' USD al mes') +
    '</option>'
  ).join('');

  /*
   * Si el tope guardado no es el de ningun plan, se añade su propia opcion.
   *
   * Pasa cuando upload-post cambia los cupos, cuando se publica por la API
   * propia de TikTok (donde estos planes no pintan nada) o cuando alguien lo
   * dejo en 100 antes de que esto existiera. Sin esta opcion el desplegable
   * se abriria mostrando un plan que no es el que esta guardado, y guardar
   * cualquier otra cosa cambiaria el tope sin que nadie lo pidiera.
   */
  const suelto = Number.isFinite(n) && !planes.some(p => p.perfiles === n)
    ? '<option value="' + n + '" selected>A mano - ' + n + ' cuentas</option>'
    : '';

  return opts + suelto;
}

/** Lo que implica el plan elegido, debajo del desplegable. */
function notaDelPlan(d, actual) {
  const planes = d.planes ?? [];
  const n = Number(actual);
  const plan = planes.find(p => p.perfiles === n);
  const creadas = d.cuentas?.creadas ?? 0;

  const trozos = [];

  /*
   * Con la API propia de TikTok, estos planes no pintan nada.
   *
   * upload-post cobra por perfiles; la API propia no tiene perfiles que
   * comprar, cada cuenta autoriza la app directamente. Enseñar precios de un
   * servicio que no se esta usando haria creer que hay que pagarlos.
   */
  if ((d.proveedor ?? 'upload-post') !== 'upload-post') {
    return '<p class="reason" style="margin:var(--s2) 0 0">' +
      'Estas publicando por la API de TikTok, no por upload-post, así que estos planes ' +
      'no te afectan: el tope es solo tuyo. Cada cuenta autoriza la app por su cuenta.' +
    '</p>';
  }

  // El aviso del plan va primero y en ambar: es lo unico que puede dejar el
  // programa sin publicar.
  if (plan?.aviso) {
    trozos.push('<p class="warn" style="margin:var(--s2) 0 0">' + esc(plan.aviso) + '</p>');
  }

  /*
   * Si ya tienes mas cuentas que el cupo, se dice y se dice cuantas sobran.
   *
   * El servidor impide CREAR por encima del tope, pero no borra las que ya
   * existian: bajar de plan con veinte creadas no las hace desaparecer, las
   * deja sin perfil al otro lado. Eso hay que verlo aqui y no descubrirlo en
   * el primer fallo de publicacion.
   */
  if (Number.isFinite(n) && creadas > n) {
    trozos.push(
      '<p class="warn" style="margin:var(--s2) 0 0">' +
        'Tienes ' + plural(creadas, 'cuenta creada', 'cuentas creadas') + ' y este plan admite ' + n + '. ' +
        'Las ' + (creadas - n) + ' que sobran fallaran al publicar hasta que las borres ' +
        'o subas de plan.' +
      '</p>',
    );
  } else if (Number.isFinite(n)) {
    const libres = n - creadas;
    const hueco = libres > 0
      ? 'Te quedan ' + plural(libres, 'cuenta') + ' por crear.'
      : 'Has llegado al tope.';
    trozos.push(
      '<p class="reason" style="margin:var(--s2) 0 0">' + hueco + ' ' +
        (plan === undefined
          // Un tope que no es de ningun plan: puede venir de un cambio de
          // precios de upload-post, de publicar por la API propia de TikTok o
          // de haberlo puesto a mano. Las tres son legitimas y ninguna
          // merece un aviso, pero si decir que nadie lo esta respaldando.
          ? 'Este tope no corresponde a ningún plan de upload-post: lo pusiste a mano.'
          : 'Cambiar esto aquí NO cambia tu plan en upload-post: hay que contratarlo allí.') +
      '</p>',
    );
  }

  return trozos.join('');
}

// Fase 3: controles de Añadir video y filtros de Videos.
document.addEventListener('click', e => {
  const modo = e.target.closest('[data-anadir-modo]');
  if (modo) { state.anadirModo = modo.dataset.anadirModo; render(); return; }
  const filtro = e.target.closest('[data-filtro-videos]');
  if (filtro) { state.filtroVideos = filtro.dataset.filtroVideos; render(); return; }
  const ir = e.target.closest('[data-ir][data-modo]');
  if (ir) state.anadirModo = ir.dataset.modo;
});
document.addEventListener('change', e => {
  if (e.target.name === 'tipo-video') { state.tipoVideo = e.target.value; render(); }
});
`
