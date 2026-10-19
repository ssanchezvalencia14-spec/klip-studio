# Arquitectura de KLIP studio

Diagnóstico de la Fase 0 (2026-10-19), hecho leyendo el código de la rama
`main` (commit `3ecca6e`). No se cambió ninguna funcionalidad.

---

## 1. Stack real

| Pieza | Qué hay de verdad |
|---|---|
| Lenguaje | TypeScript, ESM (`"type": "module"`), ejecutado con `tsx` en desarrollo |
| Runtime | **Node.js 24** (`engines: >=24` en `package.json`) |
| Panel web | Servidor HTTP de Node **sin framework** (`src/review/server.ts`). La interfaz son plantillas de texto: `page.ts` (HTML), `estilos.ts` (CSS), `guion.ts` (JS del navegador) |
| Base de datos | PostgreSQL en **Supabase**, usado como Postgres a secas con el driver `postgres` |
| Archivos en la nube | Supabase Storage (cubo privado `revision`) por REST, sin SDK (`src/store/nube.ts`) |
| Autenticación | Sin usuarios. Llave en la dirección (`?k=`, `REVIEW_KEY`) que se guarda en una cookie, o autenticación básica (`REVIEW_PASSWORD`) |
| IA | SDK `@anthropic-ai/sdk` (API de pago). Alternativa local por Ollama |
| Pruebas | Scripts `verify:*` contra PGlite (Postgres en WebAssembly, en memoria). No hay framework de pruebas |
| Dependencias | 5 de producción: `@anthropic-ai/sdk`, `postgres`, `typescript`, `zod`, `@types/node` |

**No hay Next.js, React, Tailwind ni shadcn/ui.** `CONTEXT.md` y
`AUDITORIA-FASE-0.md` ya lo dicen, y explican que se decidió así.

---

## 2. Componentes y dónde corre cada uno

```
                 ┌──────────────────────────── Supabase ───────────────────────────┐
                 │  Postgres: sources, clips, jobs, queue, posts, accounts,        │
                 │            clientes, campanas, settings, trabajadores, ...      │
                 │  Storage:  cubo "revision" (copias ligeras 540x960)             │
                 └──────────▲───────────────────────────▲──────────────────────────┘
                            │ SQL                        │ SQL + REST (URL firmada 60 s)
                            │                            │
   ┌──── PC con Windows y GPU NVIDIA ────┐     ┌──── Hostinger ────────────────────┐
   │ npm run worker (trabajador)         │     │ Panel: node dist/scripts/review.js│
   │   pregunta a "jobs" cada 5 s        │     │   PANEL_REMOTO: no ejecuta tareas,│
   │   lanza scripts/<kind>.ts           │     │   solo las encola en "jobs"       │
   │   late en "trabajadores"            │     │   encadena pasos (cadena.ts)      │
   │ Tarea "KLIP publicador" (30 min)    │     │   firma URLs de las copias        │
   │   npm run publish -- --live         │     └───────────────▲───────────────────┘
   │ work/  out/  models/  logs/ (disco) │                     │ HTTPS
   └──────────────┬──────────────────────┘               navegador / móvil
                  │ HTTPS
          upload-post (TikTok) · TikTok API · Anthropic API · YouTube (yt-dlp)
```

**El panel y el trabajador no se hablan directamente.** El único punto de
encuentro es la tabla `jobs` de Postgres: el panel encola y el PC pregunta
(`src/jobs/cola.ts`, `for update skip locked`). Por eso no hace falta abrir
puertos en casa. Hoy no existe ningún token de servicio entre los dos: el
trabajador entra con la misma `DATABASE_URL` que el panel.

| Qué | Dónde corre | Archivo de entrada |
|---|---|---|
| Panel | Hostinger (y también en local con `npm run review`) | `scripts/review.ts` → `src/review/server.ts` |
| Trabajador | PC con Windows | `scripts/worker.ts`, lanzado por la tarea programada "KLIP trabajador" (`trabajador.vbs` → `trabajador.cmd`) |
| Publicador | PC con Windows | `scripts/publish.ts`, lanzado por "KLIP publicador" cada 30 min (`publicador.vbs` → `publicar.cmd`) |
| Despliegue | PC, a mano | `npm run desplegar` (zip + API de Hostinger) |
| Migraciones | PC, a mano | `npm run db:setup` (los archivos `db/0NN-*.sql`, idempotentes) |

---

## 3. Flujo de datos de un video

Cada paso es un script de `scripts/` y un tipo de tarea en `jobs`
(`JOB_KINDS` en `src/jobs/cola.ts`). `src/jobs/cadena.ts` encadena los pasos
automáticos mirando la tabla cada 6 s.

| # | Paso (`kind`) | Qué hace | Herramienta | Salida |
|---|---|---|---|---|
| 1 | `ingest` | Descarga el enlace o toma el MP4 subido, extrae audio 16 kHz mono y transcribe | yt-dlp, ffmpeg con filtro `whisper` (whisper.cpp dentro de ffmpeg, en GPU) | `work/<sourceId>/` con la transcripción NDJSON |
| 2 | `select` | "Elegir momentos": parte la transcripción en ventanas y pide clips a la IA; valida con zod y contra el texto | API de Anthropic (`SELECT_MODEL`, por defecto `claude-opus-5-5`) u Ollama | `clips.json` |
| 2b | `momentos` | Alternativa para música: densidad de voz, sin IA | ffmpeg | `clips.json` |
| 3 | `render` | Clips verticales 1080x1920 con subtítulos `.ass` quemados y fondo borroso | ffmpeg + NVENC | `out/<sourceId>/*.mp4` (~30 MB cada uno) |
| 4 | `subir` | Copia ligera 540x960 (x264 CRF 30) al cubo `revision` | ffmpeg, Supabase Storage | Copia en la nube (~1 MB) |
| — | **Revisión humana** | Aprobar o descartar en el panel | Panel | `clips.status` |
| 5 | `variants` | Una copia por cuenta enlazada (zoom, velocidad, recorte, pie variado) | ffmpeg; IA opcional para variar el pie (`src/variants/captions.ts`) | Archivos por cuenta |
| 6 | `schedule` | Reparte en el calendario con dispersión horaria | `src/queue/schedule.ts` | Filas en `queue` |
| 7 | `publish` | Entrega lo vencido | upload-post (`PUBLISH_PROVIDER=upload-post`) o API directa de TikTok | Filas en `posts` |
| 8 | `metrics` | Recoge vistas y likes | upload-post / TikTok | Filas en `metrics` |

El paso 4 → revisión es la "compuerta": la cadena se detiene ahí. Cuando un
video se queda sin clips pendientes, `src/jobs/reparto.ts` lanza `variants` y
`schedule`.

### Rutas del panel

Páginas: `/` (una sola página con vistas) y `/legal/terminos`, `/legal/privacidad`.
API: `/api/overview`, `/api/clips`, `/api/clips/lote`, `/api/queue`, `/api/jobs`,
`/api/runs`, `/api/proyectos`, `/api/cuentas`, `/api/plataformas`,
`/api/plantillas`, `/api/ajustes`, `/api/settings`, `/api/metrics`,
`/api/upload`, `/api/events` (SSE). Retorno OAuth: `/auth/tiktok/callback`.

Sin llave solo atienden `/auth/tiktok/callback` y las dos páginas legales
(`authorized()` en `src/review/server.ts`).

### Tablas

`owners`, `sources`, `accounts`, `clips`, `queue`, `posts`, `metrics`, `runs`,
`settings`, `jobs`, `plantillas`, `tiktok_tokens`, `tiktok_pendientes`,
`clientes`, `campanas`, `trabajadores`, `alertas` (Fase 7). Todo lleva `owner_id`; hoy hay un único
dueño fijo (`OWNER_ID` en `src/lib/owner.ts`).

---

## 4. Variables de entorno

Se leen con `loadEnv()` (`src/lib/env.ts`), un parser propio del `.env` de la
raíz. **Una variable que ya existe en el entorno del proceso gana sobre el
`.env`.** Esto es importante para el error 401 (ver §6).

| Variable | Para qué | Dónde | En `.env.example` |
|---|---|---|---|
| `DATABASE_URL` | Postgres de Supabase | Panel y PC | **No** |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YTDLP_PATH` | Rutas absolutas de los binarios | PC | Sí |
| `WHISPER_MODEL_PATH`, `WHISPER_VAD_MODEL_PATH` | Modelos ggml | PC | Sí |
| `YTDLP_EXTRACTOR_ARGS`, `YTDLP_COOKIES_FROM_BROWSER`, `YTDLP_FORMAT` | Descarga | PC | Sí |
| `WORK_DIR`, `OUT_DIR` | Directorios de trabajo | PC | Sí |
| `ANTHROPIC_API_KEY`, `SELECT_MODEL`, `SELECT_EFFORT`, `SELECT_PROVIDER` | Elegir momentos | PC | Sí (salvo `SELECT_PROVIDER`) |
| `OLLAMA_MODEL`, `OLLAMA_URL` | IA local | PC | Sí |
| `UPLOAD_POST_API_KEY`, `PUBLISH_PROVIDER`, `PUBLISH_MODE` | Publicar | PC | Sí |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | API directa de TikTok | Panel y PC | Sí |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` | Storage | Panel y PC | Sí |
| `REVIEW_KEY`, `REVIEW_PASSWORD`, `REVIEW_ALLOW_OPEN` | Acceso al panel | Panel | **No** |
| `PANEL_REMOTO`, `PORT`, `AUTO_CHAIN` | Comportamiento del panel | Panel | **No** |
| `OWNER_EMAIL`, `LEGAL_TITULAR`, `LEGAL_PAIS`, `LEGAL_EMAIL` | Páginas legales | Panel | Parcial (falta `OWNER_EMAIL`) |
| `HOSTINGER_DOMINIO`, `HOSTINGER_USUARIO`, `HOSTINGER_API_TOKEN` | Desplegar | PC | Parcial (falta el token) |
| `NVENC_PRESET`, `NVENC_CQ`, `BLUR_SIGMA`, `SUBTITLE_SIZE`, `SUBTITLE_FONT` | Ajustes finos del render | PC | **No** |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`, `ALERTAS_CORREO_PARA`, `ALERTAS_CORREO_DE` | Alertas (Fase 7) | **Panel** | Sí, vacías |

---

## 5. Dependencias externas

| Dependencia | Uso | Dónde | Notas |
|---|---|---|---|
| ffmpeg 8.x *full build* (gyan.dev) | Audio, transcripción (filtro `whisper`), render NVENC, copias | PC | Necesita `--enable-whisper` y NVENC. El ffmpeg que trae yt-dlp no sirve |
| Modelo `ggml-large-v3-turbo.bin` | Transcripción | PC, en `models/` | Fuera de git |
| yt-dlp | Descargar YouTube y Kick | PC | Hay que actualizarlo seguido (`yt-dlp -U`) |
| GPU NVIDIA | Whisper y NVENC | PC | Probado con RTX 4060 |
| Anthropic API | Elegir momentos; variar pies de texto | PC | De pago, aparte de la suscripción de Claude |
| Ollama (opcional) | IA local | PC | Calidad insuficiente, según las mediciones del propio código |
| upload-post | Publicar en TikTok y métricas | PC | `https://api.upload-post.com/api`, cabecera `Authorization: Apikey ...` |
| API de TikTok (opcional) | Publicación directa | PC y panel (OAuth) | Sin auditoría todo sale en privado |
| Supabase | Postgres y Storage | Nube | Plan gratuito: 1 GB de Storage y 60 conexiones |
| Hostinger | Hospeda el panel | Nube | Hostinger compila con `npm run build` y arranca con `npm start` |
| Telegram / Resend (opcional) | Alertas | Panel | Las manda el panel cada minuto (`src/alertas/vigia.ts`): si se cae el procesador, alguien de fuera tiene que avisar |

**Python no se usa en ninguna parte.** Es una decisión del proyecto
(`CONTEXT.md` §2). Las fases 6 (MediaPipe, Demucs, librosa) chocan con ella.
Ver `docs/DEUDA.md`.

---

## 6. `ANTHROPIC_API_KEY`: dónde se lee y causa probable del 401

Dónde se lee en el código:

| Archivo | Uso |
|---|---|
| `src/select/select.ts:128` | `requireEnv('ANTHROPIC_API_KEY')` para crear el proveedor de "Elegir momentos" |
| `src/variants/captions.ts:140` | Variar los pies de texto por cuenta (opcional) |
| `scripts/doctor.ts:164` | Comprobación de salud |
| `src/select/fallo.ts:42` | Texto del error 401 que ve el usuario ("La clave de Anthropic no vale...") |

Cómo llega al proceso:

1. `loadEnv()` lee el `.env` del proyecto **solo para las variables que no
   existen ya** en el entorno.
2. El trabajador (`scripts/worker.ts`) lanza cada script con `env: process.env`,
   así que el hijo hereda todo el entorno de la tarea programada de Windows.
3. Por lo tanto, una `ANTHROPIC_API_KEY` definida en las **variables de entorno
   de Windows** (de usuario o del sistema) **pisa** la del `.env` sin avisar.

En **esta** PC (la del clon nuevo) no hay `ANTHROPIC_API_KEY` en las variables
de usuario ni de sistema, no hay `.env` y no hay `~/.env`. **Esta no es la PC
donde corre el trabajador** (la configuración del repositorio apunta a otro
usuario de Windows). Ahí hay que revisar, sin imprimir los valores:

```powershell
[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')    -ne $null
[Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','Machine') -ne $null
Select-String -Path .env -Pattern '^ANTHROPIC_API_KEY=' -Quiet
```

Causas probables, de más a menos:

1. **Una clave vieja en las variables de Windows** pisa la buena del `.env`
   (por cómo funciona `loadEnv`).
2. **La clave del `.env` fue revocada o rotada.** El texto del error lo dice:
   la API la rechaza. El código comenta un caso del 2026-10-18 con tres 401
   seguidos en un mismo video.
3. Una clave de **otra organización o de otro tipo** (por ejemplo un token de
   Claude Code o de claude.ai puesto como `ANTHROPIC_API_KEY`). La API solo
   acepta claves `sk-ant-api...` de platform.claude.com.

La Fase 1 lo corta de raíz: el proveedor `claude-cli` quita todas las
`ANTHROPIC_*` del entorno del proceso hijo.

---

## 7. Comprobación de salud

`npm run check-health` (`scripts/check-health.ts`) comprueba la base de datos,
el latido del trabajador, ffmpeg, yt-dlp, la IA y upload-post. Da un estado por
pieza, sin rutas ni claves. Termina con código 1 si falla algo obligatorio.
`npm run doctor` sigue existiendo y es más detallado (filtros de ffmpeg, NVENC,
modelos, GPU).
