# Deuda técnica y riesgos

Diagnóstico de la Fase 0 (2026-10-19). Ordenado por impacto. Cada punto dice en
qué fase del plan (`docs/PLAN-FASES.md`) se resuelve.

---

## Secretos

**No se encontró ningún secreto commiteado.** Se revisó todo el historial (5
commits) buscando archivos `.env`, claves `sk-ant-`, JWT de Supabase, cadenas
`postgres://usuario:clave`, tokens de GitHub y asignaciones `*_API_KEY=`,
`*_TOKEN=`, `*_SECRET=` y `REVIEW_PASSWORD=` con valor. Ninguno apareció.

`.gitignore` cubre `.env`, `.env.local`, `.env.*.local`, `logs/`, `work/`,
`out/`, `models/`, `state/` y `.claude/settings.local.json`. Está bien.

Hay que rotar igual:

- **La llave del panel (`REVIEW_KEY`)**, porque se compartió en un chat (lo
  dice el plan, Fase 2).
- **La `ANTHROPIC_API_KEY`**, si se confirma que la vieja anda suelta en
  variables de Windows (ver `ARQUITECTURA.md` §6).

---

## Alto

| # | Riesgo | Dónde | Fase |
|---|---|---|---|
| A1 | ~~Resuelto en Fase 2~~ (correo y contraseña, ver docs/ACCESO.md). **El acceso al panel es una llave en la URL** (`?k=`). Queda en el historial, los logs y los referrers. No hay usuarios, roles ni bloqueo por intentos | `authorized()` en `src/review/server.ts` | 2 |
| A2 | ~~Resuelto en Fase 2~~ (sin sesion no se ve nada). **Sin `REVIEW_KEY` ni `REVIEW_PASSWORD`, el panel no pide nada.** Solo lo protege que entonces escucha en local. Un error de configuración en Hostinger lo deja abierto | `authorized()` devuelve `true` | 2 |
| A3 | ~~Resuelto en Fase 1~~ (el CLI se lanza sin ANTHROPIC_*). **Una `ANTHROPIC_API_KEY` del entorno de Windows pisa la del `.env`** sin avisar, y el trabajador pasa todo su entorno a cada script. Causa probable del 401 | `loadEnv()`, `scripts/worker.ts` | 1 |
| A4 | **Sigue abierto tras la Fase 2:** el trabajador habla con la base y no con el panel, asi que WORKER_TOKEN no cambia esto. **El trabajador y el panel comparten la credencial completa de la base** (`DATABASE_URL`). No hay token de servicio: quien tenga el PC tiene la base entera | `scripts/worker.ts` | 2 |
| A5 | ~~Resuelto en Fase 1~~ (se comprueba en la base antes de encolar). **El encadenado corre en cada panel que esté encendido** (Hostinger, `npm run review` local, vista previa). Cada uno guarda en memoria lo que ya encadenó, así que dos paneles encolan el mismo paso dos veces. Probable contribución a las 28 ejecuciones de "Elegir momentos" | `arrancarCadena()` en `src/jobs/cadena.ts` | 1 y 4 |
| A6 | ~~En parte en Fase 1~~ (2 reintentos por tarea y pausa sin bucle en la IA; el resto de pasos, Fase 4). **No hay tope de reintentos por video para la IA.** `MAX_INTENTOS = 3` solo vale para tareas perdidas (PC apagado). Una tarea que falla queda en `error`, y nada impide relanzarla a mano o por la cadena una y otra vez | `src/jobs/cola.ts` | 1 y 4 |
| A7 | **Hay mensajes técnicos en pantalla**: el error 401 manda a editar el `.env`, y otros muestran nombres de variables y la salida cruda de los scripts | `src/select/fallo.ts`, `scripts/select.ts` (`explain`), registro de tareas en el panel | 1 y 5 |

## Medio

| # | Riesgo | Dónde | Fase |
|---|---|---|---|
| M1 | ~~Resuelto en Fase 4~~ (por configuracion o PATH). **Rutas absolutas de Windows obligatorias** para ffmpeg, ffprobe y yt-dlp (`.env.example` trae `C:\Users\TU-USUARIO\...\WinGet\...`). Impide mover el trabajador a un VPS sin tocar la configuración. Se hizo a propósito (hay dos ffmpeg en el PATH), pero falta una opción por PATH | `src/lib/env.ts` (`bin`) | 4 |
| M2 | ~~Resuelto en Fase 4~~. **`.claude/settings.json` (versionado) tiene la ruta del usuario de Windows de quien lo escribió** (`C:/Users/<otro-usuario>/.local/bin/graphify.EXE`) en dos hooks. En cualquier otra PC el hook falla en cada lectura y búsqueda del agente | `.claude/settings.json` | 4 |
| M3 | ~~Resuelto en Fase 4~~. **`doctor.ts` arma rutas con `\\`** (`${ROOT}\\.env`). Solo funciona en Windows | `scripts/doctor.ts:52` | 4 |
| M4 | **`.env.example` está incompleto**: faltan `DATABASE_URL`, `REVIEW_KEY`, `REVIEW_PASSWORD`, `REVIEW_ALLOW_OPEN`, `PANEL_REMOTO`, `PORT`, `AUTO_CHAIN`, `OWNER_EMAIL`, `HOSTINGER_API_TOKEN`, `SELECT_PROVIDER`, `NVENC_PRESET`, `NVENC_CQ`, `BLUR_SIGMA`, `SUBTITLE_SIZE`, `SUBTITLE_FONT`. El README dice que `DATABASE_URL` está ahí y no lo está. Quien clona no sabe qué pedir | `.env.example` | 1 (lo que toque) y 8 |
| M5 | **Sin pruebas automáticas reales.** Hay ~25 scripts `verify:*` sueltos, sin runner ni CI, y hay que lanzarlos uno a uno. README: `verify:db` falla 2 de 8 "y es conocido" | `scripts/verify-*.ts` | 5 y 8 |
| M6 | **Dos almacenes y uno muerto.** `src/store/store.ts` (fichero) sin uso desde 2026-09-13; el vivo es `pg.ts`. Leer del equivocado no avisa | `src/store/` | 8 |
| M7 | **Archivos enormes para la interfaz**: `guion.ts` 5131 líneas, `server.ts` 2397, `estilos.ts` 2203. Una comilla invertida rompe la página entera | `src/review/` | 3 |
| M8 | ~~Resuelto en Fase 4~~ (retencion configurable, aviso de disco, techo de bitrate). **Sin almacenamiento acotado**: los másteres (~30 MB por clip) y los VOD se quedan en `out/` y `work/` para siempre. No hay aviso de disco | `out/`, `work/` | 4 |
| M9 | **Un solo dueño fijo en el código** (`OWNER_ID = 1111...`). El modelo de datos tiene `owner_id`, pero nada lo usa de verdad | `src/lib/owner.ts` | 2 y 7 |
| M10 | **Topes de cuentas cosidos al texto** ("20 cuentas", "25 perfiles") en documentos y en partes del panel | varios | 5 y 7 |
| M11 | **Sigue abierto tras la Fase 1.** **La IA de los pies de texto también usa la API de pago.** Si solo se cambia "Elegir momentos" a la suscripción, `variants` sigue dando 401 o cae a una variación detectable | `src/variants/captions.ts` | 1 |

## Bajo

| # | Riesgo | Dónde | Fase |
|---|---|---|---|
| B1 | Comentarios y textos de consola sin tildes ("Verificacion", "publicacion") | todo `src/` y `scripts/` | 5 (solo los visibles) |
| B2 | `package.json` se llama `tiktok-clipper` y no `klip-studio` | `package.json` | 8 |
| B3 | Ollama queda como interruptor y su calidad está medida como mala. Es código vivo que nadie debería elegir | `src/select/provider.ts` | 1 |
| B4 | ~~Resuelto en Fase 4~~ (comprobacion semanal). Nada vigila que yt-dlp esté al día, y una versión vieja falla con 403 que parece un bloqueo (`CONTEXT.md` §6c) | — | 4 |

---

## Fase 6: lo que queda por probar o se hizo distinto

- **Sin Python, como se decidió.** El plan pedía Demucs y librosa. En su lugar:
  la voz de una canción se realza con filtros de ffmpeg antes de transcribir
  (`src/ingest/audio.ts`, `FILTRO_VOZ`), y la energía, los drops y el
  estribillo se calculan en Node (`src/select/musica.ts`). No separa la voz
  como Demucs: con mezclas muy cargadas la letra sale peor, y entonces la
  confianza baja y los clips salen sin subtítulos.
- **Sin probar con video real.** Esta PC no tiene ffmpeg. El recorte que sigue
  la cara (`sendcmd` + `crop`), el realce de voz y la energía sobre un
  audio de verdad están cubiertos por `verify:fase6` con datos sintéticos y
  la detección se probó con una foto, pero falta la prueba de aceptación: una
  entrevista y un video musical de punta a punta en la PC del procesador.
- **Quién habla se aproxima mirando la boca**, no el audio. Con dos personas
  que gesticulan mucho puede equivocarse; la histéresis (1,5 s y 1,4 veces más
  movimiento) evita que salte de una a otra.
- **El panel remoto no sube MP4** (devuelve 501). Ya pasaba antes de la Fase 6.

## Fase 8: seguridad, pruebas y cierre

- **CSP con huella para el script, pero estilos con 'unsafe-inline'.** El panel
  usa atributos style="" en muchas pantallas y una politica con huellas no los
  admite. Un estilo inyectado no ejecuta codigo; un script si, y ese esta
  cerrado. Quitarlo exige pasar esos estilos a clases.
- **El limite de peticiones vive en memoria** del proceso del panel: con un solo
  proceso (Hostinger) basta; con varios habria que llevarlo a la base.
- **Tras el proxy, el limite se fia de x-forwarded-for**, que se puede falsear.
  Es una red de seguridad; el login ya se protege por intentos.
- **Respaldos sin pg_dump**: JSON comprimido por tabla. Restaurar es aditivo (no
  pisa ni borra). Para volver atras en una base con datos, vaciarla primero.
- **La prueba de extremo a extremo sustituye** transcribir (ffmpeg), Claude (un
  CLI falso) y armar clips: el resto del flujo es el real. `verify:jobs`,
  `verify:db`, `verify:proyectos` y `verify:produccion` necesitan ffmpeg o la
  base real y `npm test` los marca OMITIDA aqui.
- **Arreglado por el camino:** las tareas viajaban al navegador con la ruta
  completa del MP4 subido (C:\Users\...), y el separador de llaveClip metia un
  caracter NUL en el script del panel.

## Fase 7: lo que queda por probar o se hizo distinto

- **El reparto ignoraba a los clientes.** No era una contradicción con el plan,
  pero sí con el modelo de datos: un video de una campaña se repartía por todas
  las cuentas. Corregido: va a las cuentas de su cliente (sin campaña, a las sin
  cliente). Además el planificador leía el horario de `state/settings.json` y
  no de la base: los cambios en Horarios no llegaban al reparto. Corregido.
- **Shorts y Reels sin probar contra la API real.** Los campos (`platform[]`,
  `youtube_title`, `media_type=REELS`) salen de la documentación de
  upload-post; no hay clave en esta PC. Probar con una cuenta que tenga YouTube
  conectado antes de marcarlo en muchas.
- **Alertas sin probar con Telegram de verdad.** `verify:fase7` comprueba la
  petición que se haría; falta poner el token en el `.env` del panel y pulsar
  "Enviar una prueba" en Ajustes › Sistema.
- **Variación de textos con la suscripción** gasta una llamada a `claude -p` por
  clip al repartir. Si la IA está en el límite cae a la variación sin IA.
- **Métricas**: las cifras dependen de lo que devuelva upload-post (o del
  permiso `video.list` con la API directa), como antes de esta fase.

## Contradicciones entre el plan y el proyecto

La regla 8 del plan pide avisar en lugar de improvisar. Estas son las que
encontré:

1. **El panel no es Next.js + Tailwind + shadcn.** Es Node sin framework
   (`CONTEXT.md`). Las fases 2 y 3 lo anticipan ("si no, implementación
   propia"; "reutiliza lo que ya exista"). **Propuesta:** login propio con
   `node:crypto` (`scrypt`, que viene en Node) o `argon2` como única dependencia
   nueva. Rediseño con variables CSS sobre lo que ya hay, sin migrar a React.
   Las fuentes se cargan con `@font-face` en lugar de `next/font`.
2. **Node 24 y no Node 22 LTS.** El proyecto exige `>=24` y esta PC tiene
   v24.20.0. **Propuesta:** en `docs/IA.md` (Fase 1) documentar Node 24, que es
   lo que el proyecto necesita. Claude Code también funciona con él.
3. **Python.** La Fase 6 pide MediaPipe/OpenCV, Demucs y librosa, que son
   Python. El proyecto prohíbe Python a propósito. **Propuesta:** decidirlo al
   llegar a la Fase 6. Alternativas sin Python: detección de rostro con ONNX
   Runtime para Node, análisis de energía con ffmpeg (`ebur128`, `astats`).
   Demucs no tiene alternativa sin Python.
4. **La navegación.** El plan pide 6 secciones; el panel tiene 4 (Inicio,
   Revisar, Agenda, Ajustes) porque así lo pidió el usuario según
   `AUDITORIA-FASE-0.md`. **Propuesta:** seguir el plan nuevo (6) salvo que me
   digas lo contrario.
5. **Esta PC no es la del trabajador.** Aquí no hay ffmpeg, yt-dlp, Claude
   Code, `.env` ni acceso a la base. Las pruebas de aceptación de las fases 1,
   4 y 6 (render, IA con suscripción, worker caído) necesitan esa PC o instalar
   todo aquí. Ver la sección siguiente.

---

## Lo que falta en esta PC para trabajar

Comprobado el 2026-10-19:

| Pieza | Estado |
|---|---|
| Node.js | v24.20.0, correcto |
| Git | Sí |
| GPU NVIDIA (`nvidia-smi`) | Sí |
| ffmpeg / ffprobe con whisper y NVENC | **No** |
| yt-dlp | **No** |
| Claude Code CLI (`claude`) | **No está en el PATH** |
| `.env` | **No**, hay que pedir los valores al equipo |
| `node_modules` | **No**, falta `npm install` |
| Modelos de whisper (`models/`) | **No** |
