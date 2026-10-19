-- Multicliente, cuentas y publicacion (Fase 7).
--
-- TODO ADITIVO: columnas nuevas con valor por defecto y una tabla nueva. No se
-- toca ningun dato. Para deshacerlo:
--
--   alter table accounts drop column if exists alias;
--   alter table accounts drop column if exists limite_diario;
--   alter table accounts drop column if exists ultimo_resultado;
--   alter table accounts drop column if exists ultimo_resultado_en;
--   alter table accounts drop column if exists ultimo_error;
--   alter table accounts drop column if exists plataformas;
--   alter table settings drop column if exists max_repeticiones;
--   alter table settings drop column if exists alertas_activas;
--   drop table if exists alertas;

-- Un nombre para personas ("Zoti fans") ademas del identificador (acc-07).
alter table accounts add column if not exists alias text not null default '';

-- Tope de publicaciones al dia de ESTA cuenta. null = el del horario general
-- (o el del perfil de su cliente).
alter table accounts add column if not exists limite_diario integer;
do $$ begin
  alter table accounts add constraint accounts_limite_diario_ok
    check (limite_diario is null or limite_diario between 1 and 10);
exception
  when duplicate_object then null;
end $$;

-- Lo ultimo que paso al publicar en ella: se enseña en la lista de cuentas.
alter table accounts add column if not exists ultimo_resultado text;
do $$ begin
  alter table accounts add constraint accounts_ultimo_resultado_ok
    check (ultimo_resultado is null or ultimo_resultado in ('ok', 'error'));
exception
  when duplicate_object then null;
end $$;
alter table accounts add column if not exists ultimo_resultado_en timestamptz;
alter table accounts add column if not exists ultimo_error text;

-- Donde publica cada cuenta. TikTok siempre; YouTube Shorts e Instagram Reels
-- solo si el perfil de upload-post los tiene conectados.
alter table accounts add column if not exists plataformas text[] not null default '{tiktok}';

-- Cuantas veces como mucho se publica el mismo clip, sumando todas las cuentas.
-- Publicar lo mismo en muchas cuentas es lo que TikTok castiga (docs/RIESGOS.md).
alter table settings add column if not exists max_repeticiones integer not null default 10;
do $$ begin
  alter table settings add constraint settings_max_repeticiones_ok
    check (max_repeticiones between 1 and 100);
exception
  when duplicate_object then null;
end $$;

-- Interruptor de las alertas. Los destinos (Telegram, correo) y sus claves
-- viven en el .env, nunca en la base.
alter table settings add column if not exists alertas_activas boolean not null default true;

-- Alertas enviadas: para no repetir la misma cada minuto. Una fila por
-- (tipo, clave); `enviada_en` es la ultima vez que salio.
create table if not exists alertas (
  owner_id   uuid not null references owners(id) on delete cascade,
  tipo       text not null,
  clave      text not null default '',
  texto      text not null default '',
  enviada_en timestamptz not null default now(),
  -- A donde llego: 'telegram', 'correo', las dos, o '' si no hay destino.
  canales    text not null default '',
  primary key (owner_id, tipo, clave)
);
