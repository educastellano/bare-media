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

function formatMetadata(value, opts = {}) {
  const { prefix = '', json = false } = opts

  if (json) return JSON.stringify(value, null, 2)

  const lines = []

  for (const [key, entry] of Object.entries(value)) {
    if (entry && typeof entry === 'object') {
      if (Buffer.isBuffer(entry)) {
        lines.push(`${prefix}${key}: ${entry.toString()}`)
      } else {
        lines.push(`${prefix}${key}:`)

        if (Array.isArray(entry)) {
          for (const value of entry) {
            lines.push(formatMetadata(value, { prefix: `${prefix}  ` }))
          }
        } else {
          lines.push(formatMetadata(entry, { prefix: `${prefix}  ` }))
        }
      }
    } else {
      lines.push(`${prefix}${key}: ${String(entry)}`)
    }
  }

  return lines.filter(Boolean).join('\n')
}

export { cleanMetadata, formatMetadata }
