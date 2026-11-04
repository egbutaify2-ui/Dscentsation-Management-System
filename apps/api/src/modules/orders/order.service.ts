import { loadActiveOrderCustomer } from './order.customer.adapter.js';
import { canAccessStockLocation } from '../roles/location-access.service.js';
import { orderConflict, orderLocationForbidden } from './order.errors.js';
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
  actor: OrderActor,
  items: readonly OrderItemRequest[],
) => Promise<OrderProductSnapshot[]>;

export type OrderLocationAccess = (actor: OrderActor, locationId: string) => Promise<boolean>;

export interface OrderServiceDependencies {
  repository: OrderRepository;
  customerLookup?: OrderCustomerLookup;
  productSnapshotLookup?: OrderProductSnapshotLookup;
  locationAccess?: OrderLocationAccess;
}

export class OrderService {
  private readonly repository: OrderRepository;
  private readonly customerLookup: OrderCustomerLookup;
  private readonly productSnapshotLookup: OrderProductSnapshotLookup;
  private readonly locationAccess: OrderLocationAccess;

  constructor(dependencies: OrderServiceDependencies) {
    this.repository = dependencies.repository;
    this.customerLookup = dependencies.customerLookup ?? loadActiveOrderCustomer;
    this.productSnapshotLookup = dependencies.productSnapshotLookup ?? prepareOrderProductSnapshots;
    this.locationAccess = dependencies.locationAccess ?? canAccessStockLocation;
  }

  private async assertLocationAccess(actor: OrderActor, locationId: string): Promise<void> {
    if (!(await this.locationAccess(actor, locationId))) {
      throw orderLocationForbidden();
    }
  }

  async createOrder(
    actor: OrderActor,
    requestId: string,
    input: CreateOrderInput,
  ): Promise<OrderRecord> {
    await this.assertLocationAccess(actor, input.fulfilmentLocationId);
    const customer = await this.customerLookup(actor, input.customerId);
    const items = await this.buildItems(actor, input.items);
    const totals = calculateOrderTotals(items);
    const context: OrderMutationContext = { actorId: actor.id, requestId };

    return this.repository.createReceivedOrder(
      {
        customerId: input.customerId,
        customerNameSnapshot: customer.fullName,
        customerPhoneSnapshot: customer.phone,
        customerEmailSnapshot: customer.email,
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

    return this.repository.amendReceivedOrder(
      orderId,
      { id: actor.id, roleCode: actor.roleCode },
      context,
      async (current) => {
      if (current.status !== 'received') {
        throw orderConflict('Only orders in the received state can be amended.');
      }

      const fulfilmentLocationId = input.fulfilmentLocationId ?? current.fulfilmentLocationId;
      if (fulfilmentLocationId !== current.fulfilmentLocationId) {
        await this.assertLocationAccess(actor, fulfilmentLocationId);
      }

      const customerId = input.customerId ?? current.customerId;
      let customerSnapshot = {
        customerNameSnapshot: current.customerNameSnapshot,
        customerPhoneSnapshot: current.customerPhoneSnapshot,
        customerEmailSnapshot: current.customerEmailSnapshot,
      };
      if (input.customerId !== undefined && input.customerId !== current.customerId) {
        const customer = await this.customerLookup(actor, customerId);
        customerSnapshot = {
          customerNameSnapshot: customer.fullName,
          customerPhoneSnapshot: customer.phone,
          customerEmailSnapshot: customer.email,
        };
      }

      const items =
        input.items === undefined ? current.items : await this.buildItems(actor, input.items);
      const totals = calculateOrderTotals(items);

      return {
        customerId,
        ...customerSnapshot,
        sourceChannel: input.sourceChannel ?? current.sourceChannel,
        fulfilmentLocationId,
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

  private async buildItems(
    actor: OrderActor,
    requestedItems: readonly OrderItemRequest[],
  ): Promise<OrderItemSnapshot[]> {
    if (requestedItems.length === 0) {
      throw orderConflict('An order must contain at least one item.');
    }

    const snapshots = await this.productSnapshotLookup(actor, requestedItems);
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
