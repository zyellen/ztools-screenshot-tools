<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { handleShotRequest } from './shared/parentRequests'
import { runOverlaySession } from './shared/overlaySession'

const SETTINGS_KEY = 'screenshot-tools-settings'
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

interface ZToolsRuntime {
  onPluginEnter(callback: (action: { code: string, type: string, payload: unknown }) => void): void
  onPluginOut(callback: (processExit: boolean) => void): void
  screenCapture(callback: (image: string) => void): void
  isMacOs(): boolean
  isWindows(): boolean
  shellOpenExternal(url: string): Promise<{ success: boolean, error?: string }>
  ocr(image: string, options: { lang?: string }): Promise<{ text?: string, blocks?: unknown[], confidence?: number }>
  translate(text: string, options: { from?: string, to?: string, providerId?: string }): Promise<{ text?: string, detectedFrom?: string }>
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
}

const ztoolsApi = window.ztools as unknown as ZToolsRuntime
try { window.services.onShotRequest(handleShotRequest) } catch (error) { console.error('父窗口代理初始化失败', error) }

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
const permissionHint = ref(false)

const settings = reactive<PluginSettings>({
  ocrLang: '',
  targetLang: 'zh',
  autoCopy: false,
})

const hasImage = computed(() => Boolean(currentImage.value))
const isBusy = computed(() => isScreenshotLoading.value || isOcrLoading.value || isTranslateLoading.value)
const canUseImageActions = computed(() => hasImage.value)

function setStatus(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  statusMessage.value = message
  statusType.value = type
}

function toast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  try { ztoolsApi.showToast(message, { type }) } catch (error) { console.error(message, error) }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function isProviderMissingError(message: string) {
  return /(请先配置|未配置|无可用|没有可用|无\s*provider|没有\s*provider|缺少.*(provider|模型)|没有.*(provider|模型)|no\s+provider|provider.*(missing|unavailable))/i.test(message)
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
  try {
    await runOverlaySession()
  } catch (error) {
    permissionHint.value = true
    toast(`覆盖层截图失败：${getErrorMessage(error, '请检查屏幕录制权限')}，已切换备用截图。可在主面板打开屏幕录制设置。`, 'warning')
    isScreenshotLoading.value = false
    await fallbackScreenshot()
    try { window.ztools.showMainWindow() } catch (error) { toast(getErrorMessage(error, '主窗口显示失败'), 'error') }
  } finally {
    isScreenshotLoading.value = false
  }
}

async function fallbackScreenshot() {
  if (isBusy.value) return

  isScreenshotLoading.value = true
  resetTextResults()
  permissionHint.value = false
  setStatus('请在屏幕上选择截图区域', 'info')

  try {
    const hostImage = await new Promise<string>((resolve) => {
      try {
        ztoolsApi.screenCapture((result) => {
          const image = typeof result === 'string' ? result : (result as { image?: string })?.image
          resolve(image || '')
        })
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
  try { return window.services.readImageAsDataUrl(source) ?? '' }
  catch (error) { toast(getErrorMessage(error, '图片读取失败'), 'error'); return '' }
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
    if (settings.autoCopy && !ztoolsApi.copyText(ocrText.value)) throw new Error('文本自动复制失败')
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
  try {
    if (!text) throw new Error(`${label}为空`)
    if (!ztoolsApi.copyText(text)) throw new Error(`${label}复制失败`)
    toast(`${label}已复制`, 'success')
  } catch (error) { toast(getErrorMessage(error, '复制失败'), 'error') }
}

function copyCurrentImage() {
  if (!currentImage.value) return
  try {
    if (!ztoolsApi.copyImage(currentImage.value)) throw new Error('图片复制失败')
    toast('图片已复制', 'success')
  } catch (error) { toast(getErrorMessage(error, '图片复制失败'), 'error') }
}

function saveCurrentImage() {
  if (!currentImage.value) return
  try {
    const result = window.services.saveImage(currentImage.value)
    if (result.canceled) { setStatus('保存已取消'); return }
    if (!result.ok) throw new Error(result.error || '图片保存失败')
    setStatus(`图片已保存：${result.path ?? ''}`, 'success')
    toast('图片已保存', 'success')
  } catch (error) {
    const message = getErrorMessage(error, '图片保存失败')
    setStatus(message, 'error'); toast(message, 'error')
  }
}

async function startLongScreenshot() { await startScreenshot() }

function goProviderSettings() {
  try { ztoolsApi.redirectAiModelsSetting() } catch (error) { toast(getErrorMessage(error, '打开 Provider 设置失败'), 'error') }
}

async function openScreenRecordingSettings() {
  try {
    const result = await ztoolsApi.shellOpenExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    if (result?.success === false) throw new Error(result.error || '打开系统设置失败')
  } catch (error) { toast(getErrorMessage(error, '打开系统设置失败'), 'error') }
}

onMounted(() => {
  void loadSettings()
  try {
    ztoolsApi.onPluginEnter(handlePluginEnter)
    ztoolsApi.onPluginOut(() => { setStatus('插件已隐藏，结果仍保留在当前面板', 'info') })
  } catch (error) { toast(getErrorMessage(error, '插件入口注册失败'), 'error') }
})
</script>

<template>
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-title">
        <span>截图工具箱</span>
      </div>

      <div class="toolbar-actions">
        <button type="button" :disabled="isScreenshotLoading" @click="startScreenshot">
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


      <section v-if="!currentImage" class="empty-state">
        <h1>截图工具箱</h1>
        <p>支持屏幕截图、OCR、翻译和滚动长截图。</p>
        <div class="entry-actions">
          <button type="button" class="primary-button" :disabled="isScreenshotLoading" @click="startScreenshot">
            {{ isScreenshotLoading ? '截图中…' : '屏幕截图' }}
          </button>
          <button type="button" :disabled="isBusy" @click="startLongScreenshot">
            长截图
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
