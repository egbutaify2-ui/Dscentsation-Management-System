import { describe, expect, it } from 'vitest';
import { amendOrderSchema, createOrderSchema } from './order.validation.js';

const customerId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';

describe('order request validation', () => {
  it('accepts a valid order capture request', () => {
    const parsed = createOrderSchema.safeParse({
      customerId,
      sourceChannel: 'whatsapp',
      fulfilmentLocationId: locationId,
      items: [{ productId, variantId, quantity: 2 }],
      deliveryAddress: '12 Example Road',
      notes: 'Call on arrival',
    });
    expect(parsed.success).toBe(true);
  });

  it('requires a customer, fulfilment location and at least one item', () => {
    expect(createOrderSchema.safeParse({ sourceChannel: 'website', items: [] }).success).toBe(false);
    expect(
      createOrderSchema.safeParse({
        customerId,
        sourceChannel: 'website',
        fulfilmentLocationId: locationId,
        items: [],
      }).success,
    ).toBe(false);
  });

  it('accepts only positive whole-number quantities', () => {
    const base = {
      customerId,
      sourceChannel: 'instagram',
      fulfilmentLocationId: locationId,
    };
    expect(
      createOrderSchema.safeParse({
        ...base,
        items: [{ productId, variantId, quantity: 2 }],
      }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({
        ...base,
        items: [{ productId, variantId, quantity: 2.5 }],
      }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({
        ...base,
        items: [{ productId, variantId, quantity: 0 }],
      }).success,
    ).toBe(false);
  });

  it('rejects client-supplied prices, discounts, delivery fees and totals', () => {
    const parsed = createOrderSchema.safeParse({
      customerId,
      sourceChannel: 'website',
      fulfilmentLocationId: locationId,
      items: [{ productId, variantId, quantity: 1, unitPrice: '1.00' }],
      discountMinor: '100',
      deliveryFeeMinor: '100',
      totalMinor: '1',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires an amendment to contain at least one supported change', () => {
    expect(amendOrderSchema.safeParse({}).success).toBe(false);
    expect(amendOrderSchema.safeParse({ notes: 'Updated delivery note' }).success).toBe(true);
  });

  it('rejects order status and unknown fields in amendment requests', () => {
    expect(amendOrderSchema.safeParse({ status: 'confirmed' }).success).toBe(false);
    expect(amendOrderSchema.safeParse({ unitPrice: '10.00' }).success).toBe(false);
  });
});
