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
          <div class="metric-icon">
            <n-icon size="22"><ListIcon /></n-icon>
          </div>
          <div class="metric-body">
            <span class="metric-label">Total Tasks</span>
            <strong>{{ status.totalTasks }}</strong>
            <small>{{ status.enabledTasks }} enabled</small>
          </div>
        </div>
      </n-gi>
      <n-gi :span="6">
        <div class="metric-card metric-teal">
          <div class="metric-icon">
            <n-icon size="22"><ClockIcon /></n-icon>
          </div>
          <div class="metric-body">
            <span class="metric-label">Scheduled</span>
            <strong>{{ status.scheduledTasks }}</strong>
            <small>Live in memory</small>
          </div>
        </div>
      </n-gi>
      <n-gi :span="6">
        <div class="metric-card metric-amber">
          <div class="metric-icon">
            <n-icon size="22"><TrendingIcon /></n-icon>
          </div>
          <div class="metric-body">
            <span class="metric-label">Success Rate</span>
            <strong>{{ successRate }}</strong>
            <small>{{ historyStats.total_executions || 0 }} executions</small>
          </div>
        </div>
      </n-gi>
      <n-gi :span="6">
        <div class="metric-card metric-rose">
          <div class="metric-icon">
            <n-icon size="22"><AlertIcon /></n-icon>
          </div>
          <div class="metric-body">
            <span class="metric-label">Needs Attention</span>
            <strong>{{ status.failedTasks }}</strong>
            <small>Last status failed</small>
          </div>
        </div>
      </n-gi>

      <n-gi :span="16">
        <n-card title="Upcoming Runs" :bordered="false" class="panel-card">
          <template #header-extra>
            <n-button text @click="refreshAll" :loading="loading">
              <template #icon><n-icon><RefreshIcon /></n-icon></template>
              Refresh
            </n-button>
          </template>
          <div v-if="upcomingTasks.length === 0" class="empty-state">
            <n-icon size="48" color="#CBD5E1"><CalendarBlankIcon /></n-icon>
            <p>No scheduled runs yet.</p>
          </div>
          <div v-else class="list-stack">
            <div v-for="task in upcomingTasks" :key="task.id" class="list-row">
              <div class="list-row-start">
                <div class="task-type-dot" :class="`dot-${task.type}`" />
                <div>
                  <div class="row-title">{{ task.name }}</div>
                  <div class="row-meta">
                    <n-tag size="small" round :bordered="false">{{ typeLabel(task.type) }}</n-tag>
                    <span>{{ scheduleLabel(task) }}</span>
                  </div>
                </div>
              </div>
              <div class="row-side">
                <span class="row-time">{{ formatDateTime(task.next_run_at) }}</span>
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
              <div class="status-item-left">
                <div class="status-dot" :class="status.server === 'online' ? 'dot-online' : 'dot-offline'" />
                <span>Server</span>
              </div>
              <n-tag :type="serverTagType" round :bordered="false">{{ serverLabel }}</n-tag>
            </div>
            <div class="status-item">
              <div class="status-item-left">
                <n-icon size="16" color="#64748B"><UsersIcon /></n-icon>
                <span>SSE Clients</span>
              </div>
              <strong>{{ status.clients }}</strong>
            </div>
            <div class="status-item">
              <div class="status-item-left">
                <n-icon size="16" color="#64748B"><ClockIcon /></n-icon>
                <span>Last Check</span>
              </div>
              <strong class="status-time">{{ formatDateTime(status.timestamp) }}</strong>
            </div>
          </div>
        </n-card>
      </n-gi>

      <n-gi :span="12">
        <n-card title="Recent Failures" :bordered="false" class="panel-card">
          <template #header-extra>
            <n-button text @click="router.push('/history')">View All</n-button>
          </template>
          <div v-if="recentFailures.length === 0" class="empty-state">
            <n-icon size="48" color="#CBD5E1"><CheckCircleIcon /></n-icon>
            <p>No recent failures.</p>
          </div>
          <div v-else class="list-stack">
            <div v-for="item in recentFailures" :key="item.id" class="list-row list-row-error">
              <div class="list-row-start">
                <div class="error-icon">
                  <n-icon size="18" color="#EF4444"><AlertCircleIcon /></n-icon>
                </div>
                <div>
                  <div class="row-title">{{ item.task_name }}</div>
                  <div class="row-meta">
                    <span>{{ formatDateTime(item.started_at) }}</span>
                  </div>
                </div>
              </div>
              <div class="row-side">
                <span class="error-preview">{{ truncate(item.error_message || item.output || 'Execution failed') }}</span>
              </div>
            </div>
          </div>
        </n-card>
      </n-gi>

      <n-gi :span="12">
        <n-card title="Most Active Tasks" :bordered="false" class="panel-card">
          <div v-if="topTasks.length === 0" class="empty-state">
            <n-icon size="48" color="#CBD5E1"><ActivityIcon /></n-icon>
            <p>No execution activity yet.</p>
          </div>
          <div v-else class="list-stack">
            <div v-for="task in topTasks" :key="task.task_id" class="list-row">
              <div class="list-row-start">
                <div class="active-rank">{{ topTasks.indexOf(task) + 1 }}</div>
                <div>
                  <div class="row-title">{{ task.name }}</div>
                  <div class="row-meta">
                    <span>{{ task.success_count }} successful runs</span>
                  </div>
                </div>
              </div>
              <div class="row-side">
                <div class="run-count">
                  <strong>{{ task.execution_count }}</strong>
                  <small>runs</small>
                </div>
              </div>
            </div>
          </div>
        </n-card>
      </n-gi>
    </n-grid>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NCard, NGi, NGrid, NIcon, NSpace, NTag, useMessage } from 'naive-ui'
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

const ListIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('line', { x1: '8', y1: '6', x2: '21', y2: '6' }), h('line', { x1: '8', y1: '12', x2: '21', y2: '12' }), h('line', { x1: '8', y1: '18', x2: '21', y2: '18' }), h('line', { x1: '3', y1: '6', x2: '3.01', y2: '6' }), h('line', { x1: '3', y1: '12', x2: '3.01', y2: '12' }), h('line', { x1: '3', y1: '18', x2: '3.01', y2: '18' })]) } }
const ClockIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('circle', { cx: '12', cy: '12', r: '10' }), h('polyline', { points: '12 6 12 12 16 14' })]) } }
const TrendingIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('polyline', { points: '23 6 13.5 15.5 8.5 10.5 1 18' }), h('polyline', { points: '17 6 23 6 23 12' })]) } }
const AlertIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('path', { d: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' }), h('line', { x1: '12', y1: '9', x2: '12', y2: '13' }), h('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' })]) } }
const RefreshIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('polyline', { points: '23 4 23 10 17 10' }), h('polyline', { points: '1 20 1 14 7 14' }), h('path', { d: 'M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15' })]) } }
const CalendarBlankIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }), h('line', { x1: '16', y1: '2', x2: '16', y2: '6' }), h('line', { x1: '8', y1: '2', x2: '8', y2: '6' })]) } }
const CheckCircleIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('path', { d: 'M22 11.08V12a10 10 0 11-5.93-9.14' }), h('polyline', { points: '22 4 12 14.01 9 11.01' })]) } }
const AlertCircleIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('circle', { cx: '12', cy: '12', r: '10' }), h('line', { x1: '12', y1: '8', x2: '12', y2: '12' }), h('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' })]) } }
const ActivityIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })]) } }
const UsersIcon = { render() { return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [h('path', { d: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2' }), h('circle', { cx: '9', cy: '7', r: '4' }), h('path', { d: 'M23 21v-2a4 4 0 00-3-3.87' }), h('path', { d: 'M16 3.13a4 4 0 010 7.75' })]) } }

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
  gap: 16px;
  min-height: 130px;
  padding: 22px;
  border-radius: 22px;
  color: #0f172a;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.metric-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 24px 56px rgba(15, 23, 42, 0.14);
}

.metric-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  flex-shrink: 0;
  background: rgba(15, 23, 42, 0.06);
}

.metric-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-body strong {
  font-size: 34px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.metric-body small,
.metric-label {
  color: rgba(15, 23, 42, 0.65);
  font-size: 13px;
}

.metric-label {
  font-weight: 600;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  transition: box-shadow 0.2s ease;
}

.panel-card:hover {
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.10);
}

.list-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 16px;
  transition: background 0.15s ease;
  cursor: default;
}

.list-row:hover {
  background: var(--hover-color, rgba(15, 23, 42, 0.03));
}

.list-row-error {
  align-items: flex-start;
}

.list-row-start {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.task-type-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-script { background: #6366F1; }
.dot-popup { background: #F59E0B; }
.dot-webhook { background: #0EA5E9; }
.dot-system { background: #8B5CF6; }
.dot-ai_search { background: #10B981; }

.error-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.1);
  flex-shrink: 0;
}

.active-rank {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: rgba(13, 148, 136, 0.1);
  color: #0D9488;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.row-title {
  font-weight: 600;
  font-size: 14px;
}

.row-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-color-3, #64748B);
  flex-wrap: wrap;
}

.row-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  text-align: right;
  flex-shrink: 0;
}

.row-time {
  font-size: 12px;
  color: var(--text-color-3, #64748B);
  white-space: nowrap;
}

.error-preview {
  font-size: 12px;
  color: #EF4444;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-count {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.run-count strong {
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.run-count small {
  font-size: 12px;
  color: var(--text-color-3, #64748B);
}

.status-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-color, #E2E8F0);
}

.status-item:last-child {
  border-bottom: none;
}

.status-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--text-color-2, #475569);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dot-online {
  background: #10B981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
}

.dot-offline {
  background: #EF4444;
}

.status-time {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color-2, #475569);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 8px;
  color: var(--text-color-3, #64748B);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}
</style>
