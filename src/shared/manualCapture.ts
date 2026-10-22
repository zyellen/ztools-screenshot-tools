export const MANUAL_TIMEOUT_MS = 45_000
export const SINGLE_FRAME_ERROR = '未检测到滚动：只有一帧画面，未生成拼接图'
export interface ManualControl {
  stopped: boolean
  canceled: boolean
  wait(ms: number): Promise<void>
}
// No input services are accepted here: manual capture only observes pixels.
export async function collectManual<T>(options: {
  control: ManualControl; capture(): Promise<{value:T; pixels:Uint8ClampedArray}>;
  discard?(value:T):void;
  accepted?(value:T):Promise<void | boolean>;
  status(frames:number,idle:number): Promise<void>; now?:()=>number; maxFrames?:number
}) {
  const {control,capture,status} = options, now = options.now || Date.now
  const frames:T[] = []
  const deadline = now()+MANUAL_TIMEOUT_MS
  const expired = Symbol('manual timeout')
  let timedOut = false
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<typeof expired>(resolve=>{
    timer=setTimeout(()=>{timedOut=true;control.stopped=true;resolve(expired)},MANUAL_TIMEOUT_MS)
  })
  let previous:Uint8ClampedArray | undefined, changedAt = now()
  const limit = Math.min(60,Math.max(2,Math.floor(options.maxFrames) || 60))
  try {
    while (!control.stopped && frames.length < limit && now() < deadline) {
      const started = now()
      const pending = capture().then(current=>{
        if (timedOut) options.discard?.(current.value)
        return current
      })
      const current = await Promise.race([pending,timeout])
      if (current === expired) break
      if (control.stopped) break
      if (previous && previous.length !== current.pixels.length) throw new Error('截图尺寸发生变化，请重新框选')
      const same = previous && previous.every((v,i)=>v === current.pixels[i])
      if (!same) {
        const accepted = await Promise.race([options.accepted?.(current.value),timeout])
        if (accepted === expired) break
        changedAt=now() // Changing but unmatchable content is active capture, not idle.
        if (accepted === false) options.discard?.(current.value)
        else {frames.push(current.value);previous=current.pixels}
      } else options.discard?.(current.value)
      const idle = now()-changedAt
      if (await Promise.race([status(frames.length,idle),timeout]) === expired) break
      if ((frames.length >= 2 && idle >= 2500) || frames.length >= limit) break
      await Promise.race([control.wait(Math.min(deadline-now(),Math.max(0,320-(now()-started)))),timeout])
    }
  } finally {clearTimeout(timer!)}
  if (control.canceled) return null
  if (frames.length < 2) throw new Error(SINGLE_FRAME_ERROR)
  return frames
}
