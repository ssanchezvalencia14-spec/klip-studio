-- Estilo de los subtitulos y plantillas reutilizables.

-- ---------------------------------------------------------------------------
-- Estilo de los subtitulos
-- ---------------------------------------------------------------------------
--
-- Tres columnas y no un jsonb: son las tres perillas que existen de verdad en
-- el generador de .ass (render/ass.ts), y tenerlas como columnas permite que
-- una plantilla las copie con un insert ... select en vez de a mano.
--
-- Los valores por defecto son los que ya estaban en el codigo: Impact a 72 px
-- con 380 px de margen inferior, medidos sobre material real.
alter table settings add column if not exists sub_font   text    not null default 'Impact';
alter table settings add column if not exists sub_size   integer not null default 72;
alter table settings add column if not exists sub_margin integer not null default 380;

-- ---------------------------------------------------------------------------
-- Plantillas
-- ---------------------------------------------------------------------------
--
-- Un juego de ajustes con nombre. Existe porque distintos tipos de material
-- quieren cortes distintos: un directo de juego pide clips de 20 s y un podcast
-- de 90, y cambiar las siete perillas a mano cada vez es donde se cometen los
-- errores.
--
-- Guarda una COPIA de los valores, no una referencia. Aplicar una plantilla y
-- luego retocar un valor no debe modificar la plantilla: si fuera una
-- referencia, "volver a lo de antes" dejaria de existir en cuanto tocas algo.
create table if not exists plantillas (
  id               text primary key,
  owner_id         uuid not null references owners(id) on delete cascade,
  nombre           text not null,

  clip_min_sec     integer not null,
  clip_max_sec     integer not null,
  clips_per_window integer not null,
  window_sec       integer not null,
  subtitles        boolean not null,
  sub_font         text    not null,
  sub_size         integer not null,
  sub_margin       integer not null,

  created_at       timestamptz not null default now()
);

-- Dos plantillas con el mismo nombre son indistinguibles en la lista, y la
-- segunda solo sirve para elegir la equivocada. Guardar con un nombre que ya
-- existe sobrescribe, que es lo que espera cualquiera.
create unique index if not exists plantillas_nombre_idx
  on plantillas (owner_id, nombre);
