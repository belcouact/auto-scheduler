import { Router, Request, Response, NextFunction } from 'express';
import fetch from 'node-fetch';
import { config } from '../config.js';
import { DatabaseService } from '../database.js';

function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function aiRouter(db: DatabaseService) {
  const router = Router();

  const getAiConfig = () => {
    const rows = db.queryAll(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?)',
      ['ai_api_url', 'ai_api_key', 'ai_model']
    ) as { key: string; value: string }[];

    const configMap: Record<string, string> = {};
    for (const row of rows) {
      configMap[row.key] = row.value;
    }

    return {
      aiApiUrl: configMap.ai_api_url || config.aiApiUrl,
      aiApiKey: configMap.ai_api_key || config.aiApiKey,
      aiModel: configMap.ai_model || config.aiModel,
    };
  };

  router.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, model } = req.body;
      const aiConfig = getAiConfig();

      if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
        res.status(400).json({
          error: 'AI API not configured',
          message: 'Please configure AI API URL and API key in settings',
        });
        return;
      }

      const systemMessage = {
        role: 'system',
        content: `You are an intelligent task scheduler assistant. Help users create and manage automated tasks.
You can suggest:
- Script execution tasks (Python, Batch, PowerShell)
- Popup notifications with custom messages
- Webhook/API calls for monitoring
- System operations (shutdown, lock, hibernate)

When users describe what they want to automate, provide structured suggestions in JSON format that can be used to create tasks.
Always be helpful and provide practical advice for task scheduling.`,
      };

      const validMessages = (messages || []).filter((m: any) => {
        if (m.role === 'assistant') {
          return m.content || m.tool_calls;
        }
        return true;
      });

      const response = await fetch(`${aiConfig.aiApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.aiApiKey}`,
        },
        body: JSON.stringify({
          model: model || aiConfig.aiModel,
          messages: [systemMessage, ...validMessages],
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      res.json({ data: data.choices[0].message });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: 'AI request failed', message: error.message });
      } else {
        next(error);
      }
    }
  });

  router.post('/suggest-tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { context } = req.body;
      const aiConfig = getAiConfig();

      if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
        res.status(400).json({
          error: 'AI API not configured',
          message: 'Please configure AI API URL and API key in settings',
        });
        return;
      }

      const response = await fetch(`${aiConfig.aiApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.aiApiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.aiModel,
          messages: [
            {
              role: 'system',
              content: `You are a task automation expert. Based on the user's context, suggest useful automated tasks.
Return your response as a JSON array of task objects with this structure:
[
  {
    "name": "Task name",
    "description": "What this task does",
    "type": "script|popup|webhook|system",
    "schedule_type": "once|cron|daily|weekly|monthly|hourly",
    "schedule_expression": "cron expression or time",
    "priority": 0-10,
    "script_path": "path if script type",
    "popup_title": "title if popup type",
    "popup_content": "content if popup type",
    "webhook_url": "url if webhook type",
    "system_action": "action if system type"
  }
]`,
            },
            {
              role: 'user',
              content: context || 'Suggest some useful automated tasks for my daily workflow',
            },
          ],
          temperature: 0.7,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      res.json({ data: data.choices[0].message });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: 'AI request failed', message: error.message });
      } else {
        next(error);
      }
    }
  });

  router.post('/create-task', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { description } = req.body;
      const aiConfig = getAiConfig();

      if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
        res.status(400).json({
          error: 'AI API not configured',
          message: 'Please configure AI API URL and API key in settings',
        });
        return;
      }

      if (!description) {
        res.status(400).json({
          error: 'Description required',
          message: 'Please describe the task you want to create',
        });
        return;
      }

      const response = await fetch(`${aiConfig.aiApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.aiApiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.aiModel,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are a task automation expert. Based on the user's description, create a task object in JSON format.
Return ONLY a JSON object (no markdown, no code blocks, no extra text) with this structure:
{
  "name": "Task name",
  "description": "What this task does",
  "type": "script" | "popup" | "webhook" | "system" | "ai_search",
  "schedule_type": "once" | "cron" | "daily" | "weekly" | "monthly" | "hourly",
  "schedule_expression": "time or cron expression based on schedule_type",
  "priority": 5,
  "max_retries": 3,
  "timeout_seconds": 300,
  "tags": ["tag1", "tag2"]
}

For "script" type, also include: "script_path": "path", "script_args": "args"
For "popup" type, also include: "popup_title": "title", "popup_content": "content", "popup_icon": "emoji"
For "webhook" type, also include: "webhook_url": "url", "webhook_method": "POST", "webhook_headers": {}, "webhook_body": "{}"
For "system" type, also include: "system_action": "shutdown" | "lock" | "hibernate"
For "ai_search" type, also include: "ai_search_query": "search query description", "ai_search_count": 10, "popup_title": "optional title"

For schedule_expression:
- "once": use ISO datetime like "2026-06-01 09:00:00"
- "daily": use time like "09:00"
- "weekly": use "weekday time" like "1 09:00" (1=Monday)
- "monthly": use "day time" like "1 09:00"
- "cron": use standard cron like "*/5 * * * *"
- "hourly": leave empty string`,
            },
            {
              role: 'user',
              content: `Create a task based on this description: ${description}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      let taskData: any;
      
      try {
        const content = data.choices[0].message.content;
        taskData = JSON.parse(content);
      } catch {
        throw new Error('AI returned invalid JSON');
      }

      const id = generateShortId();
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

      const tags = taskData.tags ? JSON.stringify(taskData.tags) : null;

      db.run(`
        INSERT INTO tasks (
          id, name, description, type, enabled, schedule_type, schedule_expression,
          script_path, script_args, popup_title, popup_content, popup_icon,
          webhook_url, webhook_method, webhook_headers, webhook_body,
          system_action, ai_search_query, ai_search_count, priority, tags, created_at, updated_at,
          retry_count, max_retries, timeout_seconds
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `, [
        id,
        taskData.name || 'AI Task',
        taskData.description || '',
        taskData.type || 'popup',
        taskData.schedule_type || 'once',
        taskData.schedule_expression || '',
        taskData.script_path || null,
        taskData.script_args || null,
        taskData.popup_title || null,
        taskData.popup_content || null,
        taskData.popup_icon || null,
        taskData.webhook_url || null,
        taskData.webhook_method || 'POST',
        taskData.webhook_headers ? JSON.stringify(taskData.webhook_headers) : null,
        taskData.webhook_body ? JSON.stringify(taskData.webhook_body) : null,
        taskData.system_action || null,
        taskData.ai_search_query || null,
        taskData.ai_search_count || 10,
        taskData.priority || 5,
        tags,
        now,
        now,
        taskData.max_retries || 3,
        taskData.timeout_seconds || 300,
      ]);

      const created = db.querySingle('SELECT * FROM tasks WHERE id = ?', [id]);
      res.json({ data: created });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: 'AI task creation failed', message: error.message });
      } else {
        next(error);
      }
    }
  });

  return router;
}
