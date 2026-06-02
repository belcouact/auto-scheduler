import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

sqlite3.verbose();

const Database = sqlite3.Database;

export interface TaskRow {
  id: string;
  name: string;
  description: string;
  type: 'script' | 'popup' | 'webhook' | 'system' | 'ai_search';
  enabled: number;
  schedule_type: string;
  schedule_expression: string;
  script_path: string | null;
  script_args: string | null;
  popup_title: string | null;
  popup_content: string | null;
  popup_icon: string | null;
  popup_position: string | null;
  popup_auto_dismiss: number | null;
  webhook_url: string | null;
  webhook_method: string | null;
  webhook_headers: string | null;
  webhook_body: string | null;
  system_action: string | null;
  ai_search_query: string | null;
  ai_search_count: number | null;
  ai_enable_web_search: number | null;
  popup_mode: string | null;
  priority: number;
  tags: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
  retry_count: number;
  max_retries: number;
  timeout_seconds: number;
}

export interface HistoryRow {
  id: string;
  task_id: string;
  task_name: string;
  status: string;
  output: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

export class DatabaseService {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    await this.runPragma('PRAGMA journal_mode = WAL');
    await this.runPragma('PRAGMA foreign_keys = ON');

    await this.dbExec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        type TEXT NOT NULL CHECK(type IN ('script', 'popup', 'webhook', 'system', 'ai_search')),
        enabled INTEGER NOT NULL DEFAULT 1,
        schedule_type TEXT NOT NULL DEFAULT 'once',
        schedule_expression TEXT NOT NULL,
        script_path TEXT,
        script_args TEXT,
        popup_title TEXT,
        popup_content TEXT,
        popup_icon TEXT,
        popup_position TEXT DEFAULT 'center',
        popup_auto_dismiss INTEGER DEFAULT 0,
        webhook_url TEXT,
        webhook_method TEXT DEFAULT 'GET',
        webhook_headers TEXT,
        webhook_body TEXT,
        system_action TEXT,
        ai_search_query TEXT,
        ai_search_count INTEGER DEFAULT 10,
        ai_enable_web_search INTEGER DEFAULT 1,
        popup_mode TEXT DEFAULT 'fixed',
        priority INTEGER NOT NULL DEFAULT 0,
        tags TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_run_at TEXT,
        last_run_status TEXT,
        next_run_at TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        timeout_seconds INTEGER NOT NULL DEFAULT 300
      );

      CREATE TABLE IF NOT EXISTS execution_history (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(enabled);
      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_history_task_id ON execution_history(task_id);
      CREATE INDEX IF NOT EXISTS idx_history_started_at ON execution_history(started_at);
    `);

    try {
      await this.dbRun('ALTER TABLE tasks ADD COLUMN ai_search_query TEXT');
      await this.dbRun('ALTER TABLE tasks ADD COLUMN ai_search_count INTEGER DEFAULT 10');
      logger.info('Added ai_search_query and ai_search_count columns to tasks table');
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) {
        logger.debug('AI search columns already exist');
      }
    }

    try {
      await this.dbRun("ALTER TABLE tasks ADD COLUMN popup_position TEXT DEFAULT 'center'");
      await this.dbRun('ALTER TABLE tasks ADD COLUMN popup_auto_dismiss INTEGER DEFAULT 0');
      logger.info('Added popup_position and popup_auto_dismiss columns to tasks table');
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) {
        logger.debug('Popup position columns already exist');
      }
    }

    try {
      await this.dbRun('ALTER TABLE tasks ADD COLUMN ai_enable_web_search INTEGER DEFAULT 1');
      logger.info('Added ai_enable_web_search column to tasks table');
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) {
        logger.debug('AI web search column already exists');
      }
    }

    try {
      await this.dbRun("ALTER TABLE tasks ADD COLUMN popup_mode TEXT DEFAULT 'fixed'");
      logger.info('Added popup_mode column to tasks table');
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) {
        logger.debug('Popup mode column already exists');
      }
    }

    try {
      const row = await this.dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'") as { sql: string } | null;

      if (row && !row.sql.includes("ai_search'")) {
        await this.dbExec('PRAGMA foreign_keys = OFF');
        await this.dbExec(`
          BEGIN TRANSACTION;
          ALTER TABLE tasks RENAME TO tasks_old;
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            type TEXT NOT NULL CHECK(type IN ('script', 'popup', 'webhook', 'system', 'ai_search')),
            enabled INTEGER NOT NULL DEFAULT 1,
            schedule_type TEXT NOT NULL DEFAULT 'once',
            schedule_expression TEXT NOT NULL,
            script_path TEXT,
            script_args TEXT,
            popup_title TEXT,
            popup_content TEXT,
            popup_icon TEXT,
            webhook_url TEXT,
            webhook_method TEXT DEFAULT 'GET',
            webhook_headers TEXT,
            webhook_body TEXT,
            system_action TEXT,
            ai_search_query TEXT,
            ai_search_count INTEGER DEFAULT 10,
            ai_enable_web_search INTEGER DEFAULT 1,
            popup_mode TEXT DEFAULT 'fixed',
            priority INTEGER NOT NULL DEFAULT 0,
            tags TEXT DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_run_at TEXT,
            last_run_status TEXT,
            next_run_at TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 3,
            timeout_seconds INTEGER NOT NULL DEFAULT 300
          );
          INSERT INTO tasks SELECT id, name, description, type, enabled, schedule_type, schedule_expression, script_path, script_args, popup_title, popup_content, popup_icon, popup_position, popup_auto_dismiss, webhook_url, webhook_method, webhook_headers, webhook_body, system_action, ai_search_query, ai_search_count, ai_enable_web_search, popup_mode, priority, tags, created_at, updated_at, last_run_at, last_run_status, next_run_at, retry_count, max_retries, timeout_seconds FROM tasks_old;
          DROP TABLE tasks_old;
          CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(enabled);
          CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
          COMMIT;
        `);
        await this.dbExec('PRAGMA foreign_keys = ON');
        logger.info('Rebuilt tasks table with ai_search type support');
      }
    } catch (e: any) {
      logger.debug('Tasks table already updated or rebuild failed: ' + e.message);
    }

    const defaults = [
      ['ai_api_url', ''],
      ['ai_api_key', ''],
      ['ai_model', 'gpt-4o-mini'],
      ['notification_sound', 'true'],
      ['default_timeout', '300'],
    ];

    for (const [key, value] of defaults) {
      await this.dbRun('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  getDb(): Database {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  async queryAll(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async querySingle(sql: string, params: any[] = []): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async dbRun(sql: string, params: any[] = []): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async dbGet(sql: string, params: any[] = []): Promise<any> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private async dbExec(sql: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async runPragma(sql: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return new Promise((resolve, reject) => {
      this.db!.run(sql, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
