import cron from 'node-cron';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import { getJson } from 'serpapi';
import * as cheerio from 'cheerio';
import { marked } from 'marked';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService, TaskRow } from './database.js';
import { sseManager } from './sse.js';
import logger from './logger.js';
import { calculateNextRun, getCronExpression, parseLocalDateTime } from './schedule-utils.js';

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface ScheduledTask {
  task: cron.ScheduledTask;
  id: string;
}

async function fetchPageContent(url: string, timeout: number = 10000): Promise<string> {
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
    logger.warn(`Failed to fetch content from ${url}: ${error}`);
    return '';
  }
}

function isNewsRelatedQuery(query: string): boolean {
  const newsKeywords = ['新闻', '资讯', '大新闻', '最新消息', '动态', '今日', '今天', '昨日', '过去', '小时', '日报', '周报', 'news', 'latest', 'today', 'recent', 'headline'];
  const lowerQuery = query.toLowerCase();
  return newsKeywords.some(keyword => lowerQuery.includes(keyword));
}

export class SchedulerService {
  private db: DatabaseService;
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private pendingRetries: Map<string, NodeJS.Timeout> = new Map();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async start() {
    logger.info(`Using local timezone: ${localTimezone}`);
    this.clearPendingRetries();
    await this.db.run('UPDATE tasks SET next_run_at = NULL');
    const tasks = await this.db.queryAll('SELECT * FROM tasks WHERE enabled = 1') as TaskRow[];

    for (const task of tasks) {
      this.scheduleTask(task);
    }

    logger.info(`Loaded ${tasks.length} scheduled tasks`);
  }

  async rescheduleAll() {
    for (const [, { task }] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    this.clearPendingRetries();
    await this.db.run('UPDATE tasks SET next_run_at = NULL WHERE enabled = 0');

    const tasks = await this.db.queryAll('SELECT * FROM tasks WHERE enabled = 1') as TaskRow[];

    for (const task of tasks) {
      this.scheduleTask(task);
    }

    logger.info(`Rescheduled ${tasks.length} tasks`);
  }

  private scheduleTask(task: TaskRow) {
    const nextRunAt = calculateNextRun(task);
    this.updateNextRun(task.id, nextRunAt);

    let cronExpression: string | null;

    switch (task.schedule_type) {
      case 'once':
        this.scheduleOnce(task);
        return;
      default:
        cronExpression = getCronExpression(task);
        if (!cronExpression) {
          logger.warn(`Unknown schedule type: ${task.schedule_type}`);
          return;
        }
    }

    try {
      const cronTask = cron.schedule(cronExpression, async () => {
        logger.info(`Executing task: ${task.name} (${task.id})`);
        await this.executeTask(task);
      }, {
        scheduled: true,
        timezone: localTimezone,
      });

      this.scheduledTasks.set(task.id, { task: cronTask, id: task.id });
      logger.info(`Scheduled task "${task.name}" with expression: ${cronExpression}`);
    } catch (error) {
      logger.error(`Failed to schedule task ${task.id}: ${error}`);
    }
  }

  private scheduleOnce(task: TaskRow) {
    const runTime = parseLocalDateTime(task.schedule_expression);
    const now = new Date();

    if (!runTime || runTime <= now) {
      logger.warn(`Task ${task.name} has a past run time: ${task.schedule_expression}`);
      this.updateNextRun(task.id, null);
      return;
    }

    const delay = runTime.getTime() - now.getTime();
    const timeout = setTimeout(async () => {
      await this.executeTask(task);
      this.scheduledTasks.delete(task.id);
    }, delay);

    this.scheduledTasks.set(task.id, {
      task: { stop: () => clearTimeout(timeout) } as cron.ScheduledTask,
      id: task.id,
    });

    logger.info(`One-time task "${task.name}" scheduled for ${runTime.toLocaleString()} (${localTimezone})`);
  }

  async executeTask(task: TaskRow) {
    this.clearRetry(task.id);
    const historyId = randomUUID();
    const startedAt = new Date().toISOString();

    await this.db.run(`
      INSERT INTO execution_history (id, task_id, task_name, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `, [historyId, task.id, task.name, startedAt]);

    try {
      let output: string;

      switch (task.type) {
        case 'script':
          output = await this.executeScript(task);
          break;
        case 'popup':
          output = await this.executePopup(task);
          break;
        case 'webhook':
          output = await this.executeWebhook(task);
          break;
        case 'system':
          output = await this.executeSystem(task);
          break;
        case 'ai_search':
          output = await this.executeAISearch(task);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const nextRunAt = task.schedule_type === 'once'
        ? null
        : calculateNextRun(task, new Date(completedAt));

      await this.db.run(`
        UPDATE execution_history 
        SET status = 'success', output = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `, [output, completedAt, durationMs, historyId]);

      await this.db.run(`
        UPDATE tasks 
        SET last_run_at = ?, last_run_status = 'success', retry_count = 0, next_run_at = ?, enabled = ?
        WHERE id = ?
      `, [completedAt, nextRunAt, task.schedule_type === 'once' ? 0 : 1, task.id]);

      logger.info(`Task "${task.name}" completed successfully`);
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const latestTask = await this.db.querySingle('SELECT * FROM tasks WHERE id = ?', [task.id]) as TaskRow | null;
      const currentRetryCount = latestTask?.retry_count ?? task.retry_count ?? 0;
      const maxRetries = latestTask?.max_retries ?? task.max_retries;
      const hasRetryRemaining = currentRetryCount < maxRetries;

      await this.db.run(`
        UPDATE execution_history 
        SET status = 'error', error_message = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `, [errorMessage, completedAt, durationMs, historyId]);

      if (hasRetryRemaining) {
        const nextRetryCount = currentRetryCount + 1;
        const retryDelaySeconds = Math.min(300, nextRetryCount * 30);
        const retryAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();

        await this.db.run(`
          UPDATE tasks
          SET last_run_at = ?, last_run_status = 'error', retry_count = ?, next_run_at = ?
          WHERE id = ?
        `, [completedAt, nextRetryCount, retryAt, task.id]);

        this.scheduleRetry(task.id, retryDelaySeconds * 1000);
        logger.warn(`Task "${task.name}" failed. Retrying in ${retryDelaySeconds}s (${nextRetryCount}/${maxRetries})`);
      } else {
        const nextRunAt = task.schedule_type === 'once'
          ? null
          : calculateNextRun(task, new Date(completedAt));

        await this.db.run(`
          UPDATE tasks
          SET last_run_at = ?, last_run_status = 'error', next_run_at = ?, enabled = ?
          WHERE id = ?
        `, [completedAt, nextRunAt, task.schedule_type === 'once' ? 0 : 1, task.id]);
      }

      logger.error(`Task "${task.name}" failed: ${errorMessage}`);
    }
  }

  private async executeScript(task: TaskRow): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!task.script_path) {
        reject(new Error('Script path is required'));
        return;
      }

      const args = task.script_args ? task.script_args.split(' ') : [];
      let command: string;
      let cmdArgs: string[];

      const ext = task.script_path.split('.').pop()?.toLowerCase();

      switch (ext) {
        case 'py':
          command = 'python';
          cmdArgs = [task.script_path, ...args];
          break;
        case 'bat':
        case 'cmd':
          command = 'cmd.exe';
          cmdArgs = ['/c', task.script_path, ...args];
          break;
        case 'ps1':
          command = 'powershell.exe';
          cmdArgs = ['-ExecutionPolicy', 'Bypass', '-File', task.script_path, ...args];
          break;
        case 'js':
          command = 'node';
          cmdArgs = [task.script_path, ...args];
          break;
        default:
          command = task.script_path;
          cmdArgs = args;
      }

      const proc = spawn(command, cmdArgs, {
        timeout: task.timeout_seconds * 1000,
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout || 'Script executed successfully');
        } else {
          reject(new Error(`Script exited with code ${code}\n${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to execute script: ${err.message}`));
      });
    });
  }

  private async executePopup(task: TaskRow): Promise<string> {
    const title = task.popup_title || 'Auto Scheduler Alert';
    const content = task.popup_content || '';
    const icon = task.popup_icon || 'ⓘ';
    const position = task.popup_position || 'center';
    const autoDismiss = task.popup_auto_dismiss || 0;
    const popupMode = task.popup_mode || 'fixed';

    logger.info(`executePopup: position="${position}", autoDismiss=${autoDismiss}, popupMode="${popupMode}"`);

    if (popupMode === 'ai') {
      const aiContent = await this.executeAIPopupContent(task);
      await this.showPopupWithContentNative(title, aiContent, icon, position, autoDismiss);
      return aiContent;
    } else {
      await this.showPopupWithContentNative(title, content, icon, position, autoDismiss);
      return content;
    }
  }

  private async executeAIPopupContent(task: TaskRow): Promise<string> {
    const userPrompt = task.popup_content || task.ai_search_query;
    if (!userPrompt) {
      throw new Error('Popup content or AI search query is required for AI mode');
    }

    const aiConfig = await this.getAiConfig();
    if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
      throw new Error('AI API not configured. Please configure AI API URL and API key in settings.');
    }

    const enableWebSearch = task.ai_enable_web_search !== 0;
    const searchCount = task.ai_search_count || 10;
    let searchResultsText = '';

    if (enableWebSearch) {
      if (!aiConfig.serpapiKey) {
        logger.warn('SerpAPI key not configured, skipping web search for popup');
      } else {
        const isNewsQuery = isNewsRelatedQuery(userPrompt);
        try {
          const searchParams: any = {
            engine: isNewsQuery ? 'google_news' : 'google',
            q: userPrompt,
            api_key: aiConfig.serpapiKey,
            num: isNewsQuery ? Math.min(searchCount, 15) : searchCount,
            hl: 'zh-cn',
            gl: 'cn',
          };
          const results = await getJson(searchParams);
          const organic = results.organic_results || [];
          const newsResults = results.news_results || [];
          const allResults = isNewsQuery ? [...newsResults, ...organic] : organic;

          if (allResults.length > 0) {
            const resultItems = allResults.map((item: any, i: number) => 
              `[${i + 1}] ${item.title || 'Untitled'}\n   摘要: ${item.snippet || ''}`
            );
            searchResultsText = `搜索"${userPrompt}"结果:\n\n${resultItems.join('\n\n')}`;
          }
        } catch (error) {
          logger.warn(`Web search failed for popup: ${error}`);
        }
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), task.timeout_seconds * 1000);

    try {
      const systemPrompt = `You are a helpful assistant. Provide concise, well-organized content based on the user's request. Do NOT include URLs, technical metadata, or source references. Use clean numbered list format.`;
      
      const messages: any[] = [
        { role: 'system', content: systemPrompt },
      ];

      if (searchResultsText) {
        messages.push({
          role: 'system',
          content: `参考信息:\n\n${searchResultsText}`,
        });
      }

      messages.push({
        role: 'user',
        content: `请以简洁的格式（每项：标题 + 2-3句话摘要）回应以下请求：\n\n${userPrompt}\n\n最多${searchCount}项。不要包含URL或来源链接。`,
      });

      const response = await fetch(`${aiConfig.aiApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.aiApiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.aiModel,
          messages,
          temperature: 0.5,
          max_tokens: 4000,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.choices[0].message.content || 'No content returned';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async executeWebhook(task: TaskRow): Promise<string> {
    if (!task.webhook_url) {
      throw new Error('Webhook URL is required');
    }

    const method = task.webhook_method || 'GET';
    const headers = task.webhook_headers ? JSON.parse(task.webhook_headers) : {};
    const body = task.webhook_body;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), task.timeout_seconds * 1000);

    try {
      const response = await fetch(task.webhook_url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? body : undefined,
        signal: controller.signal,
      });

      const data = await response.text();

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}: ${data}`);
      }

      return `Webhook response (${response.status}): ${data.substring(0, 1000)}`;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async executeSystem(task: TaskRow): Promise<string> {
    const action = task.system_action;

    switch (action) {
      case 'shutdown':
        spawn('shutdown', ['/s', '/t', '60']);
        return 'System shutdown initiated';
      case 'lock':
        spawn('rundll32.exe', ['user32.dll,LockWorkStation']);
        return 'System locked';
      case 'hibernate':
        spawn('shutdown', ['/h']);
        return 'System hibernating';
      default:
        throw new Error(`Unknown system action: ${action}`);
    }
  }

  private async executeAISearch(task: TaskRow): Promise<string> {
    if (!task.ai_search_query) {
      throw new Error('AI search query is required');
    }

    const aiConfig = await this.getAiConfig();
    if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
      throw new Error('AI API not configured. Please configure AI API URL and API key in settings.');
    }

    const searchQuery = task.ai_search_query;
    const searchCount = task.ai_search_count || 10;
    const enableWebSearch = task.ai_enable_web_search !== 0;
    const position = task.popup_position || 'center';
    const autoDismiss = task.popup_auto_dismiss || 0;

    logger.info(`executeAISearch: enableWebSearch=${enableWebSearch} (raw=${task.ai_enable_web_search}), position="${position}" (raw="${task.popup_position}"), autoDismiss=${autoDismiss}`);

    let searchResultsText = '';

    if (enableWebSearch) {
      if (!aiConfig.serpapiKey) {
        throw new Error('AI search tasks require SerpAPI key. Please configure it in Settings.');
      }

      const isNewsQuery = isNewsRelatedQuery(searchQuery);

      try {
        const searchParams: any = {
          engine: isNewsQuery ? 'google_news' : 'google',
          q: searchQuery,
          api_key: aiConfig.serpapiKey,
          num: isNewsQuery ? Math.min(searchCount, 15) : searchCount,
          hl: 'zh-cn',
          gl: 'cn',
        };

        logger.info(`Executing ${isNewsQuery ? 'Google News' : 'Google'} search for: "${searchQuery}"`);
        const results = await getJson(searchParams);

        const organic = results.organic_results || [];
        const newsResults = results.news_results || [];
        const allResults = isNewsQuery ? [...newsResults, ...organic] : organic;

        logger.info(`SerpAPI returned ${organic.length} organic + ${newsResults.length} news results for: "${searchQuery}"`);

        if (allResults.length > 0) {
          const contentFetchLimit = Math.min(5, allResults.length);
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

          searchResultsText = `以下是通过${isNewsQuery ? 'Google新闻' : 'Google'}搜索"${searchQuery}"获得的结果:\n\n${resultItems.join('\n\n')}`;
          logger.info(`Search results text length: ${searchResultsText.length} chars (with full content)`);
        } else {
          logger.warn(`SerpAPI returned no results for: "${searchQuery}"`);
        }
      } catch (error) {
        logger.error(`SerpAPI search failed for "${searchQuery}": ${error}`);
        throw new Error(`Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      logger.info(`Web search disabled for: "${searchQuery}", using AI knowledge only`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), task.timeout_seconds * 1000);

    try {
      const hasRichContent = searchResultsText.length > 500;
      
      let systemPrompt: string;
      let userMessage: string;
      
      if (enableWebSearch && hasRichContent) {
        systemPrompt = `You are a professional research assistant. Base your response ONLY on the provided search results. Do NOT include URLs, technical metadata, or source references. Present clean, readable content only.`;
        userMessage = `请根据搜索结果，用简洁清晰的格式总结关于"${searchQuery}"的关键信息（最多${searchCount}项）。

格式要求：
- 每项只包含：标题 + 2-3句话的核心摘要
- 不要包含URL链接、技术元数据或来源标注
- 使用编号列表，语言简洁易懂
- 只保留最有价值的信息`;
      } else if (enableWebSearch && !hasRichContent) {
        systemPrompt = `You are a research assistant. Provide concise information based on limited search results. Do NOT include URLs or technical references.`;
        userMessage = `请总结关于"${searchQuery}"的关键信息（最多${searchCount}项）。

格式要求：
- 每项只包含：标题 + 2-3句话的核心摘要
- 不要包含URL链接或技术元数据
- 使用编号列表，语言简洁易懂`;
      } else {
        systemPrompt = `You are a professional research assistant. Provide concise, well-organized information based on your knowledge. Do NOT include URLs or technical references.`;
        userMessage = `请用简洁清晰的格式总结关于"${searchQuery}"的关键信息（最多${searchCount}项）。

格式要求：
- 每项只包含：标题 + 2-3句话的核心摘要
- 不要包含URL链接或技术元数据
- 使用编号列表，语言简洁易懂
- 只保留最有价值的信息`;
      }

      const messages: any[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
      ];

      if (searchResultsText) {
        messages.push({
          role: 'system',
          content: `以下是本次搜索获得的信息源（包含搜索结果摘要和抓取的网页详细内容）:\n\n${searchResultsText}`,
        });
      }

      messages.push({
        role: 'user',
        content: userMessage,
      });

      const requestBody: any = {
        model: aiConfig.aiModel,
        messages,
        temperature: 0.5,
        max_tokens: 6000,
      };

      const response = await fetch(`${aiConfig.aiApiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.aiApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      const message = data.choices[0].message;
      logger.info(`AI response: content_length=${message.content ? message.content.length : 0}`);

      let finalContent: string = message.content || 'No content returned from AI API';

      const title = task.popup_title || `AI 搜索结果: ${searchQuery.substring(0, 30)}`;
      const icon = task.popup_icon || '🔍';

      await this.showPopupWithContentNative(title, finalContent, icon, position, autoDismiss);

      return finalContent;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async showNativePopup(title: string, content: string, icon: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `popup_${randomUUID()}.txt`);
    fs.writeFileSync(tmpFile, content, 'utf-8');

    const safeTitle = title.replace(/'/g, "''").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const iconDeco = this.getIconDecorations(icon);
    const iconColor = this.getIconColor(icon);

    const psCommand = `
$content = [System.IO.File]::ReadAllText('${tmpFile}')

# Enable high DPI support
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class DPIHelper {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
'
[DPIHelper]::SetProcessDPIAware() | Out-Null

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Animation;
public class NativeMethods {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("dwmapi.dll")]
  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
}
'
$window = New-Object System.Windows.Window
$window.Title = '${safeTitle}'
$window.Width = 700
$window.Height = 500
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::CenterScreen
$window.Topmost = $true
$window.ResizeMode = 'NoResize'
$window.WindowStyle = 'SingleBorderWindow'
$window.Background = [System.Windows.Media.Brushes]::White
$window.AllowsTransparency = $false
$window.UseLayoutRounding = $true
$window.TextOptions.SetTextFormattingMode($window, 'Display')

$hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle
$DWMWA_WINDOW_CORNER_PREFERENCE = 33
$DWMWCP_ROUND = 2
[NativeMethods]::DwmSetWindowAttribute($hwnd, $DWMWA_WINDOW_CORNER_PREFERENCE, [ref]$DWMWCP_ROUND, 4) | Out-Null

$border = New-Object System.Windows.Controls.Border
$border.Background = [System.Windows.Media.Brushes]::White
$border.BorderBrush = [System.Windows.Media.Brushes]::FromRgb(220, 240, 255)
$border.BorderThickness = New-Object System.Windows.Thickness(2)
$border.CornerRadius = New-Object System.Windows.CornerRadius(16, 16, 16, 16)
$window.Content = $border

$grid = New-Object System.Windows.Controls.Grid
$border.Child = $grid
$grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition))
$grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition))
$grid.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition))

$topBar = New-Object System.Windows.Controls.StackPanel
$topBar.Orientation = 'Horizontal'
$topBar.HorizontalAlignment = 'Center'
$topBar.Margin = New-Object System.Windows.Thickness(0, 30, 0, 0)
[System.Windows.Controls.Grid]::SetRow($topBar, 0)
$grid.Children.Add($topBar) | Out-Null

$leftDeco = New-Object System.Windows.Controls.TextBlock
$leftDeco.Text = '${iconDeco.left}'
$leftDeco.FontSize = 20
$leftDeco.VerticalAlignment = 'Center'
$leftDeco.Opacity = 0.7
$topBar.Children.Add($leftDeco) | Out-Null

$mainIcon = New-Object System.Windows.Controls.TextBlock
$mainIcon.Text = '${icon.replace(/'/g, "''")}'
$mainIcon.FontSize = 48
$mainIcon.VerticalAlignment = 'Center'
$mainIcon.Margin = New-Object System.Windows.Thickness(15, 0, 15, 0)
$topBar.Children.Add($mainIcon) | Out-Null

$rightDeco = New-Object System.Windows.Controls.TextBlock
$rightDeco.Text = '${iconDeco.right}'
$rightDeco.FontSize = 20
$rightDeco.VerticalAlignment = 'Center'
$rightDeco.Opacity = 0.7
$topBar.Children.Add($rightDeco) | Out-Null

$iconGlow = New-Object System.Windows.Media.DropShadowEffect
$iconGlow.Color = [System.Windows.Media.Color]::FromRgb(${iconColor.r}, ${iconColor.g}, ${iconColor.b})
$iconGlow.BlurRadius = 20
$iconGlow.ShadowDepth = 0
$mainIcon.Effect = $iconGlow

$scaleStoryboard = New-Object System.Windows.Media.Animation.ObjectAnimationUsingKeyFrames
$scaleStoryboard.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$scaleStoryboard.AutoReverse = $true
$scaleKey1 = New-Object System.Windows.Media.Animation.DiscreteObjectKeyFrame
$scaleKey1.KeyTime = [System.Windows.Media.Animation.KeyTime]::FromPercent(0)
$scaleKey1.Value = 1.0
$scaleKey2 = New-Object System.Windows.Media.Animation.DiscreteObjectKeyFrame
$scaleKey2.KeyTime = [System.Windows.Media.Animation.KeyTime]::FromPercent(0.5)
$scaleKey2.Value = 1.15
$scaleKey3 = New-Object System.Windows.Media.Animation.DiscreteObjectKeyFrame
$scaleKey3.KeyTime = [System.Windows.Media.Animation.KeyTime]::FromPercent(1.0)
$scaleKey3.Value = 1.0
$scaleStoryboard.KeyFrames.Add($scaleKey1)
$scaleStoryboard.KeyFrames.Add($scaleKey2)
$scaleStoryboard.KeyFrames.Add($scaleKey3)
$mainIcon.BeginAnimation([System.Windows.Controls.TextBlock]::FontSizeProperty, $scaleStoryboard)

$msgScroll = New-Object System.Windows.Controls.ScrollViewer
$msgScroll.VerticalScrollBarVisibility = 'Auto'
$msgScroll.HorizontalScrollBarVisibility = 'Disabled'
$msgScroll.Padding = New-Object System.Windows.Thickness(30, 15, 30, 15)
[System.Windows.Controls.Grid]::SetRow($msgScroll, 1)
$grid.Children.Add($msgScroll) | Out-Null

$msgText = New-Object System.Windows.Controls.TextBlock
$msgText.Text = $content
$msgText.FontSize = 18
$msgText.FontFamily = New-Object System.Windows.Media.FontFamily('Segoe UI Emoji, Microsoft YaHei')
$msgText.Foreground = [System.Windows.Media.Brushes]::FromRgb(31, 41, 55)
$msgText.TextAlignment = 'Center'
$msgText.TextWrapping = 'Wrap'
[System.Windows.Controls.TextOptions]::SetTextRenderingMode($msgText, 'ClearType')
$msgScroll.Content = $msgText

$btnPanel = New-Object System.Windows.Controls.StackPanel
$btnPanel.Orientation = 'Horizontal'
$btnPanel.HorizontalAlignment = 'Center'
$btnPanel.Margin = New-Object System.Windows.Thickness(0, 0, 0, 20)
[System.Windows.Controls.Grid]::SetRow($btnPanel, 2)
$grid.Children.Add($btnPanel) | Out-Null

$btn = New-Object System.Windows.Controls.Button
$btn.Content = '  ✨ 确定 ✨  '
$btn.Width = 140
$btn.Height = 42
$btn.FontSize = 18
$btn.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei')
$btn.HorizontalAlignment = 'Center'
$btn.Foreground = [System.Windows.Media.Brushes]::White
$btn.Background = [System.Windows.Media.Brushes]::FromRgb(24, 144, 255)
$btn.BorderThickness = New-Object System.Windows.Thickness(0)
$btn.Cursor = 'Hand'
$btn.Margin = New-Object System.Windows.Thickness(0, 0, 10, 0)
$btn.Padding = New-Object System.Windows.Thickness(20, 8, 20, 8)
$btn.Add_Click({ $window.Close() })
$btnPanel.Children.Add($btn) | Out-Null

$btn.Add_MouseEnter({ $btn.Background = [System.Windows.Media.Brushes]::FromRgb(64, 158, 255) })
$btn.Add_MouseLeave({ $btn.Background = [System.Windows.Media.Brushes]::FromRgb(24, 144, 255) })

$window.Add_Loaded({
  [NativeMethods]::SetForegroundWindow($hwnd)
})

$window.ShowDialog() | Out-Null
Remove-Item -Path '${tmpFile}' -Force -ErrorAction SilentlyContinue
`;

    return new Promise<string>((resolve, reject) => {
      const proc = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command', psCommand,
      ], {
        timeout: 60000,
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 || code === null) {
          logger.info(`Native popup displayed: ${title}`);
          resolve(`Native popup displayed: ${title}`);
        } else {
          reject(new Error(`Native popup failed (exit ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to show native popup: ${err.message}`));
      });
    });
  }

  private getIconDecorations(icon: string): { left: string; right: string } {
    const decoMap: Record<string, { left: string; right: string }> = {
      '⏰': { left: '🕐', right: '🕑' },
      '🔔': { left: '✨', right: '✨' },
      '💡': { left: '💫', right: '💫' },
      '📝': { left: '✏️', right: '✏️' },
      '⚡': { left: '🌟', right: '🌟' },
      '🔒': { left: '🛡️', right: '🛡️' },
      '📧': { left: '📬', right: '📫' },
      '🔍': { left: '👀', right: '👀' },
      '💻': { left: '🖥️', right: '🖥️' },
      '☕': { left: '🍵', right: '🍵' },
      '🎵': { left: '🎶', right: '🎶' },
      '📊': { left: '📈', right: '📉' },
      '🎯': { left: '🎯', right: '🎯' },
      '🔧': { left: '🛠️', right: '🛠️' },
      '📋': { left: '📌', right: '📌' },
    };
    return decoMap[icon] || { left: '🌟', right: '🌟' };
  }

  private getIconColor(icon: string): { r: number; g: number; b: number } {
    const colorMap: Record<string, { r: number; g: number; b: number }> = {
      '⏰': { r: 255, g: 179, b: 71 },
      '🔔': { r: 255, g: 215, b: 0 },
      '💡': { r: 255, g: 223, b: 0 },
      '⚡': { r: 255, g: 200, b: 0 },
      '🔒': { r: 100, g: 180, b: 255 },
      '📧': { r: 70, g: 130, b: 255 },
      '🔍': { r: 100, g: 200, b: 255 },
      '💻': { r: 100, g: 100, b: 100 },
      '☕': { r: 139, g: 90, b: 43 },
      '🎵': { r: 255, g: 100, b: 150 },
      '📊': { r: 50, g: 200, b: 100 },
      '🎯': { r: 255, g: 100, b: 100 },
      '🔧': { r: 150, g: 150, b: 150 },
      '📋': { r: 255, g: 150, b: 50 },
    };
    return colorMap[icon] || { r: 24, g: 144, b: 255 };
  }

  private async showPopupWithContentNative(title: string, content: string, icon: string, position: string = 'center', autoDismissSeconds: number = 0): Promise<void> {
    const tmpFile = path.join(os.tmpdir(), `popup_${randomUUID()}.html`);

    const htmlContent = marked.parse(content) as string;

    const fadeAnimation = autoDismissSeconds > 0 ? `
      <style>
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        body { animation: fadeIn 0.5s ease-out; }
        body.fade-out { animation: fadeOut 0.5s ease-in forwards; }
      </style>
      <script>
        setTimeout(function() {
          document.body.classList.add('fade-out');
          setTimeout(function() { window.close(); }, 500);
        }, ${autoDismissSeconds * 1000});
      </script>
    ` : `
      <style>
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        body { animation: fadeIn 0.5s ease-out; }
      </style>
    `;

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
    font-size: 64px;
    line-height: 1.8;
    color: #1a1a1a;
    background: #ffffff;
    padding: 20px 28px;
  }
  h1, h2, h3, h4, h5, h6 {
    margin: 16px 0 8px 0;
    font-weight: 600;
    color: #0f172a;
  }
  h1 { font-size: 104px; border-bottom: 3px solid #e2e8f0; padding-bottom: 8px; }
  h2 { font-size: 88px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
  h3 { font-size: 72px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0 8px 20px; }
  li { margin: 4px 0; }
  li > ul, li > ol { margin: 2px 0 2px 16px; }
  code {
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 52px;
    font-family: 'Consolas', 'Courier New', monospace;
    color: #e11d48;
  }
  pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    margin: 12px 0;
    font-size: 56px;
    font-family: 'Consolas', 'Courier New', monospace;
    overflow-x: auto;
  }
  pre code {
    background: none;
    padding: 0;
    color: #334155;
  }
  blockquote {
    border-left: 4px solid #0d9488;
    background: #f0fdfa;
    padding: 12px 16px;
    margin: 12px 0;
    border-radius: 0 8px 8px 0;
    color: #475569;
    font-size: 64px;
  }
  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 16px 0;
  }
  a { color: #0d9488; text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { font-weight: 600; color: #0f172a; }
  em { font-style: italic; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12px 0;
  }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 12px 16px;
    text-align: left;
    font-size: 60px;
  }
  th { background: #f8fafc; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
</style>
${fadeAnimation}
</head>
<body>
${htmlContent}
</body>
</html>`;

    fs.writeFileSync(tmpFile, fullHtml, 'utf-8');

    const safeTitle = title.replace(/'/g, "''").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeIcon = icon.replace(/'/g, "''");
    const escapedTmpFile = tmpFile.replace(/\\/g, '/');
    const escapedTmpFileDouble = tmpFile.replace(/\\/g, '\\\\');

    const isBottomRight = position && position.trim().toLowerCase() === 'bottom-right';
    logger.info(`Popup position: "${position}", isBottomRight: ${isBottomRight}`);
    const formPosition = isBottomRight
      ? [
          '$screen = [System.Windows.Forms.Screen]::PrimaryScreen',
          '$workArea = $screen.WorkingArea',
          '$formWidth = 700',
          '$formHeight = 600',
          `$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual`,
          `$form.Size = New-Object System.Drawing.Size($formWidth, $formHeight)`,
          `$form.Location = New-Object System.Drawing.Point(($workArea.Right - $formWidth - 20), ($workArea.Bottom - $formHeight - 20))`,
        ].join('\n')
      : [
          '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
          '$form.ClientSize = New-Object System.Drawing.Size(1200, 900)',
        ].join('\n');

    const psCommand = [
      '# Enable high DPI support',
      "Add-Type -TypeDefinition '",
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class DPIHelper {',
      '  [DllImport("user32.dll")]',
      '  public static extern bool SetProcessDPIAware();',
      '}',
      "'",
      '[DPIHelper]::SetProcessDPIAware() | Out-Null',
      '',
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '[System.Windows.Forms.Application]::EnableVisualStyles()',
      '',
      "Add-Type -TypeDefinition '",
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class NativeMethods {',
      '  [DllImport("user32.dll")]',
      '  public static extern bool SetForegroundWindow(IntPtr hWnd);',
      '}',
      "'",
      '',
      '$form = New-Object System.Windows.Forms.Form',
      `$form.Text = '${safeTitle}'`,
      formPosition,
      '$form.TopMost = $true',
      '$form.MinimizeBox = $false',
      '$form.MaximizeBox = $false',
      '$form.BackColor = [System.Drawing.Color]::FromArgb(255, 255, 255)',
      '$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::SizableToolWindow',
      '',
      '$layoutTable = New-Object System.Windows.Forms.TableLayoutPanel',
      '$layoutTable.Dock = [System.Windows.Forms.DockStyle]::Fill',
      '$layoutTable.ColumnCount = 1',
      '$layoutTable.RowCount = 2',
      '$layoutTable.RowStyles.Clear()',
      '$layoutTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 80)))',
      '$layoutTable.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 100)))',
      '$layoutTable.Padding = New-Object System.Windows.Forms.Padding(15)',
      '$form.Controls.Add($layoutTable)',
      '',
      '$iconLabel = New-Object System.Windows.Forms.Label',
      `$iconLabel.Text = '${safeIcon}'`,
      "$iconLabel.Font = New-Object System.Drawing.Font('Segoe UI Emoji', 72)",
      '$iconLabel.ForeColor = [System.Drawing.Color]::FromArgb(24, 144, 255)',
      '$iconLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter',
      '$iconLabel.Dock = [System.Windows.Forms.DockStyle]::Fill',
      '$layoutTable.Controls.Add($iconLabel, 0, 0)',
      '',
      '$browser = New-Object System.Windows.Forms.WebBrowser',
      '$browser.ScriptErrorsSuppressed = $true',
      '$browser.ScrollBarsEnabled = $true',
      '$browser.Dock = [System.Windows.Forms.DockStyle]::Fill',
      `$browser.Navigate('file://${escapedTmpFile}')`,
      '$layoutTable.Controls.Add($browser, 0, 1)',
      '',
      '$form.Add_Shown({ $form.Activate(); [NativeMethods]::SetForegroundWindow($form.Handle) })',
      '$form.KeyPreview = $true',
      "$form.Add_KeyDown({ if ($_.KeyCode -eq 'Escape') { $form.Close() } })",
      '$browser.Add_DoubleClick({ $form.Close() })',
      '[System.Windows.Forms.Application]::Run($form)',
      `Remove-Item -Path '${escapedTmpFileDouble}' -Force -ErrorAction SilentlyContinue`,
    ].join('\n');

    return new Promise<void>((resolve, reject) => {
      const proc = spawn('powershell.exe', [
        '-NoProfile',
        '-WindowStyle', 'Normal',
        '-Command', psCommand,
      ], {
        timeout: 120000,
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0 || code === null) {
          logger.info(`Popup displayed: ${title}`);
          resolve();
        } else {
          reject(new Error(`Popup failed (exit ${code}): ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to show popup: ${err.message}`));
      });
    });
  }

  private async getAiConfig() {
    const rows = await this.db.queryAll(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?)',
      ['ai_api_url', 'ai_api_key', 'ai_model', 'ai_enable_web_search', 'serpapi_key']
    ) as { key: string; value: string }[];

    const configMap: Record<string, string> = {};
    for (const row of rows) {
      configMap[row.key] = row.value;
    }

    return {
      aiApiUrl: configMap.ai_api_url || '',
      aiApiKey: configMap.ai_api_key || '',
      aiModel: configMap.ai_model || 'deepseek-v4-pro',
      aiEnableWebSearch: configMap.ai_enable_web_search === 'true' || configMap.ai_enable_web_search === '1',
      serpapiKey: configMap.serpapi_key || '',
    };
  }

  removeTask(taskId: string) {
    const scheduled = this.scheduledTasks.get(taskId);
    if (scheduled) {
      scheduled.task.stop();
      this.scheduledTasks.delete(taskId);
      logger.info(`Removed scheduled task: ${taskId}`);
    }
    this.clearRetry(taskId);
  }

  stop() {
    for (const [, { task }] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    this.clearPendingRetries();
    logger.info('All scheduled tasks stopped');
  }

  getScheduledTaskCount(): number {
    return this.scheduledTasks.size;
  }

  private async updateNextRun(taskId: string, nextRunAt: string | null) {
    await this.db.run('UPDATE tasks SET next_run_at = ? WHERE id = ?', [nextRunAt, taskId]);
  }

  private scheduleRetry(taskId: string, delayMs: number) {
    this.clearRetry(taskId);
    const timeout = setTimeout(async () => {
      this.pendingRetries.delete(taskId);
      const latestTask = await this.db.querySingle('SELECT * FROM tasks WHERE id = ?', [taskId]) as TaskRow | null;
      if (!latestTask || !latestTask.enabled) {
        return;
      }

      logger.info(`Retrying task: ${latestTask.name} (${latestTask.id})`);
      await this.executeTask(latestTask);
    }, delayMs);

    this.pendingRetries.set(taskId, timeout);
  }

  private clearRetry(taskId: string) {
    const pendingRetry = this.pendingRetries.get(taskId);
    if (pendingRetry) {
      clearTimeout(pendingRetry);
      this.pendingRetries.delete(taskId);
    }
  }

  private clearPendingRetries() {
    for (const [, timeout] of this.pendingRetries) {
      clearTimeout(timeout);
    }
    this.pendingRetries.clear();
  }
}
