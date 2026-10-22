<script setup lang="ts">
import { nextTick, ref, type CSSProperties } from 'vue'
import type { Rect } from '../shared/runtime'
export interface TextItem { id: number; x: number; y: number; text: string; size: number; color: string }
const props = defineProps<{ rect: Rect; toolbarStyle: CSSProperties }>()
const emit = defineEmits<{ finish: [items: TextItem[]]; cancel: [] }>()
const items = ref<TextItem[]>([])
const selected = ref<number | null>(null)
const size = ref(24)
const color = ref('#ff4040')
const colors = ['#ff4040', '#ffcf33', '#38d978', '#3388ff', '#ffffff']
let nextId = 0
let drag: { item: TextItem; x: number; y: number; startX: number; startY: number } | undefined
function select(item: TextItem) { selected.value = item.id; size.value = item.size; color.value = item.color }
async function add(event: MouseEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const item = { id: ++nextId, x: Math.max(0, event.clientX - bounds.left), y: Math.max(0, event.clientY - bounds.top), text: '', size: size.value, color: color.value }
  items.value.push(item); selected.value = item.id
  await nextTick()
  document.getElementById(`annotation-${item.id}`)?.focus()
}
function changeSize(delta: number) {
  size.value = Math.max(10, Math.min(96, size.value + delta))
  const item = items.value.find(item => item.id === selected.value)
  if (item) item.size = size.value
}
function changeColor(value: string) {
  color.value = value
  const item = items.value.find(item => item.id === selected.value)
  if (item) item.color = value
}
function startDrag(event: PointerEvent, item: TextItem) {
  select(item)
  drag = { item, x: item.x, y: item.y, startX: event.clientX, startY: event.clientY }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag) return
  drag.item.x = Math.max(0, Math.min(props.rect.width - 10, drag.x + event.clientX - drag.startX))
  drag.item.y = Math.max(0, Math.min(props.rect.height - 10, drag.y + event.clientY - drag.startY))
}
</script>
<template>
  <div class="annotation-area" :style="{left: rect.x+'px', top: rect.y+'px', width: rect.width+'px', height: rect.height+'px'}" @click.self="add">
    <div v-for="item in items" :key="item.id" class="text-item" :style="{left:item.x+'px',top:item.y+'px',color:item.color,fontSize:item.size+'px'}" @click.stop="select(item)">
      <div class="text-tools">
        <button title="拖动" @pointerdown.stop="startDrag($event,item)" @pointermove="move" @pointerup="drag=undefined" @pointercancel="drag=undefined">⠿</button>
        <button title="删除" @click.stop="items=items.filter(t=>t.id!==item.id)">✕</button>
      </div>
      <textarea :id="`annotation-${item.id}`" v-model="item.text" placeholder="输入文本" :style="{fontSize:item.size+'px',color:item.color,width:Math.max(40,Math.min(rect.width-item.x,Math.max(100,...item.text.split('\n').map(line=>line.length*item.size))))+'px'}" @focus="select(item)" />
    </div>
  </div>
  <div class="annotation-toolbar menu" :style="toolbarStyle" @pointerdown.stop>
    <button @click="emit('finish',items)">完成</button><button @click="emit('cancel')">取消</button>
    <button @click="changeSize(-2)">字号 −</button><span>{{size}}</span><button @click="changeSize(2)">字号 +</button>
    <button v-for="value in colors" :key="value" :style="{background:value,outline:color===value?'2px solid #aaa':''}" class="swatch" @click="changeColor(value)" :aria-label="value" />
    <span>点击选区添加文本</span>
  </div>
</template>
<style scoped>
.annotation-area{position:absolute;cursor:text}.text-item{position:absolute}.text-tools{position:absolute;top:-20px;left:0;display:flex;height:20px}.text-tools button{padding:0 6px;cursor:move}.text-item textarea{font-family:sans-serif;line-height:1.2;background:transparent;border:1px dashed #aaa;min-height:60px;resize:both;max-width:100%;padding:0}.annotation-toolbar{position:absolute;display:flex;align-items:center;gap:8px;background:#1a202c;border:1px solid #57667c;padding:4px;height:44px;border-radius:8px;white-space:nowrap;overflow-x:auto;box-shadow:0 4px 18px #0007;cursor:default}.annotation-toolbar>*{flex-shrink:0}.swatch{width:22px;height:22px;border-radius:50%;padding:0}
</style>
