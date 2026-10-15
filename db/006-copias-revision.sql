-- Copias de revision en la nube.
--
-- El problema que resuelve: el panel vive en un servidor y los MP4 en el PC de
-- casa, asi que desde el movil no se podia ver ningun video. La compuerta de
-- aprobacion, que es lo unico que no hace el programa solo, solo funcionaba
-- sentado delante del ordenador que renderiza.
--
-- NO se sube el master. Un clip terminado pesa 30 MB de mediana (medido sobre
-- los 33 que hay: 1127 MB en total), y el plan gratuito de Storage es 1 GB: un
-- solo VOD no cabria. Lo que se sube es una copia de 540x960 cuyo unico
-- trabajo es verse en un movil para decidir si el clip vale. Medido sobre un
-- clip real: 30,34 MB -> 1,13 MB, 27 veces menos, 2,5 s de codificacion.
--
-- El master se queda en el PC porque es lo que se publica y de lo que salen
-- las variantes por cuenta. Aqui solo viaja algo que se mira una vez.
alter table clips add column if not exists proxy_path  text not null default '';

-- El tamaño se guarda para poder responder "cuanto ocupa esto" sin preguntarle
-- a Storage por cada objeto. Es la cifra que dice cuando toca limpiar.
alter table clips add column if not exists proxy_bytes integer not null default 0;

-- Los clips que ya tienen copia no se vuelven a subir. Sin este indice, saber
-- cuales faltan recorre la tabla entera en cada pasada del subidor.
create index if not exists clips_sin_copia_idx
  on clips (owner_id, source_id) where proxy_path = '';
