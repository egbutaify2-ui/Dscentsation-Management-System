// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell.js';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'owner@example.invalid',
  displayName: 'Synthetic Owner',
  roleCode: 'OWNER' as const,
  roleName: 'Owner',
};

afterEach(() => cleanup());

describe('AppShell permission-aware navigation', () => {
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

  it('shows Employees only when the backend session reports users.view', () => {
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
    expect(screen.queryByRole('button', { name: 'Employees' })).toBeNull();
    rerender(
      <AppShell
        user={user}
        permissions={['users.view']}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Employees' }));
    expect(onNavigate).toHaveBeenCalledWith('employees');
  });

  it('shows Activity only when the backend session reports users.view', () => {
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
    expect(screen.queryByRole('button', { name: 'Activity' })).toBeNull();

    rerender(
      <AppShell
        user={user}
        permissions={['users.view']}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
    expect(onNavigate).toHaveBeenCalledWith('activity');
  });

  it('shows Customers only when the backend session reports customers.view', () => {
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
    expect(screen.queryByRole('button', { name: 'Customers' })).toBeNull();

    rerender(
      <AppShell
        user={user}
        permissions={['customers.view']}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Customers' }));
    expect(onNavigate).toHaveBeenCalledWith('customers');
    expect((screen.getByRole('button', { name: /Orders/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /Inventory/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows Suppliers only when the backend session reports suppliers.view', () => {
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
    expect(screen.queryByRole('button', { name: 'Suppliers' })).toBeNull();

    rerender(
      <AppShell
        user={user}
        permissions={['suppliers.view']}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Suppliers' }));
    expect(onNavigate).toHaveBeenCalledWith('suppliers');
  });

  it('shows Expenses when the session grants expense or expense-category view permission', () => {
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
    expect(screen.queryByRole('button', { name: 'Expenses' })).toBeNull();

    rerender(
      <AppShell
        user={user}
        permissions={['expense_categories.view']}
        activeSection="overview"
        onNavigate={onNavigate}
        onLogout={async () => undefined}
      >
        <p>Overview content</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expenses' }));
    expect(onNavigate).toHaveBeenCalledWith('expenses');
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
    expect((screen.getByRole('button', { name: /Inventory/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Products content')).toBeTruthy();
  });
});
