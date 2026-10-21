<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

const SETTINGS_KEY = 'screenshot-tools-settings'
const MAX_LONG_SHOT_FRAMES = 25

interface PluginSettings {
  ocrLang: string
  targetLang: string
  autoCopy: boolean
}

interface SaveImageResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

interface BrowserUrlResult {
  ok: boolean
  url?: string
  browser?: string
  error?: string
}

interface PreloadServices {
  readBrowserUrl(): Promise<BrowserUrlResult>
  readClipboardUrl(): string
}

interface BrowserRunner {
  goto(url: string): BrowserRunner
  viewport(width: number, height: number): BrowserRunner
  evaluate(func: () => unknown): BrowserRunner
  screenshot(arg: string | { x: number, y: number, width: number, height: number } | null, savePath?: string): BrowserRunner
  scroll(x: number, y: number): BrowserRunner
  wait(ms: number): BrowserRunner
  run(...args: unknown[]): Promise<unknown>
}

interface ZToolsRuntime {
  onPluginEnter(callback: (action: { code: string, type: string, payload: unknown }) => void): void
  onPluginOut(callback: (processExit: boolean) => void): void
  screenCapture(callback: (image: string) => void): void
  isMacOs(): boolean
  isWindows(): boolean
  shellOpenExternal(url: string): Promise<{ success: boolean, error?: string }>
  ocr(image: string, options: { lang?: string }): Promise<{ text?: string, blocks?: unknown[], confidence?: number }>
  translate(text: string, options: { from?: string, to?: string, providerId?: string }): Promise<{ text?: string, detectedFrom?: string }>
  readCurrentBrowserUrl(): Promise<string>
  getIdleUBrowsers(): { id: number, title: string, url: string }[]
  getPrimaryDisplay(): {
    workAreaSize?: { width: number, height: number }
    size?: { width: number, height: number }
  }
  copyText(text: string): boolean
  copyImage(image: string): boolean
  getPath(name: 'temp'): string
  dbStorage: {
    getItem<T>(key: string): T | null
    setItem(key: string, value: unknown): void
    removeItem(key: string): void
  }
  showToast(message: string, options?: { type?: 'info' | 'success' | 'warning' | 'error' }): void
  redirectAiModelsSetting(): void
  ubrowser: BrowserRunner
}

interface ScrollMetrics {
  scrollY: number
  innerHeight: number
  scrollHeight: number
}

interface CapturedFrame {
  path: string
}

const ztoolsApi = window.ztools as unknown as ZToolsRuntime
const preloadServices = window.services as unknown as PreloadServices

const settingsOpen = ref(false)
const currentImage = ref('')
const ocrText = ref('')
const sourceText = ref('')
const translatedText = ref('')
const statusMessage = ref('选择一个功能开始使用')
const statusType = ref<'info' | 'success' | 'warning' | 'error'>('info')
const providerError = ref(false)
const isScreenshotLoading = ref(false)
const isOcrLoading = ref(false)
const isTranslateLoading = ref(false)
const isLongShotLoading = ref(false)
const longShotProgress = ref('')
const longShotPercent = ref(0)
const longShotError = ref('')
const permissionHint = ref(false)

const settings = reactive<PluginSettings>({
  ocrLang: '',
  targetLang: 'zh',
  autoCopy: false,
})

const hasImage = computed(() => Boolean(currentImage.value))
const isBusy = computed(() => isScreenshotLoading.value || isOcrLoading.value || isTranslateLoading.value || isLongShotLoading.value)
const canUseImageActions = computed(() => hasImage.value && !isLongShotLoading.value)

function setStatus(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  statusMessage.value = message
  statusType.value = type
}

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  ztoolsApi.showToast(message, { type })
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function isProviderMissingError(message: string) {
  return /(请先配置|未配置|无可用|没有可用|无\s*provider|没有\s*provider|缺少.*(provider|模型)|没有.*(provider|模型)|no\s+provider|provider.*(missing|unavailable))/i.test(message)
}

function cleanLongShotErrorMessage(message: string) {
  if (/(非可识别浏览器|非受支持浏览器|read-current-browser-url)/i.test(message)) {
    return '当前前台窗口不是受支持的浏览器，请先切换到浏览器窗口再执行长截图'
  }
  return message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
}

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url.trim())
}

function getLongShotCopyHint() {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('win')) return '复制网页链接（Ctrl+C）'
  if (platform.includes('mac')) return '复制网页链接（Cmd+C）'
  return '复制链接'
}

function resetTextResults() {
  ocrText.value = ''
  sourceText.value = ''
  translatedText.value = ''
  providerError.value = false
}

function setCurrentImage(image: string, message: string, type: 'success' | 'warning' | 'info' | 'error' = 'success') {
  currentImage.value = image
  resetTextResults()
  setStatus(message, type)
}

async function loadSettings() {
  try {
    const stored = ztoolsApi.dbStorage.getItem<Partial<PluginSettings> | null>(SETTINGS_KEY)
    if (stored) {
      settings.ocrLang = typeof stored.ocrLang === 'string' ? stored.ocrLang : ''
      settings.targetLang = typeof stored.targetLang === 'string' && stored.targetLang ? stored.targetLang : 'zh'
      settings.autoCopy = stored.autoCopy === true
    }
  } catch {
    setStatus('设置读取失败，已使用默认设置', 'warning')
  }
}

watch(settings, () => {
  try {
    ztoolsApi.dbStorage.setItem(SETTINGS_KEY, { ...settings })
  } catch {
    setStatus('设置保存失败', 'error')
  }
}, { deep: true })

function handlePluginEnter(action: { code: string, payload: unknown }) {
  if (action.code === 'screenshot') {
    startScreenshot()
    return
  }

  if (action.code === 'long-shot') {
    startLongScreenshot()
    return
  }

  if (action.code === 'image-process') {
    handleImageProcess(action.payload)
    return
  }

  setStatus(`未识别的入口：${action.code}`, 'warning')
}

async function startScreenshot() {
  if (isBusy.value) return

  isScreenshotLoading.value = true
  resetTextResults()
  permissionHint.value = false
  setStatus('请在屏幕上选择截图区域', 'info')

  try {
    const hostImage = await new Promise<string>((resolve) => {
      try {
        ztoolsApi.screenCapture((image) => resolve(image || ''))
      } catch {
        resolve('')
      }
    })

    if (hostImage) {
      setCurrentImage(hostImage, '截图完成，可继续 OCR 或翻译')
      toast('截图完成', 'success')
      return
    }

    if (ztoolsApi.isMacOs()) {
      let fallback: Awaited<ReturnType<typeof window.services.captureScreenInteractive>>
      try {
        fallback = await window.services.captureScreenInteractive()
      } catch {
        fallback = { ok: false }
      }

      if (fallback.ok && fallback.dataUrl) {
        setCurrentImage(fallback.dataUrl, '截图完成，可继续 OCR 或翻译')
        toast('截图完成', 'success')
        return
      }

      if (fallback.canceled) {
        setCurrentImage('', '已取消截图', 'info')
        toast('已取消截图', 'info')
        return
      }
    }

    const message = '截图失败：未取得图片。请检查 ZTools 的屏幕录制权限，或改用系统截图后粘贴到 ZTools。'
    setCurrentImage('', message, 'error')
    permissionHint.value = true
    toast(message, 'error')
  } catch (error) {
    const message = '截图失败：未取得图片。请检查 ZTools 的屏幕录制权限，或改用系统截图后粘贴到 ZTools。'
    setCurrentImage('', message, 'error')
    permissionHint.value = true
    toast(message, 'error')
  } finally {
    isScreenshotLoading.value = false
  }
}

function readImageSource(source: unknown): string {
  if (typeof source !== 'string' || !source) return ''
  if (/^data:image\//i.test(source)) return source
  return window.services.readImageAsDataUrl(source) ?? ''
}

function getImageFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return readImageSource(payload)
  if (!payload || typeof payload !== 'object') return ''

  const record = payload as Record<string, unknown>
  const directImage = record.dataUrl ?? record.image ?? record.base64
  if (typeof directImage === 'string') {
    const image = readImageSource(directImage)
    if (image) return image
  }

  const imagePath = record.path ?? record.filePath ?? record.file
  if (typeof imagePath === 'string') return readImageSource(imagePath)

  return ''
}

function handleImageProcess(payload: unknown) {
  const image = getImageFromPayload(payload)
  if (!image) {
    setCurrentImage('', '图片读取失败，请确认 ZTools 传入的是有效图片', 'error')
    toast('图片读取失败', 'error')
    return
  }

  const action = (payload as Record<string, unknown> | null)?.action
  setCurrentImage(image, typeof action === 'string' ? `图片已载入：${action}` : '图片已载入，可选择 OCR、翻译或保存')
}

async function ocrWithProvider() {
  if (!currentImage.value || isOcrLoading.value) return

  isOcrLoading.value = true
  providerError.value = false
  setStatus('OCR 识别中…', 'info')

  try {
    const options = settings.ocrLang ? { lang: settings.ocrLang } : {}
    const result = await ztoolsApi.ocr(currentImage.value, options)
    ocrText.value = result.text?.trim() ?? ''
    sourceText.value = ocrText.value
    translatedText.value = ''

    if (!ocrText.value) {
      setStatus('OCR 完成，但未识别到文本', 'warning')
      toast('未识别到文本', 'warning')
      return
    }

    setStatus('OCR 完成', 'success')
    toast('OCR 完成', 'success')
    if (settings.autoCopy) ztoolsApi.copyText(ocrText.value)
  } catch (error) {
    const message = getErrorMessage(error, 'OCR 失败')
    providerError.value = isProviderMissingError(message)
    setStatus(providerError.value ? `OCR Provider 未配置：${message}` : message, 'error')
    toast(message, 'error')
  } finally {
    isOcrLoading.value = false
  }
}

function getTranslateSource() {
  const ocrResult = ocrText.value.trim()
  if (ocrResult) return ocrResult

  const selection = window.getSelection()?.toString().trim()
  return selection || ''
}

async function translateText() {
  if (isTranslateLoading.value) return

  const text = getTranslateSource()
  if (!text) {
    setStatus('请先执行 OCR，或在页面中选中文本后再翻译', 'warning')
    toast('请先执行 OCR 或选中文本', 'warning')
    return
  }

  isTranslateLoading.value = true
  providerError.value = false
  sourceText.value = text
  translatedText.value = ''
  setStatus('翻译中…', 'info')

  try {
    const result = await ztoolsApi.translate(text, { to: settings.targetLang })
    translatedText.value = result.text?.trim() ?? ''
    if (!translatedText.value) {
      setStatus('翻译完成，但返回结果为空', 'warning')
      toast('翻译结果为空', 'warning')
      return
    }

    setStatus('翻译完成', 'success')
    toast('翻译完成', 'success')
  } catch (error) {
    const message = getErrorMessage(error, '翻译失败')
    providerError.value = isProviderMissingError(message)
    setStatus(providerError.value ? `翻译 Provider 未配置：${message}` : message, 'error')
    toast(message, 'error')
  } finally {
    isTranslateLoading.value = false
  }
}

function copyTextToClipboard(text: string, label: string) {
  if (!text) {
    toast(`${label}为空`, 'warning')
    return
  }

  const copied = ztoolsApi.copyText(text)
  toast(copied ? `${label}已复制` : `${label}复制失败`, copied ? 'success' : 'error')
}

function copyCurrentImage() {
  if (!currentImage.value) return

  const copied = ztoolsApi.copyImage(currentImage.value)
  toast(copied ? '图片已复制' : '图片复制失败', copied ? 'success' : 'error')
}

function saveCurrentImage() {
  if (!currentImage.value) return

  const result = window.services.saveImage(currentImage.value)
  if (result?.ok) {
    setStatus(`图片已保存：${result.path ?? ''}`, 'success')
    toast(`图片已保存：${result.path ?? ''}`, 'success')
    return
  }

  if (result?.canceled) {
    setStatus('保存已取消', 'info')
    toast('保存已取消', 'info')
    return
  }

  const message = result?.error || '图片保存失败'
  setStatus(message, 'error')
  toast(message, 'error')
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getLongShotViewport() {
  try {
    const display = ztoolsApi.getPrimaryDisplay()
    const size = display.workAreaSize ?? display.size
    if (size?.width && size?.height) {
      return {
        width: Math.max(480, Math.min(size.width, 1280)),
        height: Math.max(480, Math.min(size.height, 800)),
      }
    }
  } catch {
  }

  return { width: 1280, height: 800 }
}

function normalizeBrowserId(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (Array.isArray(value)) {
    const id = value.find((item) => typeof item === 'number')
    return typeof id === 'number' ? id : undefined
  }
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>).id
    if (typeof id === 'number') return id
  }

  return undefined
}

async function runBrowser(builder: BrowserRunner, browserId?: number) {
  return browserId === undefined ? builder.run({ show: true }) : builder.run(browserId)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const DOM_READY_ERROR = 'did not executed'

function isDomReadyError(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes(DOM_READY_ERROR)
  if (typeof error === 'string') return error.includes(DOM_READY_ERROR)
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    return typeof message === 'string' && message.includes(DOM_READY_ERROR)
  }

  return false
}

async function withDomReadyRetry<T>(task: () => Promise<T>, attempts = 12, delayMs = 250): Promise<T> {
  if (attempts < 1) throw new Error('withDomReadyRetry requires at least one attempt')

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      if (!isDomReadyError(error)) throw error
      lastError = error
      if (attempt < attempts) await sleep(delayMs)
    }
  }

  throw lastError
}

async function waitForDomReady(browserId: number | undefined, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    try {
      const readyState = await runBrowser(
        ztoolsApi.ubrowser.evaluate(() => document.readyState),
        browserId,
      )
      if (readyState === 'complete' || readyState === 'interactive') return
    } catch (error) {
      if (!isDomReadyError(error)) throw error
    }

    if (Date.now() >= deadline) throw new Error('页面加载超时，未能进入可截图状态')
    await sleep(250)
  }
}

function normalizeMetrics(value: unknown): ScrollMetrics {
  const candidates = Array.isArray(value) ? value : [value]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue

    const record = candidate as Record<string, unknown>
    const metrics = (record.data && typeof record.data === 'object' ? record.data : record) as Record<string, unknown>
    if (
      typeof metrics.scrollY === 'number'
      && typeof metrics.innerHeight === 'number'
      && typeof metrics.scrollHeight === 'number'
    ) {
      return {
        scrollY: metrics.scrollY,
        innerHeight: metrics.innerHeight,
        scrollHeight: metrics.scrollHeight,
      }
    }
  }

  throw new Error('无法读取页面滚动信息')
}

async function readScrollMetrics(browserId?: number): Promise<ScrollMetrics> {
  const result = await withDomReadyRetry(() => runBrowser(
    ztoolsApi.ubrowser.evaluate(() => ({
      scrollY: window.scrollY || document.documentElement.scrollTop || 0,
      innerHeight: window.innerHeight,
      scrollHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0,
      ),
    })),
    browserId,
  ))
  return normalizeMetrics(result)
}

function createTempFramePath(index: number) {
  const tempRoot = ztoolsApi.getPath('temp').replace(/\/+$/, '')
  return `${tempRoot}/ztools-long-shot-${Date.now()}-${String(index + 1).padStart(2, '0')}.png`
}

async function captureFrame(path: string, browserId?: number) {
  await withDomReadyRetry(() => runBrowser(ztoolsApi.ubrowser.screenshot(null, path), browserId))
}

function updateLongShotProgress(captured: number) {
  const percent = Math.round((captured / MAX_LONG_SHOT_FRAMES) * 100)
  longShotPercent.value = Math.min(99, percent)
  longShotProgress.value = `长截图进行中：已捕获 ${captured}/${MAX_LONG_SHOT_FRAMES} 段`
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('临时截图读取失败'))
    image.src = dataUrl
  })
}

async function stitchFrames(
  frames: CapturedFrame[],
  deltas: number[],
  logicalViewportHeight: number,
  remainingHeight: number,
) {
  const images: HTMLImageElement[] = []
  for (const frame of frames) {
    const dataUrl = window.services.readImageAsDataUrl(frame.path)
    if (!dataUrl) break
    images.push(await loadImage(dataUrl))
  }

  if (!images.length) throw new Error('没有可拼接的截图')

  const canvas = document.createElement('canvas')
  const firstImage = images[0]
  const scale = firstImage.height / logicalViewportHeight
  const segmentHeights = images.map((image, index) => {
    const moveDelta = index === 0 ? logicalViewportHeight : deltas[index - 1] ?? logicalViewportHeight
    const cropTop = index === 0 ? 0 : clamp(image.height - moveDelta * scale, 0, image.height)
    const availableHeight = image.height - cropTop
    if (index === images.length - 1) {
      return clamp(remainingHeight * scale, 0, availableHeight)
    }

    return clamp(moveDelta * scale, 0, availableHeight)
  })

  canvas.width = Math.max(...images.map((image) => image.width))
  canvas.height = Math.max(1, Math.round(segmentHeights.reduce((total, height) => total + height, 0)))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 初始化失败')

  let destinationY = 0
  images.forEach((image, index) => {
    const moveDelta = index === 0 ? logicalViewportHeight : deltas[index - 1] ?? logicalViewportHeight
    const cropTop = index === 0 ? 0 : clamp(image.height - moveDelta * scale, 0, image.height)
    const cropHeight = segmentHeights[index]
    if (cropHeight <= 0) return

    context.drawImage(
      image,
      0,
      cropTop,
      image.width,
      cropHeight,
      0,
      destinationY,
      image.width,
      cropHeight,
    )
    destinationY += cropHeight
  })

  const dataUrl = canvas.toDataURL('image/png')
  if (!dataUrl.startsWith('data:image/png')) throw new Error('长截图合成失败，图片可能过大')
  return dataUrl
}

async function startLongScreenshot() {
  if (isLongShotLoading.value) return

  isLongShotLoading.value = true
  longShotError.value = ''
  longShotPercent.value = 0
  longShotProgress.value = '正在读取当前浏览器地址…'
  resetTextResults()
  setStatus('长截图开始', 'info')
  toast('长截图开始', 'info')

  let browserId: number | undefined

  try {
    let url = ''

    try {
      const currentUrl = await ztoolsApi.readCurrentBrowserUrl()
      if (typeof currentUrl === 'string' && isHttpUrl(currentUrl)) url = currentUrl.trim()
    } catch {}

    if (!url) {
      longShotProgress.value = '正在读取运行中的浏览器标签页…'
      try {
        const browserUrl = await preloadServices.readBrowserUrl()
        if (browserUrl.ok && browserUrl.url && isHttpUrl(browserUrl.url)) {
          url = browserUrl.url.trim()
          const message = `正在使用 ${browserUrl.browser ?? '浏览器'} 当前标签页`
          longShotProgress.value = message
          setStatus(message, 'info')
          toast(message, 'info')
        }
      } catch {}
    }

    if (!url) {
      try {
        const clipboardUrl = preloadServices.readClipboardUrl()
        if (clipboardUrl && isHttpUrl(clipboardUrl)) {
          url = clipboardUrl.trim()
          setStatus('已使用剪贴板中的链接', 'info')
          toast('已使用剪贴板中的链接', 'info')
        }
      } catch {}
    }

    if (!url) throw new Error(`未获取到网页地址。请在浏览器中打开目标页面后重试，或先${getLongShotCopyHint()}再执行长截图。`)

    const viewport = getLongShotViewport()
    const opened = await runBrowser(
      ztoolsApi.ubrowser.goto(url).viewport(viewport.width, viewport.height),
    )
    browserId = normalizeBrowserId(opened)
    if (browserId === undefined) {
      const idleBrowser = ztoolsApi.getIdleUBrowsers().find((browser) => browser.url === url)
      browserId = idleBrowser?.id
    }

    longShotProgress.value = '正在等待页面加载完成…'
    await waitForDomReady(browserId)
    await withDomReadyRetry(() => runBrowser(ztoolsApi.ubrowser.scroll(0, 0), browserId))

    let metrics = await readScrollMetrics(browserId)
    const frames: CapturedFrame[] = []
    const deltas: number[] = []
    let aborted = false
    let captureFinalFrame = true

    while (
      frames.length < MAX_LONG_SHOT_FRAMES
      && metrics.scrollY + metrics.innerHeight < metrics.scrollHeight - 4
    ) {
      try {
        const framePath = createTempFramePath(frames.length)
        await captureFrame(framePath, browserId)
        frames.push({ path: framePath })
        updateLongShotProgress(frames.length)

        const previousScrollY = metrics.scrollY
        await withDomReadyRetry(() => runBrowser(
          ztoolsApi.ubrowser.scroll(0, previousScrollY + metrics.innerHeight).wait(150),
          browserId,
        ))
        const nextMetrics = await readScrollMetrics(browserId)
        const actualDelta = nextMetrics.scrollY - previousScrollY
        if (actualDelta <= 0) {
          deltas.push(metrics.innerHeight)
          metrics = nextMetrics
          captureFinalFrame = false
          break
        }

        deltas.push(clamp(actualDelta, 1, metrics.innerHeight))
        metrics = nextMetrics
      } catch {
        if (frames.length > deltas.length) frames.pop()
        aborted = true
        break
      }
    }

    if (!aborted && captureFinalFrame && frames.length < MAX_LONG_SHOT_FRAMES) {
      try {
        const framePath = createTempFramePath(frames.length)
        await captureFrame(framePath, browserId)
        frames.push({ path: framePath })
        updateLongShotProgress(frames.length)
      } catch {
        aborted = true
      }
    }

    if (!frames.length) throw new Error('长截图未捕获到任何内容')

    const remainingHeight = Math.max(0, metrics.scrollHeight - metrics.scrollY)
    const composedImage = await stitchFrames(frames, deltas, metrics.innerHeight, remainingHeight)
    const reachedLimit = frames.length >= MAX_LONG_SHOT_FRAMES
    const complete = !aborted && !reachedLimit
    setCurrentImage(
      composedImage,
      complete ? '长截图完成' : '长截图已生成，但内容可能不完整',
      complete ? 'success' : 'warning',
    )
    longShotPercent.value = 100
    longShotProgress.value = complete
      ? `长截图完成：共 ${frames.length} 段`
      : `已生成 ${frames.length} 段结果${aborted ? '，部分捕获失败' : '，已达到段数上限'}`
    setStatus(longShotProgress.value, complete ? 'success' : 'warning')
    toast(complete ? '长截图完成' : '长截图已生成，但内容可能不完整', complete ? 'success' : 'warning')
  } catch (error) {
    const rawMessage = getErrorMessage(error, '长截图失败')
    const message = cleanLongShotErrorMessage(rawMessage)
    longShotError.value = rawMessage
    setStatus(message, 'error')
    toast(message, 'error')
  } finally {
    isLongShotLoading.value = false
  }
}

function goProviderSettings() {
  ztoolsApi.redirectAiModelsSetting()
}

function openScreenRecordingSettings() {
  void ztoolsApi.shellOpenExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
}

onMounted(() => {
  void loadSettings()
  ztoolsApi.onPluginEnter(handlePluginEnter)
  ztoolsApi.onPluginOut(() => {
    setStatus('插件已隐藏，结果仍保留在当前面板', 'info')
  })
})
</script>

<template>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-title">
        <span>截图工具箱</span>
        <span v-if="isLongShotLoading" class="toolbar-status">{{ longShotProgress }}</span>
      </div>

      <div class="toolbar-actions">
        <button type="button" :disabled="isScreenshotLoading || isLongShotLoading" @click="startScreenshot">
          {{ isScreenshotLoading ? '截图中…' : '重新截图' }}
        </button>
        <button type="button" :disabled="!canUseImageActions || isOcrLoading" @click="ocrWithProvider">
          {{ isOcrLoading ? 'OCR 中…' : 'OCR' }}
        </button>
        <button type="button" :disabled="!canUseImageActions || isTranslateLoading" @click="translateText">
          {{ isTranslateLoading ? '翻译中…' : '翻译' }}
        </button>
        <button type="button" :disabled="!canUseImageActions" @click="copyCurrentImage">复制图片</button>
        <button type="button" :disabled="!canUseImageActions" @click="saveCurrentImage">保存图片</button>
        <button type="button" class="ghost-button" @click="settingsOpen = !settingsOpen">
          {{ settingsOpen ? '收起设置' : '设置' }}
        </button>
      </div>
    </header>

    <section v-if="settingsOpen" class="settings-panel" aria-label="插件设置">
      <label>
        <span>OCR 语言</span>
        <select v-model="settings.ocrLang">
          <option value="">Provider 默认</option>
          <option value="zh">中文</option>
          <option value="en">英文</option>
          <option value="ja">日文</option>
          <option value="ko">韩文</option>
        </select>
      </label>
      <label>
        <span>翻译目标语言</span>
        <select v-model="settings.targetLang">
          <option value="zh">中文</option>
          <option value="en">英文</option>
          <option value="ja">日文</option>
          <option value="ko">韩文</option>
          <option value="fr">法语</option>
          <option value="de">德语</option>
          <option value="es">西班牙语</option>
        </select>
      </label>
      <label class="checkbox-row">
        <input v-model="settings.autoCopy" type="checkbox" />
        <span>OCR 成功后自动复制文本</span>
      </label>
    </section>

    <div class="status-bar" :class="`status-${statusType}`">
      <span>{{ statusMessage }}</span>
      <button v-if="providerError" type="button" class="provider-button" @click="goProviderSettings">
        去配置 Provider
      </button>
      <button v-if="permissionHint" type="button" class="provider-button" @click="openScreenRecordingSettings">
        打开屏幕录制设置
      </button>
    </div>

    <main class="content">
      <section v-if="isLongShotLoading || longShotProgress" class="long-shot-panel">
        <div class="long-shot-header">
          <span>{{ longShotProgress || '准备长截图…' }}</span>
          <span>{{ longShotPercent }}%</span>
        </div>
        <progress max="100" :value="longShotPercent" />
        <p v-if="longShotError" class="error-text">{{ cleanLongShotErrorMessage(longShotError) }}</p>
        <button v-if="longShotError && !isLongShotLoading" type="button" @click="startScreenshot">
          改用普通截图
        </button>
      </section>

      <section v-if="!currentImage" class="empty-state">
        <h1>截图工具箱</h1>
        <p>支持屏幕截图、OCR、翻译和当前浏览器长截图。</p>
        <div class="entry-actions">
          <button type="button" class="primary-button" :disabled="isScreenshotLoading || isLongShotLoading" @click="startScreenshot">
            {{ isScreenshotLoading ? '截图中…' : '屏幕截图' }}
          </button>
          <button type="button" :disabled="isLongShotLoading" @click="startLongScreenshot">
            {{ isLongShotLoading ? '长截图中…' : '长截图' }}
          </button>
          <button
            type="button"
            @click="toast('请通过 ZTools 图片指令或粘贴图片进入处理面板', 'info')"
          >
            处理粘贴图片
          </button>
        </div>
      </section>

      <section v-if="currentImage" class="preview-panel">
        <div class="section-header">
          <h2>图片预览</h2>
        </div>
        <div class="preview-scroll">
          <img :src="currentImage" alt="当前处理的图片" />
        </div>
      </section>

      <section v-if="currentImage || ocrText || isOcrLoading" class="result-panel">
        <div class="section-header">
          <h2>OCR 结果</h2>
          <div class="section-actions">
            <button type="button" :disabled="!ocrText" @click="copyTextToClipboard(ocrText, 'OCR 结果')">复制</button>
            <button type="button" :disabled="!ocrText || isTranslateLoading" @click="translateText">翻译</button>
          </div>
        </div>
        <pre class="result-text">{{ isOcrLoading ? '识别中…' : ocrText || '暂无 OCR 结果' }}</pre>
      </section>

      <section v-if="sourceText || translatedText || isTranslateLoading" class="result-panel">
        <div class="section-header">
          <h2>翻译结果</h2>
          <div class="section-actions">
            <button type="button" :disabled="!translatedText" @click="copyTextToClipboard(translatedText, '译文')">复制译文</button>
          </div>
        </div>
        <div class="translation-grid">
          <article>
            <h3>原文</h3>
            <pre class="result-text">{{ sourceText || '暂无原文' }}</pre>
          </article>
          <article>
            <h3>译文</h3>
            <pre class="result-text">{{ isTranslateLoading ? '翻译中…' : translatedText || '暂无译文' }}</pre>
          </article>
        </div>
      </section>
    </main>
  </div>
</template>
