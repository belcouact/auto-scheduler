<template>
  <Teleport to="body">
    <TransitionGroup name="popup-slide">
      <div
        v-for="popup in visiblePopups"
        :key="popup.id"
        class="popup-overlay"
        @click.self="dismiss(popup.id)"
      >
        <div class="popup-card" role="dialog" aria-modal="true" :aria-label="popup.title">
          <div class="popup-header">
            <div class="popup-icon-wrap">
              <span class="popup-icon">{{ popup.icon }}</span>
            </div>
            <h3 class="popup-title">{{ popup.title }}</h3>
            <button class="popup-close" @click="dismiss(popup.id)" aria-label="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
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
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: fadeIn 0.2s ease-out;
}

.popup-card {
  background: var(--popup-color, #FFFFFF);
  border-radius: 20px;
  width: 850px;
  max-width: 90vw;
  max-height: 80vh;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25), 0 8px 24px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color, #E2E8F0);
  position: relative;
}

.popup-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 70px;
  height: 70px;
  border-radius: 14px;
  background: rgba(13, 148, 136, 0.1);
  flex-shrink: 0;
}

.popup-icon {
  font-size: 40px;
  line-height: 1;
}

.popup-title {
  margin: 0;
  font-size: 40px;
  font-weight: 700;
  color: var(--text-color-1, #1a1a1a);
  flex: 1;
}

.popup-close {
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-color-3, #94A3B8);
  transition: all 0.15s;
  flex-shrink: 0;
}

.popup-close:hover {
  background: var(--hover-color, rgba(15, 23, 42, 0.06));
  color: var(--text-color-1, #1a1a1a);
}

.popup-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  min-height: 80px;
  max-height: 50vh;
}

.popup-body pre {
  margin: 0;
  font-family: inherit;
  font-size: 32px;
  line-height: 1.8;
  color: var(--text-color-2, #475569);
  white-space: pre-wrap;
  word-break: break-word;
}

.popup-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color, #E2E8F0);
  display: flex;
  justify-content: flex-end;
}

.popup-btn {
  padding: 14px 36px;
  border-radius: 10px;
  border: 1px solid var(--border-color, #E2E8F0);
  background: transparent;
  cursor: pointer;
  font-size: 30px;
  font-weight: 600;
  font-family: inherit;
  transition: all 0.15s;
  color: var(--text-color-1, #1a1a1a);
}

.popup-btn:hover {
  background: var(--hover-color, rgba(15, 23, 42, 0.06));
}

.popup-btn.primary {
  background: #0D9488;
  color: #fff;
  border-color: #0D9488;
}

.popup-btn.primary:hover {
  background: #14B8A6;
  border-color: #14B8A6;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.96);
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
