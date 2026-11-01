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
    message: error.message,
  });
});

export async function assertDatabaseReady(): Promise<void> {
  const result = await pool.query<{
    roles_ready: boolean;
    session_store_ready: boolean;
    audit_ready: boolean;
  }>(`
    SELECT
      to_regclass('public.roles') IS NOT NULL AS roles_ready,
      to_regclass('public.user_sessions') IS NOT NULL AS session_store_ready,
      to_regclass('public.audit_logs') IS NOT NULL AS audit_ready
  `);

  const state = result.rows[0];
  if (!state?.roles_ready || !state.session_store_ready || !state.audit_ready) {
    throw new Error('Foundation migration missing. Run "pnpm db:migrate" before starting the API.');
  }
}
