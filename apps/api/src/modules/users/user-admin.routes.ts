import { Router } from 'express';
import type { ErrorRequestHandler, Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import {
  acceptEmployeeInvitation,
  createEmployeeInvitation,
  listEmployees,
  revokeEmployeeInvitation,
  revokeEmployeeSessions,
  setEmployeeStatus,
} from './user-admin.service.js';
import { UserAdminError } from './user-admin.errors.js';

const router = Router();

const invitationSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    role: z.enum(['MANAGER', 'STAFF']),
  })
  .strict();

const acceptanceSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: z.string().min(12).max(1024),
  })
  .strict();

const statusSchema = z.object({ status: z.enum(['active', 'suspended']) }).strict();

const acceptanceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: {
        code: 'INVITATION_RATE_LIMITED',
        message: 'Too many invitation attempts. Try again later.',
      },
    });
  },
});

function routeId(value: string | string[]): string {
  const candidate = typeof value === 'string' ? value : value[0];
  const parsed = z.string().uuid().safeParse(candidate);
  if (!parsed.success) {
    throw new UserAdminError('A valid employee identifier is required.', 400, 'INVALID_REQUEST');
  }
  return parsed.data;
}

function actorId(request: Request): string {
  if (!request.auth) {
    throw new UserAdminError('Authentication is required.', 401, 'AUTHENTICATION_REQUIRED');
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

// Public password setup is token-authenticated. The token arrives in the POST body,
// never in a request URL, access log or query string.
router.post('/invitations/accept', acceptanceLimiter, async (request, response, next) => {
  try {
    const parsed = acceptanceSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    await acceptEmployeeInvitation(
      request,
      parsed.data.token,
      parsed.data.password,
      request.requestId,
    );
    response.json({ data: { accepted: true } });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuthentication);

router.get('/', requirePermission('users.view'), async (request, response, next) => {
  try {
    const rawSearch = request.query.q;
    const rawRole = request.query.role;
    const rawStatus = request.query.status;
    if (rawSearch !== undefined && typeof rawSearch !== 'string') {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Search text must be a single string.' },
      });
      return;
    }
    if (rawSearch && rawSearch.length > 100) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Search text must be 100 characters or fewer.' },
      });
      return;
    }
    if (
      rawRole !== undefined &&
      rawRole !== 'all' &&
      rawRole !== 'MANAGER' &&
      rawRole !== 'STAFF'
    ) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Role filter must be Manager or Staff.' },
      });
      return;
    }
    if (
      rawStatus !== undefined &&
      !['all', 'active', 'suspended', 'disabled', 'invited'].includes(String(rawStatus))
    ) {
      response.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Account status filter is invalid.' },
      });
      return;
    }
    response.json({
      data: await listEmployees({
        search: typeof rawSearch === 'string' ? rawSearch.trim() : undefined,
        role: rawRole as 'MANAGER' | 'STAFF' | 'all' | undefined,
        status: rawStatus as 'active' | 'suspended' | 'disabled' | 'invited' | 'all' | undefined,
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/invitations', requirePermission('users.manage'), async (request, response, next) => {
  try {
    const parsed = invitationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }
    const invitation = await createEmployeeInvitation(
      actorId(request),
      request.requestId,
      parsed.data,
    );
    response.status(201).json({ data: invitation });
  } catch (error) {
    next(error);
  }
});

router.patch(
  '/:userId/status',
  requirePermission('users.manage'),
  async (request, response, next) => {
    try {
      const parsed = statusSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json(validationResponse(parsed.error));
        return;
      }
      response.json({
        data: await setEmployeeStatus(
          actorId(request),
          request.requestId,
          routeId(request.params.userId!),
          parsed.data.status,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:userId/sessions/revoke',
  requirePermission('users.manage'),
  async (request, response, next) => {
    try {
      response.json({
        data: await revokeEmployeeSessions(
          actorId(request),
          request.requestId,
          routeId(request.params.userId!),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  '/:userId/invitation/revoke',
  requirePermission('users.manage'),
  async (request, response, next) => {
    try {
      response.json({
        data: await revokeEmployeeInvitation(
          actorId(request),
          request.requestId,
          routeId(request.params.userId!),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

const userAdminErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (error instanceof UserAdminError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message, requestId: request.requestId },
    });
    return;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === '23505' || error.code === '23514' || error.code === '23503')
  ) {
    response.status(409).json({
      error: {
        code: 'ACCOUNT_DATA_CONFLICT',
        message: 'The requested employee account change conflicts with account integrity rules.',
        requestId: request.requestId,
      },
    });
    return;
  }
  next(error);
};

router.use(userAdminErrorHandler);

export const userAdminRoutes: Router = router;
