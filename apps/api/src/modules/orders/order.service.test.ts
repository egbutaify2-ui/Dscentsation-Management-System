import { describe, expect, it, vi } from 'vitest';
import { OrderService } from './order.service.js';
import { orderConflict } from './order.errors.js';
import type { OrderRepository } from './order.repository.js';
import type {
  AmendOrderInput,
  CreateOrderInput,
  OrderActor,
  OrderAmendmentWriteModel,
  OrderCreateWriteModel,
  OrderItemRequest,
  OrderMutationContext,
  OrderProductSnapshot,
  OrderRecord,
  OrderStatus,
} from './order.types.js';

const actor: OrderActor = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  permissions: ['customers.view', 'products.view'],
};
const customerId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';

const productSnapshot: OrderProductSnapshot = {
  productId,
  productVariantId: variantId,
  productNameSnapshot: 'Synthetic Eau de Parfum',
  variantNameSnapshot: '100 ml',
  skuSnapshot: 'SYN-100',
  unitOfMeasureSnapshot: 'bottle',
  unitPriceMinor: '125000',
};

function createOrderInput(): OrderCreateWriteModel {
  return {
    customerId,
    customerNameSnapshot: 'Synthetic Customer',
    customerPhoneSnapshot: null,
    customerEmailSnapshot: null,
    sourceChannel: 'whatsapp',
    status: 'received',
    fulfilmentLocationId: locationId,
    items: [
      {
        ...productSnapshot,
        quantity: 1,
        discountMinor: '0',
        lineTotalMinor: '125000',
      },
    ],
    currency: 'NGN',
    deliveryAddressSnapshot: null,
    notes: null,
    createdBy: actor.id,
    subtotalMinor: '125000',
    discountMinor: '0',
    deliveryFeeMinor: '0',
    totalMinor: '125000',
  };
}

function createRecord(input: OrderCreateWriteModel, status: OrderStatus = 'received'): OrderRecord {
  return {
    ...input,
    id: '55555555-5555-4555-8555-555555555555',
    status,
    updatedBy: input.createdBy,
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  };
}

function makeRepository(initial?: OrderRecord) {
  let current = initial;
  const repository: OrderRepository = {
    createReceivedOrder: vi.fn(async (input: OrderCreateWriteModel) => {
      current = createRecord(input);
      return current;
    }),
    amendReceivedOrder: vi.fn(
      async (
        _orderId: string,
        _context: OrderMutationContext,
        buildAmendment: (record: OrderRecord) => Promise<OrderAmendmentWriteModel>,
      ) => {
        if (!current) {
          throw new Error('Order not found in test repository.');
        }
        const amendment = await buildAmendment(current);
        current = {
          ...current,
          ...amendment,
          updatedAt: '2026-11-02T00:01:00.000Z',
        };
        return current;
      },
    ),
  };
  return { repository, getCurrent: () => current };
}

function makeService(
  repository: OrderRepository,
  customerStatus: 'active' | 'archived' = 'active',
) {
  const customerLookup = vi.fn(async (_actor: OrderActor, requestedId: string) => {
    if (customerStatus === 'archived') {
      throw orderConflict('Archived customers cannot be selected for a new or amended order.');
    }
    return {
      id: requestedId,
      fullName: 'Synthetic Customer',
      phone: null,
      email: null,
      notes: null,
      status: customerStatus,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    };
  });
  const productSnapshotLookup = vi.fn(
    async (requestingActor: OrderActor, requestedItems: readonly OrderItemRequest[]) => {
      if (!requestingActor.permissions.includes('products.view')) {
        throw new Error('Missing products.view permission in service test fixture.');
      }
      return requestedItems.map((item) => ({
        ...productSnapshot,
        productId: item.productId,
        productVariantId: item.variantId,
      }));
    },
  );

  return {
    service: new OrderService({ repository, customerLookup, productSnapshotLookup }),
    customerLookup,
    productSnapshotLookup,
  };
}

const createInput: CreateOrderInput = {
  customerId,
  sourceChannel: 'whatsapp',
  fulfilmentLocationId: locationId,
  items: [{ productId, variantId, quantity: 2 }],
};

describe('OrderService', () => {
  it(
    'creates a received order using server-resolved product prices and zero fees/discounts',
    async () => {
    const { repository } = makeRepository();
    const { service, customerLookup } = makeService(repository);

    const result = await service.createOrder(actor, 'request-create', createInput);

    expect(customerLookup).toHaveBeenCalledWith(actor, customerId);
    expect(result.status).toBe('received');
    expect(repository.createReceivedOrder).toHaveBeenCalledTimes(1);
    expect(repository.createReceivedOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId,
        status: 'received',
        subtotalMinor: '250000',
        discountMinor: '0',
        deliveryFeeMinor: '0',
        totalMinor: '250000',
        currency: 'NGN',
      }),
      { actorId: actor.id, requestId: 'request-create' },
    );
    expect(result.items[0]).toMatchObject({
      productNameSnapshot: 'Synthetic Eau de Parfum',
      variantNameSnapshot: '100 ml',
      unitPriceMinor: '125000',
      quantity: 2,
      lineTotalMinor: '250000',
      discountMinor: '0',
    });
    },
  );

  it('does not persist an order for an archived customer', async () => {
    const { repository } = makeRepository();
    const { service } = makeService(repository, 'archived');

    await expect(service.createOrder(actor, 'request-create', createInput)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repository.createReceivedOrder).not.toHaveBeenCalled();
  });

  it('re-resolves items from current product data when amending a received order', async () => {
    const { repository, getCurrent } = makeRepository(createRecord(createOrderInput()));
    const { service } = makeService(repository);
    const amendment: AmendOrderInput = {
      items: [{ productId, variantId, quantity: 3 }],
      notes: 'Updated synthetic note',
    };

    const updated = await service.amendOrder(actor, 'request-amend', 'order-id', amendment);

    expect(updated.items[0]?.quantity).toBe(3);
    expect(updated.totalMinor).toBe('375000');
    expect(updated.notes).toBe('Updated synthetic note');
    expect(updated.status).toBe('received');
    expect(getCurrent()?.updatedBy).toBe(actor.id);
  });

  it('rejects amendment after an order leaves received status', async () => {
    const { repository } = makeRepository(createRecord(createOrderInput(), 'confirmed'));
    const { service } = makeService(repository);

    await expect(
      service.amendOrder(actor, 'request-amend', 'order-id', { notes: 'No longer editable' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
