import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

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
  webhook_url: string | null;
  webhook_method: string | null;
  webhook_headers: string | null;
  webhook_body: string | null;
  system_action: string | null;
  ai_search_query: string | null;
  ai_search_count: number | null;
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
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  initialize() {
    this.db.exec(`
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
        webhook_url TEXT,
        webhook_method TEXT DEFAULT 'GET',
        webhook_headers TEXT,
        webhook_body TEXT,
        system_action TEXT,
        ai_search_query TEXT,
        ai_search_count INTEGER DEFAULT 10,
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
      this.db.prepare('ALTER TABLE tasks ADD COLUMN ai_search_query TEXT').run();
      this.db.prepare('ALTER TABLE tasks ADD COLUMN ai_search_count INTEGER DEFAULT 10').run();
      logger.info('Added ai_search_query and ai_search_count columns to tasks table');
    } catch (e: any) {
      if (!e.message.includes('duplicate column')) {
        logger.debug('AI search columns already exist');
      }
    }

    try {
      const stmt = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get() as { sql: string };
      if (stmt && !stmt.sql.includes("ai_search'")) {
        const dbPath = this.db.pragma('database_list', { simple: true });
        const filePath = Array.isArray(dbPath) ? dbPath[0]?.file : (dbPath as any)?.file;
        
        this.db.exec('PRAGMA foreign_keys = OFF');
        this.db.exec(`
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
          INSERT INTO tasks SELECT id, name, description, type, enabled, schedule_type, schedule_expression, script_path, script_args, popup_title, popup_content, popup_icon, webhook_url, webhook_method, webhook_headers, webhook_body, system_action, ai_search_query, ai_search_count, priority, tags, created_at, updated_at, last_run_at, last_run_status, next_run_at, retry_count, max_retries, timeout_seconds FROM tasks_old;
          DROP TABLE tasks_old;
          CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON tasks(enabled);
          CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
          COMMIT;
        `);
        this.db.exec('PRAGMA foreign_keys = ON');
        logger.info('Rebuilt tasks table with ai_search type support');
        
        this.db.close();
        this.db = new Database(filePath as string);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        logger.info('Reconnected to database to clear cached statements');
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

    const stmt = this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    const insertMany = this.db.transaction((rows: [string, string][]) => {
      for (const [key, value] of rows) {
        stmt.run(key, value);
      }
    });
    insertMany(defaults);
  }

  getDb(): Database.Database {
    return this.db;
  }

  queryAll(sql: string, params: any[] = []): any[] {
    return this.db.prepare(sql).all(...params);
  }

  querySingle(sql: string, params: any[] = []): any {
    return this.db.prepare(sql).get(...params);
  }

  run(sql: string, params: any[] = []): Database.RunResult {
    return this.db.prepare(sql).run(...params);
  }

  close() {
    this.db.close();
  }
}
