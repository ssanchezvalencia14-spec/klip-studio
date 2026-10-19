/**
 * Las pantallas de entrada: iniciar sesion y cambiar la contraseña.
 *
 * Paginas de servidor, sin JavaScript: un formulario que se envia por POST.
 * Asi funcionan igual con el guion del panel roto, en cualquier movil y sin
 * que la contraseña pase por ningun codigo nuestro en el navegador.
 *
 * Colores y medidas de la Fase 3 (modo oscuro, acento azul), aunque el resto
 * del panel aun no los use: esta es la primera pantalla que ve todo el mundo.
 */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

const ESTILOS = `
  :root {
    --app:#0B0C10; --tarjeta:#12141B; --elevado:#181B24; --borde:#252A36; --borde-hover:#3A4258;
    --texto:#ECEEF4; --texto-2:#B3BACB; --apoyo:#9BA3B5;
    --acento:#5B7CFF; --acento-texto:#8FA5FF; --error:#FF7A7A; --error-fondo:#1A1111;
    --aviso:#FFB454; --aviso-fondo:#171510;
  }
  * { box-sizing: border-box; }
  body {
    margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px;
    background:var(--app); color:var(--texto);
    font:16px/1.55 "DM Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .caja { width:100%; max-width:400px; }
  .marca { display:flex; align-items:center; gap:10px; justify-content:center; margin-bottom:28px; }
  .k {
    width:36px; height:36px; border-radius:10px; background:var(--acento); color:#fff;
    display:grid; place-items:center; font-weight:800; font-size:19px; letter-spacing:-.02em;
  }
  .nombre { font-weight:700; font-size:18px; letter-spacing:-.01em; }
  .nombre span { color:var(--apoyo); font-weight:500; }
  .tarjeta { background:var(--tarjeta); border:1px solid var(--borde); border-radius:18px; padding:28px 24px; }
  h1 { font-size:21px; font-weight:650; margin:0 0 6px; letter-spacing:-.01em; }
  p.sub { margin:0 0 22px; color:var(--texto-2); font-size:14px; }
  form { display:flex; flex-direction:column; gap:14px; }
  label { display:flex; flex-direction:column; gap:6px; font-size:14px; color:var(--texto-2); }
  input {
    min-height:46px; padding:11px 14px; border-radius:12px;
    border:1px solid var(--borde); background:var(--elevado); color:var(--texto);
    font-size:16px; font-family:inherit;
  }
  input:hover { border-color:var(--borde-hover); }
  input:focus-visible { outline:2px solid var(--acento); outline-offset:1px; border-color:var(--acento); }
  button {
    min-height:46px; margin-top:6px; border-radius:12px; border:0; cursor:pointer;
    background:var(--acento); color:#fff; font-size:16px; font-weight:650; font-family:inherit;
  }
  button:hover { filter:brightness(1.08); }
  button:focus-visible { outline:2px solid var(--acento-texto); outline-offset:3px; }
  .error, .aviso { border-radius:12px; padding:11px 14px; font-size:14px; margin-bottom:16px; }
  .error { background:var(--error-fondo); color:var(--error); border:1px solid #3A1F1F; }
  .aviso { background:var(--aviso-fondo); color:var(--aviso); border:1px solid #3A3220; }
  .pie { margin:18px 0 0; text-align:center; font-size:13px; color:var(--apoyo); }
  @media (prefers-reduced-motion: no-preference) {
    .tarjeta { animation: entra .5s ease-out both; }
    @keyframes entra { from { opacity:0; transform:translateY(10px); } }
  }
`

function pagina(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)} · KLIP studio</title>
<style>${ESTILOS}</style></head>
<body><main class="caja">
  <div class="marca" aria-label="KLIP studio"><div class="k" aria-hidden="true">K</div>
    <div class="nombre">KLIP <span>studio</span></div></div>
  ${cuerpo}
</main></body></html>`
}

export interface OpcionesLogin {
  error?: string
  aviso?: string
  email?: string
  /** A donde volver tras entrar. Solo rutas propias. */
  volver?: string
}

export function renderLogin(o: OpcionesLogin = {}): string {
  return pagina('Entrar', `
  <section class="tarjeta">
    <h1>Entrar</h1>
    <p class="sub">Con el correo y la contraseña que te dio quien administra el panel.</p>
    ${o.error ? `<div class="error" role="alert">${esc(o.error)}</div>` : ''}
    ${o.aviso ? `<div class="aviso" role="status">${esc(o.aviso)}</div>` : ''}
    <form method="POST" action="/login">
      <input type="hidden" name="volver" value="${esc(o.volver ?? '/')}">
      <label>Correo
        <input name="email" type="email" autocomplete="username" required autofocus
               value="${esc(o.email ?? '')}">
      </label>
      <label>Contraseña
        <input name="contrasena" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit">Entrar</button>
    </form>
  </section>
  <p class="pie">¿Olvidaste la contraseña? Pide a quien administra el panel que te ponga una nueva.</p>`)
}

export function renderCambiarContrasena(o: { error?: string; obligatorio: boolean; minimo: number }): string {
  return pagina('Cambiar la contraseña', `
  <section class="tarjeta">
    <h1>Cambiar la contraseña</h1>
    <p class="sub">${o.obligatorio
      ? 'Te pusieron una contraseña provisional. Elige la tuya para seguir.'
      : 'Escribe la actual y la nueva.'} Mínimo ${o.minimo} caracteres.</p>
    ${o.error ? `<div class="error" role="alert">${esc(o.error)}</div>` : ''}
    <form method="POST" action="/cuenta/contrasena">
      <label>Contraseña actual
        <input name="actual" type="password" autocomplete="current-password" required autofocus>
      </label>
      <label>Contraseña nueva
        <input name="nueva" type="password" autocomplete="new-password" required minlength="${o.minimo}">
      </label>
      <label>Repite la nueva
        <input name="repetida" type="password" autocomplete="new-password" required minlength="${o.minimo}">
      </label>
      <button type="submit">Guardar</button>
    </form>
  </section>
  <form method="POST" action="/logout" class="pie" style="display:block">
    <button type="submit" style="background:none;color:var(--acento-texto);min-height:44px;margin:0;font-weight:500">Cerrar sesión</button>
  </form>`)
}
