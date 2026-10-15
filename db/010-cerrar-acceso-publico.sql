-- Cierra el acceso publico a las tablas.
--
-- Supabase aviso el 2026-09-27 de dos problemas criticos en el proyecto
-- `clipline`: `rls_disabled_in_public` y `sensitive_columns_exposed`. Medido
-- contra la base: las 15 tablas tenian RLS apagado y CERO politicas, y el rol
-- `anon` (el publico, el que usa la clave que va en los front-ends) tenia
-- SELECT, INSERT, UPDATE, DELETE y TRUNCATE sobre todas. Incluida
-- `tiktok_tokens`, que guarda los permisos para publicar en nombre de cada
-- cuenta.
--
-- Nadie habia publicado esa clave, pero Supabase la trata como publicable: la
-- reparte para meterla en paginas web. Toda la proteccion dependia de que nunca
-- saliera del panel, y eso no es una proteccion.
--
-- POR QUE ESTO NO ROMPE EL PROGRAMA. Comprobado antes de escribirlo:
--
--   rol            bypassa RLS
--   postgres       si     <- el que usa el panel y el trabajador
--   service_role   si     <- el que usa la subida de copias
--   anon           no
--   authenticated  no
--
-- El programa entra por conexion directa como `postgres`, que salta RLS. Lo que
-- se cierra es la puerta de la API REST, que el programa no usa para datos.
--
-- Dos capas a proposito. Revocar los permisos ya bastaria, pero RLS es lo que
-- Supabase comprueba en su informe y lo que protege si alguien vuelve a
-- conceder un GRANT sin pensarlo.

-- --------------------------------------------------------------------------
-- 1. RLS en todas las tablas del esquema publico
-- --------------------------------------------------------------------------
--
-- Sin politicas a proposito: RLS activo y cero politicas significa "nadie que
-- no bypasee puede ver nada". Es justo lo que se quiere para anon. El dia que
-- alguna tabla deba ser legible desde la web, se le añade su politica.
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 2. Quitarle a anon y authenticated todo permiso sobre las tablas
-- --------------------------------------------------------------------------
--
-- Condicionado a que los roles existan.
--
-- `anon` y `authenticated` los crea Supabase; un Postgres desnudo no los tiene.
-- Las pruebas de este proyecto corren contra PGlite en memoria, y un REVOKE a
-- un rol inexistente aborta el fichero entero: verify:panel, verify:cola y
-- verify:publicar se cayeron con "role anon does not exist" hasta que se puso
-- esta comprobacion.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 3. Y que las tablas FUTURAS nazcan cerradas
-- --------------------------------------------------------------------------
--
-- Esta es la parte que evita repetir el susto. Sin ella, la siguiente
-- migracion crea una tabla y Supabase vuelve a concederle todo a anon por sus
-- privilegios por defecto, con RLS apagado.
--
-- Se declara para `postgres` porque es el rol con el que corren las
-- migraciones: los privilegios por defecto se aplican segun quien crea la
-- tabla, no segun quien la usa.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'alter default privileges for role postgres in schema public revoke all on tables from %I', r);
      execute format(
        'alter default privileges for role postgres in schema public revoke all on sequences from %I', r);
      execute format(
        'alter default privileges for role postgres in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
