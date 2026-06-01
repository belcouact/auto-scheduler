import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseService, SettingsRow } from '../database.js';
import * as fs from 'fs';
import * as path from 'path';

export function settingsRouter(db: DatabaseService) {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await db.queryAll('SELECT * FROM settings') as SettingsRow[];

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

      if (!settings || typeof settings !== 'object') {
        throw new Error('Settings must be an object');
      }

      const now = new Date().toISOString();
      
      for (const [key, value] of Object.entries(settings)) {
        const existing = await db.querySingle('SELECT key FROM settings WHERE key = ?', [key]);
        if (existing) {
          await db.run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [String(value), now, key]);
        } else {
          await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, String(value), now]);
        }
      }

      res.json({ message: 'Settings updated successfully' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
