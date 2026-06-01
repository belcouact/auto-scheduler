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
import { calculateNextRun, getCronExpression, parseLocalDateTime } from './schedule-utils.js';

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface ScheduledTask {
  task: cron.ScheduledTask;
  id: string;
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

    const aiConfig = await this.getAiConfig();
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
    const iconDeco = this.getIconDecorations(icon);
    const iconColor = this.getIconColor(icon);

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
$window.Width = 480
$window.Height = 320
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::CenterScreen
$window.Topmost = $true
$window.ResizeMode = 'NoResize'
$window.WindowStyle = 'SingleBorderWindow'
$window.Background = [System.Windows.Media.Brushes]::White
$window.AllowsTransparency = $false

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
$topBar.Margin = New-Object System.Windows.Thickness(0, 20, 0, 0)
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
$msgText.FontSize = 15
$msgText.FontFamily = New-Object System.Windows.Media.FontFamily('Segoe UI Emoji, Microsoft YaHei')
$msgText.Foreground = [System.Windows.Media.Brushes]::FromRgb(31, 41, 55)
$msgText.TextAlignment = 'Center'
$msgText.TextWrapping = 'Wrap'
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
$btn.FontSize = 15
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

  private async getAiConfig() {
    const rows = await this.db.queryAll(
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
