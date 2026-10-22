// Deterministic contracts; no installed ZTools instance or native commands required.
import assert from 'node:assert/strict'
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
const root = path.resolve(import.meta.dirname, '..')
const directory = mkdtempSync(path.join(tmpdir(), 'shot-contracts-'))
try {
  for (const name of ['capturePresentation','scrollPreview','windowGeometry','manualCapture','manualStitch','scrollControl','overlayGeometry','runtime','stitch','childWindows','parentLink','scrollCapture','parentRequests','overlaySession']) {
    const source = readFileSync(path.join(root,'src/shared',name+'.ts'),'utf8').replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'")
    writeFileSync(path.join(directory,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText)
  }
  const load = name => import(pathToFileURL(path.join(directory,name+'.mjs')))
  const { stitchOffsets, framesUnchanged, unchangedRun, overlapRows, samplePixels } = await load('stitch')
  // Render a whole document before cutting frames. Randomness chooses ordinary
  // glyph strokes/paper grain, never a channel encoding an absolute row number.
  function makePage(width,height,seed=17,sparse=false,dense=false) {
    let state=seed>>>0
    const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296}
    const raw=new Uint8ClampedArray(width*height*4)
    for(let i=0;i<raw.length;i+=4) {const paper=sparse ? 248 : 244+Math.floor(random()*7);raw[i]=raw[i+1]=raw[i+2]=paper;raw[i+3]=255}
    const paint=(x,y,w,h,color)=>{for(let yy=y;yy<Math.min(height,y+h);yy++) for(let xx=x;xx<Math.min(width,x+w);xx++) {
      const at=(yy*width+xx)*4;raw[at]=color;raw[at+1]=color+3;raw[at+2]=color+7
    }}
    let line=0
    for(let y=0;y<height;) {
      const lineHeight=14+Math.floor(random()*16)
      for(let x=12;x<width-12;x+=5+Math.floor(random()*5)) {
        const ink=(line%2 ? 110 : 35)+Math.floor(random()*30), glyphHeight=dense ? lineHeight-4 : (sparse ? 4 : 6)+Math.floor(random()*3)
        for(let gy=0;gy<glyphHeight;gy++) for(let gx=0;gx<3;gx++) if(random()<0.64) paint(x+gx,y+gy,1,1,ink)
      }
      y+=lineHeight;line++
    }
    // Vertical antialiasing typical of captured text; retains every physical row.
    const pixels=raw.slice()
    for(let y=2;y<height-2;y++) for(let x=0;x<width;x++) for(let c=0;c<3;c++) {
      const at=(y*width+x)*4+c;pixels[at]=(raw[at-width*8]+4*raw[at-width*4]+6*raw[at]+4*raw[at+width*4]+raw[at+width*8])/16
    }
    return {width,height,pixels}
  }
  // alpha is supplied independently by each frame, including a row-dependent
  // resampling field. A fractional start chooses source rows, never the weights.
  function cut(page,start,height,alpha=start-Math.floor(start)) {
    // Keep the legacy negative-phase chain: normalize its source row and
    // weight without deriving the independent per-frame alpha from start.
    if(typeof alpha==='number' && alpha<0) return cut(page,start+Math.floor(alpha),height,alpha-Math.floor(alpha))
    const {width}=page,data=new Uint8ClampedArray(width*height*4)
    for(let y=0;y<height;y++) {
      const lo=Math.floor(start+y),mix=typeof alpha==='function' ? alpha(y) : alpha
      assert.ok(mix>=0 && mix<1,'independent resampling alpha in [0,1)')
      for(let x=0;x<width*4;x++) {
        data[y*width*4+x]=(1-mix)*page.pixels[lo*width*4+x]+mix*page.pixels[(lo+1)*width*4+x]
      }
    }
    return samplePixels(width,height,data)
  }
  const signaturePixels=new Uint8ClampedArray([
    255,0,0,255, 0,255,0,255, 0,0,255,255,
    0,0,0,255, 100,100,100,255, 200,200,200,255,
    255,255,255,255, 255,255,255,255, 255,255,255,255,
  ])
  const signature=samplePixels(3,3,signaturePixels)
  assert.equal(signature.stride,3);assert.equal(signature.rows.length,9)
  assert.ok(signature.rows instanceof Float32Array);assert.ok(signature.info instanceof Float32Array)
  assert.equal(signature.pixels,signaturePixels,'raw pixels retained for strict dedup')
  const expectedSignature=[(112.965+50)/2,(89.3775+150)/2,(29.07+200)/2,152.5,202.5,227.5,255,255,255]
  for(let i=0;i<9;i++) assert.ok(Math.abs(signature.rows[i]-expectedSignature[i])<0.001,`luminance / adjacent columns / vertical blur ${i}`)
  for(let y=0;y<3;y++) assert.ok(Math.abs(signature.info[y]-(Math.max(...expectedSignature.slice(y*3,y*3+3))-Math.min(...expectedSignature.slice(y*3,y*3+3))))<0.001)
  const wideSignature=samplePixels(1600,1,new Uint8ClampedArray(1600*4))
  assert.equal(wideSignature.stride,Math.ceil(1600/7))
  const page=makePage(192,2400),capturePage=makePage(64,2400)
  const frame=(start,height=128)=>cut(capturePage,start,height)
  assert.deepEqual(stitchOffsets([frame(0)]),[0])
  assert.equal(framesUnchanged(frame(0),frame(0)),true)
  assert.ok(overlapRows(frame(0),frame(0))<128,'identical frames belong to full-pixel dedup, max overlap excluded')
  assert.deepEqual(stitchOffsets([frame(0),frame(8),frame(16)]),[0,120,120])
  assert.deepEqual(stitchOffsets([frame(0),frame(300)]),[0,0])
  assert.equal(framesUnchanged(frame(0),frame(1)),false)
  assert.equal(framesUnchanged(frame(0),frame(0,23)),false)
  const one=unchangedRun(frame(0),frame(0),0)
  assert.equal(one.stop,false);assert.equal(unchangedRun(frame(0),frame(0),one.count).stop,true)
  assert.equal(unchangedRun(frame(0),frame(1),1).count,0)
  console.log('PASS: stitch first/full dedup/partial/no overlap, unchanged/dimensions, two unchanged frames stop, changed resets count')

  const hash=row=>createHash('sha256').update(row).digest('hex')
  let checkedRows=0,checkedSeams=0,solidRows=0
  function groundTruth(source,starts,height,phases=starts.map(()=>0),label='page',fractionalTolerance=false) {
    const frames=starts.map((start,i)=>cut(source,start,height,phases[i]))
    const offsets=stitchOffsets(frames),rows=[],identities=[],seams=[]
    for(let i=0;i<frames.length;i++) {
      const expected=i ? height-(starts[i]-starts[i-1]) : 0
      if(fractionalTolerance && i) assert.ok(Math.abs(offsets[i]-expected)<=1,`${label} offset ${i}: ${offsets[i]} vs ${expected}, fractional ±1`)
      else assert.equal(offsets[i],expected,`${label} offset ${i}`)
      if(i) seams.push(rows.length)
      for(let y=offsets[i];y<height;y++) {
        rows.push(frames[i].pixels.subarray(y*source.width*4,(y+1)*source.width*4))
        identities.push({phase:phases[i]})
      }
    }
    assert.equal(rows.length,height+starts.at(-1)-starts[0],`${label} theoretical height`)
    const canonical=new Set();let localSolid=0
    for(let i=0;i<rows.length;i++) {
      // Fractional rows are compared with the original page resampled at that
      // frame's phase, not with an impossible unfiltered original pixel row.
      const expected=cut(source,starts[0]+i,1,identities[i].phase).pixels
      assert.deepEqual(rows[i],expected,`${label} original page row ${i}`)
      assert.equal(hash(rows[i]),hash(expected),`${label} original page row hash ${i}`)
      const key=hash(rows[i]);checkedRows++
      const solid=rows[i].every((v,j)=>j%4===3 || v===rows[i][j%4])
      if(solid) {solidRows++;localSolid++} else canonical.add(key)
      if(i && !solid) assert.notEqual(key,hash(rows[i-1]),`${label} consecutive row duplicate ${i}`)
    }
    assert.equal(canonical.size,rows.length-localSolid,`${label} unique row content hash set`)
    for(const seam of seams) {
      const before=rows[seam-1],after=rows[seam]
      const isSolid=row=>row.every((v,i)=>v===row[i%4])
      if(!isSolid(before) || !isSolid(after)) assert.notEqual(hash(before),hash(after),`${label} seam duplicate`)
      else assert.ok(isSolid(before) && isSolid(after),`${label} natural blank seam counted separately`)
      for(let row=Math.max(0,seam-24);row<Math.min(rows.length,seam+24);row++) {
        assert.equal(hash(rows[row]),hash(cut(source,starts[0]+row,1,identities[row].phase).pixels),`${label} seam window source row ${row}`)
      }
      checkedSeams++
    }
    return offsets
  }
  for(const width of [160,192]) {
    const content=width===192?page:makePage(width,2400)
    for(const shift of [1,5,13,20,37,58,91]) groundTruth(content,[0,shift],256,undefined,`integer ${width}/${shift}`)
    // Independent regression sweep for the reviewer's complete 1..110 failure.
    for(let shift=1;shift<=110;shift++) assert.equal(overlapRows(cut(content,0,256),cut(content,shift,256)),256-shift)
  }
  groundTruth(page,[0,108],256,[0,0.5],'half pixel')
  assert.deepEqual(stitchOffsets([cut(page,0,128),cut(page,125,128)]),[0,0],'three rows: insufficient overlap')
  for(const overlap of [58,91,120]) groundTruth(page,[0,128-overlap],128,undefined,`legacy overlap ${overlap}`)
  groundTruth(page,Array.from({length:40},(_,i)=>i*37),128,undefined,'40 integer frames')
  groundTruth(page,Array.from({length:40},(_,i)=>1+i*23),128,Array.from({length:40},(_,i)=>0.4*Math.sin(i)),'40 fractional frames 23±0.4')
  const black={width:192,height:260,pixels:new Uint8ClampedArray(192*260*4)}
  const white={...black,pixels:new Uint8ClampedArray(black.pixels.length).fill(255)}
  assert.equal(overlapRows(cut(black,0,128),cut(white,0,128)),0,'all different')
  // No overlap is a concatenation of two complete, independently known pages.
  const noOverlap=[cut(black,0,128),cut(white,0,128)]
  const noOffsets=stitchOffsets(noOverlap);assert.deepEqual(noOffsets,[0,0])
  assert.equal(noOverlap.reduce((n,f,i)=>n+f.height-noOffsets[i],0),256)
  assert.notEqual(hash(noOverlap[0].pixels.subarray(127*768)),hash(noOverlap[1].pixels.subarray(0,768)),'no-overlap seam content')
  for(let i=0;i<2;i++) for(let y=0;y<128;y++) assert.deepEqual(noOverlap[i].pixels.subarray(y*768,(y+1)*768),cut(i?white:black,y,1).pixels)
  // Repeated ruled-paper stripes plus ordinary non-periodic text. Ten-pixel
  // movement in a 128-row viewport has a real overlap of 118 rows.
  const stripes=makePage(192,300)
  for(let y=0;y<300;y+=5) for(let x=0;x<192;x++) for(let c=0;c<3;c++) stripes.pixels[(y*192+x)*4+c]=160
  const stripeOffsets=groundTruth(stripes,[0,10],128,undefined,'repeated stripes')
  assert.ok(stripeOffsets[1]<=118)
  const base=cut(page,0,128),changed=cut(page,0,128);changed.pixels[0]^=1
  assert.equal(framesUnchanged(base,changed),false,'one changed full pixel, unchanged signature')
  assert.equal(framesUnchanged(base,cut(page,0,128)),true)
  const largePage=makePage(1600,850),largeA=cut(largePage,0,400),largeB=cut(largePage,300,400)
  overlapRows(largeA,largeB)
  const timings=[]
  for(let i=0;i<5;i++) {const begin=performance.now();assert.equal(overlapRows(largeA,largeB),100);timings.push(performance.now()-begin)}
  const p50=timings.sort((a,b)=>a-b)[2]
  assert.ok(p50<80,`1600×400 P50 ${p50.toFixed(2)}ms <80ms`)
  console.log(`PASS: real page integers 1..110 / half pixel / <24 rows rejected / no overlap / repeated stripes / 40 integer and fractional frames; ${checkedRows} exact rows, ${checkedSeams} unique seams, ${solidRows} solid rows; 1600×400 P50 ${p50.toFixed(2)}ms (5 runs: ${timings.map(value=>value.toFixed(2)).join(", ")})`)

  // Hashes identify content; their original-page positions provide the order.
  // Quantized chains may skip fractional rows, so output indices are not an oracle.
  function chainTruth(source,step,count,label) {
    const height=900,positions=Array.from({length:count},(_,i)=>i*step)
    const starts=positions.map(Math.floor),phases=positions.map((p,i)=>p-starts[i])
    const frames=starts.map((start,i)=>cut(source,start,height,phases[i]))
    const offsets=stitchOffsets(frames),rows=[],seams=[]
    const fractional=!Number.isInteger(step)
    let maxOffsetError=0,blankRows=0,contentRows=0
    const isSolid=row=>row.every((v,i)=>v===row[i%4])
    assert.equal(offsets[0],0,`${label} first offset`)
    for(let i=0;i<count;i++) {
      if(i) {
        const error=Math.abs(offsets[i]-(height-(positions[i]-positions[i-1])))
        maxOffsetError=Math.max(maxOffsetError,error)
        if(fractional) assert.ok(error<=1,`${label} offset ${i}: error ${error} <=1`)
        else assert.equal(error,0,`${label} exact offset ${i}`)
        seams.push(rows.length)
      }
      for(let y=offsets[i];y<height;y++) rows.push({
        pixels:frames[i].pixels.subarray(y*source.width*4,(y+1)*source.width*4),phase:phases[i],
      })
    }
    const ideal=height+positions.at(-1)-positions[0],heightError=Math.abs(rows.length-ideal)
    if(fractional) assert.ok(heightError<=count,`${label} height ${rows.length} vs ideal ${ideal}: error ${heightError} <=${count}`)
    else assert.equal(rows.length,ideal,`${label} exact theoretical height`)
    for(const seam of seams) {
      const window=rows.slice(Math.max(0,seam-24),seam+24),oracles=new Map()
      for(const {phase} of window) if(!oracles.has(phase)) {
        const lookup=new Map()
        // Search the independent source around the ideal seam, allowing the
        // specified chain quantization bound in both directions.
        for(let y=Math.max(0,seam-24-count);y<Math.min(source.height-1,seam+24+count);y++) {
          const pixels=cut(source,y,1,phase).pixels
          if(!isSolid(pixels)) {
            const key=hash(pixels)
            assert.ok(!lookup.has(key),`${label} ambiguous source content hash`)
            lookup.set(key,y+phase)
          }
        }
        oracles.set(phase,lookup)
      }
      let previous=-Infinity
      const seen=new Set()
      for(const {pixels,phase} of window) {
        if(isSolid(pixels)) {blankRows++;continue}
        const key=hash(pixels),position=oracles.get(phase).get(key)
        assert.ok(position!==undefined,`${label} seam ${seam}: content hash absent from source`)
        assert.ok(!seen.has(key),`${label} seam ${seam}: repeated content hash`)
        assert.ok(position>previous,`${label} seam ${seam}: source order ${previous} -> ${position}`)
        seen.add(key);previous=position;contentRows++
      }
      checkedSeams++
    }
    console.log(`PASS: ${label}: frames=${count}, offsets=[${offsets.join(',')}], max offset error=${maxOffsetError.toFixed(3)}, height=${rows.length}, ideal=${ideal.toFixed(3)}, height error=${heightError.toFixed(3)} ${fractional ? `<=${count}` : '=0'}; ${seams.length} monotonic seam windows, ${contentRows} content rows, ${blankRows} solid rows counted separately`)
  }
  // Full-size, six-viewport aperiodic documents. These checks use only the
  // original page and prescribed scroll positions as the oracle.
  for(const width of [1600,400]) {
    const height=900,document=makePage(width,height*6,71,true)
    let blanks=0
    for(let y=0;y<document.height;y++) {
      const row=document.pixels.subarray(y*width*4,(y+1)*width*4)
      if(row.every((v,i)=>v===row[i%4])) blanks++
    }
    assert.ok(blanks/document.height>0.5,`blank physical rows ${width}: ${blanks/document.height}`)
    for(const shift of [1,5,13,20,37,58,91,300]) groundTruth(document,[0,shift],height,undefined,`full integer ${width}/${shift}`)
    for(const phase of [0.5,0.4]) groundTruth(document,[0,300],height,[0,phase],`full fractional ${width}/${phase}`)
    for(let overlap=1;overlap<24;overlap++) assert.equal(stitchOffsets([cut(document,0,height),cut(document,height-overlap,height)])[1],0,`<24 rows ${width}/${overlap}`)
    const unrelated=makePage(width,height*6,193,true)
    assert.deepEqual(stitchOffsets([cut(document,0,height),cut(unrelated,0,height)]),[0,0],`unrelated textured pages ${width}`)
    assert.equal(overlapRows(cut(document,0,height),samplePixels(width+1,height,new Uint8ClampedArray((width+1)*height*4))),0,'different widths')
    const joined={...document,pixels:document.pixels.slice()}
    joined.pixels.set(unrelated.pixels.subarray(0,width*height*4),width*height*4)
    groundTruth(joined,[0,height],height,undefined,`full no-overlap ${width}`)
    chainTruth(document,23,10,`10 integer 23px ${width}`)
    chainTruth(document,23.4,20,`20 accumulated 23.4px ${width}`)
    const a=cut(document,0,height),b=cut(document,300,height),times=[]
    for(let i=0;i<5;i++) {const start=performance.now();assert.equal(overlapRows(a,b),600);times.push(performance.now()-start)}
    const median=times.slice().sort((a,b)=>a-b)[2]
    assert.ok(median<80,`${width}×900 P50 ${median.toFixed(2)}ms`)
    console.log(`PASS: ${width}×900 six-viewport sparse page (${(100*blanks/document.height).toFixed(1)}% solid rows), integers / 0.5 / 0.4 / no-overlap / <24 rejected; P50 ${median.toFixed(2)}ms (${times.map(t=>t.toFixed(2)).join(', ')})`)
  }

  const frac=n=>n-Math.floor(n)
  let phaseCells=0,phaseZeros=0,phaseWrong=0,sameCells=0,phaseReturns=[]
  for(const width of [400,1600]) {
    const source=makePage(width,5400,71,true),height=900
    for(const shift of [1,5,13,20,37,58,91,300]) {
      for(const alpha of [0.2,0.5,0.8,y=>frac(0.4*0.37+y*0.11)]) {
        const a=cut(source,0.4,height,alpha),b=cut(source,shift+0.4,height,alpha)
        const offset=stitchOffsets([a,b])[1]
        assert.ok(Math.abs(offset-(height-shift))<=1,`same independent alpha ${width}/${shift}/${alpha}: ${offset}`)
        sameCells++
      }
      for(const blankFraction of [0,0.5,0.8]) for(const phase of [0.05,0.1,0.3,0.6,0.9]) {
        const phasePage={...source,pixels:source.pixels.slice()}
        const paper=new Uint8ClampedArray(width*4).fill(248)
        for(let x=3;x<paper.length;x+=4) paper[x]=255
        for(let y=0;y<source.height;y++) if(y%400<400*blankFraction) phasePage.pixels.set(paper,y*width*4)
        const alphaA=y=>frac(0.4*0.37+y*0.11)
        const alphaB=y=>frac((shift+0.4)*0.37+y*0.11+phase)
        const a=cut(phasePage,0.4,height,alphaA),b=cut(phasePage,shift+0.4,height,alphaB)
        // Verify raw RGBA against the independent source, with per-frame local
        // y and explicit weights; this oracle does not reuse the frame builder.
        for(const [image,start,weight] of [[a,0.4,alphaA],[b,shift+0.4,alphaB]]) {
          for(const y of [0,1,17,80,451,899]) {
            const row=Math.floor(start+y),mix=weight(y),expected=new Uint8ClampedArray(width*4)
            for(let x=0;x<width*4;x++) expected[x]=phasePage.pixels[row*width*4+x]*(1-mix)+phasePage.pixels[(row+1)*width*4+x]*mix
            assert.deepEqual(image.pixels.subarray(y*width*4,(y+1)*width*4),expected,'independent row-varying phase oracle')
          }
        }
        assert.notEqual(alphaA(0),alphaA(1),'phase varies with local row')
        assert.notEqual(alphaA(17),alphaB(17),'each frame has independent phase')
        const offset=stitchOffsets([a,b])[1],wrong=offset!==0 && Math.abs(offset-(height-shift))>1
        phaseCells++;phaseZeros+=Number(offset===0);phaseWrong+=Number(wrong)
        phaseReturns.push({width,shift,blankFraction,phase,offset})
        assert.ok(!wrong,`phase jump ${width}/${shift}/${phase}: wrong nonzero ${offset}`)
      }
    }
  }
  mkdirSync(path.join(root,'release/TASK-007-FIX4'),{recursive:true})
  writeFileSync(path.join(root,'release/TASK-007-FIX4/phase-returns.json'),JSON.stringify(phaseReturns,null,2)+'\n')
  console.log(`PASS: independent subpixel fixtures: same phase ${sameCells}/${sameCells} within ±1; row-varying phase jumps ${phaseCells} cells, zero=${phaseZeros}, correct nonzero=${phaseCells-phaseZeros-phaseWrong}, wrong nonzero=${phaseWrong}`)

  const {overlayGeometry} = await load('overlayGeometry')
  const expected = {dx:-1920,dy:-148,dw:1920,dh:1080}
  assert.deepEqual(overlayGeometry(expected,{screenX:-1920,screenY:-148,innerWidth:1920,innerHeight:1080}),{mismatch:false,left:0,top:0})
  assert.deepEqual(overlayGeometry(expected,{screenX:-1920,screenY:0,innerWidth:1920,innerHeight:1080}),{mismatch:true,left:0,top:-148})
  assert.deepEqual(overlayGeometry(expected,{screenX:0,screenY:0,innerWidth:1408,innerHeight:856}),{mismatch:true,left:-1920,top:-148})
  assert.deepEqual(overlayGeometry({dx:0,dy:0,dw:1408,dh:856},{screenX:20,screenY:-10,innerWidth:1408,innerHeight:856}),{mismatch:true,left:-20,top:10})
  assert.equal(overlayGeometry(expected,{screenX:-1919,screenY:-147,innerWidth:1919,innerHeight:1079}).mismatch,false)
  console.log('PASS: overlay geometry equality, 1px tolerance, displacement/resize and negative display coordinates')
  for (const manifest of ['package.json','src-ztools/plugin.json','src-ztools/dist/plugin.json']) {
    assert.equal(JSON.parse(readFileSync(path.join(root,manifest),'utf8')).version,'0.5.3')
  }
  const lock=JSON.parse(readFileSync(path.join(root,'package-lock.json'),'utf8'))
  assert.equal(lock.version,'0.5.3');assert.equal(lock.packages[''].version,'0.5.3')
  assert.equal(readFileSync(path.join(root,'src-ztools/dist/preload/services.js'),'utf8'),readFileSync(path.join(root,'src-ztools/preload/services.js'),'utf8'))


  // Preload: relay argument shape, replacement listener, command arguments and failures.
  const require = createRequire(import.meta.url), ipc = new EventEmitter(), commands=[]
  let commandError='', commandStderr='', commandStdout='', commandResults=[]
  const sandbox = {module:{exports:{}},window:{ztools:{getAllDisplays:()=>[{bounds:{x:-1920,y:-200,width:1920,height:1080}},{bounds:{x:0,y:0,width:1440,height:900}}]}},console,process:{platform:'darwin'},Buffer,setTimeout,clearTimeout,require(name) {
    if (name === 'electron') return {ipcRenderer:ipc}
    if (name === 'node:child_process') return {execFile(file,args,options,callback) {
      commands.push({file,args,options})
      if (file.endsWith('screencapture')) writeFileSync(args.at(-1),'PNG')
      if (commandResults.length) {const result=commandResults.shift();callback(result.error || null,'',result.stderr || '');return}
      callback(commandError && (commandError !== 'activate-only' || file.endsWith('osascript')) ? (typeof commandError === 'object' ? commandError : new Error(commandError)) : null,commandStdout,commandStderr)
    }}
    return require(name)
  }}
  vm.runInNewContext(readFileSync(path.join(root,'src-ztools/preload/services.js'),'utf8'),sandbox)
  const services=sandbox.module.exports
  let delivered
  services.onShotRequest(()=>assert.fail('stale handler'))
  services.onShotRequest((request,sender)=>{delivered={request,sender}})
  ipc.emit('__ipc_sendto_relay__',{}, {channel:'other',args:[{}],senderId:7})
  assert.equal(delivered,undefined)
  ipc.emit('__ipc_sendto_relay__',{}, {channel:'shot-request',args:[{id:'r'}],senderId:7})
  assert.equal(delivered.sender,7);assert.equal(delivered.request.id,'r');assert.equal(ipc.listenerCount('__ipc_sendto_relay__'),1)
  commandStdout='  Safari\n'
  assert.equal(await services.frontmostApp(),'Safari')
  assert.deepEqual(Array.from(commands.at(-1).args),['-e','tell application "System Events" to get name of first application process whose frontmost is true'])
  assert.equal(commands.at(-1).options.timeout,5000)
  const appName = 'App "quoted" \\ folder'
  assert.equal((await services.activateApp(appName)).ok,true)
  assert.equal(commands.at(-1).args[1],`tell application "${appName.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}" to activate`)
  assert.equal(commands.at(-1).options.timeout,5000)
  commandError='activate-only'
  assert.equal((await services.activateApp(appName)).ok,true)
  assert.deepEqual(Array.from(commands.at(-1).args),['-a',appName]);assert.equal(commands.at(-1).file,'/usr/bin/open')
  assert.equal(commands.at(-1).options.timeout,5000)
  commandError='failed'
  assert.equal(await services.frontmostApp(),'');assert.equal((await services.activateApp('Safari')).ok,false)
  commandError='';commandStdout=''
  assert.equal(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version,'0.5.3')
  const commandCount = commands.length
  for (const args of [[NaN,0],[0,Infinity],[0,0,NaN],[0,0,3,Infinity],['0',0],[0,0,3,'2']]) {
    assert.equal((await services.scrollWheel(...args)).ok,false)
  }
  assert.equal(commands.length,commandCount)
  commandStdout='{"ok":true,"trusted":true}\n'
  assert.equal((await services.scrollWheel(-68,12)).ok,true)
  assert.equal(commands.length,commandCount+1)
  assert.deepEqual(Array.from(commands.at(-1).args.slice(0,3)),['-l','JavaScript','-e'])
  assert.equal(commands.at(-1).file,'/usr/bin/osascript')
  assert.equal(commands.at(-1).options.timeout,8000)
  const jxa = commands.at(-1).args[3]
  assert.match(jxa,/CGPointMake\(-68, 12\)/)
  assert.match(jxa,/i < 2/);assert.match(jxa,/kCGScrollEventUnitLine, 1, -3/)
  const wheelEvents=[]
  const native = Object.assign(value=>({dataUsingEncoding:()=>value}),{
    AXIsProcessTrusted:()=>true,
    NSFileHandle:{fileHandleWithStandardOutput:{writeData:data=>{assert.deepEqual(JSON.parse(data),{cursor:{x:120,y:240}})}}},
    NSUTF8StringEncoding:4,NSThread:{sleepForTimeInterval:seconds=>wheelEvents.push(['delay',seconds])},
    CGEventCreate:()=>null,CGEventGetLocation:()=>({x:120,y:240}),CGPointMake:(x,y)=>[x,y],
    CGWarpMouseCursorPosition:point=>wheelEvents.push(point),CGEventSourceCreate:()=> 'source',
    kCGEventSourceStateHIDSystemState:1,kCGScrollEventUnitLine:2,kCGHIDEventTap:3,
    CGEventCreateScrollWheelEvent:(source,unit,axis,lines)=>{assert.equal(unit,2);assert.equal(lines,-3);return 'scroll'},
    CGEventSetLocation:(event,point)=>{assert.equal(event,'scroll');wheelEvents.push(['location',...point])},
    CGEventPost:()=>wheelEvents.push('post'),
  })
  const jxaContext={ObjC:{import:name=>assert.ok(['CoreGraphics','Foundation','ApplicationServices'].includes(name))},$:native}
  assert.match(jxa,/AXIsProcessTrusted/);assert.match(jxa,/ObjC.import\("ApplicationServices"\)/)
  for (const file of ['src-ztools/preload/services.js','src-ztools/dist/preload/services.js']) assert.ok(!readFileSync(path.join(root,file),'utf8').includes('CG'+'PreflightPostEventAccess'))
  assert.deepEqual(JSON.parse(vm.runInNewContext(jxa,jxaContext)),{ok:true,trusted:true})
  assert.deepEqual(wheelEvents,[[-68,12],['delay',0.05],['location',-68,12],'post',['delay',0.02],['location',-68,12],'post',{x:120,y:240}])
  wheelEvents.length=0
  native.AXIsProcessTrusted=()=>false
  assert.deepEqual(JSON.parse(vm.runInNewContext(jxa,jxaContext)),{ok:true,trusted:false})
  assert.deepEqual(wheelEvents,[[-68,12],['delay',0.05],['location',-68,12],'post',['delay',0.02],['location',-68,12],'post',{x:120,y:240}])
  wheelEvents.length=0
  const post=native.CGEventPost
  native.CGEventPost=()=>{throw new Error('post failed')}
  assert.throws(()=>vm.runInNewContext(jxa,jxaContext),/post failed/)
  assert.deepEqual(wheelEvents.at(-1),{x:120,y:240})
  native.CGEventPost=post
  for (const trusted of [false,true]) {
    commandStdout=JSON.stringify({cursor:{x:120,y:240}})+'\n'+JSON.stringify({ok:true,trusted})+'\n'
    assert.deepEqual({...await services.scrollWheel(0,0)},{ok:true,trusted})
  }
  for (const stdout of ['', 'garbage', '{"ok":true}', '{"ok":true,"trusted":"false"}']) {
    commandStdout=stdout
    assert.equal((await services.scrollWheel(0,0)).ok,false)
  }
  commandStdout='{"ok":false,"error":"native failure"}'
  assert.equal((await services.scrollWheel(0,0)).error,'native failure')
  commandStdout='{"ok":false,"permission":true}\n'
  const deniedWheel=await services.scrollWheel(0,0)
  assert.equal(deniedWheel.ok,false);assert.equal(deniedWheel.permission,true);assert.equal(deniedWheel.error,'需要辅助功能权限')
  commandStdout=''
  const timeoutError=Object.assign(new Error('8s timeout'),{killed:true})
  commandError=timeoutError;commandStdout='{"cursor":{"x":120,"y":240}}\n'
  let beforeTimeout=commands.length
  const nativeLogs=[], savedConsoleError=console.error
  console.error=(...args)=>nativeLogs.push(args)
  try {
    assert.equal((await services.scrollWheel(-68,12)).ok,false)
    assert.equal(commands.length,beforeTimeout+2)
    assert.equal(commands.at(-1).options.timeout,1500)
    const restorePoints=[]
    vm.runInNewContext(commands.at(-1).args[3],{ObjC:{import(){}},$:{CGPointMake:(x,y)=>[x,y],CGWarpMouseCursorPosition:p=>restorePoints.push(p)}})
    assert.deepEqual(restorePoints,[[120,240]])
    assert.match(nativeLogs[0][0],/restore failed/)
    commandStdout='';beforeTimeout=commands.length
    assert.equal((await services.scrollWheel(-68,12)).ok,false)
    assert.equal(commands.length,beforeTimeout+1)
    assert.match(nativeLogs.at(-1)[0],/restore skipped/)
  } finally {console.error=savedConsoleError;commandError='';commandStdout=''}
  await services.scrollWheel(0,0,-4,99)
  assert.match(commands.at(-1).args[3],/i < 10/);assert.match(commands.at(-1).args[3],/kCGScrollEventUnitLine, 1, -1/)
  await services.scrollWheel(0,0,99,-2)
  assert.match(commands.at(-1).args[3],/i < 1/);assert.match(commands.at(-1).args[3],/kCGScrollEventUnitLine, 1, -10/)
  await services.scrollWheel(0,0,3.9,2.9)
  assert.match(commands.at(-1).args[3],/i < 2/);assert.match(commands.at(-1).args[3],/kCGScrollEventUnitLine, 1, -3/)
  commandError='JXA failed';commandStderr='raw stderr\n详情'
  const wheelFailure=await services.scrollWheel(0,0)
  assert.equal(wheelFailure.ok,false);assert.ok(wheelFailure.error.includes(commandStderr))
  commandError='';commandStderr=''
  console.log('PASS: wheel finite parameters, defaults/clamps, single JXA/8s, trust diagnostics without blocking, event location/delays, warp/post/restore and timeout fallback, raw stderr')
  // Keep diagnostics in the test directory, away from real host diagnostics.
  const diagSandbox = {...sandbox,module:{exports:{}},require(name) {return name === 'node:os' ? {tmpdir:()=>directory} : sandbox.require(name)}}
  vm.runInNewContext(readFileSync(path.join(root,'src-ztools/preload/services.js'),'utf8'),diagSandbox)
  const diagServices=diagSandbox.module.exports
  for (let i=0;i<205;i++) diagServices.appendDiag(`line-${i}`)
  const lines=readFileSync(path.join(directory,'ztools-shot/diag.log'),'utf8').trim().split('\n')
  assert.equal(lines.length,200);assert.equal(lines[0],'line-5');assert.equal(lines.at(-1),'line-204')
  diagServices.onShotRequest(()=>assert.fail('diag must not route as shot-request'))
  ipc.emit('__ipc_sendto_relay__',{}, {channel:'diag',args:[{kind:'overlay-geometry',expected}],senderId:7})
  assert.equal(JSON.parse(readFileSync(path.join(directory,'ztools-shot/diag.log'),'utf8').trim().split('\n').at(-1)).kind,'overlay-geometry')
  ipc.removeAllListeners('__ipc_sendto_relay__')
  console.log('PASS: frontmost query/trim/failure, activation quoting/fallback/timeout/failure, diag relay/200-line cap, manifest 0.5.3')
  let capture=await services.captureRegion(-100,20,640,480)
  assert.equal(capture.ok,true);assert.equal(commands.at(-1).args[1],'-R-100,20,640,480');assert.equal(commands.at(-1).options.timeout,8000)
  services.removeTempImages([capture.path])
  capture=await services.captureRegion(-1426.0625,223.26953125,1045.1484375,306.0390625)
  assert.equal(commands.at(-1).args[1],'-R-1426,223,1045,306');services.removeTempImages([capture.path])
  for(const [input,expectedRect] of [
    [[-1930.4,-210.4,30.4,30.4],'-R-1920,-200,20,20'],
    [[1430,890,40,30],'-R1430,890,10,10'],
    [[2000,2000,0.1,0.1],'-R1439,899,1,1'],
    [[0,0,0.1,0.1],'-R0,0,1,1'],
  ]) {
    capture=await services.captureRegion(...input);assert.equal(capture.ok,true)
    assert.equal(commands.at(-1).args[1],expectedRect);services.removeTempImages([capture.path])
  }
  const regionLogs=[], previousError=console.error
  console.error=(...args)=>regionLogs.push(args)
  try {
    let before=commands.length
    commandResults=[{error:Object.assign(new Error('flag rejected'),{code:64}),stderr:'illegal option -- x'},{}]
    capture=await services.captureRegion(-100,20,640,480)
    assert.equal(capture.ok,true);assert.equal(commands.length,before+2)
    assert.deepEqual(Array.from(commands.at(-1).args.slice(0,-1)),['-R-100,20,640,480'])
    assert.equal(regionLogs.at(-1)[1].exitCode,64);assert.equal(regionLogs.at(-1)[1].rectangle,'-100,20,640,480')
    services.removeTempImages([capture.path])
    for(const failure of [
      {error:Object.assign(new Error('denied'),{code:1}),stderr:'screen recording permission denied'},
      {error:Object.assign(new Error('8s timeout'),{code:'ETIMEDOUT',killed:true})},
    ]) {
      before=commands.length;commandResults=[failure]
      capture=await services.captureRegion(0,0,20,20)
      assert.equal(capture.ok,false);assert.equal(commands.length,before+1)
      assert.ok(capture.error.includes(failure.stderr || failure.error.message))
      assert.match(capture.error,/命令: screencapture -x -R 0,0,20,20/)
      assert.match(capture.error,/系统设置 → 隐私与安全 → 屏幕录制 中允许 ZTools/)
      assert.equal(existsSync(commands.at(-1).args.at(-1)),false,'partial output removed')
    }
    before=commands.length
    commandResults=[{error:new Error('flag'),stderr:'illegal option'}, {error:new Error('retry failed'),stderr:'bad region'}]
    capture=await services.captureRegion(0,0,20,20)
    assert.equal(capture.ok,false);assert.equal(commands.length,before+2);assert.match(capture.error,/bad region/)
    assert.equal(existsSync(commands.at(-1).args.at(-1)),false)
  } finally {console.error=previousError;commandResults=[]}
  console.log('PASS: region rounded negative DIP / display union clipping / 1px minimum / 8s / stderr+exitCode / illegal-option retry / permission fallback / partial-file cleanup')
  assert.equal((await services.pressKeyCode(125,3)).ok,true)
  assert.match(commands.at(-1).args[1],/repeat 3 times\nkey code 125/)
  commandError='osascript';commandStderr='不允许发送按键 (1002)'
  assert.equal((await services.pressKeyCode(121)).permission,true)
  assert.equal((await services.captureRegion(0,0,20,20)).ok,false)
  assert.equal((await services.captureRegion(0,0,0,20)).ok,false)
  console.log('PASS: relay replacement/shape, screencapture DIP region/timeout, key codes, permission and capture failures')

  let removed=[], draws=[], captures=0, keys=0, wheels=0, hides=0, shows=0, deny=false, denyWheel=false, failCapture=false
  let starts=[0,8,16,16,16], events=[], toastMessages=[], wheelTrusted
  const api={showToast(message){toastMessages.push(message)},dbStorage:{getItem:()=>({targetLang:'en'})}}
  globalThis.window={ztools:api,services:{platform:'darwin',
    activateApp:async name=>{events.push('activate:'+name);return {ok:true}},
    frontmostApp:async()=>{events.push('frontmost');return 'Safari & 测试'},
    captureRegion:async()=> {events.push('capture');return failCapture ? {ok:false,error:'capture failed'} : {ok:true,path:`frame-${starts[captures++]}`}},
    scrollWheel:async(x,y,lines,times)=>{wheels++;events.push('wheel');assert.deepEqual([x,y,lines,times],[-68,64,3,2]);return denyWheel?{ok:false,permission:true,error:'需要辅助功能权限'}:{ok:true,trusted:wheelTrusted}},
    pressKeyCode:async(code,repeat)=>{keys++;assert.ok([121,125].includes(code));assert.equal(repeat,code===125?3:1);return deny?{ok:false,permission:true}:{ok:true}},
    readImageAsDataUrl: path=>path,
    removeTempImages:paths=>removed.push(...paths),
    writeUniqueImageToTemp:()=>'/tmp/result.png',
  }}
  globalThis.Image=class {naturalWidth=64;naturalHeight=128;set src(value){this.start=Number(value.split('-')[1])||0;queueMicrotask(()=>this.onload())}}
  globalThis.document={createElement(){let image;const canvas={width:0,height:0,toDataURL:()=> 'data:image/png;base64,AA==',getContext:()=>({drawImage(...args){image=args[0];draws.push(args)},getImageData:()=>({data:cut(capturePage,image.start,canvas.height).pixels})})};return canvas}}
  const {childWindows,rememberChild}=await load('childWindows')
  const win={hide(){hides++;events.push('hide')},show(){shows++},destroy(){},setBounds(bounds){this.bounds=bounds},webContents:{id:10,executeJavaScript:async()=>({phase:'done'})}}
  rememberChild(win,true)
  let pinHides=0,pinShows=0,pinVisible=true
  const pinWin={...win,webContents:{...win.webContents,id:11},hide(){pinHides++;pinVisible=false},show(){pinShows++;pinVisible=true}}
  rememberChild(pinWin,false)
  const originalCapture=window.services.captureRegion
  window.services.captureRegion=async()=>{assert.equal(pinVisible,false);return originalCapture()}

  const {captureScrolling,noScrollError}=await load('scrollCapture')
  const {isWindowGone}=await load('runtime')
  for (const text of ['window not exist','窗口不存在','窗口已关闭','Object has been destroyed']) assert.equal(isWindowGone(new Error(text)),true)
  assert.equal(isWindowGone(new Error('permission denied')),false)
  const rect={x:-100,y:0,w:64,h:128,method:'arrowDown',maxFrames:30,targetApp:'Safari'}
  let result=await captureScrolling(rect)
  assert.equal(result.ok,true);assert.equal(result.frames,3);assert.equal(captures,5);assert.equal(keys,4)
  assert.deepEqual(events.slice(0,3),['hide','activate:Safari','capture'])
  assert.equal(hides,1);assert.equal(shows,1);assert.equal(removed.length,5)
  assert.equal(pinHides,1);assert.equal(pinShows,1);assert.equal(pinVisible,true);assert.equal(childWindows.get(11).winObj,pinWin)
  const composites=draws.filter(args=>args.length===9)
  assert.deepEqual(composites.map(args=>[args[2],args[4],args[6]]),[[0,128,0],[120,8,128],[120,8,136]])
  deny=true;captures=0;removed=[]
  result=await captureScrolling(rect)
  assert.equal(result.permission,true);assert.match(result.error,/需要辅助功能权限/);assert.equal(shows,2);assert.equal(removed.length,1);assert.equal(pinShows,2);assert.equal(pinVisible,true)
  deny=false;failCapture=true
  await assert.rejects(captureScrolling(rect),/capture failed/);assert.equal(shows,3);assert.equal(pinShows,3);assert.equal(pinVisible,true)
  failCapture=false;captures=0;starts=[0,0,0]
  await assert.rejects(captureScrolling(rect),{message:noScrollError('Safari','arrowDown')});assert.equal(captures,2);assert.deepEqual(removed.slice(-2),['frame-0','frame-0'])
  const savedHide=win.hide,hideLogs=[],savedError=console.error
  const beforePinHide=pinHides,beforePinShow=pinShows,beforeShow=shows
  win.hide=()=>{savedHide();throw new Error('hide failed after hiding')}
  const gone={...win,webContents:{...win.webContents,id:12},hide(){throw new Error('window not exist')},show(){throw new Error('window not exist')}}
  rememberChild(gone,false)
  console.error=(...args)=>hideLogs.push(args)
  try {
    captures=0;starts=[0,8]
    assert.equal((await captureScrolling({...rect,maxFrames:2})).ok,true)
    assert.equal(hideLogs.length,1);assert.match(hideLogs[0][1].message,/hide failed/)
    assert.equal(pinHides,beforePinHide+1);assert.equal(pinShows,beforePinShow+1);assert.equal(shows,beforeShow+1)
    failCapture=true
    await assert.rejects(captureScrolling(rect),/capture failed/)
    assert.equal(pinVisible,true);assert.equal(pinShows,beforePinShow+2);assert.equal(shows,beforeShow+2)
  } finally {win.hide=savedHide;console.error=savedError;failCapture=false;childWindows.delete(12)}
  console.log('PASS: best-effort hide continues after non-window-gone error, logs error, restores all processed windows on success/failure, tolerates gone window')
  assert.match(noScrollError('Safari','arrowDown'),/也可能已到内容末尾/)
  assert.doesNotMatch(noScrollError('Safari','arrowDown'),/固定面板/)
  assert.match(noScrollError(),/固定面板/)
  assert.match(noScrollError('Safari','pageDown'),/改用方向键.*焦点/)
  assert.doesNotMatch(noScrollError('Safari','pageDown'),/改用 Page Down/)
  assert.match(noScrollError('Safari','arrowDown'),/改用 Page Down/)
  assert.match(noScrollError(),/滚动区域.*辅助功能授权/)

  assert.match(noScrollError(),/目标：前台窗口/)
  captures=0;starts=[0,300,600]
  result=await captureScrolling({...rect,maxFrames:3});assert.match(result.warning,/未找到重叠/)
  console.log('PASS: overlay + pin hide/restore/state, capture/key/stop/stitch/cleanup, wheel/key permission failures, capture failure, two identical initial frames reject, target error text, quality warning')

  denyWheel=true;captures=0;removed=[]
  result=await captureScrolling({...rect,method:'wheel'})
  assert.equal(result.permission,true);assert.match(result.error,/需要辅助功能权限/)
  assert.equal(removed.length,1);assert.equal(pinVisible,true);assert.equal(pinHides,pinShows)
  denyWheel=false
  captures=0;starts=[0,8,16];events=[]

  const beforeKeys=keys
  result=await captureScrolling({...rect,method:'wheel',maxFrames:3})
  assert.equal(result.ok,true);assert.equal(wheels,3);assert.equal(keys,beforeKeys)
  assert.deepEqual(events,['hide','capture','wheel','capture','wheel','capture'])
  captures=0;events=[]
  await captureScrolling({...rect,method:'pageDown',maxFrames:2})
  assert.deepEqual(events.slice(0,3),['hide','activate:Safari','capture'])
  captures=0;starts=[0,0]
  await assert.rejects(captureScrolling({...rect,method:'wheel'}),{message:noScrollError('Safari')})
  const permissionError='未检测到滚动：ZTools 未获得「辅助功能」权限，模拟事件被系统丢弃。请在 系统设置 → 隐私与安全性 → 辅助功能 中勾选 ZTools 后重试。'
  wheelTrusted=false;captures=0;removed=[]
  const untrustedResult=await captureScrolling({...rect,method:'wheel'})
  assert.deepEqual(untrustedResult,{ok:false,permission:true,error:permissionError})
  assert.equal(captures,2);assert.equal(removed.length,2);assert.equal(pinVisible,true);assert.equal(pinHides,pinShows)
  wheelTrusted=true;captures=0
  await assert.rejects(captureScrolling({...rect,method:'wheel'}),{message:noScrollError('Safari','wheel',true)})
  assert.match(noScrollError('Safari','wheel',true),/内容可滚动/)
  assert.doesNotMatch(noScrollError('Safari','wheel',true),/模拟事件被系统丢弃/)
  // Trust is local to each capture; undefined must not inherit an earlier denial.
  wheelTrusted=undefined;captures=0
  await assert.rejects(captureScrolling({...rect,method:'wheel'}),{message:noScrollError('Safari')})
  wheelTrusted=false;captures=0;starts=[0,8,16]
  assert.equal((await captureScrolling({...rect,method:'wheel',maxFrames:3})).ok,true)
  wheelTrusted=undefined
  console.log('PASS: untrusted + unchanged permission priority, trusted/unknown content hints, untrusted changed frames allowed, per-capture trust reset')
  const originalActivation=window.services.activateApp, originalConsoleError=console.error, logged=[]
  console.error=(...args)=>logged.push(args)
  window.services.activateApp=async()=>({ok:false,error:'raw activation error'})
  captures=0
  try {
    await assert.rejects(captureScrolling(rect),/无法自动把焦点还给 Safari，请在开始前手动点击该窗口再重试/)
    assert.equal(captures,0);assert.equal(logged[0][1],'raw activation error')
    window.services.scrollWheel=async()=>({ok:false,error:'raw wheel stderr'})
    starts=[0,8];captures=0
    await assert.rejects(captureScrolling({...rect,method:'wheel'}),/raw wheel stderr/)
    assert.equal(logged[1][1],'raw wheel stderr')
  } finally {window.services.activateApp=originalActivation;console.error=originalConsoleError}
  window.services.scrollWheel=async()=>({ok:true})
  console.log('PASS: automatic wheel center DIP, no activation/keys, keyboard alternatives, method-specific errors and raw error logging')

  const {controlPosition,pinSize,clampZoom}=await load('windowGeometry')
  const screenBounds={x:0,y:0,width:1000,height:800}
  for (const [region,direction] of [
    [{x:300,y:200,width:300,height:200},'below'],
    [{x:300,y:600,width:300,height:180},'above'],
    [{x:50,y:20,width:300,height:760},'right'],
    [{x:700,y:20,width:280,height:760},'left'],
  ]) {
    const p=controlPosition(region,screenBounds)
    assert.equal(p.overlap,false)
    if(direction==='below') assert.ok(p.y>=region.y+region.height+16)
    if(direction==='above') assert.ok(p.y+p.height<=region.y-16)
    if(direction==='right') assert.ok(p.x>=region.x+region.width+16)
    if(direction==='left') assert.ok(p.x+p.width<=region.x-16)
  }
  const full=controlPosition(screenBounds,screenBounds)
  assert.deepEqual(full,{x:400,y:0,width:200,height:52,overlap:true})
  const negative={x:-1920,y:-148,width:1920,height:1080}
  assert.deepEqual(controlPosition(negative,negative),{x:-1060,y:-148,width:200,height:52,overlap:true})
  const nearFull={x:-1910,y:-138,width:1900,height:1060}
  const top=controlPosition(nearFull,negative)
  assert.equal(top.y,-148);assert.equal(top.x,-1060);assert.equal(top.overlap,true)
  const shallow={x:0,y:0,width:1000,height:80}, shortScreen={x:0,y:0,width:1000,height:100}
  const away=controlPosition(shallow,shortScreen)
  assert.ok(!(500>=away.x && 500<=away.x+away.width && 40>=away.y && 40<=away.y+away.height))
  for(const region of [{x:-1820,y:0,width:300,height:200},{x:-100,y:100,width:50,height:700}]) {
    const p=controlPosition(region,negative)
    assert.ok(p.x>=negative.x && p.x+p.width<=0 && p.y>=negative.y && p.y+p.height<=932)
  }
  assert.equal(clampZoom(0.001),0.1);assert.equal(clampZoom(99),5)
  assert.equal(clampZoom(1.33),1.33)
  assert.deepEqual(pinSize(1000,500,5,screenBounds),{width:1000,height:500})
  assert.deepEqual(pinSize(100,100,0.1,screenBounds),{width:120,height:120})
  assert.deepEqual(pinSize(2000,4000,5,screenBounds),{width:400,height:800})
  assert.deepEqual(pinSize(3000,200,0.1,screenBounds),{width:1000,height:67})
  for (const [w,h,z,b] of [[100,100,0.1,screenBounds],[3000,200,0.1,screenBounds],
    [5000,3000,5,screenBounds],[200,3000,5,negative],[100,100,1,{width:90,height:60}]]) {
    const size=pinSize(w,h,z,b)
    assert.ok(size.width<=b.width && size.height<=b.height)
    assert.ok(Math.abs((size.width/size.height)/(w/h)-1)<0.01,`aspect ratio ${w}x${h}`)
  }
  const pinLayoutSource=readFileSync(path.join(root,'src/pin/Pin.vue'),'utf8')
  assert.match(pinLayoutSource,/object-fit:contain/);assert.match(pinLayoutSource,/align-items:center;justify-content:center/)
  console.log('PASS: control below/above/right/left, full screen, center avoidance and negative dual-screen coordinates; pin 0.1–5 clamp, aspect/screen/minimum size')

  // Execute zoom behavior with lifecycle and native-window doubles.
  let zoomMounted,zoomUnmounted,resizeBehavior='works',zoomRequests=[],resizeCalls=[],zoomListeners=new Map()
  const zoomWindow={innerWidth:400,innerHeight:200,screenX:-100,screenY:10,
    addEventListener:(name,fn)=>zoomListeners.set(name,fn),removeEventListener:name=>zoomListeners.delete(name),
    resizeTo(width,height){resizeCalls.push({width,height});if(resizeBehavior==='throws') throw new Error('unavailable');if(resizeBehavior==='works'){this.innerWidth=width;this.innerHeight=height}}}
  const zoomContext={exports:{},window:zoomWindow,screen:{width:1000,height:800},setTimeout,clearTimeout,
    require(name){
      if(name==='vue') return {shallowRef:value=>({value}),computed:get=>({get value(){return get()}}),onMounted:fn=>{zoomMounted=fn},onUnmounted:fn=>{zoomUnmounted=fn}}
      if(name.endsWith('windowGeometry')) return {clampZoom,pinSize}
      if(name.endsWith('parentLink')) return {requestParent:async(type,payload)=>{zoomRequests.push({type,payload});return {ok:true,bounds:screenBounds}}}
      throw new Error('Unexpected zoom import '+name)
    }}
  const zoomCode=ts.transpileModule(readFileSync(path.join(root,'src/pin/usePinZoom.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  vm.runInNewContext(zoomCode,zoomContext)
  const zoom=zoomContext.exports.usePinZoom();zoomMounted()
  zoom.loaded({target:{naturalWidth:800,naturalHeight:400}})
  assert.equal(zoom.percent.value,50)
  const wheelEvent={deltaY:-1,preventDefault(){},stopPropagation(){}}
  await zoom.wheel(wheelEvent)
  assert.deepEqual(resizeCalls.at(-1),{width:440,height:220});assert.equal(zoom.percent.value,55)
  await zoom.reset();assert.deepEqual(resizeCalls.at(-1),{width:400,height:200});assert.equal(zoom.percent.value,50)
  zoomWindow.innerWidth=1000;zoomWindow.innerHeight=500;zoomListeners.get('resize')()
  await zoom.wheel(wheelEvent);assert.equal(resizeCalls.at(-1).width,1000)
  await zoom.wheel({...wheelEvent,deltaY:1});assert.equal(resizeCalls.at(-1).width,909)
  await zoom.reset()
  resizeBehavior='noop';await zoom.wheel(wheelEvent)
  assert.equal(zoom.percent.value,50) // first ignored resize does not enter fallback
  assert.equal(Number.parseFloat(zoom.imageStyle.value.width),400)
  resizeBehavior='works';await zoom.wheel(wheelEvent) // success resets failure count
  assert.equal(zoom.percent.value,55)
  resizeBehavior='throws';await zoom.wheel(wheelEvent)
  assert.equal(zoom.percent.value,55) // one failure after success is insufficient
  resizeBehavior='noop';await zoom.wheel(wheelEvent)
  assert.ok(Number.parseFloat(zoom.imageStyle.value.width)>480)
  assert.equal(zoom.percent.value,61) // second consecutive failure enables CSS zoom
  resizeBehavior='works';await zoom.reset()
  resizeBehavior='throws';await zoom.wheel(wheelEvent)
  assert.equal(zoom.percent.value,50)
  await zoom.wheel(wheelEvent);assert.equal(zoom.percent.value,55)
  resizeBehavior='works';await zoom.wheel(wheelEvent)
  assert.equal(zoom.percent.value,61)
  resizeBehavior='throws';await zoom.wheel(wheelEvent)
  assert.equal(zoom.percent.value,61) // native success also exits fallback and clears count
  zoom.down({button:0,screenX:10,screenY:20,pointerId:1,target:{closest:()=>false},currentTarget:{setPointerCapture(){}}})
  zoom.move({buttons:1,screenX:30,screenY:50});zoom.up()
  assert.equal(zoomRequests.at(-1).type,'pin-move');assert.equal(zoomRequests.at(-1).payload.x,-80);assert.equal(zoomRequests.at(-1).payload.y,40)
  zoomUnmounted();assert.equal(zoomListeners.size,0)
  console.log('PASS: pin wheel starts from fit, native proportional resize, double-click reset, resize no-op/throw CSS fallback, pointer move RPC and lifecycle cleanup')

  const {collectManual,SINGLE_FRAME_ERROR}=await load('manualCapture')
  assert.equal(SINGLE_FRAME_ERROR,'未检测到滚动：只有一帧画面，未生成拼接图')
  let clock=0,index=0,statuses=[],waits=[],discarded=[]
  const manualControl={stopped:false,canceled:false,async wait(ms){waits.push(ms);clock+=ms}}
  const collected=await collectManual({control:manualControl,now:()=>clock,
    capture:async()=>{const value=index++===0?0:1;return {value,pixels:new Uint8ClampedArray([value,0,0,255])}},
    status:async(frames,idle)=>statuses.push({frames,idle}),discard:value=>discarded.push(value)})
  assert.deepEqual(collected,[0,1]);assert.equal(clock,2880)
  assert.ok(statuses.at(-2).idle<2500);assert.ok(statuses.at(-1).idle>=2500)
  assert.ok(waits.every(ms=>ms===320));assert.ok(discarded.length>=7)
  clock=0;index=0
  await assert.rejects(collectManual({control:manualControl,now:()=>clock,
    capture:async()=>({value:index++,pixels:new Uint8ClampedArray([0])}),
    status:async()=>{if(clock>=3200) manualControl.stopped=true}}),{message:SINGLE_FRAME_ERROR})
  assert.ok(index>=11) // a single frame never auto-finishes at 2.5s
  manualControl.stopped=false;clock=0;index=0
  const sixty=await collectManual({control:manualControl,now:()=>clock,maxFrames:999,
    capture:async()=>({value:index,pixels:new Uint8ClampedArray([index++])}),status:async()=>{}})
  assert.equal(sixty.length,60)
  manualControl.stopped=false;manualControl.canceled=false
  const canceled=await collectManual({control:manualControl,
    capture:async()=>({value:1,pixels:new Uint8ClampedArray([1])}),status:async()=>{manualControl.stopped=true;manualControl.canceled=true}})
  assert.equal(canceled,null)
  // Virtual time checks the exact deadline without waiting 45 real seconds.
  manualControl.stopped=false;manualControl.canceled=false;clock=0;index=0
  await assert.rejects(collectManual({control:manualControl,now:()=>clock,
    capture:async()=>({value:index++,pixels:new Uint8ClampedArray([0])}),status:async()=>{}}),{message:SINGLE_FRAME_ERROR})
  assert.equal(clock,45000)
  clock=0;index=0
  const timedFrames=await collectManual({control:manualControl,now:()=>clock,
    capture:async()=>({value:index++,pixels:new Uint8ClampedArray([Math.floor(clock/2000)])}),status:async()=>{}})
  assert.equal(clock,45000);assert.ok(timedFrames.length>=2 && timedFrames.length<60)
  let expireManual,timeoutMs,cleared=false,releaseCapture
  const lateDiscard=[]
  const manualContext={exports:{},setTimeout(fn,ms){expireManual=fn;timeoutMs=ms;return 1},clearTimeout(){cleared=true}}
  vm.runInNewContext(ts.transpileModule(readFileSync(path.join(root,'src/shared/manualCapture.ts'),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,manualContext)
  const stalled=manualContext.exports.collectManual({control:manualControl,
    capture:()=>new Promise(resolve=>{releaseCapture=resolve}),status:async()=>{},discard:value=>lateDiscard.push(value)})
  assert.equal(timeoutMs,45000)
  const stalledCheck=assert.rejects(stalled,{message:SINGLE_FRAME_ERROR})
  expireManual();await stalledCheck;assert.equal(cleared,true)
  releaseCapture({value:'late-frame',pixels:new Uint8ClampedArray([1])})
  await Promise.resolve();assert.deepEqual(lateDiscard,['late-frame'])
  console.log('PASS: manual 45s hard deadline, existing frames returned, single-frame error, stalled capture timeout and late-frame discard')
  console.log('PASS: manual full-pixel dedup/discard, 320ms cadence, 2.5s idle with >=2 frames, 60 frame cap, cancel and exact single-frame error')

  // Exercise the actual parent capture and control RPC with input services that fail if invoked.
  const {handleShotRequest:routeManual}=await load('parentRequests')
  const {showWithoutFocus}=await load('scrollControl')
  let focusable=[],displayed=0
  showWithoutFocus({setFocusable:value=>focusable.push(value),show:()=>displayed++})
  assert.deepEqual(focusable,[false,true]);assert.equal(displayed,1)
  const oldCreate=api.createBrowserWindow,oldDisplays=api.getAllDisplays
  const oldInputs={activateApp:window.services.activateApp,scrollWheel:window.services.scrollWheel,pressKeyCode:window.services.pressKeyCode}
  for(const name of Object.keys(oldInputs)) window.services[name]=async()=>{events.push(name);assert.fail('manual input: '+name)}
  api.getAllDisplays=()=>[{bounds:{x:-200,y:-100,width:800,height:600}}]
  let ctlDestroyed=0,ctlShown=0,ctlHidden=0,ctlVisible=false,ctlHiddenAt=0,ctlOptions,ctlStatuses=[],stopMode='finish',ctlReply
  api.createBrowserWindow=(url,options)=>{
    assert.equal(url,'dist/scrollctl.html');ctlOptions=options
    return {hide(){ctlHidden++;ctlVisible=false;ctlHiddenAt=Date.now()},showInactive(){ctlShown++;ctlVisible=true},destroy(){ctlDestroyed++;ctlVisible=false},
      webContents:{id:55,async executeJavaScript(code){
        if(code.includes('phase:')) return {phase:'ready'}
        if(code.startsWith('window.__shotReply')) {ctlReply=JSON.parse(code.slice(code.indexOf(',')+1,-1));return {}}
        const status=JSON.parse(code.slice(code.indexOf('(')+1,-1));ctlStatuses.push(status)
        if((stopMode==='finish' && status.frames>=2) || stopMode==='single' || stopMode==='cancel') {
          await routeManual({id:'ctl',type:stopMode==='cancel'?'ctl-cancel':'ctl-finish',payload:{}},55)
        }
        return {}
      }}}
  }
  const fallbackLogs=[],fallbackConsole=console.error
  console.error=(...args)=>fallbackLogs.push(args)
  try {
    captures=0;starts=[0,8];events=[];removed=[]
    const inputCounts=[wheels,keys]
    const manualResult=await captureScrolling({...rect,method:undefined,maxFrames:60})
    assert.equal(manualResult.ok,true);assert.equal(manualResult.frames,2)
    assert.deepEqual([wheels,keys],inputCounts);assert.ok(!events.some(e=>/activate|wheel|key/i.test(e)))
    assert.equal(ctlReply.ok,true);assert.equal(ctlDestroyed,1);assert.equal(childWindows.has(55),false)
    assert.deepEqual(ctlStatuses.map(s=>s.frames),[1,2]);assert.equal(ctlOptions.show,false);assert.equal(ctlOptions.focusable,true)
    for(const key of ['frame','resizable','skipTaskbar','alwaysOnTop']) assert.equal(ctlOptions[key],['skipTaskbar','alwaysOnTop'].includes(key))
    assert.equal(pinVisible,true);assert.equal(pinHides,pinShows);assert.equal(removed.length,2)
    for(const mode of ['single','cancel']) {
      stopMode=mode;captures=0;starts=[0];removed=[]
      if(mode==='single') await assert.rejects(captureScrolling({...rect,method:'manual'}),{message:SINGLE_FRAME_ERROR})
      else assert.deepEqual(await captureScrolling({...rect,method:'manual'}),{ok:false,canceled:true})
      assert.equal(pinVisible,true);assert.equal(removed.length,1);assert.equal(childWindows.has(55),false)
    }
    stopMode='finish';captures=0;starts=[0,8]
    const previousCapture=window.services.captureRegion
    window.services.captureRegion=async()=>{assert.equal(ctlVisible,false);assert.ok(Date.now()-ctlHiddenAt>=115,'overlap must wait 120ms');return previousCapture()}
    try {
      await captureScrolling({...rect,x:-200,y:-100,w:800,h:600,method:'manual',maxFrames:2})
      assert.equal(ctlOptions.opacity,0.8);assert.ok(ctlHidden>=2);assert.ok(ctlShown>=3)
    } finally {window.services.captureRegion=previousCapture}
    failCapture=true
    await assert.rejects(captureScrolling({...rect,method:'manual'}),/capture failed/)
    assert.equal(pinVisible,true);assert.equal(childWindows.has(55),false)
    failCapture=false
    const foreign=[]
    win.webContents.executeJavaScript=async code=>{foreign.push(code);return {}}
    await routeManual({id:'foreign',type:'ctl-finish',payload:{}},10)
    assert.match(foreign.at(-1),/会话已结束/)
  } finally {
    assert.ok(fallbackLogs.some(args=>String(args[0]).includes('falling back')))
    console.error=fallbackConsole
    Object.assign(window.services,oldInputs);api.createBrowserWindow=oldCreate;api.getAllDisplays=oldDisplays;failCapture=false
    win.webContents.executeJavaScript=async()=>({phase:'done'})
  }
  console.log('PASS: actual default manual has zero activate/wheel/key calls, control create/status/finish/cancel RPC, single-frame rejection, overlap hide/capture/show, errors clean files/windows')

  // TASK-006: real presentation rollback, including a partially enabled second display.
  const {prepareCapture}=await load('capturePresentation')
  for (const failure of ['missing','reject','state']) {
    const calls=[],logs=[],savedLog=console.error
    const overlay=(id)=>({hide:()=>calls.push([id,'hide']),show:()=>calls.push([id,'show']),
      async setIgnoreMouseEvents(value,options){calls.push([id,'mouse',value,options]);if(id===2 && value && failure==='reject') throw new Error('bridge rejected')},
      webContents:{async executeJavaScript(code){calls.push([id,code]);if(id===2 && code.includes("('active')") && failure==='state') throw new Error('state failed')}}})
    const a=overlay(1),b=overlay(2)
    if(failure==='missing') delete b.setIgnoreMouseEvents
    console.error=(...args)=>logs.push(args)
    try {
      const presentation=await prepareCapture([{winObj:a,overlay:true},{winObj:b,overlay:true}],true)
      assert.equal(presentation.live,false)
      for(const id of [1,2]) assert.ok(calls.findIndex(c=>c[0]===id && String(c[1]).includes("('idle')")) < calls.findIndex(c=>c[0]===id && c[1]==='hide'))
      assert.equal(calls.filter(c=>c[1]==='hide').length,2)
      assert.ok(calls.some(c=>c[0]===1 && c[1]==='mouse' && c[2]===false))
      await presentation.restore()
      assert.equal(calls.filter(c=>c[1]==='show').length,2)
      assert.ok(logs.some(args=>String(args[0]).includes('falling back')))
    } finally {console.error=savedLog}
  }
  console.log('PASS: missing/rejected mouse passthrough and state failure downgrade, partial multi-display rollback, console.error and old hide/show path')

  const {createScrollPreview,PREVIEW_INTERVAL_MS,PREVIEW_WIDTH}=await load('scrollPreview')
  const savedDocument=globalThis.document,previewCanvases=[],previewSent=[]
  let previewClock=0
  globalThis.document={createElement(){const canvas={width:0,height:0,draws:[],
    getContext:()=>({drawImage:(...args)=>canvas.draws.push(args),getImageData:()=>{
      const image=canvas.draws[0][0],scale=canvas.width/image.naturalWidth
      return {data:cut(capturePage,image.start,canvas.height).pixels}
    }}),
    toDataURL(type,quality){assert.equal(type,'image/jpeg');assert.equal(quality,0.7);return `data:image/jpeg;base64,${this.width}`}}
    previewCanvases.push(canvas);return canvas}}
  try {
    assert.ok(PREVIEW_INTERVAL_MS>=150);assert.ok(PREVIEW_WIDTH<=200)
    const preview=createScrollPreview(async status=>previewSent.push({...status,time:previewClock}),()=>previewClock)
    const wide=start=>cut(previewPage,start,256)
    const previewPage=makePage(640,900)
    const wideImage=start=>({start,naturalWidth:640,naturalHeight:256})
    await preview.append(wideImage(0),wide(0),0,256)
    previewClock=149;await preview.append(wideImage(128),wide(128),128,256)
    assert.equal(previewSent.length,1)
    previewClock=150;await preview.append(wideImage(256),wide(256),128,256)
    assert.deepEqual(previewSent.map(s=>[s.frames,s.height,s.time]),[[1,256,0],[3,512,150]])
    assert.ok(previewSent.every(s=>s.thumb.startsWith('data:image/jpeg;')))
    assert.ok(previewCanvases.every(c=>c.width<=200))
    assert.equal(previewCanvases.at(-1).height,Math.round(512*200/640))
    assert.equal(previewCanvases.at(-1).draws.at(-1)[2],40)
    const small=createScrollPreview(async()=>{})
    await small.append({start:0,naturalWidth:64,naturalHeight:24},frame(0),0,24);assert.equal(previewCanvases.at(-1).width,64)

    // Drive the production collector, stitch guard and preview together. Files
    // exist on disk so discard verifies deletion, not only a mock call count.
    const {createManualStitch}=await load('manualStitch')
    let guardedRun=0
    async function guardedCapture(starts,maxFrames=60) {
      const run=guardedRun++
      let clock=0,index=0
      const guard=createManualStitch(),statuses=[],offsets=[],deleted=[],files=[]
      const control={stopped:false,canceled:false,async wait(ms){clock+=ms}}
      const preview=createScrollPreview(async status=>statuses.push({...status}),()=>clock)
      let output,error
      try {
        output=await collectManual({control,maxFrames,now:()=>clock,
          async capture() {
            assert.ok(index<starts.length,'capture must terminate without extra frames')
            const start=starts[index],path=pathFor(index++)
            writeFileSync(path,'temporary capture');files.push(path)
            const sample=frame(start)
            return {value:{start,path,frame:sample},pixels:sample.pixels}
          },
          discard(item) {rmSync(item.path);deleted.push(item.path)},
          async accepted(item) {
            const result=guard.accept(item.frame)
            if(!result.accepted) {
              if(guard.consecutive>=8) control.stopped=true
              await preview.skipped(guard.skipped,guard.consecutive)
              return false
            }
            offsets.push(result.offset)
            await preview.append({naturalWidth:64,naturalHeight:128},item.frame,result.offset,128,guard.skipped,guard.consecutive)
          },
          async status() {},
        })
      } catch(cause) {error=cause}
      function pathFor(index) {return path.join(directory,`guard-${run}-${index}.png`)}
      return {output,error,guard,statuses,offsets,deleted,files,index,control}
    }
    const recovered=await guardedCapture([0,300,600,900,8,16],3)
    assert.ifError(recovered.error)
    assert.deepEqual(recovered.output.map(item=>item.start),[0,8,16])
    assert.deepEqual(recovered.statuses.map(s=>s.frames),[1,1,1,1,2,3])
    assert.equal(recovered.statuses[1].skipped,1)
    assert.equal(recovered.deleted.length,3)
    assert.ok(recovered.deleted.every(file=>!existsSync(file)))
    assert.ok(recovered.output.every(item=>existsSync(item.path)))
    assert.equal(recovered.statuses[3].skipped,3);assert.equal(recovered.statuses[3].consecutive,3)
    assert.deepEqual(recovered.offsets,[0,120,120],'recovery compares to last accepted, not skipped frame')
    assert.equal(recovered.statuses[4].consecutive,0);assert.equal(recovered.statuses[4].skipped,3)
    assert.equal(recovered.statuses.at(-1).height,144)
    const stopped=await guardedCapture([0,8,300,600,900,1200,1500,1800,2100,300])
    assert.ifError(stopped.error);assert.equal(stopped.control.stopped,true)
    assert.equal(stopped.index,10);assert.equal(stopped.output.length,2)
    assert.equal(stopped.guard.consecutive,8);assert.equal(stopped.guard.skipped,8)
    assert.equal(stopped.deleted.length,8)
    const single=await guardedCapture([0,300,600,900,1200,1500,1800,2100,300])
    assert.equal(single.error.message,SINGLE_FRAME_ERROR);assert.equal(single.guard.skipped,8)
    const integer=await guardedCapture([0,8,16],3)
    assert.ifError(integer.error);assert.equal(integer.output.length,3)
    assert.equal(integer.guard.skipped,0);assert.equal(integer.deleted.length,0)
    assert.deepEqual(integer.offsets,[0,120,120])
    const capped=await guardedCapture([0,300,600,900,...Array.from({length:59},(_,i)=>(i+1)*8)],999)
    assert.ifError(capped.error);assert.equal(capped.output.length,60);assert.equal(capped.index,63)
    assert.equal(capped.guard.skipped,3);assert.equal(capped.deleted.length,3)
    console.log('PASS: manual hard cap after skips: accepted=60, captures=63, skipped=3, deleted=3')
    console.log('PASS: safety 1: rejected offset=0, frames 1→1, skipped=1; 3/3 real temporary files deleted; previous preserved (recovery offset=120)')
    console.log('PASS: safety 2: preview frames=1, skipped=3, consecutive=3 (warning text exercised by panel below)')
    console.log('PASS: safety 3: consecutive=8 stops at capture=10, accepted=2, deleted=8; one accepted frame preserves SINGLE_FRAME_ERROR')
    console.log('PASS: safety 4: recovery accepted=[0,8,16], offsets=[0,120,120], consecutive=0, skipped=3, height=144, cap=3 after 6 captures')
    console.log('PASS: safety 5: integer accepted=3, offsets=[0,120,120], skipped=0, deleted=0')
  } finally {globalThis.document=savedDocument}
  console.log('PASS: preview >=150ms throttle, deduplicated frames/stitched height, full-resolution offset crop, JPEG 0.7 and <=200px width')

  // Pixel-preserving canvas: execute every crop/resize/composite, rather than only counting calls.
  const pixelDoc=globalThis.document,pixelOutputs=[]
  globalThis.document={createElement(){
    const canvas={width:0,height:0,data:null,draws:[],getContext(){return {drawImage(source,...args){
      canvas.draws.push(args)
      canvas.data ??= new Uint8Array(canvas.width*canvas.height*4)
      const swidth=source.naturalWidth ?? source.width,sheight=source.naturalHeight ?? source.height
      let sx=0,sy=0,sw=swidth,sh=sheight,dx,dy,dw,dh
      if(args.length===2) {[dx,dy]=args;dw=sw;dh=sh}
      else if(args.length===4) {[dx,dy,dw,dh]=args}
      else [sx,sy,sw,sh,dx,dy,dw,dh]=args
      for(let y=0;y<dh;y++) for(let x=0;x<dw;x++) {
        const from=(Math.floor(sy+y*sh/dh)*swidth+Math.floor(sx+x*sw/dw))*4
        const to=((dy+y)*canvas.width+dx+x)*4
        canvas.data.set(source.data.slice(from,from+4),to)
      }
    },getImageData(){return {data:canvas.data.slice()}}}},toDataURL(type,quality){
      assert.equal(type,'image/jpeg');assert.equal(quality,0.7)
      pixelOutputs.push({width:this.width,height:this.height,data:this.data.slice(),draws:this.draws.slice()})
      return 'data:image/jpeg;base64,pixels'
    }};return canvas
  }}
  try {
    for(const width of [200,400]) {
      const content=makePage(width,600)
      let tick=0,last
      const preview=createScrollPreview(async status=>{last=status},()=>tick)
      const make=start=>{
        const height=160,sample=cut(content,start,height),data=sample.pixels
        return {image:{naturalWidth:width,naturalHeight:height,data},sample}
      }
      const input=[make(0),make(60),make(120)]
      const fullOffsets=stitchOffsets(input.map(item=>item.sample))
      for(const [i,item] of input.entries()) {await preview.append(item.image,item.sample,fullOffsets[i],item.sample.height);tick+=150}
      const out=pixelOutputs.at(-1),scale=out.width/width
      assert.equal(out.height,280*scale);assert.equal(last.height,280);assert.equal(last.frames,3)
      assert.deepEqual([...out.data.slice(0,4)],[...input[0].image.data.slice(0,4)])
      for(let y=0;y<out.height;y++) {
        for(let x=0;x<out.width;x++) assert.deepEqual([...out.data.subarray((y*out.width+x)*4,(y*out.width+x+1)*4)],[...content.pixels.subarray((Math.floor(y/scale)*width+Math.floor(x/scale))*4,(Math.floor(y/scale)*width+Math.floor(x/scale)+1)*4)],`row ${y}, scale ${scale}`)
      }
      // Upward frames follow the very same unsupported-direction behavior as the final stitch.
      const upward=[make(60),make(0)]
      const up=createScrollPreview(async status=>{last=status},()=>tick)
      const offsets=stitchOffsets(upward.map(item=>item.sample))
      for(const [i,item] of upward.entries()) {await up.append(item.image,item.sample,offsets[i],item.sample.height);tick+=150}
      assert.equal(last.height,upward.reduce((h,item,i)=>h+item.sample.height-offsets[i],0))
    }
    // Crossing 30 frames resizes all retained thumbnails; stop retaining at 60.
    let manyTick=0,manyLast
    const many=createScrollPreview(async status=>{manyLast=status},()=>manyTick)
    const data=new Uint8Array(400*80*4)
    const image={naturalWidth:400,naturalHeight:80,data}
    const sample=samplePixels(400,80,data)
    for(let i=0;i<65;i++) {
      await many.append(image,sample,i ? sample.height : 0,sample.height);manyTick+=150
      assert.equal(pixelOutputs.at(-1).width,i<30?200:140)
    }
    assert.equal(manyLast.frames,60);assert.equal(manyLast.height,80)

    // Non-divisible real capture ratios, including overlaps that become fewer than 8 rows.
    const realPage=makePage(1600,12510,17,false,true)
    const makeReal=(start,height=400)=>{
      const sample=cut(realPage,start,height)
      return {image:{naturalWidth:1600,naturalHeight:height,data:sample.pixels},sample}
    }
    const thumbnailRows=new Map()
    function identifyRow(out,y) {
      // Identify by complete visible content, never an encoded channel.
      let lookup=thumbnailRows.get(out.width)
      if(!lookup) {
        lookup=new Map()
        for(const resized of (out.width===140 ? [false,true] : [false])) for(let row=0;row<realPage.height;row++) {
          const pixels=new Uint8Array(out.width*4)
          for(let x=0;x<out.width;x++) {
            const sourceX=resized ? Math.floor(Math.floor(x*200/140)*1600/200) : Math.floor(x*1600/out.width)
            const at=(row*1600+sourceX)*4
            pixels.set(realPage.pixels.subarray(at,at+4),x*4)
          }
          const key=hash(pixels)
          assert.ok(!lookup.has(key) || lookup.get(key)===row,'unique ordinary thumbnail row content')
          lookup.set(key,row)
        }
        thumbnailRows.set(out.width,lookup)
      }
      const row=lookup.get(hash(out.data.subarray(y*out.width*4,(y+1)*out.width*4)))
      assert.notEqual(row,undefined,'thumbnail row belongs to original full page')
      return row
    }
    for(const overlap of [100,40]) {
      const input=Array.from({length:3},(_,i)=>makeReal(i*(400-overlap)))
      const offsets=stitchOffsets(input.map(item=>item.sample))
      assert.deepEqual(offsets,[0,overlap,overlap])
      let tick=0,last
      const preview=createScrollPreview(async status=>{last=status},()=>tick)
      for(const [i,item] of input.entries()) {
        await preview.append(item.image,item.sample,offsets[i],400);tick+=150
        const out=pixelOutputs.at(-1),scale=out.width/1600
        assert.equal(last.height,input.slice(0,i+1).reduce((h,item,j)=>h+item.sample.height-offsets[j],0))
        assert.deepEqual(out.draws.map(args=>args[1]),offsets.slice(0,i+1).map(offset=>Math.round(offset*scale)))
        let previousRow=-1
        for(let y=0;y<out.height;y++) {
          const row=identifyRow(out,y)
          assert.ok(row>previousRow,`duplicate/backward row at seam: overlap ${overlap}, row ${y}: ${previousRow} -> ${row}`)
          assert.ok(previousRow<0 || row-previousRow<=16,`unexpected seam gap at ${y}`)
          previousRow=row
        }
      }
    }
    // 40 frames cross the 140px tier: counters stay in original pixels on every append.
    let realTick=0,realLast,total=0,previousReal
    const realMany=createScrollPreview(async status=>{realLast=status},()=>realTick)
    for(let i=0;i<40;i++) {
      const item=makeReal(i*300),offset=previousReal ? stitchOffsets([previousReal,item.sample])[1] : 0
      total+=400-offset
      await realMany.append(item.image,item.sample,offset,400);realTick+=150
      assert.equal(realLast.height,total)
      const out=pixelOutputs.at(-1),scale=out.width/1600
      assert.equal(out.width,i<30 ? 200 : 140)
      assert.deepEqual(out.draws.map(args=>args[1]),Array.from({length:i+1},(_,j)=>Math.round((j ? 100 : 0)*scale)))
      let prior=-1
      for(let y=0;y<out.height;y++) {
        const row=identifyRow(out,y)
        assert.ok(row>prior,`140px resampling duplicate/backward row: frame ${i+1}, row ${y}`)
        prior=row
      }
      previousReal=item.sample
    }
    assert.equal(realLast.frames,40);assert.equal(realLast.height,12100)
    const warn=console.warn,warnings=[]
    try {
      console.warn=(...args)=>warnings.push(args)
      const fallback=createScrollPreview(async status=>{realLast=status})
      const item=makeReal(0)
      for(const offset of [undefined,NaN,-1,401]) await fallback.append(item.image,item.sample,offset,400)
      assert.equal(warnings.length,4)
      assert.equal(pixelOutputs.at(-1).draws[0][1],0)
      // Force one unthrottled update to verify every fallback contributes the full height.
      const immediate=createScrollPreview(async status=>{realLast=status},()=>realTick+=150)
      await immediate.append(item.image,item.sample,undefined,400)
      await immediate.append(item.image,item.sample,undefined,400)
      assert.equal(realLast.height,800)
    } finally {console.warn=warn}
    console.log('PASS: 1600px/400px real pixels, 100px and <8 thumbnail-row overlaps, mapped offsets, monotonic seams, 40-frame exact height, 140px resampling and warned fallback')
  } finally {globalThis.document=pixelDoc}
  console.log('PASS: pixel-preserving preview, three frames/100px overlap, first row, all seam rows, scaled/unscaled height and upward parity')

  // Run all four exits through the actual parent orchestration with visible overlays.
  const liveCalls=[],liveStatuses=[]
  const savedExecute=win.webContents.executeJavaScript,savedIgnore=win.setIgnoreMouseEvents
  win.setIgnoreMouseEvents=async(value,options)=>{liveCalls.push(['mouse',value,options])}
  win.webContents.executeJavaScript=async code=>{liveCalls.push(['state',code]);return {}}
  api.getAllDisplays=()=>[{bounds:{x:-200,y:-100,width:800,height:600}}]
  let liveMode='finish',releaseLate
  api.createBrowserWindow=(url,options)=>{
    assert.equal(url,'dist/scrollctl.html?preview=1');assert.equal(options.width,240)
    return {hide(){},showInactive(){},destroy(){liveCalls.push(['close'])},webContents:{id:55,async executeJavaScript(code){
      if(code.includes('phase:')) return {phase:'ready'}
      if(code.startsWith('window.__shotReply')) return {}
      assert.ok(code.startsWith('window.__preview('))
      const status=JSON.parse(code.slice(code.indexOf('(')+1,-1));liveStatuses.push(status)
      if((liveMode==='finish' && status.frames>=2) || (liveMode==='recover' && status.frames>=3) || liveMode==='cancel') await routeManual({id:'live',type:liveMode==='cancel'?'ctl-cancel':'ctl-finish',payload:{}},55)
      return {}
    }}}
  }
  const liveCapture=window.services.captureRegion
  const realTimeout=globalThis.setTimeout
  try {
    for(const mode of ['finish','cancel','exception','timeout']) {
      liveMode=mode;liveCalls.length=0;liveStatuses.length=0;captures=0;starts=[0,8];removed=[]
      const beforeHide=hides,beforeShow=shows
      failCapture=mode==='exception'
      if(mode==='timeout') {
        globalThis.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms===45000?0:ms,...args)
        window.services.captureRegion=()=>new Promise(resolve=>{releaseLate=resolve})
      }
      if(mode==='finish') {const result=await captureScrolling({...rect,method:'manual'});assert.equal(result.ok,true);assert.equal(result.frames,2)}
      if(mode==='cancel') assert.deepEqual(await captureScrolling({...rect,method:'manual'}),{ok:false,canceled:true})
      if(mode==='exception') await assert.rejects(captureScrolling({...rect,method:'manual'}),/capture failed/)
      if(mode==='timeout') {
        await assert.rejects(captureScrolling({...rect,method:'manual'}),{message:SINGLE_FRAME_ERROR})
        releaseLate({ok:true,path:'late-native-frame'})
        await new Promise(resolve=>realTimeout(resolve,0))
        assert.ok(removed.includes('late-native-frame'))
      }
      assert.equal(hides,beforeHide);assert.equal(shows,beforeShow)
      assert.deepEqual(liveCalls[0],['mouse',true,{forward:true}])
      assert.ok(liveCalls[1][1].includes("__shotCaptureState('active')"))
      assert.deepEqual(liveCalls.at(-2),['mouse',false,undefined])
      assert.ok(liveCalls.at(-1)[1].includes("__shotCaptureState('idle')"))
      assert.ok(liveCalls.findIndex(c=>c[0]==='close')<liveCalls.length-2)
      assert.equal(pinVisible,true);assert.equal(childWindows.has(55),false)
      if(mode==='finish') assert.deepEqual(liveStatuses.map(s=>[s.frames,s.height]),[[1,128],[2,136]])
      window.services.captureRegion=liveCapture;globalThis.setTimeout=realTimeout
    }
    for(const [mode,input] of [
      ['recover',[0,300,600,900,8,16]],
      ['unrecognized',[0,8,300,600,900,1200,1500,1800,2100,300]],
      ['single-skip',[0,300,600,900,1200,1500,1800,2100,300]],
    ]) {
      liveMode=mode;starts=input;captures=0;liveStatuses.length=0;removed=[];draws=[];toastMessages=[]
      if(mode==='single-skip') await assert.rejects(captureScrolling({...rect,method:'manual'}),{message:SINGLE_FRAME_ERROR})
      else {
        const result=await captureScrolling({...rect,method:'manual'})
        assert.equal(result.ok,true);assert.equal(result.frames,mode==='recover'?3:2)
      }
      assert.equal(captures,input.length)
      assert.equal(toastMessages.filter(text=>text==='未能识别本次衔接，已跳过该帧以免重复').length,1,'one toast per session')
      assert.ok(liveStatuses.some(s=>s.skipped===3 && s.consecutive===3))
      const terminal=liveStatuses.at(-1)
      assert.equal(terminal.skipped,mode==='recover'?3:8)
      assert.equal(terminal.consecutive,mode==='recover'?0:8)
      assert.equal(terminal.frames,mode==='recover'?3:mode==='single-skip'?1:2)
      const lastComposite=draws.filter(args=>args.length===9).slice(-terminal.frames)
      if(mode==='recover') {
        assert.deepEqual(lastComposite.map(args=>[args[2],args[4],args[6]]),[[0,128,0],[120,8,128],[120,8,136]])
        assert.equal(terminal.height,144)
      }
      assert.ok(input.every(start=>removed.includes(`frame-${start}`)))
      assert.equal(childWindows.has(55),false)
      console.log(`PASS: actual manual ${mode}: captures=${captures}, accepted=${terminal.frames}, skipped=${terminal.skipped}, consecutive=${terminal.consecutive}, toast=1, preview height=${terminal.height}, files cleaned`)
    }
  } finally {
    failCapture=false;window.services.captureRegion=liveCapture;globalThis.setTimeout=realTimeout
    win.webContents.executeJavaScript=savedExecute
    if(savedIgnore) win.setIgnoreMouseEvents=savedIgnore;else delete win.setIgnoreMouseEvents
    api.createBrowserWindow=oldCreate;api.getAllDisplays=oldDisplays
  }
  toastMessages=[] // Isolate the explicit safety-toast cases from later RPC error tests.
  console.log('PASS: manual visible overlay + true/forward, active/idle, preview RPC and finish/cancel/exception/hard-timeout restore before returning; late native frame cleaned')
  // TASK-006-FIX1: cancel from another display, including a stalled native capture.
  const cancelCalls=[],cancelReplies=new Map()
  let cancelRelease,cancelStarted,cancelReady
  const cancelLog=console.error,cancelErrors=[]
  console.error=(...args)=>cancelErrors.push(args)
  const cancelCapture=window.services.captureRegion
  const overlayFor=id=>({hide(){cancelCalls.push([id,'hide'])},show(){cancelCalls.push([id,'show'])},
    async setIgnoreMouseEvents(value){cancelCalls.push([id,'mouse',value])},
    webContents:{id,async executeJavaScript(code){
      cancelCalls.push([id,code])
      if(code.startsWith('window.__shotReply')) {
        const [key,result]=JSON.parse('['+code.slice(code.indexOf('(')+1,-1)+']')
        cancelReplies.set(key,result)
      }
      return {}
    }}})
  const cancelA=overlayFor(71),cancelB=overlayFor(72)
  rememberChild(cancelA,true);rememberChild(cancelB,true)
  api.getAllDisplays=()=>[{bounds:{x:-200,y:-100,width:800,height:600}}]
  api.createBrowserWindow=()=>({hide(){},showInactive(){},destroy(){cancelCalls.push(['panel','close'])},
    webContents:{id:73,async executeJavaScript(){return {phase:'ready'}}}})
  try {
    for(const mode of ['explicit','conflict']) {
      if(mode==='explicit') win.setIgnoreMouseEvents=async()=>{}
      else delete win.setIgnoreMouseEvents
      cancelCalls.length=0;removed=[]
      cancelReady=new Promise(resolve=>{cancelStarted=resolve})
      let n=0
      window.services.captureRegion=()=>{
        if(n++===0) return Promise.resolve({ok:true,path:'frame-0'})
        cancelStarted()
        return new Promise(resolve=>{cancelRelease=resolve})
      }
      const running=routeManual({id:'running',type:'scrollshot',payload:{...rect,method:'manual'}},71)
      await cancelReady
      await routeManual({id:mode,type:mode==='explicit'?'scrollshot-cancel':'scrollshot',payload:rect},72)
      await running
      assert.deepEqual(cancelReplies.get('running'),{ok:false,canceled:true})
      if(mode==='explicit') assert.deepEqual(cancelReplies.get(mode),{ok:true,canceled:true})
      else assert.deepEqual(cancelReplies.get(mode),{ok:false,error:'另一块屏正在滚动截图，已为你取消，请重试'})
      for(const id of [71,72]) {
        assert.ok(cancelCalls.some(c=>c[0]===id && c[1]==='mouse' && c[2]===false))
        assert.ok(cancelCalls.some(c=>c[0]===id && String(c[1]).includes("__shotCaptureState('idle')")))
      }
      assert.ok(cancelCalls.some(c=>c[0]==='panel' && c[1]==='close'))
      assert.equal(childWindows.has(73),false);assert.equal(pinVisible,true)
      assert.ok(removed.includes('frame-0'))
      cancelRelease({ok:true,path:'cancel-late-frame'})
      await new Promise(resolve=>setTimeout(resolve,0))
      assert.ok(removed.includes('cancel-late-frame'))
    }
    // A fresh session after cancellation is permitted; a pin cannot cancel it.
    window.services.captureRegion=cancelCapture;failCapture=true
    await routeManual({id:'retry',type:'scrollshot',payload:{...rect,method:'manual'}},72)
    assert.match(cancelReplies.get('retry').error,/capture failed/)
    const pinExecute=pinWin.webContents.executeJavaScript
    let pinCancelReply
    pinWin.webContents.executeJavaScript=async code=>{pinCancelReply=code;return {}}
    try {
      await routeManual({id:'pin-cancel',type:'scrollshot-cancel',payload:{}},11)
      assert.match(pinCancelReply,/仅截图窗口可取消滚动截图/)
    } finally {pinWin.webContents.executeJavaScript=pinExecute}
    assert.ok(cancelErrors.some(args=>String(args[0]).includes('falling back')))
    assert.equal(childWindows.has(73),false)
  } finally {
    failCapture=false;window.services.captureRegion=cancelCapture;console.error=cancelLog
    if(savedIgnore) win.setIgnoreMouseEvents=savedIgnore;else delete win.setIgnoreMouseEvents
    childWindows.delete(71);childWindows.delete(72)
    api.createBrowserWindow=oldCreate;api.getAllDisplays=oldDisplays
  }
  console.log('PASS: cross-display scrollshot-cancel and conflicting request abort, restore passthrough/windows/panel/files, late frame cleanup and retry')

  // Active controls are isolated by session; duplicate opens share in-flight and ready panels.
  const {openScrollControl,finishControl}=await load('scrollControl')
  let controlCreated=0
  const destroyedControls=[]
  api.getAllDisplays=()=>[{bounds:{x:0,y:0,width:1200,height:900}}]
  api.createBrowserWindow=()=>{
    const id=80+controlCreated++
    return {hide(){},showInactive(){},destroy(){destroyedControls.push(id)},
      webContents:{id,async executeJavaScript(){return {phase:'ready'}}}}
  }
  try {
    const aPending=openScrollControl(rect,false,'A')
    assert.equal(openScrollControl(rect,false,'A'),aPending)
    const a=await aPending,b=await openScrollControl(rect,false,'B')
    assert.equal(await openScrollControl(rect,false,'A'),a);assert.equal(controlCreated,2)
    a.close();a.close()
    assert.equal(childWindows.has(b.win.webContents.id),true)
    assert.equal(await openScrollControl(rect,false,'B'),b)
    finishControl(b.win.webContents.id,true)
    assert.equal(b.control.canceled,true);assert.equal(b.control.stopped,true)
    const again=await openScrollControl(rect,false,'A')
    a.close();assert.equal(await openScrollControl(rect,false,'A'),again)
    assert.equal(controlCreated,3)
    b.close();again.close();assert.equal(destroyedControls.length,3)
    assert.throws(()=>finishControl(a.win.webContents.id,true),/会话已结束/)
  } finally {api.createBrowserWindow=oldCreate;api.getAllDisplays=oldDisplays}
  console.log('PASS: active Map reuses same-session pending/ready panels, independent close, stale close isolation and reopen')
  const panelSource=readFileSync(path.join(root,'src/scrollctl/ScrollControl.vue'),'utf8')
  assert.match(panelSource,/\.thumbnail img\{[^}]*max-width:100%;width:auto/ )
  for(const contract of ['window.__preview','scrollTop=scroller.value.scrollHeight',"event.key === 'Escape'","'ctl-cancel' : 'ctl-finish'",'已拼接','帧数','height:260px']) assert.ok(panelSource.includes(contract),contract)
  let panelMounted,panelUnmounted,panelKey
  const panelWindow={},panelRequests=[],panelScroll={scrollTop:0,scrollHeight:900}
  Object.assign(panelWindow,{addEventListener:(name,fn)=>{assert.equal(name,'keydown');panelKey=fn},removeEventListener:(name,fn)=>{assert.equal(fn,panelKey);panelKey=undefined}})
  const panelContext={exports:{},URLSearchParams,location:{search:'?preview=1'},window:panelWindow,
    require(name){
      if(name==='vue') return {shallowRef:value=>({value}),nextTick:fn=>Promise.resolve().then(fn),onMounted:fn=>{panelMounted=fn},onUnmounted:fn=>{panelUnmounted=fn}}
      if(name.endsWith('parentLink')) return {requestParent:async type=>{panelRequests.push(type);return {ok:true}}}
      throw new Error('Unexpected panel import: '+name)
    }}
  const panelScript=panelSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]+'\nexport {frames,height,thumb,scroller,finish,stopped,skipped,consecutive,skipText}'
  vm.runInNewContext(ts.transpileModule(panelScript,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,panelContext)
  panelMounted()
  panelContext.exports.scroller.value=panelScroll
  panelWindow.__preview({frames:3,height:2000,thumb:'data:image/jpeg;base64,AA=='})
  await Promise.resolve()
  assert.equal(panelContext.exports.frames.value,3);assert.equal(panelContext.exports.height.value,2000)
  assert.equal(panelContext.exports.thumb.value,'data:image/jpeg;base64,AA==');assert.equal(panelScroll.scrollTop,900)
  panelWindow.__preview({frames:1,height:128,thumb:'data:image/jpeg;base64,AA==',skipped:1,consecutive:1})
  assert.equal(panelContext.exports.skipText(),'已跳过 1 帧')
  panelWindow.__preview({frames:1,height:128,thumb:'data:image/jpeg;base64,AA==',skipped:3,consecutive:3})
  assert.equal(panelContext.exports.skipped.value,3);assert.equal(panelContext.exports.consecutive.value,3)
  assert.equal(panelContext.exports.skipText(),'滚动过快或内容过少，已跳过 3 帧，请放慢滚动')
  assert.ok(panelSource.includes(':class="{warning:consecutive>=3}"'));assert.match(panelSource,/\.warning\{color:/)
  panelWindow.__preview({frames:2,height:136,thumb:'data:image/jpeg;base64,AA==',skipped:3,consecutive:0})
  assert.equal(panelContext.exports.skipText(),'已跳过 3 帧')
  console.log('PASS: safety panel actual text="滚动过快或内容过少，已跳过 3 帧，请放慢滚动", warning color bound to consecutive>=3; recovery clears warning')
  await panelContext.exports.finish(false);assert.equal(panelRequests.at(-1),'ctl-finish')
  panelContext.exports.stopped.value=false
  panelKey({key:'Escape',preventDefault(){}});await Promise.resolve();assert.equal(panelRequests.at(-1),'ctl-cancel')
  panelUnmounted();assert.equal(panelWindow.__preview,undefined);assert.equal(panelWindow.__ctlStatus,undefined);assert.equal(panelKey,undefined)
  const previewPosition=controlPosition({x:100,y:100,width:300,height:200},screenBounds,true)
  assert.equal(previewPosition.width,240);assert.equal(previewPosition.height,390)
  assert.ok(previewPosition.x>=416);assert.equal(previewPosition.overlap,false)
  assert.equal(controlPosition(screenBounds,screenBounds,true).overlap,true)
  console.log('PASS: preview UI receives counters/image, scrolls to bottom, finish/ESC RPC, lifecycle cleanup and right-first/overlap positioning')
  const captureTemplate=readFileSync(path.join(root,'src/overlay/Overlay.vue'),'utf8')
  assert.ok(captureTemplate.includes('frozen && !captureActive'))
  assert.ok(captureTemplate.includes('.capturing .selection{border:0;background:transparent;'))

  assert.match(captureTemplate,/\.overlay\.capturing,\.capturing \.display-content>\*\{pointer-events:none!important\}/)
  assert.match(captureTemplate,/\.dimensions,\.capture-hint\{pointer-events:none!important\}/)
  console.log('PASS: capturing root/children, dimensions and capture hint cannot intercept pointer events')

  // Run the actual composable with lifecycle/DOM doubles: coordinates, RPC and 6s toast.
  const overlaySource=readFileSync(path.join(root,'src/overlay/useOverlay.ts'),'utf8')
  const overlayCode=ts.transpileModule(overlaySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  async function overlayHarness(actual, search, scrollResult) {
    let mounted,unmounted,timer,delay,cropArgs
    const requests=[],diags=[],listeners=new Map(), notices=[]
    const overlayWindow={...actual,ztools:{sendToParent:(channel,data)=>diags.push({channel,data})},
      services:{readImageAsDataUrl:()=> 'frozen'},close(){},
      addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)}
    const context={exports:{},URLSearchParams,location:{search},window:overlayWindow,
      innerWidth:actual.innerWidth,innerHeight:actual.innerHeight,
      setTimeout:(fn,ms)=>{timer=fn;delay=ms;return 1},clearTimeout(){},
      document:{createElement:()=>({width:0,height:0,toDataURL:()=> 'crop',getContext:()=>({drawImage:(...args)=>{cropArgs=args}})})},
      require(name) {
        if(name==='vue') return {ref:value=>({value}),reactive:value=>value,computed:get=>({get value(){return get()}}),onMounted:fn=>{mounted=fn},onUnmounted:fn=>{unmounted=fn}}
        if(name.endsWith('runtime')) return {host:{},isWindowGone,errorText:error=>error.message || String(error),toast:(...args)=>notices.push(args),copyImage(){},loadImage:async()=>({naturalWidth:3840,naturalHeight:2160})}
        if(name.endsWith('overlayGeometry')) return {overlayGeometry}
        if(name.endsWith('parentLink')) return {requestParent:async(type,payload)=>{requests.push({type,payload});return type==='scrollshot' ? (scrollResult ?? {ok:false,error:noScrollError(payload.targetApp)}) : {ok:true}}}
        throw new Error('Unexpected overlay import: '+name)
      }}
    vm.runInNewContext(overlayCode,context)
    const overlay=context.exports.useOverlay();await mounted()
    return {overlay,requests,diags,window:overlayWindow,listeners,notices,unmounted,runTimer:()=>timer(),get delay(){return delay},get cropArgs(){return cropArgs}}
  }
  const search='?src=frozen&dx=-1920&dy=-148&dw=1920&dh=1080&ta='+encodeURIComponent('Safari & 测试')
  const h=await overlayHarness({screenX:-1900,screenY:0,innerWidth:1920,innerHeight:1080},search)
  assert.equal(typeof h.window.__shotCaptureState,'function')
  h.window.__shotCaptureState('active');assert.equal(h.overlay.captureActive.value,true)
  h.window.__shotCaptureState('idle');assert.equal(h.overlay.captureActive.value,false)
  assert.equal(h.overlay.geometryStyle.value.left,'-20px');assert.equal(h.overlay.geometryStyle.value.top,'-148px')
  assert.equal(h.overlay.geometryStyle.value.width,'1920px');assert.equal(h.overlay.geometryStyle.value.height,'1080px')
  assert.equal(h.diags.length,1);assert.equal(h.diags[0].channel,'diag');assert.equal(h.diags[0].data.kind,'overlay-geometry')
  assert.equal(h.requests[0].type,'rebind-geometry');assert.equal(h.requests[0].payload.dy,-148)
  const pointer=(x,y)=>({clientX:x,clientY:y,button:0,pointerId:1,currentTarget:{setPointerCapture(){}}})
  h.overlay.down(pointer(100,50));h.overlay.up(pointer(200,150))
  assert.equal(h.overlay.rect.x,120);assert.equal(h.overlay.rect.y,198)
  assert.equal(h.overlay.menuStyle.value.left,'120px')
  assert.equal(h.overlay.menuStyle.value.top,'306px')
  assert.equal(h.overlay.menuStyle.value.width,'max-content')
  Object.assign(h.overlay.rect,{x:1900,y:900,width:20,height:128})
  assert.equal(h.overlay.menuStyle.value.top,'1036px','exact bottom fit stays below')
  h.overlay.rect.height=129
  assert.equal(h.overlay.menuStyle.value.top,'848px','only overflow moves above')
  assert.equal(h.overlay.dimensionsStyle.value.top,'-54px','size label clears toolbar above')
  assert.equal(h.overlay.menuStyle.value.maxWidth,'320px')
  h.overlay.rect.x=1920
  assert.equal(h.overlay.menuStyle.value.left,'1592px','right edge clamped')
  Object.assign(h.overlay.rect,{x:120,y:198,width:100,height:100})
  console.log('PASS: menu content width / left alignment / right clamp / exact 44px bottom fit / above overflow / dimensions clear menu')
  await h.overlay.action('copy')
  assert.deepEqual(Array.from(h.cropArgs).slice(1),[240,396,200,200,0,0,200,200])
  await h.overlay.startScroll()
  const scrollRequest=h.requests.at(-1)
  assert.equal(h.overlay.method.value,'manual');assert.equal(scrollRequest.payload.method,'manual');
  assert.equal(scrollRequest.type,'scrollshot');assert.equal(scrollRequest.payload.targetApp,'Safari & 测试')
  assert.equal(scrollRequest.payload.x,-1800);assert.equal(scrollRequest.payload.y,50)
  assert.equal(h.overlay.scrollError.value,noScrollError('Safari & 测试'));assert.equal(h.delay,6000)
  h.runTimer();assert.equal(h.overlay.scrollError.value,'')
  h.window.screenX=-1920;h.window.screenY=-148;h.listeners.get('resize')()
  assert.deepEqual(Object.keys(h.overlay.geometryStyle.value),[]);assert.equal(h.requests.filter(r=>r.type==='rebind-geometry').length,1)
  h.unmounted();assert.equal(h.listeners.size,0)
  const aligned=await overlayHarness({screenX:-1920,screenY:-148,innerWidth:1920,innerHeight:1080},search)
  assert.deepEqual(Object.keys(aligned.overlay.geometryStyle.value),[]);assert.equal(aligned.diags.length,0);assert.equal(aligned.requests.length,0);aligned.unmounted()
  const deniedOverlay=await overlayHarness({screenX:-1920,screenY:-148,innerWidth:1920,innerHeight:1080},search,untrustedResult)
  await deniedOverlay.overlay.startScroll()
  assert.equal(deniedOverlay.overlay.permission.value,true);assert.equal(deniedOverlay.overlay.error.value,permissionError)
  deniedOverlay.overlay.accessibility()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(deniedOverlay.requests.at(-1).type,'accessibility');deniedOverlay.unmounted()
  const overlayTemplate=readFileSync(path.join(root,'src/overlay/Overlay.vue'),'utf8')
  assert.match(overlayTemplate,/:permission="permission"/);assert.match(overlayTemplate,/@accessibility="accessibility"/)
  const resultTemplate=readFileSync(path.join(root,'src/overlay/ResultDialog.vue'),'utf8')
  assert.match(resultTemplate,/v-if="permission"/);assert.match(resultTemplate,/emit\('accessibility'\)/);assert.match(resultTemplate,/去授权/)
  for (const method of ['manual','wheel','pageDown','arrowDown']) assert.ok(overlayTemplate.includes(`value="${method}"`))
  assert.match(overlayTemplate,/手动滚动（默认）/)
  assert.match(overlayTemplate,/不需要键盘焦点/)
  assert.match(overlayTemplate,/class="frozen" :style="geometryStyle"/);assert.match(overlayTemplate,/class="initial-mask" :style="geometryStyle"/)
  assert.match(overlayTemplate,/class="display-content" :style="geometryStyle"/)
  const pinSource=readFileSync(path.join(root,'src/pin/Pin.vue'),'utf8')
  assert.match(pinSource,/@pointerenter="focusOnEnter"/);assert.match(pinSource,/@pointerleave="focusOnLeave"/)
  assert.match(pinSource,/event.key === 'Escape'.*window.close\(\)/);assert.match(pinSource,/body\{-webkit-app-region:drag\}/)
  let pinMounted,pinUnmounted,focused=false,focusCount=0,closeCount=0,pinKey,pinTimer,pinDelay
  const pinContext={setTimeout(fn,ms){pinTimer=fn;pinDelay=ms;return 1},clearTimeout(){pinTimer=undefined},exports:{},URLSearchParams,location:{search:'?src=image'},
    document:{hasFocus:()=>focused},
    window:{focus(){focusCount++},close(){closeCount++},services:{readImageAsDataUrl:()=> 'image',removeTempImages(){}},
      addEventListener(event,handler){assert.equal(event,'keydown');pinKey=handler},removeEventListener(event,handler){assert.equal(event,'keydown');assert.equal(handler,pinKey);pinKey=undefined}},
    require(name) {
      if(name.endsWith('usePinZoom')) return {usePinZoom:()=>({})}
      if(name==='vue') return {ref:value=>({value}),onMounted:fn=>{pinMounted=fn},onUnmounted:fn=>{pinUnmounted=fn}}
      if(name.endsWith('runtime')) return {isWindowGone,errorText:String,toast(){}}
      if(name.endsWith('parentLink')) return {}
      throw new Error('Unexpected pin import: '+name)
    }}
  const pinScript=pinSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]+'\nexport {focusOnEnter,focusOnLeave,key}'
  vm.runInNewContext(ts.transpileModule(pinScript,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,pinContext)
  pinMounted();assert.equal(focusCount,0)
  pinContext.exports.focusOnEnter();assert.equal(focusCount,0);assert.equal(pinDelay,250)
  const cancelledTimer=pinTimer
  pinContext.exports.focusOnLeave();assert.equal(pinTimer,undefined)
  cancelledTimer();assert.equal(focusCount,0)
  pinContext.exports.focusOnEnter();pinTimer();assert.equal(focusCount,1)
  focused=true;pinContext.exports.focusOnEnter();pinTimer();assert.equal(focusCount,1)
  pinKey({key:'a'});assert.equal(closeCount,0)
  pinKey({key:'Escape',preventDefault(){}});assert.equal(closeCount,1)
  pinUnmounted();assert.equal(pinKey,undefined);assert.equal(pinTimer,undefined)
  console.log('PASS: overlay mount/diag/single rebind, compensated selection/crop/scroll payload, 6s error toast, geometry recovery/equality, pin hover/ESC/drag contracts')

  // Parent RPC: only registered children; create pin in parent; route all four types.
  const {handleShotRequest}=await load('parentRequests')
  let handler,reply,creation,opened
  window.services.onShotRequest=fn=>{handler=fn}
  window.services.saveImage=()=>({ok:true})
  api.shellOpenExternal=async url=>{opened=url;return {success:true}}
  api.createBrowserWindow=(url,options)=>{creation={url,options};return {...win,webContents:{id:20,executeJavaScript:async()=>({phase:'ready'})}}}
  window.__shotReply=(_id,value)=>{reply=value}
  window.__shotCaptureState=()=>{}
  win.webContents.executeJavaScript=async code=>{vm.runInThisContext(code);return {}}
  window.services.onShotRequest(handleShotRequest)
  const pinDisplays = api.getAllDisplays
  api.getAllDisplays=()=>[{bounds:screenBounds},{bounds:{x:-500,y:-100,width:194,height:97}}]
  await handler({id:'a',type:'pin',payload:{path:'/tmp/pin.png',x:1,y:2,w:30,h:40}},10)
  assert.equal(reply.ok,true);assert.match(creation.url,/pin.html/);assert.equal(childWindows.has(20),true)
  assert.deepEqual({width:creation.options.width,height:creation.options.height},{width:120,height:160})
  for (const [x,y,w,h,expectedSize] of [
    [1,2,40,40,{width:120,height:120}],
    [1,2,100,50,{width:160,height:80}],
    [1,2,2000,1000,{width:1000,height:500}],
    [-499,-99,200,100,{width:194,height:97}],
    [-499,-99,40,40,{width:97,height:97}],
  ]) {
    await handler({id:'initial-size',type:'pin',payload:{path:'/tmp/pin.png',x,y,w,h}},10)
    assert.equal(reply.ok,true)
    assert.deepEqual({width:creation.options.width,height:creation.options.height},expectedSize)
    assert.equal(creation.options.x,x);assert.equal(creation.options.y,y)
    assert.equal(creation.options.minWidth,undefined);assert.equal(creation.options.minHeight,undefined)
  }
  console.log('PASS: initial pin uses pinSize at zoom 1, 40x40 -> 120x120, 100x50 -> 160x80, target display bounds and proportional 194x97/screen-priority limits')

  await handler({id:'b',type:'save',payload:{dataUrl:'data:image/png;base64,AA=='}},10);assert.equal(reply.ok,true)
  await handler({id:'c',type:'accessibility',payload:{}},10);assert.equal(reply.ok,true);assert.match(opened,/Privacy_Accessibility/)
  starts=[0,0,0];captures=0
  await handler({id:'d',type:'scrollshot',payload:rect},10);assert.equal(reply.ok,false);assert.equal(reply.error,noScrollError('Safari','arrowDown'));assert.equal(captures,2)
  await handler({id:'bounds',type:'rebind-geometry',payload:expected},10)
  assert.deepEqual(win.bounds,{x:-1920,y:-148,width:1920,height:1080})
  win.webContents.executeJavaScript=async()=>{throw new Error('window not exist')}
  await handler({id:'closed',type:'save',payload:{dataUrl:'data'}},10)
  assert.deepEqual(toastMessages,[]);rememberChild(win,true)
  win.webContents.executeJavaScript=async code=>{vm.runInThisContext(code);return {}}
  let pinDestroyed=0
  api.createBrowserWindow=()=>({destroy(){pinDestroyed++},webContents:{id:21,executeJavaScript:async()=>({phase:'error',error:'load failed'})}})
  await handler({id:'bad-load',type:'pin',payload:{path:'/tmp/pin.png',x:1,y:2,w:30,h:40}},10)
  assert.match(reply.error,/load failed/);assert.equal(pinDestroyed,1);assert.equal(childWindows.has(21),false)
  api.createBrowserWindow=()=>{throw new Error('create failed')};removed=[]
  await handler({id:'e',type:'pin',payload:{path:'/tmp/pin.png',x:1,y:2,w:30,h:40}},10)
  assert.match(reply.error,/create failed/);assert.deepEqual(removed,['/tmp/pin.png'])
  api.getAllDisplays=pinDisplays
  const {requestParent}=await load('parentLink')
  globalThis.crypto ??= require('node:crypto').webcrypto
  api.sendToParent=(channel,request)=>{assert.equal(channel,'shot-request');window.__shotReply(request.id,{ok:true})}
  assert.equal((await requestParent('save',{dataUrl:'data'})).ok,true);assert.equal(window.__shotReplies.size,0)
  api.sendToParent=()=>{throw new Error('relay failed')}
  await assert.rejects(requestParent('save'),/relay failed/);assert.equal(window.__shotReplies.size,0)
  console.log('PASS: pin/save/scrollshot/accessibility parent RPC, pin failure cleanup, child reply dispatch/send failure')

  childWindows.clear()
  const {runOverlaySession,pollTargetApp}=await load('overlaySession')
  const originalFrontmost=window.services.frontmostApp
  let queried=0, queryTimes=[]
  window.services.frontmostApp=async()=>{queryTimes.push(Date.now());return ['ZTools','','Safari','Chrome'][queried++]}
  assert.equal(await pollTargetApp(),'Safari');assert.equal(queried,3)
  assert.ok(queryTimes[1]-queryTimes[0]>=90);assert.ok(queryTimes[2]-queryTimes[1]>=90)
  for (const name of ['ZTools','']) {
    window.services.frontmostApp=async()=>name
    const started=Date.now()
    assert.equal(await pollTargetApp(),'');assert.ok(Date.now()-started<3000)
  }
  window.services.frontmostApp=()=>new Promise(()=>{})
  const pollStart=Date.now();assert.equal(await pollTargetApp(),'');assert.ok(Date.now()-pollStart<3000)
  window.services.frontmostApp=originalFrontmost
  console.log('PASS: frontmost poll 100ms, first non-ZTools, empty/ZTools/slow query: 1s deadline, <3000ms verification bound')
  const displays=[{id:1,bounds:{x:-1920,y:-148,width:1920,height:1080},scaleFactor:1},{id:2,bounds:{x:0,y:0,width:1408,height:856},scaleFactor:2}]
  let destroyed=0, creations=[], writes=0
  events=[]
  api.hideMainWindow=()=>{events.push('hideMain')};api.getAllDisplays=()=>displays
  api.desktopCaptureSources=async()=>displays.map(display=>({display_id:String(display.id),thumbnail:{toDataURL:()=> 'frame-0'}}))
  window.services.writeUniqueImageToTemp=()=>`/tmp/frozen-${++writes}.png`
  api.createBrowserWindow=(url,options)=>{events.push('create');creations.push({url,options});return {destroy(){destroyed++;throw new Error('window not exist')},webContents:{id:100+creations.length,executeJavaScript:async()=>({phase:'done'})}}}
  removed=[];await runOverlaySession()
  assert.deepEqual(events.slice(0,3),['hideMain','frontmost','create'])
  assert.deepEqual(toastMessages,[])
  assert.equal(creations[0].options.transparent,true);assert.equal(creations[0].options.backgroundColor,'#00000000')
  const query = new URL(creations[0].url,'https://test').searchParams
  assert.equal(query.get('ta'),'Safari & 测试');assert.equal(query.get('dw'),'1920');assert.equal(query.get('dh'),'1080')
  assert.equal(creations.length,2);assert.equal(destroyed,2);assert.equal(removed.length,2);assert.equal(childWindows.size,0)
  assert.equal(creations[0].options.x,-1920);assert.equal(creations[0].options.y,-148)
  assert.equal(creations[1].options.width,1408);assert.equal(creations[1].options.height,856)
  assert.equal(JSON.parse(new URL(creations[0].url,'https://test').searchParams.get('st')).targetLang,'en')
  destroyed=0;removed=[];let attempts=0
  api.createBrowserWindow=()=>{if(++attempts===2) throw new Error('window failed');return {destroy(){destroyed++},webContents:{id:999}}}
  await assert.rejects(runOverlaySession(),/window failed/);assert.equal(destroyed,1);assert.equal(removed.length,2)
  api.desktopCaptureSources=async()=>{throw new Error('desktop capture failed')}
  await assert.rejects(runOverlaySession(),/desktop capture failed/)
  console.log('PASS: multi-display cleanup, negative coordinates, URL settings, partial creation and capture rejection')
  console.log(`PASS: ${checkedRows} original-page row hashes, ${checkedSeams} seam windows, ${solidRows} solid rows checked separately`)
} finally { rmSync(directory,{recursive:true,force:true}) }
