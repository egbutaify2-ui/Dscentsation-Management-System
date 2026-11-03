import { Router } from 'express';
import { requireAuthentication } from '../../middleware/authentication.js';
import { listAccessibleStockLocations } from '../roles/location-access.service.js';

const router = Router();

router.get('/locations', requireAuthentication, async (request, response, next) => {
  try {
    if (!request.auth) {
      response.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          requestId: request.requestId,
        },
      });
      return;
    }

    response.json({ data: await listAccessibleStockLocations(request.auth) });
  } catch (error) {
    next(error);
  }
});

export const locationRoutes: Router = router;
