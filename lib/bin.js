function cleanMetadata(value) {
  if (Buffer.isBuffer(value)) {
    const byteLength = value.byteLength
    const text = value.toString()
    const printable = !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)

    return byteLength > 0 && printable && Buffer.from(text).equals(value)
      ? text
      : `<binary data: ${byteLength} ${byteLength === 1 ? 'byte' : 'bytes'}>`
  }

  if (Array.isArray(value)) return value.map(cleanMetadata)

  if (value && typeof value === 'object') {
    const data = {}
    for (const [key, entry] of Object.entries(value)) {
      data[key] = cleanMetadata(entry)
    }
    return data
  }

  return value
}

export { cleanMetadata }
