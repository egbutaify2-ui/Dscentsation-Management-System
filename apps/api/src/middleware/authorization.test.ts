import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../modules/auth/auth.types.js';
import { requirePermission } from './authorization.js';

const staff: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'staff@example.invalid',
  displayName: 'Synthetic Staff',
  roleCode: 'STAFF',
  roleName: 'Staff',
  permissions: ['payments.record'],
};

const manager: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'manager@example.invalid',
  displayName: 'Synthetic Manager',
  roleCode: 'MANAGER',
  roleName: 'Manager',
  permissions: ['payments.record', 'payments.verify'],
};

const owner: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000003',
  email: 'owner@example.invalid',
  displayName: 'Synthetic Owner',
  roleCode: 'OWNER',
  roleName: 'Owner',
  permissions: ['payments.record', 'payments.verify'],
};

function permissionTestApp(user?: AuthenticatedUser): express.Express {
  const app = express();
  app.use((req, _res, next) => {
    req.requestId = 'synthetic-permission-test';
    if (user) req.auth = user;
    next();
  });
  app.get('/verify-payment', requirePermission('payments.verify'), (_req, res) => {
    res.status(204).end();
  });
  return app;
}

describe('requirePermission middleware', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(permissionTestApp()).get('/verify-payment').expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects Staff because Staff do not have payment-verification permission', async () => {
    const response = await request(permissionTestApp(staff))
      .get('/verify-payment')
      .expect(403);
    expect(response.body.error.code).toBe('PERMISSION_DENIED');
  });

  it.each([manager, owner])('allows the $roleCode role when permission is assigned', async (user) => {
    await request(permissionTestApp(user)).get('/verify-payment').expect(204);
  });
});
