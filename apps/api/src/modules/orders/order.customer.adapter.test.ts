import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCustomer } from '../customers/customer.service.js';
import { loadActiveOrderCustomer } from './order.customer.adapter.js';

vi.mock('../customers/customer.service.js', () => ({
  getCustomer: vi.fn(),
}));

const actor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  permissions: ['customers.view'],
};
const customerId = '11111111-1111-4111-8111-111111111111';

const activeCustomer = {
  id: customerId,
  fullName: 'Synthetic Customer',
  phone: null,
  email: null,
  notes: null,
  status: 'active' as const,
  createdBy: actor.id,
  updatedBy: actor.id,
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
};

describe('loadActiveOrderCustomer', () => {
  beforeEach(() => {
    vi.mocked(getCustomer).mockReset();
  });

  it('uses the merged getCustomer(actor, customerId) contract', async () => {
    vi.mocked(getCustomer).mockResolvedValue(activeCustomer);

    await expect(loadActiveOrderCustomer(actor, customerId)).resolves.toEqual(activeCustomer);
    expect(getCustomer).toHaveBeenCalledWith(actor, customerId);
  });

  it('rejects archived customer profiles without bypassing customer service', async () => {
    vi.mocked(getCustomer).mockResolvedValue({
      ...activeCustomer,
      status: 'archived',
    });

    await expect(loadActiveOrderCustomer(actor, customerId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(getCustomer).toHaveBeenCalledTimes(1);
  });

  it('preserves permission errors raised by the customer service', async () => {
    vi.mocked(getCustomer).mockRejectedValue(new Error('Forbidden'));

    await expect(loadActiveOrderCustomer(actor, customerId)).rejects.toThrow('Forbidden');
  });
});
