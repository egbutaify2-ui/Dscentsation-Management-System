import type { AuthenticatedUser } from '../modules/auth/auth.types.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    authIssuedAt?: number;
    csrfToken?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthenticatedUser;
    }
  }
}

export {};
