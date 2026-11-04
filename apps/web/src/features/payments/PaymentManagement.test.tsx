// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPaymentManagement, parseNairaToKobo } from './PaymentManagement.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
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
  },
  getCsrfToken: mocks.getCsrfToken,
}));

const orderId = '11111111-1111-4111-8111-111111111111';
const pendingPaymentId = '22222222-2222-4222-8222-222222222222';
const verifiedPaymentId = '33333333-3333-4333-8333-333333333333';

const pendingPayment = {
  id: pendingPaymentId,
  orderId,
  amountMinor: '25000',
  currency: 'NGN' as const,
  method: 'Cash / manual label',
  reference: 'PAY-REF-001',
  status: 'pending' as const,
  recordedBy: '44444444-4444-4444-8444-444444444444',
  occurredAt: '2026-11-04T09:00:00.000Z',
  createdAt: '2026-11-04T09:00:00.000Z',
  verifiedBy: null,
  verifiedAt: null,
  history: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      eventType: 'recorded' as const,
      amountMinor: '25000',
      reason: null,
      actorUserId: '44444444-4444-4444-8444-444444444444',
      occurredAt: '2026-11-04T09:00:00.000Z',
    },
  ],
};

const verifiedPayment = {
  ...pendingPayment,
  id: verifiedPaymentId,
  amountMinor: '200000',
  method: 'Bank transfer',
  reference: 'BANK-REF-002',
  status: 'verified' as const,
  verifiedBy: '66666666-6666-4666-8666-666666666666',
  verifiedAt: '2026-11-04T10:00:00.000Z',
  history: [
    ...pendingPayment.history,
    {
      id: '77777777-7777-4777-8777-777777777777',
      eventType: 'verified' as const,
      amountMinor: '200000',
      reason: null,
      actorUserId: '66666666-6666-4666-8666-666666666666',
      occurredAt: '2026-11-04T10:00:00.000Z',
    },
  ],
};

const paymentSummary = {
  orderId,
  currency: 'NGN' as const,
  orderTotalMinor: '500000',
  verifiedPaidMinor: '200000',
  pendingPaymentMinor: '25000',
  outstandingMinor: '300000',
  paymentCount: 2,
  pendingCount: 1,
  verifiedCount: 1,
  paymentStatus: 'partially_paid' as const,
};

const paymentPage = {
  items: [pendingPayment, verifiedPayment],
  page: 1,
  pageSize: 100,
  total: 2,
  totalPages: 1,
};

const recentPayments = Array.from({ length: 100 }, (_, index) => ({
  ...pendingPayment,
  id: 'recent-payment-' + String(index + 1),
  method: 'Recent payment ' + String(index + 1),
  reference: null,
}));

const olderPayment = {
  ...pendingPayment,
  id: 'older-payment-101',
  amountMinor: '7600',
  method: 'Older payment 101',
  reference: 'OLDER-REF-101',
};

const paginationSummary = { ...paymentSummary, paymentCount: 101 };

const managerPermissions = ['payments.record', 'payments.verify'];
const staffPermissions = ['payments.record'];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrderPaymentManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('payment-idempotency-key-0001'),
    });
    mocks.getCsrfToken.mockResolvedValue('synthetic-csrf');
    mocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/payments/summary')) return paymentSummary;
      if (path.includes('/payments?page=')) return paymentPage;
      if (path === '/payments/' + pendingPaymentId) return pendingPayment;
      if (path === '/payments/' + verifiedPaymentId) return verifiedPayment;
      throw new Error('Unexpected payment GET: ' + path);
    });
    mocks.post.mockImplementation(async (path: string) =>
      path.endsWith('/verify') ? verifiedPayment : pendingPayment,
    );
  });

  it('records for Staff without requesting restricted history', async () => {
    render(<OrderPaymentManagement orderId={orderId} permissions={staffPermissions} />);
    expect(screen.getByText(/Payment history and order summaries are restricted/)).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), {
      target: { value: '250.00' },
    });
    fireEvent.change(screen.getByLabelText('Payment method (optional)'), {
      target: { value: 'Cash / manual label' },
    });
    fireEvent.change(screen.getByLabelText('Reference (optional)'), {
      target: { value: 'PAY-REF-001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));

    expect(await screen.findByText('₦250.00')).toBeTruthy();
    expect(screen.getByText('Pending verification')).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('sends exact kobo and idempotency plus CSRF headers', async () => {
    render(<OrderPaymentManagement orderId={orderId} permissions={staffPermissions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), {
      target: { value: '1,234.56' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/orders/' + orderId + '/payments',
        { amountMinor: '123456', currency: 'NGN' },
        'synthetic-csrf',
        { 'Idempotency-Key': 'payment-idempotency-key-0001' },
      ),
    );
  });

  it('converts naira to kobo without floating-point arithmetic and rejects invalid values', () => {
    expect(parseNairaToKobo('0.01')).toBe('1');
    expect(parseNairaToKobo('1,234.56')).toBe('123456');
    expect(parseNairaToKobo('12500')).toBe('1250000');
    expect(() => parseNairaToKobo('1.999')).toThrow(/two decimal places/);
    expect(() => parseNairaToKobo('0')).toThrow(/greater than zero/);
    expect(() => parseNairaToKobo('9,9.00')).toThrow(/valid NGN amount/);
    expect(() => parseNairaToKobo('92233720368547758.08')).toThrow(/supported NGN range/);
  });

  it.each([
    ['Manager', managerPermissions],
    ['Owner', managerPermissions],
  ])('allows %s to view history and verify a pending payment', async (_role, permissions) => {
    render(<OrderPaymentManagement orderId={orderId} permissions={permissions} />);
    expect(await screen.findByRole('heading', { name: 'Payment history' })).toBeTruthy();
    const pendingGroup = screen.getByRole('region', { name: 'Pending payments' });
    fireEvent.click(within(pendingGroup).getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/payments/' + pendingPaymentId + '/verify',
        {},
        'synthetic-csrf',
      ),
    );
  });

  it('does not expose verification controls without payments.verify', async () => {
    render(<OrderPaymentManagement orderId={orderId} permissions={['payments.record']} />);
    expect(screen.queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Payment history' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Order summary' })).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('keeps statuses separate and renders server summary amounts', async () => {
    render(<OrderPaymentManagement orderId={orderId} permissions={managerPermissions} />);
    const summaryRegion = screen.getByRole('region', { name: 'Order payment summary' });
    expect(within(summaryRegion).getByText('₦5,000.00')).toBeTruthy();
    expect(within(summaryRegion).getByText('₦2,000.00')).toBeTruthy();
    expect(within(summaryRegion).getByText('₦250.00')).toBeTruthy();
    expect(within(summaryRegion).getByText('₦3,000.00')).toBeTruthy();

    const pendingGroup = screen.getByRole('region', { name: 'Pending payments' });
    const verifiedGroup = screen.getByRole('region', { name: 'Verified payments' });
    expect(within(pendingGroup).getByText('₦250.00')).toBeTruthy();
    expect(within(verifiedGroup).getByText('₦2,000.00')).toBeTruthy();
    expect(within(pendingGroup).getByText('Pending')).toBeTruthy();
    expect(within(verifiedGroup).getByText('Verified')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('/orders/' + orderId + '/payments/summary');
    expect(mocks.get).toHaveBeenCalledWith('/orders/' + orderId + '/payments?page=1&pageSize=100');
  });

  it('loads older records and navigates payment history pages', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/payments/summary')) return paginationSummary;
      if (path.endsWith('page=1&pageSize=100')) {
        return {
          items: recentPayments,
          page: 1,
          pageSize: 100,
          total: 101,
          totalPages: 2,
        };
      }
      if (path.endsWith('page=2&pageSize=100')) {
        return {
          items: [olderPayment],
          page: 2,
          pageSize: 100,
          total: 101,
          totalPages: 2,
        };
      }
      throw new Error('Unexpected payment GET: ' + path);
    });

    render(<OrderPaymentManagement orderId={orderId} permissions={managerPermissions} />);

    expect(await screen.findByText('Recent payment 100')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Payment history pages' })).toBeTruthy();
    expect(screen.getByText('Showing 1–100 of 101 payments · Page 1 of 2')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Older payment 101')).toBeTruthy();
    expect(screen.queryByText('Recent payment 100')).toBeNull();
    expect(screen.getByText('Showing 101–101 of 101 payments · Page 2 of 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(mocks.get).toHaveBeenCalledWith('/orders/' + orderId + '/payments?page=2&pageSize=100');

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Recent payment 100')).toBeTruthy();
    expect(screen.getByText('Showing 1–100 of 101 payments · Page 1 of 2')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('/orders/' + orderId + '/payments?page=1&pageSize=100');
  });

  it('formats UTC payment timestamps in Africa/Lagos time', async () => {
    render(<OrderPaymentManagement orderId={orderId} permissions={managerPermissions} />);
    const pendingGroup = await screen.findByRole('region', { name: 'Pending payments' });
    expect(pendingGroup.textContent).toContain('4 Nov 2026, 10:00');
  });

  it('loads authorised payment details and displays the immutable event history', async () => {
    render(<OrderPaymentManagement orderId={orderId} permissions={managerPermissions} />);
    const pendingGroup = await screen.findByRole('region', { name: 'Pending payments' });
    fireEvent.click(within(pendingGroup).getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Payment activity')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith('/payments/' + pendingPaymentId);
    expect(screen.getByText('Recorded')).toBeTruthy();
  });

  it('shows loading, an empty state, and a retry path after a history error', async () => {
    let resolveSummary: ((value: typeof paymentSummary) => void) | undefined;
    let resolvePage: ((value: typeof paymentPage) => void) | undefined;
    mocks.get.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path.endsWith('/payments/summary')) {
            resolveSummary = resolve as (value: typeof paymentSummary) => void;
          } else {
            resolvePage = resolve as (value: typeof paymentPage) => void;
          }
        }),
    );
    render(<OrderPaymentManagement orderId={orderId} permissions={managerPermissions} />);
    expect(screen.getByText('Loading payment history…')).toBeTruthy();
    resolveSummary?.(paymentSummary);
    resolvePage?.({ ...paymentPage, items: [], total: 0, totalPages: 0 });
    expect(await screen.findByText('No payments have been recorded yet.')).toBeTruthy();

    mocks.get.mockRejectedValueOnce(new Error('Payment service unavailable.'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Payment service unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No payments have been recorded yet.')).toBeTruthy();
  });

  it('blocks duplicate submit events while a payment request is in flight', async () => {
    let resolvePost: ((value: typeof pendingPayment) => void) | undefined;
    mocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve as (value: typeof pendingPayment) => void;
        }),
    );
    render(<OrderPaymentManagement orderId={orderId} permissions={staffPermissions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), {
      target: { value: '250.00' },
    });
    const form = screen.getByRole('button', { name: 'Save payment' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    fireEvent.submit(form as HTMLFormElement);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    resolvePost?.(pendingPayment);
    expect(await screen.findByText('Pending verification')).toBeTruthy();
  });
});
