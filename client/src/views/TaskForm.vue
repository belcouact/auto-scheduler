<template>
  <n-card :title="isEdit ? '编辑任务' : '创建任务'">
    <n-form ref="formRef" :model="formData" :rules="rules" label-placement="left" label-width="120">
      <n-grid :cols="2" :x-gap="24">
        <n-gi :span="2">
          <n-form-item label="任务名称" path="name">
            <n-input v-model:value="formData.name" placeholder="输入任务名称" />
          </n-form-item>
        </n-gi>
        
        <n-gi :span="2">
          <n-form-item label="描述" path="description">
            <n-input v-model:value="formData.description" type="textarea" placeholder="任务描述" :rows="2" />
          </n-form-item>
        </n-gi>

        <n-gi>
          <n-form-item label="任务类型" path="type">
            <n-select v-model:value="formData.type" :options="typeOptions" @update:value="onTypeChange" />
          </n-form-item>
        </n-gi>

        <n-gi>
          <n-form-item label="优先级" path="priority">
            <n-slider v-model:value="formData.priority" :min="0" :max="10" :step="1" :marks="{ 0: '低', 5: '中', 10: '高' }" />
          </n-form-item>
        </n-gi>

        <n-gi>
          <n-form-item label="调度类型" path="schedule_type">
            <n-select v-model:value="formData.schedule_type" :options="scheduleTypeOptions" />
          </n-form-item>
        </n-gi>

        <n-gi>
          <n-form-item label="调度表达式" path="schedule_expression">
            <n-space vertical style="width: 100%">
              <n-date-picker
                v-if="formData.schedule_type === 'once'"
                v-model:value="scheduleDateTime"
                type="datetime"
                :placeholder="scheduleExpressionPlaceholder"
                style="width: 100%"
                @update:value="onScheduleDateTimeChange"
              />
              <n-time-picker
                v-else-if="formData.schedule_type === 'daily'"
                v-model:formatted-value="scheduleTimeString"
                format="HH:mm"
                value-format="HH:mm"
                :placeholder="scheduleExpressionPlaceholder"
                style="width: 100%"
                @update:formatted-value="onScheduleTimeStringChange"
              />
              <n-space v-else-if="formData.schedule_type === 'weekly'" style="width: 100%">
                <n-select
                  v-model:value="scheduleWeekday"
                  :options="weekdayOptions"
                  placeholder="选择星期"
                  style="flex: 1"
                  @update:value="onWeekdayChange"
                />
                <n-time-picker
                  v-model:formatted-value="scheduleTimeString"
                  format="HH:mm"
                  value-format="HH:mm"
                  placeholder="选择时间"
                  style="flex: 1"
                  @update:formatted-value="onScheduleTimeStringChange"
                />
              </n-space>
              <n-space v-else-if="formData.schedule_type === 'monthly'" style="width: 100%">
                <n-input-number
                  v-model:value="scheduleMonthDayNum"
                  :min="1"
                  :max="31"
                  placeholder="几号"
                  style="flex: 1"
                  @update:value="onMonthDayNumChange"
                />
                <n-time-picker
                  v-model:formatted-value="scheduleTimeString"
                  format="HH:mm"
                  value-format="HH:mm"
                  placeholder="选择时间"
                  style="flex: 1"
                  @update:formatted-value="onScheduleTimeStringChange"
                />
              </n-space>
              <n-input
                v-else-if="formData.schedule_type === 'cron'"
                v-model:value="formData.schedule_expression"
                :placeholder="scheduleExpressionPlaceholder"
              />
              <n-space v-else-if="formData.schedule_type === 'hourly'" style="width: 100%">
                <n-input-number
                  v-model:value="scheduleMinuteNum"
                  :min="0"
                  :max="59"
                  placeholder="第几分钟"
                  style="flex: 1"
                  @update:value="onHourlyMinuteChange"
                />
                <n-tag type="info" style="flex: 2; justify-content: center">
                  每小时在第 {{ scheduleMinuteNum ?? 0 }} 分钟执行
                </n-tag>
              </n-space>
              <n-alert :type="scheduleAlertType" :show-icon="false">
                {{ schedulePreview }}
              </n-alert>
            </n-space>
          </n-form-item>
        </n-gi>

        <n-gi :span="2">
          <n-form-item label="标签" path="tags">
            <n-dynamic-tags v-model:value="formData.tags" />
          </n-form-item>
        </n-gi>

        <n-gi :span="2">
          <n-divider>任务配置</n-divider>
        </n-gi>

        <template v-if="formData.type === 'script'">
          <n-gi>
            <n-form-item label="脚本路径" path="script_path">
              <n-input v-model:value="formData.script_path" placeholder="C:\path\to\script.py" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="脚本参数" path="script_args">
              <n-input v-model:value="formData.script_args" placeholder="--arg1 value1 --arg2 value2" />
            </n-form-item>
          </n-gi>
        </template>

        <template v-if="formData.type === 'popup'">
          <n-gi :span="2">
            <n-form-item label="内容模式" path="popup_mode">
              <n-radio-group v-model:value="formData.popup_mode">
                <n-radio value="fixed">固定文本</n-radio>
                <n-radio value="ai">AI 调用（使用下方输入作为 prompt）</n-radio>
              </n-radio-group>
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="弹窗标题" path="popup_title">
              <n-input v-model:value="formData.popup_title" placeholder="提醒标题" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="弹窗图标" path="popup_icon">
              <n-input v-model:value="formData.popup_icon" placeholder="emoji 或图标路径" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="弹窗位置" path="popup_position">
              <n-select v-model:value="formData.popup_position" :options="popupPositionOptions" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="自动关闭(秒)" path="popup_auto_dismiss">
              <n-input-number v-model:value="formData.popup_auto_dismiss" :min="0" :max="300" placeholder="0 表示不自动关闭" />
            </n-form-item>
          </n-gi>

          <template v-if="formData.popup_mode === 'ai'">
            <n-gi>
              <n-form-item label="结果数量" path="ai_search_count">
                <n-input-number v-model:value="formData.ai_search_count" :min="1" :max="20" />
              </n-form-item>
            </n-gi>
            <n-gi :span="2">
              <n-form-item label="联网搜索" path="ai_enable_web_search">
                <n-switch v-model:value="formData.ai_enable_web_search" />
                <span style="margin-left: 8px; font-size: 12px; color: #999;">开启后将使用 SerpAPI 搜索网络内容</span>
              </n-form-item>
            </n-gi>
          </template>

          <n-gi :span="2">
            <n-form-item :label="formData.popup_mode === 'ai' ? 'AI Prompt' : '弹窗内容'" path="popup_content">
              <n-space vertical style="width: 100%">
                <n-space style="width: 100%; justify-content: space-between; align-items: center;">
                  <span style="font-size: 12px; color: #999;">{{ formData.popup_mode === 'ai' ? '将作为 prompt 发送给 AI' : '使用 AI 生成弹窗内容' }}</span>
                  <n-button size="small" type="primary" ghost @click="showAiGenDialog = true">
                    <template #icon>
                      <n-icon><Sparkles /></n-icon>
                    </template>
                    AI 生成
                  </n-button>
                </n-space>
                <n-input v-model:value="formData.popup_content" type="textarea" :placeholder="formData.popup_mode === 'ai' ? '例如：AI 领域最新进展' : '提醒内容'" :rows="4" />
              </n-space>
            </n-form-item>
          </n-gi>
        </template>

        <template v-if="formData.type === 'webhook'">
          <n-gi :span="2">
            <n-form-item label="URL" path="webhook_url">
              <n-input v-model:value="formData.webhook_url" placeholder="https://api.example.com/webhook" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="请求方法" path="webhook_method">
              <n-select v-model:value="formData.webhook_method" :options="methodOptions" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="请求头" path="webhook_headers">
              <n-input v-model:value="webhookHeadersStr" type="textarea" placeholder='{"Content-Type": "application/json"}' :rows="3" />
            </n-form-item>
          </n-gi>
          <n-gi :span="2">
            <n-form-item label="请求体" path="webhook_body">
              <n-input v-model:value="formData.webhook_body" type="textarea" placeholder='{"key": "value"}' :rows="4" />
            </n-form-item>
          </n-gi>
        </template>

        <template v-if="formData.type === 'system'">
          <n-gi>
            <n-form-item label="系统操作" path="system_action">
              <n-select v-model:value="formData.system_action" :options="systemActionOptions" />
            </n-form-item>
          </n-gi>
        </template>

        <n-gi>
          <n-form-item label="超时时间(秒)" path="timeout_seconds">
            <n-input-number v-model:value="formData.timeout_seconds" :min="10" :max="3600" />
          </n-form-item>
        </n-gi>

        <n-gi>
          <n-form-item label="最大重试次数" path="max_retries">
            <n-input-number v-model:value="formData.max_retries" :min="0" :max="10" />
          </n-form-item>
        </n-gi>
      </n-grid>

      <n-form-item>
        <n-space>
          <n-button type="primary" @click="handleSubmit" :loading="submitting">
            {{ isEdit ? '保存' : '创建' }}
          </n-button>
          <n-button @click="$router.back()">取消</n-button>
        </n-space>
      </n-form-item>
    </n-form>
  </n-card>

  <n-modal v-model:show="showAiGenDialog" preset="card" title="AI 生成弹窗内容" style="width: 600px;">
    <n-space vertical style="width: 100%">
      <n-input-text
        v-model:value="aiGenPrompt"
        type="textarea"
        placeholder="描述你想要生成的弹窗内容，例如：提醒用户明天上午9点参加项目会议，需要准备PPT和相关资料"
        :rows="3"
      />
      <n-button type="primary" @click="handleAiGenerateContent" :loading="aiGenLoading" style="align-self: flex-end;">
        生成内容
      </n-button>
      <n-divider v-if="aiGenResult" />
      <div v-if="aiGenResult" style="max-height: 300px; overflow-y: auto; padding: 12px; background: #f5f5f5; border-radius: 8px; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
        {{ aiGenResult }}
      </div>
      <n-space v-if="aiGenResult" style="justify-content: flex-end;">
        <n-button @click="showAiGenDialog = false">关闭</n-button>
        <n-button type="primary" @click="applyAiGeneratedContent">应用到表单</n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMessage, NAlert, NCard, NForm, NFormItem, NInput, NGrid, NGi, NSelect, NSlider, NDynamicTags, NDivider, NButton, NSpace, NInputNumber, NDatePicker, NTimePicker, NTag, NModal, NIcon, NInput as NInputText, NSwitch } from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'
import { taskApi, aiApi, type Task } from '@/api'
import { Sparkles } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const formRef = ref<FormInst | null>(null)
const submitting = ref(false)

const isEdit = computed(() => !!route.params.id)

const showAiGenDialog = ref(false)
const aiGenPrompt = ref('')
const aiGenLoading = ref(false)
const aiGenResult = ref('')

const formData = ref<Partial<Task>>({
  name: '',
  description: '',
  type: 'script',
  enabled: true,
  schedule_type: 'once',
  schedule_expression: '',
  priority: 5,
  tags: [],
  script_path: null,
  script_args: null,
  popup_title: null,
  popup_content: null,
  popup_icon: null,
  popup_position: 'center',
  popup_auto_dismiss: 0,
  webhook_url: null,
  webhook_method: 'GET',
  webhook_headers: null,
  webhook_body: null,
  system_action: null,
  ai_search_query: null,
  ai_search_count: 10,
  ai_enable_web_search: true,
  popup_mode: 'fixed',
  max_retries: 3,
  timeout_seconds: 300,
})

const webhookHeadersStr = ref('')

const scheduleDateTime = ref<number | null>(null)
const scheduleTimeString = ref<string>('09:00')
const scheduleWeekday = ref<string | null>(null)
const scheduleMonthDay = ref<number | null>(null)
const scheduleMonthDayNum = ref<number | null>(null)
const scheduleMinuteNum = ref<number>(0)

const weekdayOptions = [
  { label: '星期一', value: '1' },
  { label: '星期二', value: '2' },
  { label: '星期三', value: '3' },
  { label: '星期四', value: '4' },
  { label: '星期五', value: '5' },
  { label: '星期六', value: '6' },
  { label: '星期日', value: '0' },
]

const formatLocalDateTime = (timestamp: number): string => {
  const d = new Date(timestamp)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${da} ${h}:${mi}:${s}`
}

const onScheduleDateTimeChange = (value: number | null) => {
  if (value) {
    formData.value.schedule_expression = formatLocalDateTime(value)
  }
}

const onScheduleTimeStringChange = (value: string | null) => {
  if (value) {
    if (formData.value.schedule_type === 'weekly' && scheduleWeekday.value) {
      formData.value.schedule_expression = `${scheduleWeekday.value} ${value}`
    } else if (formData.value.schedule_type === 'monthly' && scheduleMonthDayNum.value) {
      formData.value.schedule_expression = `${scheduleMonthDayNum.value} ${value}`
    } else {
      formData.value.schedule_expression = value
    }
  }
}

const onWeekdayChange = (value: string | null) => {
  if (value) {
    const currentTime = formData.value.schedule_expression?.split(' ')[1] || '09:00'
    formData.value.schedule_expression = `${value} ${currentTime}`
  }
}

const onMonthDayNumChange = (value: number | null) => {
  if (value) {
    const currentTime = formData.value.schedule_expression?.split(' ')[1] || '09:00'
    formData.value.schedule_expression = `${value} ${currentTime}`
  }
}

const onHourlyMinuteChange = (value: number | null) => {
  const minute = value ?? 0
  formData.value.schedule_expression = `${minute}`
}

const initSchedulePickers = () => {
  const expr = formData.value.schedule_expression
  if (!expr) return

  if (formData.value.schedule_type === 'once' && expr) {
    const d = new Date(expr)
    if (!isNaN(d.getTime())) {
      scheduleDateTime.value = d.getTime()
    }
  } else if (formData.value.schedule_type === 'daily' && expr) {
    const [h, m] = expr.split(':').map(Number)
    if (!isNaN(h) && !isNaN(m)) {
      scheduleTimeString.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
  } else if (formData.value.schedule_type === 'weekly' && expr) {
    const parts = expr.split(' ')
    if (parts.length >= 1) {
      scheduleWeekday.value = parts[0]
    }
    if (parts.length >= 2) {
      const [h, m] = parts[1].split(':').map(Number)
      if (!isNaN(h) && !isNaN(m)) {
        scheduleTimeString.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      }
    }
  } else if (formData.value.schedule_type === 'monthly' && expr) {
    const parts = expr.split(' ')
    if (parts.length >= 1) {
      const day = parseInt(parts[0], 10)
      if (!isNaN(day)) {
        scheduleMonthDayNum.value = day
      }
    }
    if (parts.length >= 2) {
      const [h, m] = parts[1].split(':').map(Number)
      if (!isNaN(h) && !isNaN(m)) {
        scheduleTimeString.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      }
    }
  } else if (formData.value.schedule_type === 'hourly' && expr) {
    const minute = parseInt(expr, 10)
    if (!isNaN(minute)) {
      scheduleMinuteNum.value = minute
    }
  }
}

const typeOptions = [
  { label: '运行脚本', value: 'script' },
  { label: '弹窗提醒', value: 'popup' },
  { label: 'Webhook', value: 'webhook' },
  { label: '系统操作', value: 'system' },
]

const scheduleTypeOptions = [
  { label: '一次性执行', value: 'once' },
  { label: 'Cron表达式', value: 'cron' },
  { label: '每天', value: 'daily' },
  { label: '每周', value: 'weekly' },
  { label: '每月', value: 'monthly' },
  { label: '每小时', value: 'hourly' },
]

const methodOptions = [
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' },
  { label: 'DELETE', value: 'DELETE' },
]

const systemActionOptions = [
  { label: '关机', value: 'shutdown' },
  { label: '锁屏', value: 'lock' },
  { label: '休眠', value: 'hibernate' },
]

const popupPositionOptions = [
  { label: '屏幕中央', value: 'center' },
  { label: '右下角', value: 'bottom-right' },
]

const scheduleExpressionPlaceholder = computed(() => {
  const map: Record<string, string> = {
    once: '选择日期时间',
    cron: '输入Cron表达式, 如: */5 * * * *',
    daily: '选择时间',
    weekly: '选择星期',
    monthly: '选择日期',
    hourly: '每小时执行一次, 无需输入',
  }
  return map[formData.value.schedule_type || 'once']
})

const schedulePreview = computed(() => {
  const expression = formData.value.schedule_expression || '-'
  switch (formData.value.schedule_type) {
    case 'once':
      return `将在 ${expression} 执行一次`
    case 'daily':
      return `每天 ${expression} 执行`
    case 'weekly': {
      const [weekday, time] = expression.split(' ')
      const weekdayLabel = weekdayOptions.find((option) => option.value === weekday)?.label || '每周'
      return `${weekdayLabel} ${time || ''} 执行`
    }
    case 'monthly': {
      const [day, time] = expression.split(' ')
      return `每月 ${day || '?'} 号 ${time || ''} 执行`
    }
    case 'hourly':
      return `每小时第 ${expression} 分钟执行`
    case 'cron':
      return isScheduleExpressionValid(expression, 'cron')
        ? `使用 Cron 表达式执行: ${expression}`
        : 'Cron 表达式格式无效，请使用标准 5 段格式，例如 */5 * * * *'
    default:
      return expression
  }
})

const scheduleAlertType = computed(() => isScheduleExpressionValid(
  formData.value.schedule_expression || '',
  formData.value.schedule_type || 'once'
) ? 'info' : 'warning')

const rules: FormRules = {
  name: { required: true, message: '请输入任务名称', trigger: 'blur' },
  type: { required: true, message: '请选择任务类型', trigger: 'change' },
  schedule_type: { required: true, message: '请选择调度类型', trigger: 'change' },
  schedule_expression: {
    required: true,
    trigger: ['blur', 'change'],
    validator: (_rule, value: string) => {
      if (!value) {
        return new Error('请输入调度表达式')
      }
      if (!isScheduleExpressionValid(value, formData.value.schedule_type || 'once')) {
        return new Error('调度表达式格式不正确')
      }
      return true
    },
  },
  script_path: {
    trigger: 'blur',
    validator: (_rule, value: string | null) => {
      if (formData.value.type !== 'script') return true
      return value ? true : new Error('请输入脚本路径')
    },
  },
  popup_content: {
    trigger: 'blur',
    validator: (_rule, value: string | null) => {
      if (formData.value.type !== 'popup') return true
      return value ? true : new Error('请输入弹窗内容')
    },
  },
  webhook_url: {
    trigger: 'blur',
    validator: (_rule, value: string | null) => {
      if (formData.value.type !== 'webhook') return true
      return value ? true : new Error('请输入Webhook URL')
    },
  },
  system_action: {
    trigger: 'change',
    validator: (_rule, value: string | null) => {
      if (formData.value.type !== 'system') return true
      return value ? true : new Error('请选择系统操作')
    },
  },
  ai_search_query: {
    trigger: 'blur',
    validator: (_rule, value: string | null) => {
      return true;
    },
  },
  popup_content: {
    trigger: 'blur',
    validator: (_rule, value: string | null) => {
      if (formData.value.type !== 'popup') return true
      if (formData.value.popup_mode === 'ai') {
        return value ? true : new Error('请输入 AI Prompt')
      }
      return value ? true : new Error('请输入弹窗内容')
    },
  },
}

const onTypeChange = (_type: string) => {
  formData.value.script_path = null
  formData.value.popup_title = null
  formData.value.popup_content = null
  formData.value.popup_icon = null
  formData.value.popup_position = 'center'
  formData.value.popup_auto_dismiss = 0
  formData.value.webhook_url = null
  formData.value.system_action = null
  formData.value.ai_search_query = null
  formData.value.ai_search_count = 10
  formData.value.ai_enable_web_search = true
  formData.value.popup_mode = 'fixed'
}

const handleAiGenerateContent = async () => {
  if (!aiGenPrompt.value.trim()) {
    message.warning('请输入内容描述')
    return
  }

  aiGenLoading.value = true
  aiGenResult.value = ''

  try {
    const result = await aiApi.chat([
      {
        role: 'system',
        content: '你是一个专业的弹窗内容生成助手。根据用户的描述，生成简洁、清晰、有吸引力的弹窗提醒内容。内容应该直接、实用，适合在弹窗中显示。使用markdown格式，包含标题、要点和必要的说明。不要包含任何多余的解释。',
      },
      {
        role: 'user',
        content: `请根据以下描述生成弹窗内容：${aiGenPrompt.value}`,
      },
    ])

    aiGenResult.value = result.content || ''
    message.success('内容生成成功')
  } catch (error) {
    message.error('生成失败，请重试')
    console.error('AI generation error:', error)
  } finally {
    aiGenLoading.value = false
  }
}

const applyAiGeneratedContent = () => {
  if (aiGenResult.value) {
    formData.value.popup_content = aiGenResult.value
    showAiGenDialog.value = false
    message.success('已应用生成的内容')
  }
}

const skipScheduleTypeWatch = ref(false)

watch(() => formData.value.schedule_type, (newType) => {
  if (skipScheduleTypeWatch.value) return

  formData.value.schedule_expression = ''
  scheduleDateTime.value = null
  scheduleTimeString.value = '09:00'
  scheduleWeekday.value = null
  scheduleMonthDay.value = null
  scheduleMonthDayNum.value = null
  scheduleMinuteNum.value = 0

  if (newType === 'daily') {
    formData.value.schedule_expression = '09:00'
  } else if (newType === 'weekly') {
    formData.value.schedule_expression = '1 09:00'
    scheduleWeekday.value = '1'
  } else if (newType === 'monthly') {
    formData.value.schedule_expression = '1 09:00'
    scheduleMonthDayNum.value = 1
  } else if (newType === 'hourly') {
    scheduleMinuteNum.value = 0
    formData.value.schedule_expression = '0'
  } else if (newType === 'once') {
    const now = new Date()
    now.setMinutes(now.getMinutes() + 30)
    scheduleDateTime.value = now.getTime()
    formData.value.schedule_expression = formatLocalDateTime(now.getTime())
  }
})

const handleSubmit = async () => {
  try {
    await formRef.value?.validate()
    submitting.value = true

    const data = { ...formData.value }

    if (webhookHeadersStr.value) {
      try {
        data.webhook_headers = JSON.parse(webhookHeadersStr.value)
      } catch {
        message.error('请求头JSON格式错误')
        return
      }
    }

    if (isEdit.value) {
      await taskApi.update(route.params.id as string, data)
      message.success('任务已更新')
    } else {
      await taskApi.create(data)
      message.success('任务已创建')
    }

    router.push('/tasks')
  } catch (error) {
    message.error('提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  if (isEdit.value) {
    try {
      const result = await taskApi.get(route.params.id as string)
      skipScheduleTypeWatch.value = true
      
      const loadedData = result.data
      formData.value = { ...formData.value, ...loadedData }
      
      if (loadedData.webhook_headers) {
        webhookHeadersStr.value = JSON.stringify(loadedData.webhook_headers, null, 2)
      }
      
      nextTick(() => {
        initSchedulePickers()
        skipScheduleTypeWatch.value = false
      })
    } catch (error) {
      message.error('加载任务失败')
      router.push('/tasks')
    }
  }
})

function isScheduleExpressionValid(expression: string, type: string): boolean {
  const value = expression.trim()
  if (!value) return false

  switch (type) {
    case 'once':
      return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    case 'daily':
      return /^([01]?\d|2[0-3]):[0-5]\d$/.test(value)
    case 'weekly':
      return /^[0-6]\s+([01]?\d|2[0-3]):[0-5]\d$/.test(value)
    case 'monthly':
      return /^(?:[1-9]|[12]\d|3[01])\s+([01]?\d|2[0-3]):[0-5]\d$/.test(value)
    case 'hourly': {
      const minute = Number(value)
      return Number.isInteger(minute) && minute >= 0 && minute <= 59
    }
    case 'cron':
      return isValidCron(value)
    default:
      return true
  }
}

function isValidCron(value: string): boolean {
  const parts = value.split(/\s+/)
  if (parts.length !== 5) return false

  return parts.every((part, index) => validateCronPart(part, index))
}

function validateCronPart(part: string, index: number): boolean {
  if (part === '*') return true

  const [min, max] = index === 4 ? [0, 6] : index === 3 ? [1, 31] : index === 2 ? [1, 12] : index === 1 ? [0, 23] : [0, 59]

  const segments = part.split(',')
  return segments.every((segment) => {
    if (/^\*\/\d+$/.test(segment)) {
      return Number(segment.slice(2)) > 0
    }
    if (/^\d+$/.test(segment)) {
      const value = Number(segment)
      return value >= min && value <= max
    }
    if (/^\d+-\d+$/.test(segment)) {
      const [start, end] = segment.split('-').map(Number)
      return start >= min && end <= max && start <= end
    }
    return false
  })
}
</script>
