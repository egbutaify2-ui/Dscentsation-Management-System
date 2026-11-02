# DMS Task 009 — Inventory Implementation Readiness & Decision Pack

**Document status:** Task 009 readiness deliverable, updated by Task 010 planning-direction reconciliation; independent review of Task 010 remains pending
**Implementation status:** Inventory feature implementation has not started; Task 010 does not authorise it
**Evidence baseline:** adb0258d463d6337d99f76ef1bb7d7abf5749b21
**Scope:** Readiness assessment and decision worksheet only. This document does not approve, implement or provision inventory functionality.

## 1. Purpose and current project position

This pack establishes the verified repository baseline and the decisions required before Dscentsation begins multi-location inventory and stock management. The Task 010 update reconciles the supplied Ajose Warehouse/Sheraton Store operating model, shared operational visibility, location-scoped direct editing, cross-location approval and Owner-only financial overview with the architecture. It separates executable database/code evidence from planning direction, formal approval evidence and conceptual architecture entities.

The assessment is based on the required starting commit, which is also the observed main HEAD at inspection time. Tasks 007 (Product Management, PR #9) and 008 (Employee Account Administration, PR #10) are merged. The Task 008 merge commit is a582a55b81d253fa84feb29a81932ec7843a2d97. The required baseline includes the post-merge documentation reconciliation.

Task 009 is deliberately a readiness task. It does not authorise inventory feature work. No inventory migration, API, UI, balance calculation, opening-stock record, location record or employee assignment is introduced by this pack. The project manager/business owner must answer the worksheet, record the approval evidence in the appropriate project records, and independently review the implementation plan before inventory development is authorised.

**Current implementation position:** the repository contains the application foundation, Product Management and Employee Account Administration. It has physical location and location-access tables plus reusable access-check helpers, but does not yet contain an executable inventory domain. Product variants exist and are ready to be referenced by a future inventory model; stock balances and stock history do not.

## 2. Verified existing implementation

### 2.1 Migration and database evidence

The complete migration directory at the evidence baseline contains exactly three migration files:

| Migration | Executable result |
|---|---|
| **001_initial_foundation.js** | Eight foundation tables: **roles**, **permissions**, **role_permissions**, **users**, **locations**, **user_location_access**, **user_sessions** and **audit_logs**. |
| **002_product_management.js** | Three product tables: **product_categories**, **products** and **product_variants**. |
| **003_employee_account_administration.js** | One new table, **user_invitations**, plus the invited user status and last-active-Owner / no-hard-delete protections. |

There are twelve physical application tables after the three migrations. No migration creates inventory balances, stock movements, reservations, reservation policies, transfer headers/items, pickup/receipt events, in-transit balances, stock counts or reconciliation records.

The existing **locations** table stores a location code, name, optional address/contact fields, active state and timestamps. The existing **user_location_access** table stores a user/location assignment and the user who granted it. **Neither table is seeded with real physical locations or employee assignments.** Task 010 planning direction identifies Ajose Warehouse (main warehouse/stock holding) and Sheraton Store (customer-facing walk-in retail), but no codes, addresses, UUIDs, real location records or account-to-location mappings are introduced. The foundation migration explicitly avoids inventing or seeding locations.

The existing **audit_logs** table has database triggers rejecting UPDATE, DELETE and TRUNCATE. It is an audit foundation, not a stock movement ledger. The existence of the location and audit tables does not mean that inventory operations are implemented.

### 2.2 Existing location and permission code

The executable code already provides the following reusable foundations:

- **canAccessStockLocation** at the inspected baseline grants Owner and the generic Manager role global location access and checks an active **user_location_access** assignment for Staff. This is existing Task 005 implementation evidence, not the revised target authorisation model supplied for Task 010.
- **requireStockLocationAccess** is available as backend middleware for a location-scoped API action.
- **canUseWarehouseSheratonPickup** is a narrow authorisation helper at the inspected baseline. It checks the Staff role, the dedicated pickup permission, the configured Warehouse source, a configured Sheraton destination and the Staff member's assignment to that destination. The Task 010 target model requires an explicitly authorised Store Manager using the existing Manager role to be eligible when the destination assignment and action permission pass; the current Staff-role-only helper therefore requires later reviewed implementation reconciliation. Its source comment states that canonical location IDs must come from trusted configuration and that the foundation does not invent or seed physical locations.
- **requirePermission** enforces seeded permission codes on the backend.

These are access-control primitives, not location administration or stock-transfer functionality. They do not implement shared operational read visibility, assignment-scoped direct changes for the Manager role, cross-location approval requests or the Owner-only financial overview. There is no API route to create/edit/deactivate locations or grant/revoke employee location assignments. The API application currently mounts authentication, user administration and Product Management routes; it does not mount an inventory or location-administration module. The web feature tree has authentication, dashboard, products and users features; it has no inventory or locations feature.

The foundation migration seeds four permission codes: **payments.record**, **payments.verify**, **inventory.transfer.receive_destination_assigned** and **inventory.transfer.pickup_warehouse_to_assigned_sheraton**. The two inventory codes are capability seeds only; no corresponding transfer/receipt workflow exists. The current foundation assigns the two narrow inventory action permissions to Staff. No new role code or permission seed is introduced by Task 010. The target model requires explicit action permission and destination assignment checks that also permit the assigned Store Manager using the existing Manager role; the existing helper/seed arrangement must be reconciled in a later reviewed implementation task.

Task 007 adds six **products.*** permissions to Owner only. Task 008 adds **users.view** and **users.manage** to Owner only. Those product/user permissions do not settle the complete module permission matrix: DMS-DEC-002 remains pending.

### 2.3 Product and variant implementation

Task 007 implements manual product categories, products and variants, including:

- Product/category create, read, update and archive/deactivate operations through authenticated API routes.
- Product and variant validation in the API boundary.
- Parameterised SQL and transaction-backed service operations.
- Actor-attributed audit events for product/category/variant lifecycle changes.
- Product and variant database integrity controls, including no hard delete, no variant reparenting, and exactly one default variant per product.
- A product is created together with its initial variant. A product with no meaningful real-world variants can therefore use its single default variant as the stockable item key.

The implemented variant fields include unit of measure, SKU where used, current selling price, current cost price, currency, active state and default-variant state. There is no stock quantity on the product or variant, no cost-price history, and no inventory valuation calculation.

### 2.4 API, frontend, tests and delivery conventions

The repository is a pnpm workspace with separate React web and Node.js/Express API applications. The API uses TypeScript, Express, versioned JSON routes under /api/v1, Zod request validation, authentication/permission middleware, explicit parameterised PostgreSQL SQL through pg, and node-pg-migrate migrations. No ORM is present in the implemented foundation.

Product and employee services use transaction wrappers and write audit events in the same transaction as the protected business change. API tests use Vitest, Supertest and disposable PostgreSQL; frontend tests use Vitest and React Testing Library. The GitHub Actions workflow checks formatting, ESLint, TypeScript, migrations/schema seeds, API integration/security tests, frontend tests, workspace tests and production builds.

No production database, inventory worker, production inventory service, stock data store, or stock-specific infrastructure is evidenced by these migrations and application modules. CI's PostgreSQL instance is disposable test infrastructure with synthetic records, not a production database.

### 2.5 Executable implementation matrix

| Capability | Verified status at the baseline | Evidence / boundary |
|---|---|---|
| Location records | **Table exists; no real records seeded.** | Migration 001 creates locations; no location seed. |
| Staff location assignments | **Table and read-time access checks exist; no assignments seeded and no administration workflow.** | Migration 001, location-access.service.ts; no location/user assignment routes or UI. |
| Product records | **Implemented.** | Migration 002 and Product Management API/UI. |
| Product variants | **Implemented.** | Migration 002 and Product Management API/UI; one default variant is enforced. |
| Inventory balances | **Not implemented.** | No migration/table or production balance calculation. |
| Stock movement ledger | **Not implemented.** | audit_logs is not a stock ledger; no stock movement table or workflow. |
| Stock reservations | **Not implemented.** | No reservation table, service, policy or expiry worker. |
| Reservation policies | **Not implemented.** | Versioning and policy persistence are conceptual requirements only. |
| Stock transfers | **Not implemented.** | No transfer tables, endpoints, services or UI. |
| Pickup and destination receipt events | **Not implemented.** | Only narrowly scoped permission/access helper foundations exist; no event tables or movement workflows. |
| Stock counts and reconciliation | **Not implemented.** | No count/count-item tables, API, UI or reconciliation process. |

### 2.6 What the architecture documents describe but PostgreSQL does not yet contain

The database design describes a target inventory model, including **inventory_balances**, **stock_movements**, **stock_reservations**, **reservation_policies**, **stock_transfers**, **stock_transfer_items**, pickup event/item tables, receipt event/item tables, discrepancy events, **stock_in_transit_balances**, **stock_counts** and **stock_count_items**. These are **conceptual entities only**. They are not present in the three migrations and must not be reported as existing tables.

The same distinction applies to conceptual orders and order items referenced by reservations. The order, customer and procurement schemas are not physically migrated either. Inventory cannot be integrated with an executable order workflow until those dependencies are designed and implemented in their approved sequence.

## 3. Confirmed inventory business rules

The following requirements are confirmed and must be preserved. They are not reopened by Task 009.

### 3.1 Product and stock identity

- Products are created and maintained manually inside DMS.
- No website catalogue import, scraping or synchronisation is in scope.
- Inventory is keyed by product variant and physical stock location.
- Every product must retain one default variant. Where there is no meaningful variant distinction, that default variant remains the consistent stockable key.
- Warehouse and Sheraton remain separate physical stock locations and separate balances.

### 3.2 Stock accounting

- **On-hand** is the physical quantity recorded at a location.
- **Reserved** is quantity committed to confirmed orders but not yet dispatched.
- **Available** is on-hand less reserved.
- Stock in transit is separate from the physical balances and is not available at either the source or destination location.
- A stock operation must not silently cause physical on-hand to become negative.
- A reservation must not exceed available quantity at the selected fulfilment location.
- Critical changes to stock, reservations and transfers require database transactions, concurrency protection and attributable audit events.
- The stock movement ledger is the historical evidence of quantity changes. Balance tables, including in-transit balances, are current-state projections maintained transactionally from those events.

### 3.3 Orders and reservations

- Each first-release order has exactly one fulfilment location. Cross-location split fulfilment is not supported.
- When an order is confirmed, its required stock is reserved immediately at that one location, whether the order is unpaid, partially paid or paid.
- A reservation cannot exceed available stock at the order's selected fulfilment location. The backend must not silently source shortages from another location.
- Reservation expiry must be configurable and persisted. Every reservation retains the policy version and expiry applied when it was created.
- A reservation-policy change applies to new reservations. An existing reservation retains its original policy and expiry unless an authorised, explicit change is made and audited.
- Expiry does not cancel an order and does not reduce physical on-hand. It releases eligible reserved quantity and places the order on fulfilment hold/reconfirmation as specified by ADR-005.
- Reservation creation, extension, release, expiry and dispatch consumption must be transactional and must not double-consume or double-release the same reservation.

### 3.4 Ajose Warehouse-to-Sheraton Store pickup and receipt — preserve the amended ADR-016 controls

Ajose Warehouse and Sheraton Store are separate physical locations with separate balances. The Task 010 planning direction permits shared read-only operational visibility of both locations; it does not grant cross-location direct editing. A non-Owner's direct stock-changing actions remain assigned-location scoped, except for the narrowly defined pickup/receipt actions below.

- An operational user assigned to Sheraton and holding the explicit pickup action permission may create/open a transfer only from Ajose Warehouse to that assigned Sheraton Store. The existing Manager role is eligible when the active destination assignment and explicit action permission pass; eligibility must not depend exclusively on the literal Staff role.
- The assigned Store Manager and other authorised operational users may view Warehouse quantities/availability through the shared operational read surfaces. Shared visibility does not grant general Warehouse receiving, adjustment or unrelated transfer write permissions.
- The pickup command validates the exact source/destination, destination assignment, explicit permission, transfer state and submitted quantities against current Warehouse available stock inside the transaction. It must not partially post a failed event.
- Pickup atomically reduces Warehouse on-hand and increases the transfer-item-specific in-transit quantity by the same amount.
- Destination receipt is separate and is performed by an authenticated user assigned to Sheraton with the explicit destination-receipt permission. The existing Manager role is eligible when those checks pass. Receipt atomically reduces in-transit and increases Sheraton on-hand.
- Standard transfers, dedicated pickup and destination receipt keep their separate workflows and do not enter the additional cross-location stock-change approval queue.
- Partial pickup and partial receipt are supported. Unpicked requested quantities remain open; unreceived quantities remain in transit.
- Pickup and receipt events preserve individual authenticated actors and timestamps. The same person may perform both actions, but the events and attribution remain separate.
- Idempotency prevents retries from creating duplicate pickup/receipt events or stock movements. Reusing an idempotency key with a different payload is rejected.
- Discrepancies preserve quantity, reason, reporter and time. Unresolved discrepancies remain visible and must not be hidden by silent balance changes or transfer cancellation.
- Picked quantity cannot be automatically expired, silently restored to Warehouse or erased by cancellation. A return must be a separately recorded reverse transfer; any other outcome requires an authorised, recorded discrepancy resolution.
- The exact physical paperwork/reference accompanying collection is not confirmed; DMS-DEC-010 must answer that without weakening the transfer controls.

## 4. Inventory domain entities and relationships

This section distinguishes existing entities from proposed inventory entities.

### 4.1 Existing physical entities reused by inventory

| Existing entity | Role in the future inventory model |
|---|---|
| **locations** | Physical location master record. Table exists; approved Warehouse/Sheraton records are not yet supplied or seeded. |
| **user_location_access** | Staff-to-location assignment. Table exists; assignment records and administration workflow are not present. |
| **users**, **roles**, **permissions**, **role_permissions** | Authenticated actors and backend permission checks. Existing role/permission seed is intentionally incomplete. |
| **audit_logs** | Append-only security/business audit foundation. Future stock commands must write attributable events transactionally. |
| **products**, **product_variants**, **product_categories** | Manually maintained catalogue and stockable variant identity. Tables and Product Management are implemented. |

### 4.2 Proposed inventory entities — not migrated

| Conceptual entity | Intended responsibility and relationship |
|---|---|
| **Inventory balance** | One current physical projection per location and product variant, uniquely keyed by (location_id, product_variant_id); holds on-hand, reserved and any approved reorder threshold. It excludes in-transit quantity. |
| **Stock movement** | Append-only quantity event for a physical location or transfer-specific in-transit bucket. Links the product variant, movement type, quantity delta/before/after where used, reason/reference, actor, database timestamp and idempotency key. It is the historical stock evidence. |
| **Stock reservation** | Commitment for an order item, variant, quantity and its one fulfilment location. References the exact reservation policy version and expiry applied, plus its lifecycle/release/consumption state. |
| **Reservation policy** | Persisted, versioned configuration for enabled/disabled expiry, duration and eligibility scope. A policy edit creates a new version for future reservations. |
| **Stock transfer and transfer item** | Transfer header linking distinct source/destination locations, mode and lifecycle; item rows hold requested, dispatched/picked, received, cancelled and formally resolved quantities. |
| **Pickup event and event items** | Immutable record of each physical Warehouse pickup, with source/destination, actor, timestamp, idempotency identity and product quantities. Used only for the ADR-016 destination-Staff pickup mode. |
| **Receipt event and event items** | Separate immutable record of each destination receipt, with destination, actor, timestamp, idempotency identity, quantities received and any reported discrepancy. |
| **Discrepancy event** | Attributed report and authorised resolution history for shortage, damage, loss or other approved transfer discrepancy. An unresolved quantity remains visible. |
| **In-transit balance** | Current projection per transfer item, product variant, source and destination. It is reduced only by confirmed receipt or approved, recorded resolution/return. |
| **Stock count and count item** | Physical count session scoped to a location, with system quantity, observed quantity, counter/reviewer attribution, differences and resulting approved reconciliation events. No count or reconciliation workflow currently exists. |

### 4.3 Relationships and accounting boundaries

A product has one or more variants; each variant can have a separate inventory balance at each physical location. The balance is not stored on the product master record.

A confirmed order has one fulfilment location and order items. Each order item may create a reservation for its variant at that same location. Dispatch consumes the reservation and decreases on-hand in one transaction.

A transfer has one or more transfer items. Dispatch/pickup moves quantity from the source's physical on-hand bucket into that transfer item's in-transit bucket. Receipt moves physically received quantity from in-transit into the destination's physical on-hand bucket. A discrepancy is not a receipt and does not make unaccounted quantity available.

A stock movement ledger explains how the projections changed. Reconciliation must be able to compare the projections with the ledger; ordinary corrections use reversal/adjustment events, not edits to past movements.

Opening stock is not present in the repository. It must be introduced only through a separately approved, attributable opening-stock process after the physical inventory has been verified. No quantities or opening movements may be fabricated to make the first balance display appear complete.

## 5. Outstanding business decisions and decision worksheet

All seven decisions below remain **Pending confirmation** in the existing decision register. The Task 010 planning direction does not change those statuses and is not formal business-owner approval evidence. Each decision must be completed with an approval source and date; a planning statement, suggested option or existing schema description is not approval.

### DMS-DEC-001 — Canonical physical stock locations and role-based assignments

**Current status:** Pending confirmation

**Business direction supplied for Task 010 (not formal business-owner approval evidence):** The two initial operating stock locations are Ajose Warehouse (main warehouse and stock holding location) and Sheraton Store (customer-facing walk-in retail store), each with an independent physical balance. The Owner has authority across both. The existing Manager role is used for the Sheraton Store Manager and is assigned to Sheraton. Three Warehouse Staff accounts are assigned to Ajose Warehouse. All authorised operational users are intended to have read-only operational visibility of both locations. Non-Owner direct stock-changing operations are scoped to the assigned location, with other-location requests routed through DMS-DEC-002 approval rules. No employee names, email addresses, account IDs or credentials belong in this public repository.

**Still unanswered:** Approved unique location codes; addresses or other identifying details needed to disambiguate the physical sites; canonical location record IDs; actual secure employee-account-to-location mappings; who is authorised to establish, grant, change, temporarily vary and revoke assignments; and the formal approval evidence for this operating model. No code, address, UUID or employee mapping has been invented.

**Why it affects implementation:** Location IDs anchor balances, receiving, transfers, order fulfilment and every location-access check. Incorrect codes or assignments can direct stock to the wrong balance or expose a location to the wrong user. The dedicated pickup/receipt actions cannot be enabled safely until the canonical endpoints and assigned destination accounts are established.

**Exact information / approval required:**

1. Approve unique codes and any required address/identifying details for Ajose Warehouse and Sheraton Store.
2. Identify the canonical Ajose Warehouse source record and Sheraton Store destination record.
3. Establish the actual employee-account-to-location mappings privately through an authorised secure process; do not copy personal details into this repository.
4. Approve the role/person authorised to grant, change, temporarily vary and revoke each assignment, including required reasons and audit evidence.
5. Record the formal business-owner approval source, date and reference for the supplied location/assignment model.

**Governing sources:** README — Business context, Inventory rules and Phase 0; Architecture Overview §§4.2, 4.2.1 and 5; Database Design §§2.1–2.2; ADR-005, ADR-006 and ADR-016; Decision Register DMS-DEC-001.

**Project manager / business owner response (complete before approval):**

- Approved location names and purposes: **Ajose Warehouse — main warehouse/stock holding; Sheraton Store — customer-facing walk-in retail** (planning direction supplied; formal approval evidence pending)
- Approved unique location codes: **[To be completed]**
- Canonical Warehouse/Sheraton records and IDs: **[To be completed]**
- Secure employee-account-to-location mappings: **[To be configured privately; no personal details in this repository]**
- Assignment authority and grant/change/revocation process: **[To be completed]**
- Formal approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### DMS-DEC-002 — Detailed role, location and financial-visibility permission matrix

**Current status:** Pending confirmation

**Business direction supplied for Task 010 (not formal business-owner approval evidence):**

- **Shared operational visibility:** Authorised operational users use the same operational dashboards and can view both Ajose Warehouse and Sheraton Store dashboards, stock quantities and availability, plus shared information needed for day-to-day stock management.
- **Location-specific direct editing:** Ajose Warehouse Staff directly perform normal authorised stock-changing operations at Ajose Warehouse. The Sheraton Store Manager using the existing Manager role directly performs normal authorised stock-changing operations at Sheraton Store. The Owner can operate at both locations without restriction. The generic Manager role does not automatically grant unrestricted cross-location stock editing.
- **Cross-location stock-change approval:** A non-Owner stock-changing request affecting the other location must remain Pending Approval without changing the live balance. A Sheraton Store Manager request affecting Ajose Warehouse is approved by any one authorised Ajose Warehouse Staff account. An Ajose Warehouse Staff request affecting Sheraton Store is approved by the Sheraton Store Manager. The requester cannot approve their own request. The Owner may approve, reject or override another user's pending request; the Owner's own direct operations require no second approver. The cross-location approval scope includes manual stock adjustments/corrections, receiving that changes the target location's balance, stock-count reconciliation and other non-transfer stock operations that change quantities. A reservation or dispatch is included only when it directly changes stock at a location other than the actor's assigned location and occurs outside a separately authorised order workflow; participation in an otherwise separately authorised order workflow does not, by itself, create an additional cross-location approval requirement. Standard stock transfers, the dedicated physical pickup from Ajose Warehouse to the assigned Sheraton Store, and destination receipt for that transfer remain separate workflows governed by their own transfer lifecycles and are not routed through this additional approval queue.
- **Approval integrity:** Retain requester, target location, proposed operation, reason and submission timestamp; approver, decision, decision timestamp and outcome; revalidate permissions/current stock when approving; post the operation and movement transactionally; rejected requests do not change stock; and attribute every action, including Owner overrides.
- **Owner-only financial overview:** Only the Owner may access the consolidated overview across both locations: total money in, total money out, revenue, expenses and profit/loss. Enforce this in backend authorisation and protected API responses, not just frontend display. Manager and Staff must not receive those aggregate values.

**Still unanswered:** Formal approval evidence for the supplied rules; the complete role-by-module permission matrix; permissions for individual payments, expenses, refunds and other financial records; customer/product/order/document/export/user/location administration permissions; other approval flows and any monetary limits (without changing DMS-DEC-003); and the detailed action/field permissions for all operational modules. The Owner-only summary rule does not settle broader individual financial-record permissions.

**Why it affects implementation:** Every API route and service command needs a clear least-privilege rule. Shared read visibility must not imply permission to change stock. A generic inventory permission must not accidentally permit an unassigned stock change, bypass approval, expose Owner-only aggregates or remove existing payment controls.

**Exact information / approval required:**

1. Formally approve shared two-location operational visibility and the location-specific direct-edit model.
2. Formally approve the two destination-location approval routes and Owner direct/approval/override authority, including requester self-approval prohibition and the separate transfer/pickup/receipt exception.
3. Approve the required approval-record/audit behaviour and stock-state revalidation at decision time. Detailed schema design remains for a later reviewed task.
4. Formally approve Owner-only access to the consolidated financial overview and its exact aggregate scope.
5. Approve the full Owner/Manager/Staff permission matrix for customers, products, orders, cancellation, dispatch, receiving, adjustments, counts, standard transfers, pickup, receipt, discrepancies, payments, individual financial records, expenses, refunds, suppliers/procurement, reports, documents, exports, user administration, location administration and system settings.
6. Specify any other role-specific approval, field-level restriction or export rule. Coordinate monetary thresholds only through DMS-DEC-003; Task 010 does not change those limits.

**Governing sources:** README — Users and permissions, Inventory rules and Security; Architecture Overview §5; Database Design §§2.1, 2.5 and 6–8; ADR-006 and ADR-016; Decision Register DMS-DEC-002.

**Project manager / business owner response:**

- Shared operational visibility: **[Planning direction supplied; formal approval pending]**
- Direct-edit scope by role and location: **[Planning direction supplied; formal approval pending]**
- Cross-location approval authority and exceptions: **[Planning direction supplied; formal approval pending]**
- Approval audit and transaction requirements: **[Planning direction supplied; formal approval pending]**
- Owner-only consolidated financial overview: **[Planning direction supplied; formal approval pending]**
- Complete role/module permission matrix: **[To be completed]**
- Permissions for individual financial records, refunds, expenses and exports: **[To be completed]**
- Formal approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### DMS-DEC-007 — Initial reservation duration and expiry eligibility

**Current status:** Pending confirmation

**Already confirmed:** Stock is reserved immediately when an order is confirmed, whether unpaid, partially paid or paid. Expiry must be configurable and persisted; each reservation snapshots its policy version and expiry. A policy change applies to new reservations. Expiry releases reserved quantity only, does not reduce physical on-hand and does not silently cancel the order; an affected order is placed on fulfilment hold/reconfirmation.

**Still unanswered:** Whether expiry is enabled in the first release; the initial duration and unit; which undispatched order/payment states are eligible; and any order-type exceptions. No initial business-approved duration exists. The 24-hour technical invitation expiry in Employee Account Administration is unrelated and must not be reused as an inventory default.

**Why it affects implementation:** The policy determines when reserved stock becomes available to other orders and which orders need operational follow-up. The expiry worker and its concurrency rules cannot be implemented safely without eligibility and duration values.

**Exact information / approval required:**

1. State explicitly whether reservation expiry is enabled at first release or disabled initially.
2. If enabled, provide duration and unit.
3. Define eligible order/payment states and exclusions, including paid, partially paid, processing, packed and other relevant states.
4. Confirm any separate treatment by order source/type.
5. Confirm the operational hold/reconfirmation action when expiry occurs. Preserve immediate reservation on confirmation and the no-silent-cancellation rule.

**Governing sources:** README — Inventory rules and order workflow; Architecture Overview §4.1; Database Design §§2.5 and 5; ADR-005; Decision Register DMS-DEC-007.

**Project manager / business owner response:**

- Expiry enabled for first release? **[Yes / No — to be approved]**
- Initial duration and unit (if enabled): **[To be completed]**
- Eligible states and exclusions: **[To be completed]**
- Order-type exceptions: **[To be completed]**
- Expiry follow-up / hold owner: **[To be completed]**
- Approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### DMS-DEC-008 — Reservation grace periods, warnings and authorised overrides

**Current status:** Pending confirmation

**Already confirmed:** Reservation policies are versioned. New policy versions affect new reservations only. Changing an existing reservation expiry requires an explicit authorised and audited action. Expiry does not cancel an order or reduce on-hand stock.

**Still unanswered:** Whether there is a grace period; warning timing and recipients; internal/customer notification channels; who may extend or manually release a reservation; eligible reasons; extension limits; and whether reminder delivery is first-release scope or deferred.

**Why it affects implementation:** The warning/override process determines how staff handle an order near expiry and prevents uncontrolled extensions or premature release. Permissions, audit details and any notification worker depend on the answers.

**Exact information / approval required:**

1. Confirm whether a grace period exists and its duration, if any.
2. Define warning trigger(s), timing and recipients. Identify whether warnings are staff-only, customer-facing or both, and the approved channel.
3. Specify roles authorised to extend or manually release an existing reservation.
4. Define eligible reasons, maximum extension rules, whether additional approval is needed and the required evidence.
5. Confirm whether warnings/reminders are required in the first release or explicitly deferred.
6. Require actor, timestamp, before/after expiry, reason and approval attribution for an override.

**Governing sources:** Architecture Overview §§4.1 and 9; Database Design §§2.5 and 5; ADR-005 and ADR-006; Decision Register DMS-DEC-008.

**Project manager / business owner response:**

- Grace period and duration: **[To be completed]**
- Warning trigger(s), timing, recipients and channel: **[To be completed]**
- Roles allowed to extend/release: **[To be completed]**
- Eligible reasons, limits and approval: **[To be completed]**
- Reminder delivery in first release or deferred: **[To be completed]**
- Required override audit evidence: **[To be completed]**
- Approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### DMS-DEC-009 — Transfer exceptions and discrepancy resolution

**Current status:** Pending confirmation

**Existing confirmed transfer rules:** For standard transfers, destination-assigned Staff confirms physical receipt. Partial receipt is supported; unreceived quantity remains in transit. A discrepancy has a quantity, reason, reporter and subsequent authorised resolution. Unresolved quantities remain visible. Under ADR-016, picked quantities cannot be silently cancelled, expired or restored to Warehouse; they must be received, separately returned or formally resolved.

**Task 010 planning direction, pending formal confirmation under DMS-DEC-001/002:** For the dedicated Ajose Warehouse-to-Sheraton Store workflow, the assigned Store Manager using the existing Manager role is also eligible when the active Sheraton assignment and explicit destination-receipt permission pass.

**Still unanswered:** How transfer processing is escalated when no authorised destination-assigned actor is available; whether any substitute can be used and how they receive an active destination assignment and explicit action permission; required shortage/damage/loss/wrong-item evidence; permissible resolution outcomes; approver role/threshold; and ageing/escalation expectations.

**Why it affects implementation:** A transfer can leave stock in transit for an extended period. Without approved exceptions, the system may expose a bypass around destination assignment or encourage unsupported write-offs that conceal missing stock.

**Exact information / approval required:**

1. Define who monitors/escalates a transfer when no currently authorised destination-assigned actor is available and the expected escalation timing.
2. If a substitute is permitted, define how the substitute is formally assigned to the destination and granted the explicit action permission before receipt. Preserve the dedicated Ajose Warehouse-to-Sheraton Store eligibility of the assigned Store Manager under the existing Manager role; an unassigned Staff or Manager account must not bypass the destination-assignment rule.
3. For shortage, damage, loss and wrong-item cases, specify required quantity evidence, reason, photos/documents if any, reporter and review record.
4. List the permitted resolution outcomes and the exact stock/in-transit event for each (for example, receipt of remaining physical quantity, separately recorded return transfer, quarantine, write-off or another explicitly approved outcome).
5. Specify who approves each resolution, any quantity/value thresholds, segregation-of-duties rules and what happens when an approver is unavailable.
6. Define ageing thresholds, escalation owner and reporting for unresolved in-transit quantities.
7. Preserve transfer reconciliation and ADR-016 cancellation/pickup constraints.

**Governing sources:** README — Multi-location Inventory and stock management; Architecture Overview §§4.2 and 4.2.1; Database Design §2.5 and §5; ADR-005, ADR-006 and ADR-016; Decision Register DMS-DEC-009. DMS-DEC-003 may also govern approval thresholds.

**Project manager / business owner response:**

- Unavailable destination Staff escalation and timing: **[To be completed]**
- Substitute assignment process (if allowed): **[To be completed]**
- Required evidence by discrepancy type: **[To be completed]**
- Permitted resolution outcomes and corresponding stock treatment: **[To be completed]**
- Approver roles / thresholds / segregation rules: **[To be completed]**
- Ageing and escalation expectations: **[To be completed]**
- Approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### DMS-DEC-010 — Physical pickup paperwork or reference at Warehouse

**Current status:** Pending confirmation

**Already confirmed:** ADR-016's dedicated Ajose Warehouse-to-assigned-Sheraton Store pickup mode, transactional stock-availability revalidation, shared read-only visibility of both locations' quantities and availability through authorised operational read surfaces, atomic Ajose Warehouse-to-in-transit movement, separate Sheraton destination receipt, partial pickup, actor/time attribution and idempotency are fixed. An insufficient-stock submission rejects the entire pickup event without changing the Ajose Warehouse balance, in-transit quantity, pickup event or stock movement. The pickup response need not duplicate values already available through those read surfaces; this response behaviour does not restrict shared read visibility. The physical paperwork/reference process is explicitly left open.

**Still unanswered:** Whether a Staff member must present or record a transfer reference, printed slip, dispatch note, signed handover, Warehouse confirmation, identity check or other evidence; who creates/checks it; and whether DMS must retain a file or only a reference.

**Why it affects implementation:** The pickup screen, handover evidence, audit metadata and possibly private file storage depend on what Warehouse requires. The paperwork answer must not change ADR-016's access or stock-movement model.

**Exact information / approval required:**

1. Confirm whether any evidence is required beyond the DMS transfer reference and immutable pickup event. Explicitly approve “no additional paperwork” if that is the decision.
2. List each required paper/digital reference and specify who creates it, who verifies it and at what point in the pickup.
3. Specify required fields and whether a signature, identifier check, Warehouse acknowledgment or other evidence is needed.
4. Confirm whether DMS stores an uploaded copy, a reference string, or both. If file uploads are required, resolve the relevant private storage controls before implementing the upload path.
5. Confirm how missing, incorrect or disputed paperwork is handled without bypassing the pickup transaction.

**Governing sources:** Architecture Overview §§4.2.1 and 11; Database Design §2.5 (Sheraton pickup authorisation); ADR-016; Decision Register DMS-DEC-010. DMS-DEC-018 is a conditional dependency if private file storage is required.

**Project manager / business owner response:**

- Additional paperwork/reference required? **[Yes / No — to be approved]**
- Required evidence, fields and format: **[To be completed]**
- Created by / checked by / verification point: **[To be completed]**
- DMS storage approach (file, reference or both): **[To be completed]**
- Exception process: **[To be completed]**
- Approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### DMS-DEC-015 — Cost-price history and stock valuation method

**Current status:** Pending confirmation

**Already confirmed:** Product variants currently store a cost price. The product/order design preserves relevant transaction price snapshots. Stock valuation must not be presented as reliable until a valuation method and appropriate historical cost basis are agreed. The decision register explicitly allows stock valuation reporting to be deferred.

**Still unanswered:** Whether cost-price changes must be retained as immutable effective-dated history; who may record/approve them; which valuation/costing method is approved, or whether valuation reporting is explicitly deferred; the treatment of freight, duties, discounts, supplier credits, partial receipts and returns; and the cost basis for historical margin reports.

**Why it affects implementation:** A current cost field alone cannot explain historical stock value after supplier costs change. Different valuation methods produce different values and margin reports. Implementing an assumed method would create misleading financial information.

**Exact information / approval required:**

1. Decide whether cost-price changes require immutable, effective-dated history per product variant.
2. Identify who may create, amend or approve a new cost record and the audit evidence required.
3. Choose the approved first-release stock valuation method, or explicitly defer stock valuation reporting until a later approved phase.
4. If valuation is approved, define treatment of inbound freight, duties, supplier discounts/credits, partial receipts, damaged goods and returns where applicable.
5. Define which cost basis applies to historical margin reporting (for example, order-time cost snapshot or another explicitly approved basis).
6. Do not assume FIFO, weighted average or standard cost.

**Governing sources:** README — Product records, Multi-location inventory and Reports; Architecture Overview §§3.1 and 4; Database Design §§2.4, 2.9 and 6; ADR-013; Decision Register DMS-DEC-015.

**Project manager / business owner response:**

- Effective-dated cost history required? **[Yes / No — to be approved]**
- Roles allowed to record/approve cost changes: **[To be completed]**
- Approved valuation method or explicit deferral: **[To be completed]**
- Inbound cost/discount/return treatment (if valuation is approved): **[To be completed]**
- Historical margin cost basis: **[To be completed]**
- Approval by / role: **[To be completed]**
- Approval date and evidence/reference: **[To be completed]**

### 5.8 Decision worksheet handling

Do not fill any blank with an assumption. Do not paste real employee personal details, customer information, actual stock quantities, supplier invoices or other production data into the public repository. Record controlled personnel references only where suitable and authorised. An answer becomes approved only when its authority, date and evidence are recorded in the relevant decision record/ADR through a separately reviewed documentation change. The decision-register statuses remain unchanged until that evidence is accepted.

## 6. Security, access-control and audit requirements

The following requirements must be carried into the eventual design and implementation. The location/approval rules in §6.1 record Task 010 planning direction pending formal confirmation under DMS-DEC-001/002; they do not authorise code changes.

### 6.1 Backend authorisation and location scope

- Every protected operation is authenticated and authorised by the backend. Hiding a control in the frontend is not sufficient.
- Enforce the approved role permission and the location/resource scope for every command and read.
- Authorised operational users have shared read-only visibility of the Ajose Warehouse and Sheraton Store operational dashboards, stock quantities and availability. This read access is not an assignment and does not grant write permission.
- Non-Owner direct stock-changing operations are limited to the account's assigned location: the Sheraton Store Manager using the existing Manager role is assigned to Sheraton; Warehouse Staff accounts are assigned to Ajose Warehouse. The Owner may operate directly at either location.
- A non-Owner request to change stock at the other location enters Pending Approval and changes no live balance while pending. A Sheraton Store Manager request affecting Ajose Warehouse requires one authorised Ajose Warehouse Staff approver; an Ajose Warehouse Staff request affecting Sheraton Store requires the Sheraton Store Manager. A requester cannot approve their own request. The Owner may approve, reject or override another user's request; Owner direct operations require no second approver. The cross-location approval scope includes manual stock adjustments/corrections, receiving that changes the target location's balance, stock-count reconciliation and other non-transfer stock operations that change quantities. A reservation or dispatch is included only when it directly changes stock at a location other than the actor's assigned location and occurs outside a separately authorised order workflow; participation in an otherwise separately authorised order workflow does not, by itself, create an additional cross-location approval requirement. Standard stock transfers, the dedicated physical pickup from Ajose Warehouse to the assigned Sheraton Store, and destination receipt for that transfer remain separate workflows governed by their own transfer lifecycles and are not routed through this additional approval queue.
- The approval record retains the requester, target location, proposed operation, reason and submission timestamp plus the approver, decision, decision timestamp and outcome. Approval revalidates current permission and stock state and posts the operation/movement transactionally; rejection changes no stock. Every action is auditable.
- Standard transfers, dedicated Warehouse-to-Sheraton pickup and destination receipt retain their separate workflows and are not routed through the additional cross-location approval queue.
- The assigned Sheraton Store Manager using the existing Manager role may use the dedicated pickup and destination-receipt actions when the active destination assignment and explicit action permission are satisfied. A literal Staff-role-only check must not block this action. No general Warehouse write permission is granted.
- The consolidated financial overview (total money in/out, revenue, expenses and profit/loss across both locations) is Owner-only and must be protected by backend authorisation/API responses. This does not settle permissions for individual financial records.

### 6.2 Actor attribution, timestamps and audit

- Attribute every stock command, movement, reservation, pickup, receipt, count, adjustment, discrepancy report and resolution to the authenticated actor. Do not accept the actor ID from an untrusted client field.
- Use database-authoritative UTC timestamps (timezone-aware timestamps) for durable events. Display business-facing dates/times using Africa/Lagos.
- Write the business event, balance projection changes and associated audit event in the same database transaction.
- Keep stock movements and audit events append-only in ordinary application workflows. Correct mistakes with separately attributed reversal/adjustment/resolution events; never silently edit or delete historical movements.
- Preserve event-level pickup and receipt actor/time attribution even when the same person performs both steps.
- Keep audit metadata safe: do not record credentials, tokens, unnecessary personal data or secrets.

### 6.3 Transaction, concurrency and retry requirements

- Update balances, reservations and transfers transactionally.
- Lock or conditionally update the relevant balance, order/reservation and transfer-item rows before applying quantity changes. Recheck eligibility and available quantity while holding the relevant locks.
- Use a consistent lock order for operations touching multiple inventory rows to reduce deadlocks.
- Add database constraints/unique keys for critical relationships, non-negative quantities, one balance per location/variant, transfer quantity reconciliation and idempotency.
- Use idempotency keys for commands that may be retried, including transfer pickup/receipt and other non-repeatable stock changes. Same-key/same-payload retries return the original outcome; same-key/different-payload reuse is rejected.
- A transaction failure, including an audit-write failure, must roll back the business change and the projections together.

### 6.4 Data and repository handling

- Use synthetic test fixtures only in development, CI and staging.
- Do not commit real stock records, opening balances, customer/order data, employee personal data, supplier invoices or financial records to Git.
- No production data or real employee assignments are needed to complete Task 009.

## 7. Inventory transaction and concurrency risks

The implementation plan must explicitly test and protect the following failure modes.

| Risk | Required protection / expected invariant |
|---|---|
| Two orders reserve the same last available units concurrently | Lock or conditional-update the location/variant balance; only one transaction may reserve the available quantity. Available never becomes negative. |
| Reservation expiry races dispatch, cancellation or manual release | Lock and recheck order and reservation state. The reservation can be consumed or released/expired only once; expiry does not change on-hand or silently cancel the order. |
| Policy changes while reservations are active | Store the applied policy version and expiry on each reservation. New policy versions do not retroactively alter existing reservations. |
| Two source dispatches/pickups or destination receipts are retried | Transfer/item locks, unique idempotency keys and transactional event/movement writes prevent duplicate stock changes. |
| Partial transfer pickup/receipt or cancellation | Reconcile requested, dispatched, received, cancelled, in-transit and formally resolved quantities. Picked quantity cannot be erased by cancellation. |
| Non-Owner requests an unrelated direct Warehouse stock change | Shared read-only Warehouse visibility remains available to authorised operational users. An unrelated cross-location stock change must use the destination-location approval process; dedicated pickup authority does not grant general Warehouse write access. |
| Destination Staff is unavailable or an item is disputed | Leave unreceived quantity visible in transit until a formally approved receipt, return or discrepancy resolution. Do not silently force receipt or write off. |
| Stock count overlaps with normal movements | Define a count cutoff/snapshot and locking/reconciliation strategy before implementation so legitimate movements are not overwritten by a stale count. Every reconciliation delta must be attributable. |
| Audit insertion or downstream write fails | Roll back the entire stock transaction; a balance change without its movement/audit evidence must not commit. |
| Duplicate or malformed quantity command | Validate positive quantities and unit precision, apply database constraints, and use idempotency/state checks. Never use floating-point quantity arithmetic. |

The database design also identifies the need for unique (location_id, product_variant_id) balances, non-negative in-transit quantities, transfer-item quantity reconciliation, row locks and safe idempotency. These are design requirements for future schema/service review, not claims about current tables.

## 8. Recommended implementation sequence

This sequence is a dependency assessment, not a commitment to deliver every module immediately. The project manager must authorise each implementation task after the required decisions and acceptance gates are satisfied.

### Stage 0 — Business and technical decision closure

Complete and independently review DMS-DEC-001, 002, 007, 008, 009, 010 and 015. For DMS-DEC-001/002, convert the Task 010 planning direction into formal, evidence-backed approval and close the remaining codes, account-mapping, assignment-authority and broader permission-matrix gaps. Resolve related approval, order, supplier, file-storage and database/tooling dependencies where they affect a selected stage. Confirm the opening-stock verification/cutover procedure and the approved quantity/unit precision before creating live balances. No inventory feature code should begin on assumptions.

### Stage 1 — Stock location register and location-access administration

Build on the existing locations and user_location_access tables only after DMS-DEC-001 and DMS-DEC-002 are approved. Implement location administration and private assignment grant/change/revocation with audit history and backend enforcement. Support shared read-only visibility of both locations separately from direct stock-changing permission. Verify Owner authority across both locations, assigned-location editing for the Store Manager and Warehouse Staff, destination-location approval for other-location stock changes, and the assigned-Manager pickup/receipt action permissions. Do not seed invented codes, IDs, locations or users.

### Stage 2 — Inventory balance foundation and opening-stock handling

After Stage 1 and approved product/variant identities, introduce the balance model per location/variant and its integrity constraints. Define a controlled opening-stock process that records a verified physical count, effective/cutover timestamp, source/reference, actor and approval evidence as opening movements. Do not import or fabricate balances. Confirm unit precision and prohibit negative on-hand/reserved values.

### Stage 3 — Stock receiving and append-only movements

Implement receiving into one selected location with transactional balance updates and ledger entries. Confirm whether the initial receiving workflow is a direct/manual receipt or linked to purchase orders. If linked procurement is in first-release scope, DMS-DEC-013 and DMS-DEC-014 must be resolved; a purchase order alone must never increase stock. Include quantity/unit validation, actor attribution and idempotency.

### Stage 4 — Stock adjustments and physical stock counts

Implement reason-coded adjustments and count sessions only after DMS-DEC-002 and any relevant approval authority under DMS-DEC-003 are defined. A count must retain the counted quantity, system snapshot/cutoff, counter, reviewer where applicable, difference and reconciliation event. Do not overwrite the balance or ledger with a stale count. Discrepancy and damage outcomes must use the approved permissions and audit trail.

### Stage 5 — Standard stock transfers

Implement source/destination selection, transfer items, source dispatch, transfer-specific in-transit projections and destination receipt. Gate this stage on approved locations/assignments (DMS-DEC-001), permissions (DMS-DEC-002) and exception/discrepancy rules (DMS-DEC-009). Enforce partial receipts, item-level reconciliation, actor/time events and idempotency.

### Stage 6 — Dedicated Warehouse-to-Sheraton pickup and destination receipt

Implement only after Stages 1, 2 and the transfer foundations are approved and DMS-DEC-009/010 have answers. Preserve the amended ADR-016 behaviour: exact Ajose Warehouse source, actor's assigned Sheraton Store destination, explicit action permission plus destination assignment (including the existing Manager role where authorised), atomic Warehouse-to-in-transit pickup, separate destination receipt, partial events, individual actor/time attribution, in-transit accounting, idempotency and discrepancy protection. Shared operational read surfaces may show Warehouse quantities/availability; pickup authority does not grant general Warehouse write access. If the paperwork decision requires uploaded documents, resolve DMS-DEC-018 private storage controls before building that upload path.

### Stage 7 — Order reservation and dispatch integration

Integrate reservations only when the order/customer foundation and order lifecycle are approved and available. ADR-015 already fixes one fulfilment location per first-release order. DMS-DEC-007 and DMS-DEC-008 must define reservation policy values, eligibility, expiry and overrides. DMS-DEC-005 and DMS-DEC-006 govern cancellation/dispatch rules and evidence; related payment rules must not be invented. Reservation and dispatch must use the same transactional balance/ledger model. If expiry is enabled, a reliable scheduled/worker execution and retry model must be designed; no expiry worker currently exists.

### Stage 8 — Low-stock thresholds, inventory history and reporting

Add per-location/variant reorder thresholds and operational history/reporting only after balances and movements are reliable. Define who may set thresholds and who may view/export reports under the approved permission matrix. Reports must separate on-hand, reserved, available and in-transit values and reconcile to source movements. Do not imply that a low-stock alert or report exists before it is implemented and tested.

### Stage 9 — Stock valuation, only after DMS-DEC-015

Implement cost history and valuation only if DMS-DEC-015 approves the basis, or explicitly keep valuation reporting deferred. Never assume FIFO, weighted average or another valuation method. The current variant cost field is not a historical valuation ledger.

## 9. Explicit implementation blockers

The following items prevent an evidence-based start of the corresponding inventory implementation work:

1. **DMS-DEC-001 — locations and assignments:** Ajose Warehouse and Sheraton Store names/purposes are supplied as planning direction, but approved unique codes, canonical record IDs, private account-to-location mappings, assignment authority and formal approval evidence remain outstanding.
2. **DMS-DEC-002 — permissions:** the supplied shared-visibility, location-scoped-editing, cross-location approval, assigned-Manager pickup/receipt and Owner-only financial-overview direction still requires formal approval; the full Owner/Manager/Staff matrix and individual financial-record permissions remain outstanding.
3. **DMS-DEC-007 — reservation policy:** initial expiry enablement, duration and eligible order/payment states are not approved.
4. **DMS-DEC-008 — reservation exceptions:** grace period, warning rules, extension and manual-release authorities are not approved.
5. **DMS-DEC-009 — transfer exceptions:** unavailable destination Staff, discrepancy evidence, permitted resolutions and approvals are not defined.
6. **DMS-DEC-010 — pickup evidence:** the Warehouse physical paperwork/reference process is not confirmed.
7. **DMS-DEC-015 — cost basis:** historical cost-price treatment and stock valuation method are unresolved; valuation must remain deferred unless approved.

Additional dependencies that may gate particular stages, without replacing the seven required worksheet items:

- DMS-DEC-003 may be needed where adjustment, write-off or discrepancy approvals have thresholds.
- DMS-DEC-005 and DMS-DEC-006 affect order cancellation and dispatch integration.
- DMS-DEC-013 and DMS-DEC-014 affect whether receiving is tied to supplier procurement.
- DMS-DEC-018 is required before implementing private file uploads if pickup/discrepancy evidence must be stored as files.
- DMS-DEC-024 records the pending formal confirmation of the adopted PostgreSQL/explicit-SQL/node-pg-migrate convention. The current code uses that approach, but its implementation is not itself a formal ratification.
- DMS-DEC-027 records the proposed test strategy and quality gates. Inventory concurrency, permission-boundary, ledger reconciliation and transaction rollback tests must be added before the relevant feature can be accepted.
- The opening-stock source/count, cutover method and verification authority must be supplied and approved before actual balances are introduced. No opening quantity is currently evidenced.
- No inventory schema, routes, UI, worker or production database has been implemented/provisioned.

These blockers must be closed through evidence-backed decision updates and a separately reviewed implementation authorisation. Creating this readiness document does not mark any roadmap inventory item complete.

## 10. Acceptance criteria for beginning inventory feature work

Inventory implementation may begin only when all applicable criteria are met:

- [ ] DMS-DEC-001 is answered with the approved location register, canonical Warehouse/Sheraton records, Staff assignments and assignment authority; the decision is updated with approver/date/evidence.
- [ ] DMS-DEC-002 is answered with a complete role/module/action and location-scope matrix; the decision is updated with approver/date/evidence.
- [ ] DMS-DEC-007 and DMS-DEC-008 define the initial reservation policy, expiry eligibility, grace/warnings and permitted extensions/releases, or explicitly defer the relevant behaviour. The expiry/worker requirement is documented.
- [ ] DMS-DEC-009 defines unavailable-Staff escalation, discrepancy evidence, allowed outcomes, approvals and in-transit ageing.
- [ ] DMS-DEC-010 defines the pickup paperwork/reference requirement, including an explicit “no additional paperwork” answer if applicable.
- [ ] DMS-DEC-015 approves effective-dated cost history and a valuation basis, or explicitly defers valuation reporting.
- [ ] Related dependencies (approval limits, order cancellation/dispatch, receiving/procurement, private file storage if needed, and database/testing conventions) are resolved for the first authorised implementation slice.
- [ ] Opening-stock verification, cutover, actor/approval evidence, unit of measure and quantity precision are defined. No opening balance is invented.
- [ ] A reviewed entity/migration/API plan identifies constraints, transactions, lock order, idempotency keys, audit events and rollback behaviour.
- [ ] Test scenarios use synthetic data and cover concurrency, permissions, partial transfer/receipt, discrepancy resolution, retry safety, projection/ledger reconciliation and audit rollback.
- [ ] The project manager has independently reviewed the completed decision evidence and explicitly authorised a scoped inventory implementation task.

Until these criteria are satisfied, inventory remains **not implemented**. No decision-register status, roadmap checkbox or feature-completion claim is changed by Task 009.

## Repository evidence and references

The assessment was checked against the required base commit:

- [README.md](../../README.md)
- [Architecture Overview](../architecture/overview.md)
- [Database Design](../architecture/database-design.md)
- [Architecture Decisions](../architecture/decisions.md)
- [Decision Register](../architecture/decision-register.md)
- [Migration 001 — initial foundation](../../apps/api/migrations/001_initial_foundation.js)
- [Migration 002 — Product Management](../../apps/api/migrations/002_product_management.js)
- [Migration 003 — Employee Account Administration](../../apps/api/migrations/003_employee_account_administration.js)
- [Location access service](../../apps/api/src/modules/roles/location-access.service.ts)
- [Permission service](../../apps/api/src/modules/roles/permission.service.ts)
- [Authorization middleware](../../apps/api/src/middleware/authorization.ts)
- [Application route mounts](../../apps/api/src/app.ts)
- [Product Management service](../../apps/api/src/modules/products/product.service.ts)
- [Product Management routes](../../apps/api/src/modules/products/product.routes.ts)
- [GitHub Actions CI](../../.github/workflows/ci.yml)

**Task 009 status:** Readiness and decision worksheet prepared for independent review.
**Inventory implementation status:** Not started.
**Decision-register status:** Unchanged; DMS-DEC-001, 002, 007, 008, 009, 010 and 015 remain Pending confirmation.
