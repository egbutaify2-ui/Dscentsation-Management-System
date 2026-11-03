import type {
  OrderAmendmentWriteModel,
  OrderCreateWriteModel,
  OrderMutationContext,
  OrderRecord,
} from './order.types.js';

/**
 * Persistence boundary for Task 022.
 *
 * The concrete PostgreSQL adapter is intentionally connected when migration 007
 * can be added after migrations 005 and 006 are integrated. Its implementation
 * must keep each header/item/audit write in one transaction.
 */
export interface OrderRepository {
  createReceivedOrder(
    order: OrderCreateWriteModel,
    context: OrderMutationContext,
  ): Promise<OrderRecord>;

  /**
   * Implementations must lock the current order row (SELECT ... FOR UPDATE),
   * pass the locked aggregate to buildAmendment, and persist the returned
   * replacement header/items plus audit event atomically. The callback is
   * invoked while the row lock is held so status checks cannot race an
   * order-confirmation transition.
   */
  amendReceivedOrder(
    orderId: string,
    context: OrderMutationContext,
    buildAmendment: (current: OrderRecord) => Promise<OrderAmendmentWriteModel>,
  ): Promise<OrderRecord>;
}
