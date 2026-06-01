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
          <n-gi :span="2">
            <n-form-item label="弹窗内容" path="popup_content">
              <n-input v-model:value="formData.popup_content" type="textarea" placeholder="提醒内容" :rows="4" />
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

        <template v-if="formData.type === 'ai_search'">
          <n-gi :span="2">
            <n-form-item label="搜索内容" path="ai_search_query">
              <n-input v-model:value="formData.ai_search_query" type="textarea" placeholder="描述你想搜索的内容，例如：AI领域最新进展、科技新闻头条等" :rows="3" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="结果数量" path="ai_search_count">
              <n-input-number v-model:value="formData.ai_search_count" :min="1" :max="20" placeholder="显示前几条结果" />
            </n-form-item>
          </n-gi>
          <n-gi>
            <n-form-item label="弹窗标题" path="popup_title">
              <n-input v-model:value="formData.popup_title" placeholder="留空则自动生成" />
            </n-form-item>
          </n-gi>
          <n-gi :span="2">
            <n-form-item label="弹窗图标" path="popup_icon">
              <n-input v-model:value="formData.popup_icon" placeholder="emoji 或留空自动使用🔍" />
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
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMessage, NCard, NForm, NFormItem, NInput, NGrid, NGi, NSelect, NSlider, NDynamicTags, NDivider, NButton, NSpace, NInputNumber, NDatePicker, NTimePicker, NTag } from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'
import { taskApi, type Task } from '@/api'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const formRef = ref<FormInst | null>(null)
const submitting = ref(false)

const isEdit = computed(() => !!route.params.id)

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
  webhook_url: null,
  webhook_method: 'GET',
  webhook_headers: null,
  webhook_body: null,
  system_action: null,
  ai_search_query: null,
  ai_search_count: 10,
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
  { label: 'AI 搜索', value: 'ai_search' },
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

const rules: FormRules = {
  name: { required: true, message: '请输入任务名称', trigger: 'blur' },
  type: { required: true, message: '请选择任务类型', trigger: 'change' },
  schedule_type: { required: true, message: '请选择调度类型', trigger: 'change' },
  schedule_expression: { required: true, message: '请输入调度表达式', trigger: 'blur' },
  script_path: { required: true, message: '请输入脚本路径', trigger: 'blur' },
  popup_content: { required: true, message: '请输入弹窗内容', trigger: 'blur' },
  webhook_url: { required: true, message: '请输入Webhook URL', trigger: 'blur' },
  system_action: { required: true, message: '请选择系统操作', trigger: 'change' },
  ai_search_query: { required: true, message: '请输入搜索内容', trigger: 'blur' },
}

const onTypeChange = (type: string) => {
  formData.value.script_path = null
  formData.value.popup_title = null
  formData.value.popup_content = null
  formData.value.webhook_url = null
  formData.value.system_action = null
  formData.value.ai_search_query = null
  formData.value.ai_search_count = 10
}

watch(() => formData.value.schedule_type, (newType) => {
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
      formData.value = result.data
      if (result.data.webhook_headers) {
        webhookHeadersStr.value = JSON.stringify(result.data.webhook_headers, null, 2)
      }
      initSchedulePickers()
    } catch (error) {
      message.error('加载任务失败')
      router.push('/tasks')
    }
  }
})
</script>
