import { Router } from 'express';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import { listAuditActivity } from './audit.service.js';
import type { AuditActivityFilters } from './audit.service.js';
import { listAuditLogsQuerySchema } from './audit.validation.js';

const router = Router();

function validationResponse(error: ZodError) {
  return {
    error: {
      code: 'INVALID_REQUEST',
      message: 'Review the supplied query parameters and try again.',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

router.get(
  '/audit-logs',
  requireAuthentication,
  requirePermission('users.view'),
  async (request, response, next) => {
  try {
    const parsed = listAuditLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }

    const filters: AuditActivityFilters = {
      ...(parsed.data.actorUserId === undefined ? {} : { actorUserId: parsed.data.actorUserId }),
      ...(parsed.data.action === undefined ? {} : { action: parsed.data.action }),
      ...(parsed.data.entityType === undefined ? {} : { entityType: parsed.data.entityType }),
      ...(parsed.data.entityId === undefined ? {} : { entityId: parsed.data.entityId }),
      ...(parsed.data.from === undefined ? {} : { from: parsed.data.from }),
      ...(parsed.data.to === undefined ? {} : { to: parsed.data.to }),
      page: parsed.data.page ?? 1,
      pageSize: parsed.data.pageSize ?? 25,
    };

    response.json({ data: await listAuditActivity(filters) });
  } catch (error) {
    next(error);
  }
});

export const auditRoutes: Router = router;
