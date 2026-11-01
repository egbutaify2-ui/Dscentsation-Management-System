import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { env } from '../config/env.js';

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  throw new Error('Usage: pnpm db:migrate | pnpm db:rollback');
}

const migrationsDirectory = fileURLToPath(new URL('../../migrations/', import.meta.url));
const databaseUrl = env.DATABASE_SSL
  ? { connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: true } }
  : env.DATABASE_URL;

await runner({
  databaseUrl,
  dir: migrationsDirectory,
  migrationsTable: 'pgmigrations',
  direction,
  singleTransaction: true,
  verbose: false,
});
