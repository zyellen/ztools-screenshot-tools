<script setup lang="ts">
defineProps<{ permission: boolean; warning: string; title: string; busy: boolean; error: string; providerError: boolean; original: string; translated: string; image: string }>()
const emit = defineEmits<{ close: []; copyText: [text: string]; translate: []; copyImage: []; saveImage: []; pinImage: []; accessibility: []; provider: [] }>()
</script>
<template>
  <div class="dialog-backdrop" @pointerdown.stop>
    <section class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <header><strong>{{title}}</strong><button :disabled="busy" @click="emit('close')">关闭</button></header>
      <p v-if="busy" role="status">处理中，请稍候…</p>
      <p v-if="warning">{{warning}}</p><button v-if="permission" @click="emit('accessibility')">去授权</button>
      <p v-if="error" class="error">{{error}}</p><button v-if="providerError" @click="emit('provider')">去配置 Provider</button>
      <template v-if="original"><label>原文</label><pre>{{original}}</pre><button :disabled="busy" @click="emit('copyText',original)">复制文本</button><button :disabled="busy" @click="emit('translate')">翻译</button></template>
      <template v-if="translated"><label>译文</label><pre>{{translated}}</pre><button @click="emit('copyText',translated)">复制译文</button></template>
      <template v-if="image"><div class="preview-scroll"><img class="preview" :src="image" alt="长截图预览" /></div><footer><button @click="emit('copyImage')">复制</button><button @click="emit('saveImage')">保存</button><button @click="emit('pinImage')">悬浮显示</button></footer></template>
    </section>
  </div>
</template>
<style scoped>
.dialog-backdrop{position:fixed;inset:0;background:#0008;display:grid;place-items:center;cursor:default;z-index:20}.dialog{width:min(720px,88vw);max-height:85vh;overflow:auto;background:#20252e;color:white;padding:22px;border:1px solid #677080;border-radius:12px;box-shadow:0 12px 60px #0009}header,footer{display:flex;justify-content:space-between;gap:8px;align-items:center}pre{white-space:pre-wrap;user-select:text;background:#131720;padding:14px;max-height:28vh;overflow:auto}label{display:block;margin-top:16px}.error{color:#ffa0a0}.preview-scroll{max-height:60vh;overflow:auto}.preview{display:block;max-width:100%;height:auto;margin:16px auto}button{margin:4px}
</style>
