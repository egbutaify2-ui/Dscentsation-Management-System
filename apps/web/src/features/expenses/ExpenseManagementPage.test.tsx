// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseManagementPage } from './ExpenseManagementPage.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  postEmpty: vi.fn(),
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
    postEmpty: mocks.postEmpty,
  },
  getCsrfToken: mocks.getCsrfToken,
}));

const categoryId = '22222222-2222-4222-8222-222222222222';
const expenseId = '11111111-1111-4111-8111-111111111111';

const sampleCategory = {
  id: categoryId,
  code: 'OFFICE',
  name: 'Office supplies',
  description: 'Stationery and office items',
  isActive: true,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

const revisionOne = {
  id: '33333333-3333-4333-8333-333333333333',
  expenseId,
  revisionNumber: 1,
  categoryId,
  categoryCode: 'OFFICE',
  categoryName: 'Office supplies',
  description: 'Printer paper and pens',
  amountMinor: '123456',
  currency: 'NGN',
  incurredOn: '2026-10-30',
  payeeName: 'Example Stationers',
  createdBy: '44444444-4444-4444-8444-444444444444',
  createdAt: '2026-10-30T10:00:00.000Z',
};

const revisionTwo = {
  ...revisionOne,
  id: '55555555-5555-4555-8555-555555555555',
  revisionNumber: 2,
  description: 'Printer paper, pens and folders',
  amountMinor: '145050',
  createdAt: '2026-10-31T10:00:00.000Z',
};

const sampleExpense = {
  id: expenseId,
  status: 'draft' as const,
  currentRevision: revisionOne,
  createdBy: '44444444-4444-4444-8444-444444444444',
  updatedBy: '44444444-4444-4444-8444-444444444444',
  createdAt: '2026-10-30T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
};

const page = <T,>(items: T[]) => ({
  items,
  page: 1,
  pageSize: 100,
  total: items.length,
  totalPages: items.length ? 1 : 0,
});

const permissions = [
  'expenses.view',
  'expenses.create',
  'expenses.update',
  'expense_categories.view',
  'expense_categories.manage',
];

afterEach(() => cleanup());

describe('ExpenseManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsrfToken.mockResolvedValue('synthetic-csrf');
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/expense-categories')) return page([sampleCategory]);
      if (path === '/expenses/' + expenseId + '/revisions') return [revisionOne];
      if (path === '/expenses/' + expenseId) return sampleExpense;
      if (path.startsWith('/expenses')) return page([sampleExpense]);
      return page([]);
    });
    mocks.post.mockResolvedValue(sampleExpense);
    mocks.patch.mockResolvedValue({ ...sampleExpense, currentRevision: revisionTwo });
    mocks.postEmpty.mockResolvedValue(undefined);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('loads expense records and displays the NGN draft amount and status', async () => {
    render(<ExpenseManagementPage permissions={permissions} />);
    expect(await screen.findByRole('heading', { name: 'Expense records' })).toBeTruthy();
    expect(screen.getByText('Example Stationers')).toBeTruthy();
    expect(screen.getByText('₦1,234.56')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('/expenses?pageSize=100');
  });

  it('creates a draft and converts NGN decimal input to integer kobo without floating point', async () => {
    render(<ExpenseManagementPage permissions={permissions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expense' }));
    await screen.findByRole('option', { name: 'Office supplies' });
    fireEvent.change(screen.getByLabelText('Expense category'), {
      target: { value: categoryId },
    });
    fireEvent.change(screen.getByLabelText('Expense description'), {
      target: { value: 'Monthly office supplies' },
    });
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), {
      target: { value: '1234.56' },
    });
    fireEvent.change(screen.getByLabelText('Date incurred'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(screen.getByLabelText('Payee name'), {
      target: { value: 'Example Stationers' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/expenses',
        expect.objectContaining({
          categoryId,
          description: 'Monthly office supplies',
          amountMinor: '123456',
          currency: 'NGN',
          incurredOn: '2026-11-01',
          payeeName: 'Example Stationers',
        }),
        'synthetic-csrf',
      ),
    );
  });

  it('loads details and revision history, then edits through the revision endpoint', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/expense-categories')) return page([sampleCategory]);
      if (path === '/expenses/' + expenseId + '/revisions') return [revisionOne, revisionTwo];
      if (path === '/expenses/' + expenseId) {
        return { ...sampleExpense, currentRevision: revisionTwo };
      }
      if (path.startsWith('/expenses')) return page([sampleExpense]);
      return page([]);
    });
    render(<ExpenseManagementPage permissions={permissions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'Example Stationers' })).toBeTruthy();
    expect(screen.getByText('Revision 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    fireEvent.change(screen.getByLabelText('Expense description'), {
      target: { value: 'Updated office supplies' },
    });
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), {
      target: { value: '1450.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new revision' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        '/expenses/' + expenseId,
        expect.objectContaining({
          description: 'Updated office supplies',
          amountMinor: '145050',
        }),
        'synthetic-csrf',
      ),
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/expenses/' + expenseId + '/revisions'));
  });

  it('creates categories and shows explicit active and inactive states', async () => {
    const inactiveCategory = { ...sampleCategory, id: '66666666-6666-4666-8666-666666666666', code: 'TRAVEL', name: 'Travel', isActive: false };
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/expense-categories')) return page([sampleCategory, inactiveCategory]);
      if (path.startsWith('/expenses')) return page([sampleExpense]);
      return [];
    });
    render(<ExpenseManagementPage permissions={permissions} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Categories' }));
    expect(await screen.findByText('Office supplies')).toBeTruthy();
    expect(screen.getByText('Travel')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    fireEvent.change(screen.getByLabelText('Category code'), { target: { value: 'UTILITIES' } });
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Utilities' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/expense-categories',
        expect.objectContaining({ code: 'UTILITIES', name: 'Utilities' }),
        'synthetic-csrf',
      ),
    );
  });

  it('edits a category and uses the dedicated activate and deactivate endpoints', async () => {
    render(<ExpenseManagementPage permissions={permissions} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Categories' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Category name'), {
      target: { value: 'Office and stationery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        '/expense-categories/' + categoryId,
        expect.objectContaining({ name: 'Office and stationery' }),
        'synthetic-csrf',
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(mocks.postEmpty).toHaveBeenCalledWith(
        '/expense-categories/' + categoryId + '/deactivate',
        'synthetic-csrf',
      ),
    );
  });

  it('searches and filters expenses through the backend query parameters', async () => {
    render(<ExpenseManagementPage permissions={permissions} />);
    await screen.findByRole('heading', { name: 'Expense records' });
    fireEvent.change(screen.getByLabelText('Search expenses'), {
      target: { value: 'Stationers' },
    });
    fireEvent.change(screen.getByLabelText('Filter expenses by category'), {
      target: { value: categoryId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith(
        '/expenses?q=Stationers&categoryId=' + categoryId + '&pageSize=100',
      ),
    );
  });

  it('does not render controls without their corresponding permissions', async () => {
    render(
      <ExpenseManagementPage permissions={['expenses.view', 'expense_categories.view']} />,
    );
    expect(await screen.findByRole('heading', { name: 'Expense records' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add expense' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Categories' }));
    expect(await screen.findByText('Office supplies')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('renders loading and API error states', async () => {
    let resolveList: ((value: unknown) => void) | undefined;
    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/expense-categories')) return Promise.resolve(page([sampleCategory]));
      if (path.startsWith('/expenses')) {
        return new Promise((resolve) => {
          resolveList = resolve;
        });
      }
      return Promise.resolve(sampleExpense);
    });
    render(<ExpenseManagementPage permissions={permissions} />);
    expect(screen.getByText('Loading expenses…')).toBeTruthy();
    resolveList?.(page([]));
    expect(await screen.findByText('No expense records found')).toBeTruthy();

    mocks.get.mockImplementation((path: string) => {
      if (path.startsWith('/expense-categories')) return Promise.resolve(page([sampleCategory]));
      if (path.startsWith('/expenses')) return Promise.reject(new Error('Expense service unavailable.'));
      return Promise.resolve(sampleExpense);
    });
    render(<ExpenseManagementPage permissions={permissions} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Expense service unavailable.');
  });
});
