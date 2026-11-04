import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import { PaymentError } from './payment.errors.js';
import { PostgresPaymentRepository } from './payment.postgres.repository.js';
import {
  listPaymentsQuerySchema,
  recordPaymentSchema,
  verifyPaymentSchema,
} from './payment.validation.js';

const router = Router();
const repository = new PostgresPaymentRepository();

router.use(requireAuthentication);

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const parsed = z.string().uuid().safeParse(candidate);
  if (!parsed.success) {
    throw new PaymentError(
      'A valid payment or order identifier is required.',
      400,
      'INVALID_REQUEST',
    );
  }
  return parsed.data;
}

function actorId(request: Request): string {
  if (!request.auth) {
    throw new PaymentError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
  }
  return request.auth.id;
}

function validationResponse(error: ZodError) {
  return {
    error: {
      code: 'INVALID_REQUEST',
      message: 'Review the supplied fields and try again.',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

router.post(
  '/orders/:orderId/payments',
  requirePermission('payments.record'),
  async (request, response, next) => {
    try {
      const parsed = recordPaymentSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      const idempotencyHeader = request.get('Idempotency-Key')?.trim();
      if (!idempotencyHeader || idempotencyHeader.length < 8 || idempotencyHeader.length > 128) {
        response.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: 'A valid Idempotency-Key header is required for payment recording.',
            requestId: request.requestId,
          },
        });
        return;
      }

      const payment = await repository.recordPayment(
        routeId(request.params.orderId!),
        actorId(request),
        request.requestId,
        idempotencyHeader,
        parsed.data,
      );
      response.status(201).json({ data: payment });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/orders/:orderId/payments/summary',
  requirePermission('payments.verify'),
  async (request, response, next) => {
    try {
      response.json({
        data: await repository.getOrderPaymentSummary(routeId(request.params.orderId!)),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/orders/:orderId/payments',
  requirePermission('payments.verify'),
  async (request, response, next) => {
    try {
      const parsed = listPaymentsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await repository.listOrderPayments(
          routeId(request.params.orderId!),
          parsed.data.page ?? 1,
          parsed.data.pageSize ?? 25,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/payments/:paymentId',
  requirePermission('payments.verify'),
  async (request, response, next) => {
    try {
      response.json({ data: await repository.getPayment(routeId(request.params.paymentId!)) });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/payments/:paymentId/verify',
  requirePermission('payments.verify'),
  async (request, response, next) => {
    try {
      const parsed = verifyPaymentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await repository.verifyPayment(
          routeId(request.params.paymentId!),
          actorId(request),
          request.requestId,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

const paymentErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof PaymentError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      },
    });
    return;
  }

  const databaseCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (databaseCode === '23505') {
    response.status(409).json({
      error: {
        code: 'PAYMENT_CONFLICT',
        message: 'The payment conflicts with an existing financial record.',
        requestId: request.requestId,
      },
    });
    return;
  }
  if (databaseCode === '23514') {
    response.status(409).json({
      error: {
        code: 'PAYMENT_CONFLICT',
        message: 'The payment could not be applied without violating financial history rules.',
        requestId: request.requestId,
      },
    });
    return;
  }
  if (['23503', '22P02', '22003'].includes(databaseCode)) {
    response.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'One or more payment fields reference an invalid record or amount.',
        requestId: request.requestId,
      },
    });
    return;
  }
  next(error);
};

router.use(paymentErrorHandler);

export const paymentRoutes: Router = router;
