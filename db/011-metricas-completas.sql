-- Las dos cifras que se perdian al guardar.
--
-- `MetricSnapshot` lleva cinco numeros: vistas, likes, comentarios, compartidos
-- y segundos medios de visionado. La tabla solo tenia los tres primeros, asi
-- que el escritor de Postgres descartaba los otros dos sin decir nada: el
-- almacen de ficheros los conservaba y la base no, y nadie lo notaba porque
-- todavia no habia ninguna lectura tomada.
--
-- Compartir es la señal mas util de las cinco en TikTok: un video que la gente
-- manda a un amigo rinde mucho mejor que uno que solo acumula likes. Perderla
-- era perder justo el dato por el que se recogen metricas.
--
-- `average_watch_sec` es nulable a proposito: la API directa de TikTok no lo
-- expone (solo lo daba upload-post). Nulo significa "este proveedor no lo
-- mide"; un cero significaria "nadie lo vio", que es otra cosa.

alter table metrics
  add column if not exists shares            integer not null default 0,
  add column if not exists average_watch_sec double precision;
