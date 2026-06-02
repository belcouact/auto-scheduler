import { Router, Request, Response, NextFunction } from 'express';
import fetch from 'node-fetch';
import { getJson } from 'serpapi';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { DatabaseService, TaskRow } from '../database.js';
import { formatTask, serializeTags } from '../task-utils.js';

function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function fetchPageContent(url: string, timeout: number = 8000): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return '';
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, iframe, noscript, svg, img, .ad, .advertisement, .sidebar, .menu, .navigation').remove();

    let articleContent = $('article').text() || $('main').text() || $('.content').text() || $('.article-body').text() || $('.post-content').text();

    if (!articleContent || articleContent.length < 200) {
      articleContent = $('body').text();
    }

    const cleaned = articleContent
      .replace(/\s+/g, ' ')
      .replace(/&#?\w+;/g, ' ')
      .trim();

    return cleaned.length > 3000 ? cleaned.substring(0, 3000) + '...' : cleaned;
  } catch (error) {
    console.error(`Failed to fetch content from ${url}:`, error);
    return '';
  }
}

function isNewsRelatedQuery(query: string): boolean {
  const newsKeywords = ['新闻', '资讯', '大新闻', '最新消息', '动态', '今日', '今天', '昨日', '过去', '小时', '日报', '周报', 'news', 'latest', 'today', 'recent', 'headline'];
  const lowerQuery = query.toLowerCase();
  return newsKeywords.some(keyword => lowerQuery.includes(keyword));
}

async function searchWeb(query: string, apiKey: string): Promise<string> {
  try {
    const isNewsQuery = isNewsRelatedQuery(query);
    
    const searchParams: any = {
      engine: isNewsQuery ? 'google_news' : 'google',
      q: query,
      api_key: apiKey,
      num: isNewsQuery ? 15 : 8,
      hl: 'zh-cn',
      gl: 'cn',
    };

    const results = await getJson(searchParams);

    const organic = results.organic_results || [];
    const newsResults = results.news_results || [];
    const allResults = isNewsQuery ? [...newsResults, ...organic] : organic;

    if (allResults.length === 0) return '';

    const contentFetchLimit = Math.min(3, allResults.length);
    const contentPromises: Promise<{ index: number; title: string; url: string; snippet: string; content: string }>[] = [];

    for (let i = 0; i < contentFetchLimit; i++) {
      const item = allResults[i];
      const url = item.link || item.url || '';
      if (url) {
        contentPromises.push(
          fetchPageContent(url).then(content => ({
            index: i + 1,
            title: item.title || 'Untitled',
            url,
            snippet: item.snippet || '',
            content,
          }))
        );
      }
    }

    const fetchedContents = await Promise.all(contentPromises);

    const resultItems = allResults.map((item: any, i: number) => {
      const fetched = fetchedContents.find(f => f.index === i + 1);
      const fullContent = fetched?.content || '';
      
      let contentBlock = `[${i + 1}] ${item.title || 'Untitled'}\n   URL: ${item.link || item.url || ''}\n   摘要: ${item.snippet || ''}`;
      
      if (fullContent && fullContent.length > 100) {
        contentBlock += `\n   详细内容:\n${fullContent}`;
      }
      
      return contentBlock;
    });

    return `以下是通过${isNewsQuery ? 'Google新闻' : 'Google'}搜索"${query}"获得的结果:\n\n${resultItems.join('\n\n')}`;
  } catch (error) {
    console.error('Web search failed:', error);
    return '';
  }
}

export function aiRouter(db: DatabaseService) {
  const router = Router();

  const getAiConfig = async () => {
    const rows = await db.queryAll(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)',
      ['ai_api_url', 'ai_api_key', 'ai_model', 'serpapi_key']
    ) as { key: string; value: string }[];

    const configMap: Record<string, string> = {};
    for (const row of rows) {
      configMap[row.key] = row.value;
    }

    return {
      aiApiUrl: configMap.ai_api_url || config.aiApiUrl,
      aiApiKey: configMap.ai_api_key || config.aiApiKey,
      aiModel: configMap.ai_model || config.aiModel,
      serpapiKey: configMap.serpapi_key || '',
    };
  };

  router.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, model, enable_web_search } = req.body;
      const aiConfig = await getAiConfig();

      if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
        res.status(400).json({
          error: 'AI API not configured',
          message: 'Please configure AI API URL and API key in settings',
        });
        return;
      }

      const shouldSearch = enable_web_search === true;
      const lastUserMsg = [...(messages || [])].reverse().find((m: any) => m.role === 'user');
      let searchContext = '';
      if (shouldSearch && aiConfig.serpapiKey && lastUserMsg?.content) {
        const query = String(lastUserMsg.content).substring(0, 200);
        searchContext = await searchWeb(query, aiConfig.serpapiKey);
      }

      let systemContent = `You are an intelligent task scheduler assistant. Help users create and manage automated tasks.
You can suggest:
- Script execution tasks (Python, Batch, PowerShell)
- Popup notifications with custom messages (can use AI to process content)
- Webhook/API calls for monitoring
- System operations (shutdown, lock, hibernate)

When users describe what they want to automate, provide helpful advice AND structured task suggestions.`;

      if (searchContext) {
        systemContent += `\n\n以下是AI搜索获取的网络参考信息，请基于这些信息回答用户的问题:\n\n${searchContext}`;
      }

      systemContent += `\n\nIMPORTANT: When suggesting tasks, ALWAYS include a JSON array at the end of your response in this exact format:
\`\`\`json
[
  {
    "name": "Clear task name",
    "description": "Clear description of what this task does",
    "type": "script|popup|webhook|system",
    "schedule_type": "once|cron|daily|weekly|monthly|hourly",
    "schedule_expression": "MUST follow exact format below",
    "priority": 5,
    "max_retries": 3,
    "timeout_seconds": 300
  }
]
\`\`\`

CRITICAL - schedule_expression MUST use these EXACT formats (NO Chinese, NO words like "每天"):
- "once": "2026-06-01 09:00:00" (future datetime)
- "daily": "09:00" (HH:MM only, 24-hour format)
- "weekly": "1 09:00" (day_of_week 0-6, then HH:MM, 0=Sunday)
- "monthly": "1 09:00" (day 1-31, then HH:MM)
- "cron": "*/5 * * * *" (standard 5-field cron)
- "hourly": "0" (minute 0-59)

Type-specific fields:
- "popup": "popup_title": "title", "popup_content": "content", "popup_mode": "fixed|ai" (use "ai" to let AI process the content)
- "script": "script_path": "/path/to/script"
- "webhook": "webhook_url": "https://example.com/api"
- "system": "system_action": "shutdown|lock|hibernate"

For AI-powered popup content (instead of ai_search type), use type "popup" with "popup_mode": "ai" and set "popup_content" as the search query or prompt.

Always provide complete and valid task objects. Double-check schedule_expression format before returning.`;

      const systemMessage = {
        role: 'system',
        content: systemContent,
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

  router.post('/chat/stream', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { messages, model, enable_web_search } = req.body;
      const aiConfig = await getAiConfig();

      if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
        res.status(400).json({
          error: 'AI API not configured',
          message: 'Please configure AI API URL and API key in settings',
        });
        return;
      }

      const shouldSearch = enable_web_search === true;
      const lastUserMsg = [...(messages || [])].reverse().find((m: any) => m.role === 'user');
      let searchContext = '';
      if (shouldSearch && aiConfig.serpapiKey && lastUserMsg?.content) {
        const query = String(lastUserMsg.content).substring(0, 200);
        searchContext = await searchWeb(query, aiConfig.serpapiKey);
      }

      let systemContent = `You are an intelligent task scheduler assistant. Help users create and manage automated tasks.
You can suggest:
- Script execution tasks (Python, Batch, PowerShell)
- Popup notifications with custom messages (can use AI to process content)
- Webhook/API calls for monitoring
- System operations (shutdown, lock, hibernate)

When users describe what they want to automate, provide helpful advice AND structured task suggestions.`;

      if (searchContext) {
        systemContent += `\n\n以下是AI搜索获取的网络参考信息，请基于这些信息回答用户的问题:\n\n${searchContext}`;
      }

      systemContent += `\n\nIMPORTANT: When suggesting tasks, ALWAYS include a JSON array at the end of your response in this exact format:
\`\`\`json
[
  {
    "name": "Clear task name",
    "description": "Clear description of what this task does",
    "type": "script|popup|webhook|system",
    "schedule_type": "once|cron|daily|weekly|monthly|hourly",
    "schedule_expression": "MUST follow exact format below",
    "priority": 5,
    "max_retries": 3,
    "timeout_seconds": 300
  }
]
\`\`\`

CRITICAL - schedule_expression MUST use these EXACT formats (NO Chinese, NO words like "每天"):
- "once": "2026-06-01 09:00:00" (future datetime)
- "daily": "09:00" (HH:MM only, 24-hour format)
- "weekly": "1 09:00" (day_of_week 0-6, then HH:MM, 0=Sunday)
- "monthly": "1 09:00" (day 1-31, then HH:MM)
- "cron": "*/5 * * * *" (standard 5-field cron)
- "hourly": "0" (minute 0-59)

Type-specific fields:
- "popup": "popup_title": "title", "popup_content": "content", "popup_mode": "fixed|ai" (use "ai" to let AI process the content)
- "script": "script_path": "/path/to/script"
- "webhook": "webhook_url": "https://example.com/api"
- "system": "system_action": "shutdown|lock|hibernate"

For AI-powered popup content (instead of ai_search type), use type "popup" with "popup_mode": "ai" and set "popup_content" as the search query or prompt.

Always provide complete and valid task objects. Double-check schedule_expression format before returning.`;

      const systemMessage = {
        role: 'system',
        content: systemContent,
      };

      const validMessages = (messages || []).filter((m: any) => {
        if (m.role === 'assistant') {
          return m.content || m.tool_calls;
        }
        return true;
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const apiResponse = await fetch(`${aiConfig.aiApiUrl}/chat/completions`, {
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
          stream: true,
        }),
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        res.write(`data: ${JSON.stringify({ error: `AI API error: ${apiResponse.status} - ${errorText}` })}\n\n`);
        res.end();
        return;
      }

      const rawBody = apiResponse.body as any;
      if (!rawBody) {
        throw new Error('No response body from AI API');
      }

      const decoder = new TextDecoder();
      let fullContent = '';

      const sendSSE = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      if (typeof rawBody.getReader === 'function') {
        const reader = rawBody.getReader();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]') continue;

            try {
              const chunk = JSON.parse(jsonStr);
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                sendSSE({ content: delta, fullContent });
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      } else {
        let buffer = '';
        await new Promise<void>((resolve, reject) => {
          rawBody.on('data', (chunk: Buffer) => {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '[DONE]') continue;

              try {
                const chunk = JSON.parse(jsonStr);
                const delta = chunk.choices?.[0]?.delta?.content;
                if (delta) {
                  fullContent += delta;
                  sendSSE({ content: delta, fullContent });
                }
              } catch {
                // skip malformed chunks
              }
            }
          });

          rawBody.on('end', () => resolve());
          rawBody.on('error', (err: Error) => reject(err));
        });
      }

      sendSSE({ done: true, fullContent });
      res.end();
    } catch (error) {
      if (error instanceof Error) {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      }
      res.end();
    }
  });

  router.post('/suggest-tasks', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { context } = req.body;
      const aiConfig = await getAiConfig();

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
      const aiConfig = await getAiConfig();

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
  "type": "script" | "popup" | "webhook" | "system",
  "schedule_type": "once" | "cron" | "daily" | "weekly" | "monthly" | "hourly",
  "schedule_expression": "time or cron expression based on schedule_type",
  "priority": 5,
  "max_retries": 3,
  "timeout_seconds": 300,
  "tags": ["tag1", "tag2"]
}

For "script" type, also include: "script_path": "path", "script_args": "args"
For "popup" type, also include: "popup_title": "title", "popup_content": "content", "popup_icon": "emoji", "popup_mode": "fixed|ai" (use "ai" for AI-processed content)
For "webhook" type, also include: "webhook_url": "url", "webhook_method": "POST", "webhook_headers": {}, "webhook_body": "{}"
For "system" type, also include: "system_action": "shutdown" | "lock" | "hibernate"

For popup with AI-processed content (e.g., search queries, news summaries), use type "popup" with "popup_mode": "ai" and set "popup_content" as the search query or prompt.

For schedule_expression:
- "once": use ISO datetime like "2026-06-01 09:00:00"
- "daily": use time like "09:00"
- "weekly": use "weekday time" like "1 09:00" (1=Monday)
- "monthly": use "day time" like "1 09:00"
- "cron": use standard cron like "*/5 * * * *"
- "hourly": use minute only like "0"`,
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

      const tags = serializeTags(taskData.tags);

      // Convert ai_search type to popup with popup_mode: 'ai'
      let finalType = taskData.type || 'popup';
      let finalPopupMode = taskData.popup_mode || 'fixed';
      let finalPopupContent = taskData.popup_content || null;
      let finalPopupTitle = taskData.popup_title || null;
      let finalAiSearchQuery = taskData.ai_search_query || null;

      if (finalType === 'ai_search') {
        finalType = 'popup';
        finalPopupMode = 'ai';
        finalPopupContent = taskData.ai_search_query || taskData.description || '';
        finalPopupTitle = taskData.popup_title || taskData.name || 'AI Search Result';
        finalAiSearchQuery = taskData.ai_search_query || taskData.description || '';
      }

      await db.run(`
        INSERT INTO tasks (
          id, name, description, type, enabled, schedule_type, schedule_expression,
          script_path, script_args, popup_title, popup_content, popup_icon,
          webhook_url, webhook_method, webhook_headers, webhook_body,
          system_action, ai_search_query, ai_search_count, popup_mode, priority, tags, created_at, updated_at,
          retry_count, max_retries, timeout_seconds
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `, [
        id,
        taskData.name || 'AI Task',
        taskData.description || '',
        finalType,
        taskData.schedule_type || 'once',
        taskData.schedule_expression || '',
        taskData.script_path || null,
        taskData.script_args || null,
        finalPopupTitle,
        finalPopupContent,
        taskData.popup_icon || null,
        taskData.webhook_url || null,
        taskData.webhook_method || 'POST',
        taskData.webhook_headers ? JSON.stringify(taskData.webhook_headers) : null,
        taskData.webhook_body || null,
        taskData.system_action || null,
        finalAiSearchQuery,
        taskData.ai_search_count || 10,
        finalPopupMode,
        taskData.priority || 5,
        tags,
        now,
        now,
        taskData.max_retries || 3,
        taskData.timeout_seconds || 300,
      ]);

      const created = await db.querySingle('SELECT * FROM tasks WHERE id = ?', [id]) as TaskRow | null;
      if (!created) {
        throw new Error('Created task could not be loaded');
      }

      res.json({ data: formatTask(created) });
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
