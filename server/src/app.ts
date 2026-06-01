import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { DatabaseService } from './database.js';
import { SchedulerService } from './scheduler.js';
import { taskRouter } from './routes/tasks.js';
import { historyRouter } from './routes/history.js';
import { settingsRouter } from './routes/settings.js';
import { aiRouter } from './routes/ai.js';
import { sseManager } from './sse.js';
import { AppError } from './errors.js';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Server {
  private app = express();
  private db: DatabaseService;
  private scheduler: SchedulerService;

  constructor() {
    this.db = new DatabaseService(config.databasePath);
    this.scheduler = new SchedulerService(this.db);
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandler();
  }

  private setupMiddleware() {
    this.app.use(cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const allowedOrigins = Array.isArray(config.corsOrigin) ? config.corsOrigin : [config.corsOrigin];
        if (allowedOrigins.includes(origin) || config.corsOrigin === '*') {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      credentials: true,
    }));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    this.app.get('/api/status', async (_req: Request, res: Response) => {
      const totals = await this.db.querySingle(`
        SELECT
          COUNT(*) as total_tasks,
          SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_tasks,
          SUM(CASE WHEN last_run_status = 'error' THEN 1 ELSE 0 END) as failed_tasks
        FROM tasks
      `) as { total_tasks: number; enabled_tasks: number; failed_tasks: number } | null;

      res.json({
        data: {
          server: 'online',
          timestamp: new Date().toISOString(),
          clients: sseManager.getClientCount(),
          scheduledTasks: this.scheduler.getScheduledTaskCount(),
          totalTasks: totals?.total_tasks || 0,
          enabledTasks: totals?.enabled_tasks || 0,
          failedTasks: totals?.failed_tasks || 0,
        },
      });
    });

    this.app.get('/api/events', (req: Request, res: Response, next: NextFunction) => {
      sseManager.addClient(req, res, next);
    });

    this.app.use('/api/tasks', taskRouter(this.db, this.scheduler));
    this.app.use('/api/history', historyRouter(this.db));
    this.app.use('/api/settings', settingsRouter(this.db));
    this.app.use('/api/ai', aiRouter(this.db));

    if (config.isProduction) {
      this.app.use(express.static(path.join(__dirname, '../../client/dist')));
      this.app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
      });
    }
  }

  private setupErrorHandler() {
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AppError) {
        logger.warn(`${err.code}: ${err.message}`);
        return res.status(err.statusCode).json({
          code: err.code,
          message: err.message,
          details: err.details,
        });
      }

      logger.error(`Unexpected error: ${err.message}`, { stack: err.stack });
      return res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    });
  }

  async start() {
    try {
      await this.db.initialize();
      logger.info('Database initialized');

      await this.scheduler.start();
      logger.info('Scheduler started');

      this.app.listen(config.port, () => {
        logger.info(`Server running on port ${config.port}`);
      });
    } catch (error) {
      logger.error('Failed to start server', { error: error instanceof Error ? error.message : error, stack: error instanceof Error ? error.stack : undefined });
      process.exit(1);
    }
  }
}
