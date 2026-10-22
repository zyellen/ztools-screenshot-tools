const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

const dataUrlPattern = /^data:image\/([a-z0-9]+);base64,/i
let shotListener
const services = {
  platform: process.platform,
  onShotRequest(handler) {
    const { ipcRenderer } = require('electron')
    if (shotListener) ipcRenderer.removeListener('__ipc_sendto_relay__', shotListener)
    shotListener = (_event, payload) => {
      if (payload?.channel === 'diag') {
        services.appendDiag(JSON.stringify({time:new Date().toISOString(),senderId:payload.senderId,...payload.args?.[0]}))
        return
      }
      if (payload?.channel !== 'shot-request') return
      try { Promise.resolve(handler(payload.args?.[0], payload.senderId)).catch(console.error) }
      catch (error) { console.error('shot-request', error) }
    }
    ipcRenderer.on('__ipc_sendto_relay__', shotListener)
  },
  appendDiag(text) {
    try {
      const directory = path.join(os.tmpdir(), 'ztools-shot')
      fs.mkdirSync(directory, {recursive:true})
      const file = path.join(directory, 'diag.log')
      fs.appendFileSync(file, String(text).replace(/[\r\n]+/g, ' ')+'\n')
      const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n')
      if (lines.length > 200) fs.writeFileSync(file, lines.slice(-200).join('\n')+'\n')
    } catch (error) { console.error('overlay diag', error) }
  },
  async frontmostApp() {
    if (process.platform !== 'darwin') return ''
    try {
      return await new Promise((resolve,reject) => execFile('/usr/bin/osascript', ['-e','tell application "System Events" to get name of first application process whose frontmost is true'], {timeout:5000}, (error,stdout) => error ? reject(error) : resolve(stdout.trim())))
    } catch { return '' }
  },
  async activateApp(name) {
    if (process.platform !== 'darwin' || typeof name !== 'string' || !name.trim()) return {ok:false,error:'无效目标应用'}
    const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
    try {
      await new Promise((resolve,reject) => execFile('/usr/bin/osascript', ['-e',`tell application "${escaped}" to activate`], {timeout:5000}, error => error ? reject(error) : resolve()))
      return {ok:true}
    } catch {
      try {
        await new Promise((resolve,reject) => execFile('/usr/bin/open', ['-a',name], {timeout:5000}, error => error ? reject(error) : resolve()))
        return {ok:true}
      } catch (error) {return {ok:false,error:String(error.message || error)}}
    }
  },
  async captureRegion(x, y, w, h) {
    let outPath
    try {
      if (![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('无效截图区域')
      let rx = Math.round(x), ry = Math.round(y)
      let rw = Math.max(1, Math.round(w)), rh = Math.max(1, Math.round(h))
      const displays = window.ztools.getAllDisplays().map(display => display.bounds)
      if (!displays.length) throw new Error('未取得显示器边界')
      const left = Math.ceil(Math.min(...displays.map(b => b.x)))
      const top = Math.ceil(Math.min(...displays.map(b => b.y)))
      const right = Math.floor(Math.max(...displays.map(b => b.x + b.width)))
      const bottom = Math.floor(Math.max(...displays.map(b => b.y + b.height)))
      const endX = Math.min(right, rx + rw), endY = Math.min(bottom, ry + rh)
      rx = Math.max(left, Math.min(right - 1, rx)); ry = Math.max(top, Math.min(bottom - 1, ry))
      rw = Math.max(1, endX - rx); rh = Math.max(1, endY - ry)
      const rectangle = `${rx},${ry},${rw},${rh}`
      outPath = path.join(os.tmpdir(), `ztools-region-${require('node:crypto').randomUUID()}.png`)
      const capture = quiet => new Promise((resolve, reject) => {
        const flags = quiet ? ['-x'] : []
        execFile('/usr/sbin/screencapture', [...flags, `-R${rectangle}`, outPath], {timeout:8000}, (error, _stdout, stderr) => {
          if (!error) return resolve()
          console.error('captureRegion failed', {rectangle, exitCode:error.code ?? null, signal:error.signal, timeout:!!error.killed, stderr})
          const failure = new Error(`区域截图失败: ${String(stderr || '').trim() || error.message}（命令: screencapture ${flags.join(' ')} -R ${rectangle}）`)
          failure.illegalOption = /illegal option/i.test(stderr || '')
          reject(failure)
        })
      })
      try { await capture(true) } catch (error) {
        if (!error.illegalOption) throw error
        fs.rmSync(outPath, {force:true})
        await capture(false)
      }
      if (!fs.statSync(outPath).size) throw new Error('区域截图为空')
      return {ok:true, path:outPath}
    } catch (error) {
      if (outPath) { try { fs.rmSync(outPath, {force:true}) } catch {} }
      return {ok:false, error:`${String(error.message || error)}；请在系统设置 → 隐私与安全 → 屏幕录制 中允许 ZTools`}
    }
  },
  async scrollWheel(x, y, lines = 3, times = 2) {
    try {
      if (process.platform !== 'darwin') throw new Error('滚动截图当前仅支持 macOS')
      if (![x,y,lines,times].every(Number.isFinite)) throw new Error('无效滚轮参数')
      lines = Math.min(10, Math.max(1, Math.floor(lines)))
      times = Math.min(10, Math.max(1, Math.floor(times)))
      const script = `ObjC.import("CoreGraphics");
ObjC.import("Foundation");
ObjC.import("ApplicationServices");
(function () {
  var trusted = $.AXIsProcessTrusted();
  var old = $.CGEventGetLocation($.CGEventCreate(null));
  // Flush the original position before warp so Node can recover after SIGTERM.
  var position = JSON.stringify({cursor:{x:old.x,y:old.y}}) + "\\n";
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(position).dataUsingEncoding($.NSUTF8StringEncoding));
  try {
    $.CGWarpMouseCursorPosition($.CGPointMake(${x}, ${y}));
    $.NSThread.sleepForTimeInterval(0.05);
    var source = $.CGEventSourceCreate($.kCGEventSourceStateHIDSystemState);
    for (var i = 0; i < ${times}; i++) {
      var event = $.CGEventCreateScrollWheelEvent(source, $.kCGScrollEventUnitLine, 1, -${lines});
      $.CGEventSetLocation(event, $.CGPointMake(${x}, ${y}));
      $.CGEventPost($.kCGHIDEventTap, event);
      if (i + 1 < ${times}) $.NSThread.sleepForTimeInterval(0.02);
    }
  } finally {
    $.CGWarpMouseCursorPosition(old);
  }
  return JSON.stringify({ok:true, trusted: !!trusted});
})()`
      const {error,stdout,stderr} = await new Promise(resolve => execFile('/usr/bin/osascript', ['-l','JavaScript','-e',script], {timeout:8000}, (error,stdout,stderr) => resolve({error,stdout,stderr})))
      const messages = String(stdout || '').trim().split(/\r?\n/).flatMap(line => {
        try {return [JSON.parse(line)]} catch {return []}
      })
      if (error?.killed) {
        const cursor = messages.find(message => message?.cursor)?.cursor
        if (cursor && [cursor.x,cursor.y].every(Number.isFinite)) {
          const restore = `ObjC.import("CoreGraphics"); $.CGWarpMouseCursorPosition($.CGPointMake(${cursor.x}, ${cursor.y}));`
          await new Promise(resolve => execFile('/usr/bin/osascript', ['-l','JavaScript','-e',restore], {timeout:1500}, restoreError => {
            if (restoreError) console.error('scrollWheel cursor restore failed', restoreError)
            resolve()
          }))
        } else console.error('scrollWheel cursor restore skipped: original position unavailable')
      }
      if (error) throw new Error(`${error.message}\n${stderr || ''}`)
      const result = messages.findLast(message => typeof message?.ok === 'boolean')
      if (result?.ok === true && typeof result.trusted === 'boolean') return {ok:true,trusted:result.trusted}
      if (result?.ok === false) return {ok:false,error:result.error || (result.permission ? '需要辅助功能权限' : '滚轮事件发送失败'),permission:result.permission === true}
      return {ok:false,error:'滚轮脚本返回无效结果'}
    } catch (error) { return {ok:false,error:String(error.message || error)} }
  },
  async pressKeyCode(code, repeat = 1) {
    try {
      if (![121,125].includes(code) || !Number.isInteger(repeat) || repeat < 1 || repeat > 3) throw new Error('无效滚动按键')
      const script = `tell application "System Events"\nrepeat ${repeat} times\nkey code ${code}\nend repeat\nend tell`
      await new Promise((resolve,reject) => execFile('/usr/bin/osascript', ['-e',script], {timeout:5000}, (error,_stdout,stderr) => error ? reject(new Error(`${error.message} ${stderr}`)) : resolve()))
      return {ok:true}
    } catch (error) {
      const message = String(error.message || error)
      return {ok:false, error:message, permission:/不允许发送按键|1002|not allowed to send keystrokes/i.test(message)}
    }
  },

  // New helpers keep existing service behavior intact and prevent same-ms collisions.
  writeUniqueImageToTemp(dataUrl) {
    const match = dataUrlPattern.exec(dataUrl)
    if (!match) return null
    const directory = path.join(os.tmpdir(), 'ztools-shot')
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `shot-${require('node:crypto').randomUUID()}.png`)
    fs.writeFileSync(file, Buffer.from(dataUrl.substring(match[0].length), 'base64'))
    return file
  },
  removeTempImages(files) {
    for (const file of files) {
      const resolved = path.resolve(file)
      const tempRoot = path.resolve(os.tmpdir()) + path.sep
      if (!resolved.startsWith(tempRoot)) throw new Error('只能清理临时目录图片')
      fs.rmSync(resolved, { force: true })
    }
  },
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

      const execError = await new Promise((resolve) => {
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
