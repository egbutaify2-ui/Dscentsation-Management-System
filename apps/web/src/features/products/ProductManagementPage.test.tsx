// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductManagementPage } from './ProductManagementPage.js';

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

const sampleProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetic Amber',
  description: 'Synthetic fragrance record',
  internalCode: 'SYN-AMBER',
  categoryId: '22222222-2222-4222-8222-222222222222',
  categoryName: 'Synthetic fragrances',
  status: 'active' as const,
  variants: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      productId: '11111111-1111-4111-8111-111111111111',
      name: 'Default',
      sku: 'SYN-001',
      unitOfMeasure: 'bottle',
      sellingPrice: '1500.00',
      costPrice: '700.00',
      currency: 'NGN',
      isActive: true,
      isDefault: true,
    },
  ],
};

const sampleCategory = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Synthetic fragrances',
  description: 'Synthetic category',
  parentId: null,
  parentName: null,
  isActive: true,
  productCount: 1,
};

afterEach(() => cleanup());

describe('ProductManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsrfToken.mockResolvedValue('synthetic-csrf');
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/categories') return [sampleCategory];
      if (path.startsWith('/products/')) return sampleProduct;
      return [sampleProduct];
    });
    mocks.post.mockResolvedValue(sampleProduct);
    mocks.patch.mockResolvedValue(sampleProduct);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('renders the product list and opens a product detail view with current prices', async () => {
    render(<ProductManagementPage />);
    expect(await screen.findByRole('heading', { name: 'Product list' })).toBeTruthy();
    expect(screen.getByText('Synthetic Amber')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic Amber' })).toBeTruthy();
    expect(screen.getByText('₦1,500.00')).toBeTruthy();
    expect(screen.getByText('₦700.00')).toBeTruthy();
  });

  it('creates a product with its required initial default variant', async () => {
    render(<ProductManagementPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'New synthetic product' },
    });
    fireEvent.change(screen.getByLabelText('Selling price (NGN)'), {
      target: { value: '1200.50' },
    });
    fireEvent.change(screen.getByLabelText('Cost price (NGN)'), {
      target: { value: '450.25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/products',
        expect.objectContaining({
          name: 'New synthetic product',
          variant: expect.objectContaining({
            name: 'Default',
            sellingPrice: '1200.50',
            costPrice: '450.25',
          }),
        }),
        'synthetic-csrf',
      ),
    );
  });

  it('edits product details and supports adding a further variant', async () => {
    render(<ProductManagementPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Renamed synthetic amber' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        `/products/${sampleProduct.id}`,
        expect.objectContaining({ name: 'Renamed synthetic amber' }),
        'synthetic-csrf',
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }));
    fireEvent.change(screen.getByLabelText('Variant / size label'), {
      target: { value: '50ml' },
    });
    fireEvent.change(screen.getByLabelText('Selling price (NGN)'), {
      target: { value: '1750.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save variant' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        `/products/${sampleProduct.id}/variants`,
        expect.objectContaining({ name: '50ml', sellingPrice: '1750.00' }),
        'synthetic-csrf',
      ),
    );
  });

  it('manages product categories and parent selection', async () => {
    render(<ProductManagementPage />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Categories' }));
    expect(await screen.findByRole('heading', { name: 'Categories' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    fireEvent.change(screen.getByLabelText('Category name'), {
      target: { value: 'New category' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/categories',
        expect.objectContaining({ name: 'New category' }),
        'synthetic-csrf',
      ),
    );
  });

  it('asks for confirmation before archiving and displays API validation errors', async () => {
    render(<ProductManagementPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'View' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive product' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        `/products/${sampleProduct.id}/status`,
        { status: 'archived' },
        'synthetic-csrf',
      ),
    );
    expect(window.confirm).toHaveBeenCalled();

    mocks.post.mockRejectedValueOnce(new Error('Product name is required.'));
    fireEvent.click(await screen.findByRole('button', { name: /Back to products/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Synthetic API rejection target' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('searches using the backend product search endpoint', async () => {
    render(<ProductManagementPage />);
    await screen.findByRole('heading', { name: 'Product list' });
    fireEvent.change(screen.getByLabelText('Search by product, internal code or SKU'), {
      target: { value: 'SYN-AMBER' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/products?q=SYN-AMBER&status=active'));
  });
});
