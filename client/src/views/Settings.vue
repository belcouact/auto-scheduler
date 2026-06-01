<template>
  <n-card title="系统设置">
    <n-tabs type="line">
      <n-tab-pane name="ai" tab="AI 配置">
        <n-form :model="aiSettings" label-placement="left" label-width="120">
          <n-form-item label="AI 服务商">
            <n-select v-model:value="selectedProvider" :options="aiProviderOptions.map(p => ({ label: p.label, value: p.value }))" placeholder="选择AI服务商" @update:value="onProviderSelect" />
          </n-form-item>
          <n-form-item label="API 地址">
            <n-input v-model:value="aiSettings.ai_api_url" placeholder="https://api.openai.com/v1" />
          </n-form-item>
          <n-form-item label="API 密钥">
            <n-input v-model:value="aiSettings.ai_api_key" type="password" placeholder="sk-..." show-password-on="click" />
          </n-form-item>
          <n-form-item label="模型">
            <n-select v-if="aiModelOptions.length > 0" v-model:value="aiSettings.ai_model" :options="aiModelOptions" placeholder="选择模型" />
            <n-input v-else v-model:value="aiSettings.ai_model" placeholder="输入模型名称, 如: gpt-4o-mini" />
          </n-form-item>
          <n-form-item label="SerpAPI 密钥">
            <n-input v-model:value="aiSettings.serpapi_key" type="password" placeholder="SerpAPI key for web search" show-password-on="click" />
          </n-form-item>
          <n-form-item>
            <n-button type="primary" @click="saveAISettings" :loading="saving">保存AI配置</n-button>
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="notification" tab="通知设置">
        <n-form :model="notificationSettings" label-placement="left" label-width="120">
          <n-form-item label="通知音效">
            <n-switch v-model:value="notificationSound" />
          </n-form-item>
          <n-form-item>
            <n-button type="primary" @click="saveNotificationSettings" :loading="saving">保存通知设置</n-button>
          </n-form-item>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="history" tab="历史数据">
        <n-space vertical>
          <p>清理执行历史记录以释放空间</p>
          <n-space>
            <n-input-number v-model:value="clearDays" placeholder="天数" :min="1" style="width: 150px" />
            <n-button type="error" @click="clearHistory" :loading="clearing">清理历史记录</n-button>
            <n-button @click="loadStats">刷新统计</n-button>
          </n-space>
          <n-alert v-if="historyStats" type="info">
            当前共有 {{ historyStats.total_executions }} 条执行记录，成功 {{ historyStats.success_count }} 次，失败 {{ historyStats.error_count }} 次
          </n-alert>
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="about" tab="关于">
        <n-descriptions :column="1" label-placement="left" bordered>
          <n-descriptions-item label="应用名称">Auto Scheduler</n-descriptions-item>
          <n-descriptions-item label="版本">1.0.0</n-descriptions-item>
          <n-descriptions-item label="技术栈">Vue 3 + TypeScript + Naive UI + Express + SQLite</n-descriptions-item>
          <n-descriptions-item label="数据库路径">data/scheduler.db</n-descriptions-item>
          <n-descriptions-item label="功能特性">
            <ul style="margin: 0; padding-left: 20px">
              <li>支持多种任务类型：脚本、弹窗、Webhook、系统操作、AI搜索</li>
              <li>灵活的调度：一次性、Cron、每日、每周、每月、每小时</li>
              <li>任务执行历史与统计分析</li>
              <li>AI助手辅助创建任务</li>
              <li>任务优先级与标签管理</li>
              <li>重试机制与超时控制</li>
            </ul>
          </n-descriptions-item>
        </n-descriptions>
      </n-tab-pane>
    </n-tabs>
  </n-card>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'
import { useMessage, NCard, NTabs, NTabPane, NForm, NFormItem, NInput, NButton, NSwitch, NSpace, NInputNumber, NAlert, NDescriptions, NDescriptionsItem, NSelect } from 'naive-ui'
import { settingsApi, historyApi } from '@/api'

const message = useMessage()
const saving = ref(false)
const clearing = ref(false)
const clearDays = ref(30)
const historyStats = ref<any>(null)

const aiSettings = ref({
  ai_api_url: '',
  ai_api_key: '',
  ai_model: 'deepseek-v4-pro',
  serpapi_key: '',
})

const selectedProvider = ref('openai')

const aiProviderOptions = [
  { label: 'OpenAI', value: 'openai', url: 'https://api.openai.com/v1', models: [
    { label: 'gpt-5.5', value: 'gpt-5.5' },
    { label: 'gpt-5.5-pro', value: 'gpt-5.5-pro' },
    { label: 'gpt-5.5-thinking', value: 'gpt-5.5-thinking' },
    { label: 'gpt-5.4', value: 'gpt-5.4' },
    { label: 'gpt-5.4-pro', value: 'gpt-5.4-pro' },
    { label: 'gpt-5.3-codex', value: 'gpt-5.3-codex' },
  ]},
  { label: 'DeepSeek', value: 'deepseek', url: 'https://api.deepseek.com/v1', models: [
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' },
    { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash' },
    { label: 'deepseek-v3.2', value: 'deepseek-v3.2' },
    { label: 'deepseek-r2', value: 'deepseek-r2' },
    { label: 'deepseek-coder-v3', value: 'deepseek-coder-v3' },
  ]},
  { label: 'Kimi (Moonshot)', value: 'kimi', url: 'https://api.moonshot.cn/v1', models: [
    { label: 'kimi-k2.6', value: 'kimi-k2.6' },
    { label: 'kimi-k2.6-thinking', value: 'kimi-k2.6-thinking' },
    { label: 'kimi-k2.6-agent', value: 'kimi-k2.6-agent' },
    { label: 'kimi-k2.5', value: 'kimi-k2.5' },
    { label: 'kimi-k2-thinking', value: 'kimi-k2-thinking' },
  ]},
  { label: '智谱 (Zhipu)', value: 'zhipu', url: 'https://open.bigmodel.cn/api/paas/v4', models: [
    { label: 'glm-5.1', value: 'glm-5.1' },
    { label: 'glm-5', value: 'glm-5' },
    { label: 'glm-4.7-flash', value: 'glm-4.7-flash' },
    { label: 'glm-4-plus', value: 'glm-4-plus' },
    { label: 'glm-4v', value: 'glm-4v' },
  ]},
  { label: '自定义', value: 'custom', url: '', models: [] },
]

const aiModelOptions = ref(aiProviderOptions[0].models)

let isLoading = false

const detectProvider = (preserveModel = false) => {
  const url = aiSettings.value.ai_api_url
  if (!url) {
    aiModelOptions.value = aiProviderOptions[0].models
    return
  }
  for (const provider of aiProviderOptions) {
    if (provider.url && url.includes(provider.url.replace('https://', '').split('/')[0])) {
      if (provider.models.length > 0) {
        aiModelOptions.value = provider.models
        if (!preserveModel && !isLoading) {
          aiSettings.value.ai_model = provider.models[0].value
        } else if (preserveModel) {
          aiModelOptions.value = provider.models
        }
      }
      return
    }
  }
  aiModelOptions.value = []
}

watch(() => aiSettings.value.ai_api_url, () => {
  if (!isLoading) detectProvider(false)
})

const onProviderSelect = (value: string) => {
  const provider = aiProviderOptions.find(p => p.value === value)
  if (provider) {
    if (provider.value === 'custom') {
      aiSettings.value.ai_api_url = ''
      aiModelOptions.value = []
    } else {
      aiSettings.value.ai_api_url = provider.url
      aiModelOptions.value = provider.models
      if (provider.models.length > 0 && !isLoading) {
        const modelExists = provider.models.some(m => m.value === aiSettings.value.ai_model)
        if (!modelExists) {
          aiSettings.value.ai_model = provider.models[0].value
        }
      }
    }
  }
}

const notificationSound = ref(true)
const notificationSettings = ref({})

const loadSettings = async () => {
  isLoading = true
  try {
    const result = await settingsApi.get()
    if (result.data.ai_api_url) aiSettings.value.ai_api_url = result.data.ai_api_url
    if (result.data.ai_api_key) aiSettings.value.ai_api_key = result.data.ai_api_key
    if (result.data.ai_model) aiSettings.value.ai_model = result.data.ai_model
    if (result.data.serpapi_key) aiSettings.value.serpapi_key = result.data.serpapi_key
    if (result.data.notification_sound) notificationSound.value = result.data.notification_sound === 'true'
    detectProvider(true)
    
    const savedUrl = result.data.ai_api_url || ''
    for (const provider of aiProviderOptions) {
      if (provider.url && savedUrl.includes(provider.url.replace('https://', '').split('/')[0])) {
        selectedProvider.value = provider.value
        break
      }
    }
    if (!savedUrl) selectedProvider.value = 'custom'

    await nextTick()
  } catch (error) {
    message.error('加载设置失败')
  } finally {
    isLoading = false
  }
}

const saveAISettings = async () => {
  saving.value = true
  try {
    await settingsApi.update(aiSettings.value)
    message.success('AI配置已保存')
  } catch (error) {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

const saveNotificationSettings = async () => {
  saving.value = true
  try {
    await settingsApi.update({
      notification_sound: notificationSound.value ? 'true' : 'false',
    })
    message.success('通知设置已保存')
  } catch (error) {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

const clearHistory = async () => {
  clearing.value = true
  try {
    await historyApi.clear(clearDays.value || undefined)
    message.success('历史记录已清理')
    await loadStats()
  } catch (error) {
    message.error('清理失败')
  } finally {
    clearing.value = false
  }
}

const loadStats = async () => {
  try {
    const result = await historyApi.stats()
    historyStats.value = result.data.stats
  } catch (error) {
    console.error('加载统计失败', error)
  }
}

onMounted(() => {
  loadSettings()
  loadStats()
})
</script>
