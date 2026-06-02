import axios from 'axios'

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.message || error.message || '请求失败'
    console.error('API Error:', message)
    return Promise.reject(error)
  }
)

export default apiClient

export interface Task {
  id: string
  name: string
  description: string
  type: 'script' | 'popup' | 'webhook' | 'system' | 'ai_search'
  enabled: boolean
  schedule_type: 'once' | 'cron' | 'daily' | 'weekly' | 'monthly' | 'hourly'
  schedule_expression: string
  script_path: string | null
  script_args: string | null
  popup_title: string | null
  popup_content: string | null
  popup_icon: string | null
  popup_position: 'center' | 'bottom-right' | null
  popup_auto_dismiss: number | null
  webhook_url: string | null
  webhook_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  webhook_headers: Record<string, string> | null
  webhook_body: string | null
  system_action: 'shutdown' | 'lock' | 'hibernate' | null
  ai_search_query: string | null
  ai_search_count: number | null
  ai_enable_web_search: boolean | null
  popup_mode: 'fixed' | 'ai' | null
  priority: number
  tags: string[]
  created_at: string
  updated_at: string
  last_run_at: string | null
  last_run_status: string | null
  next_run_at: string | null
  retry_count: number
  max_retries: number
  timeout_seconds: number
}

export interface HistoryEntry {
  id: string
  task_id: string
  task_name: string
  status: 'success' | 'error' | 'running'
  output: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
  duration_ms: number | null
}

export interface AppStatus {
  server: 'online' | 'offline'
  timestamp: string
  clients: number
  scheduledTasks: number
  totalTasks: number
  enabledTasks: number
  failedTasks: number
}

export const taskApi = {
  list: (params?: { enabled?: boolean; type?: string; search?: string }) =>
    apiClient.get<{ data: Task[] }>('/tasks', { params }).then(r => r.data),

  get: (id: string) =>
    apiClient.get<{ data: Task }>(`/tasks/${id}`).then(r => r.data),

  create: (data: Partial<Task>) =>
    apiClient.post<{ data: Task }>('/tasks', data).then(r => r.data),

  update: (id: string, data: Partial<Task>) =>
    apiClient.put<{ data: Task }>(`/tasks/${id}`, data).then(r => r.data),

  delete: (id: string) =>
    apiClient.delete<{ message: string }>(`/tasks/${id}`).then(r => r.data),

  execute: (id: string) =>
    apiClient.post<{ message: string }>(`/tasks/execute/${id}`).then(r => r.data),

  duplicate: (id: string) =>
    apiClient.post<{ data: Task; message: string }>(`/tasks/duplicate/${id}`).then(r => r.data),

  batchSetEnabled: (ids: string[], enabled: boolean) =>
    apiClient.patch<{ message: string; data: { ids: string[]; enabled: boolean } }>('/tasks/batch/enabled', { ids, enabled }).then(r => r.data),

  batchDelete: (ids: string[]) =>
    apiClient.delete<{ message: string }>('/tasks/batch', { data: { ids } }).then(r => r.data),
}

export const historyApi = {
  list: (params?: { task_id?: string; status?: string; limit?: number; offset?: number }) =>
    apiClient.get<{ data: HistoryEntry[]; pagination: any }>('/history', { params }).then(r => r.data),

  stats: () =>
    apiClient.get<{ data: any }>('/history/stats').then(r => r.data),

  clear: (older_than_days?: number) =>
    apiClient.delete<{ message: string }>('/history/clear', { data: { older_than_days } }).then(r => r.data),

  batchDelete: (ids: string[]) =>
    apiClient.delete<{ message: string }>('/history/batch', { data: { ids } }).then(r => r.data),
}

export const aiApi = {
  chat: (messages: Array<{ role: string; content: string }>, model?: string) =>
    apiClient.post<{ data: { role: string; content: string } }>('/ai/chat', { messages, model }).then(r => r.data.data),

  chatStream: (
    messages: Array<{ role: string; content: string }>,
    onChunk: (delta: string, fullContent: string) => void,
    model?: string,
    enableWebSearch?: boolean
  ): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await fetch('/api/ai/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, model, enable_web_search: enableWebSearch }),
        });

        if (!response.ok) {
          const text = await response.text();
          reject(new Error(`Stream error: ${response.status} - ${text}`));
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              if (data.error) {
                reject(new Error(data.error));
                return;
              }
              if (data.done) {
                resolve(data.fullContent || fullContent);
                return;
              }
              if (data.content) {
                fullContent += data.content;
                onChunk(data.content, fullContent);
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
        resolve(fullContent);
      } catch (error) {
        reject(error);
      }
    });
  },

  suggestTasks: (context: string) =>
    apiClient.post<{ data: { role: string; content: string } }>('/ai/suggest-tasks', { context }).then(r => r.data.data),

  createTask: (description: string) =>
    apiClient.post<{ data: Task }>('/ai/create-task', { description }).then(r => r.data),
}

export const settingsApi = {
  get: () =>
    apiClient.get<{ data: Record<string, string> }>('/settings').then(r => r.data),

  update: (settings: Record<string, string>) =>
    apiClient.put<{ message: string }>('/settings', { settings }).then(r => r.data),

  getLogs: (lines?: number) =>
    apiClient.get<{ data: any[] }>('/settings/logs', { params: { lines } }).then(r => r.data),
}

export const statusApi = {
  get: () =>
    apiClient.get<{ data: AppStatus }>('/status').then(r => r.data),
}
