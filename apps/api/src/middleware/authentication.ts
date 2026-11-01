import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { findActiveUserById } from '../modules/users/user.service.js';

export const requireAuthentication: RequestHandler = async (request, response, next) => {
  try {
    const userId = request.session.userId;
    const issuedAt = request.session.authIssuedAt;

    if (!userId || !issuedAt || Date.now() - issuedAt >= env.sessionAbsoluteTimeoutMs) {
      if (userId || issuedAt) {
        await new Promise<void>((resolve, reject) => {
          request.session.destroy((error) => (error ? reject(error) : resolve()));
        });
        response.clearCookie(env.cookieName, {
          path: '/',
          httpOnly: true,
          secure: env.COOKIE_SECURE,
          sameSite: 'lax',
        });
      }
      response.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          requestId: request.requestId,
        },
      });
      return;
    }

    const user = await findActiveUserById(userId);
    if (!user) {
      await new Promise<void>((resolve, reject) => {
        request.session.destroy((error) => (error ? reject(error) : resolve()));
      });
      response.clearCookie(env.cookieName, {
        path: '/',
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
      });
      response.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          requestId: request.requestId,
        },
      });
      return;
    }

    request.auth = user;
    next();
  } catch (error) {
    next(error);
  }
};
