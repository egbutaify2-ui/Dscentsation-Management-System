import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import './PaymentManagement.css';
import { ApiError, api, getCsrfToken } from '../../lib/api/client.js';

type PaymentStatus = 'pending' | 'verified';

interface PaymentEvent {
  id: string;
  eventType: 'recorded' | 'verified';
  amountMinor: string;
  reason: string | null;
  actorUserId: string;
  occurredAt: string;
}

interface PaymentRecord {
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
  history: PaymentEvent[];
}

interface PaymentPage {
  items: PaymentRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface OrderPaymentSummary {
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

interface PaymentFormState {
  amount: string;
  method: string;
  reference: string;
}

const emptyPaymentForm: PaymentFormState = {
  amount: '',
  method: '',
  reference: '',
};

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export function parseNairaToKobo(value: string): string {
  const normalized = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Enter a valid NGN amount with no more than two decimal places.');
  }

  const parts = normalized.split('.');
  const whole = BigInt((parts[0] ?? '0').replace(/,/g, ''));
  const fraction = BigInt(((parts[1] ?? '') + '00').slice(0, 2));
  const amountMinor = whole * 100n + fraction;

  if (amountMinor <= 0n) {
    throw new Error('The payment amount must be greater than zero.');
  }
  if (amountMinor > MAX_POSTGRES_BIGINT) {
    throw new Error('The payment amount exceeds the supported NGN range.');
  }

  return amountMinor.toString();
}

function formatNaira(amountMinor: string): string {
  try {
    const amount = BigInt(amountMinor);
    const whole = amount / 100n;
    const fraction = (amount % 100n).toString().padStart(2, '0');
    return '₦' + whole.toLocaleString('en-NG') + '.' + fraction;
  } catch {
    return '₦0.00';
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function newIdempotencyKey(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('A secure payment request key could not be generated. Refresh and try again.');
  }
  return crypto.randomUUID();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export interface OrderPaymentManagementProps {
  orderId: string;
  permissions: string[];
}

/**
 * Reusable payment workspace for an order.
 * Payment reads are deliberately never requested without payments.verify.
 */
export function OrderPaymentManagement({
  orderId,
  permissions,
}: OrderPaymentManagementProps) {
  const canRecord = permissions.includes('payments.record');
  const canVerify = permissions.includes('payments.verify');

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [summary, setSummary] = useState<OrderPaymentSummary | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(canVerify);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(emptyPaymentForm);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordedPayment, setRecordedPayment] = useState<PaymentRecord | null>(null);
  const [verifyingPaymentId, setVerifyingPaymentId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const verifyingRef = useRef<string | null>(null);

  const loadPayments = useCallback(async () => {
    if (!canVerify) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const [nextSummary, nextPage] = await Promise.all([
        api.get<OrderPaymentSummary>(
          '/orders/' + encodeURIComponent(orderId) + '/payments/summary',
        ),
        api.get<PaymentPage>(
          '/orders/' + encodeURIComponent(orderId) + '/payments?page=1&pageSize=100',
        ),
      ]);
      setSummary(nextSummary);
      setPayments(nextPage.items);
    } catch (error) {
      setHistoryError(getErrorMessage(error));
    } finally {
      setLoadingHistory(false);
    }
  }, [canVerify, orderId]);

  useEffect(() => {
    if (canVerify) {
      void loadPayments();
    } else {
      setPayments([]);
      setSummary(null);
      setLoadingHistory(false);
      setSelectedPayment(null);
    }
  }, [canVerify, loadPayments]);

  function updatePaymentForm(field: keyof PaymentFormState, value: string) {
    // A changed payload must use a new key; an unchanged retry retains its original key.
    idempotencyKeyRef.current = null;
    setPaymentForm((current) => ({ ...current, [field]: value }));
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRecord || submittingRef.current) return;

    let amountMinor: string;
    try {
      amountMinor = parseNairaToKobo(paymentForm.amount);
    } catch (error) {
      setActionError(getErrorMessage(error));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setActionError(null);
    setNotice(null);

    try {
      const idempotencyKey = idempotencyKeyRef.current ?? newIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      const csrfToken = await getCsrfToken();
      const payload = {
        amountMinor,
        currency: 'NGN' as const,
        ...(paymentForm.method.trim() ? { method: paymentForm.method.trim() } : {}),
        ...(paymentForm.reference.trim() ? { reference: paymentForm.reference.trim() } : {}),
      };
      const payment = await api.post<PaymentRecord>(
        '/orders/' + encodeURIComponent(orderId) + '/payments',
        payload,
        csrfToken,
        { 'Idempotency-Key': idempotencyKey },
      );

      idempotencyKeyRef.current = null;
      setRecordedPayment(payment);
      setPaymentForm(emptyPaymentForm);
      setShowPaymentForm(false);
      setNotice('Payment recorded. It is pending verification.');
      if (canVerify) await loadPayments();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function verifyPayment(paymentId: string) {
    if (!canVerify || verifyingRef.current === paymentId) return;
    verifyingRef.current = paymentId;
    setVerifyingPaymentId(paymentId);
    setActionError(null);
    setNotice(null);

    try {
      const csrfToken = await getCsrfToken();
      const verifiedPayment = await api.post<PaymentRecord>(
        '/payments/' + encodeURIComponent(paymentId) + '/verify',
        {},
        csrfToken,
      );
      setSelectedPayment((current) =>
        current?.id === paymentId ? verifiedPayment : current,
      );
      setNotice('Payment verified successfully.');
      await loadPayments();
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      verifyingRef.current = null;
      setVerifyingPaymentId(null);
    }
  }

  async function openPaymentDetails(paymentId: string) {
    if (!canVerify) return;
    if (selectedPayment?.id === paymentId) {
      setSelectedPayment(null);
      return;
    }

    setLoadingDetailId(paymentId);
    setActionError(null);
    try {
      const detail = await api.get<PaymentRecord>('/payments/' + encodeURIComponent(paymentId));
      setSelectedPayment(detail);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setLoadingDetailId(null);
    }
  }

  function renderPaymentGroup(title: string, groupPayments: PaymentRecord[]) {
    return (
      <section className="payment-history-group" aria-label={title}>
        <div className="payment-history-group-heading">
          <h3>{title}</h3>
          <span>{groupPayments.length}</span>
        </div>
        {groupPayments.length === 0 ? (
          <p className="payment-empty-group">No {title.toLowerCase()}.</p>
        ) : (
          <div className="payment-table-wrap">
            <table className="payment-table" aria-label={title + ' records'}>
              <thead>
                <tr>
                  <th scope="col">Amount</th>
                  <th scope="col">Method and reference</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupPayments.map((payment) => (
                  <Fragment key={payment.id}>
                    <tr>
                      <td className="payment-amount-cell">{formatNaira(payment.amountMinor)}</td>
                      <td>
                        <strong>{payment.method || 'Method not provided'}</strong>
                        {payment.reference && <small>Ref: {payment.reference}</small>}
                      </td>
                      <td>{formatTimestamp(payment.createdAt)}</td>
                      <td>
                        <span className={'payment-status ' + payment.status}>
                          {payment.status === 'verified' ? 'Verified' : 'Pending'}
                        </span>
                      </td>
                      <td>
                        <div className="payment-row-actions">
                          <button
                            className="payment-text-button"
                            type="button"
                            onClick={() => void openPaymentDetails(payment.id)}
                            disabled={loadingDetailId === payment.id}
                          >
                            {loadingDetailId === payment.id
                              ? 'Loading…'
                              : selectedPayment?.id === payment.id
                                ? 'Hide details'
                                : 'Details'}
                          </button>
                          {payment.status === 'pending' && (
                            <button
                              className="payment-verify-button"
                              type="button"
                              onClick={() => void verifyPayment(payment.id)}
                              disabled={verifyingPaymentId !== null}
                            >
                              {verifyingPaymentId === payment.id ? 'Verifying…' : 'Verify'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {selectedPayment?.id === payment.id && (
                      <tr className="payment-detail-row" key={payment.id + '-detail'}>
                        <td colSpan={5}>
                          <div className="payment-detail-panel">
                            <div>
                              <strong>Payment reference</strong>
                              <span>{selectedPayment.reference || 'Not supplied'}</span>
                            </div>
                            <div>
                              <strong>Recorded by</strong>
                              <span>{selectedPayment.recordedBy}</span>
                            </div>
                            <div>
                              <strong>Verified by</strong>
                              <span>{selectedPayment.verifiedBy || 'Not verified'}</span>
                            </div>
                            <div>
                              <strong>Payment activity</strong>
                              {selectedPayment.history.length === 0 ? (
                                <span>No payment activity returned.</span>
                              ) : (
                                <ul>
                                  {selectedPayment.history.map((entry) => (
                                    <li key={entry.id}>
                                      <span>
                                        {entry.eventType === 'recorded' ? 'Recorded' : 'Verified'}
                                      </span>
                                      <small>
                                        {formatTimestamp(entry.occurredAt)} · {entry.actorUserId}
                                      </small>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="payment-panel" aria-labelledby="payment-panel-title">
      <header className="payment-panel-heading">
        <div>
          <p className="eyebrow">ORDER FINANCE</p>
          <h2 id="payment-panel-title">Payments</h2>
          <p className="payment-panel-description">
            Record incoming payments and track verification against this order.
          </p>
        </div>
        {canRecord && (
          <button
            className="primary-button payment-action-button"
            type="button"
            onClick={() => {
              setActionError(null);
              setNotice(null);
              setShowPaymentForm((current) => !current);
            }}
          >
            {showPaymentForm ? 'Close form' : 'Record payment'}
          </button>
        )}
      </header>

      {actionError && (
        <div className="payment-alert error" role="alert">
          {actionError}
        </div>
      )}
      {notice && (
        <div className="payment-alert success" role="status">
          {notice}
        </div>
      )}

      {canVerify && (
        <section className="payment-summary-section" aria-label="Order payment summary">
          <div className="payment-summary-heading">
            <div>
              <p className="eyebrow">PAYMENT POSITION</p>
              <h3>Order summary</h3>
            </div>
            {summary && (
              <span className={'payment-overall-status ' + summary.paymentStatus}>
                {summary.paymentStatus.replace('_', ' ')}
              </span>
            )}
          </div>
          {loadingHistory && !summary ? (
            <div className="payment-state" role="status">Loading payment summary…</div>
          ) : summary ? (
            <div className="payment-summary-grid">
              <article>
                <span>Order total</span>
                <strong>{formatNaira(summary.orderTotalMinor)}</strong>
              </article>
              <article>
                <span>Verified paid</span>
                <strong>{formatNaira(summary.verifiedPaidMinor)}</strong>
                <small>{summary.verifiedCount} verified</small>
              </article>
              <article>
                <span>Pending payments</span>
                <strong>{formatNaira(summary.pendingPaymentMinor)}</strong>
                <small>{summary.pendingCount} pending</small>
              </article>
              <article className="payment-outstanding-tile">
                <span>Outstanding balance</span>
                <strong>{formatNaira(summary.outstandingMinor)}</strong>
              </article>
            </div>
          ) : (
            <div className="payment-state">
              Payment summary is unavailable.

            </div>
          )}
        </section>
      )}

      {showPaymentForm && canRecord && (
        <form className="payment-record-form" onSubmit={(event) => void submitPayment(event)}>
          <div className="payment-form-heading">
            <div>
              <p className="eyebrow">NEW PAYMENT</p>
              <h3>Record an incoming payment</h3>
            </div>
            <p>Amounts are entered in naira and stored as integer kobo.</p>
          </div>
          <div className="payment-form-grid">
            <label>
              Amount (NGN)
              <input
                autoComplete="off"
                inputMode="decimal"
                name="amount"
                placeholder="e.g. 12500.00"
                value={paymentForm.amount}
                onChange={(event) => updatePaymentForm('amount', event.target.value)}
                required
              />
            </label>
            <label>
              Payment method (optional)
              <input
                autoComplete="off"
                name="method"
                placeholder="Enter the method as provided"
                value={paymentForm.method}
                onChange={(event) => updatePaymentForm('method', event.target.value)}
                maxLength={80}
              />
            </label>
            <label className="payment-reference-field">
              Reference (optional)
              <input
                autoComplete="off"
                name="reference"
                placeholder="Transaction or customer reference"
                value={paymentForm.reference}
                onChange={(event) => updatePaymentForm('reference', event.target.value)}
                maxLength={160}
              />
            </label>
          </div>
          <p className="payment-form-note">
            A new record remains pending until an authorised Owner or Manager verifies it. A
            payment method or reference is optional and accepts free text.
          </p>
          <div className="payment-form-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setShowPaymentForm(false);
                setPaymentForm(emptyPaymentForm);
                idempotencyKeyRef.current = null;
                setActionError(null);
              }}
            >
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Recording…' : 'Save payment'}
            </button>
          </div>
        </form>
      )}

      {recordedPayment && (
        <section className="payment-recorded-result" aria-label="Payment just recorded">
          <div>
            <p className="eyebrow">RECENTLY RECORDED</p>
            <strong>{formatNaira(recordedPayment.amountMinor)}</strong>
            <span className={'payment-status ' + recordedPayment.status}>
              {recordedPayment.status === 'verified' ? 'Verified' : 'Pending verification'}
            </span>
          </div>
          <p>
            {recordedPayment.method || 'Payment method not supplied'}
            {recordedPayment.reference ? ' · Ref: ' + recordedPayment.reference : ''}
          </p>
        </section>
      )}

      {!canVerify && canRecord && (
        <div className="payment-restricted-note">
          Payment history and order summaries are restricted to users with the
          <strong> payments.verify </strong>
          permission. You can still record a payment and see the result returned for that record.
        </div>
      )}

      {!canRecord && !canVerify && (
        <div className="payment-state">
          Your account does not have permission to record or view payments for this order.
        </div>
      )}

      {canVerify && (
        <section className="payment-history-section" aria-label="Payment history">
          <div className="payment-history-heading">
            <div>
              <p className="eyebrow">RECORDED ACTIVITY</p>
              <h3>Payment history</h3>
            </div>
            {summary && <span>{summary.paymentCount} total</span>}
          </div>
          {historyError && (
            <div className="payment-alert error" role="alert">
              {historyError}
              <button
                className="payment-text-button"
                type="button"
                onClick={() => void loadPayments()}
              >
                Retry
              </button>
            </div>
          )}
          {loadingHistory ? (
            <div className="payment-state" role="status">Loading payment history…</div>
          ) : payments.length === 0 ? (
            <div className="payment-state">
              <strong>No payments have been recorded yet.</strong>
              <span>Recorded payments will appear here, separated by verification status.</span>
            </div>
          ) : (
            <div className="payment-history-groups">
              {renderPaymentGroup(
                'Pending payments',
                payments.filter((payment) => payment.status === 'pending'),
              )}
              {renderPaymentGroup(
                'Verified payments',
                payments.filter((payment) => payment.status === 'verified'),
              )}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
