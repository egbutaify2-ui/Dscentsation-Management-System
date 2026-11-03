import { getProduct } from '../products/product.service.js';
import { invalidOrder, orderConflict } from './order.errors.js';
import { toNgnMinorUnits } from './order.money.js';
import type { OrderItemRequest, OrderProductSnapshot } from './order.types.js';

export async function prepareOrderProductSnapshots(
  requestedItems: readonly OrderItemRequest[],
): Promise<OrderProductSnapshot[]> {
  const products = new Map<string, ReturnType<typeof getProduct>>();

  return Promise.all(
    requestedItems.map(async (requestedItem) => {
      let productRequest = products.get(requestedItem.productId);
      if (!productRequest) {
        productRequest = getProduct(requestedItem.productId);
        products.set(requestedItem.productId, productRequest);
      }

      const product = await productRequest;
      if (product.status !== 'active') {
        throw orderConflict('Archived products cannot be added to an order.');
      }

      const variant = product.variants.find((candidate) => candidate.id === requestedItem.variantId);
      if (!variant) {
        throw invalidOrder('The selected product variant does not belong to the selected product.');
      }
      if (!variant.isActive) {
        throw orderConflict('Inactive product variants cannot be added to an order.');
      }
      if (variant.currency !== 'NGN') {
        throw invalidOrder('Only NGN product variants can be captured in an order.');
      }

      return {
        productId: product.id,
        productVariantId: variant.id,
        productNameSnapshot: product.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku,
        unitOfMeasureSnapshot: variant.unitOfMeasure,
        unitPriceMinor: toNgnMinorUnits(variant.sellingPrice),
      };
    }),
  );
}
