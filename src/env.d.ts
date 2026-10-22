/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

// Preload services 类型声明（对应 public/preload/services.js）
interface Services {
  writeUniqueImageToTemp: (dataUrl: string) => string | null
  removeTempImages: (paths: string[]) => void
  platform: string
  appendDiag(text:string): void
  frontmostApp(): Promise<string>
  activateApp(name:string): Promise<{ok:boolean;error?:string}>
  onShotRequest(handler: (request: {id:string;type:string;payload:Record<string,unknown>}, senderId:number) => void | Promise<void>): void
  captureRegion(x:number,y:number,w:number,h:number): Promise<{ok:boolean;path?:string;error?:string}>
  scrollWheel(x:number,y:number,lines?:number,times?:number): Promise<{ok:true;trusted:boolean} | {ok:false;error?:string;permission?:boolean}>
  pressKeyCode(code:number,repeat?:number): Promise<{ok:boolean;error?:string;permission?:boolean}>
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
    __shotCaptureState?: (state: 'active' | 'idle') => void
    __preview?: (status: {frames:number;height:number;thumb:string;skipped:number;consecutive:number}) => void
    __ctlStatus?: (status: {frames:number;idle:number;skipped?:number;consecutive?:number}) => void
    __shotReplies?: Map<string, (result: import('./shared/parentLink').ShotResult) => void>
    __shotReply?: (id:string, result: import('./shared/parentLink').ShotResult) => void
    __shotStatus?: () => { phase: string; error?: string }
    services: Services
  }
}

export {}
