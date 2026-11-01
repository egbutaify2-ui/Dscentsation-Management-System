import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import { ProductError } from './product.errors.js';
import {
  createCategory,
  createProduct,
  createVariant,
  getProduct,
  listCategories,
  listProducts,
  setProductStatus,
  setVariantActive,
  updateCategory,
  updateProduct,
  updateVariant,
} from './product.service.js';
import {
  createCategorySchema,
  createProductSchema,
  createVariantSchema,
  productStatusSchema,
  statusSchema,
  updateCategorySchema,
  updateProductSchema,
  updateVariantSchema,
} from './product.validation.js';

const router = Router();

router.use('/products', requireAuthentication);
router.use('/categories', requireAuthentication);

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const result = z.string().uuid().safeParse(candidate);
  if (!result.success) {
    throw new ProductError('A valid record identifier is required.', 400, 'INVALID_REQUEST');
  }
  return result.data;
}

function actorId(request: Request): string {
  if (!request.auth)
    throw new ProductError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
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

router.get('/products', requirePermission('products.view'), async (request, response, next) => {
  try {
    const rawQuery = request.query.q;
    if (rawQuery !== undefined && typeof rawQuery !== 'string') {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Search text must be a single string.' },
      });
      return;
    }
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : undefined;
    const rawStatus = request.query.status;
    const status =
      rawStatus === 'active' || rawStatus === 'archived' || rawStatus === 'all'
        ? rawStatus
        : undefined;
    if (rawStatus !== undefined && status === undefined) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Status must be active, archived or all.' },
      });
      return;
    }
    if (query && query.length > 100) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Search text must be 100 characters or fewer.' },
      });
      return;
    }
    response.json({
      data: await listProducts(query || undefined, status === 'all' ? undefined : status),
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/products/:productId',
  requirePermission('products.view'),
  async (request, response, next) => {
    try {
      response.json({ data: await getProduct(routeId(request.params.productId!)) });
    } catch (error) {
      next(error);
    }
  },
);

router.post('/products', requirePermission('products.create'), async (request, response, next) => {
  try {
    const parsed = createProductSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    const product = await createProduct(actorId(request), request.requestId, parsed.data);
    response.status(201).json({ data: product });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/products/:productId',
  requirePermission('products.update'),
  async (request, response, next) => {
    try {
      const parsed = updateProductSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateProduct(
          actorId(request),
          request.requestId,
          routeId(request.params.productId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/products/:productId/status',
  requirePermission('products.archive'),
  async (request, response, next) => {
    try {
      const parsed = productStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await setProductStatus(
          actorId(request),
          request.requestId,
          routeId(request.params.productId!),
          parsed.data.status,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get('/categories', requirePermission('products.view'), async (_request, response, next) => {
  try {
    response.json({ data: await listCategories() });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/categories',
  requirePermission('products.categories.manage'),
  async (request, response, next) => {
    try {
      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.status(201).json({
        data: await createCategory(actorId(request), request.requestId, parsed.data),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/categories/:categoryId',
  requirePermission('products.categories.manage'),
  async (request, response, next) => {
    try {
      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateCategory(
          actorId(request),
          request.requestId,
          routeId(request.params.categoryId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/products/:productId/variants',
  requirePermission('products.variants.manage'),
  async (request, response, next) => {
    try {
      const parsed = createVariantSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.status(201).json({
        data: await createVariant(
          actorId(request),
          request.requestId,
          routeId(request.params.productId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/products/:productId/variants/:variantId',
  requirePermission('products.variants.manage'),
  async (request, response, next) => {
    try {
      const parsed = updateVariantSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateVariant(
          actorId(request),
          request.requestId,
          routeId(request.params.productId!),
          routeId(request.params.variantId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/products/:productId/variants/:variantId/status',
  requirePermission('products.variants.manage'),
  async (request, response, next) => {
    try {
      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await setVariantActive(
          actorId(request),
          request.requestId,
          routeId(request.params.productId!),
          routeId(request.params.variantId!),
          parsed.data.isActive,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

const productErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof ProductError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      },
    });
    return;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '23503' || error.code === '23514' || error.code === '23505')
  ) {
    response.status(409).json({
      error: {
        code: 'DATA_CONFLICT',
        message: 'The requested change conflicts with existing product data.',
        requestId: request.requestId,
      },
    });
    return;
  }
  next(error);
};

router.use(productErrorHandler);

export const productRoutes: Router = router;
