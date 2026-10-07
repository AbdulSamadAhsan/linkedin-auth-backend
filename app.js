import express from 'express';
import { createApp } from './src/app.js';

// Reuse the application and MongoDB pool across warm Vercel invocations.
let application;
const app = express();
app.use(async (req, res, next) => {
  if (!process.env.MONGODB_URI || !process.env.FRONTEND_ORIGINS) {
    return res.status(503).json({ message: 'Deployment configuration is incomplete.' });
  }
  try {
    application ||= createApp({ secureCookies: true }).catch(error => {
      application = undefined;
      throw error;
    });
    const service = await application;
    return service.app(req, res, next);
  } catch {
    res.status(503).json({ message: 'The database is temporarily unavailable. Please try again later.' });
  }
});
export default app;
