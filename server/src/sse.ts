import { Response, Request, NextFunction } from 'express';
import logger from './logger.js';

interface Client {
  id: string;
  res: Response;
  write: (chunk: string) => boolean;
}

export interface PopUpEvent {
  type: 'popup';
  id: string;
  title: string;
  content: string;
  icon: string;
  timestamp: string;
  taskId: string;
  taskName: string;
}

export class SSEManager {
  private clients: Map<string, Client> = new Map();
  private nextId = 0;

  addClient(req: Request, res: Response, _next: NextFunction) {
    const id = `client_${++this.nextId}`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(':\n');

    const client: Client = {
      id,
      res,
      write: (chunk) => res.write(chunk),
    };

    this.clients.set(id, client);
    logger.info(`SSE client connected: ${id} (total: ${this.clients.size})`);

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(id);
      res.end();
      logger.info(`SSE client disconnected: ${id} (total: ${this.clients.size})`);
    });

    req.on('error', () => {
      clearInterval(heartbeat);
      this.clients.delete(id);
      res.end();
    });
  }

  emit(event: PopUpEvent) {
    const data = JSON.stringify(event);
    const message = `event: popup\ndata: ${data}\n\n`;

    const deadClients: string[] = [];

    for (const [id, client] of this.clients) {
      const ok = client.write(message);
      if (!ok) {
        deadClients.push(id);
      }
    }

    for (const id of deadClients) {
      this.clients.delete(id);
    }

    logger.info(`SSE event emitted to ${this.clients.size} clients: ${event.title}`);
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const sseManager = new SSEManager();
