<template>
  <div>
    <n-card title="执行历史">
      <n-space style="margin-bottom: 16px">
        <n-select v-model:value="filterStatus" placeholder="执行状态" :options="statusOptions" style="width: 150px" @update:value="loadHistory" clearable />
        <n-button @click="loadHistory">刷新</n-button>
        <n-button v-if="checkedRowKeys.length > 0" type="error" @click="batchDelete">
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

    <n-card title="统计信息" style="margin-top: 16px">
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
  </div>
</template>

<script setup lang="ts">
import { ref, h, onMounted } from 'vue'
import { useMessage, useDialog, NIcon, NStatistic, NGrid, NGi, NCard, NSpace, NSelect, NButton, NDataTable } from 'naive-ui'
import { historyApi, settingsApi, type HistoryEntry } from '@/api'
import { popupQueue } from '@/composables/useSSE'

const message = useMessage()
const dialog = useDialog()
const history = ref<HistoryEntry[]>([])
const loading = ref(false)
const filterStatus = ref<string | null>(null)
const stats = ref<any>({})
const checkedRowKeys = ref<string[]>([])
const serverLogs = ref<any[]>([])

const statusOptions = [
  { label: '成功', value: 'success' },
  { label: '失败', value: 'error' },
  { label: '运行中', value: 'running' },
]

const SuccessIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('polyline', { points: '20 6 9 17 4 12' }),
    ])
  }
}

const ErrorIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('line', { x1: '15', y1: '9', x2: '9', y2: '15' }),
      h('line', { x1: '9', y1: '9', x2: '15', y2: '15' }),
    ])
  }
}

const loadHistory = async () => {
  loading.value = true
  try {
    const params: any = { limit: 100 }
    if (filterStatus.value) params.status = filterStatus.value

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

const loadServerLogs = async () => {
  try {
    const result = await settingsApi.getLogs(100)
    serverLogs.value = result.data
  } catch (error) {
    console.error('加载服务器日志失败', error)
  }
}

const getRelatedLogs = (taskId: string, startedAt: string) => {
  if (!taskId || !startedAt) return []
  const start = new Date(startedAt).getTime()
  const end = start + 60000
  return serverLogs.value.filter((log: any) => {
    if (!log.timestamp) return false
    const t = new Date(log.timestamp).getTime()
    return t >= start - 5000 && t <= end + 10000
  })
}

const formatLogEntry = (log: any) => {
  if (log.raw) return log.raw
  const level = (log.level || '').toUpperCase()
  const ts = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''
  const msg = log.message || ''
  return `${ts} [${level}] ${msg}`
}

const showStatusPopup = (row: HistoryEntry) => {
  const icon = row.status === 'success' ? '✅' : row.status === 'error' ? '❌' : '⏳'
  const statusText = row.status === 'success' ? '执行成功' : row.status === 'error' ? '执行失败' : '运行中'

  let content = `状态: ${statusText}\n开始时间: ${formatTime(row.started_at)}\n完成时间: ${formatTime(row.completed_at)}\n耗时: ${formatDuration(row.duration_ms)}`

  const relatedLogs = getRelatedLogs(row.task_id, row.started_at)
  if (relatedLogs.length > 0) {
    content += '\n\n--- 服务器日志 ---\n'
    content += relatedLogs.map(formatLogEntry).join('\n')
  } else if (serverLogs.value.length > 0) {
    const last10 = serverLogs.value.slice(-20)
    content += '\n\n--- 最近服务器日志 (20条) ---\n'
    content += last10.map(formatLogEntry).join('\n')
  }

  popupQueue.value.push({
    type: 'popup',
    id: `history-status-${row.id}`,
    title: row.task_name,
    content,
    icon,
    timestamp: row.started_at,
    taskId: row.task_id,
    taskName: row.task_name,
  })
}

const showDetailPopup = (row: HistoryEntry) => {
  const icon = row.status === 'success' ? '✅' : row.status === 'error' ? '❌' : '📋'
  const title = `${row.task_name} - 详细信息`
  const content = `${row.output ? row.output : ''}${row.error_message ? '\n\n错误信息:\n' + row.error_message : ''}`

  popupQueue.value.push({
    type: 'popup',
    id: `history-detail-${row.id}`,
    title,
    content: content || '暂无输出内容',
    icon,
    timestamp: row.started_at,
    taskId: row.task_id,
    taskName: row.task_name,
  })
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
      try {
        await historyApi.batchDelete(checkedRowKeys.value)
        message.success(`已删除 ${checkedRowKeys.value.length} 条记录`)
        checkedRowKeys.value = []
        await loadHistory()
        await loadStats()
      } catch (error) {
        message.error('批量删除失败')
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

const getStatusTag = (row: HistoryEntry) => {
  const map: Record<string, { label: string; color: string }> = {
    success: { label: '成功', color: '#18a058' },
    error: { label: '失败', color: '#d03050' },
    running: { label: '运行中', color: '#2080f0' },
  }
  const config = map[row.status] || { label: row.status, color: '#666' }
  return h('a', {
    style: `cursor: pointer; color: ${config.color}; text-decoration: none; font-weight: 500`,
    onClick: () => showStatusPopup(row)
  }, config.label)
}

const columns = [
  {
    type: 'selection',
    width: 50,
  },
  {
    title: '任务名称',
    key: 'task_name',
    width: 200,
    ellipsis: { tooltip: true },
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row: HistoryEntry) => getStatusTag(row),
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
    title: '输出/错误',
    key: 'output',
    ellipsis: { tooltip: true },
    render: (row: HistoryEntry) => {
      if (row.error_message) {
        return h('span', { style: 'color: #d03050' }, row.error_message.substring(0, 50) + '...')
      }
      return row.output ? row.output.substring(0, 50) + '...' : '-'
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 100,
    render: (row: HistoryEntry) => h('a', {
      style: 'cursor: pointer; color: #2080f0',
      onClick: () => showDetailPopup(row)
    }, '详情'),
  },
]

onMounted(() => {
  loadHistory()
  loadStats()
  loadServerLogs()
})
</script>
