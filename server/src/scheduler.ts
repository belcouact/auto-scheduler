import cron from 'node-cron';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseService, TaskRow } from './database.js';
import { sseManager } from './sse.js';
import logger from './logger.js';

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface ScheduledTask {
  task: cron.ScheduledTask;
  id: string;
}

export class SchedulerService {
  private db: DatabaseService;
  private scheduledTasks: Map<string, ScheduledTask> = new Map();

  constructor(db: DatabaseService) {
    this.db = db;
  }

  async start() {
    logger.info(`Using local timezone: ${localTimezone}`);
    const tasks = this.db.getDb().prepare(`
      SELECT * FROM tasks WHERE enabled = 1
    `).all() as TaskRow[];

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

    const tasks = this.db.getDb().prepare(`
      SELECT * FROM tasks WHERE enabled = 1
    `).all() as TaskRow[];

    for (const task of tasks) {
      this.scheduleTask(task);
    }

    logger.info(`Rescheduled ${tasks.length} tasks`);
  }

  private scheduleTask(task: TaskRow) {
    let cronExpression: string;

    switch (task.schedule_type) {
      case 'once':
        this.scheduleOnce(task);
        return;
      case 'cron':
        cronExpression = task.schedule_expression;
        break;
      case 'daily':
        cronExpression = this.parseDaily(task.schedule_expression);
        break;
      case 'weekly':
        cronExpression = this.parseWeekly(task.schedule_expression);
        break;
      case 'monthly':
        cronExpression = this.parseMonthly(task.schedule_expression);
        break;
      case 'hourly':
        cronExpression = this.parseHourly(task.schedule_expression);
        break;
      default:
        logger.warn(`Unknown schedule type: ${task.schedule_type}`);
        return;
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
    const [dateStr, timeStr] = task.schedule_expression.split(' ');
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute, second] = timeStr.split(':').map(Number);

    const runTime = new Date(year, month - 1, day, hour, minute, second || 0);
    const now = new Date();

    if (runTime <= now) {
      logger.warn(`Task ${task.name} has a past run time: ${task.schedule_expression}`);
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

  private parseDaily(expression: string): string {
    const time = expression.split(' ');
    if (time.length === 2) {
      return `${time[1]} ${time[0]} * * *`;
    }
    return '0 9 * * *';
  }

  private parseWeekly(expression: string): string {
    const parts = expression.split(' ');
    if (parts.length >= 3) {
      return `${parts[2]} ${parts[1]} ${parts[0]} * *`;
    }
    return '0 9 * * 1';
  }

  private parseMonthly(expression: string): string {
    const parts = expression.split(' ');
    if (parts.length >= 3) {
      return `${parts[2]} ${parts[1]} * ${parts[0]} *`;
    }
    return '0 9 1 * *';
  }

  private parseHourly(expression: string): string {
    const minute = parseInt(expression, 10);
    if (!isNaN(minute) && minute >= 0 && minute <= 59) {
      return `${minute} * * * *`;
    }
    return '0 * * * *';
  }

  async executeTask(task: TaskRow) {
    const historyId = randomUUID();
    const startedAt = new Date().toISOString();

    this.db.getDb().prepare(`
      INSERT INTO execution_history (id, task_id, task_name, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `).run(historyId, task.id, task.name, startedAt);

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

      this.db.getDb().prepare(`
        UPDATE execution_history 
        SET status = 'success', output = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `).run(output, completedAt, durationMs, historyId);

      this.db.getDb().prepare(`
        UPDATE tasks 
        SET last_run_at = ?, last_run_status = 'success', retry_count = 0
        WHERE id = ?
      `).run(completedAt, task.id);

      logger.info(`Task "${task.name}" completed successfully`);
    } catch (error) {
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.db.getDb().prepare(`
        UPDATE execution_history 
        SET status = 'error', error_message = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `).run(errorMessage, completedAt, durationMs, historyId);

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

    await this.showNativePopup(title, content, icon);

    return content;
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

    const aiConfig = this.getAiConfig();
    if (!aiConfig.aiApiUrl || !aiConfig.aiApiKey) {
      throw new Error('AI API not configured. Please configure AI API URL and API key in settings.');
    }

    const searchCount = task.ai_search_count || 10;
    const searchQuery = task.ai_search_query;

    const searchPrompt = `You are a web search assistant. Based on the user's query, provide a summary of the most important and recent findings.
Return your response as a numbered list with exactly ${searchCount} items.
Each item should have:
1. A concise headline/title
2. A brief 1-2 sentence summary
3. Key takeaway

Format exactly like this:
1. **Headline 1**
   Summary: brief description
   Key: main takeaway

2. **Headline 2**
   Summary: brief description
   Key: main takeaway

User query: ${searchQuery}

Provide exactly ${searchCount} items. Be factual and concise.`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), task.timeout_seconds * 1000);

    try {
      const messages: any[] = [
        { role: 'system', content: 'You are a helpful research assistant that provides accurate and up-to-date information.' },
        { role: 'user', content: searchPrompt },
      ];

      const requestBody: any = {
        model: aiConfig.aiModel,
        messages,
        temperature: 0.5,
        max_tokens: 4000,
        search_enabled: aiConfig.aiEnableWebSearch,
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

      await this.showPopupWithContentNative(title, finalContent, icon);

      return finalContent;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async showNativePopup(title: string, content: string, icon: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `popup_${randomUUID()}.txt`);
    fs.writeFileSync(tmpFile, content, 'utf-8');

    const safeTitle = title.replace(/'/g, "''").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const psCommand = `
$content = [System.IO.File]::ReadAllText('${tmpFile}')
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
public class NativeMethods {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("dwmapi.dll")]
  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
}
'
$window = New-Object System.Windows.Window
$window.Title = '${safeTitle}'
$window.Width = 460
$window.Height = 300
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::CenterScreen
$window.Topmost = $true
$window.ResizeMode = 'NoResize'
$window.WindowStyle = 'SingleBorderWindow'
$window.Background = [System.Windows.Media.Brushes]::White
$window.AllowsTransparency = $false

# Enable rounded corners and shadow via DWM
$hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($window)).Handle
$DWMWA_WINDOW_CORNER_PREFERENCE = 33
$DWMWCP_ROUND = 2
[NativeMethods]::DwmSetWindowAttribute($hwnd, $DWMWA_WINDOW_CORNER_PREFERENCE, [ref]$DWMWCP_ROUND, 4) | Out-Null

$grid = New-Object System.Windows.Controls.Grid
$margin = New-Object System.Windows.Thickness(30, 25, 30, 25)
$grid.Margin = $margin
$window.Content = $grid

$stack = New-Object System.Windows.Controls.StackPanel
$stack.HorizontalAlignment = 'Center'
$stack.VerticalAlignment = 'Center'
$grid.Children.Add($stack) | Out-Null

$iconText = New-Object System.Windows.Controls.TextBlock
$iconText.Text = '${icon.replace(/'/g, "''")}'
$iconText.FontSize = 36
$iconText.HorizontalAlignment = 'Center'
$iconText.Margin = New-Object System.Windows.Thickness(0, 0, 0, 16)
$stack.Children.Add($iconText) | Out-Null

$msgText = New-Object System.Windows.Controls.TextBlock
$msgText.Text = $content
$msgText.FontSize = 15
$msgText.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei')
$msgText.Foreground = [System.Windows.Media.Brushes]::FromRgb(31, 41, 55)
$msgText.TextAlignment = 'Center'
$msgText.TextWrapping = 'Wrap'
$msgText.MaxWidth = 380
$msgText.HorizontalAlignment = 'Center'
$msgText.Margin = New-Object System.Windows.Thickness(0, 0, 0, 24)
$stack.Children.Add($msgText) | Out-Null

$btn = New-Object System.Windows.Controls.Button
$btn.Content = '  确定  '
$btn.Width = 100
$btn.Height = 36
$btn.FontSize = 14
$btn.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei')
$btn.HorizontalAlignment = 'Center'
$btn.Foreground = [System.Windows.Media.Brushes]::White
$btn.Background = [System.Windows.Media.Brushes]::FromRgb(24, 144, 255)
$btn.BorderThickness = New-Object System.Windows.Thickness(0)
$btn.Padding = New-Object System.Windows.Thickness(0)
$btn.Cursor = 'Hand'
$btn.Add_Click({ $window.Close() })
$stack.Children.Add($btn) | Out-Null

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

  private async showPopupWithContentNative(title: string, content: string, icon: string): Promise<void> {
    const tmpFile = path.join(os.tmpdir(), `popup_${randomUUID()}.txt`);
    fs.writeFileSync(tmpFile, content, 'utf-8');

    const psCommand = `
$content = [System.IO.File]::ReadAllText('${tmpFile}')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class NativeMethods {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'
$form = New-Object System.Windows.Forms.Form
$form.Text = '${title.replace(/'/g, "''")}'
$form.Size = New-Object System.Drawing.Size(600, 500)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.TopMost = $true
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ControlBox = $true
$form.BackColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9)

$mainPanel = New-Object System.Windows.Forms.Panel
$mainPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
$mainPanel.Padding = New-Object System.Windows.Forms.Padding(15)
$form.Controls.Add($mainPanel)

$iconLabel = New-Object System.Windows.Forms.Label
$iconLabel.Text = '${icon.replace(/'/g, "''")}'
$iconLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei', 24)
$iconLabel.ForeColor = [System.Drawing.Color]::FromArgb(24, 144, 255)
$iconLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$iconLabel.Dock = [System.Windows.Forms.DockStyle]::Top
$iconLabel.Height = 50
$mainPanel.Controls.Add($iconLabel)

$textBox = New-Object System.Windows.Forms.RichTextBox
$textBox.Text = $content
$textBox.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9.5)
$textBox.ReadOnly = $true
$textBox.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$textBox.BackColor = [System.Drawing.Color]::White
$textBox.Dock = [System.Windows.Forms.DockStyle]::Fill
$textBox.ScrollBars = [System.Windows.Forms.RichTextBoxScrollBars]::Vertical
$mainPanel.Controls.Add($textBox)

$btn = New-Object System.Windows.Forms.Button
$btn.Text = '  关闭  '
$btn.Size = New-Object System.Drawing.Size(100, 32)
$btn.DialogResult = [System.Windows.Forms.DialogResult]::OK
$btn.BackColor = [System.Drawing.Color]::FromArgb(24, 144, 255)
$btn.ForeColor = [System.Drawing.Color]::White
$btn.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$btn.FlatAppearance.BorderSize = 0
$btn.Font = New-Object System.Drawing.Font('Microsoft YaHei', 10)
$btn.Anchor = 'Bottom'
$form.Controls.Add($btn)
Add-Member -InputObject $btn -MemberType ScriptMethod -Name SetBoundsCore -Value {
  param($x, $y, $width, $height, $specified)
  $y = $form.ClientSize.Height - $height - 15
  $x = ($form.ClientSize.Width - $width) / 2
  [System.Windows.Forms.Control].GetMethod('SetBoundsCore', [System.Reflection.BindingFlags]'NonPublic, Instance').Invoke($this, @($x, $y, $width, $height, $specified))
} -Force

$form.Add_Shown({ [NativeMethods]::SetForegroundWindow($form.Handle) })
$result = $form.ShowDialog()
Remove-Item -Path '${tmpFile}' -Force -ErrorAction SilentlyContinue
`;

    return new Promise<void>((resolve, reject) => {
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

  private getAiConfig() {
    const rows = this.db.queryAll(
      'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)',
      ['ai_api_url', 'ai_api_key', 'ai_model', 'ai_enable_web_search']
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
    };
  }

  removeTask(taskId: string) {
    const scheduled = this.scheduledTasks.get(taskId);
    if (scheduled) {
      scheduled.task.stop();
      this.scheduledTasks.delete(taskId);
      logger.info(`Removed scheduled task: ${taskId}`);
    }
  }

  stop() {
    for (const [, { task }] of this.scheduledTasks) {
      task.stop();
    }
    this.scheduledTasks.clear();
    logger.info('All scheduled tasks stopped');
  }
}
