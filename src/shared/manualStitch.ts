import { framesUnchanged, stitchOffsets, type FrameSample } from './stitch'
export const SKIP_TOAST = '未能识别本次衔接，已跳过该帧以免重复'
// Only accepted frames advance the stitching reference. Automatic capture does not use this guard.
export function createManualStitch() {
  let previous: FrameSample | undefined
  let skipped=0, consecutive=0
  return {
    get skipped() {return skipped},
    get consecutive() {return consecutive},
    accept(frame:FrameSample) {
      const offset=previous ? stitchOffsets([previous,frame])[1] : 0
      if (previous && offset===0 && !framesUnchanged(previous,frame)) {
        skipped++;consecutive++
        return {accepted:false,offset}
      }
      previous=frame;consecutive=0
      return {accepted:true,offset}
    },
  }
}
