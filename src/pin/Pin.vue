<script setup lang="ts">
import { usePinZoom } from './usePinZoom'
import { onMounted, onUnmounted, ref } from 'vue'
import { copyImage, isWindowGone, errorText, toast } from '../shared/runtime'
import { saveViaParent } from '../shared/parentLink'
const {imageStyle,percent,visible,wheel,loaded,reset,down,move,up}=usePinZoom()
const image=ref('')
const error=ref('')
window.__shotStatus=()=>({phase:error.value?'error':image.value?'ready':'loading',error:error.value})
async function action(name: string) {
  try {
    if(name==='copy') copyImage(image.value)
    else if(name==='save') await saveViaParent(image.value)
    else window.close()
  } catch(cause) {if (!isWindowGone(cause)) {error.value=errorText(cause);toast(error.value,'error')}}
}
let focusTimer: ReturnType<typeof setTimeout> | undefined
let hovering = false
function focusOnLeave() {
  hovering = false
  clearTimeout(focusTimer)
}
function focusOnEnter() {
  clearTimeout(focusTimer)
  hovering = true
  focusTimer = setTimeout(() => {
    if (hovering && !document.hasFocus()) window.focus()
  }, 250)
}
function key(event: KeyboardEvent) { if (event.key === 'Escape') {event.preventDefault();window.close()} }
onUnmounted(()=>{focusOnLeave();window.removeEventListener('keydown',key)})
onMounted(()=>{
  window.addEventListener('keydown',key)
  const path=new URLSearchParams(location.search).get('src')
  try {
    if(!path) throw new Error('缺少贴图路径')
    const data=window.services.readImageAsDataUrl(path)
    if(!data) throw new Error('贴图读取失败')
    image.value=data
  } catch(cause) {if (!isWindowGone(cause)) {error.value=errorText(cause);toast(error.value,'error')}}
  finally {
    if(path) {try {window.services.removeTempImages([path])} catch(cause) {if (!isWindowGone(cause)) toast(errorText(cause),'error')}}
  }
})
</script>
<template>
  <main class="pin" @wheel="wheel" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @pointerenter="focusOnEnter" @pointerleave="focusOnLeave"><img v-if="image" :src="image" :style="imageStyle" @load="loaded" @dblclick.stop="reset" draggable="false" alt="悬浮截图" /><p v-if="error">{{error}}</p><nav><button :disabled="!image" @click="action('copy')">复制</button><button :disabled="!image" @click="action('save')">保存</button><button @click="action('close')">✕</button></nav><span class="zoom-hint" :class="{visible}">{{percent}}%</span></main>
</template>
<style>
*{box-sizing:border-box}html,body,#app,.pin{margin:0;width:100%;height:100%;overflow:hidden;background:#1c212a;color:white;font:13px system-ui}body{-webkit-app-region:drag}.pin{position:relative;display:flex;align-items:center;justify-content:center;-webkit-app-region:no-drag;user-select:none}.pin img{flex:none;object-fit:contain}.zoom-hint{position:absolute;right:10px;bottom:8px;padding:4px 7px;background:#121722c9;border-radius:4px;opacity:0;transition:opacity .2s;pointer-events:none}.zoom-hint.visible{opacity:1}.pin nav{position:absolute;top:0;left:0;right:0;display:flex;justify-content:flex-end;gap:4px;padding:6px;background:#121722c9;opacity:0;transition:opacity .15s;-webkit-app-region:no-drag}.pin:hover nav,.pin nav:focus-within{opacity:1}button{background:#39455b;color:white;border:0;border-radius:4px;padding:7px 12px;cursor:pointer}.pin p{position:absolute;inset:30px 10px}
</style>
