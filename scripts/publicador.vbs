' Lanza una pasada del publicador sin ventana de consola, y espera a que acabe.
'
' Sin ventana por el mismo motivo que trabajador.vbs: una ventana visible la
' cierra cualquiera sin querer.
'
' Esperando (el True) para que la tarea no se de por terminada antes de tiempo.
' Aqui no es un bucle sino una pasada, pero una pasada con doce videos puede
' durar varios minutos: si este guion vuelve enseguida, la tarea figura como
' acabada mientras sigue subiendo, y el disparo de los treinta minutos podria
' arrancar una segunda pasada encima. Con True, IgnoreNew se encarga.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & sh.CurrentDirectory & "\publicar.cmd""", 0, True
