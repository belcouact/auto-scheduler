<template>
  <n-layout has-sider style="height: 100vh">
    <n-layout-sider bordered :width="240" show-trigger collapse-mode="width" :collapsed-width="64" v-model:collapsed="collapsed">
      <div class="logo">
        <n-icon size="28" :component="CalendarIcon" />
        <span v-show="!collapsed">Auto Scheduler</span>
      </div>
      <n-menu
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
        :value="currentRoute"
        @update:value="handleMenuSelect"
      />
    </n-layout-sider>
    <n-layout>
      <n-layout-header bordered style="padding: 12px 24px; display: flex; justify-content: space-between; align-items: center">
        <h2 style="margin: 0">{{ currentPageTitle }}</h2>
        <n-space>
          <n-tag type="success" size="small">服务运行中</n-tag>
          <n-time :time="new Date()" type="datetime" />
        </n-space>
      </n-layout-header>
      <n-layout-content style="padding: 24px; background: #f5f5f5">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
  <PopupOverlay />
</template>

<script setup lang="ts">
import { computed, h, ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NLayout, NLayoutSider, NLayoutHeader, NLayoutContent, NIcon, NMenu, NTag, NTime, NSpace } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import PopupOverlay from '@/components/PopupOverlay.vue'
import { connectSSE, disconnectSSE } from '@/composables/useSSE'

const CalendarIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('rect', { x: '3', y: '4', width: '18', height: '18', rx: '2', ry: '2' }),
      h('line', { x1: '16', y1: '2', x2: '16', y2: '6' }),
      h('line', { x1: '8', y1: '2', x2: '8', y2: '6' }),
      h('line', { x1: '3', y1: '10', x2: '21', y2: '10' }),
    ])
  }
}

const TaskIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('path', { d: 'M9 11l3 3L22 4' }),
      h('path', { d: 'M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' }),
    ])
  }
}

const HistoryIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('polyline', { points: '12 6 12 12 16 14' }),
    ])
  }
}

const SettingsIcon = {
  render() {
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2' }, [
      h('circle', { cx: '12', cy: '12', r: '3' }),
      h('path', { d: 'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z' }),
    ])
  }
}

const router = useRouter()
const route = useRoute()
const collapsed = ref(false)

const currentRoute = computed(() => route.path)

const menuOptions: MenuOption[] = [
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
    label: '系统设置',
    key: '/settings',
    icon: () => h(NIcon, null, { default: () => h(SettingsIcon) }),
  },
]

const pageTitleMap: Record<string, string> = {
  '/tasks': '任务管理',
  '/tasks/new': '创建任务',
  '/history': '执行历史',
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

onMounted(() => {
  connectSSE()
})

onUnmounted(() => {
  disconnectSSE()
})
</script>

<style>
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  font-size: 18px;
  font-weight: bold;
  border-bottom: 1px solid #eee;
  min-height: 64px;
  overflow: hidden;
  white-space: nowrap;
}
</style>
