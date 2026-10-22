<script setup lang="ts">
import TextAnnotations from './TextAnnotations.vue'
import ResultDialog from './ResultDialog.vue'
import { useOverlay } from './useOverlay'
const {captureActive,captureHintStyle,scrollError,geometryStyle,targetApp,scrollPanel,method,permission,warning,startScroll,accessibility,frozen,composed,rect,dragging,annotation,dialog,busy,title,error,original,translated,resultImage,providerError,selectionStyle,menuStyle,dimensionsStyle,hasSelection,down,move,up,close,action,finishAnnotations,recognize,resultAction,copyText,provider}=useOverlay()
const actions=[['copy','复制'],['save','保存'],['ocr','OCR'],['translate','翻译'],['text','添加文本'],['long','滚动截图'],['pin','悬浮显示'],['close','✕']]
</script>
<template>
  <main class="overlay" :class="{capturing:captureActive}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="dragging=false">
    <img v-if="frozen && !captureActive" class="frozen" :style="geometryStyle" :src="frozen" draggable="false" alt="屏幕冻结图" />
    <div v-if="!hasSelection" class="initial-mask" :style="geometryStyle"><span>拖拽框选区域 · ESC 退出</span></div>
    <div class="display-content" :style="geometryStyle">
      <div v-if="hasSelection" class="selection" :style="selectionStyle">
        <img v-if="composed && !captureActive" :src="composed" class="composed" draggable="false" alt="标注后的选区" />
        <span class="dimensions" :style="dimensionsStyle">{{Math.round(rect.width)}} × {{Math.round(rect.height)}}</span>
      </div>
      <span v-if="captureActive && hasSelection" class="capture-hint" :style="captureHintStyle">拖动滚动目标窗口 · 点击预览面板完成</span>
      <nav v-if="!captureActive && hasSelection && !dragging && !annotation && !dialog && !scrollPanel" class="menu" :style="menuStyle" @pointerdown.stop aria-label="截图操作">
        <button v-for="[name,label] in actions" :key="name" @click="action(name)">{{label}}</button>
      </nav>
      <TextAnnotations v-if="annotation && !captureActive" :rect="rect" :toolbar-style="menuStyle" @finish="finishAnnotations" @cancel="annotation=false" />
      <section v-if="scrollPanel && !captureActive" class="scroll-panel" :style="selectionStyle" @pointerdown.stop>
        <div><label><input v-model="method" type="radio" value="manual" />手动滚动（默认）</label><label><input v-model="method" type="radio" value="wheel" />滚轮（自动）</label><label><input v-model="method" type="radio" value="pageDown" />Page Down（自动）</label><label><input v-model="method" type="radio" value="arrowDown" />↓ 方向键（自动）</label>
        <p v-if="method === 'manual'">我滚，自动拼接：开始后自己滚动目标窗口，点预览面板「完成」结束；捕获至少两帧后静止 2.5 秒自动结束。</p><p v-else-if="method === 'wheel'">滚轮作用于选区中心的窗口，不需要键盘焦点。</p><p v-else>开始前会把焦点还给 {{targetApp || '前台窗口'}}</p><button @click="startScroll">开始</button><button @click="scrollPanel=false">取消</button></div>
      </section>
      <ResultDialog v-if="dialog && !captureActive" :permission="permission" :warning="warning" @accessibility="accessibility" :title="title" :busy="busy" :error="error" :provider-error="providerError" :original="original" :translated="translated" :image="resultImage" @close="dialog=false" @copy-text="copyText" @translate="recognize(true)" @copy-image="resultAction('copy')" @save-image="resultAction('save')" @pin-image="resultAction('pin')" @provider="provider" />
      <div v-if="!captureActive && (scrollError || (error && !dialog))" class="error-toast" role="alert">{{scrollError || error}} <button @click="close()">关闭</button></div>
    </div>
  </main>
</template>
<style>
*{box-sizing:border-box}html,body,#app{width:100%;height:100%;margin:0;overflow:hidden;font-family:system-ui,sans-serif;color:#fff}button{background:#343d4c;border:1px solid #586477;color:white;border-radius:5px;padding:8px 12px;cursor:pointer;font:inherit;font-size:13px}button:hover{background:#51627d}button:disabled{opacity:.5;cursor:wait}.overlay{position:relative;width:100vw;height:100vh;cursor:crosshair;user-select:none}.display-content{position:absolute;inset:0;pointer-events:none}.display-content>*{pointer-events:auto}.display-content>.selection{pointer-events:none}.frozen{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.initial-mask{position:absolute;inset:0;background:#0005;pointer-events:none}.initial-mask span{position:absolute;top:24px;left:50%;transform:translateX(-50%);padding:10px 20px;background:#18202c;border-radius:8px}.selection{position:absolute;box-shadow:0 0 0 99999px #0008;border:1px solid #62b0ff;pointer-events:none}.dimensions{position:absolute;top:0;left:0;background:#18202cdd;padding:3px 6px;font-size:12px;transform:translateY(-100%)}.composed{width:100%;height:100%;display:block}.menu{position:absolute;display:flex;align-items:center;flex-wrap:nowrap;gap:3px;height:44px;padding:4px;background:#1a202c;border:1px solid #57667c;border-radius:8px;box-shadow:0 4px 18px #0007;overflow-x:auto;overflow-y:hidden;cursor:default}.menu button{white-space:nowrap;flex-shrink:0;padding:7px 9px}.scroll-panel{position:absolute;z-index:10;overflow:visible;cursor:default}.scroll-panel>div{background:#20252e;border:1px solid #677080;border-radius:8px;padding:14px;width:min(380px,90vw)}.error-toast{position:fixed;z-index:30;left:20px;bottom:20px;background:#702c36;padding:14px;border-radius:8px}
/* The outline and glow start outside the capture rectangle: no border pixels inside. */
.capturing .selection{border:0;background:transparent;box-shadow:0 0 0 99999px #0008}
.capturing .selection::before{content:"";position:absolute;inset:-2px;border:2px solid #62b0ff;box-shadow:0 0 8px #62b0ff;clip-path:polygon(-10px -10px,calc(100% + 10px) -10px,calc(100% + 10px) calc(100% + 10px),-10px calc(100% + 10px),-10px -10px,2px 2px,2px calc(100% - 2px),calc(100% - 2px) calc(100% - 2px),calc(100% - 2px) 2px,2px 2px)}
.capturing .dimensions{top:-2px}.capture-hint{position:absolute;background:#18202c;padding:4px 0;font-size:12px;white-space:normal;pointer-events:none!important}.capturing .initial-mask{background:#0008}.capturing .initial-mask span{display:none}
</style>

<style scoped>
.overlay.capturing,.capturing .display-content>*{pointer-events:none!important}
.dimensions,.capture-hint{pointer-events:none!important}
</style>
