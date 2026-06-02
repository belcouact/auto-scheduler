import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

interface ChatMessage {
  role: string
  content: string
  timestamp?: Date
  tasks?: any[]
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const webSearchEnabled = ref(false)

  const saved = localStorage.getItem('chat-messages')
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      messages.value = parsed.map((m: any) => ({
        ...m,
        timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
      }))
    } catch {
      messages.value = []
    }
  }

  const savedSearch = localStorage.getItem('chat-web-search')
  if (savedSearch !== null) {
    webSearchEnabled.value = savedSearch === 'true'
  }

  watch(
    messages,
    (val) => {
      localStorage.setItem('chat-messages', JSON.stringify(val))
    },
    { deep: true }
  )

  watch(webSearchEnabled, (val) => {
    localStorage.setItem('chat-web-search', val ? 'true' : 'false')
  })

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg)
  }

  function updateMessage(index: number, updates: Partial<ChatMessage>) {
    if (index >= 0 && index < messages.value.length) {
      messages.value[index] = { ...messages.value[index], ...updates }
    }
  }

  function clearMessages() {
    messages.value = []
    localStorage.removeItem('chat-messages')
  }

  function setWebSearchEnabled(val: boolean) {
    webSearchEnabled.value = val
  }

  return {
    messages,
    webSearchEnabled,
    addMessage,
    updateMessage,
    clearMessages,
    setWebSearchEnabled,
  }
})
