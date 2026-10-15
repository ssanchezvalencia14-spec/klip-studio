@echo off
rem Entrega a TikTok lo que toque, una pasada.
rem
rem Lo lanza la tarea programada "KLIP publicador" cada media hora. No es un
rem bucle: cada pasada coge lo vencido, lo entrega y termina. Si no hay nada
rem vencido, sale en segundos sin tocar nada.
rem
rem MODO DIRECTO, por upload-post. Publica de verdad en el perfil.
rem
rem Hasta el 2026-10-09 esto iba en borrador, con un comentario que decia que no
rem era negociable hasta pasar la auditoria. Eso valia para la API PROPIA de
rem TikTok, que sin auditar rechaza todo con
rem unaudited_client_can_only_post_to_private_accounts y como mucho deja el
rem video en la bandeja. upload-post usa su propia app, ya auditada, y ahi esa
rem restriccion no existe.
rem
rem Hay un segundo motivo para no volver a borrador: el tope de TikTok es sobre
rem borradores SIN PUBLICAR, no sobre publicaciones. Medido ese dia con acc-02,
rem con veinte minutos de diferencia: en borrador la rechazo con
rem Spam_risk_too_many_pending_share, en directo la publico sin problema. El
rem modo directo esquiva el cuello de botella que marcaba el ritmo.
rem
rem El tope por pasada es un cinturon, no el freno de verdad. El freno es la
rem cadencia del worker (5 por minuto y 13 al dia por cuenta, publish/types.ts)
rem y el propio limite de TikTok de borradores sin publicar. Aun asi se acota:
rem una pasada que intenta doscientas entregas tarda horas y solapa con la
rem siguiente.
rem
rem Con registro y con el camino completo a npm, por el mismo motivo que
rem trabajador.cmd: una tarea programada no trae el mismo entorno que una
rem consola, y sin registro un fallo aqui no deja rastro en ninguna parte.
cd /d "%~dp0.."
set "KLIP_LOG=%~dp0..\logs"
if not exist "%KLIP_LOG%" mkdir "%KLIP_LOG%"

set "NPM_CMD=npm"
if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"

rem Una generacion anterior y para de contar. Cada pasada vuelca la salida
rem completa de npm y son 48 pasadas al dia: sin tope, el registro pasa de cien
rem megas al año para enseñar siempre lo mismo.
for %%F in ("%KLIP_LOG%\publicador.log") do if %%~zF GTR 5242880 (
  move /y "%KLIP_LOG%\publicador.log" "%KLIP_LOG%\publicador.anterior.log" >nul
)

rem NO se fijan aqui el proveedor ni el modo: los decide el panel.
rem
rem Estuvieron escritos en este fichero, y cambiarlos el 2026-10-09 obligo a
rem editarlo a mano junto con el .env. Ahora viven en Ajustes y publish.ts los
rem lee de la base. Si alguna vez hiciera falta forzarlos para una pasada
rem suelta, basta con poner aqui PUBLISH_PROVIDER o PUBLISH_MODE: el entorno
rem sigue pisando a lo guardado, a proposito.
echo [%date% %time%] pasada del publicador >> "%KLIP_LOG%\publicador.log"
call "%NPM_CMD%" run publish -- --live --limit 12 >> "%KLIP_LOG%\publicador.log" 2>&1
echo [%date% %time%] terminada con codigo %errorlevel% >> "%KLIP_LOG%\publicador.log"
