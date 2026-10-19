/**
 * Descarga el modelo de deteccion de rostros para el reencuadre (Fase 6).
 *
 *   npm run instalar-rostros     (instala onnxruntime-node y llama a esto)
 *
 * YuNet, del repositorio oficial de modelos de OpenCV (opencv_zoo, licencia
 * MIT). Unos 230 KB. Se guarda en models/, que no va al repositorio.
 *
 * Si ya esta, no hace nada. Si la descarga falla, el render sigue en modo
 * clasico (fondo borroso) y lo dice en el registro.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadEnv } from '../src/lib/env.js'
import { rutaModeloRostros } from '../src/render/rostros.js'

loadEnv()

// opencv_zoo guarda los modelos con Git LFS: la URL "raw" devuelve el puntero,
// no el fichero. La de media.githubusercontent.com devuelve el binario.
const URLS = [
  'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
  'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
]

const destino = rutaModeloRostros()
if (existsSync(destino)) {
  console.log('El modelo de rostros ya está.')
  process.exit(0)
}

mkdirSync(dirname(destino), { recursive: true })
for (const url of URLS) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) continue
    const datos = new Uint8Array(await res.arrayBuffer())
    const inicio = new TextDecoder().decode(datos.slice(0, 40))
    // Un puntero de Git LFS es texto pequeño, no un modelo.
    if (datos.length < 100_000 || inicio.startsWith('version https://git-lfs')) continue
    writeFileSync(destino, datos)
    console.log(`Modelo de rostros descargado (${Math.round(datos.length / 1024)} KB).`)
    process.exit(0)
  } catch {
    // Se prueba la siguiente direccion.
  }
}
console.error('No se pudo descargar el modelo de rostros. El reencuadre seguirá en modo clásico.')
process.exitCode = 1
