import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { env } from '../config/env.js';

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  throw new Error('Usage: pnpm db:migrate | pnpm db:rollback');
}

if (direction === 'down' && env.NODE_ENV === 'production') {
  console.error(
    'Production database rollback is disabled. Do not run migration down operations in production; use an explicitly reviewed recovery procedure.',
  );
  process.exitCode = 1;
} else {
  const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
  const databaseUrl = env.DATABASE_SSL
    ? { connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: true } }
    : env.DATABASE_URL;

  await runner({
    databaseUrl,
    dir: migrationsDirectory,
    migrationsTable: 'pgmigrations',
    direction,
    count: direction === 'down' ? 'all' : undefined,
    singleTransaction: true,
    verbose: false,
  });
}
