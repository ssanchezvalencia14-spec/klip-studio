# KLIP studio

Convierte videos largos (entrevistas, streams, videos musicales) en clips verticales con subtítulos y los publica solo, repartidos entre las cuentas de TikTok de cada cliente.

El trabajo manual se reduce a una decisión: **aprobar o descartar cada clip**. Todo lo demás (descargar, transcribir, buscar los momentos, armar los clips, hacer una copia por cuenta, programarlas y publicarlas) lo hace el programa.

---

## Qué es cada cosa

```
video largo
  │  descargar + transcribir         yt-dlp + ffmpeg con filtro whisper
  ▼
texto con tiempos
  │  buscar momentos                 Claude (claude -p, con la suscripción)
  ▼
clips                                ffmpeg + NVENC, sigue la cara, subtítulos
  │
REVISAR  ← el único gesto manual
  │  una copia por cuenta, con su propia descripción
  │  reparto en la agenda del cliente, con horas desfasadas
  ▼
publicar (upload-post: TikTok, y Shorts/Reels si se activan)  →  resultados
```

Son **dos programas** que hablan solo a través de la base de datos (Supabase):

| Pieza | Dónde corre | Qué hace |
|---|---|---|
| **Panel** (`npm start` / `npm run review`) | Hostinger | La web: login, revisar, agenda, cuentas, ajustes, alertas |
| **Procesador** (`npm run worker`) | Un PC con GPU NVIDIA | Descarga, transcribe, busca momentos, arma clips, publica, respalda la base |

El panel nunca llama al procesador: el procesador pregunta a la base cada pocos segundos. No hay que abrir puertos.

---

## Instalación

Necesitas **Node 24**. El panel no necesita nada más. El procesador además necesita:

- **ffmpeg 8.x con el filtro `whisper` y NVENC** (`ffmpeg -hide_banner -h filter=whisper` debe responder).
- **yt-dlp** actualizado.
- El modelo de whisper `ggml-large-v3-turbo.bin` en `models/`.
- **Claude Code** con la sesión iniciada (ver abajo).
- Opcional: `npm run instalar-rostros` para el encuadre que sigue la cara (sin él, los clips salen con fondo borroso).

```bash
npm ci
cp .env.example .env          # y rellena lo que pide (tabla de abajo)
npm run db:setup              # crea las tablas y aplica las migraciones de db/
npm run crear-admin -- tu@correo.com "Tu nombre"
npm run check-health          # base, ffmpeg, yt-dlp, IA y upload-post en verde
```

`npm run doctor` es el primer sitio al que ir cuando algo no arranca: dice qué falta y dónde.

Guía para llevar el procesador a otra máquina o a Docker: [docs/MIGRAR_WORKER.md](docs/MIGRAR_WORKER.md).

---

## Arrancar

```bash
npm run review     # el panel en http://localhost:4310 (en Hostinger: npm run build && npm start)
npm run worker     # el procesador, en el PC con la GPU
```

Se entra con correo y contraseña. Los usuarios se crean en **Ajustes › Usuarios** (rol administrador u operador). Detalles del acceso: [docs/ACCESO.md](docs/ACCESO.md).

### La IA con tu suscripción de Claude (sin clave de API)

Buscar momentos y variar las descripciones usa `claude -p` con la sesión de Claude Code del **PC del procesador**:

```bash
claude          # dentro, escribe /login y sigue los pasos en el navegador
npm run probar-ia
```

La sesión queda guardada en la carpeta `~/.claude` de ese usuario. Si caduca o se llega al límite de uso, el panel lo dice (y avisa por Telegram si las alertas están configuradas) y las tareas esperan solas. Más: [docs/IA.md](docs/IA.md).

---

## Variables de entorno

Todas van en `.env`, que **nunca** se sube a git. `.env.example` las lista **sin valores**.

| Variable | Dónde | Para qué |
|---|---|---|
| `DATABASE_URL` | Panel y procesador | Postgres de Supabase. Sin esto no arranca nada |
| `SUPABASE_SERVICE_ROLE_KEY` | Panel y procesador | Guardar y firmar los videos en Storage, y la copia de los respaldos |
| `LLM_PROVIDER`, `LLM_MODEL`, `CLAUDE_CLI_PATH` | Procesador | La IA: `claude-cli` por defecto (suscripción) |
| `UPLOAD_POST_API_KEY` | Procesador | Publicar (TikTok, Shorts, Reels) y leer resultados |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI` | Panel y procesador | Solo si se publica con la API directa de TikTok |
| `FFMPEG_PATH`, `FFPROBE_PATH`, `YT_DLP_PATH` | Procesador | Opcionales: sin ellas se usan los del PATH. En Windows conviene fijar `FFMPEG_PATH` |
| `WORK_DIR`, `OUT_DIR`, `WHISPER_MODEL_PATH` | Procesador | Carpetas y modelo |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Panel | Alertas por Telegram |
| `RESEND_API_KEY`, `ALERTAS_CORREO_PARA`, `ALERTAS_CORREO_DE` | Panel | Alertas por correo |
| `ENLACES_SECRETO` | Panel | Firma de los enlaces de descarga (32+ caracteres al azar) |
| `RESPALDOS_DIR` | Procesador | Dónde se guardan los respaldos diarios (`respaldos/` por defecto) |
| `WORKER_TOKEN` | Panel | Opcional: clave de servicio para programas que llamen a la API |
| `HOSTINGER_API_TOKEN` | Tu PC | Solo para desplegar. **Da control total de la cuenta** |

La lista completa, con qué lee cada una: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) §4.

---

## Rotar claves

Hazlo si una clave se ha visto donde no debía (un chat, una captura, un repositorio) y, por costumbre, cada pocos meses. En todos los casos: **cambia la clave en el servicio, actualiza el `.env` de donde se use (panel en Hostinger y/o procesador) y reinicia ese programa.**

| Clave | Dónde se genera la nueva | Efecto de cambiarla |
|---|---|---|
| Contraseña de la base (`DATABASE_URL`) | Supabase › Project Settings › Database › Reset password | Hay que actualizar panel **y** procesador a la vez |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase › Project Settings › API | Igual: panel y procesador |
| `UPLOAD_POST_API_KEY` | Panel de upload-post › API Keys | Solo el procesador |
| `TIKTOK_CLIENT_SECRET` | portal de desarrolladores de TikTok | Las cuentas siguen enlazadas |
| `TELEGRAM_BOT_TOKEN` | @BotFather › `/revoke` | Solo el panel. Prueba con **Ajustes › Sistema › Enviar una prueba** |
| `RESEND_API_KEY` | resend.com › API Keys | Solo el panel |
| `ENLACES_SECRETO` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` | Los enlaces de descarga ya repartidos dejan de valer |
| `WORKER_TOKEN` | El mismo comando de arriba | Los programas que la usen necesitan la nueva |
| `HOSTINGER_API_TOKEN` | hPanel › API | Solo para desplegar |
| Contraseñas de usuarios | **Ajustes › Usuarios** | Cierra sus sesiones |
| Sesión de Claude Code | `claude` › `/logout` y `/login` en el procesador | — |

Después de rotar: `npm run check-health` en el procesador y entrar al panel.

---

## Pruebas

```bash
npm test               # todas las suites, en serie, con un resumen al final
npm run verify:e2e     # subir MP4 → transcribir → buscar momentos → revisar → aprobar → agenda
```

Corren contra una base en memoria (PGlite) y sin red: Claude, Telegram y upload-post se sustituyen por imitaciones. Las que necesitan la base real (`DATABASE_URL`) o ffmpeg salen como **OMITIDA**, con el motivo, en vez de fallar. Cada fase del plan tiene su suite (`verify:fase5` … `verify:fase8`).

---

## Respaldos

El procesador hace **un respaldo diario** de toda la base (`respaldos/klip-AAAA-MM-DD.json.gz`, se guardan los 14 últimos) y, si hay Supabase Storage, sube una copia al cubo privado. **Ajustes › Sistema** dice cuándo fue el último.

```bash
npm run respaldo                                   # uno ahora mismo
npm run restaurar -- respaldos/klip-2026-11-02.json.gz              # dice qué haría
npm run restaurar -- respaldos/klip-2026-11-02.json.gz --confirmar  # inserta lo que falte, sin pisar nada
```

Los respaldos contienen datos sensibles: trátalos como el `.env`.

---

## Documentación

| Documento | Para quién |
|---|---|
| [GUIA-EQUIPO.md](GUIA-EQUIPO.md) | Quien usa el panel, el día a día |
| [docs/PRODUCCION.md](docs/PRODUCCION.md) | **Checklist de salida a producción** y tareas pendientes |
| [docs/RIESGOS.md](docs/RIESGOS.md) | Normas de TikTok, publicar en muchas cuentas y derechos de autor |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Componentes, flujo de datos, variables y dependencias |
| [docs/MIGRAR_WORKER.md](docs/MIGRAR_WORKER.md) | Llevar el procesador a otra máquina o a Docker |
| [docs/IA.md](docs/IA.md) · [docs/ACCESO.md](docs/ACCESO.md) | La IA con la suscripción · login y roles |
| [docs/DEUDA.md](docs/DEUDA.md) | Lo que queda por probar o se hizo distinto al plan |
| [OPERACION.md](OPERACION.md) · [CONTEXT.md](CONTEXT.md) | Mantenimiento · decisiones técnicas |

---

## Cómo está organizado

```
src/
  ingest/      descarga y audio
  transcribe/  whisper por ffmpeg
  llm/         claude -p: proveedor, esquema, errores, estado
  select/      buscar momentos, música, ajustes de corte
  render/      vertical 9:16, encuadre con la cara, subtítulos
  variants/    una copia por cuenta, con la descripción variada
  queue/       reparto en la agenda (por cliente)
  publish/     proveedores, worker y planes
  metrics/     resultados
  alertas/     Telegram y correo
  auth/        usuarios, sesiones y roles
  jobs/        cola de tareas, reintentos, mantenimiento del procesador
  store/       Postgres, respaldos
  review/      el panel: page.ts + estilos.ts + guion.ts + server.ts + seguridad.ts
scripts/       cada comando de npm y las pruebas (verify-*.ts)
db/            migraciones en orden; cada una dice cómo deshacerse
```

**El panel se escribe a mano, sin framework.** `estilos.ts` y `guion.ts` son plantillas de texto que el navegador recibe tal cual: dentro no puede haber comillas invertidas ni `${`, y las barras de las expresiones regulares van dobles. La política de seguridad (CSP) acepta solo ese script por su huella: si algo cambia el texto del script fuera de `page.ts`, el panel no arranca y `verify:fase8` lo dice.
