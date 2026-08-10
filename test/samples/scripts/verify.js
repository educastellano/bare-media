import { createReadStream } from 'bare-fs'
import { readdir, readFile } from 'bare-fs/promises'
import { createHash } from 'bare-crypto'
import barePath from 'bare-path'

await main()

async function main() {
  const suitesDir = barePath.join('test', 'samples', 'suites')
  let verified = 0

  for (const suiteFile of (await readdir(suitesDir)).sort()) {
    if (!suiteFile.endsWith('.json')) continue

    const suite = JSON.parse(await readFile(barePath.join(suitesDir, suiteFile), 'utf8'))
    if (!suite.catalog) continue

    for (const sample of suite.catalog.samples || []) {
      const filename = barePath.join('test', 'samples', suite.catalog.path, sample.path)
      const actual = await sha256(filename)

      if (actual !== sample.sha256) {
        throw new Error(`${filename}: expected ${sample.sha256}, got ${actual}`)
      }

      verified++
    }
  }

  console.log(`Verified ${verified} sample files`)
}

async function sha256(filename) {
  const hash = createHash('sha256')

  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}
