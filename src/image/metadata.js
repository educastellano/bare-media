import { IMAGE } from '../../types.js'
import { detectMimeType } from '../codecs.js'

const EXIF_MIMETYPES = new Set([IMAGE.JPEG, IMAGE.JPG, IMAGE.TIFF, IMAGE.TIF])
const HEIF_MIMETYPES = new Set([IMAGE.HEIC, IMAGE.HEIF, IMAGE.AVIF])

const EXIF_HEADER = Buffer.from('Exif\0\0')

async function readHeifMetadata(buffer) {
  try {
    const heif = await import('bare-heif')
    return heif.getMetadata(buffer)
  } catch {
    return []
  }
}

function extractHeifExif(metadata) {
  const item = metadata.find((item) => item.type === 'Exif')
  if (!item || item.data.byteLength < 4) return null

  const offset = 4 + item.data.readUInt32BE(0)
  const data = item.data.subarray(offset)

  return data.byteLength ? Buffer.concat([EXIF_HEADER, data]) : null
}

function extractHeifNonExif(metadata) {
  const data = {}
  const mime = []
  const uri = []

  for (const item of metadata) {
    if (item.type === 'mime') {
      if (item.contentType === 'application/rdf+xml') {
        data.xmp = item.data.toString()
      } else {
        mime.push({ contentType: item.contentType, data: item.data })
      }
    } else if (item.type === 'uri ') {
      uri.push({ uriType: item.uriType, data: item.data })
    }
  }

  if (mime.length) data.mime = mime
  if (uri.length) data.uri = uri

  return data
}

// entry.read() can return a Buffer viewing libexif memory rather than a copy,
// so detach it before the owning exif.Data is destroyed.
function readEntry(entry) {
  const value = entry.read()
  return Buffer.isBuffer(value) ? Buffer.from(value) : value
}

function resolveExifTag(exif, tag) {
  if (typeof tag === 'number') return tag

  if (typeof tag === 'string') {
    for (const [name, value] of Object.entries(exif.constants.tags)) {
      if (name.toLowerCase() === tag.toLowerCase()) {
        return value
      }
    }
  }

  return null
}

async function exifValue(buffer, tag) {
  try {
    const exif = await import('bare-exif')
    using exifData = new exif.Data(buffer)
    const entry = exifData.entry(resolveExifTag(exif, tag))
    return entry ? readEntry(entry) : undefined
  } catch {
    return null
  }
}

async function exifMetadata(buffer) {
  const data = {}

  try {
    const exif = await import('bare-exif')
    using exifData = new exif.Data(buffer)
    for (const [name, tag] of Object.entries(exif.constants.tags)) {
      const entry = exifData.entry(tag)
      if (!entry) continue
      data[name] = readEntry(entry)
    }
  } finally {
    return data
  }
}

async function metadata(buffer, opts = {}) {
  const data = {}
  let heifMetadata = []
  let exifRaw

  // exif

  const mimetype = detectMimeType(buffer)

  if (HEIF_MIMETYPES.has(mimetype)) {
    heifMetadata = await readHeifMetadata(buffer)
    exifRaw = extractHeifExif(heifMetadata)
  } else if (EXIF_MIMETYPES.has(mimetype)) {
    exifRaw = buffer
  } else {
    return data
  }

  if (opts.tag) {
    return exifRaw ? exifValue(exifRaw, opts.tag) : null
  }

  data.exif = exifRaw ? await exifMetadata(exifRaw) : {}

  // heif items: xmp, mime, uri

  if (HEIF_MIMETYPES.has(mimetype)) {
    Object.assign(data, extractHeifNonExif(heifMetadata))
  }

  // common metadata

  if (data.exif.ORIENTATION) {
    data.orientation = data.exif.ORIENTATION
  }

  return data
}

async function stripJPEG(buffer, opts = {}) {
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

function strip(buffer, opts = {}) {
  const mimetype = detectMimeType(buffer)

  if (mimetype === IMAGE.JPEG || mimetype === IMAGE.JPG) {
    return stripJPEG(buffer, opts)
  }

  throw new Error(`metadata strip(): unsupported type ${mimetype}`)
}

class ImageMetadataPipeline {
  constructor(input, opts = {}) {
    this.input = input
    this.steps = []
    this.read = opts.read
    this.write = opts.save

    // Add future chainable metadata edit methods here, like set() or remove().
    const methods = ['strip']
    for (let method of methods) {
      this[method] = (opts) => {
        this.steps.push({ op: method, opts })
        return this
      }
    }
  }

  async then(resolve, reject) {
    try {
      let buffer = await this.read(this.input)

      for (const step of this.steps) {
        if (step.op === 'strip') {
          buffer = await strip(buffer, step.opts)
        }
      }

      resolve(buffer)
    } catch (err) {
      reject(err)
    }
  }

  async save(filename, opts) {
    const buffer = await this
    return this.write(filename, buffer, opts)
  }
}

metadata.strip = strip

export { metadata, ImageMetadataPipeline }
