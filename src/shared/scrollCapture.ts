import { prepareCapture } from './capturePresentation'
import { createScrollPreview } from './scrollPreview'
import { collectManual } from './manualCapture'
import { createManualStitch, SKIP_TOAST } from './manualStitch'
import { openScrollControl, showWithoutFocus } from './scrollControl'
import { childWindows } from './childWindows'
import { errorText, isWindowGone, loadImage, toast } from './runtime'
import { stitchOffsets, unchangedRun, samplePixels, type FrameSample } from './stitch'
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve,ms))
export type ScrollMethod = 'manual' | 'wheel' | 'pageDown' | 'arrowDown'
export interface ScrollRect { x:number; y:number; w:number; h:number; method?:ScrollMethod; maxFrames:number; targetApp?:string }
async function readFrame(path: string) {
  const data = window.services.readImageAsDataUrl(path)
  if (!data) throw new Error('滚动帧读取失败')
  return loadImage(data)
}
function sample(image: HTMLImageElement): FrameSample {
  const width = image.naturalWidth, height = image.naturalHeight
  return samplePixels(width,height,pixels(image))
}
// Manual deduplication and the automatic initial check use full pixels; stitching uses 2x2 block averages.
function pixels(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
  const ctx = canvas.getContext('2d');if (!ctx) throw new Error('像素读取失败')
  ctx.drawImage(image,0,0)
  return ctx.getImageData(0,0,canvas.width,canvas.height).data
}
export function noScrollError(targetApp?: string, method: ScrollMethod = 'wheel', trusted?: boolean) {
  if (trusted === false) return '未检测到滚动：ZTools 未获得「辅助功能」权限，模拟事件被系统丢弃。请在 系统设置 → 隐私与安全性 → 辅助功能 中勾选 ZTools 后重试。'
  const hint = method === 'wheel'
    ? '请确认选区内容是滚动区域而非固定面板，并检查辅助功能授权。'
    : method === 'pageDown'
      ? '请尝试改用方向键，并检查目标窗口的键盘焦点。'
      : '请尝试改用 Page Down 方式。'
  return `未检测到滚动（目标：${targetApp || '前台窗口'}）。请确认该窗口内容可滚动（也可能已到内容末尾）。${hint}`
}
const canceled = Symbol('scrollshot canceled')
let session: {abort:AbortController; done:Promise<unknown>} | undefined
export async function cancelScrolling() {
  const current=session
  if (!current) return
  current.abort.abort()
  await current.done.catch(()=>{})
}
export function captureScrolling(rect: ScrollRect) {
  if(session) throw new Error('已有滚动截图正在进行')
  const current={abort:new AbortController(),done:Promise.resolve() as Promise<unknown>}
  session=current
  current.done=runCapture(rect,current.abort.signal).catch(error=>{
    if(error===canceled) return {ok:false,canceled:true}
    throw error
  }).finally(()=>{if(session===current) session=undefined})
  return current.done as ReturnType<typeof runCapture>
}
async function runCapture(rect: ScrollRect, signal:AbortSignal) {
  function check() {if(signal.aborted) throw canceled}
  async function waiting<T>(pending:Promise<T>):Promise<T> {
    check()
    let abort:()=>void=()=>{}
    const stop=new Promise<never>((_,reject)=>{abort=()=>reject(canceled);signal.addEventListener('abort',abort,{once:true})})
    try {return await Promise.race([pending,stop])} finally {signal.removeEventListener('abort',abort)}
  }
  async function captureRegion() {
    check()
    return waiting(window.services.captureRegion(rect.x,rect.y,rect.w,rect.h).then(result=>{
      if(signal.aborted && result.path) window.services.removeTempImages([result.path])
      return result
    }))
  }
  const method = rect.method ?? 'manual'
  const keyCode = method === 'pageDown' ? 121 : 125
  if (window.services.platform !== 'darwin') throw new Error('滚动截图当前仅支持 macOS')
  if (![rect.x,rect.y,rect.w,rect.h].every(Number.isFinite) || rect.w < 1 || rect.h < 1 || !['manual','wheel','pageDown','arrowDown'].includes(method)) throw new Error('无效滚动截图参数')
  const paths: string[] = [], frames: FrameSample[] = [], kept: string[] = []
  const children = [...childWindows.values()]
  let presentation: Awaited<ReturnType<typeof prepareCapture>> | undefined
  let previous: FrameSample | undefined, unchanged = 0
  let trusted: boolean | undefined
  let firstPixels: Uint8ClampedArray | undefined
  let ctl: Awaited<ReturnType<typeof openScrollControl>> | undefined
  try {
    presentation=await prepareCapture(children,method === 'manual')
    await waiting(delay(400))
    if (method === 'manual') {
      ctl = await openScrollControl(rect,presentation.live,crypto.randomUUID())
      check()
      const onCancel=()=>{ctl!.control.canceled=true;ctl!.control.stopped=true}
      signal.addEventListener('abort',onCancel,{once:true})
      const preview=presentation.live ? createScrollPreview(ctl.preview) : undefined
      const guard=createManualStitch()
      let dimensions: {width:number;height:number} | undefined
      const selected = await waiting(collectManual({control:ctl.control,maxFrames:rect.maxFrames,
        async capture() {
          if (ctl.overlap) {ctl.win.hide();await delay(120)}
          try {
            if (ctl.control.stopped) return {value:null,pixels:new Uint8ClampedArray()}
            const capture=await captureRegion()
            if (!capture.ok || !capture.path) throw new Error(capture.error || '区域截图失败')
            // A native capture may finish after the hard deadline and final cleanup.
            if (ctl.control.stopped) {
              window.services.removeTempImages([capture.path])
              return {value:null,pixels:new Uint8ClampedArray()}
            }
            paths.push(capture.path)
            const image=await waiting(readFrame(capture.path)), frame=sample(image)
            if (dimensions && (dimensions.width!==frame.width || dimensions.height!==frame.height)) throw new Error('截图尺寸发生变化，请重新框选')
            dimensions=frame
            return {value:{path:capture.path,frame,image},pixels:pixels(image)}
          } finally {
            if (ctl.overlap && !ctl.control.stopped) showWithoutFocus(ctl.win)
          }
        },
        discard:item=>{if (item) window.services.removeTempImages([item.path])},
        accepted:async item=>{
          if (!item) return
          const result=guard.accept(item.frame)
          if (!result.accepted) {
            if (guard.skipped===1) toast(SKIP_TOAST,'warning')
            if (guard.consecutive>=8) ctl.control.stopped=true
            if (preview) await preview.skipped(guard.skipped,guard.consecutive)
            return false
          }
          if (preview) await preview.append(item.image,item.frame,result.offset,item.frame.height,guard.skipped,guard.consecutive)
        },
        status:presentation.live ? async()=>{} : (frames,idle)=>ctl.status(frames,idle,guard.skipped,guard.consecutive),
      }))
      check()
      signal.removeEventListener('abort',onCancel)
      if (!selected) return {ok:false,canceled:true}
      for (const item of selected) {frames.push(item.frame);kept.push(item.path)}
    } else {
      if (method !== 'wheel' && rect.targetApp) {
        const activation = await window.services.activateApp(rect.targetApp)
        if (!activation.ok) {
          console.error('activateApp', activation.error)
          throw new Error(`无法自动把焦点还给 ${rect.targetApp}，请在开始前手动点击该窗口再重试`)
        }
        await delay(300)
      }
      const maxFrames = Math.min(30,Math.max(1,Math.floor(rect.maxFrames) || 30))
      for (let i=0;i<maxFrames;i++) {
        check()
        const capture = await captureRegion()
        if (!capture.ok || !capture.path) throw new Error(capture.error || '区域截图失败')
        paths.push(capture.path)
        const image = await waiting(readFrame(capture.path))
        const frame = sample(image)
        if (i === 0) firstPixels = pixels(image)
        let changed = true
        if (previous) {
          if (previous.width !== frame.width || previous.height !== frame.height) throw new Error('截图尺寸发生变化，请重新框选')
          const state = unchangedRun(previous,frame,unchanged); unchanged = state.count
          if (i === 1 && firstPixels) {
            const currentPixels = pixels(image)
            const same = firstPixels.length === currentPixels.length && currentPixels.every((value,index)=>value === firstPixels![index])
            firstPixels = undefined
            if (same) {
              const error = noScrollError(rect.targetApp,method,trusted)
              if (trusted === false) return {ok:false,permission:true,error}
              throw new Error(error)
            }
          }
          if (state.stop) break
          changed = !state.unchanged
        }
        previous = frame
        if (changed) {frames.push(frame);kept.push(capture.path)}
        if (i+1 < maxFrames) {
          if (method === 'wheel') {
            const wheel = await window.services.scrollWheel(rect.x + rect.w/2, rect.y + rect.h/2, 3, 2)
            if (wheel.ok === false) {
              console.error('scrollWheel', wheel.error)
              if (wheel.permission) return {ok:false,permission:true,error:'ZTools 需要辅助功能权限，请在系统设置 → 隐私与安全性 → 辅助功能中授权 ZTools 后重试'}
              throw new Error(wheel.error || '滚轮事件发送失败')
            }
            trusted = wheel.trusted
          } else {
            const key = await window.services.pressKeyCode(keyCode,keyCode === 125 ? 3 : 1)
            if (!key.ok) {
              if (key.permission) return {ok:false,permission:true,error:'ZTools 需要辅助功能权限，请在系统设置 → 隐私与安全性 → 辅助功能中授权 ZTools 后重试'}
              throw new Error(key.error || '滚动按键发送失败')
            }
          }
          await waiting(delay(400))
        }
      }
    }
    check()
    const offsets = stitchOffsets(frames)
    let misses = 0, warning = ''
    for (let i=1;i<offsets.length;i++) {
      misses = offsets[i] === 0 ? misses+1 : 0
      if (misses >= 2) warning = '连续帧未找到重叠，拼接可能有接缝。请重新框选，避开固定页头和滚动条后重试。'
    }
    const height = frames.reduce((sum,frame,i) => sum+frame.height-offsets[i],0)
    const canvas = document.createElement('canvas'); canvas.width = frames[0].width; canvas.height = height
    const ctx = canvas.getContext('2d'); if (!ctx || !canvas.height) throw new Error('长图尺寸超限，请减少滚动帧数或缩小选区')
    let y = 0
    for (let i=0;i<kept.length;i++) {
      const image = await waiting(readFrame(kept[i])), cut = offsets[i], h = image.naturalHeight-cut
      if (h) ctx.drawImage(image,0,cut,image.naturalWidth,h,0,y,image.naturalWidth,h)
      y += h
    }
    check()
    const path = window.services.writeUniqueImageToTemp(canvas.toDataURL('image/png'))
    if (!path) throw new Error('长图写入失败（可能超出画布尺寸限制）')
    return {ok:true,path,frames:frames.length,warning}
  } finally {
    if (ctl) {try {ctl.close()} catch(error) {if (!isWindowGone(error)) toast(errorText(error),'warning')}}
    await presentation?.restore()
    try {window.services.removeTempImages(paths)} catch(error) {toast(errorText(error),'warning')}
  }
}
