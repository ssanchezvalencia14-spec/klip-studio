-- Clientes y campañas.
--
-- Hasta aqui todo colgaba del propietario unico: las cuentas eran acc-01..20
-- sueltas y los VOD una lista plana. Vale para un cliente. Con dos, no hay
-- forma de saber que cuenta publica lo de quien, ni de enseñar a alguien lo
-- suyo sin enseñarle lo del otro.
--
-- Dos niveles, no uno:
--
--   cliente   quien paga. ZOTI. Persiste.
--   campaña   un lanzamiento suyo. Un disco, un single. Empieza y termina.
--
-- LAS CUENTAS CUELGAN DEL CLIENTE Y LOS VOD DE LA CAMPAÑA. No es arbitrario:
-- una cuenta de TikTok sobrevive a los lanzamientos, y colgarla de la campaña
-- obligaria a re-enlazarla (y re-autorizarla en tiktok.com) cada vez que
-- empieza una nueva. Los VOD si pertenecen a un lanzamiento concreto.
--
-- Los clips no llevan nada: cuelgan de su VOD y heredan por ahi.

create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners(id) on delete cascade,
  nombre     text not null,
  -- Archivar en vez de borrar. Un cliente que se va se lleva su historial de
  -- publicaciones, y ese historial es lo que justifica la factura del mes que
  -- viene. Borrarlo de verdad tiene que costar mas que un click.
  archivado  boolean not null default false,
  notas      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dos clientes con el mismo nombre son un error de dedo, no una intencion.
create unique index if not exists clientes_nombre_idx
  on clientes (owner_id, lower(nombre));

create table if not exists campanas (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references owners(id) on delete cascade,
  -- Si se borra el cliente, sus campañas no tienen sentido por separado.
  cliente_id uuid not null references clientes(id) on delete cascade,
  nombre     text not null,
  estado     text not null default 'activa'
             check (estado in ('activa', 'pausada', 'terminada')),
  notas      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unico dentro del cliente, no global: dos clientes pueden tener cada uno su
-- campaña "Lanzamiento".
create unique index if not exists campanas_nombre_idx
  on campanas (cliente_id, lower(nombre));

create index if not exists campanas_cliente_idx
  on campanas (owner_id, cliente_id);

-- ---------------------------------------------------------------------------
-- Enganches
-- ---------------------------------------------------------------------------
--
-- Los dos nulables a proposito. Al aplicar esto ya hay cuentas y VOD en la
-- base, y ponerlos como obligatorios exigiria inventarse a que cliente
-- pertenecen. Nulo significa "sin asignar" y el panel lo enseña como tal.

alter table accounts
  add column if not exists cliente_id uuid;

do $$ begin
  alter table accounts
    add constraint accounts_cliente_fk
    foreign key (cliente_id) references clientes(id)
    -- ON DELETE SET NULL, NO CASCADE. Una cuenta guarda el permiso de TikTok
    -- en tiktok_tokens; borrar el cliente y llevarse la cuenta por delante
    -- dejaria un token huerfano apuntando a una cuenta que ya no existe, y
    -- obligaria a volver a pedirle autorizacion al titular por un borrado que
    -- nadie penso que tocara eso.
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists accounts_cliente_idx
  on accounts (owner_id, cliente_id);

alter table sources
  add column if not exists campana_id uuid;

do $$ begin
  alter table sources
    add constraint sources_campana_fk
    foreign key (campana_id) references campanas(id)
    -- Igual que arriba: el VOD y sus clips siguen existiendo aunque se borre
    -- la campaña. El material es lo caro de producir.
    on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists sources_campana_idx
  on sources (owner_id, campana_id);
