import { createApp } from './app.js';

try {
  const { app, db } = await createApp();
  const port = Number(process.env.PORT || 4000);
  const host = process.env.HOST || '127.0.0.1';
  const server = app.listen(port, host, () => console.log(`MongoDB connected. Auth API running at http://${host}:${port}`));
  server.on('error', async error => {
    console.error(`API could not listen: ${error.code || 'unknown error'}`);
    await db.close(); process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => { await db.close(); process.exit(0); }));
  }
} catch {
  console.error('Startup failed. Check that MongoDB is running and MONGODB_URI is configured correctly.');
  process.exitCode = 1;
}
