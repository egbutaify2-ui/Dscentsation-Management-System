import { createApp } from './app.js';
import { env } from './config/env.js';
import { assertDatabaseReady, pool } from './db/pool.js';

async function main(): Promise<void> {
  await assertDatabaseReady();
  const server = createApp().listen(env.PORT, () => {
    console.info(`DMS API listening on port ${env.PORT}.`);
  });

  const shutdown = (signal: string): void => {
    console.info(`Received ${signal}; shutting down DMS API.`);
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => {
      console.error('Forced shutdown after the graceful shutdown window.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(async (error: unknown) => {
  console.error('DMS API failed to start.', {
    message: error instanceof Error ? error.message : 'Unknown startup error',
  });
  await pool.end();
  process.exitCode = 1;
});
