<template>
  <div>
    <n-card>
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>任务列表</span>
          <n-space>
            <n-button type="info" @click="showAiCreate = true">
              <template #icon>
                <n-icon><SparkleIcon /></n-icon>
              </template>
              AI 创建
            </n-button>
            <n-button type="primary" @click="$router.push('/tasks/new')">
              <template #icon>
                <n-icon><PlusIcon /></n-icon>
              </template>
              创建任务
            </n-button>
          </n-space>
        </div>
      </template>

      <n-space style="margin-bottom: 16px">
        <n-input v-model:value="searchText" placeholder="搜索任务..." style="width: 200px" clearable />
        <n-select v-model:value="filterType" placeholder="任务类型" :options="typeOptions" style="width: 150px" clearable />
        <n-select v-model:value="filterEnabled" placeholder="状态" :options="statusOptions" style="width: 120px" clearable />
        <n-button v-if="checkedRowKeys.length > 0" :loading="bulkLoading" @click="batchSetEnabled(true)">批量启用</n-button>
        <n-button v-if="checkedRowKeys.length > 0" :loading="bulkLoading" @click="batchSetEnabled(false)">批量禁用</n-button>
        <n-button v-if="checkedRowKeys.length > 0" :loading="bulkLoading" @click="batchDuplicateTasks">
          批量复制 ({{ checkedRowKeys.length }})
        </n-button>
        <n-button v-if="checkedRowKeys.length > 0" type="error" :loading="bulkLoading" @click="batchDeleteTasks">
          批量删除 ({{ checkedRowKeys.length }})
        </n-button>
        <n-button @click="loadTasks">刷新</n-button>
      </n-space>

      <div style="overflow-x: auto">
        <n-data-table
          :columns="columns"
          :data="tasks"
          :loading="loading"
          :pagination="{ pageSize: 20 }"
          :row-key="(row: Task) => row.id"
          :checked-row-keys="checkedRowKeys"
          :scroll-x="1200"
          @update:checked-row-keys="onCheckedRowKeysChange"
        />
      </div>
    </n-card>

    <n-modal v-model:show="showAiCreate" preset="card" title="AI 创建任务" style="width: 500px" :on-update:show="resetAiCreate">
      <template v-if="!aiPreview">
        <n-input
          v-model:value="aiDescription"
          type="textarea"
          placeholder="用自然语言描述你想创建的任务，例如：&#10;• 每天早上9点提醒我喝水&#10;• 每周一上午10点发送周报提醒&#10;• 5分钟后锁屏休息"
          :autosize="{ minRows: 4, maxRows: 8 }"
          style="width: 100%"
        />
        <n-space style="margin-top: 16px; justify-content: flex-end">
          <n-button @click="showAiCreate = false">取消</n-button>
          <n-button type="info" :loading="aiCreating" @click="aiCreateTask" :disabled="!aiDescription.trim()">
            AI 生成
          </n-button>
        </n-space>
      </template>
      <template v-else>
        <n-alert type="success" style="margin-bottom: 12px">
          AI 已为你创建以下任务，请确认后保存
        </n-alert>
        <n-descriptions :column="1" bordered>
          <n-descriptions-item label="任务名称">{{ aiPreview.name }}</n-descriptions-item>
          <n-descriptions-item label="描述">{{ aiPreview.description || '-' }}</n-descriptions-item>
          <n-descriptions-item label="类型">{{ aiPreview.type }}</n-descriptions-item>
          <n-descriptions-item label="调度">{{ aiPreview.schedule_type }} {{ aiPreview.schedule_expression ? '- ' + aiPreview.schedule_expression : '' }}</n-descriptions-item>
          <n-descriptions-item label="优先级">{{ aiPreview.priority }}</n-descriptions-item>
          <n-descriptions-item v-if="aiPreview.script_path" label="脚本路径">{{ aiPreview.script_path }}</n-descriptions-item>
          <n-descriptions-item v-if="aiPreview.popup_title" label="弹窗标题">{{ aiPreview.popup_title }}</n-descriptions-item>
          <n-descriptions-item v-if="aiPreview.webhook_url" label="Webhook URL">{{ aiPreview.webhook_url }}</n-descriptions-item>
          <n-descriptions-item v-if="aiPreview.system_action" label="系统操作">{{ aiPreview.system_action }}</n-descriptions-item>
          <n-descriptions-item v-if="aiPreview.tags" label="标签">{{ aiPreview.tags }}</n-descriptions-item>
        </n-descriptions>
        <n-space style="margin-top: 16px; justify-content: flex-end">
          <n-button @click="resetAiCreate">重新生成</n-button>
          <n-button type="primary" @click="confirmCreate">确认保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage, useDialog, NButton, NTag, NIcon, NSpace, NSwitch, NTooltip, NCard, NDataTable, NInput, NSelect, NModal, NDescriptions, NDescriptionsItem, NAlert } from 'naive-ui'
import { taskApi, aiApi, type Task } from '@/api'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const tasks = ref<Task[]>([])
const loading = ref(false)
const searchText = ref('')
const filterType = ref<string | null>(null)
const filterEnabled = ref<string | null>(null)

const showAiCreate = ref(false)
const aiDescription = ref('')
const aiCreating = ref(false)
const aiPreview = ref<Task | null>(null)
const checkedRowKeys = ref<string[]>([])
const bulkLoading = ref(false)
let filterTimer: number | null = null

const typeOptions = [
  { label: '脚本', value: 'script' },
  { label: '弹窗', value: 'popup' },
  { label: 'Webhook', value: 'webhook' },
  { label: '系统', value: 'system' },
  { label: 'AI 搜索', value: 'ai_search' },
]

const statusOptions = [
  { label: '启用', value: 'true' },
  { label: '禁用', value: 'false' },
]

const PlusIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('line', { x1: '12', y1: '5', x2: '12', y2: '19' }),
      h('line', { x1: '5', y1: '12', x2: '19', y2: '12' }),
    ])
  }
}

const SparkleIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('path', { d: 'M12 2 L14 9 L21 10 L14 12 L12 19 L10 12 L3 10 L10 9 Z' }),
      h('path', { d: 'M18 14 L19 16 L21 17 L19 18 L18 20 L17 18 L15 17 L17 16 Z' }),
    ])
  }
}

const loadTasks = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (searchText.value) params.search = searchText.value
    if (filterType.value) params.type = filterType.value
    if (filterEnabled.value) params.enabled = filterEnabled.value

    const result = await taskApi.list(params)
    tasks.value = result.data
  } catch (error) {
    message.error('加载任务列表失败')
  } finally {
    loading.value = false
  }
}

const toggleEnabled = async (task: Task) => {
  try {
    await taskApi.update(task.id, { enabled: !task.enabled })
    message.success(`任务已${task.enabled ? '禁用' : '启用'}`)
    await loadTasks()
  } catch (error) {
    message.error('操作失败')
  }
}

const executeTask = async (task: Task) => {
  try {
    await taskApi.execute(task.id)
    message.success('任务已执行')
  } catch (error) {
    message.error('执行失败')
  }
}

const batchSetEnabled = async (enabled: boolean) => {
  if (checkedRowKeys.value.length === 0) return

  bulkLoading.value = true
  try {
    await taskApi.batchSetEnabled(checkedRowKeys.value, enabled)
    message.success(`已${enabled ? '启用' : '禁用'} ${checkedRowKeys.value.length} 个任务`)
    checkedRowKeys.value = []
    await loadTasks()
  } catch (error) {
    message.error('批量操作失败')
  } finally {
    bulkLoading.value = false
  }
}

const batchDeleteTasks = () => {
  if (checkedRowKeys.value.length === 0) return

  dialog.warning({
    title: '确认删除',
    content: `确定要删除选中的 ${checkedRowKeys.value.length} 个任务吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      bulkLoading.value = true
      try {
        await taskApi.batchDelete(checkedRowKeys.value)
        message.success(`已删除 ${checkedRowKeys.value.length} 个任务`)
        checkedRowKeys.value = []
        await loadTasks()
      } catch (error) {
        message.error('批量删除失败')
      } finally {
        bulkLoading.value = false
      }
    },
  })
}

const batchDuplicateTasks = async () => {
  if (checkedRowKeys.value.length === 0) return
  bulkLoading.value = true
  try {
    const results = await Promise.allSettled(checkedRowKeys.value.map(id => taskApi.duplicate(id)))
    const successCount = results.filter(r => r.status === 'fulfilled').length
    message.success(`成功复制 ${successCount}/${checkedRowKeys.value.length} 个任务`)
    checkedRowKeys.value = []
    await loadTasks()
  } catch (error) {
    message.error('批量复制失败')
  } finally {
    bulkLoading.value = false
  }
}

const aiCreateTask = async () => {
  if (!aiDescription.value.trim()) {
    message.warning('请描述要创建的任务')
    return
  }
  aiCreating.value = true
  try {
    const result = await aiApi.createTask(aiDescription.value)
    aiPreview.value = result.data
  } catch (error) {
    message.error('AI 创建任务失败')
  } finally {
    aiCreating.value = false
  }
}

const confirmCreate = async () => {
  showAiCreate.value = false
  aiDescription.value = ''
  aiPreview.value = null
  message.success('任务已通过 AI 创建')
  await loadTasks()
}

const resetAiCreate = () => {
  aiDescription.value = ''
  aiPreview.value = null
}

const getTypeTag = (type: string) => {
  const map: Record<string, { label: string; type: any }> = {
    script: { label: '脚本', type: 'info' },
    popup: { label: '弹窗', type: 'success' },
    webhook: { label: 'Webhook', type: 'warning' },
    system: { label: '系统', type: 'error' },
    ai_search: { label: 'AI搜索', type: 'primary' },
  }
  const config = map[type] || { label: type, type: 'default' }
  return h(NTag, { type: config.type, size: 'small' }, { default: () => config.label })
}

const getScheduleLabel = (task: Task) => {
  const typeMap: Record<string, string> = {
    once: '一次性',
    cron: '自定义',
    daily: '每天',
    weekly: '每周',
    monthly: '每月',
    hourly: '每小时',
  }
  return `${typeMap[task.schedule_type] || task.schedule_type} ${task.schedule_expression ? '- ' + task.schedule_expression : ''}`
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

const onCheckedRowKeysChange = (keys: (string | number)[]) => {
  checkedRowKeys.value = keys.map(String)
}

const EditIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
      h('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }),
    ])
  }
}

const PlayIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('polygon', { points: '5 3 19 12 5 21 5 3' }),
    ])
  }
}

const columns = [
  {
    type: 'selection',
    width: 48,
  },
  {
    title: '名称',
    key: 'name',
    width: 150,
    ellipsis: { tooltip: true },
  },
  {
    title: '类型',
    key: 'type',
    width: 80,
    render: (row: Task) => getTypeTag(row.type),
  },
  {
    title: '调度',
    key: 'schedule',
    width: 200,
    ellipsis: { tooltip: true },
    render: (row: Task) => getScheduleLabel(row),
  },
  {
    title: '上次执行',
    key: 'last_run',
    width: 160,
    ellipsis: { tooltip: true },
    render: (row: Task) => {
      if (!row.last_run_at) return '-'
      const statusTag = row.last_run_status === 'success'
        ? h(NTag, { type: 'success', size: 'small' }, { default: () => '成功' })
        : h(NTag, { type: 'error', size: 'small' }, { default: () => '失败' })
      return h('div', null, [
        h('div', null, new Date(row.last_run_at).toLocaleString('zh-CN')),
        h('div', { style: 'margin-top: 4px' }, [statusTag]),
      ])
    },
  },
  {
    title: '启用',
    key: 'enabled',
    width: 70,
    render: (row: Task) => h(NSwitch, {
      value: row.enabled,
      onUpdateValue: () => toggleEnabled(row),
      size: 'small',
    }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 160,
    render: (row: Task) => h(NSpace, { size: 'small' }, {
      default: () => [
        h(NTooltip, null, {
          trigger: () => h(NButton, { size: 'small', quaternary: true, circle: true, onClick: () => router.push(`/tasks/${row.id}/edit`) }, { icon: () => h(NIcon, null, { default: () => h(EditIcon) }) }),
          default: () => '编辑',
        }),
        h(NTooltip, null, {
          trigger: () => h(NButton, { size: 'small', quaternary: true, circle: true, type: 'info', onClick: () => executeTask(row) }, { icon: () => h(NIcon, null, { default: () => h(PlayIcon) }) }),
          default: () => '执行',
        }),
      ],
    }),
  },
]

onMounted(loadTasks)

watch([searchText, filterType, filterEnabled], () => {
  if (filterTimer) {
    window.clearTimeout(filterTimer)
  }
  filterTimer = window.setTimeout(() => {
    loadTasks()
  }, 250)
})

onUnmounted(() => {
  if (filterTimer) {
    window.clearTimeout(filterTimer)
  }
})
</script>
