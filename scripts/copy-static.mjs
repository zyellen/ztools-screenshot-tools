import { cpSync, mkdirSync, rm } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.join(rootDir, 'src-ztools')
const distDir = path.join(sourceDir, 'dist')
const staticEntries = [
  ['plugin.json', 'plugin.json'],
  ['logo.png', 'logo.png'],
  ['preload', 'preload'],
]

function removeTarget(target) {
  return new Promise((resolve, reject) => {
    rm(target, { recursive: true, force: true }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

await Promise.all(
  staticEntries.map(([, target]) => removeTarget(path.join(distDir, target)))
)

mkdirSync(distDir, { recursive: true })
for (const [source, target] of staticEntries) {
  cpSync(path.join(sourceDir, source), path.join(distDir, target), { recursive: true })
}
