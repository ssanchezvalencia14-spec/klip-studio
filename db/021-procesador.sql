-- El procesador (Fase 4): reintentos con espera, ajustes y estado del sistema.
--
-- TODO ADITIVO: columnas con valor por defecto y una tabla nueva. No se toca
-- ningun dato existente. Para deshacerlo:
--
--   alter table jobs drop column if exists reintentos;
--   alter table jobs drop column if exists no_antes_de;
--   alter table settings drop column if exists ytdlp_cookies;
--   alter table settings drop column if exists retencion_dias;
--   drop table if exists estado_sistema;

-- Reintentos de una tarea que fallo: cuantos lleva y cuando puede volver a
-- cogerse. Distinto de attempt_count, que cuenta las veces que se COGIO
-- (incluidas las que se perdieron porque el PC se apago).
alter table jobs add column if not exists reintentos integer not null default 0;
alter table jobs add column if not exists no_antes_de timestamptz;

-- Navegador del que yt-dlp toma las cookies ('' = ninguno). Se elige en
-- Ajustes, Sistema, y el trabajador se lo pasa a la descarga.
alter table settings add column if not exists ytdlp_cookies text not null default '';

do $$ begin
  alter table settings add constraint settings_ytdlp_cookies_ok
    check (ytdlp_cookies in ('', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'));
exception
  when duplicate_object then null;
end $$;

-- Dias que se guarda el video original despues de revisarlo entero (0 = siempre).
alter table settings add column if not exists retencion_dias integer not null default 0;

do $$ begin
  alter table settings add constraint settings_retencion_ok check (retencion_dias between 0 and 365);
exception
  when duplicate_object then null;
end $$;

-- Lo que el trabajador sabe del PC y el panel enseña: version de yt-dlp,
-- disco, ultima limpieza. Una fila por dato.
create table if not exists estado_sistema (
  owner_id        uuid not null references owners(id) on delete cascade,
  clave           text not null,
  valor           jsonb not null default '{}',
  actualizado_en  timestamptz not null default now(),
  primary key (owner_id, clave)
);
