import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.invalid',
  displayName: 'Synthetic Owner',
  roleCode: 'OWNER' as const,
  roleName: 'Owner',
};

describe('AppShell Product Management navigation', () => {
  it('shows Products only when the backend session reports products.view', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <AppShell
        user={user}
        permissions={[]}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    expect(screen.queryByRole('button', { name: 'Products' })).toBeNull();

    rerender(
      <AppShell
        user={user}
        permissions={['products.view']}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Products' }));
    expect(onNavigate).toHaveBeenCalledWith('products');
  });

  it('keeps unfinished business modules disabled', () => {
    render(
      <AppShell
        user={user}
        permissions={['products.view']}
        activeSection="products"
        onNavigate={vi.fn()}
        onLogout={async () => undefined}
      >
        <p>Products content</p>
      </AppShell>,
    );
    expect((screen.getByRole('button', { name: /Orders/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: /Inventory/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Products content')).toBeTruthy();
  });
});
