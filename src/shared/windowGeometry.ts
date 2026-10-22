import type { Rect } from './runtime'
export const clampZoom = (zoom: number) => Math.min(5, Math.max(0.1, zoom))
export function pinSize(w: number, h: number, zoom: number, bounds: Rect) {
  // Apply minimums with one scale, then let display bounds override them uniformly.
  const minimumScale = Math.max(clampZoom(zoom), 120 / w, 80 / h)
  const scale = Math.min(minimumScale, bounds.width / w, bounds.height / h)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}
export function displayFor(rect: Rect, displays: {bounds: Rect}[]): Rect {
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
  const display = displays.find(({bounds:b}) => cx >= b.x && cx < b.x+b.width && cy >= b.y && cy < b.y+b.height) || displays[0]
  if (!display) throw new Error('未检测到显示器')
  return display.bounds
}
export function controlPosition(rect: Rect, screen: Rect, preview = false) {
  const width = Math.min(preview ? 240 : 200, screen.width), height = Math.min(preview ? 390 : 52, screen.height), gap = 16
  const clampX = (x: number) => Math.round(Math.max(screen.x, Math.min(screen.x+screen.width-width, x)))
  const clampY = (y: number) => Math.round(Math.max(screen.y, Math.min(screen.y+screen.height-height, y)))
  const x = clampX(rect.x+(rect.width-width)/2), y = clampY(rect.y+(rect.height-height)/2)
  const candidates = [
    {x,y:Math.ceil(rect.y+rect.height+gap)}, {x,y:Math.floor(rect.y-gap-height)},
    {x:Math.ceil(rect.x+rect.width+gap),y}, {x:Math.floor(rect.x-gap-width),y},
  ]
  if (preview) candidates.unshift(...candidates.splice(2,2))
  let position = candidates.find(p => p.x >= screen.x && p.y >= screen.y && p.x+width <= screen.x+screen.width && p.y+height <= screen.y+screen.height)
  if (!position) {
    position = {x:preview ? screen.x+screen.width-width : clampX(screen.x+(screen.width-width)/2),y:screen.y}
    const cx = rect.x+rect.width/2, cy = rect.y+rect.height/2
    const full = rect.x <= screen.x && rect.y <= screen.y && rect.x+rect.width >= screen.x+screen.width && rect.y+rect.height >= screen.y+screen.height
    if (!full && cx >= position.x && cx <= position.x+width && cy >= position.y && cy <= position.y+height) {
      position.x = cx >= screen.x+width ? screen.x : screen.x+screen.width-width
    }
  }
  const overlap = position.x < rect.x+rect.width && position.x+width > rect.x && position.y < rect.y+rect.height && position.y+height > rect.y
  return {...position,width,height,overlap}
}
