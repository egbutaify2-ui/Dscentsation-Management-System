// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupplierManagementPage } from './SupplierManagementPage.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getPage: vi.fn(),
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
    getPage: mocks.getPage,
    post: mocks.post,
    patch: mocks.patch,
    postEmpty: mocks.postEmpty,
  },
  getCsrfToken: mocks.getCsrfToken,
}));

const supplierId = '11111111-1111-4111-8111-111111111111';
const sampleSupplier = {
  id: supplierId,
  supplierCode: 'SUP-000123',
  displayName: 'Synthetic Fragrance Supplies Ltd',
  status: 'active' as const,
  createdBy: '22222222-2222-4222-8222-222222222222',
  updatedBy: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T10:30:00.000Z',
};
const inactiveSupplier = { ...sampleSupplier, status: 'inactive' as const };
const pageMeta = { page: 1, pageSize: 25, total: 1, totalPages: 1 };
const fullPermissions = [
  'suppliers.view',
  'suppliers.create',
  'suppliers.update',
  'suppliers.manage_status',
];

afterEach(() => cleanup());

describe('SupplierManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsrfToken.mockResolvedValue('synthetic-csrf');
    mocks.getPage.mockResolvedValue({ data: [sampleSupplier], meta: pageMeta });
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/suppliers/duplicate-check')) return [];
      if (path === `/suppliers/${supplierId}`) return sampleSupplier;
      return sampleSupplier;
    });
    mocks.post.mockResolvedValue(sampleSupplier);
    mocks.patch.mockResolvedValue({ ...sampleSupplier, displayName: 'Renamed Supplier' });
    mocks.postEmpty.mockResolvedValue(undefined);
  });

  it('loads the supplier directory with real backend pagination metadata', async () => {
    render(<SupplierManagementPage permissions={fullPermissions} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Supplier directory' })).toBeTruthy();
    expect(await screen.findByText('SUP-000123')).toBeTruthy();
    expect(await screen.findByText('Synthetic Fragrance Supplies Ltd')).toBeTruthy();
    expect(await screen.findByText('Page 1 of 1')).toBeTruthy();
    expect(mocks.getPage).toHaveBeenCalledWith('/suppliers?status=active&page=1&pageSize=25');
  });

  it('searches suppliers and follows backend pagination', async () => {
    mocks.getPage.mockResolvedValue({
      data: [sampleSupplier],
      meta: { page: 1, pageSize: 25, total: 30, totalPages: 2 },
    });
    render(<SupplierManagementPage permissions={fullPermissions} />);
    await screen.findByRole('heading', { name: 'Supplier directory' });

    fireEvent.change(screen.getByLabelText('Search by supplier business name'), {
      target: { value: 'Synthetic Supplies' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() =>
      expect(mocks.getPage).toHaveBeenLastCalledWith(
        '/suppliers?q=Synthetic+Supplies&status=active&page=1&pageSize=25',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mocks.getPage).toHaveBeenLastCalledWith(
        '/suppliers?q=Synthetic+Supplies&status=active&page=2&pageSize=25',
      ),
    );
  });

  it('checks for possible duplicates before creation and allows an advisory override', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/suppliers/duplicate-check')) return [sampleSupplier];
      return sampleSupplier;
    });
    render(<SupplierManagementPage permissions={fullPermissions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add supplier' }));
    fireEvent.change(screen.getByLabelText('Business name'), {
      target: { value: 'Synthetic Fragrance Supplies Ltd' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check for possible matches' }));

    expect(await screen.findByText('Possible matching suppliers found')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith(
      '/suppliers/duplicate-check?name=Synthetic%20Fragrance%20Supplies%20Ltd',
    );
    expect(mocks.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create supplier anyway' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/suppliers',
        { displayName: 'Synthetic Fragrance Supplies Ltd' },
        'synthetic-csrf',
      ),
    );
  });

  it('edits a supplier business name without changing its generated reference', async () => {
    render(<SupplierManagementPage permissions={fullPermissions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    expect(
      await screen.findByRole('heading', { name: 'Synthetic Fragrance Supplies Ltd' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    fireEvent.change(screen.getByLabelText('Business name'), {
      target: { value: 'Renamed Supplier' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        `/suppliers/${supplierId}`,
        { displayName: 'Renamed Supplier' },
        'synthetic-csrf',
      ),
    );
    expect(
      within(screen.getByRole('region', { name: 'Renamed Supplier' })).getByText('SUP-000123', {
        selector: 'p',
      }),
    ).toBeTruthy();
    expect(screen.getAllByText('SUP-000123')).toHaveLength(2);
  });

  it('asks for confirmation before deactivation and uses the status endpoint', async () => {
    render(<SupplierManagementPage permissions={fullPermissions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate supplier' }));

    expect(screen.getByRole('dialog', { name: 'Deactivate supplier?' })).toBeTruthy();
    expect(mocks.postEmpty).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));

    await waitFor(() =>
      expect(mocks.postEmpty).toHaveBeenCalledWith(
        `/suppliers/${supplierId}/deactivate`,
        'synthetic-csrf',
      ),
    );
  });

  it('reactivates an inactive supplier with the activate endpoint', async () => {
    mocks.get.mockResolvedValue(inactiveSupplier);
    render(<SupplierManagementPage permissions={fullPermissions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Activate supplier' }));
    await waitFor(() =>
      expect(mocks.postEmpty).toHaveBeenCalledWith(
        `/suppliers/${supplierId}/activate`,
        'synthetic-csrf',
      ),
    );
  });

  it('hides create, edit and status controls without their permissions', async () => {
    render(<SupplierManagementPage permissions={['suppliers.view']} />);
    expect(await screen.findByRole('heading', { name: 'Supplier directory' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add supplier' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(
      await screen.findByRole('heading', { name: 'Synthetic Fragrance Supplies Ltd' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deactivate supplier' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate supplier' })).toBeNull();
  });

  it('renders an empty state when the backend returns no suppliers', async () => {
    mocks.getPage.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    });
    render(<SupplierManagementPage permissions={fullPermissions} />);
    expect(await screen.findByText('No suppliers found')).toBeTruthy();
  });

  it('renders and retries an API loading error', async () => {
    mocks.getPage
      .mockRejectedValueOnce(new Error('Supplier directory unavailable.'))
      .mockResolvedValueOnce({ data: [sampleSupplier], meta: pageMeta });
    render(<SupplierManagementPage permissions={fullPermissions} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Supplier directory unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Synthetic Fragrance Supplies Ltd')).toBeTruthy();
  });
});
