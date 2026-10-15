-- Un rotulo de titulo quemado en el video, encima de los subtitulos.
--
-- Hasta ahora el pie del clip solo viajaba como texto de la publicacion, junto
-- al video pero no DENTRO de el. En TikTok eso se pierde: quien pasa deprisa ve
-- la imagen, no el pie. Un titulo quemado arriba es lo que hace que un clip se
-- entienda sin leer nada mas.
--
-- Nace apagado a proposito: encenderlo cambia como salen todos los videos
-- nuevos, y esa decision es del usuario, no una que herede por actualizar.
alter table settings add column if not exists titulo_activo       boolean not null default false;

-- Que se escribe. {titulo} es el pie que propuso el modelo para ese clip.
alter table settings add column if not exists titulo_texto        text    not null default '{titulo}';

-- Altura desde ARRIBA, en pixeles del lienzo de 1920. Los subtitulos se miden
-- desde abajo porque es donde viven; el titulo, desde arriba, por lo mismo.
alter table settings add column if not exists titulo_arriba       integer not null default 240;

alter table settings add column if not exists titulo_tam          integer not null default 64;
alter table settings add column if not exists titulo_color        text    not null default '#FFFFFF';
alter table settings add column if not exists titulo_color_borde  text    not null default '#000000';
alter table settings add column if not exists titulo_borde        integer not null default 6;

-- Las mismas en plantillas: las dos tablas comparten nombres de columna y el
-- mismo lector, y si solo se ampliara settings una plantilla perderia esto.
alter table plantillas add column if not exists titulo_activo      boolean not null default false;
alter table plantillas add column if not exists titulo_texto       text    not null default '{titulo}';
alter table plantillas add column if not exists titulo_arriba      integer not null default 240;
alter table plantillas add column if not exists titulo_tam         integer not null default 64;
alter table plantillas add column if not exists titulo_color       text    not null default '#FFFFFF';
alter table plantillas add column if not exists titulo_color_borde text    not null default '#000000';
alter table plantillas add column if not exists titulo_borde       integer not null default 6;
