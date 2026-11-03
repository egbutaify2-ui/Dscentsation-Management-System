import { loadActiveOrderCustomer } from './order.customer.adapter.js';
import { orderConflict } from './order.errors.js';
import {
  calculateLineTotalMinor,
  calculateOrderTotals,
  ORDER_CURRENCY,
  ZERO_MINOR_UNITS,
} from './order.money.js';
import { prepareOrderProductSnapshots } from './order.product.adapter.js';
import type { OrderRepository } from './order.repository.js';
import type {
  AmendOrderInput,
  CreateOrderInput,
  OrderActor,
  OrderItemRequest,
  OrderItemSnapshot,
  OrderMutationContext,
  OrderProductSnapshot,
  OrderRecord,
} from './order.types.js';
import type { CustomerRecord } from '../customers/customer.service.js';

export type OrderCustomerLookup = (
  actor: OrderActor,
  customerId: string,
) => Promise<CustomerRecord>;

export type OrderProductSnapshotLookup = (
  items: readonly OrderItemRequest[],
) => Promise<OrderProductSnapshot[]>;

export interface OrderServiceDependencies {
  repository: OrderRepository;
  customerLookup?: OrderCustomerLookup;
  productSnapshotLookup?: OrderProductSnapshotLookup;
}

export class OrderService {
  private readonly repository: OrderRepository;
  private readonly customerLookup: OrderCustomerLookup;
  private readonly productSnapshotLookup: OrderProductSnapshotLookup;

  constructor(dependencies: OrderServiceDependencies) {
    this.repository = dependencies.repository;
    this.customerLookup = dependencies.customerLookup ?? loadActiveOrderCustomer;
    this.productSnapshotLookup =
      dependencies.productSnapshotLookup ?? prepareOrderProductSnapshots;
  }

  async createOrder(
    actor: OrderActor,
    requestId: string,
    input: CreateOrderInput,
  ): Promise<OrderRecord> {
    await this.customerLookup(actor, input.customerId);
    const items = await this.buildItems(input.items);
    const totals = calculateOrderTotals(items);
    const context: OrderMutationContext = { actorId: actor.id, requestId };

    return this.repository.createReceivedOrder(
      {
        customerId: input.customerId,
        sourceChannel: input.sourceChannel,
        status: 'received',
        fulfilmentLocationId: input.fulfilmentLocationId,
        items,
        currency: ORDER_CURRENCY,
        deliveryAddressSnapshot: input.deliveryAddress ?? null,
        notes: input.notes ?? null,
        createdBy: actor.id,
        ...totals,
      },
      context,
    );
  }

  async amendOrder(
    actor: OrderActor,
    requestId: string,
    orderId: string,
    input: AmendOrderInput,
  ): Promise<OrderRecord> {
    const context: OrderMutationContext = { actorId: actor.id, requestId };

    return this.repository.amendReceivedOrder(orderId, context, async (current) => {
      if (current.status !== 'received') {
        throw orderConflict('Only orders in the received state can be amended.');
      }

      const customerId = input.customerId ?? current.customerId;
      if (input.customerId !== undefined && input.customerId !== current.customerId) {
        await this.customerLookup(actor, customerId);
      }

      const items = input.items === undefined ? current.items : await this.buildItems(input.items);
      const totals = calculateOrderTotals(items);

      return {
        customerId,
        sourceChannel: input.sourceChannel ?? current.sourceChannel,
        fulfilmentLocationId: input.fulfilmentLocationId ?? current.fulfilmentLocationId,
        items,
        currency: ORDER_CURRENCY,
        deliveryAddressSnapshot:
          input.deliveryAddress === undefined
            ? current.deliveryAddressSnapshot
            : input.deliveryAddress,
        notes: input.notes === undefined ? current.notes : input.notes,
        updatedBy: actor.id,
        ...totals,
      };
    });
  }

  private async buildItems(requestedItems: readonly OrderItemRequest[]): Promise<OrderItemSnapshot[]> {
    if (requestedItems.length === 0) {
      throw orderConflict('An order must contain at least one item.');
    }

    const snapshots = await this.productSnapshotLookup(requestedItems);
    if (snapshots.length !== requestedItems.length) {
      throw new Error('The product snapshot resolver returned an inconsistent number of items.');
    }

    return requestedItems.map((requestedItem, index) => {
      const snapshot = snapshots[index];
      if (
        !snapshot ||
        snapshot.productId !== requestedItem.productId ||
        snapshot.productVariantId !== requestedItem.variantId
      ) {
        throw new Error('The product snapshot resolver returned snapshots in an unexpected order.');
      }

      const lineTotalMinor = calculateLineTotalMinor(
        snapshot.unitPriceMinor,
        requestedItem.quantity,
      );

      return {
        ...snapshot,
        quantity: requestedItem.quantity,
        discountMinor: ZERO_MINOR_UNITS,
        lineTotalMinor,
      };
    });
  }
}
