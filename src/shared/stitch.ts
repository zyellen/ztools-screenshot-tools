// One luminance signature per physical row, with a two-row vertical blur.
export interface FrameSample {
  width: number; height: number; rows: Float32Array; stride: number
  info: Float32Array
  pixels: Uint8ClampedArray
}
export function samplePixels(width: number, height: number, pixels: Uint8ClampedArray): FrameSample {
  const step = Math.max(1, Math.ceil(width/256)), stride = Math.ceil(width/step)
  const luminance = new Float32Array(height*stride)
  for (let y=0;y<height;y++) for (let c=0;c<stride;c++) {
    const x=c*step, at=(y*width+x)*4, next=(y*width+Math.min(width-1,x+1))*4
    luminance[y*stride+c] = (0.299*(pixels[at]+pixels[next]) +
      0.587*(pixels[at+1]+pixels[next+1]) + 0.114*(pixels[at+2]+pixels[next+2]))/2
  }
  const rows = new Float32Array(height*stride), info = new Float32Array(height)
  for (let y=0;y<height;y++) {
    let min=Infinity,max=-Infinity
    for (let c=0;c<stride;c++) {
      const value=(luminance[y*stride+c]+luminance[Math.min(height-1,y+1)*stride+c])/2
      rows[y*stride+c]=value;min=Math.min(min,value);max=Math.max(max,value)
    }
    info[y]=max-min
  }
  return {width,height,stride,rows,info,pixels}
}
export function framesUnchanged(a: FrameSample, b: FrameSample) {
  if (a.width!==b.width || a.height!==b.height) return false
  return a.pixels.length===b.pixels.length && a.pixels.every((value,index)=>value===b.pixels[index])
}
export function unchangedRun(previous: FrameSample, current: FrameSample, count: number) {
  const unchanged = framesUnchanged(previous,current)
  const next = unchanged ? count+1 : 0
  return { unchanged, count: next, stop: next >= 2 }
}
// Blank rows carry no alignment evidence. Subsample informative rows, rather
// than physical row indices, so coarse search cannot repeatedly land in gaps.
function residual(a:FrameSample,b:FrameSample,overlap:number,rowStep:number) {
  let total=0,worst=0,inf=0,informative=0
  const stride=a.stride, start=a.height-overlap
  for(let y=1;y<overlap-1;y++) {
    const ay=start+y
    if(Math.max(a.info[ay],b.info[y])<10) continue
    if(informative++ % rowStep !== 0) continue
    let difference=0
    const ai=ay*stride,bi=y*stride
    for(let x=0;x<stride;x++) difference+=Math.abs(a.rows[ai+x]-b.rows[bi+x])
    const mean=difference/stride
    total+=mean;worst=Math.max(worst,mean);inf++
  }
  return {mean:inf ? total/inf : Infinity,worst,inf}
}
export function overlapRows(previous: FrameSample, current: FrameSample) {
  if(previous.width!==current.width || previous.stride!==current.stride) return 0
  const maxOverlap=Math.min(previous.height,current.height)-1
  const coarse: {overlap:number;mean:number}[]=[]
  for(let overlap=24;overlap<=maxOverlap;overlap++) {
    const score=residual(previous,current,overlap,6)
    if(score.inf>=6) coarse.push({overlap,mean:score.mean})
  }
  coarse.sort((a,b)=>a.mean-b.mean)
  const fine=coarse.slice(0,8).map(({overlap})=>({overlap,...residual(previous,current,overlap,1)}))
    .filter(score=>score.inf>=Math.max(32,Math.ceil(score.overlap*0.15)))
    .sort((a,b)=>a.mean-b.mean)
  const best=fine[0]
  if(!best || best.mean>6 || best.worst>45) return 0
  // Only immediate near-equivalent minima may move the seam by a row.
  return fine.filter(score=>Math.abs(score.overlap-best.overlap)<=2 && score.mean-best.mean<=1 && score.mean<=6 && score.worst<=45)
    .reduce((overlap,score)=>Math.max(overlap,score.overlap),best.overlap)
}
export function stitchOffsets(frames: FrameSample[]) {
  return frames.map((frame,index) => index ? overlapRows(frames[index-1],frame) : 0)
}
