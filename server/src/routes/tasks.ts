import { Router, Request, Response, NextFunction } from 'express';
function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
import { DatabaseService, TaskRow } from '../database.js';
import { SchedulerService } from '../scheduler.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { z } from 'zod';
import { formatTask, serializeTags } from '../task-utils.js';
import { parseLocalDateTime } from '../schedule-utils.js';
import cron from 'node-cron';

const createTaskSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(''),
  type: z.enum(['script', 'popup', 'webhook', 'system', 'ai_search']),
  enabled: z.boolean().default(true),
  schedule_type: z.enum(['once', 'cron', 'daily', 'weekly', 'monthly', 'hourly']),
  schedule_expression: z.string().min(1),
  script_path: z.string().nullable().optional(),
  script_args: z.string().nullable().optional(),
  popup_title: z.string().nullable().optional(),
  popup_content: z.string().nullable().optional(),
  popup_icon: z.string().nullable().optional(),
  webhook_url: z.string().url().nullable().optional(),
  webhook_method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  webhook_headers: z.record(z.string()).nullable().optional(),
  webhook_body: z.string().nullable().optional(),
  system_action: z.enum(['shutdown', 'lock', 'hibernate']).nullable().optional(),
  ai_search_query: z.string().nullable().optional(),
  ai_search_count: z.number().int().min(1).max(20).default(10).optional(),
  priority: z.number().int().min(0).max(10).default(0),
  tags: z.array(z.string()).default([]),
  max_retries: z.number().int().min(0).max(10).default(3),
  timeout_seconds: z.number().int().min(10).max(3600).default(300),
});

const updateTaskSchema = createTaskSchema.partial();
const batchUpdateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  enabled: z.boolean(),
});

const batchDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export function taskRouter(db: DatabaseService, scheduler: SchedulerService) {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { enabled, type, search } = req.query;

      let query = 'SELECT * FROM tasks';
      const conditions: string[] = [];
      const params: any[] = [];

      if (enabled !== undefined) {
        conditions.push('enabled = ?');
        params.push(enabled === 'true' ? 1 : 0);
      }

      if (type) {
        conditions.push('type = ?');
        params.push(type);
      }

      if (search) {
        conditions.push('(name LIKE ? OR description LIKE ? OR tags LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY priority DESC, created_at DESC';

      const tasks = db.queryAll(query, params) as TaskRow[];

      res.json({
        data: tasks.map(formatTask),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = getTaskById(db, req.params.id);
      res.json({ data: formatTask(task) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = createTaskSchema.parse(req.body);
      validateTaskSemantics(validated);
      const id = generateShortId();
      const now = new Date().toISOString();

      const tags = serializeTags(validated.tags);

      db.run(`
        INSERT INTO tasks (
          id, name, description, type, enabled, schedule_type, schedule_expression,
          script_path, script_args, popup_title, popup_content, popup_icon,
          webhook_url, webhook_method, webhook_headers, webhook_body,
          system_action, ai_search_query, ai_search_count, priority, tags, created_at, updated_at,
          max_retries, timeout_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        validated.name,
        validated.description,
        validated.type,
        validated.enabled ? 1 : 0,
        validated.schedule_type,
        validated.schedule_expression,
        validated.script_path || null,
        validated.script_args || null,
        validated.popup_title || null,
        validated.popup_content || null,
        validated.popup_icon || null,
        validated.webhook_url || null,
        validated.webhook_method,
        validated.webhook_headers ? JSON.stringify(validated.webhook_headers) : null,
        validated.webhook_body || null,
        validated.system_action || null,
        validated.ai_search_query || null,
        validated.ai_search_count || 10,
        validated.priority,
        tags,
        now,
        now,
        validated.max_retries,
        validated.timeout_seconds,
      ]);

      const task = getTaskById(db, id);
      if (validated.enabled) {
        await scheduler.rescheduleAll();
      }

      res.status(201).json({ data: formatTask(task) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid task data', { errors: error.errors }));
      } else {
        next(error);
      }
    }
  });

  router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      getTaskById(db, req.params.id);
      const validated = updateTaskSchema.parse(req.body);
      validateTaskSemantics(validated);
      const now = new Date().toISOString();

      const fields: string[] = [];
      const params: any[] = [];

      for (const [key, value] of Object.entries(validated)) {
        if (value !== undefined) {
          if (key === 'tags' && Array.isArray(value)) {
            fields.push('tags = ?');
            params.push(serializeTags(value));
          } else if (key === 'webhook_headers' && typeof value === 'object') {
            fields.push('webhook_headers = ?');
            params.push(JSON.stringify(value));
          } else if (key === 'enabled') {
            fields.push('enabled = ?');
            params.push(value ? 1 : 0);
          } else {
            fields.push(`${key} = ?`);
            params.push(value);
          }
        }
      }

      fields.push('updated_at = ?');
      params.push(now);
      params.push(req.params.id);

      db.run(`
        UPDATE tasks SET ${fields.join(', ')} WHERE id = ?
      `, params);

      await scheduler.rescheduleAll();

      const task = getTaskById(db, req.params.id);
      res.json({ data: formatTask(task) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid task data', { errors: error.errors }));
      } else {
        next(error);
      }
    }
  });

  router.post('/duplicate/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sourceTask = getTaskById(db, req.params.id);
      const id = generateShortId();
      const now = new Date().toISOString();
      const duplicateName = buildDuplicateName(db, sourceTask.name);

      db.run(`
        INSERT INTO tasks (
          id, name, description, type, enabled, schedule_type, schedule_expression,
          script_path, script_args, popup_title, popup_content, popup_icon,
          webhook_url, webhook_method, webhook_headers, webhook_body,
          system_action, ai_search_query, ai_search_count, priority, tags, created_at, updated_at,
          last_run_at, last_run_status, next_run_at, retry_count, max_retries, timeout_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        duplicateName,
        sourceTask.description,
        sourceTask.type,
        0,
        sourceTask.schedule_type,
        sourceTask.schedule_expression,
        sourceTask.script_path,
        sourceTask.script_args,
        sourceTask.popup_title,
        sourceTask.popup_content,
        sourceTask.popup_icon,
        sourceTask.webhook_url,
        sourceTask.webhook_method,
        sourceTask.webhook_headers,
        sourceTask.webhook_body,
        sourceTask.system_action,
        sourceTask.ai_search_query,
        sourceTask.ai_search_count,
        sourceTask.priority,
        sourceTask.tags,
        now,
        now,
        null,
        null,
        null,
        0,
        sourceTask.max_retries,
        sourceTask.timeout_seconds,
      ]);

      const created = getTaskById(db, id);
      res.status(201).json({
        data: formatTask(created),
        message: 'Task duplicated successfully',
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/batch/enabled', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, enabled } = batchUpdateSchema.parse(req.body);
      const placeholders = ids.map(() => '?').join(',');

      db.run(
        `UPDATE tasks SET enabled = ?, updated_at = ?, retry_count = 0, next_run_at = NULL WHERE id IN (${placeholders})`,
        [enabled ? 1 : 0, new Date().toISOString(), ...ids]
      );

      await scheduler.rescheduleAll();
      res.json({ message: `${ids.length} tasks updated`, data: { ids, enabled } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid batch update payload', { errors: error.errors }));
      } else {
        next(error);
      }
    }
  });

  router.delete('/batch', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = batchDeleteSchema.parse(req.body);
      const placeholders = ids.map(() => '?').join(',');

      db.run(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
      for (const id of ids) {
        scheduler.removeTask(id);
      }

      await scheduler.rescheduleAll();
      res.json({ message: `${ids.length} tasks deleted` });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new ValidationError('Invalid batch delete payload', { errors: error.errors }));
      } else {
        next(error);
      }
    }
  });

  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      getTaskById(db, req.params.id);

      db.run('DELETE FROM tasks WHERE id = ?', [req.params.id]);
      scheduler.removeTask(req.params.id);

      res.json({ message: 'Task deleted successfully' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/execute/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = getTaskById(db, req.params.id);
      await scheduler.executeTask(task);
      res.json({ message: 'Task executed successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function getTaskById(db: DatabaseService, id: string): TaskRow {
  const task = db.querySingle('SELECT * FROM tasks WHERE id = ?', [id]) as TaskRow | null;

  if (!task) {
    throw new NotFoundError('Task', id);
  }

  return task;
}

function validateTaskSemantics(task: Partial<z.infer<typeof createTaskSchema>>) {
  if (!task.schedule_type || task.schedule_expression === undefined) {
    return;
  }

  const expression = task.schedule_expression;
  switch (task.schedule_type) {
    case 'cron':
      if (!cron.validate(expression)) {
        throw new ValidationError('Invalid cron expression');
      }
      break;
    case 'once':
      if (!parseLocalDateTime(expression)) {
        throw new ValidationError('Invalid one-time schedule format');
      }
      break;
    case 'daily':
      if (!/^\d{1,2}:\d{2}$/.test(expression)) {
        throw new ValidationError('Invalid daily schedule format');
      }
      break;
    case 'weekly':
      if (!/^[0-6]\s+\d{1,2}:\d{2}$/.test(expression)) {
        throw new ValidationError('Invalid weekly schedule format');
      }
      break;
    case 'monthly':
      if (!/^(?:[1-9]|[12]\d|3[01])\s+\d{1,2}:\d{2}$/.test(expression)) {
        throw new ValidationError('Invalid monthly schedule format');
      }
      break;
    case 'hourly':
      if (!/^\d{1,2}$/.test(expression)) {
        throw new ValidationError('Invalid hourly schedule format');
      }
      break;
  }
}

function buildDuplicateName(db: DatabaseService, sourceName: string): string {
  const baseName = `${sourceName} Copy`;
  let candidate = baseName;
  let index = 2;

  while (db.querySingle('SELECT id FROM tasks WHERE name = ?', [candidate])) {
    candidate = `${baseName} ${index}`;
    index += 1;
  }

  return candidate;
}
