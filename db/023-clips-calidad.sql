-- Calidad de los clips y edicion (Fase 6).
--
-- TODO ADITIVO: columnas nuevas con valor por defecto. No se toca ningun dato.
-- Para deshacerlo:
--
--   alter table clips drop column if exists titulo;
--   alter table clips drop column if exists puntaje_gancho;
--   alter table clips drop column if exists puntaje_cierre;
--   alter table clips drop column if exists puntaje_retencion;
--   alter table clips drop column if exists segmentos;
--   alter table clips drop column if exists subtitulos;
--   alter table sources drop column if exists tipo;
--   alter table sources drop column if exists confianza_letra;
--   alter table settings drop column if exists encuadre;
--   alter table plantillas drop column if exists encuadre;

-- Titulo corto (maximo 8 palabras) y desglose del puntaje que da la IA.
alter table clips add column if not exists titulo text not null default '';
alter table clips add column if not exists puntaje_gancho integer;
alter table clips add column if not exists puntaje_cierre integer;
alter table clips add column if not exists puntaje_retencion integer;

-- Las lineas de la transcripcion que caen dentro del clip, para poder editar
-- los subtitulos desde el panel (que no ve el disco del PC).
alter table clips add column if not exists segmentos jsonb not null default '[]';
-- Los subtitulos editados a mano. null = se usan los de la transcripcion.
alter table clips add column if not exists subtitulos jsonb;

-- Tipo de video al añadirlo y, en musica, cuanto fiarse de la letra.
alter table sources add column if not exists tipo text not null default 'entrevista';
alter table sources add column if not exists confianza_letra real;

do $$ begin
  alter table sources add constraint sources_tipo_ok check (tipo in ('entrevista', 'stream', 'musica'));
exception
  when duplicate_object then null;
end $$;

-- Encuadre vertical: siguiendo la cara o el clasico con fondo borroso.
alter table settings add column if not exists encuadre text not null default 'rostro';
alter table plantillas add column if not exists encuadre text not null default 'rostro';

do $$ begin
  alter table settings add constraint settings_encuadre_ok check (encuadre in ('rostro', 'clasico'));
exception
  when duplicate_object then null;
end $$;
