# KLIP studio

Convierte directos largos en clips verticales y los publica solo, repartidos
entre varias cuentas de TikTok con su horario.

El trabajo manual se reduce a una decisión: **aprobar o descartar cada clip**.
Todo lo demás (descargar, transcribir, elegir los momentos, renderizar, hacer
una copia por cuenta, programarlas y publicarlas) lo hace el programa.

---

## Qué es cada cosa

```
VOD largo
  │  descarga + transcribe           yt-dlp + ffmpeg con filtro whisper
  ▼
texto con tiempos
  │  elige los mejores momentos      un modelo de lenguaje
  ▼
clips
  │  renderiza en vertical           ffmpeg + NVENC, subtítulos quemados
  ▼
REVISAR  ← el único gesto manual
  │  una copia por cuenta, con el pie variado
  │  reparte en el calendario        con dispersión horaria
  ▼
cola  →  publica  →  recoge métricas
```

El panel web lo gobierna todo. No hace falta abrir una terminal para operar.

---

## Empezar

Necesitas **Node 24** y, para procesar vídeo, un **ffmpeg con el filtro
whisper** y una GPU NVIDIA. El panel y la publicación funcionan sin nada de eso.

```bash
npm install
cp .env.example .env     # y rellena lo que pide
npm run doctor           # dice qué falta y dónde
npm run db:setup         # crea las tablas
npm run crear-admin -- tu@correo.com "Nombre"   # el primer usuario
npm run review           # abre el panel en http://localhost:4311
```

`npm run doctor` es el primer sitio al que ir cuando algo no arranca: comprueba
cada binario, cada variable y la conexión a la base, y dice qué falta.

### Lo que hay que rellenar en `.env`

Ninguna clave viaja en el repositorio. Las once que van vacías en
`.env.example` son las que hay que pedir:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Postgres (Supabase). Sin esto no arranca nada |
| `LLM_PROVIDER` | Elegir momentos: `claude-cli` (tu suscripción de Claude, sin clave; ver [docs/IA.md](docs/IA.md)) o `anthropic-api` con `ANTHROPIC_API_KEY` |
| `UPLOAD_POST_API_KEY` | Publicar en TikTok |
| `WORKER_TOKEN` | Opcional: clave de servicio para programas que llamen al panel ([docs/ACCESO.md](docs/ACCESO.md)) |
| `HOSTINGER_API_TOKEN` | Solo para desplegar. **Da control total de la cuenta** |

Las rutas de `ffmpeg`, `ffprobe` y `yt-dlp` van **absolutas y a mano**. No se
resuelven por PATH a propósito: instalar yt-dlp por winget deja un segundo
ffmpeg sin el filtro whisper ni NVENC, y el programa usaría el equivocado sin
avisar.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run review` | El panel. Es por donde se opera |
| `npm run doctor` | Diagnóstico del entorno |
| `npm run trabajador` | Ejecuta las tareas que encola el panel |
| `npm run publish -- --live` | Una pasada del publicador |
| `npm run desplegar` | Sube el panel a Hostinger |
| `npm run vaciar` | Cuenta qué hay. Con `-- --de-verdad`, lo borra |

Hay una suite de verificación por área, sin dependencias externas, que corre
contra una base en memoria:

```bash
npm run verify:panel      # 68 comprobaciones del panel y sus rutas
npm run verify:publish    # el worker: cadencia, reintentos, concurrencia
npm run verify:ajustes    # ajustes, plantillas y planes del proveedor
```

`verify:db` falla 2 de 8 y es conocido: compara el almacén en fichero, muerto
desde septiembre de 2026, contra Postgres.

---

## Documentación

Empieza por la que te toque:

| Documento | Para quién |
|---|---|
| [GUIA-EQUIPO.md](GUIA-EQUIPO.md) | **Quien usa el panel.** Las cuatro secciones y el día a día |
| [OPERACION.md](OPERACION.md) | Quien lo mantiene: tareas programadas, despliegue, qué mirar cuando algo falla |
| [CONTEXT.md](CONTEXT.md) | Quien toca el código: decisiones técnicas y por qué |
| [FASES.md](FASES.md) | Cómo se construyó, fase por fase |
| [REDISENO.md](REDISENO.md) | El rediseño del panel: qué cambió y por qué |
| [AUDITORIA-MULTICUENTA.md](AUDITORIA-MULTICUENTA.md) | Qué aguanta el sistema al crecer en cuentas, medido |

---

## Cómo está organizado

```
src/
  ingest/      descarga y audio
  transcribe/  whisper por ffmpeg
  select/      elegir momentos + los ajustes de corte
  render/      vertical 9:16, subtítulos y rótulo (.ass)
  variants/    una copia por cuenta, con el pie variado
  queue/       reparto en el calendario
  publish/     proveedores, worker y planes
  metrics/     recogida y análisis
  store/       Postgres
  review/      el panel: page.ts + estilos.ts + guion.ts + server.ts
scripts/       cada comando de npm
db/            migraciones, en orden
```

### Dos cosas que conviene saber antes de tocar el panel

**El panel se escribe a mano, sin framework.** `estilos.ts` y `guion.ts` son
plantillas de texto que el navegador recibe tal cual. Una comilla invertida
dentro de un comentario cierra la plantilla a media altura y rompe la página
entera. Se partió en tres ficheros precisamente para que el typecheck lo cace;
antes no lo hacía y se rompió seis veces.

**Hay dos almacenes y uno está muerto.** `src/store/store.ts` es el de fichero,
sin uso desde el 2026-09-13; el vivo es `src/store/pg.ts`. Si algo lee datos y
no aparecen en el panel, es casi seguro que está leyendo el que no es.

---

## Lo que NO está en el repositorio

Ninguna credencial, ningún vídeo y ningún dato de cuentas reales. Verificado
comparando cada valor del `.env` real contra todo lo que se publica.

Lo que sí hace falta pedir aparte: las claves de `.env`, el acceso a la base de
Supabase y la llave del panel.
