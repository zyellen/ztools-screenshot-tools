import { createPackage, listPackage, extractFile } from '@electron/asar'
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = mkdtempSync(path.join(tmpdir(), 'ztools-package-'))
const output = path.join(root, 'release', 'ztools-screenshot-tools-0.5.3.zpx')
try {
  const archive = path.join(temporary, 'plugin.asar')
  await createPackage(path.join(root, 'src-ztools'), archive)
  const compressed = brotliCompressSync(readFileSync(archive), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
  const verification = path.join(temporary, 'verified.asar')
  writeFileSync(verification, brotliDecompressSync(compressed))
  const entries = listPackage(verification)
  for (const entry of ['/plugin.json', '/dist/index.html', '/dist/overlay.html', '/dist/pin.html', '/dist/scrollctl.html', '/preload/services.js']) {
    if (!entries.includes(entry)) throw new Error(`包内缺少 ${entry}`)
  }
  const manifest = JSON.parse(extractFile(verification, 'plugin.json').toString())
  if (manifest.version !== '0.5.3') throw new Error('插件版本校验失败')
  const distManifest = JSON.parse(extractFile(verification, 'dist/plugin.json').toString())
  const packageManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (distManifest.version !== manifest.version || packageManifest.version !== manifest.version) throw new Error('源码与 dist 版本不一致')
  if (!extractFile(verification, 'preload/services.js').equals(extractFile(verification, 'dist/preload/services.js'))) throw new Error('源码与 dist preload 不一致')
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, compressed)
  console.log(`ZPX 自校验通过：${output} (${compressed.length} bytes, ${entries.length} entries, version ${manifest.version})`)
} finally { rmSync(temporary, { recursive: true, force: true }) }
