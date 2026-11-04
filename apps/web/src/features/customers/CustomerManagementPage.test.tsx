// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client.js';
import { CustomerManagementPage } from './CustomerManagementPage.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getPage: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  getCsrfToken: vi.fn(),
}));

vi.mock('../../lib/api/client.js', () => ({
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string | undefined;
    readonly requestId: string | undefined;
    constructor(
      status: number,
      body: { error?: { code?: string; message?: string; requestId?: string } },
    ) {
      super(body.error?.message ?? 'The request could not be completed.');
      this.status = status;
      this.code = body.error?.code;
      this.requestId = body.error?.requestId;
    }
  },
  api: {
    get: mocks.get,
    getPage: mocks.getPage,
    post: mocks.post,
    patch: mocks.patch,
  },
  getCsrfToken: mocks.getCsrfToken,
}));

const customerId = '11111111-1111-4111-8111-111111111111';
const sampleCustomer = {
  id: customerId,
  fullName: 'Synthetic Customer',
  phone: '+234 800 123 4567',
  email: 'customer@example.invalid',
  notes: 'Synthetic customer note',
  status: 'active' as const,
  createdBy: '22222222-2222-4222-8222-222222222222',
  updatedBy: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T10:30:00.000Z',
};
const archivedCustomer = { ...sampleCustomer, status: 'archived' as const };
interface OrderHistoryFixture {
  id: string;
  createdAt: string;
  sourceChannel: 'whatsapp' | 'instagram' | 'website' | 'phone';
  status: string;
  items: {
    productNameSnapshot: string;
    variantNameSnapshot: string;
    quantity: number;
  }[];
}
const secondCustomer = {
  ...sampleCustomer,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  fullName: 'Second Synthetic Customer',
};
const sampleOrder: OrderHistoryFixture = {
  id: 'abcdef01-1111-4111-8111-111111111111',
  createdAt: '2026-10-11T09:15:00.000Z',
  sourceChannel: 'instagram',
  status: 'delivered',
  items: [
    {
      productNameSnapshot: 'Synthetic Fragrance',
      variantNameSnapshot: '50ml',
      quantity: 2,
    },
  ],
};
const secondCustomerOrder: OrderHistoryFixture = {
  ...sampleOrder,
  id: 'bbbbbbbb-2222-4222-8222-222222222222',
  items: [
    {
      productNameSnapshot: 'Second Customer Product',
      variantNameSnapshot: '100ml',
      quantity: 1,
    },
  ],
};
const pageMeta = { page: 1, pageSize: 25, total: 1, totalPages: 1 };
const orderHistoryMeta = { page: 1, pageSize: 10, total: 1, totalPages: 1 };
const viewPermissions = ['customers.view'];
const fullPermissions = [
  'customers.view',
  'customers.create',
  'customers.update',
  'customers.archive',
];

afterEach(() => cleanup());

describe('CustomerManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCsrfToken.mockResolvedValue('synthetic-csrf');
    mocks.getPage.mockResolvedValue({ data: [sampleCustomer], meta: pageMeta });
    mocks.get.mockResolvedValue(sampleCustomer);
    mocks.post.mockResolvedValue(sampleCustomer);
    mocks.patch.mockResolvedValue({ ...sampleCustomer, fullName: 'Updated Customer' });
  });

  it('loads the customer register with server-provided pagination metadata', async () => {
    render(<CustomerManagementPage permissions={fullPermissions} />);
    expect(screen.getByRole('status').textContent).toContain('Loading customers');
    expect(await screen.findByRole('heading', { name: 'Customer register' })).toBeTruthy();
    expect(screen.getByText('Synthetic Customer')).toBeTruthy();
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(mocks.getPage).toHaveBeenCalledWith('/customers?status=active&page=1&pageSize=25');
  });

  it('searches by name, phone and email through the same server query parameter', async () => {
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');

    for (const term of ['Ada Customer', '+2348001234567', 'ada@example.invalid']) {
      fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: term } });
      fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      await waitFor(() =>
        expect(mocks.getPage).toHaveBeenLastCalledWith(
          '/customers?q=' +
            encodeURIComponent(term).replace(/%20/g, '+') +
            '&status=active&page=1&pageSize=25',
        ),
      );
    }
  });

  it('filters active, archived and all customer records', async () => {
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'archived' } });
    await waitFor(() =>
      expect(mocks.getPage).toHaveBeenLastCalledWith(
        '/customers?status=archived&page=1&pageSize=25',
      ),
    );

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    await waitFor(() =>
      expect(mocks.getPage).toHaveBeenLastCalledWith('/customers?status=all&page=1&pageSize=25'),
    );

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    await waitFor(() =>
      expect(mocks.getPage).toHaveBeenLastCalledWith('/customers?status=active&page=1&pageSize=25'),
    );
  });

  it('uses server pagination when moving to the next page', async () => {
    mocks.getPage.mockResolvedValue({
      data: [sampleCustomer],
      meta: { page: 1, pageSize: 25, total: 30, totalPages: 2 },
    });
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mocks.getPage).toHaveBeenLastCalledWith('/customers?status=active&page=2&pageSize=25'),
    );
  });

  it('creates a customer using only writable fields and server-returned values', async () => {
    render(<CustomerManagementPage permissions={fullPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  New Customer  ' } });
    fireEvent.change(screen.getByLabelText('Phone'), {
      target: { value: '  +234 801 000 0000  ' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new.customer@example.invalid' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '  First note  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create customer' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/customers',
        {
          fullName: 'New Customer',
          phone: '+234 801 000 0000',
          email: 'new.customer@example.invalid',
          notes: 'First note',
        },
        'synthetic-csrf',
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Synthetic Customer' })).toBeTruthy();
    expect(screen.getByText('Customer created.')).toBeTruthy();
  });

  it('views customer details and formats created and updated timestamps in Africa/Lagos', async () => {
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByRole('heading', { name: 'Synthetic Customer' })).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('/customers/' + customerId);
    expect(screen.getByText('+234 800 123 4567')).toBeTruthy();
    expect(screen.getByText('customer@example.invalid')).toBeTruthy();
    expect(screen.getByText('Synthetic customer note')).toBeTruthy();
    expect(
      screen.getByText(
        new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Africa/Lagos',
        }).format(new Date(sampleCustomer.createdAt)),
      ),
    ).toBeTruthy();
  });

  it('updates a customer profile without sending status or server-managed fields', async () => {
    render(<CustomerManagementPage permissions={fullPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: 'Synthetic Customer' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit customer' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Updated Customer' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        '/customers/' + customerId,
        {
          fullName: 'Updated Customer',
          phone: null,
          email: 'customer@example.invalid',
          notes: 'Synthetic customer note',
        },
        'synthetic-csrf',
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Updated Customer' })).toBeTruthy();
    expect(screen.getByText('Customer details updated.')).toBeTruthy();
  });

  it('requires explicit confirmation before archiving and displays server status', async () => {
    mocks.post.mockResolvedValue(archivedCustomer);
    render(<CustomerManagementPage permissions={fullPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: 'Synthetic Customer' });
    fireEvent.click(screen.getByRole('button', { name: 'Archive customer' }));

    expect(screen.getByRole('dialog', { name: 'Archive customer?' })).toBeTruthy();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/customers/' + customerId + '/archive',
        {},
        'synthetic-csrf',
      ),
    );
    expect(screen.getAllByText('archived')).toHaveLength(2);
    expect(screen.getByText('Customer archived. The record has been retained.')).toBeTruthy();
  });

  it('displays the API validation message and keeps the form open after a rejected create', async () => {
    mocks.post.mockRejectedValueOnce(
      new ApiError(400, {
        error: { code: 'INVALID_REQUEST', message: 'Review the supplied fields and try again.' },
      }),
    );
    render(<CustomerManagementPage permissions={fullPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Valid Name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create customer' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Review the supplied fields and try again.',
    );
    expect(screen.getByRole('dialog', { name: 'Add a customer' })).toBeTruthy();
  });

  it('hides create, edit and archive actions unless their exact permissions are present', async () => {
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');
    expect(screen.queryByRole('button', { name: 'Add customer' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: 'Synthetic Customer' });
    expect(screen.queryByRole('button', { name: 'Edit customer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive customer' })).toBeNull();
  });

  it('shows an empty state when no customers match the active filter', async () => {
    mocks.getPage.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    });
    render(<CustomerManagementPage permissions={fullPermissions} />);
    expect(await screen.findByText('No customers found')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add the first customer' })).toBeTruthy();
  });

  it('shows a safe loading error and retries the customer list', async () => {
    mocks.getPage
      .mockRejectedValueOnce(new Error('synthetic transport detail must not appear'))
      .mockResolvedValueOnce({ data: [sampleCustomer], meta: pageMeta });
    render(<CustomerManagementPage permissions={viewPermissions} />);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The customer request could not be completed. Please try again.',
    );
    expect(screen.queryByText('synthetic transport detail must not appear')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Synthetic Customer')).toBeTruthy();
  });

  it('shows and retries a customer detail loading error', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('synthetic transport detail'))
      .mockResolvedValueOnce(sampleCustomer);
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The customer request could not be completed. Please try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Synthetic Customer' })).toBeTruthy();
  });

  it('shows purchase history using the existing customerId-filtered orders API', async () => {
    mocks.getPage.mockImplementation(async (path: string) => {
      if (path.startsWith('/orders?')) {
        return { data: [sampleOrder], meta: orderHistoryMeta };
      }
      return { data: [sampleCustomer], meta: pageMeta };
    });
    render(<CustomerManagementPage permissions={[...viewPermissions, 'orders.view']} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('Order #ABCDEF01')).toBeTruthy();
    const orderDate = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    }).format(new Date(sampleOrder.createdAt));
    expect(screen.getByText(orderDate)).toBeTruthy();
    expect(screen.getByText('Synthetic Fragrance · 50ml')).toBeTruthy();
    expect(screen.getByText('× 2')).toBeTruthy();
    expect(screen.getByText('instagram')).toBeTruthy();
    expect(screen.getByText('delivered')).toBeTruthy();
    expect(mocks.getPage).toHaveBeenCalledWith(
      '/orders?customerId=' + customerId + '&page=1&pageSize=10',
    );
    expect(screen.queryByText(/₦|payment|revenue|totalMinor/i)).toBeNull();
  });

  it('does not request order history when orders.view is absent', async () => {
    render(<CustomerManagementPage permissions={viewPermissions} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    await screen.findByRole('heading', { name: 'Synthetic Customer' });

    expect(screen.getByText('Purchase history is not available to your account.')).toBeTruthy();
    expect(mocks.getPage.mock.calls.some(([path]) => String(path).startsWith('/orders?'))).toBe(
      false,
    );
  });

  it('shows an empty purchase history when the authorised order page is empty', async () => {
    mocks.getPage.mockImplementation(async (path: string) => {
      if (path.startsWith('/orders?')) {
        return {
          data: [],
          meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
        };
      }
      return { data: [sampleCustomer], meta: pageMeta };
    });
    render(<CustomerManagementPage permissions={[...viewPermissions, 'orders.view']} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('No purchase history')).toBeTruthy();
    expect(screen.getByText('No orders are currently visible for this customer.')).toBeTruthy();
  });

  it('shows a purchase-history error and retries the same customer page', async () => {
    mocks.getPage.mockImplementation(async (path: string) => {
      if (path.startsWith('/orders?')) {
        const orderRequestCount = mocks.getPage.mock.calls.filter(([value]) =>
          String(value).startsWith('/orders?'),
        ).length;
        if (orderRequestCount === 1) {
          throw new Error('synthetic order database detail');
        }
        return { data: [sampleOrder], meta: orderHistoryMeta };
      }
      return { data: [sampleCustomer], meta: pageMeta };
    });
    render(<CustomerManagementPage permissions={[...viewPermissions, 'orders.view']} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The customer request could not be completed. Please try again.',
    );
    expect(screen.queryByText('synthetic order database detail')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Order #ABCDEF01')).toBeTruthy();
  });

  it('uses server-returned purchase-history pagination metadata', async () => {
    mocks.getPage.mockImplementation(async (path: string) => {
      if (path.startsWith('/orders?')) {
        const page = new URLSearchParams(path.split('?')[1]).get('page');
        return {
          data: [
            {
              ...sampleOrder,
              id: page === '2' ? '22222222-2222-4222-8222-222222222222' : sampleOrder.id,
            },
          ],
          meta: { page: Number(page), pageSize: 10, total: 21, totalPages: 3 },
        };
      }
      return { data: [sampleCustomer], meta: pageMeta };
    });
    render(<CustomerManagementPage permissions={[...viewPermissions, 'orders.view']} />);
    await screen.findByText('Synthetic Customer');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText('Order #ABCDEF01')).toBeTruthy();
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Order #22222222')).toBeTruthy();
    expect(mocks.getPage).toHaveBeenLastCalledWith(
      '/orders?customerId=' + customerId + '&page=2&pageSize=10',
    );
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  });

  it('clears previous customer history and ignores a stale response after switching profiles', async () => {
    let resolveFirstHistory!: (value: {
      data: OrderHistoryFixture[];
      meta: typeof orderHistoryMeta;
    }) => void;
    const firstHistoryPending = new Promise<{
      data: OrderHistoryFixture[];
      meta: typeof orderHistoryMeta;
    }>((resolve) => {
      resolveFirstHistory = resolve;
    });
    mocks.getPage.mockImplementation((path: string) => {
      if (path.startsWith('/orders?')) {
        const requestedCustomerId = new URLSearchParams(path.split('?')[1]).get('customerId');
        return requestedCustomerId === customerId
          ? firstHistoryPending
          : Promise.resolve({ data: [secondCustomerOrder], meta: orderHistoryMeta });
      }
      return Promise.resolve({
        data: [sampleCustomer, secondCustomer],
        meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      });
    });
    mocks.get.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith(secondCustomer.id) ? secondCustomer : sampleCustomer),
    );

    render(<CustomerManagementPage permissions={[...viewPermissions, 'orders.view']} />);
    await screen.findByText('Second Synthetic Customer');
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!);
    await screen.findByRole('heading', { name: 'Synthetic Customer' });
    expect(screen.getByText('Loading purchase history…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '← Back to customers' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1]!);
    await screen.findByRole('heading', { name: 'Second Synthetic Customer' });
    expect(await screen.findByText('Second Customer Product · 100ml')).toBeTruthy();
    expect(screen.queryByText('Synthetic Fragrance · 50ml')).toBeNull();

    resolveFirstHistory({ data: [sampleOrder], meta: orderHistoryMeta });
    await waitFor(() => {
      expect(screen.getByText('Second Customer Product · 100ml')).toBeTruthy();
      expect(screen.queryByText('Synthetic Fragrance · 50ml')).toBeNull();
    });
  });
});