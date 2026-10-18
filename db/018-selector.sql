-- Quien elige los momentos: la API de Anthropic o el modelo local.
--
-- Hasta aqui esto era SELECT_PROVIDER en el .env, o sea un fichero en el
-- ordenador de casa. El 2026-10-18 la clave de Anthropic quedo rechazada y
-- procesar cualquier VOD fallaba con un 401; la salida existia -- el modelo
-- local de Ollama -- pero cambiar a ella pedia editar el .env y reiniciar,
-- que es justo lo que el panel existe para evitar.
--
-- 'anthropic' por defecto: es lo que hacia antes de que esto existiera, asi
-- que actualizar no cambia el comportamiento de nadie.
alter table settings add column if not exists selector text not null default 'anthropic';

do $$ begin
  alter table settings add constraint settings_selector_ok
    check (selector in ('anthropic', 'local'));
exception
  when duplicate_object then null;
end $$;

-- Tambien en plantillas: las dos tablas comparten nombres de columna y lector,
-- y sin esto una plantilla aplicada borraria la eleccion.
alter table plantillas add column if not exists selector text not null default 'anthropic';
