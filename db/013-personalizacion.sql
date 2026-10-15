-- Todo lo que decidia el codigo y ahora decide el usuario.
--
-- Hasta ahora solo eran configurables la tipografia, el cuerpo y la altura de
-- los subtitulos. El color, el grosor del borde, cuantas palabras entran en
-- cada rotulo y como se arma el texto de la publicacion estaban escritos en el
-- codigo, asi que cambiarlos exigia tocar un fichero y volver a desplegar.
--
-- Los valores por defecto son EXACTAMENTE los que ya aplicaba el codigo, de
-- modo que un propietario que no toque nada obtiene el mismo resultado que
-- antes de que estas columnas existieran.

-- --- Subtitulos -------------------------------------------------------------

-- Color del texto y del borde, en #RRGGBB. Se guardan asi y no en el formato
-- de los ficheros .ass (&HAABBGGRR, con los bytes al reves) porque esto lo
-- escribe un selector de color del navegador; la conversion se hace al generar
-- el fichero, que es donde importa.
alter table settings add column if not exists sub_color       text    not null default '#FFFFFF';
alter table settings add column if not exists sub_color_borde text    not null default '#000000';

-- Grosor del borde en pixeles del lienzo de 1920. Era 7 fijo.
alter table settings add column if not exists sub_borde       integer not null default 7;

-- Cuantas palabras como mucho entran en cada rotulo. Era 3 fijo.
alter table settings add column if not exists sub_palabras    integer not null default 3;

-- Animacion de entrada de cada rotulo. Era siempre activa.
alter table settings add column if not exists sub_animacion   boolean not null default true;

-- --- Texto de la publicacion ------------------------------------------------

-- Plantilla del texto que acompaña al video. {titulo} es el pie que propuso el
-- modelo y {hashtags} las etiquetas ya con almohadilla. Era "{titulo}
-- {hashtags}" fijo, cosido dentro de cada proveedor de publicacion.
alter table settings add column if not exists texto_plantilla text not null default '{titulo} {hashtags}';

-- Etiquetas que se añaden siempre, ademas de las que propone el modelo.
-- Separadas por comas y sin almohadilla.
alter table settings add column if not exists hashtags_fijos  text not null default '';

-- --- Publicacion ------------------------------------------------------------

-- Quien puede ver lo que se publica en directo. Era PUBLIC_TO_EVERYONE fijo.
alter table settings add column if not exists privacidad      text not null default 'PUBLIC_TO_EVERYONE';

-- Cadencia por cuenta. Estaban en publish/types.ts como TIKTOK_LIMITS, con un
-- margen por debajo del limite real de TikTok (6 por minuto y 15 al dia).
alter table settings add column if not exists max_por_minuto  integer not null default 5;
alter table settings add column if not exists max_por_dia     integer not null default 13;

-- --- Las mismas columnas en las plantillas ----------------------------------
--
-- Las dos tablas comparten los nombres a proposito: el mismo lector
-- (ajustesDeFila) sirve para ambas, y asi una plantilla no puede
-- desincronizarse de lo que significa cada campo. Si solo se ampliara
-- `settings`, guardar una plantilla perderia en silencio todo lo nuevo y
-- aplicarla devolveria los valores por defecto.
alter table plantillas add column if not exists sub_color       text    not null default '#FFFFFF';
alter table plantillas add column if not exists sub_color_borde text    not null default '#000000';
alter table plantillas add column if not exists sub_borde       integer not null default 7;
alter table plantillas add column if not exists sub_palabras    integer not null default 3;
alter table plantillas add column if not exists sub_animacion   boolean not null default true;
alter table plantillas add column if not exists texto_plantilla text    not null default '{titulo} {hashtags}';
alter table plantillas add column if not exists hashtags_fijos  text    not null default '';
alter table plantillas add column if not exists privacidad      text    not null default 'PUBLIC_TO_EVERYONE';
alter table plantillas add column if not exists max_por_minuto  integer not null default 5;
alter table plantillas add column if not exists max_por_dia     integer not null default 13;

-- --- Por donde y como se publica -------------------------------------------
--
-- Vivian en el .env y en scripts/publicar.cmd, o sea en el ordenador de casa.
-- Cambiar de proveedor el 2026-10-09 obligo a editar los dos ficheros a mano,
-- que es justo lo que el panel existe para evitar.
--
-- El valor por defecto es upload-post en directo, que es lo que quedo
-- funcionando ese dia: la API propia de TikTok no puede publicar sin pasar la
-- auditoria y como mucho deja el video en la bandeja.
alter table settings   add column if not exists proveedor text not null default 'upload-post';
alter table settings   add column if not exists modo      text not null default 'direct';
alter table plantillas add column if not exists proveedor text not null default 'upload-post';
alter table plantillas add column if not exists modo      text not null default 'direct';
