<template>
  <n-layout has-sider style="height: 100vh">
      <n-layout-sider
        bordered
        :width="240"
        show-trigger
        collapse-mode="width"
        :collapsed-width="64"
        v-model:collapsed="collapsed"
        class="app-sider"
      >
        <div class="logo">
          <div class="logo-icon">
            <n-icon size="24" :component="CalendarIcon" />
          </div>
          <Transition name="fade">
            <span v-show="!collapsed" class="logo-text">Auto Scheduler</span>
          </Transition>
        </div>
        <n-menu
          :collapsed-width="64"
          :collapsed-icon-size="22"
          :options="menuOptions"
          :value="currentRoute"
          @update:value="handleMenuSelect"
          :indent="18"
        />
      </n-layout-sider>
      <n-layout>
        <n-layout-header bordered class="top-header">
          <div class="header-left">
            <h2 class="page-title">{{ currentPageTitle }}</h2>
          </div>
          <div class="header-right">
            <n-tooltip trigger="hover">
              <template #trigger>
                <n-button
                  quaternary
                  circle
                  class="theme-toggle"
                  @click="themeStore.toggle()"
                >
                  <template #icon>
                    <n-icon :component="themeStore.isDark ? SunIcon : MoonIcon" />
                  </template>
                </n-button>
              </template>
              <span>{{ themeStore.isDark ? '切换浅色模式' : '切换深色模式' }}</span>
            </n-tooltip>
            <n-tag :type="serverTagType" size="small" round :bordered="false">
              <template #icon>
                <n-icon size="10" :component="status.server === 'online' ? OnlineIcon : OfflineIcon" />
              </template>
              {{ serverStatusLabel }}
            </n-tag>
            <n-tag size="small" type="info" round :bordered="false">
              计划 {{ status.scheduledTasks }}
            </n-tag>
            <n-divider vertical style="height: 20px" />
            <n-time :time="now" type="datetime" class="header-time" />
          </div>
        </n-layout-header>
        <n-layout-content class="app-content">
          <router-view />
        </n-layout-content>
      </n-layout>
    </n-layout>
  <PopupOverlay />
</template>

<script setup lang="ts">
import { computed, h, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutHeader, NLayoutContent,
  NIcon, NMenu, NTag, NTime, NDivider, NButton, NTooltip,
} from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import PopupOverlay from '@/components/PopupOverlay.vue'
import { connectSSE, disconnectSSE } from '@/composables/useSSE'
import { statusApi, type AppStatus } from '@/api'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()

const CalendarIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }),
      h('line', { x1: '16', y1: '2', x2: '16', y2: '6' }),
      h('line', { x1: '8', y1: '2', x2: '8', y2: '6' }),
      h('line', { x1: '3', y1: '10', x2: '21', y2: '10' }),
    ])
  }
}

const SunIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('circle', { cx: '12', cy: '12', r: '5' }),
      h('line', { x1: '12', y1: '1', x2: '12', y2: '3' }),
      h('line', { x1: '12', y1: '21', x2: '12', y2: '23' }),
      h('line', { x1: '4.22', y1: '4.22', x2: '5.64', y2: '5.64' }),
      h('line', { x1: '18.36', y1: '18.36', x2: '19.78', y2: '19.78' }),
      h('line', { x1: '1', y1: '12', x2: '3', y2: '12' }),
      h('line', { x1: '21', y1: '12', x2: '23', y2: '12' }),
      h('line', { x1: '4.22', y1: '19.78', x2: '5.64', y2: '18.36' }),
      h('line', { x1: '18.36', y1: '5.64', x2: '19.78', y2: '4.22' }),
    ])
  }
}

const MoonIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('path', { d: 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z' }),
    ])
  }
}

const OnlineIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'currentColor' }, [
      h('circle', { cx: '12', cy: '12', r: '6' }),
    ])
  }
}

const OfflineIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'currentColor' }, [
      h('circle', { cx: '12', cy: '12', r: '6' }),
    ])
  }
}

const DashboardIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('rect', { x: '3', y: '3', width: '7', height: '9', rx: '1' }),
      h('rect', { x: '14', y: '3', width: '7', height: '5', rx: '1' }),
      h('rect', { x: '14', y: '12', width: '7', height: '9', rx: '1' }),
      h('rect', { x: '3', y: '15', width: '7', height: '6', rx: '1' }),
    ])
  }
}

const TaskIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('path', { d: 'M9 11l3 3L22 4' }),
      h('path', { d: 'M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' }),
    ])
  }
}

const HistoryIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('polyline', { points: '12 6 12 12 16 14' }),
    ])
  }
}

const AIIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('path', { d: 'M12 3l1.8 4.7L18.5 9l-4.7 1.3L12 15l-1.8-4.7L5.5 9l4.7-1.3L12 3z' }),
      h('path', { d: 'M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z' }),
    ])
  }
}

const SettingsIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      h('circle', { cx: '12', cy: '12', r: '3' }),
      h('path', { d: 'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z' }),
    ])
  }
}

const router = useRouter()
const route = useRoute()
const collapsed = ref(false)
const now = ref(new Date())
const status = ref<AppStatus>({
  server: 'offline',
  timestamp: '',
  clients: 0,
  scheduledTasks: 0,
  totalTasks: 0,
  enabledTasks: 0,
  failedTasks: 0,
})

let clockTimer: number | null = null
let statusTimer: number | null = null

const currentRoute = computed(() => route.path)
const serverStatusLabel = computed(() => status.value.server === 'online' ? '在线' : '离线')
const serverTagType = computed(() => status.value.server === 'online' ? 'success' : 'error')

const menuOptions: MenuOption[] = [
  {
    label: '概览',
    key: '/dashboard',
    icon: () => h(NIcon, null, { default: () => h(DashboardIcon) }),
  },
  {
    label: '任务管理',
    key: '/tasks',
    icon: () => h(NIcon, null, { default: () => h(TaskIcon) }),
  },
  {
    label: '执行历史',
    key: '/history',
    icon: () => h(NIcon, null, { default: () => h(HistoryIcon) }),
  },
  {
    label: 'AI 助手',
    key: '/ai',
    icon: () => h(NIcon, null, { default: () => h(AIIcon) }),
  },
  {
    label: '系统设置',
    key: '/settings',
    icon: () => h(NIcon, null, { default: () => h(SettingsIcon) }),
  },
]

const pageTitleMap: Record<string, string> = {
  '/dashboard': '概览',
  '/tasks': '任务管理',
  '/tasks/new': '创建任务',
  '/history': '执行历史',
  '/ai': 'AI 助手',
  '/settings': '系统设置',
}

const currentPageTitle = computed(() => {
  const path = route.path
  if (path.includes('/tasks/') && path.includes('/edit')) {
    return '编辑任务'
  }
  return pageTitleMap[path] || '任务管理'
})

const handleMenuSelect = (key: string) => {
  router.push(key)
}

const loadStatus = async () => {
  try {
    const result = await statusApi.get()
    status.value = result.data
  } catch (error) {
    status.value = {
      ...status.value,
      server: 'offline',
      timestamp: new Date().toISOString(),
    }
  }
}

onMounted(() => {
  connectSSE()
  loadStatus()
  clockTimer = window.setInterval(() => {
    now.value = new Date()
  }, 1000)
  statusTimer = window.setInterval(loadStatus, 15000)
})

onUnmounted(() => {
  disconnectSSE()
  if (clockTimer) window.clearInterval(clockTimer)
  if (statusTimer) window.clearInterval(statusTimer)
})
</script>

<style>
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  height: 60px;
  overflow: hidden;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color, #E2E8F0);
}

.logo-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0D9488, #14B8A6);
  color: #fff;
  flex-shrink: 0;
}

.logo-text {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #0D9488, #14B8A6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.app-sider {
  transition: all 0.2s ease;
}

.app-content {
  padding: 24px;
  min-height: calc(100vh - 60px);
}

.top-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 24px;
  height: 60px;
  background: var(--card-color, #FFFFFF);
  border-bottom: 1px solid var(--border-color, #E2E8F0);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.header-time {
  font-size: 13px;
  color: var(--text-color-3, #8BA8A3);
  white-space: nowrap;
}

.theme-toggle {
  transition: transform 0.2s ease;
}

.theme-toggle:hover {
  transform: rotate(15deg);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-color, #E2E8F0) transparent;
}

*::-webkit-scrollbar {
  width: 6px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background-color: var(--border-color, #E2E8F0);
  border-radius: 3px;
}
</style>
