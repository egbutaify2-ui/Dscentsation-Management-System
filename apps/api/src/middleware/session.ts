import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const PgSessionStore = connectPgSimple(session);

export const sessionStore = new PgSessionStore({
  pool,
  tableName: 'user_sessions',
  schemaName: 'public',
  createTableIfMissing: false,
  pruneSessionInterval: 15 * 60,
});

export const sessionMiddleware = session({
  name: env.cookieName,
  secret: env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: env.sessionIdleTimeoutMs,
  },
});
