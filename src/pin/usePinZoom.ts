import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { requestParent } from '../shared/parentLink'
import { clampZoom, pinSize } from '../shared/windowGeometry'
import type { Rect } from '../shared/runtime'
export function usePinZoom() {
  const natural=shallowRef({width:0,height:0}), viewport=shallowRef({width:window.innerWidth,height:window.innerHeight})
  const zoom=shallowRef<number | null>(null), visible=shallowRef(false), fallback=shallowRef(false)
  const initial={width:window.innerWidth,height:window.innerHeight}
  let bounds:Rect={x:0,y:0,width:screen.width,height:screen.height}
  let timer:ReturnType<typeof setTimeout> | undefined, revision=0, resizeFailures=0
  const fit=computed(()=>Math.min(viewport.value.width/natural.value.width,viewport.value.height/natural.value.height))
  const ratio=computed(()=>zoom.value ?? fit.value)
  const imageStyle=computed(()=>{
    if (!natural.value.width) return {}
    const requested=ratio.value
    const displayed=fallback.value ? requested : Math.min(requested,fit.value)
    return {width:natural.value.width*displayed+'px',height:natural.value.height*displayed+'px'}
  })
  const percent=computed(()=>Math.round((fallback.value ? ratio.value : Math.min(ratio.value,fit.value))*100))
  function hint() {visible.value=true;clearTimeout(timer);timer=setTimeout(()=>{visible.value=false},2000)}
  function resized() {viewport.value={width:window.innerWidth,height:window.innerHeight}}
  async function resize(width:number,height:number) {
    const current=++revision
    function record(failed:boolean) {
      resizeFailures=failed ? resizeFailures+1 : 0
      fallback.value=resizeFailures>=2
    }
    try {window.resizeTo(width,height)} catch {record(true);return}
    await new Promise(resolve=>setTimeout(resolve,100))
    if(current!==revision) return
    resized()
    record(Math.abs(window.innerWidth-width)>2 || Math.abs(window.innerHeight-height)>2)
  }
  async function updateBounds() {
    try {
      const result=await requestParent('pin-info',{x:window.screenX,y:window.screenY,width:window.innerWidth,height:window.innerHeight})
      if(result.ok && result.bounds) bounds=result.bounds
    } catch { /* Screen API bounds remain a safe fallback. */ }
  }
  async function wheel(event:WheelEvent) {
    event.preventDefault();event.stopPropagation()
    if(!natural.value.width || !event.deltaY) return
    // Each step starts from the displayed ratio, including screen clamping.
    const base=fallback.value ? ratio.value : Math.min(ratio.value,fit.value)
    zoom.value=clampZoom(base*(event.deltaY>0 ? 1/1.1 : 1.1))
    hint()
    await updateBounds()
    const size=pinSize(natural.value.width,natural.value.height,zoom.value,bounds)
    await resize(size.width,size.height)
  }
  function loaded(event:Event) {
    const img=event.target as HTMLImageElement
    natural.value={width:img.naturalWidth,height:img.naturalHeight}
  }
  async function reset() {zoom.value=null;fallback.value=false;hint();await resize(initial.width,initial.height)}
  // The image is a no-drag region so wheel/double-click reach Chromium. Forward
  // pointer movement to the parent instead of relying on native drag hit-testing.
  let drag:{x:number;y:number;left:number;top:number} | undefined
  function down(event:PointerEvent) {
    if(event.button!==0 || (event.target as HTMLElement).closest('nav')) return
    drag={x:event.screenX,y:event.screenY,left:window.screenX,top:window.screenY}
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function move(event:PointerEvent) {
    if(!drag || !(event.buttons&1)) return
    void requestParent('pin-move',{x:drag.left+event.screenX-drag.x,y:drag.top+event.screenY-drag.y,width:window.innerWidth,height:window.innerHeight}).catch(()=>{})
  }
  function up() {drag=undefined}
  onMounted(()=>{window.addEventListener('resize',resized);void updateBounds()})
  onUnmounted(()=>{revision++;clearTimeout(timer);window.removeEventListener('resize',resized)})
  return {imageStyle,percent,visible,wheel,loaded,reset,down,move,up}
}
