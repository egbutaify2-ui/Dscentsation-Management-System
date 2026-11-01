import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => {
  console.error('Unexpected idle PostgreSQL client error.', {
    name: error.name,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
  });
});

const requiredApplicationTables = [
  'roles',
  'permissions',
  'role_permissions',
  'users',
  'locations',
  'user_location_access',
  'user_sessions',
  'audit_logs',
  'product_categories',
  'products',
  'product_variants',
  'user_invitations',
] as const;

export async function assertDatabaseReady(): Promise<void> {
  const result = await pool.query<{ table_name: string; present: boolean }>(
    `
      SELECT required.table_name,
             to_regclass(format('public.%I', required.table_name)) IS NOT NULL AS present
      FROM unnest($1::text[]) AS required(table_name)
      ORDER BY required.table_name
    `,
    [requiredApplicationTables],
  );

  const missing = result.rows.filter((row) => !row.present).map((row) => row.table_name);

  if (missing.length > 0) {
    throw new Error(
      `Required application tables are missing: ${missing.join(', ')}. ` +
        'Run "pnpm db:migrate" before starting the API.',
    );
  }
}
