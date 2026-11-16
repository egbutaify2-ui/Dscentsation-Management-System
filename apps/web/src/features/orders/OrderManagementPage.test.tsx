// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getCsrfToken } from '../../lib/api/client.js';
import { OrderManagementPage, type OrderLocationOption } from './OrderManagementPage.js';

vi.mock('../../lib/api/client.js', () => ({
  ApiError: class ApiError extends Error {
    status = 400;
    code = 'TEST_ERROR';
    requestId = 'test-request';
  },
  api: {
    get: vi.fn(),
    getPage: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  getCsrfToken: vi.fn(),
}));

const customerId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';
const orderId = '55555555-5555-4555-8555-555555555555';

const sampleCustomer = {
  id: customerId,
  fullName: 'Synthetic Customer',
  phone: '+2348000000000',
  email: 'customer@example.invalid',
  status: 'active' as const,
};

const sampleProduct = {
  id: productId,
  name: 'Synthetic Eau de Parfum',
  internalCode: 'SYN-01',
  status: 'active' as const,
  variants: [
    {
      id: variantId,
      productId,
      name: '100 ml',
      sku: 'SYN-100',
      unitOfMeasure: 'bottle',
      sellingPrice: '12500.00',
      isActive: true,
      isDefault: true,
    },
  ],
};

const sampleOrder = {
  id: orderId,
  customerId,
  customerNameSnapshot: 'Synthetic Customer',
  customerPhoneSnapshot: '+2348000000000',
  customerEmailSnapshot: 'customer@example.invalid',
  sourceChannel: 'whatsapp' as const,
  status: 'received' as const,
  fulfilmentLocationId: locationId,
  items: [
    {
      productId,
      productVariantId: variantId,
      productNameSnapshot: 'Synthetic Eau de Parfum',
      variantNameSnapshot: '100 ml',
      skuSnapshot: 'SYN-100',
      unitOfMeasureSnapshot: 'bottle',
      unitPriceMinor: '1250000',
      quantity: 2,
      discountMinor: '0',
      lineTotalMinor: '2500000',
    },
  ],
  currency: 'NGN' as const,
  subtotalMinor: '2500000',
  discountMinor: '0',
  deliveryFeeMinor: '0',
  totalMinor: '2500000',
  deliveryAddressSnapshot: '12 Example Road, Lagos',
  notes: 'Call on arrival',
  createdBy: 'owner-id',
  updatedBy: 'owner-id',
  createdAt: '2026-11-02T09:00:00.000Z',
  updatedAt: '2026-11-02T09:00:00.000Z',
};

const pageMeta = { page: 1, pageSize: 10, total: 1, totalPages: 1 };
const permissions = [
  'orders.view',
  'orders.create',
  'orders.update',
  'customers.view',
  'products.view',
];
const locations: OrderLocationOption[] = [
  { id: locationId, code: 'SHERATON', name: 'Sheraton Store (SHERATON)', isActive: true },
];

function mockReferenceCalls() {
  vi.mocked(api.getPage).mockImplementation((path) => {
    if (path.startsWith('/customers')) {
      return Promise.resolve({ data: [sampleCustomer], meta: pageMeta } as never);
    }
    return Promise.resolve({ data: [sampleOrder], meta: pageMeta } as never);
  });
  vi.mocked(api.get).mockImplementation((path) => {
    if (path === '/locations') return Promise.resolve(locations as never);
    if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
    if (path.startsWith('/orders/')) return Promise.resolve(sampleOrder as never);
    return Promise.reject(new Error('Unexpected API GET ' + path));
  });
  vi.mocked(getCsrfToken).mockResolvedValue('synthetic-csrf');
}

function openCreateForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Create order' }));
  return screen.getByRole('heading', { name: 'Create an order' });
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  mockReferenceCalls();
  vi.mocked(api.post).mockResolvedValue(sampleOrder as never);
  vi.mocked(api.patch).mockResolvedValue(sampleOrder as never);
});

describe('OrderManagementPage', () => {
  it('does not expose the module or order actions without orders.view', () => {
    render(<OrderManagementPage permissions={['orders.create', 'orders.update']} />);
    expect(screen.getByText('You do not have access to Order Management.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create order' })).toBeNull();
    expect(api.getPage).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('renders the order register with key order fields', async () => {
    render(<OrderManagementPage permissions={['orders.view']} />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/locations'));
    const orderTable = await screen.findByRole('table');
    const orderRow = within(orderTable).getByRole('row', {
      name: /ORD-555555555555/,
    });
    expect(within(orderRow).getByText('Synthetic Customer')).toBeTruthy();
    expect(within(orderRow).getByText('WhatsApp')).toBeTruthy();
    expect(within(orderRow).getByText('Sheraton Store (SHERATON)')).toBeTruthy();
    expect(within(orderRow).getByText('₦25,000.00')).toBeTruthy();
    expect(within(orderRow).getByText('Received')).toBeTruthy();
  });
  it('shows loading while the order register request is pending', async () => {
    let completeRequest: (() => void) | undefined;
    vi.mocked(api.getPage).mockImplementation((path) => {
      if (path.startsWith('/orders?')) {
        return new Promise((resolve) => {
          completeRequest = () => resolve({ data: [sampleOrder], meta: pageMeta } as never);
        }) as never;
      }
      return Promise.resolve({ data: [], meta: pageMeta } as never);
    });
    render(<OrderManagementPage permissions={['orders.view']} />);

    expect(screen.getByRole('status').textContent).toContain('Loading orders…');
    await waitFor(() => expect(completeRequest).toBeTypeOf('function'));
    completeRequest?.();
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('shows the empty state when the order register has no matching records', async () => {
    vi.mocked(api.getPage).mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    } as never);
    render(<OrderManagementPage permissions={['orders.view']} />);

    expect(await screen.findByText('No orders found')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('hides create and amendment actions without their specific permissions', async () => {
    render(<OrderManagementPage permissions={['orders.view']} />);
    await screen.findByText('Synthetic Customer');
    expect(screen.queryByRole('button', { name: 'Create order' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'ORD-555555555555' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Amend order' })).toBeNull();
  });

  it('submits search and filters to the API and supports pagination', async () => {
    vi.mocked(api.getPage).mockImplementation((path) => {
      const meta = path.includes('page=2')
        ? { page: 2, pageSize: 10, total: 21, totalPages: 3 }
        : { page: 1, pageSize: 10, total: 21, totalPages: 3 };
      return Promise.resolve({ data: [sampleOrder], meta } as never);
    });
    render(<OrderManagementPage permissions={['orders.view']} />);

    await screen.findByText('Synthetic Customer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search orders' }), {
      target: { value: 'Synthetic' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'received' },
    });
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'whatsapp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(vi.mocked(api.getPage)).toHaveBeenLastCalledWith(
        '/orders?q=Synthetic&status=received&sourceChannel=whatsapp&page=1&pageSize=10',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(vi.mocked(api.getPage)).toHaveBeenLastCalledWith(
        '/orders?q=Synthetic&status=received&sourceChannel=whatsapp&page=2&pageSize=10',
      );
    });
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  });

  it('creates an order and displays server totals', async () => {
    vi.mocked(api.post).mockResolvedValue({
      ...sampleOrder,
      subtotalMinor: '2600000',
      totalMinor: '2600000',
    } as never);
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
      if (path.startsWith('/orders/')) {
        return Promise.resolve({
          ...sampleOrder,
          subtotalMinor: '2600000',
          totalMinor: '2600000',
        } as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(
      <OrderManagementPage
        permissions={['orders.view', 'orders.create', 'customers.view', 'products.view']}
      />,
    );
    openCreateForm();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Synthetic Customer/ })).toBeTruthy(),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Fulfilment location') as HTMLSelectElement).disabled).toBe(
        false,
      ),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Product / variant') as HTMLSelectElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(screen.getByLabelText('Customer'), {
      target: { value: customerId },
    });
    fireEvent.change(screen.getByLabelText('Source channel'), {
      target: { value: 'whatsapp' },
    });
    fireEvent.change(screen.getByLabelText('Fulfilment location'), {
      target: { value: locationId },
    });
    fireEvent.change(screen.getByLabelText('Product / variant'), {
      target: { value: productId + '|' + variantId },
    });
    fireEvent.change(screen.getByLabelText('New item quantity'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    const subtotal = screen.getByText('Estimated subtotal').parentElement;
    expect(subtotal).not.toBeNull();
    expect(within(subtotal as HTMLElement).getByText('₦25,000.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create order' }));

    await screen.findByRole('heading', { name: 'ORD-555555555555' });
    expect(api.post).toHaveBeenCalledWith(
      '/orders',
      {
        customerId,
        sourceChannel: 'whatsapp',
        fulfilmentLocationId: locationId,
        items: [{ productId, variantId, quantity: 2 }],
        deliveryAddress: null,
        notes: null,
      },
      'synthetic-csrf',
    );
    const posted = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(posted).not.toHaveProperty('unitPriceMinor');
    expect(posted).not.toHaveProperty('totalMinor');
    expect(posted).not.toHaveProperty('discountMinor');
    expect(posted).not.toHaveProperty('deliveryFeeMinor');
    const orderTotal = screen.getByText('Order total').parentElement;
    expect(orderTotal).not.toBeNull();
    expect(within(orderTotal as HTMLElement).getByText('₦26,000.00')).toBeTruthy();
    expect(screen.queryByText('Estimated subtotal')).toBeNull();
  });

  it('validates required order fields', async () => {
    render(<OrderManagementPage permissions={permissions} />);
    openCreateForm();
    fireEvent.submit(
      screen
        .getByRole('heading', { name: 'Create an order' })
        .closest('section')!
        .querySelector('form')!,
    );

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Choose a customer.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('only shows amendment controls for received orders', async () => {
    render(<OrderManagementPage permissions={permissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('button', { name: 'Amend order' })).toBeTruthy();

    vi.mocked(api.get).mockImplementation((path) => {
      if (path.startsWith('/orders/')) {
        return Promise.resolve({ ...sampleOrder, status: 'confirmed' } as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to register' }));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByText(/This order is not amendable/);
    expect(screen.queryByRole('button', { name: 'Amend order' })).toBeNull();
  });

  it('patches only changed fields and re-fetches the saved order after amendment', async () => {
    const amended = {
      ...sampleOrder,
      notes: 'Updated note',
      updatedAt: '2026-11-02T10:00:00.000Z',
    };
    vi.mocked(api.patch).mockResolvedValue(amended as never);
    let orderDetailFetches = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
      if (path.startsWith('/orders/')) {
        orderDetailFetches += 1;
        return Promise.resolve((orderDetailFetches === 1 ? sampleOrder : amended) as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={permissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend order' }));
    fireEvent.change(screen.getByLabelText('Order notes'), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }));

    expect((await screen.findByRole('status')).textContent).toContain('Order amendment saved.');
    expect(screen.getByText('Updated note')).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith(
      '/orders/' + orderId,
      { notes: 'Updated note' },
      'synthetic-csrf',
    );
    expect(api.get).toHaveBeenCalledTimes(4);
    expect(api.get).toHaveBeenCalledWith('/locations');
    expect(api.get).toHaveBeenLastCalledWith('/orders/' + orderId);
  });

  it('allows metadata-only amendments without customer or product view permissions', async () => {
    const amended = {
      ...sampleOrder,
      deliveryAddressSnapshot: 'Updated delivery address',
      updatedAt: '2026-11-02T10:00:00.000Z',
    };
    let detailFetches = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path.startsWith('/orders/')) {
        detailFetches += 1;
        return Promise.resolve((detailFetches === 1 ? sampleOrder : amended) as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={['orders.view', 'orders.update']} />);

    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend order' }));

    expect(screen.getByText('Synthetic Eau de Parfum')).toBeTruthy();
    expect(screen.getByText(/100 ml · SYN-100 · bottle/)).toBeTruthy();
    expect(screen.queryByLabelText('Product / variant')).toBeNull();
    expect(screen.queryByLabelText('New item quantity')).toBeNull();
    expect((screen.getByLabelText('Customer') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Quantity for item 1') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText('Saved server total')).toBeTruthy();
    expect(screen.queryByText('Estimated subtotal')).toBeNull();

    fireEvent.change(screen.getByLabelText('Delivery address'), {
      target: { value: 'Updated delivery address' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }));

    expect((await screen.findByRole('status')).textContent).toContain('Order amendment saved.');
    expect(screen.getByText('Updated delivery address')).toBeTruthy();
    expect(api.patch).toHaveBeenCalledWith(
      '/orders/' + orderId,
      { deliveryAddress: 'Updated delivery address' },
      'synthetic-csrf',
    );
    expect(api.getPage).not.toHaveBeenCalledWith('/customers?status=active&page=1&pageSize=100');
    expect(api.get).not.toHaveBeenCalledWith('/products?status=all');
  });

  it('allows product amendments with products.view but no customers.view', async () => {
    const amended = {
      ...sampleOrder,
      items: [{ ...sampleOrder.items[0], quantity: 3, lineTotalMinor: '3750000' }],
    };
    vi.mocked(api.patch).mockResolvedValue(amended as never);
    let detailFetches = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
      if (path.startsWith('/orders/')) {
        detailFetches += 1;
        return Promise.resolve((detailFetches === 1 ? sampleOrder : amended) as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={['orders.view', 'orders.update', 'products.view']} />);

    await screen.findByText('Synthetic Customer');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/products?status=all'));
    expect(api.getPage).not.toHaveBeenCalledWith('/customers?status=active&page=1&pageSize=100');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend order' }));

    expect((screen.getByLabelText('Customer') as HTMLSelectElement).disabled).toBe(true);
    expect(
      screen.getByRole('option', { name: /Synthetic Customer · existing order customer/ }),
    ).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByLabelText('Quantity for item 1') as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(screen.getByLabelText('Quantity for item 1'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }));

    expect((await screen.findByRole('status')).textContent).toContain('Order amendment saved.');
    expect(api.patch).toHaveBeenCalledWith(
      '/orders/' + orderId,
      { items: [{ productId, variantId, quantity: 3 }] },
      'synthetic-csrf',
    );
    expect(screen.getByText('Synthetic Customer')).toBeTruthy();
  });

  it('loads customers without products.view and disables line-item edits', async () => {
    const amended = { ...sampleOrder, notes: 'Customer access metadata amendment' };
    let detailFetches = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path.startsWith('/orders/')) {
        detailFetches += 1;
        return Promise.resolve((detailFetches === 1 ? sampleOrder : amended) as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(
      <OrderManagementPage permissions={['orders.view', 'orders.update', 'customers.view']} />,
    );

    await screen.findByText('Synthetic Customer');
    await waitFor(() =>
      expect(api.getPage).toHaveBeenCalledWith('/customers?status=active&page=1&pageSize=100'),
    );
    expect(api.get).not.toHaveBeenCalledWith('/products?status=all');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend order' }));

    const customerSelect = screen.getByLabelText('Customer') as HTMLSelectElement;
    await waitFor(() => expect(customerSelect.disabled).toBe(false));
    expect(within(customerSelect).getByRole('option', { name: /Synthetic Customer/ })).toBeTruthy();
    expect(screen.queryByLabelText('Product / variant')).toBeNull();
    expect((screen.getByLabelText('Quantity for item 1') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText('Order notes'), {
      target: { value: 'Customer access metadata amendment' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }));

    expect((await screen.findByRole('status')).textContent).toContain('Order amendment saved.');
    expect(api.patch).toHaveBeenCalledWith(
      '/orders/' + orderId,
      { notes: 'Customer access metadata amendment' },
      'synthetic-csrf',
    );
  });

  it('retains full-permission received-order line-item amendments', async () => {
    const amended = {
      ...sampleOrder,
      items: [{ ...sampleOrder.items[0], quantity: 3, lineTotalMinor: '3750000' }],
    };
    vi.mocked(api.patch).mockResolvedValue(amended as never);
    let detailFetches = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
      if (path.startsWith('/orders/')) {
        detailFetches += 1;
        return Promise.resolve((detailFetches === 1 ? sampleOrder : amended) as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={permissions} />);

    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Amend order' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Quantity for item 1') as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(screen.getByLabelText('Quantity for item 1'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save amendment' }));

    expect((await screen.findByRole('status')).textContent).toContain('Order amendment saved.');
    expect(api.patch).toHaveBeenCalledWith(
      '/orders/' + orderId,
      { items: [{ productId, variantId, quantity: 3 }] },
      'synthetic-csrf',
    );
  });

  it('recovers from an order detail API failure using the detail retry action', async () => {
    let detailAttempts = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve(locations as never);
      if (path.startsWith('/orders/')) {
        detailAttempts += 1;
        return detailAttempts === 1
          ? Promise.reject(new Error('Order detail service unavailable.'))
          : Promise.resolve(sampleOrder as never);
      }
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={['orders.view']} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Order detail service unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'ORD-555555555555' })).toBeTruthy();
  });

  it('blocks order creation when no accessible locations exist', async () => {
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') return Promise.resolve([] as never);
      if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={permissions} />);
    openCreateForm();

    expect(
      await screen.findByText(/No active fulfilment locations are available to your account/i),
    ).toBeTruthy();
    expect((screen.getByLabelText('Fulfilment location') as HTMLSelectElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Create order' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows a location API error and retries the authenticated lookup', async () => {
    let locationAttempts = 0;
    vi.mocked(api.get).mockImplementation((path) => {
      if (path === '/locations') {
        locationAttempts += 1;
        return locationAttempts === 1
          ? Promise.reject(new Error('Location service unavailable.'))
          : Promise.resolve(locations as never);
      }
      if (path === '/products?status=all') return Promise.resolve([sampleProduct] as never);
      return Promise.reject(new Error('Unexpected API GET ' + path));
    });
    render(<OrderManagementPage permissions={permissions} />);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Location service unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry locations' }));
    await waitFor(() => expect(locationAttempts).toBe(2));
    openCreateForm();
    expect(screen.getByRole('option', { name: 'Sheraton Store (SHERATON)' })).toBeTruthy();
  });

  it('shows API failures and supports retry', async () => {
    vi.mocked(api.getPage)
      .mockRejectedValueOnce(new Error('Order service unavailable.'))
      .mockResolvedValueOnce({ data: [sampleOrder], meta: pageMeta } as never);
    render(<OrderManagementPage permissions={['orders.view']} />);

    expect((await screen.findByRole('alert')).textContent).toContain('Order service unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Synthetic Customer')).toBeTruthy();
  });
});
