import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseService, SettingsRow } from '../database.js';
import * as fs from 'fs';
import * as path from 'path';

export function settingsRouter(db: DatabaseService) {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const database = db.getDb();
      const settings = database.prepare('SELECT * FROM settings').all() as SettingsRow[];

      const settingsObj: Record<string, string> = {};
      for (const setting of settings) {
        settingsObj[setting.key] = setting.value;
      }

      res.json({ data: settingsObj });
    } catch (error) {
      next(error);
    }
  });

  router.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lines = 200 } = req.query;
      const logFile = path.join(process.cwd(), 'logs', 'combined.log');
      const numLines = parseInt(String(lines), 10);

      if (!fs.existsSync(logFile)) {
        res.json({ data: [] });
        return;
      }

      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n').filter(line => line.trim());
      const recentLines = allLines.slice(-numLines);

      const parsed = recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });

      res.json({ data: parsed });
    } catch (error) {
      next(error);
    }
  });

  router.put('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { settings } = req.body;
      const database = db.getDb();

      if (!settings || typeof settings !== 'object') {
        throw new Error('Settings must be an object');
      }

      const now = new Date().toISOString();
      const upsertStmt = database.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);

      const upsertMany = database.transaction((entries: [string, string][]) => {
        for (const [key, value] of entries) {
          upsertStmt.run(key, String(value), now);
        }
      });

      upsertMany(Object.entries(settings));

      res.json({ message: 'Settings updated successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
