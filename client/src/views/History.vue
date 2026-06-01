<template>
  <div class="history-page">
    <n-card title="执行历史" :bordered="false" class="history-card">
      <n-space style="margin-bottom: 16px" wrap>
        <n-select
          v-model:value="filterTaskId"
          placeholder="筛选任务"
          :options="taskOptions"
          style="width: 220px"
          clearable
        />
        <n-select
          v-model:value="filterStatus"
          placeholder="执行状态"
          :options="statusOptions"
          style="width: 150px"
          clearable
        />
        <n-button @click="refreshAll" :loading="loading">刷新</n-button>
        <n-button v-if="checkedRowKeys.length > 0" type="error" :loading="deleting" @click="batchDelete">
          批量删除 ({{ checkedRowKeys.length }})
        </n-button>
      </n-space>

      <n-data-table
        :columns="columns"
        :data="history"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        :row-key="(row: HistoryEntry) => row.id"
        :checked-row-keys="checkedRowKeys"
        @update:checked-row-keys="onCheckedRowKeysChange"
      />
    </n-card>

    <n-card title="统计信息" class="stats-card" :bordered="false">
      <n-grid :cols="4" :x-gap="16">
        <n-gi>
          <n-statistic label="总执行次数" :value="stats.total_executions || 0" />
        </n-gi>
        <n-gi>
          <n-statistic label="成功次数" :value="stats.success_count || 0">
            <template #prefix>
              <n-icon color="#18a058"><SuccessIcon /></n-icon>
            </template>
          </n-statistic>
        </n-gi>
        <n-gi>
          <n-statistic label="失败次数" :value="stats.error_count || 0">
            <template #prefix>
              <n-icon color="#d03050"><ErrorIcon /></n-icon>
            </template>
          </n-statistic>
        </n-gi>
        <n-gi>
          <n-statistic label="平均耗时" :value="formatDuration(stats.avg_duration_ms)" />
        </n-gi>
      </n-grid>
    </n-card>

    <n-drawer v-model:show="drawerVisible" :width="720" placement="right">
      <n-drawer-content v-if="selectedEntry" :title="selectedEntry.task_name" closable>
        <template #header-extra>
          <n-tag :type="statusTagType(selectedEntry.status)" round :bordered="false">
            {{ statusLabel(selectedEntry.status) }}
          </n-tag>
        </template>

        <n-space vertical size="large">
          <n-card size="small" :bordered="false" class="detail-card">
            <n-descriptions :column="1" label-placement="left" bordered>
              <n-descriptions-item label="任务 ID">{{ selectedEntry.task_id }}</n-descriptions-item>
              <n-descriptions-item label="开始时间">{{ formatTime(selectedEntry.started_at) }}</n-descriptions-item>
              <n-descriptions-item label="完成时间">{{ formatTime(selectedEntry.completed_at) }}</n-descriptions-item>
              <n-descriptions-item label="耗时">{{ formatDuration(selectedEntry.duration_ms) }}</n-descriptions-item>
            </n-descriptions>
            <n-space style="margin-top: 16px">
              <n-button type="primary" :loading="rerunLoading" @click="rerunSelectedTask">立即重跑</n-button>
              <n-button tertiary @click="router.push(`/tasks/${selectedEntry.task_id}/edit`)">打开任务</n-button>
              <n-button tertiary @click="applyTaskFilter(selectedEntry.task_id)">筛选同任务记录</n-button>
            </n-space>
          </n-card>

          <n-card v-if="selectedEntry.error_message" title="错误信息" size="small" :bordered="false" class="detail-card">
            <template #header-extra>
              <n-button text @click="copyText(selectedEntry.error_message, '错误信息已复制')">复制</n-button>
            </template>
            <pre class="detail-block error-block">{{ selectedEntry.error_message }}</pre>
          </n-card>

          <n-card title="执行输出" size="small" :bordered="false" class="detail-card">
            <template #header-extra>
              <n-button text @click="copyText(selectedEntry.output || '暂无输出内容', '执行输出已复制')">复制</n-button>
            </template>
            <pre class="detail-block">{{ selectedEntry.output || '暂无输出内容' }}</pre>
          </n-card>

          <n-card title="相关服务器日志" size="small" :bordered="false" class="detail-card">
            <template #header-extra>
              <n-button text @click="loadServerLogs">刷新日志</n-button>
              <n-button text @click="copyText(selectedLogs.join('\n') || '未找到相关日志。', '服务器日志已复制')">复制</n-button>
            </template>
            <div v-if="selectedLogs.length === 0" class="empty-block">未找到相关日志。</div>
            <pre v-else class="detail-block log-block">{{ selectedLogs.join('\n') }}</pre>
          </n-card>
        </n-space>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NDrawer,
  NDrawerContent,
  NGi,
  NGrid,
  NIcon,
  NSelect,
  NSpace,
  NStatistic,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui'
import { historyApi, settingsApi, taskApi, type HistoryEntry } from '@/api'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const history = ref<HistoryEntry[]>([])
const tasks = ref<Array<{ id: string; name: string }>>([])
const loading = ref(false)
const deleting = ref(false)
const rerunLoading = ref(false)
const filterStatus = ref<string | null>(null)
const filterTaskId = ref<string | null>(null)
const stats = ref<any>({})
const checkedRowKeys = ref<string[]>([])
const serverLogs = ref<any[]>([])
const drawerVisible = ref(false)
const selectedEntry = ref<HistoryEntry | null>(null)

const statusOptions = [
  { label: '成功', value: 'success' },
  { label: '失败', value: 'error' },
  { label: '运行中', value: 'running' },
]

const taskOptions = computed(() =>
  tasks.value.map((task) => ({ label: task.name, value: task.id }))
)

const selectedLogs = computed(() => {
  if (!selectedEntry.value) return []
  return getRelatedLogs(selectedEntry.value.task_id, selectedEntry.value.started_at).map(formatLogEntry)
})

const SuccessIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('polyline', { points: '20 6 9 17 4 12' }),
    ])
  },
}

const ErrorIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('line', { x1: '15', y1: '9', x2: '9', y2: '15' }),
      h('line', { x1: '9', y1: '9', x2: '15', y2: '15' }),
    ])
  },
}

const loadHistory = async () => {
  loading.value = true
  try {
    const params: Record<string, string | number> = { limit: 100 }
    if (filterStatus.value) params.status = filterStatus.value
    if (filterTaskId.value) params.task_id = filterTaskId.value

    const result = await historyApi.list(params)
    history.value = result.data
  } catch (error) {
    message.error('加载历史记录失败')
  } finally {
    loading.value = false
  }
}

const loadStats = async () => {
  try {
    const result = await historyApi.stats()
    stats.value = result.data.stats
  } catch (error) {
    console.error('加载统计信息失败', error)
  }
}

const loadTasks = async () => {
  try {
    const result = await taskApi.list()
    tasks.value = result.data.map((task) => ({ id: task.id, name: task.name }))
  } catch (error) {
    console.error('加载任务选项失败', error)
  }
}

const loadServerLogs = async () => {
  try {
    const result = await settingsApi.getLogs(150)
    serverLogs.value = result.data
  } catch (error) {
    console.error('加载服务器日志失败', error)
  }
}

const refreshAll = async () => {
  await Promise.all([loadHistory(), loadStats(), loadServerLogs(), loadTasks()])
}

const getRelatedLogs = (taskId: string, startedAt: string) => {
  if (!taskId || !startedAt) return []
  const start = new Date(startedAt).getTime()
  const end = start + 60000
  return serverLogs.value.filter((log: any) => {
    if (!log.timestamp) return false
    const timestamp = new Date(log.timestamp).getTime()
    return timestamp >= start - 5000 && timestamp <= end + 10000
  })
}

const formatLogEntry = (log: any) => {
  if (log.raw) return log.raw
  const level = (log.level || '').toUpperCase()
  const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''
  const msg = log.message || ''
  return `${timestamp} [${level}] ${msg}`
}

const copyText = async (text: string, successMessage: string) => {
  try {
    await navigator.clipboard.writeText(text)
    message.success(successMessage)
  } catch (error) {
    message.error('复制失败')
  }
}

const openDrawer = (row: HistoryEntry) => {
  selectedEntry.value = row
  drawerVisible.value = true
}

const rerunSelectedTask = async () => {
  if (!selectedEntry.value) return

  rerunLoading.value = true
  try {
    await taskApi.execute(selectedEntry.value.task_id)
    message.success('任务已重新执行')
    await Promise.all([loadHistory(), loadStats(), loadServerLogs()])
  } catch (error) {
    message.error('重新执行失败')
  } finally {
    rerunLoading.value = false
  }
}

const applyTaskFilter = (taskId: string) => {
  filterTaskId.value = taskId
  drawerVisible.value = false
}

const onCheckedRowKeysChange = (keys: (string | number)[]) => {
  checkedRowKeys.value = keys.map(String)
}

const batchDelete = () => {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除选中的 ${checkedRowKeys.value.length} 条历史记录吗？`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      deleting.value = true
      try {
        await historyApi.batchDelete(checkedRowKeys.value)
        message.success(`已删除 ${checkedRowKeys.value.length} 条记录`)
        checkedRowKeys.value = []
        await Promise.all([loadHistory(), loadStats()])
      } catch (error) {
        message.error('批量删除失败')
      } finally {
        deleting.value = false
      }
    },
  })
}

const formatTime = (time: string | null | undefined) => {
  if (!time) return '-'
  return new Date(time).toLocaleString('zh-CN')
}

const formatDuration = (ms: number | null | undefined) => {
  if (!ms || ms < 0) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    success: '成功',
    error: '失败',
    running: '运行中',
  }
  return map[status] || status
}

const statusTagType = (status: string): 'success' | 'error' | 'info' | 'default' => {
  const map: Record<string, 'success' | 'error' | 'info' | 'default'> = {
    success: 'success',
    error: 'error',
    running: 'info',
  }
  return map[status] || 'default'
}

const columns = [
  {
    type: 'selection',
    width: 50,
  },
  {
    title: '任务名称',
    key: 'task_name',
    width: 220,
    ellipsis: { tooltip: true },
  },
  {
    title: '状态',
    key: 'status',
    width: 110,
    render: (row: HistoryEntry) => h(NTag, {
      type: statusTagType(row.status),
      round: true,
      bordered: false,
    }, { default: () => statusLabel(row.status) }),
  },
  {
    title: '开始时间',
    key: 'started_at',
    width: 180,
    render: (row: HistoryEntry) => formatTime(row.started_at),
  },
  {
    title: '完成时间',
    key: 'completed_at',
    width: 180,
    render: (row: HistoryEntry) => formatTime(row.completed_at),
  },
  {
    title: '耗时',
    key: 'duration_ms',
    width: 100,
    render: (row: HistoryEntry) => formatDuration(row.duration_ms),
  },
  {
    title: '操作',
    key: 'actions',
    width: 140,
    render: (row: HistoryEntry) => h(NSpace, { size: 'small' }, {
      default: () => [
        h(NButton, {
          size: 'small',
          quaternary: true,
          type: 'primary',
          onClick: () => openDrawer(row),
        }, { default: () => '详情' }),
        h(NButton, {
          size: 'small',
          quaternary: true,
          onClick: () => router.push(`/tasks/${row.task_id}/edit`),
        }, { default: () => '任务' }),
      ],
    }),
  },
]

watch([filterStatus, filterTaskId], () => {
  loadHistory()
})

onMounted(() => {
  refreshAll()
})
</script>

<style scoped>
.history-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.history-card,
.stats-card {
  border-radius: 22px;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.06);
}

.detail-card {
  border-radius: 18px;
  background: #f8fafc;
}

.detail-block {
  margin: 0;
  padding: 16px;
  border-radius: 14px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}

.error-block {
  background: #450a0a;
  color: #fecaca;
}

.log-block {
  background: #111827;
}

.empty-block {
  padding: 12px 4px;
  color: #64748b;
}
</style>
