import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SupplierError } from './supplier.errors.js';
import {
  createSupplier,
  findPossibleSupplierDuplicates,
  getSupplier,
  isSupplierDatabaseConflict,
  listSuppliers,
  setSupplierStatus,
  updateSupplier,
} from './supplier.service.js';
import {
  createSupplierSchema,
  duplicateSupplierQuerySchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from './supplier.validation.js';

const router = Router();

router.use('/suppliers', requireAuthentication);

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const result = z.string().uuid().safeParse(candidate);
  if (!result.success) {
    throw new SupplierError('A valid supplier identifier is required.', 400, 'INVALID_REQUEST');
  }
  return result.data;
}

function actor(request: Request): AuthenticatedUser {
  if (!request.auth) {
    throw new SupplierError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
  }
  return request.auth;
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

// Keep duplicate lookup separately protected by suppliers.view. A create-only
// principal must not gain supplier-directory read access through create responses.
router.get(
  '/suppliers/duplicate-check',
  requirePermission('suppliers.view'),
  async (request, response, next) => {
    try {
      const parsed = duplicateSupplierQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await findPossibleSupplierDuplicates(actor(request), parsed.data.name),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get('/suppliers', requirePermission('suppliers.view'), async (request, response, next) => {
  try {
    const parsed = listSuppliersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    const page = await listSuppliers(actor(request), {
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

router.get(
  '/suppliers/:supplierId',
  requirePermission('suppliers.view'),
  async (request, response, next) => {
    try {
      response.json({
        data: await getSupplier(actor(request), routeId(request.params.supplierId!)),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/suppliers',
  requirePermission('suppliers.create'),
  async (request, response, next) => {
    try {
      const parsed = createSupplierSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.status(201).json({
        data: await createSupplier(actor(request), request.requestId, parsed.data),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/suppliers/:supplierId',
  requirePermission('suppliers.update'),
  async (request, response, next) => {
    try {
      const parsed = updateSupplierSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateSupplier(
          actor(request),
          request.requestId,
          routeId(request.params.supplierId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/suppliers/:supplierId/activate',
  requirePermission('suppliers.manage_status'),
  async (request, response, next) => {
    try {
      response.json({
        data: await setSupplierStatus(
          actor(request),
          request.requestId,
          routeId(request.params.supplierId!),
          'active',
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/suppliers/:supplierId/deactivate',
  requirePermission('suppliers.manage_status'),
  async (request, response, next) => {
    try {
      response.json({
        data: await setSupplierStatus(
          actor(request),
          request.requestId,
          routeId(request.params.supplierId!),
          'inactive',
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

const supplierErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof SupplierError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      },
    });
    return;
  }
  if (isSupplierDatabaseConflict(error)) {
    response.status(409).json({
      error: {
        code: 'DATA_CONFLICT',
        message: 'The requested supplier change conflicts with supplier data integrity rules.',
        requestId: request.requestId,
      },
    });
    return;
  }
  next(error);
};

router.use(supplierErrorHandler);

export const supplierRoutes: Router = router;
