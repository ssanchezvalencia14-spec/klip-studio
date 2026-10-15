-- La salida de cada tarea, para que el panel pueda enseñarla.
--
-- No estaba en el esquema inicial porque entonces el panel y el trabajo vivian
-- en el mismo proceso: las lineas se guardaban en memoria y ya. Con el trabajo
-- en otra maquina, la unica forma de que el panel vea lo que esta pasando es
-- que el trabajador lo escriba aqui.
--
-- Se guarda como texto y RECORTADO a las ultimas lineas, no entero. Un ingest
-- de dos horas emite miles de lineas de porcentaje de descarga; guardarlas
-- todas llenaria el medio giga del plan gratuito con ruido. Cuando algo falla,
-- lo que importa esta al final.
alter table jobs add column if not exists log text not null default '';

-- Cuantas veces se ha intentado. Una tarea que el trabajador cogio y dejo a
-- medias (porque se apago el PC) vuelve a la cola, pero no infinitas veces.
alter table jobs add column if not exists attempt_count integer not null default 0;
