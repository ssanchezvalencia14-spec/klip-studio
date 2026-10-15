# Operacion diaria

Lo que hay que ejecutar, desde que entra un VOD hasta que sale publicado.
Todo esto corre en **el ordenador con tarjeta grafica**, no en el servidor.

Estado al 2026-10-01:

    8 cuentas enlazadas con TikTok (acc-01..acc-08), todas del cliente ZOTI
    14 clips aprobados, 38 por revisar
    110 publicaciones repartidas en la cola, 13 por cuenta
    112 variantes generadas

---

## El trabajador: lo unico que no puede faltar

El panel ENCOLA tareas; quien las ejecuta es el trabajador de este ordenador.
Sin el, todo lo que suba el equipo se queda en "esperando" para siempre.

Ya esta como **tarea programada de Windows**: arranca al iniciar sesion, se
repite cada 5 minutos por si murio, y se levanta sola. No hay que hacer nada.

    Comprobar:   Get-ScheduledTask -TaskName 'KLIP trabajador'
    Arrancar:    Start-ScheduledTask -TaskName 'KLIP trabajador'
    Quitarla:    Unregister-ScheduledTask -TaskName 'KLIP trabajador'

**El estado sano es `Running`, no `Ready`.** El lanzador espera a que el bucle
termine, asi que mientras el trabajador vive la tarea figura en ejecucion. Eso
es lo que hace efectiva la politica `IgnoreNew` y evita que cada repeticion
arranque otro trabajador encima.

Si alguna vez el panel avisa de que nadie recoge una tarea, mira ahi.

### Donde mirar cuando no arranca

    logs\trabajador.log
    logs\publicador.log

Las dos tareas corren sin ventana, asi que **el registro es el unico sitio donde
se ve lo que pasa**. Sin el, un trabajador que no arranca es completamente mudo:
la tarea figura en ejecucion, no hay ventana que mirar, y los trabajos se quedan
en la cola sin que nada lo diga.

Dos cosas que ya han fallado y conviene reconocer:

- **Se acumulaban trabajadores.** El lanzador no esperaba al bucle, asi que la
  tarea se daba por terminada y a los cinco minutos arrancaba otro. Llegaron a
  ser once a la vez. Si vuelves a ver mas de un `wscript.exe`, es esto.
- **La ruta del lanzador quedo mal al reescribir la tarea.** La tarea figuraba
  en ejecucion y no hacia nada. Se detecta mirando que la ruta sea real:

      (Get-ScheduledTask -TaskName 'KLIP trabajador').Actions[0].Arguments

### Comprobarlo de verdad

El estado de la tarea no basta. Lo unico concluyente es encolar algo y ver si
alguien lo recoge: desde el panel, en Ajustes > Historial, pulsa "Revisar que
todo funciona" y mira si pasa de "esperando" a "listo" en unos segundos.

---

## El ciclo completo

### 1. Entra un VOD

Desde el panel LOCAL (`npm run review`), en Inicio: pega el enlace o arrastra
el archivo, eligiendo antes la campaña en el desplegable.

O por linea de comando:

    npm run ingest -- <url-o-ruta>

Descarga, extrae el audio y transcribe. Es el paso mas lento: unos 6 minutos
por hora de video.

### 2. Elegir momentos

**Material hablado** (entrevistas, directos). Usa la API de Anthropic y cuesta
dinero:

    npm run select -- <sourceId>

Si se agota el saldo, la tarea FALLA de forma visible en el panel. No se queda
en 'listo' con cero clips, que es lo que hacia antes.

**Musica.** No toca la API: mide densidad de voz y propone los tramos con mas
letra, separados entre si.

    npm run momentos -- <sourceId> --cuantos 3     enseña la propuesta
    npm run momentos -- <sourceId> --aplicar       la deja anotada

Sin `--aplicar` solo imprime la tabla: mirarla antes de gastar GPU es lo que
evita renderizar cortes malos. Con `--aplicar` escribe el mismo `clips.json`
que produce `select`, asi que el resto del flujo sigue igual.

Los textos de publicacion salen del titulo del VOD, porque esta herramienta no
llama a ningun modelo y no puede inventar un gancho. Se editan al revisar.

### 3. Renderizar

    npm run render -- <sourceId>

Clips verticales 1080x1920 con subtitulos quemados. Para subtitulos al ritmo
del habla:

    npm run render -- <sourceId> --sub-words 3 --sub-animate

### 4. Subir las copias para revisar

    npm run subir -- <sourceId>

Sin esto el equipo no puede ver los clips desde el movil: el panel remoto no
tiene los archivos.

### 5. El equipo revisa

En el panel, seccion **Revisar videos**. Aprobar o descartar.

### 6. Una copia por cuenta

    npm run variants -- <sourceId>

Ocho copias distintas de cada clip aprobado (zoom, velocidad y recorte
ligeramente distintos) para que ocho perfiles no suban el mismo archivo.

**Solo genera para las cuentas enlazadas**, no para las veinte creadas.

### 7. Repartir

    npm run schedule -- <sourceId> --days 3

IMPORTANTE: una sola pasada por VOD. Cada pasada llena la ventana con los clips
de ESE VOD, asi que lanzarla cinco veces seguidas con un clip cada una hace que
cada cuenta repita el mismo video. El indice unico de la cola evita el
duplicado real, pero el reparto sale peor.

### 8. Publicar

    PUBLISH_MODE=draft npm run publish -- --live

O dejarlo corriendo solo:

    npm run worker

---

## El modo de publicacion importa

Mientras TikTok no apruebe la aplicacion:

    --mode direct   RECHAZADO: unaudited_client_can_only_post_to_private_accounts
    --mode draft    FUNCIONA: llega a la bandeja de entrada del movil

Con `draft`, el titular recibe una notificacion en la app, la toca y publica
eligiendo sonido y portada. **No aparece en Borradores ni en el perfil**: es una
notificacion en la bandeja de entrada.

Conviene poner en el `.env`:

    PUBLISH_PROVIDER=tiktok
    PUBLISH_MODE=draft

---

## Estadisticas

El codigo esta listo (`src/metrics/providers/tiktokMetrics.ts`) pero **todavia
no puede leer nada**, y no es un fallo de programacion:

Leer vistas y likes exige el permiso **`video.list`**, que no esta entre los
tres que piden las autorizaciones actuales. Los permisos no se amplian solos:
hay que

1. Añadir `video.list` en los scopes de la app, en el portal de TikTok.
2. Volver a autorizar las ocho cuentas (un enlace por cuenta).

Hasta entonces, `npm run metrics -- --collect` no devolvera lecturas.

Ademas, solo hay cifras de lo que se ha PUBLICADO. Un clip que sigue esperando
en la bandeja de entrada no existe como publicacion y no tiene estadisticas.

---

## Limites que conviene recordar

- **Sandbox de TikTok: 10 cuentas.** Hasta pasar la auditoria.
- **Bandeja llena**: si se acumulan videos sin publicar, TikTok bloquea los
  siguientes con `spam_risk_too_many_pending_share`. Se arregla publicando o
  descartando desde el movil.
- **Supabase gratuito: 1 GB** para las copias de revision. Una copia ronda los
  6 MB, asi que caben unas 170. El panel avisa al 70%. Para liberar sitio:

        npm run limpiar              enseña cuanto se puede liberar
        npm run limpiar -- --aplicar lo borra

  Solo toca las copias de clips DESCARTADOS o ya PUBLICADOS. Los masters nunca:
  siguen en este ordenador y son los que se suben a TikTok.
- **El panel remoto no ejecuta tareas.** Si alguien pulsa "Descargar y
  transcribir" alli, recibe un aviso explicando que eso corre en el otro
  ordenador.

---

## Diagnostico rapido

| Comando | Para que |
|---|---|
| `npm run tiktok -- estado` | Que cuentas estan enlazadas |
| `npm run tiktok -- revisar` | Preguntar a TikTok por cada perfil |
| `npm run tiktok -- subidas` | Que fue de cada video entregado |
| `npm run publish -- --dry-run` | Ensayar la pasada sin publicar |
| `npm run doctor` | Comprobar binarios y entorno |
