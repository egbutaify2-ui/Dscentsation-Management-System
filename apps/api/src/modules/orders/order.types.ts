import type { CustomerActor } from '../customers/customer.service.js';

export type OrderActor = CustomerActor;

export type OrderSourceChannel = 'whatsapp' | 'instagram' | 'website' | 'phone';

export const ORDER_STATUSES = [
  'received',
  'confirmed',
  'processing',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
  'failed_delivery',
  'fulfilment_hold',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItemRequest {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface CreateOrderInput {
  customerId: string;
  sourceChannel: OrderSourceChannel;
  fulfilmentLocationId: string;
  items: OrderItemRequest[];
  deliveryAddress?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface AmendOrderInput {
  customerId?: string | undefined;
  sourceChannel?: OrderSourceChannel | undefined;
  fulfilmentLocationId?: string | undefined;
  items?: OrderItemRequest[] | undefined;
  deliveryAddress?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface OrderProductSnapshot {
  productId: string;
  productVariantId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string;
  skuSnapshot: string | null;
  unitOfMeasureSnapshot: string;
  unitPriceMinor: string;
}

export interface OrderItemSnapshot extends OrderProductSnapshot {
  quantity: number;
  discountMinor: string;
  lineTotalMinor: string;
}

export interface OrderTotals {
  subtotalMinor: string;
  discountMinor: string;
  deliveryFeeMinor: string;
  totalMinor: string;
}

export interface OrderCustomerSnapshot {
  customerNameSnapshot: string;
  customerPhoneSnapshot: string | null;
  customerEmailSnapshot: string | null;
}

export interface OrderCreateWriteModel extends OrderTotals, OrderCustomerSnapshot {
  customerId: string;
  sourceChannel: OrderSourceChannel;
  status: 'received';
  fulfilmentLocationId: string;
  items: OrderItemSnapshot[];
  currency: 'NGN';
  deliveryAddressSnapshot: string | null;
  notes: string | null;
  createdBy: string;
}

export interface OrderAmendmentWriteModel extends OrderTotals, OrderCustomerSnapshot {
  customerId: string;
  sourceChannel: OrderSourceChannel;
  fulfilmentLocationId: string;
  items: OrderItemSnapshot[];
  currency: 'NGN';
  deliveryAddressSnapshot: string | null;
  notes: string | null;
  updatedBy: string;
}

export interface OrderRecord extends Omit<OrderCreateWriteModel, 'status'> {
  id: string;
  status: OrderStatus;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderMutationContext {
  actorId: string;
  requestId: string;
}
