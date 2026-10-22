import type { ChildWindow } from './runtime'
export const childWindows = new Map<number, {winObj: ChildWindow; overlay: boolean}>()
export function rememberChild(winObj: ChildWindow, overlay: boolean) {
  const webContentsId = winObj.webContents.id
  if (!Number.isInteger(webContentsId)) throw new Error('子窗口缺少 webContents.id')
  childWindows.set(webContentsId, {winObj, overlay})
}
