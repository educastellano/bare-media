import { createReadStream } from 'bare-fs'
import { access, readdir, readFile } from 'bare-fs/promises'
import { createHash } from 'bare-crypto'
import barePath from 'bare-path'
import { spawnSync } from 'bare-subprocess'

const drive = 'qm5bc1h7ooaeiiiagzaiiq7qh5ecs9ob1ufm98qr8zwsg7rauabo'
const samplesDir = barePath.join('test', 'samples')

await main()

async function main() {
  if (await download()) {
    await verify()
  }
}

async function download() {
  try {
    await access(barePath.join(samplesDir, 'files'))
    return false
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  const { status, signal } = spawnSync(
    'node',
    [
      barePath.join('node_modules', 'drives', 'bin.js'),
      'mirror',
      '--storage',
      barePath.join('node_modules', '.cache', 'drives'),
      drive,
      barePath.join(samplesDir, 'files')
    ],
    { stdio: 'inherit' }
  )

  if (status !== 0) {
    throw new Error(`Failed to download sample files${signal ? ` (${signal})` : ''}`)
  }

  return true
}

async function verify() {
  const suitesDir = barePath.join(samplesDir, 'suites')
  let verified = 0

  for (const suiteFile of (await readdir(suitesDir)).sort()) {
    if (!suiteFile.endsWith('.json')) continue

    const suite = JSON.parse(await readFile(barePath.join(suitesDir, suiteFile), 'utf8'))
    if (!suite.catalog) continue

    for (const sample of suite.catalog.samples || []) {
      const filename = barePath.join(samplesDir, suite.catalog.path, sample.path)
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
