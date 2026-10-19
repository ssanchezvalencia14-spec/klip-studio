-- Registro de auditoria (Fase 8): quien aprobo, publico o cambio que.
--
-- TODO ADITIVO: una tabla nueva. No se toca ningun dato. Para deshacerlo:
--
--   drop table if exists auditoria;

create table if not exists auditoria (
  id       bigserial primary key,
  owner_id uuid not null references owners(id) on delete cascade,
  -- Correo del usuario, o 'procesador' para lo que hace el trabajador solo.
  quien    text not null,
  -- Frase legible: "aprobó un clip", "lanzó la publicación"...
  accion   text not null,
  -- Metodo y ruta, para el detalle.
  ruta     text not null default '',
  -- El cuerpo de la peticion SIN secretos (contraseñas, claves, tokens).
  detalle  jsonb,
  -- Codigo HTTP de la respuesta: tambien se anota lo que se rechazo.
  estado   integer not null default 200,
  en       timestamptz not null default now()
);

create index if not exists auditoria_en_idx on auditoria (owner_id, en desc);
