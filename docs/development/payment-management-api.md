# Payment Management API — Task 032

## Dependency and implementation boundary

This increment is based on the Order backend candidate in PR #18:
39237502b6e8605c23f47105dd5cacc6dc4a604a. It must not merge independently of the Order migration that creates orders.

Task 031's payment-domain findings are applied here. Existing payments.record grants remain unchanged (Owner, Manager and Staff); existing payments.verify grants remain unchanged (Owner and Manager). No new permission code or production role assignment is introduced.

DMS-DEC-002 remains pending. Until individual financial-record visibility is formally approved, list, detail and summary reads are conservatively gated by the existing payments.verify permission (Owner/Manager). Staff can record and receive the response for their own new payment, but cannot browse payment history or summary through these endpoints. This is a temporary least-privilege gate, not a claim that DMS-DEC-002 is resolved.

DMS-DEC-004 remains pending. The method field is optional free text, not a fixed enum. The transaction reference is optional and not unique. No payment-method, reference-uniqueness, evidence or reconciliation policy is implied. The API does not assert that a recorded payment is proof of receipt; only the authorised verification action changes it to verified. Verification evidence fields and sufficiency rules are deliberately not invented.

DMS-DEC-003, DMS-DEC-005, DMS-DEC-012, DMS-DEC-016, DMS-DEC-020 and DMS-DEC-028 remain outside this implementation decision. Refunds, cancellation/payment coupling, approval thresholds, receipt issuance, evidence retention and financial reporting are not implemented.

## Schema

Migration 008_payment_management.js creates:

- payments: immutable recorded amount/order/method/reference/recording actor/occurrence details, NGN BIGINT kobo, pending/verified state, verifier attribution and required per-recorder idempotency key/fingerprint.
- payment_events: immutable recorded and verified events, amount snapshot, actor and occurrence timestamp.

Payment event types reflect only this increment's implemented lifecycle. Refund, reversal, rejection and correction event types are not introduced before their business policy is approved.

Payment records and events cannot be updated/deleted/truncated. A payment's original financial fields cannot be changed; a pending payment may transition to verified once. Deferred database constraints require header state and immutable event history to agree. An order's total cannot change after its first payment record is created, protecting the amount against subsequent Order amendments.

A payment reference is not globally unique. The method field accepts a bounded label without enforcing an unapproved method list. The optional reference is not assumed to exist for every method.

## Endpoints

All routes require an authenticated DMS session and existing permission middleware.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| POST | /api/v1/orders/:orderId/payments | payments.record | Record a pending payment |
| GET | /api/v1/orders/:orderId/payments | payments.verify | Paginated payment history, including append-only events |
| GET | /api/v1/payments/:paymentId | payments.verify | One payment and its history |
| POST | /api/v1/payments/:paymentId/verify | payments.verify | Verify a pending payment once |
| GET | /api/v1/orders/:orderId/payments/summary | payments.verify | Order total, verified paid, pending and outstanding amounts |

Record requests require an Idempotency-Key header (8–128 characters). Replaying the same key and content for the same recorder returns the original payment. Reusing that key with different order/payment content returns HTTP 409.

Record body:

    {
      "amountMinor": "250000",
      "currency": "NGN",
      "method": "optional free-form label",
      "reference": "optional transaction reference",
      "occurredAt": "2026-11-04T08:00:00.000Z"
    }

amountMinor is a positive decimal integer string in kobo. BIGINT values remain strings in API responses. method, reference and occurredAt are optional.

Verification accepts an empty JSON object. It does not fabricate or require evidence pending DMS-DEC-004; the existing verification permission is enforced server-side. The verifier ID and timestamp are stored only on a successful one-time transition.

## Financial integrity

- Every recording and verification transaction locks the parent order before payment rows, and writes the payment/header event/audit record atomically.
- Verification locks the parent order and payment row, checks the verified-payment total using integer arithmetic, and refuses a result greater than the immutable order total.
- A database trigger repeats the overpayment guard and permits only pending-to-verified once.
- Only rows with status = verified count toward verified receipts. Pending amounts are reported separately; outstanding is order total - verified paid.
- No payment operation reserves/releases stock, posts stock movement, transfers inventory or changes the order total.
- Audit events payment.recorded and payment.verified are inserted in the same transaction as payment state/history.
- Refunds, reversals, corrections and customer-credit handling remain excluded because their approval rules are unresolved.
