import type { CustomerActor } from '../customers/customer.service.js';

export type OrderActor = CustomerActor;

export type OrderSourceChannel = 'whatsapp' | 'instagram' | 'website' | 'phone';

export type OrderStatus =
  | 'received'
  | 'confirmed'
  | 'processing'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'failed';

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

export interface OrderCreateWriteModel extends OrderTotals {
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

export interface OrderAmendmentWriteModel extends OrderTotals {
  customerId: string;
  sourceChannel: OrderSourceChannel;
  fulfilmentLocationId: string;
  items: OrderItemSnapshot[];
  currency: 'NGN';
  deliveryAddressSnapshot: string | null;
  notes: string | null;
  updatedBy: string;
}

export interface OrderRecord extends OrderCreateWriteModel {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderMutationContext {
  actorId: string;
  requestId: string;
}
