import {
  getCustomer,
  type CustomerRecord,
} from '../customers/customer.service.js';
import { orderConflict } from './order.errors.js';
import type { OrderActor } from './order.types.js';

export async function loadActiveOrderCustomer(
  actor: OrderActor,
  customerId: string,
): Promise<CustomerRecord> {
  // getCustomer enforces the existing customers.view permission. Do not bypass it
  // with a direct customers-table query or assign additional role permissions.
  const customer = await getCustomer(actor, customerId);
  if (customer.status !== 'active') {
    throw orderConflict('Archived customers cannot be selected for a new or amended order.');
  }
  return customer;
}
