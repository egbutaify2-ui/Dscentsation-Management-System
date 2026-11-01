// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvitationPage } from './AcceptInvitationPage.js';

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock('../../lib/api/client.js', () => ({
  api: { post: mocks.post },
  getCsrfToken: mocks.getCsrfToken,
}));

afterEach(() => cleanup());

describe('AcceptInvitationPage', () => {
  it('lets an invited employee set a password without an authenticated session', async () => {
    const onAccepted = vi.fn().mockResolvedValue(undefined);
    mocks.getCsrfToken.mockResolvedValue('anonymous-csrf');
    mocks.post.mockResolvedValue({ accepted: true });
    render(<AcceptInvitationPage token={'T'.repeat(43)} onAccepted={onAccepted} />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'employee-password-2026' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'employee-password-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and activate' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/users/invitations/accept',
        { token: 'T'.repeat(43), password: 'employee-password-2026' },
        'anonymous-csrf',
      ),
    );
    expect(onAccepted).toHaveBeenCalledOnce();
  });

  it('rejects mismatched passwords before calling the API', async () => {
    mocks.getCsrfToken.mockResolvedValue('anonymous-csrf');
    render(<AcceptInvitationPage token={'T'.repeat(43)} onAccepted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'employee-password-2026' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different-password-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and activate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('The passwords do not match.');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('shows expired or invalid invitation errors', async () => {
    mocks.getCsrfToken.mockResolvedValue('anonymous-csrf');
    mocks.post.mockRejectedValueOnce(
      new Error('This invitation is invalid, expired or no longer available.'),
    );
    render(<AcceptInvitationPage token={'T'.repeat(43)} onAccepted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'employee-password-2026' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'employee-password-2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password and activate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('invalid, expired');
  });
});
