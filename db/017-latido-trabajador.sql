-- Saber si el ordenador que hace el trabajo esta escuchando.
--
-- EL PROBLEMA QUE RESUELVE. El panel desplegado en Hostinger no puede
-- descargar ni renderizar: no tiene yt-dlp, ni ffmpeg, ni tarjeta grafica. Eso
-- nunca fue un impedimento, porque quien ejecuta es el PC de casa: el panel
-- solo ESCRIBE la tarea en la tabla `jobs` y el trabajador la recoge cuando
-- pregunta. Es el PC quien pregunta, no el servidor quien llama.
--
-- Pero el servidor no tenia forma de saber si ese PC estaba encendido. Sin
-- saberlo solo quedaban dos opciones, las dos malas: negarse a encolar (que es
-- lo que hacia, y por eso no se podia procesar un VOD desde el movil) o
-- aceptar en silencio tareas que quiza no recoja nadie en tres dias.
--
-- Con un latido hay una tercera: encolar SIEMPRE, y decir al momento si hay
-- alguien al otro lado. Si lo hay, el video se procesa aunque la orden venga
-- desde el telefono. Si no lo hay, la tarea espera y el panel lo dice en vez
-- de fingir que pasa algo.
create table if not exists trabajadores (
  -- hostname-pid, el mismo identificador con el que coge las tareas.
  id         text not null,
  owner_id   uuid not null references owners(id) on delete cascade,
  visto_en   timestamptz not null default now(),
  primary key (owner_id, id)
);

-- Para la consulta de "hay alguno vivo", que es la unica que se hace.
create index if not exists trabajadores_visto_idx
  on trabajadores (owner_id, visto_en desc);
