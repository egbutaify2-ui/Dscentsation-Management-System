import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import {
  createExpenseCategory,
  createExpenseDraft,
  expenseDataConflictError,
  getExpenseDraft,
  getExpenseRevisionHistory,
  isExpenseDatabaseConflict,
  listExpenseCategories,
  listExpenseDrafts,
  setExpenseCategoryActive,
  updateExpenseCategory,
  updateExpenseDraft,
} from './expense.service.js';
import { ExpenseError } from './expense.errors.js';
import {
  createExpenseCategorySchema,
  createExpenseSchema,
  listExpenseCategoriesQuerySchema,
  listExpensesQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
} from './expense.validation.js';

const router = Router();
router.use('/expense-categories', requireAuthentication);
router.use('/expenses', requireAuthentication);

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const parsed = z.string().uuid().safeParse(candidate);
  if (!parsed.success) {
    throw new ExpenseError('A valid record identifier is required.', 400, 'INVALID_REQUEST');
  }
  return parsed.data;
}

function actorId(request: Request): string {
  if (!request.auth) {
    throw new ExpenseError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
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

router.get(
  '/expense-categories',
  requirePermission('expense_categories.view'),
  async (request, response, next) => {
    try {
      const parsed = listExpenseCategoriesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await listExpenseCategories(actorId(request), {
          query: parsed.data.q,
          status: parsed.data.status,
          page: parsed.data.page ?? 1,
          pageSize: parsed.data.pageSize ?? 20,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/expense-categories',
  requirePermission('expense_categories.manage'),
  async (request, response, next) => {
    try {
      const parsed = createExpenseCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.status(201).json({
        data: await createExpenseCategory(actorId(request), request.requestId, parsed.data),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/expense-categories/:categoryId',
  requirePermission('expense_categories.manage'),
  async (request, response, next) => {
    try {
      const parsed = updateExpenseCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateExpenseCategory(
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
  '/expense-categories/:categoryId/activate',
  requirePermission('expense_categories.manage'),
  async (request, response, next) => {
    try {
      const emptyBody = z
        .object({})
        .strict()
        .safeParse(request.body ?? {});
      if (!emptyBody.success) {
        response.status(400).json(validationResponse(emptyBody.error));
        return;
      }
      response.json({
        data: await setExpenseCategoryActive(
          actorId(request),
          request.requestId,
          routeId(request.params.categoryId!),
          true,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/expense-categories/:categoryId/deactivate',
  requirePermission('expense_categories.manage'),
  async (request, response, next) => {
    try {
      const emptyBody = z
        .object({})
        .strict()
        .safeParse(request.body ?? {});
      if (!emptyBody.success) {
        response.status(400).json(validationResponse(emptyBody.error));
        return;
      }
      response.json({
        data: await setExpenseCategoryActive(
          actorId(request),
          request.requestId,
          routeId(request.params.categoryId!),
          false,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get('/expenses', requirePermission('expenses.view'), async (request, response, next) => {
  try {
    const parsed = listExpensesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    response.json({
      data: await listExpenseDrafts(actorId(request), {
        query: parsed.data.q,
        categoryId: parsed.data.categoryId,
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? 20,
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/expenses', requirePermission('expenses.create'), async (request, response, next) => {
  try {
    const parsed = createExpenseSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    response.status(201).json({
      data: await createExpenseDraft(actorId(request), request.requestId, parsed.data),
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  '/expenses/:expenseId/revisions',
  requirePermission('expenses.view'),
  async (request, response, next) => {
    try {
      response.json({
        data: await getExpenseRevisionHistory(actorId(request), routeId(request.params.expenseId!)),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/expenses/:expenseId',
  requirePermission('expenses.view'),
  async (request, response, next) => {
    try {
      response.json({
        data: await getExpenseDraft(actorId(request), routeId(request.params.expenseId!)),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/expenses/:expenseId',
  requirePermission('expenses.update'),
  async (request, response, next) => {
    try {
      const parsed = updateExpenseSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await updateExpenseDraft(
          actorId(request),
          request.requestId,
          routeId(request.params.expenseId!),
          parsed.data,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

const expenseErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof ExpenseError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      },
    });
    return;
  }
  if (isExpenseDatabaseConflict(error)) {
    const conflict = expenseDataConflictError();
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

router.use(expenseErrorHandler);

export const expenseRoutes: Router = router;
