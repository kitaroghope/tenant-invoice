// Logos come from arbitrary phone photos and screenshots as often as real artwork, so this
// normalizes every raster upload to one standard size in the browser before it ever reaches
// storage — callers get a small, predictable file instead of having to reject large ones.
const MAX_LOGO_DIMENSION_PX = 512
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'svg', 'webp']

export function extensionOf(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() || ''
}

// Vector art has no pixel dimensions to standardize and canvas can't safely rasterize
// arbitrary SVG, so it only gets the byte-size check.
export async function standardizeLogoFile(file: File): Promise<File> {
  const extension = extensionOf(file)
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error('Logo must be a PNG, JPEG, WebP, or SVG file')
  }
  if (extension === 'svg') {
    if (file.size > MAX_LOGO_BYTES) throw new Error('Logo must be smaller than 2MB')
    return file
  }

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_LOGO_DIMENSION_PX / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not process that image')
    context.drawImage(bitmap, 0, 0, width, height)

    const mimeType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not process that image'))), mimeType, 0.92)
    })

    if (blob.size > MAX_LOGO_BYTES) throw new Error('Logo is too large even after resizing — try a simpler image')

    const outExtension = mimeType === 'image/jpeg' ? 'jpg' : 'png'
    return new File([blob], `logo.${outExtension}`, { type: mimeType })
  } finally {
    bitmap.close()
  }
}
