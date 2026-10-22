import { childWindows, rememberChild } from './childWindows'
import { host, type ChildWindow } from './runtime'
import { controlPosition, displayFor } from './windowGeometry'
import type { PreviewStatus } from './scrollPreview'
import type { ManualControl } from './manualCapture'
type Panel = Awaited<ReturnType<typeof createScrollControl>>
const active = new Map<string, Promise<Panel>>()
const controls = new Map<number, (cancel:boolean)=>void>()
export function finishControl(senderId:number, cancel:boolean) {
  const stop=controls.get(senderId)
  if (!stop) throw new Error('滚动控制会话已结束')
  stop(cancel)
}
export function showWithoutFocus(win: ChildWindow) {
  if (typeof win.showInactive === 'function') win.showInactive()
  else if (typeof win.setFocusable === 'function') {
    win.setFocusable(false)
    try {win.show()} finally {win.setFocusable(true)}
  } else throw new Error('当前宿主不支持无焦点显示控制浮窗')
}
export function openScrollControl(rect: {x:number;y:number;w:number;h:number}, preview = false, sessionId = 'default') {
  const existing=active.get(sessionId)
  if(existing) return existing
  const panel=createScrollControl(rect,preview,sessionId)
  active.set(sessionId,panel)
  void panel.catch(()=>{if(active.get(sessionId)===panel) active.delete(sessionId)})
  return panel
}
async function createScrollControl(rect: {x:number;y:number;w:number;h:number}, preview:boolean, sessionId:string) {
  const region = {x:rect.x,y:rect.y,width:rect.w,height:rect.h}
  const position = controlPosition(region,displayFor(region,host.getAllDisplays()),preview)
  const {overlap,...bounds} = position
  const win = host.createBrowserWindow(preview ? 'dist/scrollctl.html?preview=1' : 'dist/scrollctl.html', {
    ...bounds,frame:false,alwaysOnTop:true,resizable:false,movable:false,skipTaskbar:true,
    focusable:true,show:false,opacity:overlap ? 0.8 : 1,webPreferences:{preload:'preload/services.js'},
  })
  let wake: (()=>void) | undefined
  const control: ManualControl = {stopped:false,canceled:false,wait(ms) {
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{wake=undefined;resolve()},ms)
      wake=()=>{clearTimeout(timer);wake=undefined;resolve()}
      if(control.stopped) wake()
    })
  }}
  controls.set(win.webContents.id,cancel=>{control.stopped=true;control.canceled=cancel;wake?.()})
  let closed=false
  function close() {
    if(closed) return
    closed=true
    active.delete(sessionId)
    controls.delete(win.webContents.id)
    childWindows.delete(win.webContents.id)
    try {win.destroy()} finally {wake?.()}
  }
  try {
    rememberChild(win,false)
    const deadline=Date.now()+10000
    while (true) {
      const ready=await win.webContents.executeJavaScript(`window.${preview ? '__preview' : '__ctlStatus'} ? ({phase:"ready"}) : ({phase:"loading"})`)
      if (ready?.phase==='ready') break
      if (Date.now()>deadline) throw new Error('控制浮窗加载超时')
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    showWithoutFocus(win)
  } catch(error) {close();throw error}
  return {control,overlap,win,close,async preview(status: PreviewStatus) {
    await win.webContents.executeJavaScript(`window.__preview(${JSON.stringify(status)})`)
  },async status(frames:number,idle:number,skipped=0,consecutive=0) {
    await win.webContents.executeJavaScript(`window.__ctlStatus(${JSON.stringify({frames,idle,skipped,consecutive})})`)
  }}
}
