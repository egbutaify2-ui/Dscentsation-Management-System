import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProduct } from '../products/product.service.js';
import { prepareOrderProductSnapshots } from './order.product.adapter.js';

vi.mock('../products/product.service.js', () => ({
  getProduct: vi.fn(),
}));

const productId = '33333333-3333-4333-8333-333333333333';
const variantId = '44444444-4444-4444-8444-444444444444';

const activeProduct = {
  id: productId,
  name: 'Synthetic Eau de Parfum',
  description: null,
  internalCode: 'SYN',
  categoryId: null,
  categoryName: null,
  status: 'active' as const,
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  variants: [
    {
      id: variantId,
      productId,
      name: '100 ml',
      sku: 'SYN-100',
      unitOfMeasure: 'bottle',
      sellingPrice: '1250.50',
      costPrice: '900.00',
      currency: 'NGN',
      isActive: true,
      isDefault: true,
      createdAt: '2026-11-02T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    },
  ],
};

describe('prepareOrderProductSnapshots', () => {
  beforeEach(() => {
    vi.mocked(getProduct).mockReset();
  });

  it('copies the active product/variant identity and server selling price, never cost price', async () => {
    vi.mocked(getProduct).mockResolvedValue(activeProduct);

    const result = await prepareOrderProductSnapshots([
      { productId, variantId, quantity: 2 },
    ]);

    expect(result).toEqual([
      {
        productId,
        productVariantId: variantId,
        productNameSnapshot: 'Synthetic Eau de Parfum',
        variantNameSnapshot: '100 ml',
        skuSnapshot: 'SYN-100',
        unitOfMeasureSnapshot: 'bottle',
        unitPriceMinor: '125050',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('900.00');
  });

  it('loads each product once when multiple variants/items share the same product', async () => {
    vi.mocked(getProduct).mockResolvedValue(activeProduct);

    await prepareOrderProductSnapshots([
      { productId, variantId, quantity: 1 },
      { productId, variantId, quantity: 2 },
    ]);

    expect(getProduct).toHaveBeenCalledTimes(1);
  });

  it('rejects archived products, inactive variants and variants outside the product', async () => {
    vi.mocked(getProduct).mockResolvedValue({ ...activeProduct, status: 'archived' });
    await expect(
      prepareOrderProductSnapshots([{ productId, variantId, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    vi.mocked(getProduct).mockResolvedValue({
      ...activeProduct,
      variants: [{ ...activeProduct.variants[0]!, isActive: false }],
    });
    await expect(
      prepareOrderProductSnapshots([{ productId, variantId, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    vi.mocked(getProduct).mockResolvedValue({ ...activeProduct, variants: [] });
    await expect(
      prepareOrderProductSnapshots([{ productId, variantId, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects non-NGN product variants', async () => {
    vi.mocked(getProduct).mockResolvedValue({
      ...activeProduct,
      variants: [{ ...activeProduct.variants[0]!, currency: 'USD' }],
    });
    await expect(
      prepareOrderProductSnapshots([{ productId, variantId, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
