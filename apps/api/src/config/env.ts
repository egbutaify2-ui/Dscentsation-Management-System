import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';
import { assertProductionSecurityConfig } from './security-config.js';

// Resolve the repository root from this module, not process.cwd(). The API is
// normally launched with apps/api as its working directory.
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const rootEnvFile = resolve(repositoryRoot, '.env');
if (existsSync(rootEnvFile)) loadEnvFile(rootEnvFile);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SESSION_SECRET: z.string().min(32),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().optional(),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().optional(),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
});

const parsed = schema.parse(process.env);

if (parsed.NODE_ENV === 'production') {
  assertProductionSecurityConfig({
    sessionIdleTimeoutMinutes: parsed.SESSION_IDLE_TIMEOUT_MINUTES,
    sessionAbsoluteTimeoutHours: parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS,
    cookieSecure: parsed.COOKIE_SECURE,
    appOrigin: parsed.APP_ORIGIN,
  });
}

export const env = {
  ...parsed,
  SESSION_IDLE_TIMEOUT_MINUTES: parsed.SESSION_IDLE_TIMEOUT_MINUTES ?? 30,
  SESSION_ABSOLUTE_TIMEOUT_HOURS: parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 12,
  sessionIdleTimeoutMs: (parsed.SESSION_IDLE_TIMEOUT_MINUTES ?? 30) * 60 * 1000,
  sessionAbsoluteTimeoutMs: (parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 12) * 60 * 60 * 1000,
  cookieName: parsed.COOKIE_SECURE ? '__Host-dms.sid' : 'dms.sid',
};
