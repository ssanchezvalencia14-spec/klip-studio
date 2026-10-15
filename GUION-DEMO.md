# Guion del vídeo demo para la auditoría de TikTok

Lo que pide el formulario de Submit for review:

- Al menos un vídeo que enseñe el flujo completo de principio a fin
- Formato mp4 o mov, máximo 5 archivos, hasta 50 MB cada uno
- **Grabado en el entorno Sandbox**, porque la app no ha sido aprobada antes
- Todos los productos y scopes seleccionados deben verse claramente

Duración objetivo: 3 o 4 minutos. No hace falta edición ni voz en off.

---

## Antes de grabar

### 1. Vaciar la bandeja de @zotitan1

**Esto bloquea la grabación.** Ahora mismo hay 6 vídeos esperando en la bandeja
de entrada, y TikTok no acepta más subidas hasta que bajen
(`spam_risk_too_many_pending_share`). Si grabas ahora, la subida falla en cámara.

ZOTI tiene que publicar o descartar esos 6 desde la app móvil. Comprobar con:

    npm run tiktok -- subidas

### 2. Desenlazar la cuenta

La autorización hay que grabarla ocurriendo. Como ya está enlazada, primero:

    npm run tiktok -- olvidar acc-01

### 3. Dejar un clip encolado

Sin nada en la cola no hay nada que subir en cámara. Encolar uno.

### 4. Preparar las ventanas

- Navegador con el panel abierto, sesión iniciada
- Una terminal, con la fuente grande (se tiene que leer en el vídeo)
- Móvil con TikTok y sesión de @zotitan1, para la parte final

Grabar con `Win + G` (barra de juego de Windows) o con OBS. 1080p sobra.

---

## Las tomas

### Toma 1 — Qué es el producto (20 s)

Panel abierto, enseñando los clips pendientes de revisión. Se ve que son vídeos
verticales con subtítulos, sacados de material del artista.

Aquí no hay API de TikTok todavía. Es contexto para quien revisa.

### Toma 2 — Login Kit y `user.info.basic` (60 s)

    npm run tiktok -- enlazar acc-01

1. Se ve el enlace que genera el programa
2. Abrirlo en el navegador
3. **Enseñar la pantalla de permisos de TikTok**, con los tres scopes listados
4. Autorizar
5. Se ve la vuelta a la página de retorno: "Cuenta enlazada"

Luego:

    npm run tiktok -- estado

Se ve `acc-01  @zotitan1  caduca en 365 dias`. **Eso demuestra
`user.info.basic`**: el programa sabe a qué cuenta pertenece el permiso.

### Toma 3 — Content Posting API y `video.upload` (90 s)

    PUBLISH_PROVIDER=tiktok npm run publish -- --live --mode draft --limit 1

Se ve la subida completarse con su `publish_id`. Después:

    npm run tiktok -- subidas

Se ve `SEND_TO_USER_INBOX`.

### Toma 4 — El resultado en la app (40 s)

Grabar la pantalla del móvil, o enfocarlo con otra cámara:

1. Notificación en la bandeja de entrada de TikTok
2. Tocarla
3. Se abre el editor de TikTok con el clip cargado

Esto es lo que más pesa: demuestra que el flujo acaba donde TikTok dice que
tiene que acabar, con el titular decidiendo.

### Toma 5 — `video.publish` (30 s)

    PUBLISH_PROVIDER=tiktok npm run publish -- --live --limit 1

Va a fallar, y ese es el objetivo:

    unaudited_client_can_only_post_to_private_accounts

**Por qué grabar un error a propósito.** El formulario exige demostrar todos los
scopes, y `video.publish` no se puede demostrar funcionando porque TikTok lo
bloquea justo hasta que apruebe la app. Enseñar el intento demuestra que la
integración está construida y que solo falta su permiso.

Es una interpretación, no un hecho: TikTok no documenta cómo resolver esta
circularidad. Si rechazan por esto, el plan B es quitar `video.publish` del
envío, aprobar con `video.upload`, y pedirlo en una segunda revisión.

---

## Después de grabar

Volver a subir el resto de clips pendientes:

    PUBLISH_PROVIDER=tiktok npm run publish -- --live --mode draft

---

## Lo que NO debe aparecer en el vídeo

- La URL del panel con su `?k=...`, que es la llave de acceso
- El `.env` ni ninguna terminal donde se lea un secreto
- Las credenciales del sandbox

Si alguna se cuela, hay que cortar ese trozo o regenerar la credencial.
