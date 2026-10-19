-- La IA con la suscripcion de Claude (Fase 1).
--
-- DOS COSAS NUEVAS, las dos aditivas: no se borra ni se cambia ningun dato.
--
-- 1. Un estado mas para las tareas: `en_espera_ia`. Una tarea que no pudo
--    preguntar a la IA porque no hay sesion o porque se llego al limite de uso
--    NO ha fallado: esta esperando. Marcarla como error hacia que se relanzara
--    a mano una y otra vez (hubo un video con 28 ejecuciones de "Elegir
--    momentos") para recibir siempre el mismo aviso.
--
-- 2. Una fila por dueño con el estado de la IA. Es lo que pausa la cola: con
--    la IA en limite o sin sesion, el trabajador no coge tareas de IA hasta que
--    pase la hora indicada o alguien pulse "Reintentar".
--
-- PARA DESHACERLO (no hace falta respaldo: no toca filas existentes):
--
--   update jobs set status = 'queued' where status = 'en_espera_ia';
--   alter table jobs drop constraint if exists jobs_status_check;
--   alter table jobs add constraint jobs_status_check
--     check (status in ('queued', 'running', 'ok', 'error', 'cancelled'));
--   drop table if exists ia_estado;

alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('queued', 'running', 'ok', 'error', 'cancelled', 'en_espera_ia'));

create table if not exists ia_estado (
  owner_id      uuid primary key references owners(id) on delete cascade,
  -- lista | limite | sin_sesion | no_encontrado | tiempo | error | desconocido
  estado        text not null default 'desconocido',
  -- Frase para la pantalla. Sin rutas ni nombres de usuario.
  mensaje       text not null default '',
  -- Solo con 'limite' y si el aviso traia hora: cuando reanudar sola.
  reanudar_en   timestamptz,
  proveedor     text not null default '',
  modelo        text not null default '',
  comprobado_en timestamptz not null default now()
);

do $$ begin
  alter table ia_estado add constraint ia_estado_ok
    check (estado in ('lista', 'limite', 'sin_sesion', 'no_encontrado', 'tiempo', 'error', 'desconocido'));
exception
  when duplicate_object then null;
end $$;
