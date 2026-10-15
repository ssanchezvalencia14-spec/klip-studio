-- Esquema inicial de Clipline.
--
-- Sustituye a los ficheros JSON de state/. Aquellos funcionaban con un solo
-- proceso en un solo ordenador; en cuanto el panel vive en un servidor y el
-- trabajo pesado en otra maquina, dos procesos escriben a la vez y un fichero
-- JSON se pisa sin avisar.
--
-- TODAS LAS TABLAS LLEVAN owner_id DESDE EL PRIMER DIA.
-- Hoy hay un unico propietario y nadie lo nota. El dia que esto se venda a
-- terceros, no hay que migrar datos ni reescribir consultas: solo dejar de
-- rellenarlo con el valor por defecto. Añadir esta columna despues, con datos
-- dentro, es una migracion dolorosa; ponerla ahora no cuesta nada.

-- Sin "create extension pgcrypto": desde Postgres 13, gen_random_uuid() viene
-- en el nucleo. Pedir la extension fallaba en entornos que no la traen cargada
-- y no aportaba nada, porque es la unica funcion suya que se usa aqui.

-- ---------------------------------------------------------------------------
-- Propietarios
-- ---------------------------------------------------------------------------

create table if not exists owners (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  label       text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Videos de origen
-- ---------------------------------------------------------------------------

create table if not exists sources (
  id            text primary key,              -- el sourceId de siempre
  owner_id      uuid not null references owners(id) on delete cascade,
  title         text not null,
  url           text,
  duration_sec  integer not null default 0,
  -- Donde vive el video. En local es una ruta; en el servidor, una clave de
  -- almacenamiento. El resto del programa no necesita saber cual de las dos es.
  video_path    text,
  has_transcript boolean not null default false,
  segments      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sources_owner_idx on sources (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Cuentas de publicacion
-- ---------------------------------------------------------------------------

create table if not exists accounts (
  id            text not null,
  owner_id      uuid not null references owners(id) on delete cascade,
  label         text not null,
  status        text not null default 'active'
                check (status in ('active', 'paused', 'error')),
  -- Horas ancla del dia, una por publicacion diaria. Se guardan como numeros
  -- con decimales porque 14.333 significa las 14:20.
  slots         double precision[] not null default '{}',
  token_status  text not null default 'unknown'
                check (token_status in ('ok', 'expired', 'unknown')),
  last_published_at timestamptz,
  primary key (owner_id, id)
);

-- ---------------------------------------------------------------------------
-- Clips
-- ---------------------------------------------------------------------------

create table if not exists clips (
  owner_id     uuid not null references owners(id) on delete cascade,
  source_id    text not null references sources(id) on delete cascade,
  clip_id      text not null,
  start_sec    double precision not null,
  end_sec      double precision not null,
  hook         text not null default '',
  reason       text not null default '',
  caption      text not null default '',
  hashtags     text[] not null default '{}',
  score        integer not null default 0,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  master_path  text not null default '',
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  primary key (owner_id, source_id, clip_id)
);

-- La compuerta de aprobacion se consulta en cada carga del panel y es la
-- pantalla que mas se usa, asi que el orden por nota va en el indice.
create index if not exists clips_revision_idx
  on clips (owner_id, status, score desc);

-- ---------------------------------------------------------------------------
-- Cola de envios
-- ---------------------------------------------------------------------------

create table if not exists queue (
  id            text primary key,
  owner_id      uuid not null references owners(id) on delete cascade,
  source_id     text not null,
  clip_id       text not null,
  account_id    text not null,
  variant_path  text not null,
  checksum      text not null,
  params        jsonb not null default '{}',
  caption       text not null default '',
  hashtags      text[] not null default '{}',
  scheduled_at  timestamptz not null,
  status        text not null default 'pending'
                check (status in ('pending', 'publishing', 'published', 'failed')),
  -- Reintentos y ultimo fallo. Sin esto, un envio que falla se reintenta para
  -- siempre y nadie sabe por que fallaba.
  attempt_count integer not null default 0,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- El trabajador pregunta constantemente "que toca publicar ya". Sin este
-- indice esa consulta recorre la cola entera cada vez.
create index if not exists queue_vencidos_idx
  on queue (owner_id, status, scheduled_at);

-- Dos variantes identicas en la misma cuenta serian el mismo archivo subido
-- dos veces, que es justo lo que las variantes existen para evitar.
create unique index if not exists queue_sin_repetir_idx
  on queue (owner_id, account_id, checksum);

-- ---------------------------------------------------------------------------
-- Publicaciones y metricas
-- ---------------------------------------------------------------------------

create table if not exists posts (
  id             text primary key,
  owner_id       uuid not null references owners(id) on delete cascade,
  queue_item_id  text not null,
  source_id      text not null,
  clip_id        text not null,
  account_id     text not null,
  external_id    text not null,
  provider       text not null,
  mode           text not null check (mode in ('direct', 'draft')),
  published_at   timestamptz not null
);

create index if not exists posts_owner_idx on posts (owner_id, published_at desc);

create table if not exists metrics (
  id           text primary key,
  owner_id     uuid not null references owners(id) on delete cascade,
  post_id      text not null references posts(id) on delete cascade,
  external_id  text not null,
  account_id   text not null,
  clip_id      text not null,
  captured_at  timestamptz not null,
  age_hours    double precision not null default 0,
  views        integer not null default 0,
  likes        integer not null default 0,
  comments     integer not null default 0
);

create index if not exists metrics_post_idx on metrics (post_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Diario de tareas
-- ---------------------------------------------------------------------------

create table if not exists runs (
  id           text primary key,
  owner_id     uuid not null references owners(id) on delete cascade,
  kind         text not null,
  source_id    text,
  label        text not null,
  started_at   timestamptz not null,
  ended_at     timestamptz,
  duration_ms  integer not null default 0,
  status       text not null check (status in ('ok', 'error')),
  input        jsonb not null default '{}',
  output       jsonb not null default '{}',
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd     numeric(10, 4) not null default 0,
  error        text
);

create index if not exists runs_owner_idx on runs (owner_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Ajustes de flujo
-- ---------------------------------------------------------------------------

-- Una fila por propietario. Los valores por defecto son los que estaban
-- escritos en el codigo antes de que esto fuera configurable.
create table if not exists settings (
  owner_id              uuid primary key references owners(id) on delete cascade,
  accounts              integer not null default 20,
  posts_per_day         integer not null default 3,
  day_start_hour        integer not null default 10,
  day_end_hour          integer not null default 23,
  jitter_minutes        integer not null default 40,
  clip_cooldown_minutes integer not null default 90,
  account_repeat_hours  integer not null default 72,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tareas para el trabajador
-- ---------------------------------------------------------------------------

-- El panel vive en un servidor sin tarjeta grafica y el PC tiene la GPU. Esta
-- tabla es el punto de encuentro: el panel apunta lo que hay que hacer y el PC
-- pregunta cada pocos segundos si le toca algo.
--
-- Se hace asi, y no al reves, para que el PC no necesite ser accesible desde
-- fuera. No hay que abrir puertos en casa ni depender de una IP que cambia.
create table if not exists jobs (
  id           text primary key,
  owner_id     uuid not null references owners(id) on delete cascade,
  kind         text not null,
  args         text[] not null default '{}',
  label        text not null,
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'ok', 'error', 'cancelled')),
  -- Quien lo cogio. Sirve para detectar tareas que se quedaron a medias porque
  -- el PC se apago: siguen en 'running' y nadie las toca.
  claimed_by   text,
  claimed_at   timestamptz,
  heartbeat_at timestamptz,
  last_line    text not null default '',
  exit_code    integer,
  created_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create index if not exists jobs_pendientes_idx
  on jobs (owner_id, status, created_at);
