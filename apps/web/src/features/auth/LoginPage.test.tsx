// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage.js';

describe('LoginPage', () => {
  it('renders the DMS sign-in form with accessible labels', () => {
    render(<LoginPage onLogin={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('submits the entered credentials to its caller', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<LoginPage onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@example.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith('owner@example.invalid', 'test-password');
    });
  });
});
