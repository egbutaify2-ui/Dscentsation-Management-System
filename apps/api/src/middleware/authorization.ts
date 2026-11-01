import type { RequestHandler } from 'express';
import { canAccessStockLocation } from '../modules/roles/location-access.service.js';
import { hasPermission } from '../modules/roles/permission.service.js';

export function requirePermission(permissionCode: string): RequestHandler {
  return (request, response, next) => {
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
    if (!hasPermission(request.auth.permissions, permissionCode)) {
      response.status(403).json({
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You are not authorised to perform this action.',
          requestId: request.requestId,
        },
      });
      return;
    }
    next();
  };
}

export function requireStockLocationAccess(
  resolveLocationId: (request: Express.Request) => string | undefined,
): RequestHandler {
  return async (request, response, next) => {
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
    const locationId = resolveLocationId(request);
    if (!locationId) {
      response.status(400).json({
        error: {
          code: 'LOCATION_REQUIRED',
          message: 'A stock location is required.',
          requestId: request.requestId,
        },
      });
      return;
    }
    try {
      if (!(await canAccessStockLocation(request.auth, locationId))) {
        response.status(403).json({
          error: {
            code: 'LOCATION_ACCESS_DENIED',
            message: 'You are not authorised to access this stock location.',
            requestId: request.requestId,
          },
        });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
