import { childWindows, rememberChild } from './childWindows'
import { host, isWindowGone, errorText, loadImage, toast, readSettings, type ChildWindow } from './runtime'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
// Bound the whole query loop, including a slow frontmostApp subprocess, to 1s.
export async function pollTargetApp() {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let name = ''
    try {
      name = await Promise.race([
        window.services.frontmostApp(),
        new Promise<string>(resolve => { timer = setTimeout(() => resolve(''), Math.max(0, deadline - Date.now())) }),
      ])
    } finally { clearTimeout(timer) }
    name = name.trim()
    if (name && name.toLowerCase() !== 'ztools') return name
    const remaining = deadline - Date.now()
    if (remaining > 0) await delay(Math.min(100, remaining))
  }
  return ''
}
async function isBlack(source: string) {
  const image = await loadImage(source)
  if (!image.naturalWidth || !image.naturalHeight) return true
  const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('截图校验失败')
  ctx.drawImage(image, 0, 0, 48, 48)
  const pixels = ctx.getImageData(0, 0, 48, 48).data
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8)) return false
  return true
}
export async function runOverlaySession() {
  const windows: ChildWindow[] = []
  const paths: string[] = []
  try {
    const settings = readSettings()
    host.hideMainWindow()
    await delay(350)
    const targetApp = await pollTargetApp()
    const displays = host.getAllDisplays()
    if (!displays.length) throw new Error('未检测到显示器')
    // Request each display's physical resolution independently for mixed DPI setups.
    const captures = []
    for (const display of displays) {
      const sources = await host.desktopCaptureSources({ types: ['screen'], thumbnailSize: {
        width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor),
      } })
      const source = sources.find(item => String(item.display_id) === String(display.id))
      if (!source) throw new Error('未取得显示器截图')
      const image = source.thumbnail.toDataURL()
      if (await isBlack(image)) throw new Error('截图为空或全黑，请检查屏幕录制权限')
      const path = window.services.writeUniqueImageToTemp(image)
      if (!path) throw new Error('冻结截图写入失败')
      paths.push(path); captures.push({ display, path })
    }
    for (const { display, path } of captures) {
      const query = new URLSearchParams({ st: JSON.stringify(settings), src: path, scale: String(display.scaleFactor), dx: String(display.bounds.x), dy: String(display.bounds.y), dw: String(display.bounds.width), dh: String(display.bounds.height), ta: targetApp })
      const winObj = host.createBrowserWindow(`dist/overlay.html?${query}`, {
        ...display.bounds, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, resizable: false, movable: false,
        skipTaskbar: true, hasShadow: false, webPreferences: { preload: 'preload/services.js' },
      })
      windows.push(winObj)
      rememberChild(winObj, true)
    }
    const readyDeadline = Date.now() + 15000
    for (;;) {
      await delay(300)
      const statuses = await Promise.all(windows.map(async win => {
        try { return await win.webContents.executeJavaScript('window.__shotStatus ? window.__shotStatus() : ({phase:"loading"})') }
        catch {
          // A child closes itself after setting status; polling may see an already closed window.
          return { phase: 'aborted' }
        }
      }))
      if (Date.now() > readyDeadline && statuses.some(status => status?.phase === 'loading')) throw new Error('截图窗口加载超时')
      const failed = statuses.find(status => status?.phase === 'error')
      if (failed) throw new Error(failed.error || '截图窗口加载失败')
      if (statuses.some(status => status?.phase === 'done' || status?.phase === 'aborted')) return
    }
  } finally {
    for (const win of windows) {
      childWindows.delete(win.webContents.id)
      try { win.destroy() } catch (error) { if (!isWindowGone(error)) toast(errorText(error), 'warning') }
    }
    if (paths.length) window.services.removeTempImages(paths)
  }
}
