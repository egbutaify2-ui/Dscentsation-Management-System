import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import { CustomerError } from '../customers/customer.errors.js';
import { ProductError } from '../products/product.errors.js';
import { OrderError } from './order.errors.js';
import { OrderService } from './order.service.js';
import { PostgresOrderRepository } from './order.postgres.repository.js';
import {
  amendOrderSchema,
  createOrderSchema,
  listOrdersQuerySchema,
} from './order.validation.js';

const router = Router();
const repository = new PostgresOrderRepository();
const service = new OrderService({ repository });

router.use(requireAuthentication);

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const parsed = z.string().uuid().safeParse(candidate);
  if (!parsed.success) {
    throw new OrderError('A valid order identifier is required.', 400, 'INVALID_REQUEST');
  }
  return parsed.data;
}

function actor(request: Request) {
  if (!request.auth) {
    throw new OrderError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
  }
  return {
    id: request.auth.id,
    permissions: request.auth.permissions,
    roleCode: request.auth.roleCode,
  };
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

router.get(
  '/orders',
  requirePermission('orders.view'),
  async (request, response, next) => {
    try {
      const parsed = listOrdersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      const page = await repository.listOrders({
        query: parsed.data.q,
        status: parsed.data.status,
        customerId: parsed.data.customerId,
        sourceChannel: parsed.data.sourceChannel,
        fulfilmentLocationId: parsed.data.fulfilmentLocationId,
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? 25,
      });
      response.json({
        data: page.items,
        meta: {
          page: page.page,
          pageSize: page.pageSize,
          total: page.total,
          totalPages: page.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/orders',
  requirePermission('orders.create'),
  async (request, response, next) => {
    try {
      const parsed = createOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      const record = await service.createOrder(actor(request), request.requestId, parsed.data);
      response.status(201).json({ data: record });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/orders/:orderId',
  requirePermission('orders.view'),
  async (request, response, next) => {
    try {
      response.json({ data: await repository.getOrder(routeId(request.params.orderId!)) });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/orders/:orderId',
  requirePermission('orders.update'),
  async (request, response, next) => {
    try {
      const parsed = amendOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      const record = await service.amendOrder(
        actor(request),
        request.requestId,
        routeId(request.params.orderId!),
        parsed.data,
      );
      response.json({ data: record });
    } catch (error) {
      next(error);
    }
  },
);

const orderErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (
    error instanceof OrderError ||
    error instanceof CustomerError ||
    error instanceof ProductError
  ) {
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
  if (['23503', '23514', '22P02', '22003'].includes(databaseCode)) {
    response.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'One or more selected order records or amounts are invalid.',
        requestId: request.requestId,
      },
    });
    return;
  }
  if (databaseCode === '23505') {
    response.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'The order could not be saved because it conflicts with an existing record.',
        requestId: request.requestId,
      },
    });
    return;
  }
  next(error);
};

router.use(orderErrorHandler);

export const orderRoutes: Router = router;
