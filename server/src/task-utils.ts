import { TaskRow } from './database.js';

export function serializeTags(tags: unknown): string {
  if (!Array.isArray(tags)) {
    return '';
  }

  return tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .join(',');
}

export function parseStoredTags(tags: string | null): string[] {
  if (!tags) {
    return [];
  }

  const trimmed = tags.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => String(tag).trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function formatTask(task: TaskRow) {
  return {
    ...task,
    enabled: Boolean(task.enabled),
    ai_enable_web_search: Boolean(task.ai_enable_web_search),
    tags: parseStoredTags(task.tags),
    webhook_headers: task.webhook_headers ? JSON.parse(task.webhook_headers) : null,
  };
}
