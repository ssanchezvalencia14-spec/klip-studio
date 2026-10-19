-- Zona segura de TikTok para los subtitulos (Fase 5).
--
-- Solo cambia el valor POR DEFECTO de las filas nuevas: 480 px desde abajo en
-- vez de 380, que caia dentro del 20 % que tapa la interfaz de TikTok. Las
-- filas existentes no se tocan; al leerlas, una altura por debajo de 400 se
-- sube a 400 (src/select/ajustes.ts).
--
-- Para deshacerlo:
--   alter table settings alter column sub_margin set default 380;

alter table settings alter column sub_margin set default 480;
