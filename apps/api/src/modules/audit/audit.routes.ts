import { Router } from 'express';
import type { ZodError } from 'zod';
import { requireAuthentication } from '../../middleware/authentication.js';
import { requirePermission } from '../../middleware/authorization.js';
import { listAuditActivity } from './audit.service.js';
import { listAuditLogsQuerySchema } from './audit.validation.js';

const router = Router();
router.use(requireAuthentication);

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

router.get('/audit-logs', requirePermission('users.view'), async (request, response, next) => {
  try {
    const parsed = listAuditLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json(validationResponse(parsed.error));
      return;
    }

    response.json({
      data: await listAuditActivity({
        ...parsed.data,
        page: parsed.data.page ?? 1,
        pageSize: parsed.data.pageSize ?? 25,
      }),
    });
  } catch (error) {
    next(error);
  }
});

export const auditRoutes: Router = router;
