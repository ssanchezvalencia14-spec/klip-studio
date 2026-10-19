-- Usuarios, sesiones e intentos de acceso (Fase 2).
--
-- Sustituye a la llave en la direccion (?k=...). La llave quedaba en el
-- historial, en los registros y en los referrers, y no distinguia a nadie:
-- todo el que la tuviera era "el panel".
--
-- SOLO TABLAS NUEVAS. No toca ningun dato existente, asi que no hace falta
-- respaldo. Para deshacerlo:
--
--   drop table if exists sesiones;
--   drop table if exists intentos_acceso;
--   drop table if exists usuarios;

create table if not exists usuarios (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references owners(id) on delete cascade,
  -- Siempre en minusculas: el indice unico lo da por hecho.
  email          text not null,
  nombre         text not null default '',
  rol            text not null default 'operador',
  -- bcrypt. Nunca la contraseña.
  hash           text not null,
  activo         boolean not null default true,
  -- La puso el administrador al crearla o restablecerla: se pide cambiarla.
  debe_cambiar   boolean not null default false,
  creado_en      timestamptz not null default now(),
  ultimo_acceso  timestamptz
);

create unique index if not exists usuarios_email_idx on usuarios (lower(email));

do $$ begin
  alter table usuarios add constraint usuarios_rol_ok check (rol in ('admin', 'operador'));
exception
  when duplicate_object then null;
end $$;

-- Una fila por sesion abierta. Se guarda el hash del token, no el token: quien
-- lea esta tabla no puede hacerse pasar por nadie.
create table if not exists sesiones (
  id_hash      text primary key,
  usuario_id   uuid not null references usuarios(id) on delete cascade,
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null,
  renovada_en  timestamptz not null default now(),
  -- Para poder decir "sesion abierta desde un movil" sin guardar mas.
  agente       text not null default ''
);

create index if not exists sesiones_usuario_idx on sesiones (usuario_id);

-- Intentos fallidos, para frenar a quien prueba contraseñas.
-- `clave` es "ip:<ip>" o "email:<correo>". Se cuentan los de los ultimos
-- minutos; los viejos se borran solos al consultar.
create table if not exists intentos_acceso (
  id         bigserial primary key,
  clave      text not null,
  creado_en  timestamptz not null default now()
);

create index if not exists intentos_acceso_idx on intentos_acceso (clave, creado_en);
