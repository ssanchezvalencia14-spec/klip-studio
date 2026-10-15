' Lanza el trabajador SIN ventana de consola, y ESPERA a que termine.
'
' Sin ventana porque la version original abria una de cmd: cualquiera que la
' cerrara (o el cierre de sesion) mataba el proceso, y la tarea programada no lo
' levantaba porque su unico disparador era "al iniciar sesion". El codigo de
' salida lo delataba: 0xC000013A, "terminado al cerrar la consola".
'
' ESPERANDO (el True final) porque sin eso se acumulaban trabajadores.
' trabajador.cmd es un bucle infinito. Al lanzarlo con False, este guion
' terminaba de inmediato, la tarea se daba por acabada, y a los cinco minutos el
' disparador de repeticion arrancaba OTRO bucle encima del anterior. El
' 2026-10-05 habia once trabajadores vivos a la vez, y uno nuevo cada cinco
' minutos. No llegaron a pisarse el trabajo (la cola usa `for update skip
' locked`), pero eran once procesos consultando la misma base sin parar.
'
' Con True, la tarea se queda "en ejecucion" mientras el bucle vive, y la
' politica IgnoreNew de la tarea descarta los disparos siguientes. Si el bucle
' muere de verdad, este guion vuelve, la tarea pasa a terminada y el siguiente
' disparo la levanta otra vez. Que es justo lo que se queria.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & sh.CurrentDirectory & "\trabajador.cmd""", 0, True
