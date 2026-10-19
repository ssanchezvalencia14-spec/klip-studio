# Mover el procesador (trabajador) a otra máquina

Hoy el procesador corre en un PC con Windows y GPU NVIDIA. Esta guía explica
qué hace falta para llevarlo a otro PC o a un VPS sin tocar código.

El panel no cambia: sigue en Hostinger. El procesador solo necesita llegar a la
base de datos (`DATABASE_URL`). No hay que abrir puertos: es el procesador quien
pregunta a la base, nunca al revés.

---

## Qué necesita la máquina nueva

| Pieza | Para qué | Cómo comprobarlo |
|---|---|---|
| Node.js 24 | Ejecutar el trabajador | `node --version` |
| ffmpeg 8.x **con el filtro whisper** | Transcribir y armar los clips | `ffmpeg -hide_banner -h filter=whisper` |
| GPU NVIDIA con NVENC | Codificar los clips (`h264_nvenc`) | `nvidia-smi` y `ffmpeg -encoders \| grep nvenc` |
| yt-dlp | Descargar videos | `yt-dlp --version` |
| Modelo `ggml-large-v3-turbo.bin` | Transcribir | Copiar la carpeta `models/` |
| Claude Code **con sesión iniciada** | Buscar momentos con la suscripción | `claude` → `/login`, luego `npm run probar-ia` |
| `.env` | Configuración | `npm run doctor` |

**Sin GPU NVIDIA no funciona el render tal como está**: usa `h264_nvenc`. Un VPS
sin GPU puede descargar y transcribir (whisper también va por CPU, mucho más
lento), pero no armar los clips.

**Claude Code con suscripción necesita una sesión iniciada en esa máquina.** No
basta con copiar el `.env`: hay que entrar una vez con `claude` y escribir
`/login`. La sesión queda en la carpeta `~/.claude` de ese usuario. Ver
`docs/IA.md`.

---

## Configuración: nada de rutas fijas

Desde la Fase 4 los binarios se leen de la configuración y, si no está, del
PATH:

| Variable | Si está vacía |
|---|---|
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg` y `ffprobe` del PATH |
| `YT_DLP_PATH` (o `YTDLP_PATH`) | `yt-dlp` del PATH |
| `CLAUDE_CLI_PATH` | `claude` del PATH |
| `WORK_DIR`, `OUT_DIR` | `work/` y `out/` dentro del proyecto |
| `WHISPER_MODEL_PATH` | relativo a la raíz del proyecto |

En Windows conviene seguir fijando `FFMPEG_PATH`: hay dos ffmpeg en el PATH tras
instalar yt-dlp por winget, y solo uno trae whisper y NVENC.

---

## Pasos

1. Instalar lo de la tabla de arriba.
2. Clonar el repositorio y ejecutar `npm ci`.
3. Copiar `.env` (sin rutas de Windows) y la carpeta `models/`.
4. Iniciar sesión en Claude Code: `claude` → `/login`.
5. Comprobar todo:

   ```
   npm run doctor
   npm run check-health
   ```

6. Arrancar el trabajador: `npm run worker`. En Linux, con un servicio de
   systemd que lo reinicie si se cae; en Windows, la tarea programada de
   `OPERACION.md`.
7. **Apagar el procesador viejo.** Dos procesadores a la vez no se pisan (la
   cola usa `for update skip locked`), pero cada uno necesita sus propios
   archivos: un video descargado en uno no está en el otro.

---

## Con Docker

Hay un `Dockerfile` en la raíz. **Sin probar**: se escribió en una PC sin
Docker.

```
docker build -t klip-worker --build-arg FFMPEG_URL=<build de ffmpeg con whisper> .

# Una vez, para iniciar sesión en Claude Code dentro del contenedor:
docker run -it --rm --gpus all -v klip-claude:/home/node/.claude klip-worker claude

# El trabajador:
docker run -d --restart unless-stopped --gpus all \
  --env-file .env \
  -v klip-claude:/home/node/.claude \
  -v /srv/klip:/data \
  klip-worker
```

- `--gpus all` necesita el NVIDIA Container Toolkit en el anfitrión.
- `/srv/klip` debe contener `models/ggml-large-v3-turbo.bin`; ahí quedan también
  `work/` y `out/`.
- El volumen `klip-claude` guarda la sesión de Claude Code entre reinicios.

---

## Lo que hace el procesador solo

- **Latido cada 30 s.** El panel muestra "Procesador conectado" y avisa en
  Inicio si lleva más de 5 minutos sin dar señales.
- **Reintentos:** una tarea que falla se reintenta sola dos veces como mucho, a
  1 y a 5 minutos. No se reintenta lo que va a fallar igual (YouTube bloqueó la
  descarga, la clave de la API no vale, un directo en curso).
- **Reanudación:** al arrancar, lo que este mismo equipo dejó a medias vuelve a
  la cola en el acto. Lo de otro equipo que dejó de latir vuelve a los 5 minutos.
- **yt-dlp al día:** una vez por semana mira su versión y, si tiene más de
  30 días, intenta `yt-dlp -U`. El resultado sale en Ajustes → Sistema.
- **Disco:** cada media hora mide el espacio y avisa al pasar del 80 %.
- **Limpieza:** si en Ajustes → Sistema se pone un número de días, borra el video
  original de los videos ya revisados enteros y los clips descartados.
