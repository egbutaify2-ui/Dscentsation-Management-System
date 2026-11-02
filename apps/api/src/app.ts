import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { sessionMiddleware } from './middleware/session.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { customerRoutes } from './modules/customers/customer.routes.js';
import { supplierRoutes } from './modules/suppliers/supplier.routes.js';
import { expenseRoutes } from './modules/expenses/expense.routes.js';
import { productRoutes } from './modules/products/product.routes.js';
import { userAdminRoutes } from './modules/users/user-admin.routes.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  app.use((request, response, next) => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    next();
  });
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use(sessionMiddleware);
  app.use(csrfProtection);

  app.get('/api/v1/health', (_request, response) => {
    response.json({ data: { status: 'ok' } });
  });
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userAdminRoutes);
  app.use('/api/v1/customers', customerRoutes);
  app.use('/api/v1', supplierRoutes);
  app.use('/api/v1', expenseRoutes);
  app.use('/api/v1', productRoutes);

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: response.getHeader('X-Request-Id'),
      },
    });
  });

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      console.error('DMS API request failed.', {
        requestId: request.requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      if (response.headersSent) return;
      response.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected server error occurred.',
          requestId: request.requestId,
        },
      });
    },
  );

  return app;
}
