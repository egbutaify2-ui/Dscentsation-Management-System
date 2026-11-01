import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { requireAuthentication } from '../../middleware/authentication.js';
import { appendAuditEvent } from '../audit/audit.service.js';
import { findActiveUserById, findUserForLogin } from '../users/user.service.js';
import { destroySession, issueCsrfToken, rotateSession } from './auth.session.js';

const router = Router();
const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1024),
});
const dummyPasswordHash = argon2.hash(randomBytes(32).toString('hex'), {
  type: argon2.argon2id,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'LOGIN_RATE_LIMITED',
        message: 'Too many sign-in attempts. Try again later.',
      },
    });
  },
});

function clearSessionCookie(response: Response): void {
  response.clearCookie(env.cookieName, {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
  });
}

router.get('/csrf', async (request, response, next) => {
  try {
    response.json({ data: { token: await issueCsrfToken(request) } });
  } catch (error) {
    next(error);
  }
});

router.post('/login', loginLimiter, async (request, response, next) => {
  try {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Enter a valid email address and password.',
          requestId: request.requestId,
        },
      });
      return;
    }

    const user = await findUserForLogin(parsed.data.email);
    const hash = user?.passwordHash ?? (await dummyPasswordHash);
    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(hash, parsed.data.password);
    } catch {
      passwordMatches = false;
    }

    if (!user || user.status !== 'active' || !passwordMatches) {
      await appendAuditEvent({
        actorUserId: null,
        action: 'auth.login.failed',
        requestId: request.requestId,
        safeMetadata: { outcome: 'invalid_credentials' },
      });
      response.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.',
          requestId: request.requestId,
        },
      });
      return;
    }

    await rotateSession(request, user.id);
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1',
          [user.id],
        );
        await appendAuditEvent(
          {
            actorUserId: user.id,
            action: 'auth.login.succeeded',
            entityType: 'user',
            entityId: user.id,
            requestId: request.requestId,
            safeMetadata: { outcome: 'success' },
          },
          client,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      await destroySession(request);
      clearSessionCookie(response);
      throw error;
    }

    response.json({
      data: {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roleCode: user.roleCode,
          roleName: user.roleName,
        },
        permissions: user.permissions,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (request, response, next) => {
  try {
    const userId = request.session.userId;
    let auditFailure: unknown;
    if (userId) {
      try {
        await appendAuditEvent({
          actorUserId: userId,
          action: 'auth.logout',
          entityType: 'user',
          entityId: userId,
          requestId: request.requestId,
          safeMetadata: { outcome: 'success' },
        });
      } catch (error) {
        auditFailure = error;
      }
    }

    await destroySession(request);
    clearSessionCookie(response);
    if (auditFailure) {
      next(auditFailure);
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.get('/session', async (request, response, next) => {
  try {
    const userId = request.session.userId;
    const issuedAt = request.session.authIssuedAt;
    if (!userId || !issuedAt || Date.now() - issuedAt > env.sessionAbsoluteTimeoutMs) {
      if (userId || issuedAt) {
        await destroySession(request);
        clearSessionCookie(response);
      }
      response.json({ data: { authenticated: false, user: null, permissions: [] } });
      return;
    }

    const user = await findActiveUserById(userId);
    if (!user) {
      await destroySession(request);
      clearSessionCookie(response);
      response.json({ data: { authenticated: false, user: null, permissions: [] } });
      return;
    }

    response.json({
      data: {
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          roleCode: user.roleCode,
          roleName: user.roleName,
        },
        permissions: user.permissions,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/capabilities', requireAuthentication, (request, response) => {
  response.json({
    data: {
      userId: request.auth?.id,
      role: request.auth?.roleCode,
      permissions: request.auth?.permissions ?? [],
    },
  });
});

export const authRoutes: Router = router;
