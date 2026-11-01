# DMS Architecture Decision Register

**Task:** 004 — Consolidate Remaining Architecture Decisions
**Purpose:** Record the business information, approvals and technical choices that remain open after the Task 005 application foundation was implemented and merged, while distinguishing implementation evidence from formal architecture approval.
**Scope:** Initial DMS release for Dscentsation's Nigerian operations.
**Source documents reviewed:** `README.md`, `docs/architecture/overview.md`, `docs/architecture/database-design.md`, `docs/architecture/decisions.md`, `docs/development/setup.md`, Task 005 package manifests, the initial migration, API source and GitHub Actions workflow, including ADR-001 through ADR-016.

> This register is a consolidation of the current documentation, not a replacement for the source architecture documents. It does not approve a proposal, choose an answer on behalf of the business, authorise implementation or amend an existing ADR. Where a question is unanswered, it is left unanswered.

## 1. How to read this register

Every entry has a stable ID. Keep the ID when the wording is clarified or the decision is later recorded; do not silently reuse an ID for a different decision.

Use only these statuses:

- **Pending confirmation** — the documentation identifies a missing business answer, operational rule, verification result or approval. No answer is assumed.
- **Proposed** — the source documents contain a specific technical or architectural recommendation, but it has not been accepted as the approved project direction.
- **Confirmed** — documentary evidence shows that the decision has been approved. Confirmed decisions are listed in §4 for traceability and are not reopened as outstanding work in this register.

A status describes the state evidenced by the current source documents. It is not a claim that a business owner has approved an item merely because it appears here. No approver, deadline or approval date is invented.

**Task 010 planning note:** The revised location, access, cross-location approval and financial-visibility direction in this update was supplied during planning. It is recorded as the intended operating model, not as formal business-owner approval evidence. No approver, approval date or evidence reference has been supplied. DMS-DEC-001 and DMS-DEC-002 therefore remain **Pending confirmation** until their stated outstanding requirements and formal approval evidence are recorded.

## 2. Outstanding business and operational decisions

### DMS-DEC-001 — Canonical physical stock locations and Staff assignments

- **Topic:** Initial location register, location identifiers and role-based location assignments.
- **Outstanding question:** What approved unique codes and identifying details will be used for the two initial locations, how will the private account-to-location mappings be established, and who is authorised to grant, change or revoke those mappings?
- **Why it matters:** Stock is held and reported per location. Orders, transfers, access checks and the dedicated Warehouse-to-Sheraton workflow depend on stable location records and correct account assignments. Incorrect or incomplete setup could expose stock to the wrong user or direct stock movements to the wrong balance.
- **Current documented position:** The supplied Task 010 planning direction identifies two initial operating locations: **Ajose Warehouse**, the main warehouse and stock-holding location, and **Sheraton Store**, the customer-facing walk-in retail store. They are separate physical stock locations with independent balances. The Owner has authority across both locations; the existing Manager role is used for the Sheraton Store Manager, assigned to Sheraton; and three Warehouse Staff accounts are assigned to Ajose Warehouse. All authorised operational users are intended to have shared read-only operational visibility of both locations. Direct stock-changing operations by non-Owners are scoped to the user's assigned location; a non-Owner request to change stock at the other location enters the cross-location approval process described under DMS-DEC-002. Standard transfers, dedicated physical pickup and destination receipt remain separate workflows. The actual employee identities/account IDs, location codes, addresses and secure account-to-location mappings have not been supplied. This planning direction is not formal approval evidence.
- **Exact information or approval required:** Approve the unique code and any required address/identifying details for each named location; identify the canonical Ajose Warehouse source and Sheraton Store destination records; establish the actual employee-account-to-location mappings privately through an authorised secure process; and approve who may grant, change, temporarily vary and revoke assignments, including required reason and audit evidence. Do not place personal employee details, account IDs or credentials in this public repository. Do not invent codes, addresses or UUIDs.
- **Related architecture document and section:** `README.md` — “Business context and confirmed decisions”, “Multi-location inventory and stock management”, “Users and permissions”, Phase 0; `docs/architecture/overview.md` — §4.2 and §5; `docs/architecture/database-design.md` — §2.1 “Users, roles, location access and persistent sessions” and §2.2 “Locations”; `docs/architecture/decisions.md` — ADR-005, ADR-006 and ADR-016.
- **Status:** Pending confirmation

### DMS-DEC-002 — Detailed role and permission matrix

- **Topic:** Read, create, edit, action, cross-location approval, financial visibility and export permissions by role.
- **Outstanding question:** Which remaining operations may Owner, Manager and Staff perform in every DMS module and for each record/field, beyond the specific location, stock-change approval, payment and owner-only financial-overview direction supplied for Task 010?
- **Why it matters:** A role label alone is not sufficient to enforce least privilege. An incomplete matrix can expose customer information, individual financial records, documents or administrative controls, or prevent staff from completing legitimate operational work.
- **Current documented position:** The existing roles remain Owner, Manager and Staff; no role code is added or changed. The supplied Task 010 planning direction is that authorised operational users share read-only visibility of both location dashboards, stock quantities and availability; non-Owner direct stock-changing operations are limited to the user's assigned location; and a non-Owner stock-changing request for the other location requires approval by an authorised user at the destination location. The Owner may operate directly at either location and may approve, reject or override another user's pending request. The Owner-only consolidated financial overview includes total money in, total money out, revenue, expenses and profit/loss across both locations; non-Owners must not receive that overview through the API. The direction is not formal approval evidence. Existing payment rules remain: Staff may record payment entries; only Manager and Owner may verify them. The generic Manager role does not automatically grant unrestricted cross-location stock editing. Operations to evaluate under the cross-location rule include manual stock adjustments/corrections; receiving that changes the target location's balance; stock-count reconciliation; and other non-transfer stock operations that change quantities. Non-Owner reservation or dispatch operations that change stock at a location other than the actor's assigned location are also subject to this approval rule, including when they form part of an order workflow. The only separate workflow exceptions are standard stock transfers, the dedicated Ajose Warehouse-to-Sheraton Store physical pickup, and destination receipt for those transfer workflows. These transfer workflows remain governed by their separate lifecycles and are not routed through this additional approval queue. Detailed permissions for individual financial records and the wider modules remain open.
- **Exact information or approval required:** Formally approve the specific shared-visibility, location-scoped-editing, cross-location approval-routing and Owner-only financial-overview direction, and separately approve the complete role-by-module matrix for customers, products, orders, cancellations, dispatch, receiving/adjustments/counts/transfers, returns, refunds, payment records, expenses, suppliers/purchase orders, individual financial records, reports, exports, documents, user administration, location administration and system settings. Specify create/edit/archive/submit/approve/verify/resolve/export actions and any field-level restrictions. Do not infer that Owner-only summary visibility settles permissions for individual financial records or expense/refund operations. Preserve existing payment-entry/payment-verification rules and DMS-DEC-003 monetary approval limits.
- **Related architecture document and section:** `README.md` — “Users and permissions” and “Staff, administration and audit history”; `docs/architecture/overview.md` — §5 “Authentication and authorisation”; `docs/architecture/database-design.md` — §2.1; `docs/architecture/decisions.md` — ADR-006 and ADR-016.
- **Status:** Pending confirmation

### DMS-DEC-003 — Approval authority and monetary limits

- **Topic:** Approval thresholds, segregation of duties and escalation for business transactions.
- **Outstanding question:** Which roles may approve each transaction type, what NGN limits apply, and when is Owner approval or a second approver required?
- **Why it matters:** Expense and procurement approval controls affect cash outflow, fraud exposure and accountability. Without explicit limits, the system cannot reliably determine who may approve a transaction or when to escalate it.
- **Current documented position:** Expenses are intended to be submitted for approval and have an approval history. The database design explicitly states that expense approval limits and which roles may approve each amount are unresolved. The broader permission matrix also remains open. No monetary thresholds or dual-approval rules are documented.
- **Exact information or approval required:** Provide the approval authority for expenses, purchase orders/procurement commitments and other approval-controlled actions. State the permitted roles and exact NGN thresholds, whether limits are per transaction or cumulative over a period, how split transactions are treated, whether the requester may approve their own submission, when a second approver or Owner approval is mandatory, and how an unavailable approver is handled. If a transaction type will not require approval in the first release, state that explicitly.
- **Related architecture document and section:** `README.md` — “Expense management”, “Supplier and procurement management” and “Record and approve an expense”; `docs/architecture/overview.md` — §5; `docs/architecture/database-design.md` — §2.8 “Expenses and approvals” and §2.9 “Suppliers, procurement and goods received”; `docs/architecture/decisions.md` — ADR-006 and ADR-013.
- **Status:** Pending confirmation

### DMS-DEC-004 — Accepted payment methods and verification evidence

- **Topic:** Payment methods, evidence standards and manual reconciliation procedure.
- **Outstanding question:** Which payment methods does the business accept for orders, what evidence is sufficient for each method, and how does an authorised verifier establish that the funds were actually received?
- **Why it matters:** Payment entries must not be mistaken for confirmed money received. Clear evidence standards are needed to avoid duplicate, false or incorrectly attributed payments and unreliable cash-received reports.
- **Current documented position:** Payment entries are separate financial events. Staff may record them; only Manager or Owner may verify them. Unverified entries are excluded from verified receipts and paid-balance calculations. The first release is a manual payment-recording model; a payment gateway and automated bank reconciliation are not assumed. The accepted methods and evidence required before verification are explicitly open.
- **Exact information or approval required:** List each accepted method for the first release (do not assume cash, bank transfer, POS or any other method without business confirmation). For each method, define the required fields and evidence, who checks it, how the check is performed, how duplicate references or split/partial payments are handled, and what happens when evidence is incomplete or a payment is reversed. Confirm whether a manual reconciliation procedure or reconciliation log is required. Preserve the Staff-record/Manager-or-Owner-verify permission boundary.
- **Related architecture document and section:** `README.md` — “Sales and payment tracking” and “Register and fulfil an order”; `docs/architecture/overview.md` — §4.1 and §4.3; `docs/architecture/database-design.md` — §2.7 “Payments and refunds”; `docs/architecture/decisions.md` — ADR-006 and ADR-013.
- **Status:** Pending confirmation

### DMS-DEC-005 — Order cancellation rules

- **Topic:** Cancellation eligibility, authority, reasons and post-dispatch handling.
- **Outstanding question:** At which order states may an order or individual item be cancelled, who may request or approve cancellation, and what process applies once stock has been dispatched?
- **Why it matters:** Cancellation affects reserved stock, physical stock, customer commitments, payment history, receipts and delivery work. Undefined transitions can cause stock to be released twice, money to be misreported or an order to be treated as cancelled after it has already left the location.
- **Current documented position:** The planned order states include Received, Confirmed, Processing, Packed, Dispatched and Delivered, with cancelled and failed outcomes recorded with reasons. Cancelling an order releases its reservation; the database design requires active reservations to be released exactly once and the event to be audited. Dispatch reduces on-hand and consumes/releases the matching reservation. The permitted cancellation states, role authority, partial cancellation rules and post-dispatch treatment are not specified.
- **Exact information or approval required:** Define whether cancellation is allowed before confirmation, during processing/packing, after dispatch or after delivery; whether line-level/partial cancellation is allowed; which roles may request, approve and complete it; whether a reason and customer communication are mandatory; and how a cancellation interacts with verified payments, issued receipts, delivery/rider assignments and any already-dispatched goods. State the required failed-delivery or return path where cancellation is no longer appropriate. Do not change the documented reservation-release and dispatch accounting invariants.
- **Related architecture document and section:** `README.md` — “Order management”, “Inventory rules” and “Register and fulfil an order”; `docs/architecture/overview.md` — §4.1; `docs/architecture/database-design.md` — §2.6 “Orders and delivery” and §5 “Transaction boundaries”; `docs/architecture/decisions.md` — ADR-005 and ADR-015.
- **Status:** Pending confirmation

### DMS-DEC-006 — Dispatch and delivery handoff requirements

- **Topic:** Dispatch authority, handoff evidence and delivery completion/failure procedure.
- **Outstanding question:** What must be recorded and checked when an order leaves its fulfilment location, who is authorised to perform the handoff, and what evidence is required for dispatch, delivery attempts and final delivery?
- **Why it matters:** Dispatch is the point at which physical stock leaves the location and responsibility passes to a rider/courier or delivery recipient. Inadequate handoff records make missing parcels, failed attempts and disputed deliveries difficult to investigate.
- **Current documented position:** The order workflow includes processing, packing, dispatch and delivery. The system is expected to record delivery method, rider/courier details, dispatch/delivery dates, attempts, proof/status notes and failed-delivery reasons. At dispatch the backend records the outgoing stock movement and consumes/releases the reservation. The exact dispatch checklist, actor permissions, required evidence and delivery-attempt policy are not documented.
- **Exact information or approval required:** Define the required dispatch fields and checks, roles permitted to authorise and record dispatch, the information captured for an internal rider versus an external courier, customer/recipient handoff evidence, proof-of-dispatch/proof-of-delivery requirements, number or timing of delivery attempts if any, failed-delivery reasons and escalation, and the process for returned-to-sender or undeliverable orders. Clarify which steps must be recorded in DMS and which remain external business procedures. Preserve the single fulfilment-location rule and the stock movement at dispatch.
- **Related architecture document and section:** `README.md` — “Order management” and “Register and fulfil an order”; `docs/architecture/overview.md` — §4.1; `docs/architecture/database-design.md` — §2.6 and §5.
- **Status:** Pending confirmation

### DMS-DEC-007 — Initial stock reservation duration and expiry eligibility

- **Topic:** First-release reservation policy values.
- **Outstanding question:** How long should a confirmed order reserve stock, and which undispatched confirmed orders are eligible for automatic expiry?
- **Why it matters:** Reservations protect confirmed orders from being oversold but reduce the stock available to other customers. An inappropriate duration or eligibility scope can either tie up stock too long or release stock while the business still intends to fulfil an order.
- **Current documented position:** Immediate reservation on order confirmation is confirmed, whether the order is unpaid, partially paid or paid. Expiry must be configurable, persisted and versioned; each reservation snapshots the policy version and its expiry. An expired reservation is released from reserved quantity, not physical on-hand stock, and the order is put on fulfilment hold/reconfirmation rather than silently cancelled. The initial duration and expiry eligibility (for example, unpaid-only or all undispatched confirmed orders) are not settled.
- **Exact information or approval required:** Specify whether expiry is enabled for the first release; the initial duration and unit; the order/payment states eligible for expiry; whether paid, partially paid, processing or packed orders are excluded or included; and whether any order types have a different policy. Provide the approved initial policy values. Do not change the confirmed immediate-reservation rule or apply a new policy retroactively to existing reservations.
- **Related architecture document and section:** `README.md` — “Inventory rules” and “Register and fulfil an order”; `docs/architecture/overview.md` — §4.1; `docs/architecture/database-design.md` — §2.5 “Inventory balances, reservations, transfers and stock ledger”; `docs/architecture/decisions.md` — ADR-005.
- **Status:** Pending confirmation

### DMS-DEC-008 — Reservation grace periods, warnings and authorised overrides

- **Topic:** Reservation reminders and controlled extension/release.
- **Outstanding question:** Should DMS warn staff or customers before reservation expiry, is there a grace period, and under what circumstances may an authorised user extend or manually release an existing reservation?
- **Why it matters:** A fixed expiry without an agreed warning or exception process can release stock unexpectedly while an order is being followed up. Uncontrolled extensions, on the other hand, can leave stock reserved indefinitely.
- **Current documented position:** Reservation policies are versioned. A policy change affects new reservations only. Changing an existing reservation expiry requires an explicit authorised and audited action. The overview and ADR-005 leave grace periods and warning rules configurable; the exact warning channel, timing, extension eligibility and approver are not specified.
- **Exact information or approval required:** Confirm whether a grace period is required and its duration; who receives a warning, through which channel and at what point before expiry; whether notifications are internal, customer-facing or both; which roles may extend or release a reservation; eligible reasons/conditions; maximum extension rules if any; and the audit information required. State whether reminder delivery is a first-release requirement or deferred. Do not imply that expiry itself cancels an order.
- **Related architecture document and section:** `docs/architecture/overview.md` — §4.1 and §9; `docs/architecture/database-design.md` — §2.5 and §5; `docs/architecture/decisions.md` — ADR-005 and §3 “Decisions requiring project-manager confirmation”.
- **Status:** Pending confirmation

### DMS-DEC-009 — Transfer exceptions and discrepancy resolution

- **Topic:** Receiving exceptions, temporary unavailability and authorised discrepancy disposition.
- **Outstanding question:** How should the business handle a transfer when the assigned destination Staff member is unavailable, and which approved outcomes may resolve reported shortage, damage or loss?
- **Why it matters:** Unreceived quantities remain in transit and cannot be treated as available at either location. A vague exception process can leave stock in transit indefinitely or encourage unauthorised adjustments that conceal a discrepancy.
- **Current documented position:** For standard transfers, destination-assigned Staff confirm physical receipt. For the dedicated Ajose Warehouse-to-Sheraton Store workflow, Task 010 planning direction (pending formal confirmation under DMS-DEC-001/002) is that the assigned Store Manager using the existing Manager role is also eligible to perform destination receipt when the account has an active Sheraton assignment and the explicit destination-receipt permission; an unassigned Manager or other unassigned user is not eligible. Partial receipts and in-transit balances are tracked separately. Discrepancies require quantity, reason, reporter and subsequent authorised resolution; unresolved quantities remain visible. ADR-016 specifies how a partially picked-up transfer may be cancelled and that picked quantities cannot be silently erased, expired or returned to Warehouse. The general escalation procedure when no authorised destination-assigned actor is available and the permitted/approved discrepancy dispositions are not fully defined.
- **Exact information or approval required:** Define how a transfer is escalated and monitored when no currently authorised destination-assigned actor is available. For the dedicated Ajose Warehouse-to-Sheraton Store workflow, preserve the eligibility of the assigned Store Manager under the existing Manager role when active destination assignment and explicit receipt permission pass. If any substitute is needed, specify how that person is formally assigned and granted the explicit destination action permission before confirming receipt; an unassigned Manager or Staff account must not bypass the destination-assignment rule. For shortages, damage, loss and wrong-item delivery, define required evidence, permitted dispositions (for example, physical receipt of the remaining quantity, separately recorded return, quarantine, write-off or other approved resolution), approver role/threshold, and the stock/accounting event required for each outcome. Confirm ageing/escalation expectations for unresolved in-transit transfers.
- **Related architecture document and section:** `README.md` — “Multi-location inventory and stock management” and “Receive and transfer stock”; `docs/architecture/overview.md` — §4.2 and §4.2.1; `docs/architecture/database-design.md` — §2.5, “Inventory, transfer and Sheraton pickup invariants”, and §5; `docs/architecture/decisions.md` — ADR-005, ADR-006 and ADR-016.
- **Status:** Pending confirmation

### DMS-DEC-010 — Physical pickup paperwork or reference at Warehouse

- **Topic:** Business evidence accompanying the Sheraton-to-Warehouse pickup.
- **Outstanding question:** What paper, digital reference or other business evidence must a destination-assigned user (including the assigned Sheraton Store Manager when ADR-016 assignment and action-permission checks pass) present or record at Warehouse when collecting stock?
- **Why it matters:** The authorised pickup workflow and stock ledger establish who collected what and when, but the business may also require a handover reference or supporting document to match the physical collection to the approved transfer.
- **Current documented position:** ADR-016 fixes the transfer mode, source/destination restriction, quantity recording, atomic stock movement, event attribution and idempotency controls. The overview explicitly leaves the physical paperwork/reference process used at Warehouse to be confirmed. No required document or reference format is documented.
- **Exact information or approval required:** State whether a transfer reference, printed slip, dispatch note, signed handover, warehouse confirmation, identification check or other evidence is required. For each required item, define who creates it, who checks it, what information it must contain and whether DMS must store an uploaded copy or merely record its reference. If no additional paperwork is required beyond the DMS transfer record and pickup event, confirm that explicitly. This decision must not change ADR-016's permission boundary or stock accounting.
- **Related architecture document and section:** `docs/architecture/overview.md` — §4.2.1 and §11 “Review gates and unresolved questions”; `docs/architecture/database-design.md` — §2.5 “Sheraton pickup authorisation”; `docs/architecture/decisions.md` — ADR-016.
- **Status:** Pending confirmation

### DMS-DEC-011 — Return eligibility and inspection policy

- **Topic:** Conditions for accepting returns/exchanges and deciding the disposition of returned goods.
- **Outstanding question:** Which products/orders qualify for return or exchange, within what period, and what inspection criteria determine whether returned goods may be restocked, quarantined or treated as damaged?
- **Why it matters:** Return eligibility affects customer service, inventory accuracy and financial exposure. Returned stock must not re-enter sellable inventory until an authorised inspection outcome is recorded.
- **Current documented position:** Returns and exchanges are in the planned scope. The system is expected to capture the order, items, quantities, reason, inspection result and stock disposition. Returned goods must be inspected before any restock movement. The business eligibility window, accepted reasons/conditions, exclusions and inspection criteria are not documented.
- **Exact information or approval required:** Provide the return/exchange window and the event from which it is measured; eligible and excluded products or circumstances; acceptable return reasons and required evidence; rules for unopened, opened, used, damaged or incorrect items; inspection responsibility and approval; and the allowed outcomes for each condition (sellable restock, quarantine, damage/write-off, return to supplier or another defined disposition). Clarify whether exchanges are represented as linked return and replacement-order events. Do not restock an item solely because a return request was created.
- **Related architecture document and section:** `README.md` — “Returns, exchanges and refunds” and Phase 6; `docs/architecture/overview.md` — §3.1, §4.2 and §10; `docs/architecture/database-design.md` — §2.10 “Returns and exchanges”; `docs/architecture/decisions.md` — ADR-013.
- **Status:** Pending confirmation

### DMS-DEC-012 — Refund approval and processing policy

- **Topic:** Refund authority, methods, evidence and completion rules.
- **Outstanding question:** Who may request, approve and process refunds, which payment methods may be used to return funds, and what evidence closes a refund?
- **Why it matters:** Refunds affect customer balances, verified receipts, cash reporting and audit history. A refund must be linked to the original payment/order and must not be confused with a stock return or silently overwrite the original payment.
- **Current documented position:** Refunds are planned as distinct records linked to orders/payments, with request, approval and processing attribution. Approval/completion must be transactional and preserve payment/refund history. The detailed refund permissions are unresolved; no refund thresholds, eligible methods, timing or evidence requirements are specified. The confirmed rule that only Manager/Owner verify payment entries does not, by itself, define refund approval or processing permissions.
- **Exact information or approval required:** Define who may initiate, review/approve and execute a refund; any NGN thresholds or escalation to Owner; whether partial refunds are allowed and how fees/discounts/delivery charges are treated; which refund methods are permitted for each original payment method; required proof/reference and reconciliation; timing/statuses for requested, approved, processed, failed or reversed refunds; and how customer notification and receipt correction/reissue are handled. State how refund permissions relate to the separate return-inspection decision.
- **Related architecture document and section:** `README.md` — “Returns, exchanges and refunds”, “Sales and payment tracking” and Phase 6; `docs/architecture/overview.md` — §4.3 and §5; `docs/architecture/database-design.md` — §2.7, §2.10 and §5; `docs/architecture/decisions.md` — ADR-006 and ADR-013.
- **Status:** Pending confirmation

### DMS-DEC-013 — Supplier and procurement scope for the first release

- **Topic:** Which supplier/procurement capabilities are required in the initial operational release.
- **Outstanding question:** Must purchase orders, supplier invoices, goods-received records and supplier payment tracking all be included in the first release, or may any of these capabilities be deferred?
- **Why it matters:** Procurement scope affects the initial database model, inventory receiving workflow, finance reporting, permissions and implementation sequence. Documenting entities in a conceptual schema does not by itself mean every workflow is approved for the first release.
- **Current documented position:** Supplier records, purchase orders, goods received, supplier invoices and supplier payments are described as planned capabilities. The database design contains proposed entities for each. It explicitly leaves whether purchase orders, invoices and supplier payments are required in the first operational release or a later phase unresolved.
- **Exact information or approval required:** Mark each capability as required for first release, deferred to a named later phase, or out of scope: supplier directory/onboarding, purchase-order creation/approval, partial goods receipt, supplier invoice recording/matching, supplier payment tracking and procurement reporting. Identify any minimum end-to-end procurement workflow that must work on launch. Do not infer first-release approval solely from the existence of a proposed table.
- **Related architecture document and section:** `README.md` — “Supplier and procurement management” and Phase 6; `docs/architecture/overview.md` — §3.1, §10 and §11; `docs/architecture/database-design.md` — §2.9; `docs/architecture/decisions.md` — ADR-013 and §3.
- **Status:** Pending confirmation

### DMS-DEC-014 — Supplier onboarding and procurement controls

- **Topic:** Required supplier records, purchasing workflow and goods-received controls.
- **Outstanding question:** If procurement is included, what information and documents must be held for each supplier, how are purchases authorised, and how are ordered, invoiced and physically received quantities reconciled?
- **Why it matters:** Supplier and purchase records affect stock valuation, accounts payable, inventory receiving and auditability. A purchase order must not increase stock before goods are physically received and confirmed.
- **Current documented position:** The schema proposes supplier contact records, purchase orders and items, goods receipts/items, supplier invoices and supplier payments. Goods received must create stock movements in the same transaction. Creating a purchase order alone must not add inventory. Required supplier fields/documents, purchase-order approval, invoice matching and exception handling are not defined.
- **Exact information or approval required:** Confirm the required supplier identity/contact fields and supporting documents; whether supplier status/verification is required; who may create/edit/deactivate suppliers; whether every purchase requires a purchase order; the approval path and amount thresholds (coordinate with DMS-DEC-003); how deposits, partial deliveries, over/under-deliveries, damaged goods and invoice/quantity/price differences are handled; and what supplier payment details/references/evidence are recorded. If any control is not needed for the first release, state that explicitly.
- **Related architecture document and section:** `README.md` — “Supplier and procurement management”; `docs/architecture/overview.md` — §3.1 and §10; `docs/architecture/database-design.md` — §2.9 and §5; `docs/architecture/decisions.md` — ADR-013.
- **Status:** Pending confirmation

### DMS-DEC-015 — Cost-price history and stock valuation method

- **Topic:** Historical cost changes and the method used to value inventory.
- **Outstanding question:** Must DMS retain effective-dated cost-price history for each product variant, and which approved costing method should be used for stock valuation and estimated margin reporting?
- **Why it matters:** A current cost price alone cannot necessarily explain historical stock value or margin when supplier costs change. Different costing methods can produce different inventory valuations and profit estimates.
- **Current documented position:** Product variants have a current cost-price field. Order lines snapshot transaction prices. The database design states that stock valuation should use recorded cost snapshots/average-cost policy only after the valuation method is agreed, and explicitly asks whether cost-price changes require effective-dated history. No valuation method is confirmed.
- **Exact information or approval required:** Confirm whether changes to cost price must create immutable, effective-dated history and which user/role may record or approve them. Choose the accounting/operational valuation method required for the first release (or explicitly defer stock valuation reporting until one is selected). Define treatment of freight, duties, discounts, supplier credits, partial receipts and returns in unit cost where relevant. Specify whether historical margin reports use the cost at order time, current cost or another approved basis. Do not assume FIFO, weighted average or standard costing.
- **Related architecture document and section:** `README.md` — “Product records”, “Multi-location inventory and stock management” and “Reports and analytics”; `docs/architecture/overview.md` — §3.1 and §4; `docs/architecture/database-design.md` — §2.4, §2.9 and §6 “Reporting and derived values”; `docs/architecture/decisions.md` — ADR-013.
- **Status:** Pending confirmation

### DMS-DEC-016 — Receipt numbering and issuance triggers

- **Topic:** Human-readable receipt references, numbering scope and the event that issues each receipt type.
- **Outstanding question:** What reference format and sequence rules should be used, and exactly when should an order/purchase receipt versus a payment receipt be issued?
- **Why it matters:** Receipt references are customer-facing financial evidence. Ambiguous issuance triggers or non-unique numbering can create duplicate, missing or misleading receipts, especially for partially paid orders and corrections.
- **Current documented position:** ADR-014 and the database design require an immutable receipt-issuance record with a unique reference, issuer, timestamp, amount/currency and frozen transaction snapshot. Receipt issuance is separate from email delivery; void/reissue events are append-only. The receipt numbering/format and exact business event that triggers an order receipt versus payment receipt remain explicitly unconfirmed.
- **Exact information or approval required:** Confirm the reference format, prefix, sequence scope (for example, business-wide or receipt-type-specific), reset policy if any, uniqueness requirements and whether references must be human-readable. Define the event that issues an order/purchase receipt, the event that issues a payment receipt, whether an unpaid order produces an order confirmation only or a receipt, how partial payments generate receipts, and who may issue/void/reissue. Define customer-facing naming and content requirements. Preserve the immutable issuance snapshot, unique reference and separate email-delivery record already documented.
- **Related architecture document and section:** `README.md` — “Receipts and customer communications” and Phase 4; `docs/architecture/overview.md` — §4.4; `docs/architecture/database-design.md` — §2.6.1 “Receipt issuance records” and §4; `docs/architecture/decisions.md` — ADR-014 and §3.
- **Status:** Pending confirmation

### DMS-DEC-017 — Company-hosted email provider and sending integration

- **Topic:** Verification and selection of the sending method for the official Dscentsation email account.
- **Outstanding question:** Which company-hosted email provider/account is in use, and does it support the SMTP or API method and delivery reporting required by DMS?
- **Why it matters:** Order confirmations, receipts and dispatch/delivery updates must come from the official company identity. An unverified provider or unsupported sending method can cause failed delivery, sender rejection or insecure credential handling.
- **Current documented position:** Use Dscentsation's official company-hosted email identity; do not use staff personal email. ADR-008 proposes a provider-neutral adapter and transactional outbox. The provider, supported SMTP/API method, sender authentication, sending limits, TLS requirements and bounce/delivery visibility must be verified. Credentials must remain backend secrets.
- **Exact information or approval required:** Identify the provider and the actual company mailbox/domain intended for transactional sending; confirm account ownership/access; provide provider documentation or verified settings for SMTP/API endpoint, port/TLS/authentication or API scopes, sender identity and domain authentication, sending quotas/rate limits, bounce/complaint/delivery status capability and any account restrictions. Confirm whether the existing company-hosted account permits automated transactional sending or whether a separate approved sending service is required. Do not share credentials in this document or commit them to GitHub.
- **Related architecture document and section:** `README.md` — “Business context and confirmed decisions”, “Receipts and customer communications” and Phase 0/Phase 4; `docs/architecture/overview.md` — §2, §4.4 and §6; `docs/architecture/decisions.md` — ADR-008 and §3.
- **Status:** Pending confirmation

### DMS-DEC-018 — Private file-storage provider and file-handling limits

- **Topic:** Object-storage provider, region and operational rules for business documents.
- **Outstanding question:** Which private object-storage service and region should be used, and what file types, size limits, scanning, access and lifecycle controls are required?
- **Why it matters:** Receipts, expense evidence, supplier invoices and other documents may contain sensitive business or customer information. Provider choice and retention/lifecycle settings affect privacy, access control, recovery, recurring cost and operational reliability.
- **Current documented position:** ADR-009 proposes private object storage rather than PostgreSQL for file bytes, with metadata in PostgreSQL and backend-authorised short-lived signed URLs. Supabase Storage or an equivalent service is mentioned. Public buckets are prohibited by the proposal. Provider, storage region, retention, backup and lifecycle rules need confirmation; allowed types and size limits must be enforced. Malware scanning is identified as a consideration, not a confirmed requirement.
- **Exact information or approval required:** Accept or revise the private-object-storage approach; select the provider and data region; confirm expected storage volume/traffic and cost constraints; define allowed file formats/content types, per-file and aggregate size limits, upload/download permissions, who may access each document category, whether malware scanning is mandatory and when files become accessible, backup/versioning expectations, lifecycle/deletion rules and any service availability requirements. Coordinate retention periods with DMS-DEC-020. Do not provision storage or create credentials as part of this decision-register task.
- **Related architecture document and section:** `README.md` — “Expense management”, “Security and data integrity” and “Proposed technology”; `docs/architecture/overview.md` — §6 “File storage” and §7; `docs/architecture/database-design.md` — §2.11 “File metadata, email outbox and audit”; `docs/architecture/decisions.md` — ADR-009.
- **Status:** Proposed

### DMS-DEC-019 — Render Postgres backup, recovery and total-cost approval

- **Topic:** Verification of Render Postgres operational safeguards and approval to use it for production.
- **Outstanding question:** Does the appropriate Render Postgres plan meet the business's recovery, availability, capacity, networking and cost requirements, and is it approved for production use?
- **Why it matters:** The database is the system of record for stock, orders, customers, payments and audit history. A backup policy that cannot meet the business's recovery needs or a plan whose total cost is unsustainable creates material operational risk.
- **Current documented position:** Render Postgres is the preferred database candidate, but provisioning production is conditional on verification and approval. ADR-010 explicitly requires backup frequency/retention, point-in-time recovery support and limits, a real restore procedure and test, agreed recovery objectives, region/private networking, connection/capacity limits and total recurring cost. No verification evidence, RPO/RTO values or cost approval is recorded.
- **Exact information or approval required:** Evaluate the relevant Render plan(s) using current provider documentation and a cost breakdown for expected workload. Record backup frequency, retention and availability; PITR eligibility, window and limitations; the exact restore steps and restore-test evidence; proposed and approved Recovery Point Objective (RPO) and Recovery Time Objective (RTO); region and private-network connectivity; storage/compute/connection limits; monitoring/maintenance responsibilities; and monthly/annual total cost including database, backup/recovery-related charges and required frontend/API/worker service tiers. Obtain explicit project-manager/business approval before production provisioning. A preference for Render is not the same as approval to provision it.
- **Related architecture document and section:** `README.md` — “Application architecture and technology status”, “Security and data integrity” and Phase 8; `docs/architecture/overview.md` — §9 “Deployment and operations architecture”; `docs/architecture/database-design.md` — §7 and §8; `docs/architecture/decisions.md` — ADR-010 and §3.
- **Status:** Pending confirmation

### DMS-DEC-020 — Privacy, personal-data handling and retention policy

- **Topic:** Data minimisation, consent, retention, correction/deletion and access policy.
- **Outstanding question:** What personal and business records may DMS collect, for which purposes, for how long, and how should access, correction, deletion or anonymisation requests be handled?
- **Why it matters:** DMS may store customer contact details, order histories, communications metadata, supplier contacts, staff account data, uploaded documents and audit events. Retaining too much data or deleting required transaction history without a controlled process can create privacy, legal and business-record risks.
- **Current documented position:** The architecture says to store only customer information needed for operations, separate marketing consent from transactional communication, preserve consent history, restrict sensitive data and files by permission, keep secrets and production records out of GitHub, and define retention/deletion/correction policy with the business before production. Birthday/preferences and personalised marketing are optional and require separate approval/consent. No exact retention periods, privacy notice, lawful-purpose register or deletion/correction procedure is documented.
- **Exact information or approval required:** Identify the personal-data categories and business purposes needed for the first release; confirm which optional fields are excluded unless separately approved; approve the privacy notice/consent wording and how consent is captured/withdrawn; specify retention periods by record class (customer profiles, order/payment/refund records, receipts, supplier documents, uploaded files, communications metadata, staff/security logs and audit records); define correction, deletion, anonymisation, legal-hold and access-request handling; identify who may approve exceptions; and obtain the required business/legal review for applicable Nigerian and other relevant data-protection obligations. Do not invent retention periods or delete historical records needed for financial/stock accountability.
- **Related architecture document and section:** `README.md` — “Customer management (CRM)”, “Security and data integrity” and Phase 9; `docs/architecture/overview.md` — §6, §7 and §11; `docs/architecture/database-design.md` — §2.3, §7 and §8; `docs/architecture/decisions.md` — ADR-007 and §3.
- **Status:** Pending confirmation

## 3. Outstanding technical and architecture decisions

### DMS-DEC-021 — Approve the first-release modular-monolith architecture

- **Topic:** Application topology and module boundaries.
- **Outstanding question:** Is the proposed single React application, single Node.js/Express API, single PostgreSQL system of record and optional separate background worker the approved first-release architecture?
- **Why it matters:** This choice determines repository structure, deployment shape, transaction boundaries, integration design and operational complexity. The initial foundation already exists, but formal acceptance is still required before expanding the architecture into business modules or provisioning infrastructure.
- **Current documented position:** The Task 005 codebase is a pnpm workspace/monorepo with separate React web and Express API applications, PostgreSQL access and foundation modules. This is consistent with ADR-001's modular-monolith proposal, but ADR-001 remains Proposed. No background worker, email service, file-storage service, Render service or production environment has been provisioned.
- **Exact information or approval required:** Formally accept or revise the modular-monolith proposal; confirm first-release module boundaries and whether the email/reservation worker should be introduced only when asynchronous/retryable work requires it or deployed earlier. Record any deviation and its reason. Do not infer approval from the existing code structure or introduce microservices/infrastructure by assumption.
- **Related architecture document and section:** `README.md` — “Application architecture and technology status” and “Current project position”; `docs/architecture/overview.md` — §3 “Target application architecture beyond the foundation”, §3.2 and §10; `docs/architecture/decisions.md` — ADR-001.
- **Status:** Proposed

### DMS-DEC-022 — Approve frontend toolchain details

- **Topic:** TypeScript and Vite for the React web frontend.
- **Outstanding question:** Are TypeScript and Vite approved implementation choices for the already-confirmed React frontend?
- **Why it matters:** The language/build-tool choice affects project scaffolding, type-checking, build output, test tooling and contributor conventions.
- **Current documented position:** The merged `apps/web` implementation uses React 19.3.0, TypeScript 6.0.3 and Vite 8.3.5. Its current scope is the sign-in screen and initial authenticated application shell, not the business modules. React remains the established frontend framework; TypeScript and Vite are adopted in code but remain Proposed in ADR-002 pending formal ratification.
- **Exact information or approval required:** Formally accept TypeScript and Vite as the implementation choices already present, or specify whether and why they should change before further frontend work. The existing code is evidence of adoption, not approval. This is not a request to reopen the React framework choice.
- **Related architecture document and section:** `README.md` — “Application architecture and technology status”; `docs/architecture/overview.md` — §3.1 “Frontend — React”; `docs/architecture/decisions.md` — ADR-002.
- **Status:** Proposed

### DMS-DEC-023 — Approve API implementation and contract details

- **Topic:** TypeScript, REST interface and API versioning for Node.js/Express.
- **Outstanding question:** Are TypeScript and a versioned JSON REST API under `/api/v1` approved implementation details for the already-confirmed Node.js/Express backend?
- **Why it matters:** The API contract determines client/server boundaries, validation, error formats, API documentation and compatibility for later approved integrations.
- **Current documented position:** The merged API uses Node.js 26.13.0, Express 5.3.0 and TypeScript 6.0.3, with a JSON API under `/api/v1`. Current routes cover health and foundation authentication/session/capability operations only; no business or public customer routes exist. TypeScript and the versioned REST contract are adopted in code but remain Proposed in ADR-003 pending formal ratification.
- **Exact information or approval required:** Formally accept or revise the TypeScript and versioned REST API details now used in the foundation, including the API's internal-only boundary and API documentation format. Record reasons for any requested change. Do not infer that website-order ingestion or a public customer API is included.
- **Related architecture document and section:** `README.md` — “Application architecture and technology status” and “Scope and boundaries”; `docs/architecture/overview.md` — §3.2 “Backend — Node.js and Express”; `docs/architecture/decisions.md` — ADR-003.
- **Status:** Proposed

### DMS-DEC-024 — Ratify database access and migration tooling

- **Topic:** Formal ratification of the database access and migration tooling already adopted in Task 005.
- **Outstanding question:** Should the existing explicit-SQL `pg` and `node-pg-migrate` implementation be accepted as the project's database access/migration convention, or should a reviewed alternative be selected before further schema work?
- **Why it matters:** The choice affects schema evolution, transaction handling, parameterised query safety, type generation, testability and how critical stock/finance invariants are enforced.
- **Current documented position:** Task 005 uses PostgreSQL through `pg` 8.23.1, explicit parameterised SQL, and `node-pg-migrate` 9.0.0; no ORM is included. Transactions are used for implemented multi-step operations such as Owner bootstrap and login metadata/audit writes. The initial migration creates only the eight foundation tables, and CI tests against disposable PostgreSQL 17. These are adopted codebase choices; ADR-004 and DMS-DEC-024 retain their existing review status.
- **Exact information or approval required:** Formally ratify the existing `pg`/explicit SQL/`node-pg-migrate` approach and its conventions for SQL ownership, parameterisation, transactions, constraints, migration review and type maintenance, or record a justified alternative and migration plan. Do not assume an ORM or weaken database integrity requirements; do not replace reviewed migrations with manual production schema edits.
- **Related architecture document and section:** `README.md` — “Application architecture and technology status” and Phase 1; `docs/architecture/overview.md` — §3.3 “Database — PostgreSQL”; `docs/architecture/database-design.md` — §1, §4 and §5; `docs/architecture/decisions.md` — ADR-004.
- **Status:** Pending confirmation

### DMS-DEC-025 — Multi-factor authentication policy for privileged accounts

- **Topic:** Whether MFA is required for Owner and Manager accounts.
- **Outstanding question:** Must Owner and/or Manager accounts use multi-factor authentication in the first release, and which MFA method(s) are acceptable?
- **Why it matters:** These roles can access business-wide stock, customer information, financial records and privileged administration. Password-only access may not meet the business's risk tolerance.
- **Current documented position:** The foundation implements Argon2id password hashes, provisioned accounts, PostgreSQL-backed sessions, cookie/CSRF protections and session rotation/revocation. MFA has not been implemented and no MFA method or requirement is documented. ADR-007 leaves privileged-account MFA as a separate security-policy decision.
- **Exact information or approval required:** Decide whether MFA is mandatory for Owner, Manager, both or neither in the first release. If required, approve acceptable methods, enrolment/recovery procedures, lost-device handling, enforcement timing and whether sensitive actions require re-authentication. Identify any exception authority and audit requirements. Do not assume an MFA provider or method.
- **Related architecture document and section:** `docs/architecture/overview.md` — §5 “Authentication and authorisation” and §7; `docs/architecture/database-design.md` — §2.1; `docs/architecture/decisions.md` — ADR-007.
- **Status:** Pending confirmation

### DMS-DEC-026 — Session lifetime and re-authentication policy

- **Topic:** Idle timeout, absolute session lifetime and sensitive-action re-authentication.
- **Outstanding question:** How long may an authenticated session remain active, and when must a user authenticate again?
- **Why it matters:** Persistent sessions support reliable use across application restarts, but unlimited or poorly controlled sessions increase the impact of an unattended or compromised device.
- **Current documented position:** The foundation implements PostgreSQL-backed sessions, HttpOnly/SameSite cookies, production Secure-cookie enforcement, login rotation, logout/revocation, idle expiry and an absolute session-age check. The code's non-production fallbacks/examples include 30-minute idle and 12-hour absolute values; production requires explicit configured values, but none are business-approved. Login throttling is process-local. High-risk-action re-authentication and concurrent-session policy remain unresolved.
- **Exact information or approval required:** Approve idle and absolute session lifetimes, behaviour on inactivity, concurrent-device/session policy, logout/revocation expectations, password-reset/account-suspension invalidation, and whether re-authentication is required for high-risk operations such as payment verification, refunds, exports or user/permission changes. Confirm how long-lived sessions are managed for the Owner's remote oversight. Preserve PostgreSQL-backed session storage and the prohibition on production in-memory fallback.
- **Related architecture document and section:** `docs/architecture/overview.md` — §5; `docs/architecture/database-design.md` — §2.1 and §7; `docs/architecture/decisions.md` — ADR-007.
- **Status:** Pending confirmation

### DMS-DEC-027 — Approve test strategy and CI quality gates

- **Topic:** Test layers, tooling and minimum pull-request/deployment gates.
- **Outstanding question:** Is the proposed test pyramid and transaction-invariant coverage approved, and which test/check results are mandatory before merge and deployment?
- **Why it matters:** Stock reservations, transfers, payments and permissions have important concurrency and audit requirements. A testing strategy that omits database-backed or end-to-end checks may miss defects that unit tests or visual checks cannot detect.
- **Current documented position:** The merged CI workflow runs Prettier, ESLint, TypeScript checks, Vitest, Supertest and React Testing Library; API integration/security tests use disposable PostgreSQL 17. CI verifies migration application, role/permission seeds and replay, production-mode `up`, the production rollback guard, disposable rollback/reapplication, schema checks, workspace tests, production builds and patch whitespace. Playwright is not present in the manifests/workflow; complete end-to-end journeys and future inventory/financial concurrency invariants are not covered because those modules do not exist. ADR-011 remains Proposed; exact tools are implemented but the broader test-strategy approval and gate policy remain open.
- **Exact information or approval required:** Formally accept or revise the test layers/tooling already implemented; identify mandatory checks for pull requests, protected branches and production release; define future database-backed coverage for reservations, dispatch, transfers, payment verification, refunds and permission boundaries; and state who may approve an exception when a check cannot run. Keep all test data synthetic. Do not treat planned tests as passing evidence.
- **Related architecture document and section:** `README.md` — “Security and data integrity” and Phase 8; `docs/architecture/overview.md` — §8 “Testing architecture” and §9; `docs/architecture/decisions.md` — ADR-011.
- **Status:** Proposed

### DMS-DEC-028 — Approve financial event and reporting model

- **Topic:** Separation of sales, payments, refunds, expenses and cost snapshots in financial reporting.
- **Outstanding question:** Is the proposed financial event model accepted, including how verified receipts, refunds, outstanding balances and estimated profitability are derived for reports?
- **Why it matters:** Order value is not equivalent to money received, and an unverified payment or an unrecorded refund can distort balances and profitability. Reports need a consistent and auditable calculation basis.
- **Current documented position:** ADR-013 still proposes separate order totals, payment events, refunds, expenses and cost snapshots. Task 005 only seeded the `payments.record` and `payments.verify` permission codes with role mappings; the eight-table foundation contains no orders, payments, refunds, expenses or cost tables and the API has no financial workflow routes. No financial event/reporting model has been implemented. The broader model remains Proposed.
- **Exact information or approval required:** Accept or revise the separation of these financial records and event history; confirm the calculation basis for paid/part-paid/refunded balances, treatment of partial refunds and reversals, recognition date for sales versus cash receipts, and the distinction between gross sales, verified cash received, expenses, product costs and estimated profit. Coordinate cost valuation with DMS-DEC-015. Any alternative must preserve original financial events and must not treat unverified payment entries as verified receipts.
- **Related architecture document and section:** `README.md` — “Sales and payment tracking”, “Reports and analytics” and “Security and data integrity”; `docs/architecture/overview.md` — §4.3; `docs/architecture/database-design.md` — §2.7, §5 and §6; `docs/architecture/decisions.md` — ADR-013.
- **Status:** Proposed

## 4. Confirmed decisions and fixed architecture boundaries intentionally excluded

The following matters are not outstanding questions in Task 004. They are recorded here only so that the register does not cause them to be re-opened. Their existing source documents remain authoritative.

| Confirmed area | Current documented decision | Reference |
|---|---|---|
| Manual product ownership and initial product scope | Products are created and maintained manually in DMS. No bulk website catalogue import, catalogue synchronisation or public storefront is included in the initial scope. | `README.md` — “Business context and confirmed decisions” and “Scope and boundaries”; ADR-012. |
| Multi-location stock model | Stock is tracked by product variant and location, with separate physical balances, an append-only stock movement ledger and separate in-transit quantities. | ADR-005; `docs/architecture/database-design.md` — §2.5. |
| Order fulfilment location | Each first-release order has exactly one fulfilment location; cross-location split fulfilment is not supported. Insufficient stock must not be silently sourced from another location. | ADR-015; `docs/architecture/overview.md` — §4.1. |
| Reservation timing | Required stock is reserved immediately when an order is confirmed, whether unpaid, partially paid or paid. The policy must be persisted and versioned; policy changes apply to new reservations, and an existing expiry change requires an authorised, audited action. | ADR-005; `docs/architecture/overview.md` — §4.1. |
| Transfer destination receipt | For standard transfers, a Staff user assigned to the destination confirms physical receipt. Partial receipt leaves the remainder in transit. The separate assigned-Store-Manager exception for the dedicated Ajose Warehouse-to-Sheraton Store workflow is recorded as Task 010 planning direction below, pending formal confirmation. | ADR-005 and ADR-006; `docs/architecture/overview.md` — §4.2. |
| Location visibility, direct editing and cross-location approval — **Task 010 planning direction; pending formal confirmation under DMS-DEC-001/002** | All authorised operational users are intended to have read-only visibility of both Ajose Warehouse and Sheraton Store dashboards, stock quantities and availability. Non-Owner direct stock-changing operations are limited to the user's assigned location. A non-Owner request affecting the other location enters Pending Approval and routes to an authorised approver at the destination location. The Owner may operate directly at either location and may review another user's pending request. The consolidated financial overview across both locations (total money in, total money out, revenue, expenses and profit/loss) is Owner-only. The assigned Store Manager using the existing Manager role is eligible for the dedicated Ajose Warehouse-to-assigned-Sheraton pickup and destination-receipt actions only when the active Sheraton assignment and explicit action permission pass. The generic Manager role does not grant unrestricted cross-location stock editing. This row records planning direction only; it is not formal business-owner approval evidence. | ADR-006 / ADR-016 as amended by Task 010; DMS-DEC-001 and DMS-DEC-002 remain Pending confirmation. |
| Payment entry versus verification | Staff may record payment entries. Only Manager and Owner may verify them; unverified entries are excluded from verified-receipts reporting. | ADR-006 and ADR-013; `docs/architecture/overview.md` — §4.3 and §5. |
| Sheraton-to-Warehouse pickup and destination receipt safeguards | The dedicated physical pickup is limited to the exact Ajose Warehouse-to-assigned-Sheraton transfer and requires an active destination assignment plus explicit action permission. It remains separate from cross-location stock-change approvals. Source dispatch, in-transit accounting, separate destination receipt, partial operations, distinct actor/timestamp attribution, idempotency and discrepancy resolution remain mandatory. It confers no general Warehouse write access. | ADR-016; `docs/architecture/overview.md` — §4.2.1; `docs/architecture/database-design.md` — §2.5. |
| Receipt issuance architecture | A receipt issuance is an immutable business record with a unique reference and frozen transaction snapshot; void/reissue actions are recorded as events. Receipt issuance is separate from email delivery. The numbering format and issuance triggers remain open under DMS-DEC-016. | ADR-014; `docs/architecture/database-design.md` — §2.6.1. |
| Individual accounts and persistent sessions | Individual invited accounts and PostgreSQL-backed persistent sessions are required. Production must not fall back to in-memory session storage. The MFA and lifetime policies are separate open items under DMS-DEC-025 and DMS-DEC-026. | ADR-007; `docs/architecture/overview.md` — §5. |
| Product catalogue integrations | Website product-catalogue import/synchronisation is outside the agreed initial scope. Website orders may be entered manually. | `README.md` — “Scope and boundaries”; ADR-012. |

The Task 010 row above records supplied planning direction and is deliberately labelled as pending formal confirmation; it does not create a new Confirmed decision or change either decision status. The other rows preserve existing confirmed business rules and fixed architecture boundaries. No formal approver, approval date or evidence reference has been supplied for the new direction. Any later formal approval must be recorded through a separately reviewed decision update.

## 5. Summary by confirmation owner

The source documents do not assign named decision owners. The groupings below identify the kind of confirmation required; they do not appoint an individual.

| Confirmation area | Decision IDs | What is needed |
|---|---|---|
| Business owner / operations | DMS-DEC-001, 003–016 | Location/assignment facts; role and approval rules; operational payment, order, reservation, transfer, returns/refunds, procurement, cost, and receipt policies. |
| Business and technical coordination | DMS-DEC-002, 020 | Permission matrix and privacy/data-retention rules must be agreed by the business and reflected in backend/data controls. |
| Email / storage / hosting verification | DMS-DEC-017–019 | Verify the company email account, select/approve private storage settings, and evidence Render Postgres recovery/cost suitability before production provisioning. |
| Technical architecture / project-manager review | DMS-DEC-021–028 | Accept or revise the modular monolith, frontend/API implementation details, database tooling, security/session policy, test strategy and financial model. |

### Status count

| Status | Count |
|---|---:|
| Pending confirmation | 22 |
| Proposed | 6 |
| Confirmed outstanding decisions | 0 |
| **Total outstanding entries** | **28** |

A count of zero in the Confirmed row is intentional: already-confirmed decisions are excluded from the outstanding decision list and referenced in §4 rather than duplicated as active decision work.

## 6. Register maintenance and decision recording

1. Keep the existing architecture documents and ADRs as the authoritative source for their current content. This register does not silently amend them.
2. When a decision is made, record the exact answer, approver or source of authority, and approval date in the appropriate project decision record/ADR or requirements document. Then update this register's status and reference in a separately reviewed documentation change.
3. Do not mark an item Confirmed on the basis of an assumption, an unreviewed suggestion or the existence of a proposed schema/table.
4. If new evidence shows that a question is already answered, cite that evidence and remove it from the outstanding list through a reviewed update; do not preserve duplicate work.
5. If business and technical documents conflict, record the conflict and request a decision. Do not select one version silently.
6. No item in this register authorises application code, migrations, service provisioning, credentials, deployment or production data use.

**Register status:** Implementation-aware register; the outstanding business and technical decisions remain open at their recorded statuses.
**Implementation status:** The initial Task 005 application foundation was approved and merged into `main` through PR #7. This register does not approve unratified architecture choices, the complete business schema/permission matrix, business modules, infrastructure, integrations or deployment, and it does not authorise new implementation work by itself.
