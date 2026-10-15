# CONTEXT.md

Contexto compartido del proyecto. **Lee este archivo antes de empezar cualquier fase.**
Todo lo que dice "verificado" fue comprobado ejecutando el comando en esta máquina. No lo re-verifiques salvo que algo falle.

---

## 1. Qué es el proyecto

Sistema que convierte streams o videos largos propios en clips verticales para TikTok, y los distribuye programadamente en 20 cuentas.

```
VOD largo -> transcripción -> selección de momentos por IA -> render vertical
          -> aprobación humana -> cola -> publicación en 20 cuentas
```

Objetivo operativo: 60 publicaciones diarias (20 cuentas x 3 videos). Clips de 30 a 60 segundos, 9:16, subtitulos quemados.

El contenido de origen es propio. No se recorta material de terceros.

---

## 2. Entorno verificado

| Componente | Estado | Detalle |
| --- | --- | --- |
| SO | Windows 11 | Shell: PowerShell 5.1 y Git Bash |
| GPU | NVIDIA RTX 4060 Laptop | 8188 MiB VRAM, driver 610.62 |
| ffmpeg | 8.1.1 full build (gyan.dev) | En PATH |
| Node.js | v24.15.0 | En PATH |
| Python | **NO instalado** | No lo instales. El stack no lo necesita |
| yt-dlp | **NO instalado** | Se instala en la Fase 0 |
| winget | Disponible | Usar para instalar yt-dlp |

### Capacidades confirmadas de ffmpeg

Encoders NVENC presentes: `h264_nvenc`, `hevc_nvenc`, `av1_nvenc`.

Filtros presentes: `subtitles`, `ass` (libass), `loudnorm`, `crop`, `gblur`, `boxblur`, `scale_cuda`.

Build compilado con `--enable-whisper`, `--enable-libass`, `--enable-libfreetype`, `--enable-libharfbuzz`, `--enable-libfribidi`, `--enable-nvenc`, `--enable-cuda-llvm`.

### Filtro whisper integrado

Este build trae transcripción nativa. Opciones verificadas con `ffmpeg -h filter=whisper`:

```
model                     Path al modelo ggml de whisper.cpp
language                  'auto' por defecto
queue                     tamaño de cola de audio (default 3)
use_gpu                   boolean (default true)
gpu_device                int (default 0)
destination               archivo de salida
format                    text | srt | json   (default text)
max_len                   largo máximo de segmento en caracteres (default 0)
vad_model                 path al modelo VAD
vad_threshold             0..1 (default 0.5)
vad_min_speech_duration   default 0.1
vad_min_silence_duration  default 0.5
```

Es un filtro de audio (A->A), así que se usa con `-af` y salida `-f null -`.

**Implicación de diseño: no se usa Python, ni faster-whisper, ni WhisperX, ni MoviePy.** Todo el procesamiento es Node + ffmpeg.

---

## 3. Arquitectura: qué corre dónde

Regla: **lo pesado en GPU y disco corre local; lo que debe estar siempre encendido corre en web.**

### Local (PC con RTX 4060)
- Descarga del VOD (yt-dlp)
- Transcripción (ffmpeg + whisper, GPU)
- Corte y render de clips (ffmpeg + NVENC)
- Generación de las variantes por cuenta

### Web (siempre encendido)
- Supabase: base de datos, cola y storage de los MP4 aprobados
- Panel de aprobación
- Worker que publica a la hora programada

**El PC no necesita estar encendido para publicar.** Solo para procesar VODs nuevos.

### El panel NO es Next.js

Aquí ponía "Panel Next.js" y nunca lo fue. Es un servidor HTTP de Node sin
dependencias (`src/review/server.ts`) que sirve una sola página
(`src/review/page.ts`). No hay React, ni Tailwind, ni shadcn, ni bundler.

Se dejó así a propósito: el panel lista clips, reproduce un MP4 y guarda una
decisión. Montar un framework para eso añadiría cientos de dependencias a un
proyecto que tiene cinco, y no haría nada que esto no haga. Esa línea vieja ha
provocado ya dos encargos pidiendo componentes de shadcn que aquí no existen.

### Secciones del panel

Ocho, todas en `src/review/page.ts`, una función `vista*` cada una:

| Sección | Qué es |
| --- | --- |
| Inicio | Qué toca hacer ahora, VODs con su progreso (5 pasos), subir uno nuevo |
| Revisar videos | La compuerta de aprobación. Lo único que no hace el programa solo |
| Programación | La cola de envíos por VOD y su salud |
| Ajustes | Cómo se cortan los videos: duración, cuántos, estilo de subtítulos, plantillas |
| Horarios | Cuánto se publica y con qué separación |
| Plataformas | Estado de conexión de TikTok y qué falta para las demás |
| Historial | Trabajos ejecutados y lo que costó cada paso |
| Resultados | Métricas de lo publicado |

La campana de avisos de la cabecera no tiene tabla propia: un aviso **es** un
trabajo terminado, y esos ya están en `jobs`. Lo único que guarda el navegador
es cuándo miraste por última vez (`localStorage`, clave `klip:vistos`), porque
eso es de cada aparato y no de la cuenta.

### Tipografías de los subtítulos

Lista cerrada en `src/select/ajustes.ts` (`FUENTES`) y repetida en
`src/render/ass.ts`. Dos motivos, los dos reales:

1. El nombre se escribe tal cual en la línea `Style:` de un `.ass`, que es un
   formato **separado por comas**. Un nombre con una coma correría todos los
   campos siguientes.
2. libass resuelve la fuente **por nombre** contra las instaladas en el PC que
   renderiza. Un nombre que no existe no da error: cae en silencio a otra
   fuente y los clips salen distintos sin avisar.

Las cinco actuales (Impact, Arial Black, Segoe UI Black, Verdana, Tahoma) están
comprobadas en este PC. **Antes de añadir una, verifica que está instalada aquí**,
no en el servidor: el servidor no renderiza nada.

### Copias de revisión en la nube (Fase 7)

El panel vive en un servidor y los MP4 en el PC, así que desde el móvil no se
veía ningún vídeo. Se sube una **copia ligera**, nunca el máster.

Los números salen de medir, no de estimar:

| | Máster | Copia |
|---|---|---|
| Resolución | 1080×1920 | 540×960 |
| Un clip de 42 s | 30,34 MB | **1,13 MB** |
| Los 33 que hay | 1127 MB | **37 MB** |
| Un VOD de 42 clips | ~1,3 GB | **48 MB** |

El plan gratuito de Storage es 1 GB: subir másters no cabría ni para un VOD.
En copia caben unos veinte. **El máster se queda en el PC** porque es lo que se
publica y de lo que salen las variantes por cuenta.

- Codifica `src/render/copia.ts` (x264 CRF 30, `+faststart` para que empiece sin
  descargarse entero). x264 por CPU y no NVENC: a esta resolución tarda 2,5 s,
  comprime mejor a CRF alto y deja la GPU libre.
- Sube `scripts/subir.ts` → `npm run subir -- <sourceId> [--rehacer]`.
- El cubo `revision` es **privado**. El panel firma una URL nueva de 60 s por
  petición; no se guarda ninguna firma, porque una URL de larga duración es una
  copia del permiso que escapa a la llave del panel.
- Cliente en `src/store/nube.ts`, REST puro sin el SDK de Supabase.
- El encadenado automático ahora llega hasta aquí:
  `descargar → momentos → vídeos → subirlos → [para en la compuerta]`.

### Publicación: dos proveedores, un contrato

Todo el sistema habla con `PublishProvider` (`src/publish/types.ts`), **un solo
método**. Por eso cambiar de proveedor no toca la cola, el planificador ni el
worker. Se elige con `PUBLISH_PROVIDER`, nunca adivinando qué credenciales hay.

| | upload-post | TikTok directo |
|---|---|---|
| Coste | desde $24/mes | $0 |
| Permiso de las cuentas | suyo | nuestro, en `tiktok_tokens` |
| Auditoría | ya la pasaron ellos | **la tienes que pasar tú** |

**Sin auditoría, TikTok fuerza `SELF_ONLY` y no lo ve nadie.** No es una
limitación de cuota: es que la publicación no sirve. `npm run tiktok -- revisar`
lo detecta preguntando por `privacy_level_options`; si `PUBLIC_TO_EVERYONE` no
está en la lista, la app no está auditada. Es la única señal que da TikTok.

Detalles que costaron leerse y no conviene redescubrir:

- **FILE_UPLOAD, no PULL_FROM_URL.** Esta última exige verificar la propiedad
  del dominio del que TikTok descarga, y los másteres viven en el PC.
- **`draft` y `direct` son endpoints distintos**, no un parámetro:
  `/inbox/video/init/` contra `/video/init/`. El de borradores no admite
  `privacy_level`.
- **El access_token dura 24 h y el refresh 365 días.** Con publicación diaria,
  renovar es el camino normal, no la excepción: vive dentro de `tokens.vigente()`.
- **Al renovar, TikTok puede devolver un refresh_token distinto**, y el viejo
  deja de valer. Guardar siempre el que vuelve es lo único que impide perder una
  cuenta dentro de un año sin saber por qué.
- **Tope de 5 subidas pendientes por cuenta en 24 h**
  (`spam_risk_too_many_pending_shares`). Se clasifica como límite de cadencia,
  no como error: el envío sigue siendo válido, solo hay que esperar.

`/auth/tiktok/callback` es **la única ruta del panel que atiende sin llave**,
porque quien llega es el navegador redirigido desde tiktok.com. La protege un
`state` de un solo uso guardado en `tiktok_pendientes`, que caduca en una hora.

### Las pruebas no deben heredar el entorno

`loadEnv()` lee el `.env` **una sola vez** y solo rellena lo que no esté ya en
`process.env`. Un `delete process.env.X` antes de esa primera lectura no sirve
de nada: la siguiente lectura lo repuebla desde el fichero.

Por eso `verify-panel` y `verify-nube` llaman a `loadEnv()` **antes** de tocar
variables. Sin eso, las pruebas pasaban solo en máquinas sin esa variable
configurada, y empezaron a fallar el día que se configuró.

### Cambios de esquema antes de desplegar

Las columnas nuevas se añaden en `db/0NN-*.sql` y **las aplica
`npm run db:setup` desde este PC**, no el servidor: ese script usa `tsx`, que
no se instala en producción. Todos los ficheros usan `if not exists`, así que
repetirlo no rompe nada.

**El orden importa.** Si se sube el código antes de migrar, el panel arranca y
lee bien (las columnas que faltan caen a sus valores por defecto), pero guardar
en Ajustes da error 500 hasta que la migración corre. Migrar primero,
desplegar después.

---

## 4. Convenciones del repositorio

- Runtime: **Node.js 24, ESM** (`"type": "module"`). TypeScript.
- Nada de Python en ninguna fase.
- ffmpeg se invoca como proceso hijo. **No uses wrappers tipo fluent-ffmpeg**: ocultan los flags y este proyecto depende de flags específicos de NVENC y de filtergraphs complejos. Usa `node:child_process` con arrays de argumentos.
- Cada etapa escribe su salida en `work/<sourceId>/` y deja un JSON de estado. Las etapas deben ser reanudables: si el archivo de salida ya existe y es válido, se salta el trabajo.
- Configuración por `.env`, nunca hardcodeada.
- Errores de ffmpeg: capturar stderr completo y guardarlo. Un fallo de filtergraph es ilegible si solo se reporta el exit code.

### Aviso de seguridad

El directorio padre de este proyecto está dentro de un repositorio git con remoto **público**. Nunca hagas `git add -A`, y asegúrate de que `.env`, `work/`, `out/` y `models/` estén en `.gitignore` antes del primer commit.

---

## 5. Restricciones técnicas de destino (TikTok)

Especificaciones que debe cumplir cada MP4 producido:

| Parámetro | Requisito |
| --- | --- |
| Contenedor | MP4 (también acepta WebM, MOV) |
| Tamaño | Máximo 1 GB |
| Duración | Entre 3 y 600 segundos |
| Resolución | Mínimo 360 px en ambos lados. Objetivo: 1080x1920 |
| Frame rate | Entre 23 y 60 FPS |
| Audio | AAC |

Límites de publicación: TikTok permite hasta 6 peticiones por minuto por token de usuario. Con 3 publicaciones diarias por cuenta hay margen de sobra; el rate limit no es el cuello de botella.

El cuello de botella real es la **auditoría de la app**: una app sin auditar publica todo en `SELF_ONLY` (privado) y solo permite 5 usuarios en 24 horas. Por eso la Fase 6 arranca sobre una capa de terceros ya auditada, detrás de una interfaz propia.

---

## 6. Notas de ffmpeg que ahorran horas

**Escape de rutas en el filtro `ass` / `subtitles` en Windows.** Los dos puntos de `C:\` rompen el parser de filtergraph. Soluciones: usar rutas relativas al cwd del proceso, o escapar como `C\:/ruta/archivo.ass`. Decide una y documéntala.

**Whisper.cpp requiere audio a 16 kHz mono.** Extrae el audio con `-ar 16000 -ac 1` antes de pasarlo al filtro.

**Verifica los flags de NVENC antes de usarlos**, con `ffmpeg -h encoder=h264_nvenc`. Los nombres de preset cambiaron entre versiones mayores de ffmpeg; no asumas los de tutoriales viejos.

**Corte preciso al frame:** poner `-ss` antes de `-i` es rápido pero salta al keyframe más cercano. Para cortes exactos hace falta re-encode. Como igual se re-encodea para el reencuadre y los subtítulos, esto no cuesta nada extra.

---

## 6b. Comportamiento real del filtro whisper (medido, no supuesto)

Todo lo de esta seccion se comprobo ejecutando el filtro en esta maquina durante la Fase 1. Contradice varias suposiciones razonables, asi que leelo antes de tocar nada de transcripcion.

### El formato de salida no es JSON

Con `format=json` el filtro escribe **NDJSON**: un objeto por linea, sin corchetes envolventes ni comas.

```
{"start":0,"end":2000,"text":"Welcome back to the stream everyone."}
{"start":2000,"end":7000,"text":"Today we talk about something most people get wrong."}
```

`JSON.parse` sobre el archivo completo lanza excepcion. Hay que parsear linea a linea.

### Los tiempos vienen en milisegundos

Pese a que la opcion `queue` del mismo filtro se expresa en segundos. La conversion a segundos ocurre una sola vez, en `src/transcribe/parse.ts`.

### No hay tiempos por palabra, pero apenas importa

El filtro solo emite segmentos, asi que **la Fase 3 no puede hacer resaltado palabra por palabra** sin cambiar de motor.

En la practica esto pesa mucho menos de lo que parecia. Medido sobre 3027 segmentos de habla real (podcast de 87 minutos):

| Metrica | Valor |
| --- | --- |
| Duracion mediana de segmento | **1.52 s** |
| Percentil 90 | 2.92 s |

Un segmento mediano es una frase corta:

```
1804.0s -> 1805.4s  Y yo lo que dije fue,
1805.4s -> 1806.9s  este cabrón me tiene miedo.
1806.9s -> 1808.2s  Porque, cabrón,
```

A 1.5 segundos por linea, los subtitulos a nivel de segmento ya son subtitulos a nivel de frase, que es exactamente el aspecto estandar del formato vertical. Planifica la Fase 3 sobre segmentos y no gastes esfuerzo en cambiar de motor salvo que el resultado visual lo pida.

### `queue` es una duracion en segundos, y el valor por defecto es malo

Rango aceptado: `[0.02, 3600]`. Por defecto 3 segundos, que produce transcripciones rotas: el filtro trocea el audio en ventanas y toda palabra que cae en una frontera se parte.

| queue | Resultado sobre la misma frase |
| --- | --- |
| 3 (defecto) | `"...downloads a long video, trance,"` (destroza "transcribes") |
| 15 | `"...downloads a long video, transcribes the audio with Whisper..."` |
| 30 | igual de correcto |

Se usa **30**, la ventana de contexto nativa de whisper. Valores mayores no aportan contexto y empeoran la granularidad.

### El VAD es 35 veces mas lento y no aporta nada

Medido sobre 33 s de audio, mismo modelo, misma ventana:

| Configuracion | Tiempo |
| --- | --- |
| Sin VAD | 2.5 s |
| Con VAD (`ggml-silero-v5.1.2.bin`) | 87.6 s |

La salida fue **identica**. Extrapolado a un stream de 4 horas: 18 minutos frente a 10 horas. El VAD esta desactivado por defecto; se activa con `--vad` solo para experimentar. El modelo esta descargado en `models/` por si se quiere volver a medir.

### La GPU si se usa

| `use_gpu` | Tiempo para 12 s de audio |
| --- | --- |
| 1 (defecto) | 2.3 s |
| 0 | 10.6 s |

Rendimiento real medido sobre un podcast de **86 min 58 s** con `large-v3-turbo`: **1 min 36 s de transcripcion**, es decir **54x tiempo real**. Un stream de 4 horas se transcribe en unos 4 minutos y medio.

(La cifra de 13x que se midio antes sobre un clip de 33 s estaba dominada por la carga del modelo en VRAM, que es un coste fijo. En material largo se amortiza.)

Calidad sobre habla real: transcribio correctamente jerga puertorriqueña coloquial ("hangando", "corillo", "puñeta") y alterno entre español e ingles sin perder el hilo. Cobertura de voz del 99.5%.

### La segmentacion sigue las pausas del habla

Este punto casi lleva a una conclusion equivocada. Con voz sintetica de flite, que no tiene pausas, el filtro devolvio un unico segmento de 30 segundos, lo que parecia indicar que la granularidad estaba atada al tamaño de ventana. Al insertar silencios de 0.7 s entre frases, el resultado fue una frase por segmento con fronteras limpias.

Conclusion: la granularidad depende del habla, no del reloj. Con voz humana real, que tiene pausas y respiraciones, la segmentacion es utilizable para elegir clips.

**Leccion transferible: no valides el comportamiento de segmentacion con audio sintetico continuo.** No se parece al material real.

### Escape de rutas en el filtergraph, resuelto

Comprobado empiricamente en Windows:

| Forma | Resultado |
| --- | --- |
| `C:/ruta` | falla, los dos puntos separan opciones |
| `C\:/ruta` | falla, un solo escape no sobrevive al parser |
| `C\\:/ruta` | **funciona** |

Implementado en `toFilterPath()` en `src/lib/fsx.ts`. Alternativa tambien verificada: rutas relativas con el cwd en la raiz del proyecto.

### yt-dlp necesita que se le indique el ffmpeg correcto

Se le pasa `--ffmpeg-location` apuntando al build de gyan.dev. Sin eso prefiere el ffmpeg que trae como dependencia, que no incluye NVENC ni el filtro whisper.

---

## 6c. Trampas de yt-dlp con YouTube (medidas)

### Un yt-dlp desactualizado se manifiesta como HTTP 403, no como "actualizate"

Este es el diagnostico erroneo mas caro que se cometio en el proyecto. Con yt-dlp **2026.06.09** (tres meses de antiguedad), la descarga de cualquier formato de alta calidad fallaba asi:

| `player_client` | Resultado con 2026.06.09 |
| --- | --- |
| (por defecto, `android_vr`) | `HTTP Error 403: Forbidden` al descargar el medio |
| `tv` | `The page needs to be reloaded` |
| `web_safari` / `ios` / `web` | `Requested format is not available` |
| `mweb` | Funcionaba, pero solo exponia el formato 18 (640x360) |

El sintoma parecia una contramedida antibot que exigia autenticacion, y llevo a implementar soporte de cookies del navegador. **Era simplemente que la version estaba obsoleta.**

Con **2026.08.19**, sin cookies, sin `--extractor-args` y con el cliente por defecto, YouTube expone y sirve 1080p60 con normalidad. Verificado descargando y comprobando con ffprobe: `1920x1080`, `60000/1001` fps.

> **Regla:** ante cualquier fallo de descarga de YouTube, ejecuta `yt-dlp -U` **antes** de diagnosticar nada mas. YouTube cambia su capa de entrega a menudo y yt-dlp la persigue; una version de mas de unas semanas produce errores que aparentan ser de permisos o de formato.

`--cookies-from-browser` sigue implementado y disponible en `.env`, desactivado por defecto. Solo tiene sentido para contenido privado o restringido por edad. Nota adicional: **Chrome bloquea su base de cookies mientras esta abierto**; yt-dlp falla con `Could not copy Chrome cookie database`. Hay que cerrar el navegador.

### Seleccion de formato

`YTDLP_FORMAT` prefiere avc1 1080p sobre AV1. AV1 pesa menos (612 MiB frente a 792 MiB en el video de prueba) y la RTX 4060 lo decodifica por hardware, pero h264 es el camino mas probado para los filtergraphs y NVENC de la Fase 3. Si el espacio en disco importa mas que la previsibilidad, cambia el orden.

### Pedir el volcado completo de metadatos es un error

`--dump-single-json` sobre un video de 87 minutos devuelve mas de 500 KB: todos los formatos, storyboards y URLs de subtitulos en decenas de idiomas. Con `--print "%(.{id,title,duration,...})j"` la misma informacion util son unos 300 bytes.

---

## 6d. Leccion de diseño: no truncar datos, nunca

La primera version del runner de procesos usaba un unico buffer acotado para stdout y stderr, que al desbordarse conservaba principio y final e insertaba un marcador en medio.

Con el volcado de metadatos de 500 KB, ese marcador cayo dentro de una cadena del JSON y `JSON.parse` fallo con `Bad control character in string literal at position 262144` — exactamente el punto de corte.

El fallo no fue el limite, fue aplicar un buffer **con perdida** a un flujo que es **datos**. Ahora hay dos acumuladores separados en `src/lib/proc.ts`:

- **stderr** usa `BoundedBuffer`: trunca conservando ambos extremos. Es diagnostico, truncarlo es correcto y deseable.
- **stdout** usa `LosslessBuffer`: nunca trunca. Si se excede el limite, **lanza**.

Truncar datos produce una salida que parece valida y no lo es. Fallar ruidosamente siempre es preferible.

---

## 7. Estructura de directorios objetivo

```
tiktok-clipper/
  CONTEXT.md
  FASES.md
  .env.example
  package.json
  src/
    ingest/       descarga y extracción de audio
    transcribe/   filtro whisper y parseo del JSON
    select/       selección de momentos con la API de Claude
    render/       filtergraphs, generación de .ass, encode
    variants/     variación por cuenta
    publish/      adaptador de publicación
    db/           cliente y tipos de Supabase
    lib/          ffmpeg runner, logger, utilidades de tiempo
  models/         modelos ggml (fuera de git)
  work/           artefactos intermedios (fuera de git)
  out/            MP4 finales (fuera de git)
  web/            panel Next.js (Fase 4)
```
