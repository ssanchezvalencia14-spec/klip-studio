/**
 * Quita de un texto lo que no debe verse en el panel: rutas de archivos y el
 * nombre del usuario de Windows que va dentro de ellas, y claves.
 *
 * Se aplica a la salida de las tareas antes de guardarla en la base, que es
 * de donde la lee el panel. El detalle completo sigue en los registros del PC
 * (logs/trabajador.log), que no salen de alli.
 *
 *   C:\Users\ana\Desktop\klip\out\vod\clip-01.mp4   ->  …\out\vod\clip-01.mp4
 *   /home/ana/klip/work/vod/audio.wav               ->  …/work/vod/audio.wav
 */
export function limpiarRutas(texto: string): string {
  return texto
    // Windows: unidad + carpeta de usuario. Se conserva desde la carpeta del
    // proyecto (work, out, models) si aparece, que es lo util para entenderlo.
    .replace(/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s"']+(?:[\\/][^\s"']*)?/gi, (m) => recortar(m, '\\'))
    // Cualquier otra ruta absoluta de Windows.
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, (m) => recortar(m, '\\'))
    // Unix: carpetas de usuario.
    .replace(/\/(?:home|Users)\/[^/\s"']+(?:\/[^\s"']*)?/g, (m) => recortar(m, '/'))
    // Claves que se cuelan en un mensaje de error.
    .replace(/(sk-ant-[a-z0-9]{2,})[A-Za-z0-9_-]+/gi, 'sk-ant-***')
    .replace(/(Apikey|Bearer)\s+[A-Za-z0-9._-]{8,}/g, '$1 ***')
}

function recortar(ruta: string, sep: string): string {
  const partes = ruta.split(/[\\/]+/)
  const desde = partes.findIndex((p) => /^(work|out|models|logs|state)$/i.test(p))
  const cola = desde >= 0 ? partes.slice(desde) : partes.slice(-1)
  return '…' + sep + cola.join(sep)
}
