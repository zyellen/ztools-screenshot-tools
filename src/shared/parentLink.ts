export interface ShotResult { ok: boolean; bounds?: import('./runtime').Rect; path?: string; error?: string; canceled?: boolean; permission?: boolean; warning?: string; frames?: number }
export function requestParent(type: string, payload: Record<string, unknown> = {}): Promise<ShotResult> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    window.__shotReplies ??= new Map()
    const timer = type === 'scrollshot' ? undefined : setTimeout(() => { window.__shotReplies?.delete(id); reject(new Error('父窗口请求超时，请重新打开插件')) }, 120000)
    window.__shotReplies.set(id, result => { clearTimeout(timer); resolve(result) })
    window.__shotReply = (replyId, result) => {
      const reply = window.__shotReplies?.get(replyId)
      window.__shotReplies?.delete(replyId); reply?.(result)
    }
    try { window.ztools.sendToParent('shot-request', { id, type, payload }) }
    catch (error) { clearTimeout(timer); window.__shotReplies.delete(id); reject(error) }
  })
}
export async function saveViaParent(dataUrl: string) {
  const result = await requestParent('save', {dataUrl})
  if (!result.ok && !result.canceled) throw new Error(result.error || '图片保存失败')
  return result.ok
}
export async function pinViaParent(dataUrl: string, rect: {x:number;y:number;width:number;height:number}) {
  const path = window.services.writeUniqueImageToTemp(dataUrl)
  if (!path) throw new Error('贴图写入失败')
  try {
    const result = await requestParent('pin', {path, x:rect.x,y:rect.y,w:rect.width,h:rect.height})
    if (!result.ok) throw new Error(result.error || '贴图创建失败')
  } catch (error) {
    try { window.services.removeTempImages([path]) } catch (cleanup) { console.error(cleanup) }
    throw error
  }
}
export function readOverlaySettings() {
  const stored = JSON.parse(new URLSearchParams(location.search).get('st') || '{}') as Record<string, unknown>
  return {ocrLang: typeof stored.ocrLang === 'string' ? stored.ocrLang : '', targetLang: typeof stored.targetLang === 'string' ? stored.targetLang : 'zh', autoCopy: stored.autoCopy === true}
}
