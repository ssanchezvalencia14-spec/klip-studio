-- Como se cortan los videos.
--
-- Vive en la misma fila que los ajustes de publicacion porque es el mismo
-- propietario y la fila ya existe, pero se lee y se guarda POR SEPARADO. La
-- razon no es de estilo: cada guardado de /api/settings recalcula las franjas
-- horarias de las 20 cuentas. Cambiar la duracion de un clip no tiene por que
-- mover ningun horario.
--
-- Los valores por defecto son exactamente los que ya estaban escritos en el
-- codigo (scripts/select.ts y select/window.ts), asi que un propietario sin
-- estas columnas corta igual que siempre.
alter table settings add column if not exists clip_min_sec     integer not null default 20;
alter table settings add column if not exists clip_max_sec     integer not null default 90;
alter table settings add column if not exists clips_per_window integer not null default 3;
alter table settings add column if not exists window_sec       integer not null default 900;

-- Booleana de verdad y no un 0/1: la columna la lee una persona con psql
-- cuando algo va mal, y `subtitles = true` no necesita explicacion.
alter table settings add column if not exists subtitles        boolean not null default true;
