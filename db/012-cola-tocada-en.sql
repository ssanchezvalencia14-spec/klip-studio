-- Cuando se toco por ultima vez cada envio de la cola.
--
-- Hace falta para rescatar los que se quedan a medias. Un envio pasa a
-- 'publishing' justo antes de subir y vuelve a 'pending' o 'published' al
-- acabar; si el proceso muere entremedias se queda ahi para siempre, porque el
-- publicador solo recoge 'pending' (a proposito, para no subir dos veces).
--
-- El 2026-10-09 habia dos encallados desde hacia cuatro dias, de cuando se
-- mataron los procesos duplicados del trabajador.
--
-- No vale `created_at` para esto: dice cuando se planifico el envio, no cuando
-- se empezo a subir. Un envio planificado hace una semana y cogido hace diez
-- segundos tiene created_at viejo, y rescatarlo lo subiria por duplicado justo
-- mientras se esta subiendo.
alter table queue add column if not exists updated_at timestamptz not null default now();

-- Los que ya estan encallados no tienen marca util: se les pone una antigua
-- para que el primer rescate los coja.
update queue set updated_at = created_at where status = 'publishing';

create index if not exists cola_encallados_idx on queue (owner_id, status, updated_at);
