import type {
  OrderAmendmentWriteModel,
  OrderCreateWriteModel,
  OrderMutationContext,
  OrderRecord,
} from './order.types.js';

/**
 * Persistence boundary for Task 022.
 *
 * The PostgreSQL adapter in order.postgres.repository.ts implements this contract.
 * It keeps each header/item/audit write in one transaction.
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
