import { getProduct } from '../products/product.service.js';
import { invalidOrder, orderConflict, orderForbidden } from './order.errors.js';
import { toNgnMinorUnits } from './order.money.js';
import type { OrderActor, OrderItemRequest, OrderProductSnapshot } from './order.types.js';

export async function prepareOrderProductSnapshots(
  actor: OrderActor,
  requestedItems: readonly OrderItemRequest[],
): Promise<OrderProductSnapshot[]> {
  // Product routes are protected by products.view; getProduct itself is an
  // unguarded data service, so the adapter must preserve that permission gate.
  if (!actor.permissions.includes('products.view')) {
    throw orderForbidden();
  }

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

      const variant = product.variants.find(
        (candidate) => candidate.id === requestedItem.variantId,
      );
      if (!variant) {
        throw invalidOrder(
          'The selected product variant does not belong to the selected product.',
        );
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
