import type { ChildWindow } from './runtime'
import { isWindowGone } from './runtime'
// One rollback path handles success, cancellation, deadline and exceptions.
export async function prepareCapture(children: {winObj:ChildWindow;overlay:boolean}[], manual:boolean) {
  const overlays=children.filter(child=>child.overlay)
  const hidden: ChildWindow[]=[]
  async function state(win:ChildWindow, value:'active'|'idle') {
    await win.webContents.executeJavaScript(`if (!window.__shotCaptureState) throw new Error('overlay capture state unavailable'); window.__shotCaptureState('${value}')`)
  }
  async function reset() {
    for (const {winObj} of overlays) {
      try {await winObj.setIgnoreMouseEvents?.(false)} catch(error) {console.error('restore mouse events',error)}
      try {await state(winObj,'idle')} catch(error) {if (!isWindowGone(error)) console.error('restore overlay state',error)}
    }
  }
  let live=manual
  if (manual) {
    // Try every overlay, even when another display fails. Roll all of them back on failure.
    for (const {winObj} of overlays) {
      try {
        if (!winObj.setIgnoreMouseEvents) throw new Error('setIgnoreMouseEvents unavailable')
        await winObj.setIgnoreMouseEvents(true,{forward:true})
        await state(winObj,'active')
      } catch(error) {live=false;console.error('manual capture falling back to hidden overlays',error)}
    }
    if (!live) await reset()
  }
  for (const {winObj,overlay} of children) {
    if (live && overlay) continue
    if (overlay && !manual) {
      try {await state(winObj,'idle')} catch(error) {if (!isWindowGone(error)) console.error('reset overlay before hiding',error)}
    }
    hidden.push(winObj)
    try {winObj.hide()} catch(error) {if (!isWindowGone(error)) console.error('hide child window',error)}
  }
  return {live,async restore() {
    if (manual) await reset()
    for (const win of hidden) {
      try {win.show()} catch(error) {if (!isWindowGone(error)) console.error('restore child window',error)}
    }
  }}
}
