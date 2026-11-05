export type PaymentStatus = 'pending' | 'verified';
export type PaymentEventType = 'recorded' | 'verified';

export interface RecordPaymentInput {
  amountMinor: string;
  currency: 'NGN';
  method?: string | undefined;
  reference?: string | undefined;
  occurredAt?: string | undefined;
}

export interface PaymentEventRecord {
  id: string;
  eventType: PaymentEventType;
  amountMinor: string;
  reason: string | null;
  actorUserId: string;
  occurredAt: string;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  amountMinor: string;
  currency: 'NGN';
  method: string | null;
  reference: string | null;
  status: PaymentStatus;
  recordedBy: string;
  occurredAt: string;
  createdAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  history: PaymentEventRecord[];
}

export interface PaymentPage {
  items: PaymentRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OrderPaymentSummary {
  orderId: string;
  currency: 'NGN';
  orderTotalMinor: string;
  verifiedPaidMinor: string;
  pendingPaymentMinor: string;
  outstandingMinor: string;
  paymentCount: number;
  pendingCount: number;
  verifiedCount: number;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
}
