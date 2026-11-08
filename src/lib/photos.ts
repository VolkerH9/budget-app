import { loadImage } from './scan'

/** Long edge of a stored receipt photo: small print stays readable when zoomed in */
const EDGE = 1800
/** A photo above this size is compressed once more */
const TARGET_BYTES = 450_000

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Das Foto konnte nicht verkleinert werden.'))), 'image/jpeg', quality))
}

/** Shrinks a photo from the camera or library to a JPEG of usually 150 to 450 KB. */
export async function compressPhoto(file: Blob): Promise<Blob> {
  const image = await loadImage(file)
  const scale = Math.min(1, EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)
  const context = canvas.getContext('2d')!
  // Transparent images would turn black in a JPEG
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const first = await toBlob(canvas, 0.72)
  if (first.size <= TARGET_BYTES) return first
  const second = await toBlob(canvas, 0.55)
  return second.size < first.size ? second : first
}

/** Width and height, for placing a photo in the PDF */
export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const image = await loadImage(blob)
  return { width: image.naturalWidth, height: image.naturalHeight }
}
