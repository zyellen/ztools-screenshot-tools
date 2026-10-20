const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

const dataUrlPattern = /^data:image\/([a-z0-9]+);base64,/i

const services = {
  // 读文件
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },
  // 文本写入到下载目录
  writeTextFile(text) {
    const filePath = path.join(window.ztools.getPath('downloads'), Date.now().toString() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },
  // 图片写入到下载目录
  writeImageFile(base64Url) {
    const matchs = dataUrlPattern.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(
      window.ztools.getPath('downloads'),
      Date.now().toString() + '.' + matchs[1]
    )
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },
  saveImage(dataUrl) {
    const match = dataUrlPattern.exec(dataUrl)
    if (!match) return { ok: false, error: 'Invalid image data URL' }

    const defaultPath = path.join(
      window.ztools.getPath('downloads'),
      `screenshot-${Date.now()}.png`
    )
    const filePath = window.ztools.showSaveDialog({ defaultPath })
    if (filePath === undefined) return { ok: false, canceled: true }

    try {
      fs.writeFileSync(filePath, Buffer.from(dataUrl.substring(match[0].length), 'base64'))
      return { ok: true, path: filePath }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  },
  readImageAsDataUrl(filePath) {
    try {
      const extension = path.extname(filePath).slice(1).toLowerCase()
      const mime = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension
      if (!['png', 'jpeg', 'jpg', 'webp', 'gif', 'bmp'].includes(extension)) return null

      const base64 = fs.readFileSync(filePath).toString('base64')
      return `data:image/${mime};base64,${base64}`
    } catch {
      return null
    }
  },
  writeImageToTemp(dataUrl, ext = 'png') {
    try {
      const match = dataUrlPattern.exec(dataUrl)
      if (!match) return null

      const extension = String(ext).toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!extension) return null

      const directory = path.join(os.tmpdir(), 'ztools-shot')
      fs.mkdirSync(directory, { recursive: true })
      const filePath = path.join(directory, `shot-${Date.now()}.${extension}`)
      fs.writeFileSync(filePath, Buffer.from(dataUrl.substring(match[0].length), 'base64'))
      return filePath
    } catch {
      return null
    }
  },
  async captureScreenInteractive() {
    if (process.platform !== 'darwin') return { ok: false, error: 'unsupported' }

    let tmpPath = ''
    let timedOut = false

    try {
      tmpPath = path.join(os.tmpdir(), `ztools-shot-${Date.now()}.png`)

      const execError = await new Promise<Error | null>((resolve) => {
        const child = execFile('/usr/sbin/screencapture', ['-i', '-x', tmpPath], (error) => {
          clearTimeout(timeoutId)
          resolve(error || null)
        })
        const timeoutId = setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, 180000)
      })

      if (timedOut) {
        try {
          fs.rmSync(tmpPath, { force: true })
        } catch {}
        return { ok: false, error: '截图超时' }
      }
      if (execError) return { ok: false, error: execError.message }

      const stat = fs.statSync(tmpPath, { throwIfNoEntry: false })
      if (!stat?.isFile() || stat.size <= 0) {
        fs.rmSync(tmpPath, { force: true })
        return { ok: false, canceled: true }
      }

      const dataUrl = `data:image/png;base64,${fs.readFileSync(tmpPath).toString('base64')}`
      fs.rmSync(tmpPath, { force: true })
      return { ok: true, dataUrl }
    } catch (error) {
      if (tmpPath) {
        try {
          fs.rmSync(tmpPath, { force: true })
        } catch {}
      }
      return { ok: false, error: error && error.message ? error.message : String(error) }
    }
  },
}

if (typeof window !== 'undefined') {
  window.services = services
}

module.exports = services
