import { ref } from 'vue'

export interface PopUpEvent {
  type: 'popup'
  id: string
  title: string
  content: string
  icon: string
  timestamp: string
  taskId: string
  taskName: string
}

export const popupQueue = ref<PopUpEvent[]>([])

let eventSource: EventSource | null = null

export function connectSSE() {
  if (eventSource) {
    eventSource.close()
  }

  eventSource = new EventSource('/api/events')

  eventSource.addEventListener('popup', (event) => {
    try {
      const popupEvent: PopUpEvent = JSON.parse(event.data)
      popupQueue.value.push(popupEvent)
    } catch (err) {
      console.error('Failed to parse popup event:', err)
    }
  })

  eventSource.onopen = () => {
    console.log('SSE connected')
  }

  eventSource.onerror = () => {
    console.error('SSE connection error, reconnecting...')
    setTimeout(connectSSE, 5000)
  }
}

export function disconnectSSE() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}
