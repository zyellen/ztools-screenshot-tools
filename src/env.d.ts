/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  readFile: (file: string) => string
  writeTextFile: (text: string) => string
  writeImageFile: (base64Url: string) => string | undefined
  saveImage: (dataUrl: string) => { ok: boolean, path?: string, canceled?: boolean, error?: string }
  readImageAsDataUrl: (filePath: string) => string | null
  writeImageToTemp: (dataUrl: string, ext?: string) => string | null
  captureScreenInteractive: () => Promise<{ ok: boolean, dataUrl?: string, canceled?: boolean, error?: string }>
}

declare global {
  interface Window {
    services: Services
  }
}

export {}
