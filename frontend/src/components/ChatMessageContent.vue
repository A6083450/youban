<script setup lang="ts">
import { computed } from 'vue'
import MpHtml from 'mp-html/dist/uni-app/components/mp-html/mp-html.vue'
import { renderChatMarkdown } from '@/features/chat/markdown'

const props = withDefaults(defineProps<{
  text: string
  markdown?: boolean
}>(), {
  markdown: false,
})

const html = computed(() => props.markdown ? renderChatMarkdown(props.text) : '')

const markdownContainerStyle = [
  'display:block',
  'min-width:0',
  'color:inherit',
  'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif',
  'font-size:16px',
  'font-weight:400',
  'letter-spacing:0',
  'line-height:1.75',
  'overflow-wrap:anywhere',
].join(';')

const markdownTagStyle = {
  p: 'margin:0 0 12px;line-height:1.75;',
  table: 'width:100%;margin:12px 0;border-collapse:collapse;background:#ffffff;',
  th: 'padding:10px 8px;border:1px solid #e6ddd5;background:#f8eee8;color:#3d3229;font-size:14px;font-weight:700;line-height:1.55;text-align:left;vertical-align:top;',
  td: 'padding:10px 8px;border:1px solid #e6ddd5;color:#3d3229;font-size:14px;line-height:1.55;text-align:left;vertical-align:top;word-break:break-word;',
  ul: 'margin:8px 0;padding-left:22px;',
  ol: 'margin:8px 0;padding-left:22px;',
  li: 'margin:4px 0;line-height:1.7;',
  blockquote: 'margin:10px 0;padding:8px 12px;border-left:3px solid #d97757;background:#fbf6f2;color:#6f6258;',
  code: 'padding:2px 4px;border-radius:4px;background:#f6f1ed;font-size:14px;',
  pre: 'margin:10px 0;padding:12px;border-radius:8px;background:#f6f1ed;white-space:pre-wrap;',
}
</script>

<template>
  <view class="chat-message-content">
    <MpHtml
      v-if="markdown"
      class="message-markdown"
      :content="html"
      :container-style="markdownContainerStyle"
      :tag-style="markdownTagStyle"
      :scroll-table="true"
      :selectable="true"
      :copy-link="false"
      :preview-img="false"
      :show-img-menu="false"
      :set-title="false"
    />
    <text v-else class="message-text">{{ text }}</text>
  </view>
</template>

<style scoped>
.chat-message-content {
  display: block;
  min-width: 0;
  max-width: 100%;
}

.message-text {
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1.75;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.message-markdown {
  display: block;
  min-width: 0;
  max-width: 100%;
}
</style>
