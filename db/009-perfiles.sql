-- Perfil de publicacion por cliente.
--
-- Hasta aqui habia UN solo juego de ajustes para todo el sistema, en la tabla
-- `settings`. Con un cliente valia. Con dos no: un artista que saca disco
-- quiere tres publicaciones diarias de 10:00 a 23:00, y una marca que lleva un
-- goteo quiere una al dia a media tarde. Con ajustes unicos, subir la cadencia
-- de uno se la sube al otro.
--
-- TODO NULABLE, Y ESO ES EL DISEÑO. Nulo significa "lo que diga el ajuste
-- general", no cero. Asi un cliente recien creado se comporta como antes y solo
-- se aparta cuando alguien decide apartarlo. Poner valores por defecto aqui
-- obligaria a mantener dos sitios con la misma cifra y a que se separaran solos
-- en cuanto alguien tocara uno.

alter table clientes
  add column if not exists posts_per_day   integer,
  add column if not exists day_start_hour  integer,
  add column if not exists day_end_hour    integer;

-- Los mismos limites que valida queue/settings.ts. Se repiten aqui porque la
-- base es la ultima puerta: un update a mano o un script viejo no pasan por
-- aquella validacion.
do $$ begin
  alter table clientes add constraint clientes_perfil_ok check (
    (posts_per_day  is null or posts_per_day  between 1 and 10) and
    (day_start_hour is null or day_start_hour between 0 and 23) and
    (day_end_hour   is null or day_end_hour   between 1 and 24) and
    (day_start_hour is null or day_end_hour is null or day_start_hour < day_end_hour)
  );
exception
  when duplicate_object then null;
end $$;
