import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseService, HistoryRow } from '../database.js';

export function historyRouter(db: DatabaseService) {
  const router = Router();

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { task_id, status, limit = 50, offset = 0 } = req.query;

      let query = 'SELECT * FROM execution_history';
      const conditions: string[] = [];
      const params: any[] = [];

      if (task_id) {
        conditions.push('task_id = ?');
        params.push(task_id);
      }

      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(String(limit), 10), parseInt(String(offset), 10));

      const history = await db.queryAll(query, params) as HistoryRow[];

      const countQuery = task_id || status
        ? `SELECT COUNT(*) as total FROM execution_history WHERE ${conditions.join(' AND ')}`
        : 'SELECT COUNT(*) as total FROM execution_history';

      const countParams = task_id || status ? params.slice(0, -2) : [];
      const countResult = await db.querySingle(countQuery, countParams) as { total: number } | null;
      const total = countResult?.total || 0;

      res.json({
        data: history,
        pagination: {
          total,
          limit: parseInt(String(limit), 10),
          offset: parseInt(String(offset), 10),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await db.querySingle(`
        SELECT 
          COUNT(*) as total_executions,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
          AVG(duration_ms) as avg_duration_ms
        FROM execution_history
      `) as any;

      const recentByStatus = await db.queryAll(`
        SELECT status, COUNT(*) as count 
        FROM execution_history 
        WHERE started_at >= datetime('now', '-7 days')
        GROUP BY status
      `) as any[];

      const topTasks = await db.queryAll(`
        SELECT h.task_id, t.name, COUNT(*) as execution_count,
          SUM(CASE WHEN h.status = 'success' THEN 1 ELSE 0 END) as success_count
        FROM execution_history h
        JOIN tasks t ON h.task_id = t.id
        GROUP BY h.task_id
        ORDER BY execution_count DESC
        LIMIT 10
      `) as any[];

      res.json({
        data: {
          stats,
          recentByStatus,
          topTasks,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/batch', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'No IDs provided' });
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      await db.run(`DELETE FROM execution_history WHERE id IN (${placeholders})`, ids);
      res.json({ message: `Deleted ${ids.length} records` });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/clear', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { older_than_days } = req.body;

      if (older_than_days) {
        await db.run(`
          DELETE FROM execution_history 
          WHERE started_at < datetime('now', ?)
        `, [`-${older_than_days} days`]);
      } else {
        await db.run('DELETE FROM execution_history');
      }

      res.json({ message: 'History cleared' });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
