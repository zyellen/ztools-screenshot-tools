<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, shallowRef } from 'vue'
import { requestParent } from '../shared/parentLink'
const preview = new URLSearchParams(location.search).get('preview') === '1'
const frames=shallowRef(0), idle=shallowRef(0), height=shallowRef(0), thumb=shallowRef('')
const skipped=shallowRef(0), consecutive=shallowRef(0)
function skipText() {
  return consecutive.value>=3 ? `滚动过快或内容过少，已跳过 ${skipped.value} 帧，请放慢滚动` : `已跳过 ${skipped.value} 帧`
}
const stopped=shallowRef(false), error=shallowRef(''), scroller=shallowRef<HTMLElement | null>(null)
function scrollToLatest() {
  if (scroller.value) scroller.value.scrollTop=scroller.value.scrollHeight
}
window.__ctlStatus = status => {frames.value=status.frames;idle.value=status.idle;skipped.value=status.skipped ?? 0;consecutive.value=status.consecutive ?? 0}
window.__preview = status => {
  frames.value=status.frames;height.value=status.height;thumb.value=status.thumb;skipped.value=status.skipped ?? 0;consecutive.value=status.consecutive ?? 0
  void nextTick(scrollToLatest)
}
async function finish(cancel:boolean) {
  if (stopped.value) return
  stopped.value=true
  try {
    const result=await requestParent(cancel ? 'ctl-cancel' : 'ctl-finish')
    if (!result.ok) throw new Error(result.error)
  } catch(cause) {error.value=String(cause);stopped.value=false}
}
function key(event:KeyboardEvent) {
  if (event.key === 'Escape') {event.preventDefault();void finish(true)}
}
onMounted(()=>window.addEventListener('keydown',key))
onUnmounted(()=>{
  delete window.__ctlStatus;delete window.__preview
  window.removeEventListener('keydown',key)
})
</script>
<template>
  <main :class="{preview}" :title="error || `静止 ${(idle/1000).toFixed(1)}s · 请自己滚动目标窗口`">
    <template v-if="preview">
      <strong>长截图·手动</strong>
      <div class="stats"><span>帧数 {{frames}}</span><span v-if="skipped>0" :class="{warning:consecutive>=3}" role="status">{{skipText()}}</span><span>已拼接 {{height}} px</span></div>
      <div ref="scroller" class="thumbnail" aria-label="实时拼接预览">
        <img v-if="thumb" :src="thumb" alt="已拼接的长截图" @load="scrollToLatest" />
        <span v-else>滚动目标窗口，预览将自动更新</span>
      </div>
    </template>
    <div v-else class="fallback-stats"><span>{{frames}} 帧</span><span v-if="skipped>0" :class="{warning:consecutive>=3}" :title="skipText()" role="status">{{skipText()}}</span></div>
    <div class="actions"><button :disabled="stopped" @click="finish(false)">完成</button><button :disabled="stopped" @click="finish(true)">取消</button></div>
    <small v-if="preview">ESC = 取消</small>
    <p v-if="error" class="error" role="alert">{{error}}</p>
  </main>
</template>
<style>
*{box-sizing:border-box}html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;font:13px system-ui;background:#20252e;color:white}main{height:100%;display:flex;gap:6px;align-items:center;justify-content:center}button{border:0;border-radius:4px;background:#405675;color:white;padding:7px 10px;cursor:pointer}button:disabled{opacity:.5}.actions{display:flex;gap:8px;flex-shrink:0}.fallback-stats{min-width:0;max-height:44px;overflow:auto;font-size:10px;line-height:12px}.fallback-stats span{display:block}.preview{flex-direction:column;justify-content:flex-start;padding:10px;gap:8px}.preview strong{align-self:flex-start}.warning{color:#ffd28a}.stats{display:flex;flex-wrap:wrap;gap:4px;justify-content:space-between;width:100%;font-size:12px}.stats .warning{flex-basis:100%}.thumbnail{width:200px;max-width:100%;height:260px;min-height:0;flex:1;overflow:auto;background:#141820;scrollbar-width:thin}.thumbnail img{display:block;max-width:100%;width:auto;height:auto}.thumbnail>span{display:block;padding:12px;color:#acb6c7;font-size:12px}.preview small{color:#acb6c7}.error{color:#ffaaaa;margin:0;font-size:11px;overflow:auto;max-height:36px}
</style>
