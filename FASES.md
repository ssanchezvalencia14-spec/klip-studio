# Fases del proyecto y prompts de ejecución

Ocho fases. Cada una es una sesión de Claude Code independiente y tiene un prompt listo para copiar.

**Regla de oro: no pases a la fase siguiente hasta cumplir los criterios de aceptación de la actual.** Las fases 0 a 3 producen valor por sí solas (clips publicables a mano). Las fases 4 a 7 solo tienen sentido si la 3 dio buen resultado.

| Fase | Nombre | Entrega | Bloquea a |
| --- | --- | --- | --- |
| 0 | Bootstrap del entorno | yt-dlp, modelo whisper, esqueleto Node | Todas |
| 1 | Ingesta y transcripción | VOD -> transcript JSON con timestamps | 2 |
| 2 | Selección de momentos | Transcript -> N clips candidatos | 3 |
| 3 | Render vertical | Clips candidatos -> MP4 publicables | 4 |
| 4 | Persistencia y panel | Supabase + aprobación web | 5 |
| 5 | Variantes y cola | 1 clip -> 20 variantes programadas | 6 |
| 6 | Publicación a TikTok | Cola -> publicado | 7 |
| 7 | Métricas y realimentación | Datos de rendimiento por clip | - |

**Punto de decisión crítico: al terminar la Fase 3, evalúa honestamente si los clips son publicables sin retoque.** Si no lo son, el problema está en el prompt de selección de la Fase 2, no en la infraestructura. Itera ahí antes de construir nada más.

---

## Fase 0: Bootstrap del entorno

Instalar lo que falta y dejar el esqueleto del proyecto verificado.

```
Lee tiktok-clipper/CONTEXT.md antes de hacer nada. Contiene el entorno ya verificado
de esta máquina, no lo re-verifiques.

Objetivo: dejar el proyecto listo para desarrollar, con todas las dependencias
externas instaladas y comprobadas.

Tareas:

1. Instala yt-dlp. Usa winget (está disponible). Es un binario autónomo, NO instales
   Python. Verifica con `yt-dlp --version` y reporta la versión exacta.

2. Descarga un modelo ggml de whisper.cpp a tiktok-clipper/models/.
   Con 8 GB de VRAM cabe un modelo grande. ANTES de descargar, verifica el nombre
   exacto del archivo consultando el repositorio de modelos de whisper.cpp en
   Hugging Face. No adivines el nombre del archivo ni la URL.
   Reporta qué modelo elegiste, su tamaño y por qué.

3. Inicializa el proyecto Node: package.json con "type": "module", TypeScript,
   tsx para ejecución en desarrollo. Sin frameworks pesados.

4. Crea src/lib/ffmpeg.ts: un runner de ffmpeg sobre node:child_process.spawn que
   reciba un array de argumentos, capture stdout y stderr completos, y lance un
   error con el stderr íntegro si el exit code no es 0. Los fallos de filtergraph
   son ilegibles sin el stderr completo.

5. Crea .gitignore que excluya: .env, models/, work/, out/, node_modules/.
   El directorio padre está en un repo git con remoto PÚBLICO. Esto no es opcional.

6. Crea .env.example con las variables que el proyecto irá necesitando
   (por ahora: rutas de modelos y binarios).

7. Escribe un script `npm run doctor` que verifique y reporte en tabla:
   ffmpeg presente y su versión, presencia de h264_nvenc, presencia del filtro
   whisper, presencia del filtro ass, yt-dlp presente y su versión, y existencia
   del archivo de modelo ggml.

Criterio de aceptación: `npm run doctor` pasa en verde en todos los puntos.
Ejecútalo y muéstrame la salida real.

No implementes nada del pipeline todavía.
```

---

## Fase 1: Ingesta y transcripción

De una URL a un transcript con timestamps utilizables.

```
Lee tiktok-clipper/CONTEXT.md antes de hacer nada.

Objetivo: dado un VOD, producir un transcript estructurado con timestamps,
usando el filtro whisper integrado de ffmpeg. Todo local, sin Python y sin
servicios externos.

Implementa:

1. src/ingest/download.ts
   Descarga un VOD con yt-dlp a work/<sourceId>/source.mp4.
   Elige el mejor MP4 con audio. Reporta duración, resolución y tamaño.
   Si el archivo ya existe y es válido, salta la descarga (reanudable).

2. src/ingest/audio.ts
   Extrae el audio a work/<sourceId>/audio.wav con -ar 16000 -ac 1.
   whisper.cpp exige 16 kHz mono; sin esto la transcripción falla o degrada.

3. src/transcribe/whisper.ts
   Ejecuta el filtro whisper de ffmpeg sobre el wav:
   - modelo: el de models/ (ruta desde .env)
   - use_gpu activo
   - format=json, destination a work/<sourceId>/transcript.raw.json
   - max_len ajustado para producir segmentos cortos (apunta a algo cercano
     a una línea de subtítulo vertical, en torno a 40 caracteres)
   - VAD activo si el modelo VAD está disponible
   Es un filtro de audio: usa -af y salida -f null -.
   Reporta el tiempo real que tardó frente a la duración del audio.

4. src/transcribe/parse.ts
   Normaliza el JSON crudo de whisper.cpp a un tipo propio y estable:
   { segments: [{ start: number, end: number, text: string }], language, duration }
   Guarda en work/<sourceId>/transcript.json.
   IMPORTANTE: inspecciona la forma real del JSON que emite este build antes de
   escribir el parser. No asumas el esquema. Si trae timestamps por palabra,
   consérvalos, porque los necesitaremos para subtítulos animados en la Fase 3.
   Documenta en un comentario qué granularidad ofrece realmente.

5. Un CLI: `npm run ingest -- <url>` que encadene los cuatro pasos.

Criterio de aceptación: ejecuta el pipeline completo sobre un video real de
YouTube de entre 10 y 20 minutos, y muéstrame los primeros 15 segmentos del
transcript.json junto con el tiempo de proceso. Verifica manualmente que los
timestamps corresponden al audio.

No hagas selección de clips ni render todavía.
```

---

## Fase 2: Selección de momentos

La pieza que decide si el proyecto funciona.

```
Lee tiktok-clipper/CONTEXT.md y revisa el formato de work/<sourceId>/transcript.json
producido en la Fase 1.

Objetivo: dado un transcript, que la API de Claude elija los N mejores momentos
para convertir en clips verticales.

Esta es la pieza de mayor riesgo del proyecto. Cortar video es trabajo resuelto;
elegir qué 40 segundos de un stream de 4 horas merecen ser un clip no lo es.
Trata el prompt como el artefacto principal, no como un detalle.

Implementa:

1. src/select/prompt.ts
   El prompt de selección, en un archivo aparte y fácil de iterar.
   Debe pedir explícitamente: un gancho en los primeros 3 segundos, un momento
   autoconclusivo que se entienda sin contexto previo, y un cierre que no quede
   cortado a mitad de frase.

2. src/select/select.ts
   Usa el SDK de Anthropic (@anthropic-ai/sdk) con claude-opus-4-8.
   Fuerza salida estructurada con `client.messages.parse()` y `output_config.format`,
   no parseo de texto libre. Esquema:
   {
     clips: [{
       start: number,          segundos
       end: number,            segundos
       hook: string,           la frase de apertura, textual del transcript
       reason: string,         por qué este momento funciona como clip
       caption: string,        caption para TikTok, máximo 150 caracteres
       hashtags: string[],     entre 3 y 5
       score: number           0 a 100, confianza propia del modelo
     }]
   }

3. Manejo de transcripts largos: un stream de 4 horas no cabe en una sola
   petición. Divide en ventanas con solapamiento, selecciona por ventana, y
   luego deduplica candidatos que se solapen en el tiempo quedándote con el de
   mayor score. Documenta el tamaño de ventana que elegiste y por qué.

4. Validación de la salida del modelo, no confíes en ella:
   - start < end
   - duración entre 20 y 90 segundos (ajusta los límites por .env)
   - los timestamps caen dentro de la duración real del VOD
   - el texto del hook existe realmente en el transcript en esa ventana
   Descarta y registra en log lo que no valide, en vez de propagarlo.

5. Guarda en work/<sourceId>/clips.json y ordena por score descendente.

6. CLI: `npm run select -- <sourceId> --n 5`

Criterio de aceptación: ejecuta sobre el transcript de la Fase 1 y muéstrame los
5 clips elegidos con su start, end, hook y reason. Voy a evaluar la calidad de la
selección manualmente. Reporta también el costo en tokens de la ejecución.

No rendericis video todavía.
```

---

## Fase 3: Render vertical

Convierte los candidatos en MP4 publicables. Cierra la validación del concepto.

```
Lee tiktok-clipper/CONTEXT.md, con especial atención a la sección 6 (notas de
ffmpeg) y a la sección 5 (especificaciones de TikTok).

Objetivo: convertir cada clip de work/<sourceId>/clips.json en un MP4 vertical
1080x1920 con subtítulos quemados, listo para publicar sin retoque.

Implementa:

1. src/render/ass.ts
   Genera un archivo .ass a partir de los segmentos del transcript acotados al
   rango del clip, con timestamps rebasados a cero.
   Estilo: tipografía condensada de alto impacto, texto blanco, contorno negro
   grueso, posicionado en el tercio inferior pero por encima de la zona de la
   interfaz de TikTok. Máximo dos líneas simultáneas.
   Si la Fase 1 confirmó timestamps por palabra, implementa resaltado palabra por
   palabra. Si no, mantén segmentos cortos y no lo inventes.

2. src/render/vertical.ts
   Filtergraph de reencuadre 9:16 con fondo desenfocado. Punto de partida, que
   debes verificar y ajustar:

     [0:v]split=2[bg][fg];
     [bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=25[bgb];
     [fg]scale=1080:-2[fgs];
     [bgb][fgs]overlay=(W-w)/2:(H-h)/2[v1];
     [v1]ass=subs.ass[vout]

   Nunca recortes al hablante. El fondo desenfocado existe precisamente para
   evitarlo. No implementes seguimiento de cara en esta fase.

3. Audio: normaliza con loudnorm (EBU R128). Objetivo en torno a -14 LUFS.

4. Encode con h264_nvenc.
   VERIFICA los flags disponibles con `ffmpeg -h encoder=h264_nvenc` antes de
   escribirlos. Los nombres de preset cambiaron entre versiones mayores; no
   copies flags de tutoriales. Salida MP4, audio AAC, frame rate dentro del
   rango 23-60 que exige TikTok.

5. Corte: usa -ss y -to. Como igual se re-encodea, haz el corte preciso al frame.

6. Validación posterior al render, con ffprobe, contra las especificaciones de
   TikTok de CONTEXT.md sección 5: duración, resolución, fps, tamaño, códecs.
   Si un archivo no cumple, falla ruidosamente indicando qué parámetro falló.

7. CLI: `npm run render -- <sourceId>` que renderiza todos los clips a
   out/<sourceId>/clip-NN.mp4. Procesa en serie, no en paralelo: hay un solo
   chip NVENC y paralelizar no acelera.

Criterio de aceptación:
- Los 5 clips renderizados y validados por ffprobe.
- Repórtame el tiempo de render por clip.
- Genera un contact sheet (un frame de cada clip) para revisar el encuadre de un
  vistazo, y muéstramelo.

PUNTO DE DECISIÓN: al terminar, voy a revisar los clips. Si no son publicables tal
cual, el problema está en el prompt de la Fase 2, no aquí. No sigas a la Fase 4
sin mi confirmación explícita.
```

---

## Fase 4: Persistencia y panel de aprobación

Solo si la Fase 3 produjo clips publicables.

```
Lee tiktok-clipper/CONTEXT.md.

Contexto: las fases 0 a 3 producen clips publicables en local. Ahora hay que
persistir el estado y añadir una compuerta de aprobación humana, porque un clip
malo replicado en 20 cuentas es peor que no publicar nada.

Objetivo: Supabase como estado y storage, más un panel web para aprobar o
descartar clips.

Implementa:

1. Esquema en Supabase con migraciones versionadas. Tablas:
   - sources    VOD de origen: url, duración, estado de proceso
   - transcripts
   - clips      start, end, hook, reason, caption, hashtags, score,
                status (pending | approved | rejected)
   - renders    ruta o URL del archivo, checksum, metadatos de ffprobe
   Prefija todas las tablas para no colisionar con otros proyectos del mismo
   Supabase. Define RLS desde el inicio, no después.

2. src/db/: cliente tipado y funciones de acceso. Genera los tipos desde el
   esquema real, no los escribas a mano.

3. Sube los MP4 aprobados a Supabase Storage. Los no aprobados se quedan en
   local; no gastes almacenamiento en lo que se va a descartar.

4. Panel en web/ con Next.js:
   - Lista de clips pendientes con preview reproducible
   - Caption y hashtags editables antes de aprobar
   - Botones aprobar y descartar
   - Debe ser usable desde el teléfono. Voy a revisar clips desde el móvil.

5. Adapta el CLI de las fases anteriores para que escriba en la base de datos
   además de en el sistema de archivos. El sistema de archivos sigue siendo la
   fuente de verdad de los artefactos pesados; la base de datos lo es del estado.

Criterio de aceptación: procesa un VOD de punta a punta, aprueba dos clips desde
el panel en un teléfono, y verifica que quedaron en Storage con status approved.
Muéstrame capturas del panel.

No implementes publicación todavía.
```

---

## Fase 5: Variantes y cola de publicación

```
Lee tiktok-clipper/CONTEXT.md.

Objetivo: convertir un clip aprobado en 20 variantes diferenciadas y programarlas
en una cola con ventanas horarias distribuidas.

Por qué las variantes: el mismo MP4 en 20 cuentas se detecta por hash de contenido
y su alcance se ahoga. Publicar las 60 a la misma hora es la firma más obvia de una
red coordinada.

Implementa:

1. Tabla accounts: identificador, etiqueta, estado, franjas horarias asignadas,
   estado del token, última publicación exitosa.

2. src/variants/generate.ts
   Por cada par (clip, cuenta) produce una variante con parámetros aleatorios
   pero deterministas a partir de un seed derivado de clipId + accountId, para
   que el render sea reproducible:
   - zoom entre 1.00 y 1.08
   - velocidad entre 0.98 y 1.02 (ajusta video y audio de forma coherente)
   - variación leve de brillo, contraste y saturación
   - recorte de 0 a 400 ms al inicio, para cambiar el primer frame
   Los cambios deben ser imperceptibles para una persona y suficientes para
   cambiar el hash y las huellas perceptuales.

3. Variación de texto: para cada cuenta, reescribe caption y hashtags con la API
   de Claude manteniendo el sentido. Nada de rotar sinónimos con plantillas; se
   nota.

4. Tabla queue: clipId, accountId, variantId, scheduled_at, status
   (pending | publishing | published | failed), attempt_count, last_error.
   Debe ser idempotente: un fallo de token no puede generar bucles ni duplicados.

5. src/queue/schedule.ts
   Asigna a cada cuenta 3 franjas diarias con desviación aleatoria de más o menos
   40 minutos. Nunca dos cuentas publicando el mismo clip en la misma franja.
   Franjas configurables por .env.

6. CLI: `npm run variants -- <clipId>` y `npm run schedule -- --days 1`

Criterio de aceptación: toma un clip aprobado, genera las 20 variantes, y
muéstrame que los checksums son todos distintos y que ffprobe confirma que las 20
siguen cumpliendo las especificaciones de TikTok. Muéstrame el calendario
resultante de las 60 publicaciones del día.
```

---

## Fase 6: Publicación a TikTok

```
Lee tiktok-clipper/CONTEXT.md, sección 5, sobre los límites reales de TikTok.

Objetivo: publicar la cola en las 20 cuentas.

Restricción de diseño que manda sobre todo lo demás: la implementación arranca
sobre un proveedor de terceros que ya pasó la auditoría de TikTok, pero el sistema
debe poder migrar a una app propia auditada sin reescribirse.

Implementa:

1. src/publish/types.ts
   Una interfaz única:
     publish(accountId: string, videoPath: string, caption: string,
             hashtags: string[]): Promise<PublishResult>
   Todo el resto del sistema habla solo con esta interfaz. Nunca con el
   proveedor directamente.

2. src/publish/providers/
   Una implementación por proveedor. Empieza por uno de terceros.
   ANTES de elegir e integrar, verifica en su documentación actual: precio,
   cuántas cuentas de TikTok permite conectar, y cuántas publicaciones por cuenta
   por día admite el plan. Hay proveedores que aun conectando 20 cuentas solo
   dejan publicar en 3 por día, lo cual no nos sirve. No asumas límites: léelos y
   repórtamelos antes de escribir la integración.

3. src/publish/worker.ts
   - Lee de queue lo que tenga scheduled_at vencido y status pending
   - Publica respetando el techo de TikTok (6 peticiones por minuto por token)
   - Reintentos con backoff exponencial y tope de intentos
   - Si el proveedor devuelve un tiempo de espera, respétalo en vez de reintentar
     antes; reintentar solo consigue otro rechazo
   - Registra todo en la tabla posts

4. Salud por cuenta: registra estado del token y última publicación exitosa. Una
   cuenta con fallos repetidos sale automáticamente de la rotación en vez de
   seguir consumiendo clips.

5. Modo dry-run obligatorio: `--dry-run` recorre toda la cola y registra lo que
   haría sin llamar a la API. Es la única forma segura de probar esto.

Criterio de aceptación:
- Dry-run completo del día sin errores, mostrando el plan de las 60 publicaciones.
- Después, publicación real en UNA sola cuenta de prueba.
- No conectes las 20 cuentas hasta que la de prueba funcione varios días seguidos.
```

---

## Fase 7: Métricas y realimentación

```
Lee tiktok-clipper/CONTEXT.md.

Objetivo: cerrar el ciclo. Medir qué clips funcionan y usar esos datos para
mejorar la selección.

Implementa:

1. Recolección de métricas por publicación: vistas, likes, comentarios,
   compartidos, tiempo de visualización si el proveedor lo expone. Con especial
   atención a las vistas de las primeras 2 horas, que es la señal temprana que
   predice el alcance final.

2. Dashboard en el panel:
   - Rendimiento por cuenta, para detectar cuentas ahogadas
   - Rendimiento por clip, comparando el mismo clip a través de las 20 cuentas
   - Rendimiento por franja horaria
   - Correlación entre el score que asignó el modelo en la Fase 2 y las vistas
     reales. Esta es la métrica que dice si la selección automática sirve.

3. Realimentación: un job que toma los clips con mejor y peor rendimiento y
   construye un conjunto de ejemplos para inyectar en el prompt de selección de
   la Fase 2. Debe ser un cambio explícito y versionado del prompt, no un ajuste
   automático silencioso.

4. Alertas: cuenta con token caído, cuenta con alcance nulo sostenido, cola
   vacía sin VODs pendientes de procesar.

Criterio de aceptación: dashboard funcionando con datos reales de al menos una
semana, y un reporte de la correlación entre el score del modelo y las vistas
reales.
```

---

## Cómo usar estos prompts

1. Abre una sesión de Claude Code nueva **con el directorio `tiktok-clipper` como raíz**.
2. Pega el prompt de la fase completo, sin editar.
3. Al terminar, verifica los criterios de aceptación tú mismo. No des por buena una fase porque el agente diga que funciona.
4. Haz commit antes de pasar a la siguiente fase, para tener un punto de retorno.

Cada prompt es autocontenido y asume que el agente arranca sin memoria de las sesiones anteriores. Por eso todos empiezan mandando leer `CONTEXT.md`: ahí está el entorno ya verificado, y evita que cada sesión pierda tiempo re-descubriendo la máquina.
