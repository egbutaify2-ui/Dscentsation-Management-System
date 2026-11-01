import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfProtection: RequestHandler = (request, response, next) => {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }

  if (request.get('origin') !== env.APP_ORIGIN) {
    response.status(403).json({
      error: {
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'Request origin is not allowed.',
        requestId: request.requestId,
      },
    });
    return;
  }

  const expected = request.session.csrfToken;
  const supplied = request.get('x-csrf-token');
  if (!expected || !supplied) {
    response.status(403).json({
      error: {
        code: 'CSRF_TOKEN_REQUIRED',
        message: 'A valid CSRF token is required.',
        requestId: request.requestId,
      },
    });
    return;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    response.status(403).json({
      error: {
        code: 'CSRF_TOKEN_INVALID',
        message: 'A valid CSRF token is required.',
        requestId: request.requestId,
      },
    });
    return;
  }

  next();
};
