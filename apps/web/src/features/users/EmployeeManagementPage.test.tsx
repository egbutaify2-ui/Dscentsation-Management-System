// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeManagementPage } from './EmployeeManagementPage.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock('../../lib/api/client.js', () => ({
  ApiError: class ApiError extends Error {
    readonly status = 400;
    readonly code = 'INVALID_REQUEST';
    readonly requestId = undefined;
  },
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
  },
  getCsrfToken: mocks.getCsrfToken,
}));

const employee = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'staff@example.invalid',
  displayName: 'Synthetic Staff',
  roleCode: 'STAFF' as const,
  roleName: 'Staff',
  status: 'active' as const,
  createdAt: '2026-11-01T10:00:00.000Z',
  lastLoginAt: null,
};

afterEach(() => cleanup());

describe('EmployeeManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsrfToken.mockResolvedValue('synthetic-csrf');
    mocks.get.mockResolvedValue([employee]);
    mocks.post.mockResolvedValue({
      employee: { ...employee, status: 'invited' },
      setupUrl: 'https://dms.example.invalid/#/invite/accept?token=synthetic-high-entropy-token',
      expiresAt: '2026-11-02T10:00:00.000Z',
    });
    mocks.patch.mockResolvedValue({
      employee: { ...employee, status: 'suspended' },
      sessionsRevoked: 1,
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('renders the employee directory with creation and last-login values', async () => {
    render(<EmployeeManagementPage canManage />);
    expect(await screen.findByRole('heading', { name: 'Employee directory' })).toBeTruthy();
    expect(screen.getByText('Synthetic Staff')).toBeTruthy();
    expect(screen.getByText('staff@example.invalid')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('searches and applies role and account status filters through the API', async () => {
    render(<EmployeeManagementPage canManage />);
    await screen.findByRole('heading', { name: 'Employee directory' });
    fireEvent.change(screen.getByLabelText('Search name or email'), {
      target: { value: 'staff@example.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'STAFF' } });
    fireEvent.change(screen.getByLabelText('Account status'), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenLastCalledWith(
        '/users?q=staff%40example.invalid&role=STAFF&status=active',
      ),
    );
  });

  it('creates an invitation and displays the one-time link with a manual-delivery warning', async () => {
    render(<EmployeeManagementPage canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite employee' }));
    fireEvent.change(screen.getByLabelText('Employee name'), {
      target: { value: 'New synthetic employee' },
    });
    fireEvent.change(screen.getByLabelText('Company email address'), {
      target: { value: 'new@example.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'MANAGER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/users/invitations',
        { displayName: 'New synthetic employee', email: 'new@example.invalid', role: 'MANAGER' },
        'synthetic-csrf',
      ),
    );
    expect(await screen.findByRole('heading', { name: /Invitation created for/ })).toBeTruthy();
    expect((screen.getByLabelText('One-time invitation URL') as HTMLInputElement).value).toBe(
      'https://dms.example.invalid/#/invite/accept?token=synthetic-high-entropy-token',
    );
    expect(screen.getByText(/DMS does not send invitations automatically/)).toBeTruthy();
    expect(screen.getByText(/official Dscentsation company email identity/)).toBeTruthy();
  });

  it('copies the invitation URL when clipboard support is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<EmployeeManagementPage canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite employee' }));
    fireEvent.change(screen.getByLabelText('Employee name'), { target: { value: 'Copy target' } });
    fireEvent.change(screen.getByLabelText('Company email address'), {
      target: { value: 'copy@example.invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invitation link' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'https://dms.example.invalid/#/invite/accept?token=synthetic-high-entropy-token',
      ),
    );
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('confirms suspension and reports API errors', async () => {
    render(<EmployeeManagementPage canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        `/users/${employee.id}/status`,
        { status: 'suspended' },
        'synthetic-csrf',
      ),
    );
    expect(window.confirm).toHaveBeenCalled();

    mocks.patch.mockRejectedValueOnce(new Error('Account could not be suspended.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Account could not be suspended.',
    );
  });

  it('revokes sessions and hides management actions without users.manage', async () => {
    const { rerender } = render(<EmployeeManagementPage canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke sessions' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        `/users/${employee.id}/sessions/revoke`,
        {},
        'synthetic-csrf',
      ),
    );
    rerender(<EmployeeManagementPage canManage={false} />);
    expect(screen.queryByRole('button', { name: 'Invite employee' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke sessions' })).toBeNull();
  });
});
