<template>
  <Teleport to="body">
    <TransitionGroup name="popup-slide">
      <div
        v-for="popup in visiblePopups"
        :key="popup.id"
        class="popup-overlay"
        @click.self="dismiss(popup.id)"
      >
        <div class="popup-card">
          <div class="popup-header">
            <span class="popup-icon">{{ popup.icon }}</span>
            <h3 class="popup-title">{{ popup.title }}</h3>
            <button class="popup-close" @click="dismiss(popup.id)">✕</button>
          </div>
          <div class="popup-body">
            <pre>{{ popup.content }}</pre>
          </div>
          <div class="popup-footer">
            <button class="popup-btn primary" @click="dismiss(popup.id)">关闭</button>
          </div>
        </div>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { popupQueue } from '@/composables/useSSE'

const visiblePopups = computed(() => popupQueue.value)

const dismiss = (id: string) => {
  const index = popupQueue.value.findIndex(p => p.id === id)
  if (index > -1) {
    popupQueue.value.splice(index, 1)
  }
}
</script>

<style scoped>
.popup-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease-out;
}

.popup-card {
  background: #fff;
  border-radius: 16px;
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25), 0 8px 24px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.3s ease-out;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid #f0f0f0;
  position: relative;
}

.popup-icon {
  font-size: 32px;
  flex-shrink: 0;
}

.popup-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
  flex: 1;
}

.popup-close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #666;
  transition: all 0.15s;
  flex-shrink: 0;
}

.popup-close:hover {
  background: #f5f5f5;
  color: #333;
}

.popup-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  min-height: 100px;
  max-height: 50vh;
}

.popup-body pre {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.8;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
}

.popup-footer {
  padding: 16px 24px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: flex-end;
}

.popup-btn {
  padding: 10px 28px;
  border-radius: 8px;
  border: 1px solid #e0e0e0;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}

.popup-btn:hover {
  background: #f5f5f5;
}

.popup-btn.primary {
  background: #1890ff;
  color: #fff;
  border-color: #1890ff;
}

.popup-btn.primary:hover {
  background: #40a9ff;
  border-color: #40a9ff;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.popup-slide-enter-active {
  animation: fadeIn 0.2s ease-out;
}

.popup-slide-leave-active {
  animation: fadeOut 0.2s ease-in;
}

.popup-slide-enter-from {
  opacity: 0;
}

.popup-slide-leave-to {
  opacity: 0;
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}
</style>
