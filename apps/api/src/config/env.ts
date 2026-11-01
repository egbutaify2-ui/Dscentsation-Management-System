import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

const rootEnvFile = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvFile)) loadEnvFile(rootEnvFile);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_SECRET: z.string().min(32),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().optional(),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().optional(),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
});

const parsed = schema.parse(process.env);
const errors: string[] = [];

if (parsed.NODE_ENV === 'production') {
  if (!parsed.SESSION_IDLE_TIMEOUT_MINUTES) errors.push('SESSION_IDLE_TIMEOUT_MINUTES');
  if (!parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS) errors.push('SESSION_ABSOLUTE_TIMEOUT_HOURS');
  if (!parsed.COOKIE_SECURE) errors.push('COOKIE_SECURE=true');
  if (new URL(parsed.APP_ORIGIN).protocol !== 'https:') errors.push('APP_ORIGIN must use HTTPS');
}

if (errors.length > 0) {
  throw new Error(
    `Production session/security configuration is incomplete: ${errors.join(', ')}. ` +
      'Production policy values require explicit approval.',
  );
}

export const env = {
  ...parsed,
  SESSION_IDLE_TIMEOUT_MINUTES: parsed.SESSION_IDLE_TIMEOUT_MINUTES ?? 30,
  SESSION_ABSOLUTE_TIMEOUT_HOURS: parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 12,
  sessionIdleTimeoutMs: (parsed.SESSION_IDLE_TIMEOUT_MINUTES ?? 30) * 60 * 1000,
  sessionAbsoluteTimeoutMs: (parsed.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 12) * 60 * 60 * 1000,
  cookieName: parsed.COOKIE_SECURE ? '__Host-dms.sid' : 'dms.sid',
};
