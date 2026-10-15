/**
 * Paginas legales: terminos y privacidad.
 *
 * TikTok exige las dos en HTTPS para auditar una app que publique contenido.
 * Se sirven desde el propio panel: ya es HTTPS, ya es nuestro, y asi no hay que
 * desplegar nada en 9sm.site, que es otro proyecto.
 *
 * SON PUBLICAS A PROPOSITO. Junto con el retorno de OAuth, son las unicas rutas
 * que atienden sin la llave: quien las audita no tiene credenciales, y una
 * politica de privacidad tras una contraseña no cumple su funcion.
 *
 * UNA PAGINA CADA UNA, y cada afirmacion comprobable en el codigo. Lo que
 * sostiene la auditoria son cuatro parrafos: de quien es el contenido, que no
 * se toca material ajeno, que nunca vemos la contraseña, y como se revoca el
 * permiso. El resto es contexto, y el contexto largo no hace mas cierto un
 * documento: solo hace menos probable que alguien lo lea entero.
 */

/**
 * Datos del responsable.
 *
 * SOLO EL NOMBRE ES OBLIGATORIO. Un documento legal tiene que decir quien
 * responde; el correo cae a OWNER_EMAIL y la jurisdiccion se omite si no se
 * indica, en vez de inventarla. Escribir una razon social o un pais falsos
 * seria peor que no ponerlos.
 */
function titular(): { nombre: string; email: string; pais: string; completo: boolean } {
  const nombre = process.env.LEGAL_TITULAR ?? ''
  return {
    nombre,
    email: process.env.LEGAL_EMAIL ?? process.env.OWNER_EMAIL ?? '',
    pais: process.env.LEGAL_PAIS ?? '',
    completo: nombre !== '',
  }
}

const ACTUALIZADO = '24 de septiembre de 2026'

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** Sin JavaScript y sin peticiones a terceros: cargan aunque falle todo lo demas. */
function pagina(titulo: string, cuerpo: string, aviso: boolean): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(titulo)} — KLIP studio</title>
<style>
  :root { --negro:#0D0D0D; --azul:#4160E6; --blanco:#FAFAFA; --linea:#E4E4E7; --gris:#52525B; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--blanco); color:var(--negro);
         font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:40rem; margin:0 auto; padding:3.5rem 1.5rem 5rem; }
  h1 { font-size:1.5rem; letter-spacing:-.02em; margin:0 0 .2rem; }
  h2 { font-size:1rem; margin:1.8rem 0 .4rem; letter-spacing:-.01em; }
  p, li { color:#27272A; margin:.5rem 0; }
  ul { padding-left:1.2rem; }
  .fecha { color:var(--gris); font-size:.875rem; margin:0 0 1.5rem; }
  a { color:var(--azul); }
  code { background:#F4F4F5; padding:.1em .35em; border-radius:3px; font-size:.875em; }
  .aviso { background:#FEF6E7; border:1px solid #F5D9A0; color:#8A5A0B;
           padding:.8rem 1rem; border-radius:8px; margin:0 0 1.5rem; font-size:.9rem; }
  .en { margin-top:3.5rem; padding-top:2rem; border-top:1px solid var(--linea); }
  footer { margin-top:3rem; padding-top:1.2rem; border-top:1px solid var(--linea);
           color:var(--gris); font-size:.85rem; }
</style>
</head>
<body><main>
${aviso ? '<p class="aviso"><b>Borrador.</b> Falta el nombre del responsable (variable <code>LEGAL_TITULAR</code>). No envíes esta página a una auditoría hasta completarla.</p>' : ''}
${cuerpo}
<footer>KLIP studio · <a href="/legal/terminos">Términos</a> · <a href="/legal/privacidad">Privacidad</a></footer>
</main></body>
</html>`
}

/** El responsable, en una linea, con la jurisdiccion solo si se indico. */
function lineaResponsable(t: ReturnType<typeof titular>, en = false): string {
  const nombre = t.nombre === '' ? (en ? '[PENDING: name]' : '[PENDIENTE: nombre]') : t.nombre
  const jur = t.pais === '' ? '' : en ? ` Governing law: ${esc(t.pais)}.` : ` Jurisdicción: ${esc(t.pais)}.`
  return en
    ? `Responsible: ${esc(nombre)}. Contact: <a href="mailto:${esc(t.email)}">${esc(t.email)}</a>.${jur}`
    : `Responsable: ${esc(nombre)}. Contacto: <a href="mailto:${esc(t.email)}">${esc(t.email)}</a>.${jur}`
}

export function paginaTerminos(): string {
  const t = titular()
  return pagina(
    'Términos de uso',
    `
<h1>Términos de uso</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>

<p>KLIP studio es una herramienta <b>privada</b> que convierte retransmisiones y
vídeos largos propios en clips verticales y los programa para publicarlos en
cuentas de redes sociales del propio titular. No es un servicio abierto: no
admite registro ni tiene más usuarios que el titular.</p>
<p>${lineaResponsable(t)}</p>

<h2>Contenido y derechos de autor</h2>
<p><b>Todo el material procesado es propiedad del titular o cuenta con licencia
expresa.</b> No se recorta, reutiliza ni republica material de terceros. Cuando
en un vídeo propio aparecen terceros, música o marcas, el titular es responsable
de contar con los permisos necesarios.</p>
<p>Los clips son obra derivada del material original y su titularidad
corresponde a quien lo posee. Si considera que un contenido publicado con esta
herramienta vulnera sus derechos, escriba a
<a href="mailto:${esc(t.email)}">${esc(t.email)}</a> indicando el enlace: se
retirará mientras se revisa.</p>

<h2>Publicación</h2>
<p>Se realiza mediante las API oficiales de cada plataforma, con autorización
expresa de la cuenta y dentro de sus límites de uso. <b>Toda publicación pasa
antes por una aprobación humana</b>: la selección de momentos es automática y
puede equivocarse.</p>
<p>La autorización puede revocarse en cualquier momento desde los ajustes de la
propia cuenta, sin contactar con nadie.</p>

<h2>Garantías y responsabilidad</h2>
<p>La herramienta se proporciona «tal cual», sin garantía de disponibilidad,
alcance ni resultado. El titular no responde de daños derivados de fallos de las
plataformas de destino o de los proveedores de infraestructura, en la medida en
que lo permita la ley aplicable.</p>
<p>Estos términos pueden actualizarse; la fecha de revisión figura arriba.</p>

<div class="en">
<h1>Terms of Use</h1>
<p class="fecha">Last updated: 24 September 2026 · English</p>

<p>KLIP studio is a <b>private</b> tool that turns the owner's own long-form
streams into short vertical clips and schedules them for publication on social
media accounts belonging to the owner. It is not a public service: there is no
sign-up and no users other than the owner.</p>
<p>${lineaResponsable(t, true)}</p>

<h2>Content and copyright</h2>
<p><b>All processed material is owned by the owner or expressly licensed.</b> No
third-party material is clipped, reused or reposted. Where third parties, music
or trademarks appear in the owner's own video, the owner is responsible for
holding the necessary permissions.</p>
<p>Clips are derivative works of the original material and ownership remains with
its rights holder. If you believe content published through this tool infringes
your rights, write to <a href="mailto:${esc(t.email)}">${esc(t.email)}</a> with
the link: it will be taken down pending review.</p>

<h2>Publishing</h2>
<p>Performed through each platform's official API, with the account's express
authorisation and within its documented rate limits. <b>Every publication passes
through prior human approval</b>: moment selection is automated and can be
wrong.</p>
<p>Authorisation can be revoked at any time from the account's own settings,
without contacting anyone.</p>

<h2>Warranty and liability</h2>
<p>The tool is provided "as is", with no guarantee of availability, reach or
outcome. The owner is not liable for damages arising from failures of
destination platforms or infrastructure providers, to the extent permitted by
applicable law.</p>
<p>These terms may be updated; the revision date appears above.</p>
</div>
`,
    !t.completo,
  )
}

export function paginaPrivacidad(): string {
  const t = titular()
  return pagina(
    'Política de privacidad',
    `
<h1>Política de privacidad</h1>
<p class="fecha">Última actualización: ${ACTUALIZADO}</p>

<p>${lineaResponsable(t)}</p>
<p>KLIP studio es una herramienta privada de un solo titular. <b>No recoge datos
de visitantes, no tiene registro de usuarios y no hace publicidad ni
analítica.</b></p>

<h2>Qué se guarda</h2>
<ul>
<li>El correo del titular y los nombres internos de sus cuentas.</li>
<li>De cada cuenta de TikTok autorizada: su identificador público
(<code>open_id</code>), su nombre de usuario y los <b>tokens de acceso y
refresco</b> que permiten publicar en su nombre.</li>
<li>El identificador de cada publicación, para consultar después sus métricas.</li>
<li>Copias reducidas de los clips (540×960) en almacenamiento privado, para
poder revisarlos desde el móvil.</li>
</ul>
<p><b>Nunca se ve ni se almacena la contraseña de TikTok.</b> La autorización se
hace en tiktok.com y lo que se recibe es un permiso revocable.</p>
<p>Los vídeos originales y los clips a resolución completa <b>no salen del
ordenador del titular</b>. Tampoco se recogen datos de navegación ni perfiles de
comportamiento.</p>

<h2>Con quién se comparten</h2>
<p><b>TikTok</b> (el vídeo y su descripción, al publicar), <b>Supabase</b>
(base de datos y copias de revisión), <b>Hostinger</b> (alojamiento),
<b>Anthropic</b> (<b>la transcripción del vídeo</b>, para elegir los momentos),
<b>Kick</b> (descarga de la retransmisión propia) y <b>Google Fonts</b> (la IP
del navegador al cargar la tipografía del panel). Algunos tratan datos en
Estados Unidos.</p>
<p>El audio se transcribe en el ordenador del titular: lo que viaja a Anthropic
es el texto, no el audio ni el vídeo.</p>

<h2>Cookies</h2>
<p>Una sola, estrictamente necesaria: <code>klip_llave</code>, que mantiene la
sesión tras introducir la clave de acceso. Es técnica, <code>HttpOnly</code>,
<code>SameSite=Lax</code> y dura un año. No hay cookies de análisis, publicidad
ni de terceros, por lo que no se solicita consentimiento.</p>

<h2>Revocación, conservación y derechos</h2>
<p>Cualquier cuenta de TikTok puede retirar el permiso desde <i>Ajustes y
privacidad → Seguridad y permisos → Aplicaciones conectadas</i>, sin contactar
con nadie: deja de funcionar de inmediato. Los tokens se conservan mientras dure
la autorización y se eliminan al revocarla.</p>
<p>Para ejercer acceso, rectificación, supresión, oposición o portabilidad,
escriba a <a href="mailto:${esc(t.email)}">${esc(t.email)}</a>.</p>

<h2>Seguridad</h2>
<p>El panel exige clave, la cookie es <code>HttpOnly</code>, el almacenamiento de
los clips es privado y cada dirección de reproducción se firma por separado y
caduca en 60 segundos.</p>

<div class="en">
<h1>Privacy Policy</h1>
<p class="fecha">Last updated: 24 September 2026 · English</p>

<p>${lineaResponsable(t, true)}</p>
<p>KLIP studio is a private single-owner tool. <b>It collects no visitor data, has
no user registration, and runs no advertising or analytics.</b></p>

<h2>What is stored</h2>
<ul>
<li>The owner's email and the internal names of his accounts.</li>
<li>For each authorised TikTok account: its public identifier
(<code>open_id</code>), its username, and the <b>access and refresh tokens</b>
that allow publishing on its behalf.</li>
<li>The identifier of each publication, to retrieve its metrics later.</li>
<li>Reduced clip copies (540×960) in private storage, to review them from a
phone.</li>
</ul>
<p><b>The TikTok password is never seen or stored.</b> Authorisation happens on
tiktok.com and what is received is a revocable grant.</p>
<p>Source videos and full-resolution clips <b>never leave the owner's
computer</b>. No browsing data or behavioural profiles are collected.</p>

<h2>Who data is shared with</h2>
<p><b>TikTok</b> (the video and its description, when publishing), <b>Supabase</b>
(database and review copies), <b>Hostinger</b> (hosting), <b>Anthropic</b>
(<b>the video transcript</b>, to select moments), <b>Kick</b> (downloading the
owner's own stream) and <b>Google Fonts</b> (the browser's IP when loading the
panel typeface). Some process data in the United States.</p>
<p>Audio is transcribed on the owner's computer: what goes to Anthropic is the
text, not the audio or the video.</p>

<h2>Cookies</h2>
<p>One, strictly necessary: <code>klip_llave</code>, which keeps the session after
the access key is entered. Technical, <code>HttpOnly</code>,
<code>SameSite=Lax</code>, one year. No analytics, advertising or third-party
cookies, so no consent banner is shown.</p>

<h2>Revocation, retention and rights</h2>
<p>Any TikTok account can withdraw the grant under <i>Settings and privacy →
Security and permissions → Connected apps</i>, without contacting anyone: it stops
working immediately. Tokens are kept while the authorisation lasts and are deleted
on revocation.</p>
<p>To exercise access, rectification, erasure, objection or portability, write to
<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>.</p>

<h2>Security</h2>
<p>The panel requires an access key, the cookie is <code>HttpOnly</code>, clip
storage is private, and each playback URL is signed individually and expires after
60 seconds.</p>
</div>
`,
    !t.completo,
  )
}
