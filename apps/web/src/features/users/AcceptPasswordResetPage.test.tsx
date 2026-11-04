// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptPasswordResetPage } from './AcceptPasswordResetPage.js';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock('../../lib/api/client.js', () => ({
  api: { post: mocks.post },
  getCsrfToken: mocks.getCsrfToken,
}));

afterEach(() => cleanup());

describe('AcceptPasswordResetPage', () => {
  it('submits the one-time token and password in the POST body', async () => {
    const onResetComplete = vi.fn().mockResolvedValue(undefined);
    mocks.getCsrfToken.mockResolvedValue('anonymous-csrf');
    mocks.post.mockResolvedValue({ reset: true });
    const token = 'T'.repeat(43);
    render(<AcceptPasswordResetPage token={token} onResetComplete={onResetComplete} />);

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Employee-reset-password-2026' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Employee-reset-password-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/users/password-resets/accept',
        { token, password: 'Employee-reset-password-2026' },
        'anonymous-csrf',
      ),
    );
    expect(onResetComplete).toHaveBeenCalledOnce();
  });

  it('rejects mismatched passwords before calling the API', async () => {
    mocks.getCsrfToken.mockResolvedValue('anonymous-csrf');
    render(<AcceptPasswordResetPage token={'T'.repeat(43)} onResetComplete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Employee-reset-password-2026' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Different-reset-password-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect((await screen.findByRole('alert')).textContent).toContain('passwords do not match');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('displays an invalid, expired, revoked or consumed link error', async () => {
    mocks.getCsrfToken.mockResolvedValue('anonymous-csrf');
    mocks.post.mockRejectedValueOnce(
      new Error('This password-reset link is invalid, expired or no longer available.'),
    );
    render(<AcceptPasswordResetPage token={'T'.repeat(43)} onResetComplete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Employee-reset-password-2026' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Employee-reset-password-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect((await screen.findByRole('alert')).textContent).toContain('invalid, expired');
  });
});
