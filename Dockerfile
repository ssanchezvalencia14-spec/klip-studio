# El trabajador (procesador) de KLIP studio en un contenedor Linux.
#
# SIN PROBAR: se escribio en una PC sin Docker. Antes de fiarse, sigue la
# comprobacion de docs/MIGRAR_WORKER.md (npm run doctor y npm run check-health
# dentro del contenedor).
#
# Construir:   docker build -t klip-worker .
# Arrancar:    ver docs/MIGRAR_WORKER.md (necesita GPU NVIDIA y la sesion de
#              Claude Code guardada en un volumen).

FROM node:24-bookworm-slim

# ffmpeg CON el filtro whisper. El de Debian no lo trae: hace falta un build
# 8.x compilado con --enable-whisper (y NVENC si hay GPU NVIDIA). Pon aqui la
# URL de un .tar.xz con bin/ffmpeg y bin/ffprobe que lo cumpla, y compruebalo
# con:  ffmpeg -hide_banner -h filter=whisper
ARG FFMPEG_URL=""
# yt-dlp: el binario oficial, que se puede actualizar con -U.
ARG YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

RUN if [ -n "$FFMPEG_URL" ]; then \
      curl -fsSL "$FFMPEG_URL" -o /tmp/ffmpeg.tar.xz \
      && mkdir -p /opt/ffmpeg && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 \
      && ln -s /opt/ffmpeg/bin/ffmpeg /usr/local/bin/ffmpeg \
      && ln -s /opt/ffmpeg/bin/ffprobe /usr/local/bin/ffprobe \
      && rm /tmp/ffmpeg.tar.xz; \
    else echo "AVISO: sin FFMPEG_URL no hay ffmpeg con whisper en la imagen"; fi

RUN curl -fsSL "$YTDLP_URL" -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

# Claude Code, para la IA con la suscripcion. La sesion NO va en la imagen:
# se inicia una vez dentro del contenedor y se guarda en el volumen /home/node/.claude.
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db

# Sin rutas absolutas: los binarios salen del PATH y los datos de /data.
ENV WORK_DIR=/data/work \
    OUT_DIR=/data/out \
    WHISPER_MODEL_PATH=/data/models/ggml-large-v3-turbo.bin \
    LLM_PROVIDER=claude-cli

RUN mkdir -p /data && chown -R node:node /data /app
USER node

CMD ["npm", "run", "worker"]
