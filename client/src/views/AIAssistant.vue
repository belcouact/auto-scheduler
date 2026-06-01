<template>
  <div>
    <n-card title="AI 助手">
      <n-alert type="info" style="margin-bottom: 16px">
        使用AI助手创建任务、获取建议或解决任务调度问题。可以描述你想要自动化的工作流程。
      </n-alert>

      <n-space style="margin-bottom: 16px">
        <n-button @click="loadSuggestions" :loading="suggestionsLoading">获取智能建议</n-button>
        <n-input v-model:value="suggestionContext" placeholder="描述您的需求, 如: 每天备份数据库" style="flex: 1" />
      </n-space>

      <div v-if="suggestionsContent" style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin-bottom: 16px; white-space: pre-wrap">
        {{ suggestionsContent }}
      </div>
    </n-card>

    <n-card title="对话" style="margin-top: 16px">
      <div ref="chatContainer" style="height: 400px; overflow-y: auto; padding: 16px; background: #fafafa; border-radius: 8px; margin-bottom: 16px">
        <div v-for="(msg, index) in messages" :key="index" :style="{ marginBottom: '12px', textAlign: msg.role === 'user' ? 'right' : 'left' }">
          <n-tag :type="msg.role === 'user' ? 'primary' : 'default'" :bordered="false" style="max-width: 70%; text-align: left; white-space: pre-wrap">
            {{ msg.content }}
          </n-tag>
        </div>
        <div v-if="isLoading" style="text-align: left">
          <n-tag type="default" :bordered="false">AI 正在思考...</n-tag>
        </div>
      </div>

      <n-space vertical style="width: 100%">
        <n-input
          v-model:value="userInput"
          type="textarea"
          placeholder="输入您的问题或描述想要自动化的任务..."
          :rows="4"
          :autosize="{ minRows: 4, maxRows: 8 }"
          @keydown.ctrl.enter="sendMessage"
          style="width: 100%"
        />
        <div style="display: flex; justify-content: flex-end">
          <n-button type="primary" @click="sendMessage" :loading="isLoading" size="large" style="min-width: 120px">
            发送
          </n-button>
        </div>
      </n-space>

      <n-alert type="info" style="margin-top: 8px">
        提示: 按 Ctrl+Enter 发送消息
      </n-alert>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useMessage, NCard, NAlert, NSpace, NButton, NInput, NTag } from 'naive-ui'
import { aiApi } from '@/api'

const message = useMessage()
const messages = ref<Array<{ role: string; content: string }>>([])
const userInput = ref('')
const isLoading = ref(false)
const chatContainer = ref<HTMLElement | null>(null)
const suggestionsLoading = ref(false)
const suggestionsContent = ref('')
const suggestionContext = ref('')

const scrollToBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

const sendMessage = async () => {
  if (!userInput.value.trim() || isLoading.value) return

  messages.value.push({ role: 'user', content: userInput.value })
  isLoading.value = true
  await scrollToBottom()

  try {
    const response = await aiApi.chat(messages.value)
    messages.value.push({ role: 'assistant', content: response.content })
    userInput.value = ''
    await scrollToBottom()
  } catch (error: any) {
    message.error(error.response?.data?.message || 'AI请求失败')
  } finally {
    isLoading.value = false
  }
}

const loadSuggestions = async () => {
  suggestionsLoading.value = true
  try {
    const response = await aiApi.suggestTasks(suggestionContext.value || '推荐一些实用的自动化任务')
    suggestionsContent.value = response.content
    message.success('已获取智能建议')
  } catch (error: any) {
    message.error(error.response?.data?.message || '获取建议失败')
  } finally {
    suggestionsLoading.value = false
  }
}
</script>
