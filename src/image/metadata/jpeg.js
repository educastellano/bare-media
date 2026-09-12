async function stripJPEGMetadata(buffer, opts = {}) {
  const { keepColor = true, keepOrientation = false } = opts

  const jpeg = await import('bare-jpeg')
  const APP1 = 0xe1
  const APP14 = 0xee

  const { markers } = jpeg.readHeader(buffer)

  let newMarkers = []

  if (keepColor) {
    newMarkers = markers.filter((m) => m.marker === APP14)
  }

  if (keepOrientation) {
    const exif = await import('bare-exif')
    const tags = exif.constants.tags
    using data = new exif.Data(buffer)

    for (const tag of Object.values(tags)) {
      if (tag !== tags.ORIENTATION) {
        data.removeEntry(tag)
      }
    }

    const rawExif = data.saveData()

    newMarkers.push({
      marker: APP1,
      data: rawExif
    })
  }

  return jpeg.replaceMarkers(buffer, newMarkers)
}

export { stripJPEGMetadata }
