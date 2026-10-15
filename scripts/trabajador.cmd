@echo off
rem Arranca el trabajador de KLIP y lo mantiene vivo.
rem
rem Lo lanza la tarea programada "KLIP trabajador", a traves de trabajador.vbs
rem para que no abra ventana. Si el proceso muere (la base se cae, se corta la
rem red), este bucle lo levanta a los diez segundos en vez de dejar la cola
rem parada hasta que alguien lo note.
rem
rem TODO VA A UN REGISTRO. Sin esto, un trabajador que no arranca es
rem absolutamente silencioso: la tarea figura "en ejecucion", no hay ventana que
rem mirar, y las tareas se quedan en la cola sin que nada lo diga. Paso el
rem 2026-10-05 y solo se vio encolando un trabajo de prueba y comprobando que
rem nadie lo recogia.
rem
rem PATH COMPLETO A NPM, no "npm" a secas. La tarea programada no arranca con el
rem mismo entorno que una consola: segun como este registrada puede no traer la
rem carpeta de Node en el PATH, y entonces el bucle gira para siempre sin
rem ejecutar nada.
cd /d "%~dp0.."
set "KLIP_LOG=%~dp0..\logs"
if not exist "%KLIP_LOG%" mkdir "%KLIP_LOG%"

set "NPM_CMD=npm"
if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"

:bucle
rem Una generacion anterior y para de contar, por si un fallo en bucle lo llena.
for %%F in ("%KLIP_LOG%\trabajador.log") do if %%~zF GTR 5242880 (
  move /y "%KLIP_LOG%\trabajador.log" "%KLIP_LOG%\trabajador.anterior.log" >nul
)
echo [%date% %time%] arrancando trabajador con "%NPM_CMD%" >> "%KLIP_LOG%\trabajador.log"
call "%NPM_CMD%" run worker >> "%KLIP_LOG%\trabajador.log" 2>&1
echo [%date% %time%] el trabajador termino con codigo %errorlevel%. Reintentando en 10s... >> "%KLIP_LOG%\trabajador.log"
timeout /t 10 /nobreak >nul
goto bucle
