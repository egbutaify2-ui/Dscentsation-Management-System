import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import { CustomerError } from './customer.errors.js';
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  isCustomerDatabaseConflict,
  customerOperationError,
  listCustomers,
  updateCustomer,
} from './customer.service.js';
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './customer.validation.js';

const router = Router();
router.use(requireAuthentication);

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const parsed = z.string().uuid().safeParse(candidate);
  if (!parsed.success) {
    throw new CustomerError('A valid customer identifier is required.', 400, 'INVALID_REQUEST');
  }
  return parsed.data;
}

function actor(request: Request) {
  if (!request.auth) {
    throw new CustomerError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
  }
  return { id: request.auth.id, permissions: request.auth.permissions };
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

router.get('/', requirePermission('customers.view'), async (request, response, next) => {
  try {
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    const page = await listCustomers(actor(request), {
      query: parsed.data.q,
      status: parsed.data.status,
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
});

router.get('/:customerId', requirePermission('customers.view'), async (request, response, next) => {
  try {
    response.json({
      data: await getCustomer(actor(request), routeId(request.params.customerId!)),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', requirePermission('customers.create'), async (request, response, next) => {
  try {
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    const customer = await createCustomer(actor(request), request.requestId, parsed.data);
    response.status(201).json({ data: customer });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:customerId',
  requirePermission('customers.update'),
  async (request, response, next) => {
    try {
      const parsed = updateCustomerSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateCustomer(
          actor(request),
          request.requestId,
          routeId(request.params.customerId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:customerId/archive',
  requirePermission('customers.archive'),
  async (request, response, next) => {
    try {
      response.json({
        data: await archiveCustomer(
          actor(request),
          request.requestId,
          routeId(request.params.customerId!),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

const customerErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof CustomerError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      },
    });
    return;
  }
  if (isCustomerDatabaseConflict(error)) {
    const conflict = customerOperationError();
    response.status(conflict.status).json({
      error: {
        code: conflict.code,
        message: conflict.message,
        requestId: request.requestId,
      },
    });
    return;
  }
  next(error);
};

router.use(customerErrorHandler);

export const customerRoutes: Router = router;
