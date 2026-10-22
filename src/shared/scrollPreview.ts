import type { FrameSample } from './stitch'
export interface PreviewStatus { frames:number; height:number; thumb:string; skipped:number; consecutive:number }
export const PREVIEW_INTERVAL_MS=150
export const PREVIEW_WIDTH=200
// Retain only thumbnails and original geometry; offsets come from full-resolution stitching.
export function createScrollPreview(send:(status:PreviewStatus)=>Promise<void>, now=Date.now) {
  const frames: {canvas:HTMLCanvasElement; fullOffset:number; fullHeight:number; fullWidth:number}[]=[]
  let sentAt=-Infinity, height=0, thumb=''
  function thumbnail(image:CanvasImageSource, width:number, height:number) {
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const ctx=canvas.getContext('2d');if(!ctx) throw new Error('预览画布创建失败')
    ctx.drawImage(image,0,0,width,height)
    return canvas
  }
  return {
    async skipped(skipped:number,consecutive:number) {
      await send({frames:frames.length,height,thumb,skipped,consecutive})
    },
    async append(image:HTMLImageElement, frame:FrameSample, fullOffset:number | undefined, fullHeight:number, skipped=0, consecutive=0) {
      if (frames.length >= 60) return
      if (fullOffset === undefined || !Number.isFinite(fullOffset) || fullOffset < 0 || fullOffset > fullHeight) {
        console.warn('滚动预览缺少可用的全分辨率偏移，回退为 0', {frame:frames.length+1,fullOffset,fullHeight})
        fullOffset=0
      }
      const width=Math.min(frames.length>=30 ? 140 : PREVIEW_WIDTH,frame.width), scale=width/frame.width
      if (frames.length===30 && frames[0].canvas.width>width) {
        for (const item of frames) {
          item.canvas=thumbnail(item.canvas,width,Math.max(1,Math.round(item.fullHeight*width/item.fullWidth)))
        }
      }
      frames.push({canvas:thumbnail(image,width,Math.max(1,Math.round(fullHeight*scale))),fullOffset,fullHeight,fullWidth:frame.width})
      height+=fullHeight-fullOffset
      if(now()-sentAt<PREVIEW_INTERVAL_MS) return
      const offsets=frames.map(item=>Math.round(item.fullOffset*width/item.fullWidth))
      const thumbHeight=frames.reduce((sum,item,i)=>sum+item.canvas.height-offsets[i],0)
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=thumbHeight
      const ctx=canvas.getContext('2d');if(!ctx) throw new Error('预览画布创建失败')
      let y=0
      for (const [i,item] of frames.entries()) {
        const cut=offsets[i], h=item.canvas.height-cut
        if(h) ctx.drawImage(item.canvas,0,cut,width,h,0,y,width,h)
        y+=h
      }
      thumb=canvas.toDataURL('image/jpeg',0.7)
      sentAt=now()
      await send({frames:frames.length,height,thumb,skipped,consecutive})
  }}
}
