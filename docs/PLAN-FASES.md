# KLIP studio — Prompt completo por fases para Claude Code

## Cómo usar este documento
Pega este archivo completo al inicio de la sesión con Claude Code y luego escribe: "Empieza por la Fase 0". Al terminar cada fase, revisa y responde "OK" para pasar a la siguiente. Si la sesión se reinicia, pega solo las Instrucciones globales y la fase que toca.

Orden de las fases: 0 Diagnóstico → 1 IA con `claude -p` → 2 Login → 3 Rediseño → 4 Estabilidad del worker → 5 Errores de lógica y textos → 6 Calidad de clips y edición → 7 Multicliente y publicación → 8 Seguridad, pruebas y cierre.

---

## Instrucciones globales

Eres el ingeniero principal de KLIP studio, un panel que descarga o recibe videos largos (entrevistas, streams, videos musicales), los transcribe, elige los mejores momentos con IA, renderiza clips verticales con subtítulos y los publica automáticamente repartidos entre varias cuentas de TikTok (vía upload-post). El panel está desplegado en Hostinger y el procesamiento (worker) corre hoy en mi PC con Windows.

Reglas de trabajo:
1. Trabaja SOLO en la fase que te indique. Al terminar cada fase: resumen de 5 líneas máximo, lista de archivos tocados, cómo probarlo, y espera mi "OK" antes de seguir.
2. Antes de cambiar nada, trabaja en una rama git nueva por fase (`fase-N-nombre`) y haz commits pequeños.
3. No rompas lo que ya funciona. Si una migración toca datos, haz respaldo y que sea reversible.
4. Nunca imprimas, loguees ni commitees secretos (claves, contraseñas, tokens). Todo va en `.env` y `.env.example` sin valores.
5. Textos de interfaz en español correcto, con tildes, tono simple y sin tecnicismos. Terminología única: "video" (lo que subo), "clip" (lo que sale), "cuenta", "cliente".
6. Los errores mostrados al usuario deben ser amigables, accionables y sin rutas de archivos ni nombres de usuario del sistema. El detalle técnico va en "Ver detalles" y en los logs.
7. Cada fase termina con criterios de aceptación verificados por ti (corre la app, prueba el flujo, adjunta evidencia).
8. Si encuentras algo que contradice este documento (otro stack, otra estructura), no improvises: dime qué encontraste y propón el ajuste.

---

## FASE 0 — Diagnóstico y respaldo (sin cambiar funcionalidad)

Objetivo: entender el proyecto real antes de tocarlo.

Tareas:
- Mapea el stack, la estructura de carpetas, cómo se ejecuta el worker (descarga con yt-dlp, transcripción, "elegir momentos", variantes, render) y cómo se comunica con el panel desplegado en Hostinger.
- Documenta en `docs/ARQUITECTURA.md`: componentes, flujo de datos, variables de entorno, dependencias externas (yt-dlp, ffmpeg, Whisper u otro, IA, upload-post) y dónde corre cada cosa (Hostinger vs. mi PC con Windows).
- Lista en `docs/DEUDA.md` los riesgos que encuentres (secretos en el repo, rutas absolutas de Windows, sin tests, sin límites de reintentos).
- Revisa que `.env` y archivos con secretos estén en `.gitignore`. Si hay secretos ya commiteados, avísame para rotarlos.
- Busca dónde se lee `ANTHROPIC_API_KEY` (archivos `.env` locales, globales o de paquetes, variables del sistema) y dime qué encuentras: es la causa probable del error 401 actual.
- Crea un script `scripts/check-health` que verifique: base de datos, ffmpeg, yt-dlp, IA, conexión con upload-post.

Aceptación: los dos documentos existen, el script corre y reporta el estado de cada pieza.

---

## FASE 1 — IA con Claude Code (`claude -p`) usando mi suscripción

Contexto: "Elegir momentos" falla con "la clave de Anthropic no vale (401)". Por ahora NO quiero usar la API de pago. Quiero que el worker, que corre en mi PC con Windows, llame a Claude Code en modo no interactivo (`claude -p`) con mi suscripción.

Requisitos y decisiones:
1. Proveedor `claude-cli` como proveedor PRINCIPAL en `llm/provider`, detrás de una interfaz única `elegirMomentos(transcripcion, opciones)`. Deja la estructura lista para añadir después un proveedor `anthropic-api` o `gemini` como respaldo sin tocar el resto del código.
2. Autenticación: el CLI debe usar mi sesión de suscripción (la que dejó `claude` tras iniciar sesión con `/login`). Al lanzar el proceso hijo, ELIMINA `ANTHROPIC_API_KEY` y las variables `ANTHROPIC_*` de su entorno: si existe, el CLI usa esa clave y reaparece el error 401.
3. Invocación (verifica los nombres exactos de las banderas con `claude --help` en mi versión, no los asumas):
   - Modo no interactivo (`-p`), salida en JSON (`--output-format json`), modelo configurable por `LLM_MODEL` (Sonnet como opción de calidad y Haiku para tareas simples).
   - Sin herramientas ni permisos: el CLI solo debe devolver texto (deshabilita herramientas y limita los turnos a 1 o 2). No debe leer ni escribir archivos de mi PC.
   - El prompt (instrucciones + transcripción) se envía por entrada estándar (stdin), no como argumento: en Windows los argumentos largos fallan.
   - Lanza el proceso con `child_process.spawn` (sin shell), con tiempo máximo (por ejemplo 180 s) y matándolo si se pasa.
   - Directorio de trabajo temporal y vacío para cada llamada.
4. Una sola llamada a la vez (cola serial, concurrencia 1). Las transcripciones largas se dividen en bloques con solape y se unifican los resultados.
5. Salida estructurada: pide JSON y valídalo con zod: `inicio`, `fin`, `titulo` (máx. 8 palabras, distinto de la primera frase), `gancho`, `puntaje_gancho`, `puntaje_cierre`, `puntaje_retencion`, `puntaje_total`, `motivo`. Si el JSON no valida, UN reintento enviando el error; si vuelve a fallar, falla limpio (sin bucle).
6. Límites de la suscripción: detecta cuando el CLI responde que alcancé el límite de uso o que no hay sesión. En ese caso:
   - NO reintentes en bucle.
   - Pon la tarea en estado `en_espera_ia` y pausa la cola de IA.
   - Reanuda sola cuando pase el tiempo indicado (si el mensaje trae una hora) o con un botón "Reintentar" en el panel.
   - Estados visibles para el usuario: "IA lista", "IA con límite, vuelve a las HH:MM", "IA sin sesión (abre Claude Code en tu PC y ejecuta /login)".
7. Ahorro de uso: caché por hash de la transcripción + parámetros, máximo 2 reintentos totales por tarea (hoy "Elegir momentos" corrió 28 veces) y un solo bloque de IA por video siempre que quepa.
8. Verificación de salud (`check-health` y botón "Probar IA" en Ajustes → IA): ejecuta una llamada mínima y reporta uno de estos estados: lista / sin sesión / límite / CLI no encontrado / tiempo agotado. Mensajes en español claro, sin rutas ni nombres de usuario de Windows.
9. Errores: agrupa los idénticos del mismo video en una sola tarjeta con contador ("falló 4 veces"), con "Reintentar" y "Descartar". Nunca muestres instrucciones de `.env` en la pantalla principal.
10. Variables: `LLM_PROVIDER=claude-cli`, `CLAUDE_CLI_PATH` (por defecto `claude` en el PATH), `LLM_MODEL`, `LLM_TIMEOUT_MS`. Nada de claves.
11. Documenta en `docs/IA.md`: cómo iniciar sesión (`claude` → `/login`), requisito de Node.js 22 LTS en mi PC, que el procesamiento solo funciona con mi PC encendida y el worker corriendo, y esta advertencia: el uso automatizado de la suscripción debe cumplir las condiciones de uso de Anthropic y sus límites; si deja de ser viable, el cambio es solo `LLM_PROVIDER=anthropic-api` con una clave nueva.
12. Registro de uso: guarda por tarea el tiempo, el modelo y el proveedor. El costo se muestra como "Incluido en la suscripción" (no calcules dólares para este proveedor).

Aceptación: con mi sesión iniciada, "Elegir momentos" funciona sobre un video real y devuelve JSON válido; con una `ANTHROPIC_API_KEY` mala puesta a propósito en el entorno del panel sigue funcionando; si simulo la falta de sesión o el límite, el panel muestra un solo aviso claro y la cola se pausa sin reintentar en bucle.

---

## FASE 2 — Reemplazar el acceso por llave (`?k=`) por usuario y contraseña

Contexto: hoy el panel se abre con un enlace con llave en la URL. Eso queda en historial, logs y referrers, y no sirve para varios usuarios.

Requisitos:
- Login con correo + contraseña. Usa el sistema de autenticación que ya tenga el stack (si usa Supabase, Supabase Auth con `@supabase/ssr`; si no, implementación propia). Decide según lo que encontraste en la Fase 0 y dime cuál elegiste y por qué.
- Sesión en cookie `httpOnly`, `Secure`, `SameSite=Lax`. Nada de tokens en localStorage ni en la URL.
- Sin registro público: solo entran usuarios creados por el administrador. Primer usuario = admin, creado con el script `scripts/crear-admin`.
- Roles básicos: `admin` (todo) y `operador` (revisar, aprobar, agenda; sin ajustes de cuentas ni IA).
- Contraseñas con argon2 o bcrypt si es implementación propia. Mínimo 10 caracteres.
- Protección contra fuerza bruta: límite de intentos por IP y por correo, y bloqueo temporal.
- Cerrar sesión, expiración de sesión (7 días con renovación) y recuperar contraseña por correo (o, si no hay correo configurado, reseteo por el admin).
- Proteger TODAS las rutas del panel y de la API con middleware. Las llamadas del worker al panel usan una clave de servicio aparte (`WORKER_TOKEN`) en cabecera, nunca la sesión de un usuario.
- Pantalla de login con el estilo del panel (oscuro, botón azul), mensajes de error genéricos ("Correo o contraseña incorrectos").
- Migración: mantén la llave antigua activa solo durante la transición con `LEGACY_KEY_ENABLED=true`. Cuando yo confirme que el login funciona, la desactivas y borras el código `?k=`.
- Recuérdame rotar la llave antigua porque se expuso en un chat.

Aceptación: no se puede ver ninguna pantalla ni endpoint sin sesión; el login, el cierre de sesión y el bloqueo por intentos funcionan; el worker sigue conectándose con su token.

---

## FASE 3 — Rediseño completo del panel: estética, animación y estructura

Objetivo: que cualquier persona sepa qué hacer sin explicación. Un solo flujo: Añadir → Procesar → Revisar → Publicar. Pantalla principal que dice "qué te toca ahora".

Antes de tocar nada: verifica el stack real (Fase 0) y reutiliza lo que ya exista (si es Next.js + Tailwind + shadcn/ui, quédate en eso). Trabaja en la rama `fase-3-rediseno`, pantalla por pantalla, un commit por pantalla, sin romper las rutas ni las API actuales. Si existe el diseño de referencia "KLIP studio rediseño" (5 pantallas), úsalo; si no, los tokens y la estructura de abajo son la fuente de verdad.

### Estructura de navegación (menú lateral)
1. Inicio — siguiente acción, flujo en 4 pasos con contadores, estado del sistema, añadir video rápido, actividad reciente.
2. Videos — añadir (enlace o MP4), tipo de video, campaña; lista de videos con progreso por etapa.
3. Revisar — cola de clips, vista previa vertical, puntaje, ajuste de inicio y fin, aprobar o descartar.
4. Agenda — calendario semanal de salidas y pestaña de resultados.
5. Cuentas — clientes con sus cuentas, estado por plataforma, plan.
6. Ajustes — pestañas: Estilo (antes "Marca y textos"), IA, Horarios, Sistema (antes "Historial"), Usuarios (solo admin).
Renombres: "Revisar que todo funcione" → "Probar el sistema"; "Elegir momentos / Variantes / Renderizar" se muestran como "Buscar momentos / Armar clips". Terminología única: video, clip, cuenta, cliente.

### Tokens de diseño (modo oscuro, único por ahora)
- Fondos: `#0B0C10` (app), `#0E1016` (menú), `#12141B` (tarjetas), `#181B24` (elevado). Bordes: `#252A36`, hover `#3A4258`.
- Texto: `#ECEEF4` principal, `#B3BACB` secundario, `#9BA3B5` apoyo (contraste mínimo 4.5:1 sobre las tarjetas).
- Acento: `#5B7CFF` (relleno), `#8FA5FF` y `#B9C6FF` (texto sobre oscuro), fondo suave `#1B2140`, tarjeta destacada `#151A2E` con borde `#2D3550`.
- Estados: éxito `#3DDC97`, aviso `#FFB454`, error `#FF7A7A`, cada uno con fondo oscuro tenue (`#12261E`, `#171510`, `#1A1111`).
- Tipografía: Sora (títulos y cifras grandes), DM Sans (texto), JetBrains Mono (tiempos, ids, atajos). Carga con `next/font` o equivalente.
- Radios: tarjetas 16 a 20 px, botones 10 a 14 px. Botones y campos de al menos 44 px de alto. Íconos SVG de trazo (lucide), sin emojis.
- Logo: que se lea como "KLIP" (hoy parece una "P"): marca con la K y el texto "KLIP studio".

### Movimiento (todo se apaga con `prefers-reduced-motion`)
- Entrada de tarjetas: subir 10 px y aparecer en 0.5 s, escalonado 40 a 80 ms.
- Punto verde que "respira" en "Procesador conectado" y en el paso activo.
- Barras de progreso con brillo recorriendo (shimmer) solo mientras hay trabajo en curso.
- Números que cuentan al cambiar (contadores del flujo).
- Cambio de pantalla con fundido corto (150 a 200 ms); nada de animaciones largas.
- Revisar: al aprobar o descartar, el clip muestra una insignia con "pop" y entra el siguiente.
- Esqueletos de carga en lugar de pantallas vacías; estados vacíos con una sola acción clara.
- Toasts pequeños para confirmaciones, con "Deshacer" durante 5 s al aprobar o descartar.

### Pantallas
- **Inicio:** cabecera con "+ Añadir video" y búsqueda (Ctrl K). Cuatro tarjetas del flujo (Procesando, Por revisar, Aprobados, En agenda). Tarjeta grande "Siguiente paso" que cambia según el estado: hay clips por revisar → "N clips esperan tu revisión" con miniaturas y "Revisar ahora"; no hay nada → "Añade un video para empezar"; la IA tiene límite → explica y ofrece "Reintentar". Estado del sistema (procesador, IA, TikTok). Avisos agrupados y descartables. Bloque de añadir video. Actividad reciente.
- **Videos:** formulario (pestañas Enlace / Subir MP4; tipo Entrevista, Stream o Video musical; campaña) y lista de tarjetas por video con 4 etapas (Descargar, Transcribir, Buscar momentos, Armar clips), barra por etapa, nota amigable y acciones (Cancelar, Ver detalles, Subir MP4, Revisar N clips). Filtros: Todos, En proceso, Listos, Con error. Actualización en vivo por SSE o sondeo cada 3 s.
- **Revisar:** tres zonas. Cola a la izquierda (miniatura, título, puntaje, estado), reproductor vertical al centro (el clip real con subtítulos), detalle a la derecha (rango, título editable, puntaje, motivo, línea de tiempo para ajustar inicio y fin, editar subtítulos). Botones grandes "Descartar (R)" y "Aprobar y siguiente (A)"; flechas navegan; barra espaciadora reproduce. Contadores pendientes, aprobados y descartados arriba.
- **Agenda:** pestañas Calendario y Resultados. Tarjetas: salidas de la semana, clips aprobados frente a los recomendados, cuentas que publican. Rejilla semanal con chips (hora, cuenta, clip). En Resultados: vistas, likes y comentarios por clip y por cuenta, tabla ordenable. Estado vacío con la acción "Aprobar clips".
- **Cuentas:** tarjetas por plataforma (TikTok conectado; Shorts y Reels "Próximamente"), medidor "N de M cuentas enlazadas" (lee el plan de la configuración, nunca un número fijo), búsqueda y filtros (Todas, Publican, Falta enlazar), grupos por cliente con acciones en lote (Pausar todas, Comprobar todas, Asignar en lote) y la caja "Sin cliente".
- **Ajustes:** misma estética. Estilo incluye vista previa real del clip (fotograma verdadero con subtítulos y zona segura de TikTok); IA muestra proveedor, estado y botón "Probar IA"; Horarios mantiene las reglas anti-repetición con el cálculo explicado; Sistema muestra historial, uso y salud.

### Reglas técnicas
- Componentes reutilizables: `AppShell`, `NavItem`, `StatCard`, `StepCard`, `VideoCard`, `ClipCard`, `AccountRow`, `StatusChip`, `EmptyState`, `Toast`. Tokens en variables CSS o config de Tailwind, no colores sueltos.
- Responsive: debe funcionar bien en móvil (subo videos desde el celular). El menú pasa a barra inferior de 5 íconos con "Ajustes" dentro de un menú; en Revisar las columnas se apilan (reproductor arriba, botones fijos abajo).
- Accesibilidad: `<button>` y `<a>` reales, foco visible, etiquetas en los íconos (también los de la barra superior), contraste AA, no depender solo del color para el estado, atajos de teclado que no choquen con campos de texto.
- Rendimiento: miniaturas ligeras, listas virtualizadas si hay muchas cuentas o clips, nada de bloqueos por animación.
- Textos en español con tildes y plurales correctos ("1 video", "5 videos"). Ningún error técnico, ruta ni nombre de usuario de Windows en pantalla.
- El login (Fase 2) y las rutas protegidas no se rompen.

Aceptación: las 6 secciones existen con el nuevo estilo; el flujo completo Añadir → Procesar → Revisar → Agenda se hace sin leer instrucciones; en Revisar se aprueba con A y se descarta con R; funciona en móvil; con "reducir movimiento" no hay animaciones; ninguna pantalla muestra un error técnico crudo. Entrégame capturas de cada pantalla en escritorio y móvil.

---

## FASE 4 — Estabilidad del worker y de las descargas

Tareas:
- Worker con latido (heartbeat) cada 30 s. El panel muestra "Procesador conectado / desconectado" en el menú e Inicio, y avisa si lleva más de 5 minutos caído.
- Cola de tareas con estados (en cola, procesando, en espera de IA, falló, listo), reintentos con espera creciente (máximo 2) y reanudación si el worker se reinicia a mitad de una tarea.
- Descarga de YouTube: si yt-dlp falla por "Sign in to confirm you're not a bot", muestra "YouTube bloqueó la descarga. Sube el MP4 directamente o configura las cookies" y deja la subida de MP4 como camino principal e igual de visible. Añade en Ajustes (admin) la opción de usar cookies del navegador para yt-dlp y una comprobación semanal de actualización de yt-dlp.
- Quita de la interfaz cualquier ruta absoluta o nombre de usuario de Windows. Sustituye `C:\Users\...` por rutas relativas o variables en el código.
- Reemplaza rutas fijas por configuración (`YT_DLP_PATH`, `FFMPEG_PATH`, `CLAUDE_CLI_PATH`) para que el worker pueda moverse luego a un VPS. Deja una guía en `docs/MIGRAR_WORKER.md` (y un `Dockerfile` si aplica; recuerda que `claude -p` con suscripción requiere sesión iniciada en esa máquina).
- Retención de almacenamiento: borra el video original tras N días configurables y comprime las salidas (hoy unos 28 MB por clip). Aviso cuando el disco supere el 80%.

Aceptación: apago el worker y el panel lo muestra; fuerzo un fallo de descarga y el mensaje es claro; las tareas fallidas reintentan y se reanudan.

---

## FASE 5 — Corrección de errores de lógica y de textos

Corrige cada punto y añade una prueba para cada uno:
1. Hashtags: eliminar duplicados (sin distinguir mayúsculas), máximo 5, cortar siempre por hashtag completo (hoy sale "#TikT" truncado y #MúsicaColombiana tres veces).
2. Cálculo de "videos distintos que necesitas por día" en Horarios: debe considerar publicaciones por cuenta, cuentas activas, espera para repetir en la misma cuenta (3 días) y en otra cuenta (hora y media). Muestra la fórmula en el "¿Por qué?". Con 3 publicaciones al día por cuenta y 3 días de espera, una cuenta necesita unos 9 clips distintos.
3. Subtítulos: el ajuste dice "3 palabras" pero los clips muestran 6 a 8. Haz que el renderizador respete el ajuste y que cambiar el ajuste permita "Volver a renderizar" los clips pendientes.
4. Zona segura: el subtítulo no debe quedar en el 20% inferior (lo tapa la interfaz de TikTok). Súbelo y hazlo configurable.
5. Vista previa de Estilo: arreglar que salga en negro y mostrar un fotograma real del clip con los subtítulos aplicados.
6. Resultados: no pedir "Enlaza una cuenta" si ya hay cuentas conectadas; decir "Aún no se ha publicado nada".
7. Plurales y concordancia ("1 video", "5 videos"), tildes y ñ en toda la interfaz (aqui, Todavia, publicacion, Que, Cuanto, etc.) y terminología unificada.
8. Los números de Inicio ("se repartirán entre tus 2 cuentas") deben usar las cuentas realmente activas y conectadas, no el total de 20.

Aceptación: las pruebas pasan y reviso las pantallas una por una.

---

## FASE 6 — Calidad de los clips y edición

1. Puntaje explicable: en cada clip de Revisar mostrar el desglose (gancho, cierre, retención) y el motivo en una línea. Ordenar por puntaje total.
2. Títulos y gancho: título corto (máx. 8 palabras) distinto de la primera frase transcrita, y un texto de gancho opcional arriba del video (hoy "Sin rótulo"). Penalizar clips que empiezan con muletillas ("Sí.", "Eh", "O sea").
3. Duración: preferir 20 a 60 s; avisar cuando un clip supera 60 s.
4. Reencuadre vertical: detección de rostro con seguimiento y recorte dinámico (MediaPipe u OpenCV) en vez de video centrado con fondo borroso. Con dos personas, seguir a quien habla. Mantener el fondo borroso como "Modo clásico".
5. Editor ligero por clip: ajustar inicio y fin con una línea de tiempo, editar el texto de los subtítulos y cambiar el título. Re-renderiza solo ese clip.
6. Aprobación en lote: seleccionar varios, aprobar o descartar, y atajos de teclado (A, R, flechas).
7. Modo de video al añadirlo: "Entrevista / Stream" o "Video musical". Para música:
   - Separar la voz con Demucs antes de transcribir la letra.
   - Detectar estribillo, drops y picos de energía con análisis de audio (librosa) y puntuar por eso, no solo por la transcripción.
   - Subtítulos con la letra solo cuando la transcripción tenga confianza suficiente.
   - Aviso visible: "Música con derechos de autor puede ser bloqueada o silenciada por las plataformas".

Aceptación: pruebo con una entrevista y un video musical y los clips muestran puntajes, títulos distintos y recorte con seguimiento.

---

## FASE 7 — Multicliente, cuentas y publicación

1. Modelo de datos: clientes → campañas → cuentas, con estado, límites diarios y último resultado por cuenta. Pasa de la lista plana acc-01…acc-20 a una lista agrupada por cliente, con búsqueda, alias, filtros y acciones en lote (pausar, activar, mover de cliente).
2. Diseñado para 1 a N cuentas: con pocas cuentas el panel no debe mostrar vacíos ni avisos de "faltan cuentas". Los topes del plan se leen de configuración, no se asumen 20 ni 25.
3. Alertas: notificación por Telegram o correo cuando falle un token de TikTok, se acabe la cola de clips aprobados, falle una publicación, el worker se desconecte o la IA llegue al límite.
4. Resultados: traer desde la plataforma vistas, likes y comentarios por clip y por cuenta, con tabla ordenable y resumen semanal.
5. Anti-spam y cumplimiento: mantener las esperas y el desfase de horas, y añadir variación real de la descripción por cuenta. Documenta en `docs/RIESGOS.md` que publicar el mismo contenido en muchas cuentas puede ir contra las normas de TikTok y causar bloqueos, y añade un límite máximo de repeticiones por clip. Si los videos fuente son de terceros, avisa de la necesidad de permiso o licencia.
6. YouTube Shorts e Instagram Reels: implementar la publicación si el proveedor lo soporta; si no, dejar el estado "Próximamente" y la interfaz lista.
7. Revisión del plan: mostrar cuántas cuentas están realmente enlazadas frente a las que se pagan, para evitar pagar de más.

Aceptación: creo un cliente nuevo con 3 cuentas, apruebo clips y la agenda se reparte correctamente; fuerzo un fallo y llega la alerta.

---

## FASE 8 — Seguridad, pruebas y cierre

- Seguridad: cabeceras (CSP, HSTS, X-Frame-Options), rate limiting en la API, validación de entradas, enlaces de descarga firmados y con caducidad, y registro de auditoría (quién aprobó o publicó qué).
- Respaldos automáticos diarios de la base de datos.
- Pruebas: unitarias de la lógica (hashtags, cálculos de horarios, repartos, parser de la salida de la IA) y una prueba de extremo a extremo: subir MP4 → transcribir → buscar momentos → revisar → aprobar → agenda.
- Documentación: `README.md` con instalación, variables de entorno, cómo arrancar panel y worker, cómo iniciar sesión en Claude Code para la IA y cómo rotar claves.
- Checklist final de salida a producción y lista de tareas pendientes.

Aceptación: el flujo completo pasa en limpio, `check-health` sale en verde y no queda ninguna ruta, clave o error técnico visible en la interfaz.
