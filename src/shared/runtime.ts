export interface Rect { x: number; y: number; width: number; height: number }
export interface Display { id: number; bounds: Rect; scaleFactor: number }
export interface ChildWindow {
  hide(): void
  show(): void
  showInactive?(): void
  setFocusable?(value: boolean): void
  setIgnoreMouseEvents?(ignore: boolean, options?: {forward:boolean}): void | Promise<void>
  destroy(): void
  setBounds(bounds: Rect): void
  webContents: { id: number; executeJavaScript(code: string): Promise<{ phase?: string; error?: string }> }
}
export interface Host {
  hideMainWindow(): void
  showMainWindow(): void
  getAllDisplays(): Display[]
  getPrimaryDisplay(): { workAreaSize?: { width: number; height: number }; size?: { width: number; height: number } }
  desktopCaptureSources(options: unknown): Promise<{ display_id: string; thumbnail: { toDataURL(): string } }[]>
  createBrowserWindow(url: string, options: Record<string, unknown>): ChildWindow
  shellOpenExternal(url: string): Promise<{success: boolean; error?: string}>
  copyImage(image: string): boolean
  copyText(text: string): boolean
  ocr(image: string, options: { lang?: string }): Promise<{ text?: string }>
  translate(text: string, options: { to: string }): Promise<{ text?: string }>
  dbStorage: { getItem(key: string): unknown }
  showToast(message: string, options?: { type: string }): void
  redirectAiModelsSetting(): void
}
export const host = window.ztools as unknown as Host
export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error) }
export function isWindowGone(error: unknown) { return /window not exist|不存在|已关闭|destroyed/i.test(errorText(error)) }
export function toast(message: string, type = 'info') {
  try { host.showToast(message, { type }) } catch (error) { console.error(message, error) }
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败'))
    image.src = src
  })
}
export function copyImage(image: string) {
  if (!host.copyImage(image)) throw new Error('图片复制失败')
  toast('图片已复制', 'success')
}
export function saveImage(image: string) {
  const result = window.services.saveImage(image)
  if (result.canceled) return false
  if (!result.ok) throw new Error(result.error || '图片保存失败')
  toast('图片已保存', 'success')
  return true
}
export function readSettings() {
  const stored = host.dbStorage.getItem('screenshot-tools-settings') as Record<string, unknown> | null
  return { ocrLang: typeof stored?.ocrLang === 'string' ? stored.ocrLang : '', targetLang: typeof stored?.targetLang === 'string' ? stored.targetLang : 'zh', autoCopy: stored?.autoCopy === true }
}
