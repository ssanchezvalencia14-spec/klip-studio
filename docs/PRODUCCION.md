# Salida a producción

Lista para marcar antes de dejar KLIP studio funcionando solo. Cada punto dice cómo comprobarlo.

## 1. Antes de desplegar

- [ ] **Pruebas en verde**: `npm test` sin ningún FALLO (las OMITIDA dicen por qué).
- [ ] **Migraciones aplicadas** en Supabase: `npm run db:migrate` (hasta `025-auditoria.sql`). Son todas aditivas; antes, un respaldo: `npm run respaldo`.
- [ ] **Ninguna clave en git**: `git grep -nE "sk-ant-|eyJhbGciOi|Apikey [A-Za-z0-9]{8}"` no devuelve nada, y `.env` no está en `git status`.
- [ ] **La llave antigua apagada**: `LEGACY_KEY_ENABLED=false` y `REVIEW_KEY` / `REVIEW_PASSWORD` vacías. La llave se compartió en un chat: **rótala** si alguna vez se activa (README › Rotar claves).
- [ ] **`KLIP_SIN_LOGIN` vacío** en Hostinger. Solo es para la vista previa en el PC.
- [ ] **`ENLACES_SECRETO`** puesto en el panel (32+ caracteres al azar), para que los enlaces de descarga no caduquen al reiniciar.

## 2. Panel (Hostinger)

- [ ] Se sirve por **https**. Con https el panel manda HSTS solo.
- [ ] `npm run build && npm start` arranca sin avisos. El aviso "no hay ningún usuario" significa que falta `npm run crear-admin`.
- [ ] Entrar con un administrador y crear los usuarios del equipo en **Ajustes › Usuarios** (operadores para quien solo revisa).
- [ ] Las cabeceras llegan: en el navegador, Herramientas › Red › la página `/` lleva `content-security-policy`, `x-frame-options: DENY` y `strict-transport-security`.
- [ ] **Alertas**: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (o el correo) en el `.env` del panel; en **Ajustes › Sistema** pulsa **Enviar una prueba** y comprueba que llega.

## 3. Procesador (PC con GPU)

- [ ] `npm run check-health` **en verde**: base, ffmpeg (con whisper y NVENC), yt-dlp, IA y upload-post.
- [ ] `claude` con la sesión iniciada y `npm run probar-ia` correcto.
- [ ] `npm run instalar-rostros` si se quiere el encuadre que sigue la cara.
- [ ] El trabajador arranca solo con Windows (`scripts/trabajador.vbs` en Inicio) o como servicio.
- [ ] El panel dice **Procesador conectado** en la barra lateral.
- [ ] Al día siguiente, **Ajustes › Sistema** muestra el primer **respaldo** (y "con copia en la nube" si hay Storage).

## 4. Cuentas y publicación

- [ ] Cada cuenta de TikTok tiene **su perfil en upload-post** con el mismo nombre; las que no, en pausa.
- [ ] Clientes creados en **Cuentas › Clientes**, sus cuentas asignadas y sus videos en una campaña: así cada cliente publica solo en lo suyo.
- [ ] El **plan** de upload-post elegido en Horarios coincide con el contratado; Cuentas avisa si pagas de más.
- [ ] Revisados los **topes** (Horarios): repeticiones por clip, esperas, publicaciones al día.
- [ ] Leído [RIESGOS.md](RIESGOS.md): normas de TikTok y permisos de los videos de terceros.
- [ ] Prueba completa con un video real: añadir → revisar → aprobar → ver la agenda → primera publicación en una cuenta de prueba.

## 5. Después de salir

- [ ] Mirar **Agenda › Resultados** la primera semana: si una cuenta se desploma, pausarla.
- [ ] Mirar el **registro de cambios** (Ajustes › Sistema) de vez en cuando.
- [ ] Rotar claves cada pocos meses (README).

---

## Prueba real (2026-10-22)

Con la base real del equipo (respaldo previo y migraciones 019–025 aplicadas) y el video de YouTube `kxBQ844hxRw` (5:56):

- `check-health` en verde: base, procesador, ffmpeg, yt-dlp, IA (Claude Code con la suscripción) y upload-post.
- Flujo completo: añadir por la API del panel → descargar y transcribir → buscar momentos (2) → armar clips → subir a la nube → revisar en el panel → aprobar los 2 → copias por cuenta → agenda (4 salidas en acc-01 y acc-02). Las salidas se programaron para el día siguiente y **se borraron de la cola después de verlas en la Agenda**: no se publicó nada.
- **Lo procesó el PC del equipo** (otro trabajador conectado a la misma base), con su versión del código y Ollama. El encadenado, la revisión, la aprobación y el reparto automático sí fueron los del código nuevo.

Fallos encontrados y arreglados por la prueba real: el chequeo de upload-post (`limit=1` rechazado), yt-dlp por `YT_DLP_PATH`, NVENC que daba verde con un driver viejo, Claude Code no encontrado en Windows, el respaldo en la nube (`.gz` no admitido), los enlaces `https://` destrozados por el limpiador de rutas y el reparto encadenado sin el video.

**Limitación: un solo procesador.** Cada paso deja sus ficheros en el disco del PC que lo hizo. Con dos procesadores contra la misma base, uno puede coger un paso cuyos ficheros están en el otro y fallar (pasó con las copias y el reparto; el reintento lo recogió el bueno). Mientras no se compartan los ficheros, que haya un único procesador encendido.

## Tareas pendientes

Estado del PC de desarrollo al cerrar la Fase 8 (2026-10-19): ffmpeg 9.0.2 (gyan.dev, con whisper), yt-dlp 2026.08.19 y Claude Code 2.1.304 instalados; `.env` creado con las rutas y **sin claves**. `check-health` da OK en yt-dlp y pide, por este orden:

1. **Driver de NVIDIA 610 o más nuevo** (hay 591.74): sin él, NVENC no codifica y no se arma ningún clip.
2. **`claude` › `/login`** en este PC.
3. **`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `UPLOAD_POST_API_KEY`** en `.env`.
4. **El modelo de whisper** `ggml-large-v3-turbo.bin` (~1,6 GB, huggingface.co/ggerganov/whisper.cpp) en `models/`.

Con eso, `npm run check-health` debería salir en verde. Después, lo que hay que probar con un video real:

| Tarea | Por qué está pendiente | Cómo cerrarla |
|---|---|---|
| Render real con el encuadre que sigue la cara | Esta PC no tiene ffmpeg | Armar los clips de una entrevista con dos personas y mirar que el encuadre sigue a quien habla |
| Modo música de punta a punta | Igual | Añadir un video musical y comprobar estribillos, aviso de derechos y subtítulos según la confianza |
| Shorts y Reels | Sin clave de upload-post aquí; los nombres de campo salen de su documentación | Activarlo en una sola cuenta con YouTube/Instagram conectados y publicar un clip |
| Alertas por Telegram/correo reales | Sin token aquí (la petición está probada con una imitación) | Botón **Enviar una prueba** |
| `verify:jobs`, `verify:db`, `verify:proyectos`, `verify:produccion` | Necesitan ffmpeg o la base real | `npm test` en el procesador con el `.env` puesto |
| `check-health` en verde | Necesita todo lo anterior | En el procesador |
| Métricas reales | Dependen de lo que devuelva upload-post | Mirar Resultados tras unos días publicando |

Deuda técnica y decisiones distintas al plan: [DEUDA.md](DEUDA.md).
