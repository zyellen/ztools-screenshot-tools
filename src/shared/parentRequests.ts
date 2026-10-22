import { finishControl } from './scrollControl'
import { displayFor, pinSize } from './windowGeometry'
import { host, isWindowGone, errorText, toast } from './runtime'
import { childWindows, rememberChild } from './childWindows'
import { captureScrolling, cancelScrolling, type ScrollRect } from './scrollCapture'
import type { ShotResult } from './parentLink'
let scrolling = false
export async function handleShotRequest(request: {id:string;type:string;payload:Record<string,unknown>}, senderId:number) {
  const child = childWindows.get(senderId)
  if (!child || !request || typeof request.id !== 'string') return
  let result: ShotResult
  const payload = request.payload || {}
  try {
    if (request.type === 'scrollshot-cancel') {
      if (!child.overlay) throw new Error('仅截图窗口可取消滚动截图')
      await cancelScrolling()
      result={ok:true,canceled:true}
    } else if (request.type === 'ctl-finish' || request.type === 'ctl-cancel') {
      finishControl(senderId,request.type === 'ctl-cancel')
      result={ok:true}
    } else if (request.type === 'pin-move') {
      if(child.overlay) throw new Error('仅贴图可移动窗口')
      const [x,y,width,height]=[payload.x,payload.y,payload.width,payload.height].map(Number)
      if(![x,y,width,height].every(Number.isFinite) || width<1 || height<1) throw new Error('无效窗口位置')
      await child.winObj.setBounds({x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)})
      result={ok:true}
    } else if (request.type === 'pin-info') {
      if (child.overlay) throw new Error('仅贴图可查询窗口')
      const rect={x:Number(payload.x),y:Number(payload.y),width:Number(payload.width),height:Number(payload.height)}
      result={ok:true,bounds:displayFor(rect,host.getAllDisplays())}
    } else if (request.type === 'rebind-geometry') {
      if (!child.overlay) return
      const [x,y,width,height] = [payload.dx,payload.dy,payload.dw,payload.dh].map(Number)
      if ([x,y,width,height].every(Number.isFinite) && width > 0 && height > 0) {
        try { await child.winObj.setBounds({x,y,width,height}) } catch {}
      }
      result = {ok:true}
    } else if (request.type === 'pin') {
      const path = String(payload.path || '')
      try {
        if (!path || !window.services.readImageAsDataUrl(path)) throw new Error('贴图文件不可读')
        const [x,y,w,h] = [payload.x,payload.y,payload.w,payload.h].map(Number)
        if (![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('无效贴图区域')
        const bounds = displayFor({x,y,width:w,height:h},host.getAllDisplays())
        const size = pinSize(w,h,1,bounds)
        const winObj = host.createBrowserWindow(`dist/pin.html?${new URLSearchParams({src:path})}`, {
          x:Math.round(x),y:Math.round(y),width:size.width,height:size.height,frame:false,alwaysOnTop:true,resizable:true,skipTaskbar:true,hasShadow:true,
          webPreferences:{preload:'preload/services.js'},
        })
        try {
          rememberChild(winObj,false)
          const deadline = Date.now()+15000
          for (;;) {
            const status = await winObj.webContents.executeJavaScript('window.__shotStatus ? window.__shotStatus() : ({phase:"loading"})')
            if (status?.phase === 'ready') break
            if (status?.phase === 'error') throw new Error(status.error || '贴图加载失败')
            if (Date.now() > deadline) throw new Error('贴图加载超时')
            await new Promise(resolve=>setTimeout(resolve,100))
          }
        } catch(error) {
          childWindows.delete(winObj.webContents.id)
          try {winObj.destroy()} catch(cleanup) {console.error(cleanup)}
          throw error
        } finally {window.services.removeTempImages([path])}
        result = {ok:true}
      } catch(error) {
        if (path) window.services.removeTempImages([path])
        throw error
      }
    } else if (request.type === 'save') {
      const data = typeof payload.dataUrl === 'string' ? payload.dataUrl : window.services.readImageAsDataUrl(String(payload.path || ''))
      if (!data) throw new Error('保存图片读取失败')
      result = window.services.saveImage(data)
    } else if (request.type === 'scrollshot') {
      if (!child.overlay) throw new Error('仅截图窗口可启动滚动截图')
      if (scrolling) {
        await cancelScrolling()
        throw new Error('另一块屏正在滚动截图，已为你取消，请重试')
      }
      scrolling = true
      try {result = await captureScrolling(payload as unknown as ScrollRect)} finally {scrolling = false}
    } else if (request.type === 'accessibility') {
      const opened = await host.shellOpenExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      result = {ok:opened.success,error:opened.error}
    } else throw new Error('未知截图请求')
  } catch(error) {result = {ok:false,error:errorText(error)}}
  try {
    await child.winObj.webContents.executeJavaScript(`window.__shotReply(${JSON.stringify(request.id)}, ${JSON.stringify(result)})`)
  } catch(error) {
    if (request.type === 'scrollshot' && result.path) {
      try {window.services.removeTempImages([result.path])} catch(cleanup) {console.error(cleanup)}
    }
    childWindows.delete(senderId);if (!isWindowGone(error)) toast(errorText(error),'error')
  }
}
