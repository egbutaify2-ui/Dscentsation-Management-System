// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/AuthProvider.js';
import { DashboardPage } from './DashboardPage.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getPage: vi.fn(),
  permissions: [] as string[],
}));

vi.mock('../auth/AuthProvider.js', () => ({
  useAuth: () => ({ permissions: mocks.permissions }),
}));

vi.mock('../../lib/api/client.js', () => ({
  ApiError: class ApiError extends Error {
    readonly status = 500;
    readonly code = 'INTERNAL_SERVER_ERROR';
  },
  api: {
    get: mocks.get,
    getPage: mocks.getPage,
  },
}));

const user: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.invalid',
  displayName: 'Ifeanyi Owner',
  roleCode: 'OWNER',
  roleName: 'Owner',
};

const activityResponse = {
  items: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      actorDisplayName: 'Ada Manager',
      action: 'customer.created',
      entityType: 'customer',
      occurredAt: '2026-11-04T12:00:00.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      actorDisplayName: 'System',
      action: 'product.updated',
      entityType: 'product',
      occurredAt: '2026-11-04T11:00:00.000Z',
    },
  ],
};

afterEach(() => cleanup());

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions = [];
    mocks.getPage.mockImplementation(async (path: string) => ({
      data: [],
      meta: {
        page: 1,
        pageSize: 1,
        total: path.startsWith('/orders') ? 18 : 7,
        totalPages: 1,
      },
    }));
    mocks.get.mockResolvedValue(activityResponse);
  });

  it('does not request any module data when the user has no view permissions', async () => {
    render(<DashboardPage user={user} />);

    expect((await screen.findAllByText('No access')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Activity is restricted')).toBeTruthy();
    expect(mocks.getPage).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.getByText('Your account does not have products.view access.')).toBeTruthy();
  });

  it('requests only the modules allowed by the authenticated user permissions', async () => {
    mocks.permissions = ['orders.view', 'products.view'];
    render(<DashboardPage user={user} />);

    expect(await screen.findByText('18')).toBeTruthy();
    expect(screen.getByText('Active customers')).toBeTruthy();
    expect(screen.getAllByText('No access').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(mocks.getPage).toHaveBeenCalledTimes(1);
      expect(mocks.getPage).toHaveBeenCalledWith('/orders?page=1&pageSize=1');
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('uses server pagination metadata for order and active customer counts', async () => {
    mocks.permissions = ['orders.view', 'customers.view'];
    mocks.getPage.mockImplementation(async (path: string) => ({
      data: [],
      meta: {
        page: 1,
        pageSize: 1,
        total: path.startsWith('/orders') ? 1250 : 84,
        totalPages: 1,
      },
    }));
    render(<DashboardPage user={user} />);

    expect(await screen.findByText('1,250')).toBeTruthy();
    expect(await screen.findByText('84')).toBeTruthy();
    expect(mocks.getPage).toHaveBeenCalledWith('/orders?page=1&pageSize=1');
    expect(mocks.getPage).toHaveBeenCalledWith('/customers?status=active&page=1&pageSize=1');
  });

  it('renders server-returned zero as an actual zero count', async () => {
    mocks.permissions = ['customers.view'];
    mocks.getPage.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 1, total: 0, totalPages: 0 },
    });
    render(<DashboardPage user={user} />);

    expect(await screen.findByText('0')).toBeTruthy();
    expect(screen.getByText('No matching records yet.')).toBeTruthy();
  });

  it('keeps sections independent when one metric endpoint fails and retries only that metric', async () => {
    mocks.permissions = ['orders.view', 'customers.view'];
    mocks.getPage.mockImplementation(async (path: string) => {
      if (path.startsWith('/orders')) throw new Error('Orders service unavailable.');
      return {
        data: [],
        meta: { page: 1, pageSize: 1, total: 7, totalPages: 1 },
      };
    });
    render(<DashboardPage user={user} />);

    expect(await screen.findByText('Orders service unavailable.')).toBeTruthy();
    expect(await screen.findByText('7')).toBeTruthy();
    expect(screen.getByText('Active customers')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry orders count' })).toBeTruthy();

    mocks.getPage.mockImplementation(async () => ({
      data: [],
      meta: { page: 1, pageSize: 1, total: 19, totalPages: 1 },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry orders count' }));
    expect(await screen.findByText('19')).toBeTruthy();
  });

  it('renders recent activity with Lagos-local timestamps and retries independently', async () => {
    mocks.permissions = ['users.view'];
    render(<DashboardPage user={user} />);

    expect(await screen.findByText('Customer Created')).toBeTruthy();
    expect(screen.getByText('Ada Manager')).toBeTruthy();
    const expectedTime = new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    }).format(new Date(activityResponse.items[0]!.occurredAt));
    expect(screen.getByText(expectedTime)).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith('/audit-logs?page=1&pageSize=5');
    expect(mocks.getPage).not.toHaveBeenCalled();
  });

  it('shows an independent recent-activity error and allows retry', async () => {
    mocks.permissions = ['users.view'];
    mocks.get.mockRejectedValueOnce(new Error('Audit service unavailable.'));
    render(<DashboardPage user={user} />);

    expect(await screen.findByText('Audit service unavailable.')).toBeTruthy();
    mocks.get.mockResolvedValue(activityResponse);
    fireEvent.click(screen.getByRole('button', { name: 'Retry activity' }));
    expect(await screen.findByText('Customer Created')).toBeTruthy();
  });

  it('shows loading state while a permitted summary request is pending', () => {
    mocks.permissions = ['orders.view', 'users.view'];
    mocks.getPage.mockImplementation(() => new Promise(() => undefined));
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    render(<DashboardPage user={user} />);

    expect(screen.getByText('Loading from the server…')).toBeTruthy();
    expect(screen.getByText('Loading recent activity…')).toBeTruthy();
  });
});
