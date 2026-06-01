import path from 'path';

const isDev = process.env.NODE_ENV !== 'production';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  corsOrigin: isDev 
    ? (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175']) 
    : process.env.FRONTEND_URL || '',
  databasePath: path.join(process.cwd(), 'data', 'scheduler.db'),
  isProduction: !isDev,
  aiApiUrl: process.env.AI_API_URL || '',
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
};
