<template>
  <div class="ai-assistant">
    <n-grid :cols="24" :x-gap="16" :y-gap="16">
      <n-grid-item :span="24">
        <n-card :bordered="false" class="welcome-card">
          <div class="welcome-content">
            <div class="welcome-icon">
              <n-icon size="48" color="#18a058">
                <SparkleIcon />
              </n-icon>
            </div>
            <h2>AI 智能助手</h2>
            <p>描述您想要自动化的任务，AI 将为您生成任务配置或提供建议</p>
          </div>
          <div class="quick-actions">
            <n-button size="large" @click="quickAction('每天定时提醒我喝水')">
              <template #icon><n-icon><WaterIcon /></n-icon></template>
              定时提醒
            </n-button>
            <n-button size="large" @click="quickAction('每天早上9点自动备份数据库')">
              <template #icon><n-icon><DatabaseIcon /></n-icon></template>
              自动备份
            </n-button>
            <n-button size="large" @click="quickAction('监控服务器状态，异常时发送通知')">
              <template #icon><n-icon><MonitorIcon /></n-icon></template>
              系统监控
            </n-button>
            <n-button size="large" @click="quickAction('每周生成工作报告并发送邮件')">
              <template #icon><n-icon><MailIcon /></n-icon></template>
              报告生成
            </n-button>
          </div>
        </n-card>
      </n-grid-item>

      <n-grid-item :span="24">
        <n-card :bordered="false" class="chat-card">
          <template #header>
            <div class="chat-header">
              <span>对话</span>
              <n-button quaternary circle size="small" @click="clearChat">
                <template #icon><n-icon><TrashIcon /></n-icon></template>
              </n-button>
            </div>
          </template>

          <div ref="chatContainer" class="chat-container">
            <div v-if="messages.length === 0" class="empty-chat">
              <n-icon size="64" color="#c2c2c2">
                <ChatIcon />
              </n-icon>
              <p>开始与 AI 助手对话吧</p>
            </div>

            <div
              v-for="(msg, index) in messages"
              :key="index"
              class="message-wrapper"
              :class="msg.role === 'user' ? 'message-user' : 'message-assistant'"
            >
              <div class="message-avatar">
                <n-avatar v-if="msg.role === 'user'" :size="32" round>
                  <n-icon><PersonIcon /></n-icon>
                </n-avatar>
                <n-avatar v-else :size="32" round style="background: #18a058">
                  <n-icon><SparkleIcon /></n-icon>
                </n-avatar>
              </div>
              <div class="message-content">
                <div class="message-bubble" :class="msg.role === 'user' ? 'bubble-user' : 'bubble-assistant'">
                  <div class="message-text" v-html="formatMessage(msg.content)"></div>
                  <div v-if="msg.tasks && msg.tasks.length > 0" class="task-suggestions">
                    <n-divider dashed style="margin: 12px 0">推荐任务</n-divider>
                    <n-space vertical>
                      <n-card
                        v-for="(task, i) in msg.tasks"
                        :key="i"
                        size="small"
                        hoverable
                        class="task-suggestion-card"
                      >
                        <div class="task-suggestion-header">
                          <n-tag :type="getTaskTypeColor(task.type)" size="small">{{ getTaskTypeLabel(task.type) }}</n-tag>
                          <n-tag :type="getScheduleTypeColor(task.schedule_type)" size="small">{{ getScheduleTypeLabel(task.schedule_type) }}</n-tag>
                        </div>
                        <h4>{{ task.name }}</h4>
                        <p>{{ task.description }}</p>
                        <n-button size="small" type="primary" @click="createSuggestedTask(task)">
                          <template #icon><n-icon><PlusIcon /></n-icon></template>
                          创建此任务
                        </n-button>
                      </n-card>
                    </n-space>
                  </div>
                </div>
                <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
              </div>
            </div>

            <div v-if="isLoading" class="message-wrapper message-assistant">
              <div class="message-avatar">
                <n-avatar :size="32" round style="background: #18a058">
                  <n-icon><SparkleIcon /></n-icon>
                </n-avatar>
              </div>
              <div class="message-content">
                <div class="message-bubble bubble-assistant">
                  <div class="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="input-area">
            <div class="input-row">
              <n-input
                v-model:value="userInput"
                type="textarea"
                placeholder="描述您想要自动化的任务，例如：每天早上9点提醒我开会..."
                :autosize="{ minRows: 1, maxRows: 6 }"
                @keydown.ctrl.enter="sendMessage"
                @keydown.enter.exact.prevent="sendMessage"
              />
              <div class="input-side">
                <n-button
                  type="primary"
                  :loading="isLoading"
                  :disabled="!userInput.trim()"
                  @click="sendMessage"
                  size="large"
                >
                  <template #icon>
                    <n-icon><SendIcon /></n-icon>
                  </template>
                  发送
                </n-button>
              </div>
            </div>
          </div>
        </n-card>
      </n-grid-item>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import { useMessage, NCard, NSpace, NButton, NInput, NTag, NIcon, NAvatar, NDivider, NGrid, NGridItem } from 'naive-ui'
import { marked } from 'marked'
import { aiApi, taskApi } from '@/api'
import {
  Sparkles as SparkleIcon,
  Droplet as WaterIcon,
  Database as DatabaseIcon,
  Monitor as MonitorIcon,
  Mail as MailIcon,
  Trash2 as TrashIcon,
  MessageCircle as ChatIcon,
  User as PersonIcon,
  Send as SendIcon,
  Plus as PlusIcon,
} from '@lucide/vue'

marked.setOptions({
  breaks: true,
  gfm: true,
})

const message = useMessage()
const messages = ref<Array<{ role: string; content: string; timestamp?: Date; tasks?: any[] }>>([])
const userInput = ref('')
const isLoading = ref(false)
const chatContainer = ref<HTMLElement | null>(null)
const existingTasks = ref<any[]>([])

const scrollToBottom = async () => {
  await nextTick()
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight
  }
}

const loadExistingTasks = async () => {
  try {
    const result = await taskApi.list({})
    existingTasks.value = result.data || []
  } catch (error) {
    console.error('Failed to load existing tasks:', error)
    existingTasks.value = []
  }
}

const getExistingTasksContext = () => {
  if (existingTasks.value.length === 0) return ''
  
  const taskList = existingTasks.value.map(t => {
    const scheduleStr = t.schedule_type === 'once' 
      ? `一次性 ${t.schedule_expression}` 
      : `${t.schedule_type} ${t.schedule_expression}`
    return `- "${t.name}" (${t.type}): ${t.description || '无描述'} [${scheduleStr}]`
  }).join('\n')
  
  return `\n\n现有任务参考:\n${taskList}\n\n如果用户提到的任务与现有任务相关，可以参考或建议修改现有任务。`
}

const formatMessage = (content: string) => {
  if (!content) return ''
  
  try {
    return (marked.parse as (text: string) => string)(content)
  } catch (e) {
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

const formatTime = (timestamp?: Date) => {
  if (!timestamp) return ''
  return timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const getTaskTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    script: '脚本',
    popup: '弹窗',
    webhook: 'Webhook',
    system: '系统',
    ai_search: 'AI搜索',
  }
  return labels[type] || type
}

const getTaskTypeColor = (type: string) => {
  const colors: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    script: 'info',
    popup: 'success',
    webhook: 'warning',
    system: 'error',
    ai_search: 'default',
  }
  return colors[type] || 'default'
}

const getScheduleTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    once: '一次性',
    cron: 'Cron',
    daily: '每天',
    weekly: '每周',
    monthly: '每月',
    hourly: '每小时',
  }
  return labels[type] || type
}

const getScheduleTypeColor = (type: string) => {
  const colors: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    once: 'default',
    cron: 'info',
    daily: 'success',
    weekly: 'warning',
    monthly: 'error',
    hourly: 'info',
  }
  return colors[type] || 'default'
}

const quickAction = (text: string) => {
  userInput.value = text
  sendMessage()
}

const clearChat = () => {
  messages.value = []
  message.success('对话已清空')
}

const createSuggestedTask = async (taskData: any) => {
  try {
    const payload: any = {
      name: taskData.name,
      description: taskData.description,
      type: taskData.type,
      schedule_type: taskData.schedule_type,
      schedule_expression: taskData.schedule_expression || getDefaultScheduleExpression(taskData.schedule_type),
      priority: taskData.priority ?? 5,
      max_retries: taskData.max_retries ?? 3,
      timeout_seconds: taskData.timeout_seconds ?? 300,
    }

    if (taskData.type === 'popup') {
      payload.popup_title = taskData.popup_title || taskData.name
      payload.popup_content = taskData.popup_content || taskData.description
    } else if (taskData.type === 'script') {
      payload.script_path = taskData.script_path || ''
    } else if (taskData.type === 'webhook') {
      payload.webhook_url = taskData.webhook_url || ''
      payload.webhook_method = 'POST'
    } else if (taskData.type === 'system') {
      payload.system_action = taskData.system_action || 'lock'
    } else if (taskData.type === 'ai_search') {
      payload.ai_search_query = taskData.ai_search_query || taskData.description
      payload.ai_search_count = taskData.ai_search_count || 10
    }

    await taskApi.create(payload)
    message.success(`任务"${taskData.name}"已创建`)
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.response?.data?.errors?.map((e: any) => e.message).join(', ') || '创建任务失败'
    message.error(errorMsg)
  }
}

const getDefaultScheduleExpression = (scheduleType: string): string => {
  const now = new Date()
  switch (scheduleType) {
    case 'once':
      now.setHours(now.getHours() + 1)
      return now.toISOString().slice(0, 19).replace('T', ' ')
    case 'daily':
      return '09:00'
    case 'weekly':
      return '1 09:00'
    case 'monthly':
      return '1 09:00'
    case 'hourly':
      return '0'
    default:
      return '0 9 * * *'
  }
}

const sendMessage = async () => {
  if (!userInput.value.trim() || isLoading.value) return

  await loadExistingTasks()
  const userContent = userInput.value + getExistingTasksContext()
  
  const userMessage = {
    role: 'user',
    content: userContent,
    timestamp: new Date(),
  }
  messages.value.push(userMessage)
  userInput.value = ''
  isLoading.value = true
  await scrollToBottom()

  try {
    const response = await aiApi.chat(messages.value.map(m => ({ role: m.role, content: m.content })))
    
    let tasks: any[] = []
    try {
      const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        tasks = JSON.parse(jsonMatch[1])
      } else {
        const bracketMatch = response.content.match(/\[[\s\S]*\]/)
        if (bracketMatch) {
          tasks = JSON.parse(bracketMatch[0])
        }
      }
      
      tasks = tasks.filter((t: any) => t.name && t.description && t.type && t.schedule_type).map((t: any) => ({
        name: t.name,
        description: t.description,
        type: t.type,
        schedule_type: t.schedule_type,
        schedule_expression: t.schedule_expression || '',
        priority: t.priority || 5,
        max_retries: t.max_retries || 3,
        timeout_seconds: t.timeout_seconds || 300,
        popup_title: t.popup_title || '',
        popup_content: t.popup_content || '',
        script_path: t.script_path || '',
        webhook_url: t.webhook_url || '',
        system_action: t.system_action || '',
        ai_search_query: t.ai_search_query || '',
      }))
    } catch (e) {
      console.log('No task suggestions found or invalid JSON')
    }

    messages.value.push({
      role: 'assistant',
      content: response.content,
      timestamp: new Date(),
      tasks: tasks.length > 0 ? tasks : undefined,
    })
    await scrollToBottom()
  } catch (error: any) {
    message.error(error.response?.data?.message || 'AI请求失败')
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  await loadExistingTasks()
  await scrollToBottom()
})
</script>

<style scoped>
.ai-assistant {
  max-width: 1200px;
  margin: 0 auto;
}

.welcome-card {
  background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
  border: 1px solid #bbf7d0;
}

.welcome-content {
  text-align: center;
  padding: 24px 0;
}

.welcome-icon {
  margin-bottom: 16px;
}

.welcome-content h2 {
  margin: 0 0 8px 0;
  color: #166534;
  font-size: 24px;
}

.welcome-content p {
  margin: 0;
  color: #4b5563;
  font-size: 14px;
}

.quick-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 16px 0 8px;
}

.quick-actions .n-button {
  min-width: 140px;
}

.chat-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 280px);
  min-height: 500px;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
  margin-bottom: 16px;
}

.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
}

.empty-chat p {
  margin-top: 16px;
  font-size: 16px;
}

.message-wrapper {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.message-user {
  flex-direction: row-reverse;
}

.message-assistant {
  flex-direction: row;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  max-width: 70%;
  display: flex;
  flex-direction: column;
}

.message-user .message-content {
  align-items: flex-end;
}

.message-assistant .message-content {
  align-items: flex-start;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
}

.bubble-user {
  background: #18a058;
  color: white;
  border-bottom-right-radius: 4px;
}

.bubble-assistant {
  background: white;
  color: #333;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 4px;
}

.message-text {
  word-break: break-word;
  font-size: 14px;
}

.message-text :deep(h1),
.message-text :deep(h2),
.message-text :deep(h3) {
  margin: 12px 0 8px 0;
}

.message-text :deep(h1) {
  font-size: 1.5em;
}

.message-text :deep(h2) {
  font-size: 1.25em;
}

.message-text :deep(h3) {
  font-size: 1.1em;
}

.message-text :deep(ul),
.message-text :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.message-text :deep(li) {
  margin: 4px 0;
}

.message-text :deep(code) {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}

.message-text :deep(strong) {
  font-weight: 600;
}

.message-text :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 12px;
  background: #f9fafb;
  border-left: 4px solid #e5e7eb;
  border-radius: 0 4px 4px 0;
}

.message-text :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}

.message-text :deep(th),
.message-text :deep(td) {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
  text-align: left;
}

.message-text :deep(th) {
  background: #f9fafb;
  font-weight: 600;
}

.message-text :deep(tr:nth-child(even)) {
  background: #fafafa;
}

.message-text :deep(hr) {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 12px 0;
}

.message-time {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 4px;
  padding: 0 4px;
}

.task-suggestions {
  margin-top: 12px;
}

.task-suggestion-card {
  cursor: pointer;
  transition: all 0.2s;
}

.task-suggestion-card:hover {
  border-color: #18a058;
}

.task-suggestion-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.task-suggestion-card h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
}

.task-suggestion-card p {
  margin: 0 0 12px 0;
  font-size: 12px;
  color: #6b7280;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 0;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #18a058;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-8px);
    opacity: 1;
  }
}

.input-area {
  display: flex;
  flex-direction: column;
}

.input-row {
  display: flex;
  align-items: stretch;
  gap: 12px;
}

.input-row :deep(.n-input) {
  flex: 1;
}

.input-row :deep(.n-input__textarea-el) {
  min-height: 40px;
}

.input-side {
  flex-shrink: 0;
  display: flex;
}

.input-side :deep(.n-button) {
  height: 100%;
}

:deep(.n-card__header) {
  padding-bottom: 12px;
}

:deep(.n-card__content) {
  padding: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}
</style>
