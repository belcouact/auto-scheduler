<template>
  <div class="dashboard">
    <section class="hero-card">
      <div>
        <div class="eyebrow">Control Center</div>
        <h1>Automation at a glance</h1>
        <p>
          Track scheduler health, spot failures early, and jump into the next action without
          digging through tables.
        </p>
      </div>
      <n-space>
        <n-button type="primary" size="large" @click="router.push('/tasks/new')">Create Task</n-button>
      </n-space>
    </section>

    <n-grid :cols="24" :x-gap="16" :y-gap="16">
      <n-gi :span="6">
        <div class="metric-card metric-indigo">
          <span class="metric-label">Total Tasks</span>
          <strong>{{ status.totalTasks }}</strong>
          <small>{{ status.enabledTasks }} enabled</small>
        </div>
      </n-gi>
      <n-gi :span="6">
        <div class="metric-card metric-teal">
          <span class="metric-label">Scheduled</span>
          <strong>{{ status.scheduledTasks }}</strong>
          <small>Live in memory</small>
        </div>
      </n-gi>
      <n-gi :span="6">
        <div class="metric-card metric-amber">
          <span class="metric-label">Success Rate</span>
          <strong>{{ successRate }}</strong>
          <small>{{ historyStats.total_executions || 0 }} executions</small>
        </div>
      </n-gi>
      <n-gi :span="6">
        <div class="metric-card metric-rose">
          <span class="metric-label">Needs Attention</span>
          <strong>{{ status.failedTasks }}</strong>
          <small>Last status failed</small>
        </div>
      </n-gi>

      <n-gi :span="16">
        <n-card title="Upcoming Runs" :bordered="false" class="panel-card">
          <template #header-extra>
            <n-button text @click="refreshAll" :loading="loading">Refresh</n-button>
          </template>
          <div v-if="upcomingTasks.length === 0" class="empty-state">No scheduled runs yet.</div>
          <div v-else class="list-stack">
            <div v-for="task in upcomingTasks" :key="task.id" class="list-row">
              <div>
                <div class="row-title">{{ task.name }}</div>
                <div class="row-meta">
                  <n-tag size="small" round :bordered="false">{{ typeLabel(task.type) }}</n-tag>
                  <span>{{ scheduleLabel(task) }}</span>
                </div>
              </div>
              <div class="row-side">
                <span>{{ formatDateTime(task.next_run_at) }}</span>
                <n-button text type="primary" @click="router.push(`/tasks/${task.id}/edit`)">Edit</n-button>
              </div>
            </div>
          </div>
        </n-card>
      </n-gi>

      <n-gi :span="8">
        <n-card title="Runtime Status" :bordered="false" class="panel-card">
          <div class="status-stack">
            <div class="status-item">
              <span>Server</span>
              <n-tag :type="serverTagType" round :bordered="false">{{ serverLabel }}</n-tag>
            </div>
            <div class="status-item">
              <span>SSE Clients</span>
              <strong>{{ status.clients }}</strong>
            </div>
            <div class="status-item">
              <span>Last Check</span>
              <strong>{{ formatDateTime(status.timestamp) }}</strong>
            </div>
          </div>
        </n-card>
      </n-gi>

      <n-gi :span="12">
        <n-card title="Recent Failures" :bordered="false" class="panel-card">
          <div v-if="recentFailures.length === 0" class="empty-state">No recent failures.</div>
          <div v-else class="list-stack">
            <div v-for="item in recentFailures" :key="item.id" class="list-row">
              <div>
                <div class="row-title">{{ item.task_name }}</div>
                <div class="row-meta">
                  <span>{{ formatDateTime(item.started_at) }}</span>
                </div>
              </div>
              <div class="row-side row-error">
                <span>{{ truncate(item.error_message || item.output || 'Execution failed') }}</span>
                <n-button text type="primary" @click="router.push('/history')">Open History</n-button>
              </div>
            </div>
          </div>
        </n-card>
      </n-gi>

      <n-gi :span="12">
        <n-card title="Most Active Tasks" :bordered="false" class="panel-card">
          <div v-if="topTasks.length === 0" class="empty-state">No execution activity yet.</div>
          <div v-else class="list-stack">
            <div v-for="task in topTasks" :key="task.task_id" class="list-row">
              <div>
                <div class="row-title">{{ task.name }}</div>
                <div class="row-meta">
                  <span>{{ task.success_count }} successful runs</span>
                </div>
              </div>
              <div class="row-side">
                <strong>{{ task.execution_count }}</strong>
                <span>runs</span>
              </div>
            </div>
          </div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NGi, NGrid, NSpace, NTag, useMessage } from 'naive-ui'
import { historyApi, statusApi, taskApi, type AppStatus, type HistoryEntry, type Task } from '@/api'

const router = useRouter()
const message = useMessage()

const loading = ref(false)
const tasks = ref<Task[]>([])
const recentFailures = ref<HistoryEntry[]>([])
const historyStats = ref<Record<string, number>>({})
const topTasks = ref<Array<{ task_id: string; name: string; execution_count: number; success_count: number }>>([])
const status = ref<AppStatus>({
  server: 'offline',
  timestamp: '',
  clients: 0,
  scheduledTasks: 0,
  totalTasks: 0,
  enabledTasks: 0,
  failedTasks: 0,
})

const upcomingTasks = computed(() =>
  [...tasks.value]
    .filter((task) => task.enabled && task.next_run_at)
    .sort((a, b) => new Date(a.next_run_at || 0).getTime() - new Date(b.next_run_at || 0).getTime())
    .slice(0, 6)
)

const successRate = computed(() => {
  const total = Number(historyStats.value.total_executions || 0)
  const success = Number(historyStats.value.success_count || 0)
  if (!total) return '0%'
  return `${Math.round((success / total) * 100)}%`
})

const serverLabel = computed(() => (status.value.server === 'online' ? 'Online' : 'Offline'))
const serverTagType = computed(() => (status.value.server === 'online' ? 'success' : 'error'))

const refreshAll = async () => {
  loading.value = true
  try {
    const [taskResult, statsResult, historyResult, statusResult] = await Promise.all([
      taskApi.list(),
      historyApi.stats(),
      historyApi.list({ status: 'error', limit: 5 }),
      statusApi.get(),
    ])

    tasks.value = taskResult.data
    recentFailures.value = historyResult.data
    historyStats.value = statsResult.data.stats
    topTasks.value = statsResult.data.topTasks || []
    status.value = statusResult.data
  } catch (error) {
    message.error('Failed to load dashboard data')
  } finally {
    loading.value = false
  }
}

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

const typeLabel = (type: Task['type']) => {
  const labels: Record<Task['type'], string> = {
    script: 'Script',
    popup: 'Popup',
    webhook: 'Webhook',
    system: 'System',
    ai_search: 'AI Search',
  }
  return labels[type]
}

const scheduleLabel = (task: Task) => {
  const labels: Record<Task['schedule_type'], string> = {
    once: 'One time',
    cron: 'Custom cron',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    hourly: 'Hourly',
  }
  return `${labels[task.schedule_type]}${task.schedule_expression ? ` · ${task.schedule_expression}` : ''}`
}

const truncate = (text: string, max = 72) => (text.length > max ? `${text.slice(0, max)}...` : text)

onMounted(refreshAll)
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero-card {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
  padding: 28px 30px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top left, rgba(99, 102, 241, 0.22), transparent 34%),
    radial-gradient(circle at bottom right, rgba(45, 212, 191, 0.24), transparent 30%),
    linear-gradient(135deg, #0f172a, #111827 55%, #1f2937);
  color: #f8fafc;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22);
}

.hero-card h1 {
  margin: 6px 0 10px;
  font-size: 32px;
  line-height: 1.1;
}

.hero-card p {
  margin: 0;
  max-width: 620px;
  color: rgba(248, 250, 252, 0.78);
}

.eyebrow {
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 12px;
  color: rgba(248, 250, 252, 0.72);
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 144px;
  padding: 22px;
  border-radius: 22px;
  color: #0f172a;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
}

.metric-card strong {
  font-size: 34px;
  line-height: 1;
}

.metric-card small,
.metric-label {
  color: rgba(15, 23, 42, 0.7);
}

.metric-indigo {
  background: linear-gradient(180deg, #eef2ff, #e0e7ff);
}

.metric-teal {
  background: linear-gradient(180deg, #ecfeff, #ccfbf1);
}

.metric-amber {
  background: linear-gradient(180deg, #fffbeb, #fef3c7);
}

.metric-rose {
  background: linear-gradient(180deg, #fff1f2, #ffe4e6);
}

.panel-card {
  border-radius: 22px;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.06);
}

.list-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.list-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 18px;
  background: #f8fafc;
}

.row-title {
  font-weight: 700;
  color: #111827;
}

.row-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
  color: #64748b;
  flex-wrap: wrap;
}

.row-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  color: #475569;
  text-align: right;
}

.row-error {
  max-width: 320px;
}

.status-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid #eef2f7;
}

.status-item:last-child {
  border-bottom: none;
}

.empty-state {
  padding: 24px 8px;
  color: #64748b;
}
</style>
