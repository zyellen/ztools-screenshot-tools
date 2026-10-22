import type { ScrollMethod } from '../shared/scrollCapture'
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { host, isWindowGone, copyImage, loadImage, errorText, toast, type Rect } from '../shared/runtime'
import { requestParent, saveViaParent, pinViaParent, readOverlaySettings } from '../shared/parentLink'
import { overlayGeometry } from '../shared/overlayGeometry'
import type { TextItem } from './TextAnnotations.vue'
export function useOverlay() {
  const params = new URLSearchParams(location.search)
  const scale = Number(params.get('scale')) || 1
  const display = { x: Number(params.get('dx')) || 0, y: Number(params.get('dy')) || 0, width: Number(params.get('dw')) || innerWidth, height: Number(params.get('dh')) || innerHeight }
  const targetApp = params.get('ta') || ''
  const geometry = ref({mismatch:false,left:0,top:0})
  const geometryStyle = computed(() => geometry.value.mismatch ? {left:geometry.value.left+'px',top:geometry.value.top+'px',width:display.width+'px',height:display.height+'px',right:'auto',bottom:'auto',transform:'translateZ(0)'} : {})
  function checkGeometry(report = false) {
    const expected = {dx:display.x,dy:display.y,dw:display.width,dh:display.height}
    const actual = {screenX:window.screenX,screenY:window.screenY,innerWidth:window.innerWidth,innerHeight:window.innerHeight}
    geometry.value = overlayGeometry(expected,actual)
    if (report && geometry.value.mismatch) {
      try {window.ztools.sendToParent('diag',{kind:'overlay-geometry',expected,actual})} catch {}
      void requestParent('rebind-geometry',expected).catch(()=>{}).finally(()=>checkGeometry())
    }
  }
  const captureActive = ref(false)
  window.__shotCaptureState = state => {captureActive.value=state === 'active'}
  const frozen = ref('')
  const composed = ref('')
  const rect = reactive<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const dragging = ref(false)
  const annotation = ref(false)
  const scrollPanel = ref(false)
  const method = ref<ScrollMethod>('manual')
  const permission = ref(false)
  const warning = ref('')
  const dialog = ref(false)
  const busy = ref(false)
  const title = ref('')
  const error = ref('')
  const scrollError = ref('')
  let errorTimer: ReturnType<typeof setTimeout> | undefined
  const original = ref('')
  const translated = ref('')
  const resultImage = ref('')
  const providerError = computed(() => /(未配置|请先配置|无可用|没有可用|无\s*provider|没有\s*provider|缺少.*(provider|模型)|no\s+provider|provider.*(missing|unavailable))/i.test(error.value))
  let phase = 'loading'
  let fatalError = ''
  let background: HTMLImageElement
  let start = { x: 0, y: 0 }
  window.__shotStatus = () => ({ phase, error: fatalError })
  const selectionStyle = computed(() => ({ left: rect.x+'px', top: rect.y+'px', width: rect.width+'px', height: rect.height+'px' }))
  // Content width, with a right-edge clamp; the row scrolls on narrow displays.
  const menuStyle = computed(() => {
    const minWidth = Math.min(320, display.width - 16)
    const left = Math.max(8, Math.min(rect.x, display.width - minWidth - 8))
    return {left:left+'px', width:'max-content', maxWidth:Math.max(1, Math.min(display.width-16, display.width-left-8))+'px',
      top:(rect.y+rect.height+8+44 > display.height ? rect.y-52 : rect.y+rect.height+8)+'px'}
  })
  const dimensionsStyle = computed(() => !captureActive.value && rect.y+rect.height+8+44 > display.height
    ? {top:'-54px'} : {})
  const hasSelection = computed(() => rect.width >= 2 && rect.height >= 2)
  const captureHintStyle = computed(() => ({left:rect.x+'px',maxWidth:rect.width+'px',
    top:(rect.y+rect.height+48 <= display.height ? rect.y+rect.height+8 : rect.y-24)+'px',
    transform:rect.y+rect.height+48 <= display.height ? undefined : 'translateY(-100%)'}))
  function close(done = false) { phase = done ? 'done' : 'aborted'; window.close() }
  function report(cause: unknown, duration?: number) {
    if (isWindowGone(cause)) return
    error.value = errorText(cause)
    if (duration) {
      scrollError.value = error.value
      clearTimeout(errorTimer)
      errorTimer = setTimeout(()=>{scrollError.value=''},duration)
    } else toast(error.value, 'error')
  }
  async function guard(action: () => unknown | Promise<unknown>) { try { await action() } catch (cause) { report(cause) } }
  function point(event: PointerEvent) { return { x: Math.max(0, Math.min(display.width, event.clientX-geometry.value.left)), y: Math.max(0, Math.min(display.height, event.clientY-geometry.value.top)) } }
  function down(event: PointerEvent) {
    if (captureActive.value || busy.value || event.button !== 0 || annotation.value || scrollPanel.value || dialog.value || !background) return
    start = point(event); Object.assign(rect, start, {width:0,height:0}); dragging.value = true
    composed.value = ''; original.value = ''; translated.value = ''; error.value = ''
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  function move(event: PointerEvent) {
    if (!dragging.value) return
    const p = point(event); Object.assign(rect, { x: Math.min(start.x,p.x), y: Math.min(start.y,p.y), width: Math.abs(start.x-p.x), height: Math.abs(start.y-p.y) })
  }
  function up(event: PointerEvent) { move(event); dragging.value = false }
  async function crop() {
    if (composed.value) return composed.value
    if (!background || !hasSelection.value) throw new Error('请先框选区域')
    const canvas = document.createElement('canvas')
    // Use the real thumbnail ratio to tolerate host rounding on mixed-DPI displays.
    const sx = background.naturalWidth / display.width, sy = background.naturalHeight / display.height
    canvas.width = Math.max(1, Math.round(rect.width*sx)); canvas.height = Math.max(1,Math.round(rect.height*sy))
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('图片裁剪失败')
    ctx.drawImage(background,rect.x*sx,rect.y*sy,rect.width*sx,rect.height*sy,0,0,canvas.width,canvas.height)
    return canvas.toDataURL('image/png')
  }
  async function finishAnnotations(items: TextItem[]) {
    await guard(async () => {
      const image = await loadImage(await crop())
      const canvas = document.createElement('canvas'); canvas.width=image.naturalWidth;canvas.height=image.naturalHeight
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('文本合成失败')
      ctx.drawImage(image,0,0)
      const ratioX = canvas.width/rect.width, ratioY = canvas.height/rect.height
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,canvas.width,canvas.height);ctx.clip();ctx.scale(ratioX,ratioY)
      for (const item of items) {
        ctx.font = `${item.size}px sans-serif`; ctx.fillStyle=item.color;ctx.textBaseline='top'
        item.text.split('\n').forEach((line,index)=>ctx.fillText(line,item.x,item.y+index*item.size*1.2))
      }
      ctx.restore();composed.value=canvas.toDataURL('image/png');original.value='';translated.value='';annotation.value=false
    })
  }
  async function ocr() {
    const settings = readOverlaySettings()
    if (!original.value) {
      const result = await host.ocr(await crop(), {lang:settings.ocrLang || undefined})
      original.value=result.text?.trim() || ''
      if (!original.value) throw new Error('OCR 未识别到文字')
      if (settings.autoCopy && !host.copyText(original.value)) throw new Error('文本自动复制失败')
    }
    return settings
  }
  async function recognize(translate = false) {
    dialog.value=true;title.value=translate?'翻译':'OCR 文字识别';error.value='';busy.value=true;resultImage.value=''
    try {
      const settings=await ocr()
      if (translate) {
        const result=await host.translate(original.value,{to:settings.targetLang})
        translated.value=result.text?.trim() || ''
        if (!translated.value) throw new Error('翻译返回结果为空')
      }
    } catch(cause) {report(cause)} finally {busy.value=false}
  }
  async function startScroll() {
    scrollPanel.value=false;dialog.value=true;busy.value=true;title.value='滚动截图进行中…'
    error.value='';original.value='';translated.value='';resultImage.value='';warning.value='';permission.value=false
    try {
      const result=await requestParent('scrollshot',{x:display.x+rect.x,y:display.y+rect.y,w:rect.width,h:rect.height,method:method.value,maxFrames:method.value === 'manual' ? 60 : 30,targetApp})
      if(result.canceled) {dialog.value=false;return}
      permission.value=result.permission === true
      if (!result.ok || !result.path) throw new Error(result.error || '滚动截图失败')
      try {
        const data=window.services.readImageAsDataUrl(result.path)
        if (!data) throw new Error('长图读取失败')
        resultImage.value=data;warning.value=result.warning || '';title.value=`滚动截图（${result.frames} 帧）`
      } finally {window.services.removeTempImages([result.path])}
    } catch(cause) {report(cause,6000)} finally {busy.value=false}
  }
  function accessibility() { void guard(async()=>{const result=await requestParent('accessibility');if(!result.ok) throw new Error(result.error || '打开辅助功能设置失败')}) }
  function pin(image: string) { return pinViaParent(image,{...rect,x:display.x+rect.x,y:display.y+rect.y}) }
  async function action(name: string) {
    await guard(async () => {
      if(name==='copy') {copyImage(await crop());close(true)}
      else if(name==='save') {if(await saveViaParent(await crop())) close(true)}
      else if(name==='pin') {await pin(await crop());close(true)}
      else if(name==='ocr') await recognize()
      else if(name==='translate') await recognize(true)
      else if(name==='text') annotation.value=true
      else if(name==='long') {if(window.services.platform !== 'darwin') toast('滚动截图当前仅支持 macOS');else scrollPanel.value=true}
      else close()
    })
  }
  async function resultAction(name: string) {
    await guard(async()=>{
      if(name==='copy') {copyImage(resultImage.value);close(true)}
      else if(name==='save') {if(await saveViaParent(resultImage.value)) close(true)}
      else if(name==='pin') {await pin(resultImage.value);close(true)}
    })
  }
  function copyText(text: string) { void guard(()=>{if(!host.copyText(text)) throw new Error('文本复制失败');toast('文本已复制','success')}) }
  function provider() { void guard(()=>host.redirectAiModelsSetting()) }
  function key(event: KeyboardEvent) {
    if(event.key==='Escape') {event.preventDefault();if(busy.value) return;if(annotation.value) annotation.value=false;else if(scrollPanel.value) scrollPanel.value=false;else close()}
  }
  onMounted(async()=>{
    window.addEventListener('keydown',key)
    window.addEventListener('resize',refreshGeometry)
    checkGeometry(true)
    try {
      const src=params.get('src'); if(!src) throw new Error('缺少截图路径')
      const data=window.services.readImageAsDataUrl(src);if(!data) throw new Error('冻结截图读取失败')
      background=await loadImage(data);frozen.value=data;phase='selecting'
    } catch(cause) {fatalError=errorText(cause);phase='error';report(cause)}
  })
  function refreshGeometry() { checkGeometry() }
  onUnmounted(()=>{delete window.__shotCaptureState;clearTimeout(errorTimer);window.removeEventListener('keydown',key);window.removeEventListener('resize',refreshGeometry)})
  return {captureActive,captureHintStyle,scrollError,geometryStyle,targetApp,scrollPanel,method,permission,warning,startScroll,accessibility,scale,frozen,composed,rect,dragging,annotation,dialog,busy,title,error,original,translated,resultImage,providerError,selectionStyle,menuStyle,dimensionsStyle,hasSelection,down,move,up,close,action,finishAnnotations,recognize,resultAction,copyText,provider}
}
