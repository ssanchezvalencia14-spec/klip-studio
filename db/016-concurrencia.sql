-- Cuantas cuentas atiende a la vez el publicador.
--
-- Hasta aqui el trabajador publicaba estrictamente en serie: un `for` con
-- `await` dentro. Con las dos cuentas activas de hoy son seis envios al dia y
-- no se nota. Con doscientas serian seiscientos, y a quince segundos por
-- subida eso es una pasada de dos horas y media contra una tarea programada
-- que corre cada treinta minutos: las pasadas se solapan y el sistema deja de
-- funcionar por como esta escrito el bucle, no por ningun limite real.
--
-- UNO POR DEFECTO, a proposito. Es exactamente el comportamiento anterior, asi
-- que actualizar no cambia nada hasta que alguien decida subirlo.
--
-- Esto NO afloja ningun limite: los topes de TikTok son por cuenta (5 por
-- minuto, 13 al dia) y el paralelismo es ENTRE cuentas distintas. Dos envios
-- de la misma cuenta siguen yendo uno detras de otro.
alter table settings add column if not exists concurrencia integer not null default 1;

do $$ begin
  alter table settings add constraint settings_concurrencia_ok
    check (concurrencia between 1 and 8);
exception
  when duplicate_object then null;
end $$;

alter table plantillas add column if not exists concurrencia integer not null default 1;
