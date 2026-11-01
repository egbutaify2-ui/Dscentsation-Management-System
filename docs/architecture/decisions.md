# Dscentsation Management System — Architecture Decisions

**Document status:** Implementation-aware architecture decisions for project-manager review
**Task:** 002 — Technical Architecture, reconciled against Task 005

**Decision rule:** Each ADR's status controls its approval state. Only decisions explicitly marked Confirmed are treated as accepted; an implementation detail appearing in the codebase does not by itself change an ADR's status.

This document records the rationale for architecture decisions, preserves existing approval statuses and distinguishes confirmed product constraints, proposed target design and implementation choices adopted in the codebase. Task 005 was approved and merged through PR #7; that merge did not approve the whole target architecture or the unimplemented business modules.

## ADR-001 — Use a modular monolith for the first release

**Status:** Proposed

**Context**

DMS is an internal system for one business with approximately 3–5 users. Its first release covers related operational domains: customers, manual product records, inventory, orders, payments, expenses, suppliers, returns, documents and reports.

**Decision**

Build one React application, one Node.js/Express API and one PostgreSQL database. Keep backend business domains separate through internal modules and service boundaries. Introduce a separately running worker only for asynchronous/retryable work when needed.

**Why**

- Operational workflows are strongly related and require transactions across domains.
- One deployable backend reduces hosting, deployment and monitoring overhead.
- Module boundaries preserve maintainability and make future extraction possible if scale or team structure justifies it.
- A microservice architecture would add network, data-consistency and operational complexity without a current business need.

**Consequences**

- Modules must not call each other's database internals indiscriminately; expose clear service/repository interfaces.
- Transactions across modules remain possible inside the single application/database boundary.
- A future service extraction will need explicit API/event contracts.

**Task 005 implementation evidence (PR #7, merged):** The repository now has a pnpm monorepo with separate `apps/web` and `apps/api` applications, and the API code is divided into foundation modules for authentication, users, roles and audit. This is consistent with the modular-monolith direction at codebase level. No background worker, email service, file-storage service, Render service or production environment has been provisioned. ADR-001 remains **Proposed**; implementation does not formally ratify the modular-monolith decision, final module boundaries or worker timing.

**Task 008 implementation evidence (PR #10, merged):** Employee Account Administration extends the existing authentication foundation with Owner-only `users.view` and `users.manage` permissions, an employee directory, Manager/Staff invitation links, employee-set initial Argon2id passwords, suspension/reactivation and transactional session revocation. Migration 003 stores only invitation-token digests and protects the last active Owner at the database boundary. It does not provide automated email delivery (DMS-DEC-017 pending), location assignment (DMS-DEC-001 pending), the full permission matrix (DMS-DEC-002 pending), password recovery, session-history browsing or comprehensive audit coverage for future business events. The codebase implementation does not ratify those business decisions or formally change ADR-001's status.

## ADR-002 — Use React with TypeScript for the web interface

**Status:** Proposed technology detail; React is confirmed by the README

**Context**

The business needs a responsive internal dashboard for remote Owner oversight and daily Staff/Manager workflows.

**Decision**

Use React as the frontend framework, with TypeScript and Vite as the proposed language/build setup. Organise the UI by business feature, keep shared components separate, and centralise API communication.

**Why**

- React is the technology already identified in the project requirements.
- TypeScript makes API contracts and complex business forms easier to maintain.
- Vite provides a straightforward build tool for a client-side internal application.
- Feature-based organisation maps to DMS modules and future implementation phases.

**Consequences**

- The frontend is a presentation layer, not an enforcement boundary.
- Business totals and permission decisions must be calculated/validated by the backend.
- UI tests should cover user-visible states and validation, while business invariants are tested at the API/domain layer.

**Task 005 implementation evidence (PR #7, merged):** The web app uses React 19.3.0, TypeScript 6.0.3 and Vite 8.3.5. It currently contains a responsive sign-in screen, authenticated shell, placeholder navigation and initial dashboard shell; business screens are not implemented. TypeScript and Vite are adopted in the codebase but are not thereby formally approved. ADR-002 remains **Proposed technology detail** pending DMS-DEC-022.

## ADR-003 — Expose a versioned REST API with Node.js and Express

**Status:** Proposed technology detail; Node.js and Express are confirmed by the README

**Context**

The React application needs a stable interface to the business services and PostgreSQL data.

**Decision**

Use Node.js and Express with TypeScript. Expose a JSON REST API under `/api/v1`. Validate all inputs at the API boundary and keep HTTP controllers thin; domain services own business rules.

**Why**

- Matches the proposed technology in the README.
- REST is sufficient for CRUD operations, workflow transitions and reporting endpoints in the first release.
- Versioning creates a clear contract if another approved client/integration is added later.
- A modular service layer makes critical inventory/payment workflows testable without HTTP.

**Consequences**

- Every protected route/service must perform server-side authorisation.
- API error responses should be consistent and avoid leaking internal stack traces or secrets.
- API contract documentation should be added during implementation.
- No public customer/ecommerce API is implied.

**Task 005 implementation evidence (PR #7, merged):** The API uses Node.js 26.13.0, Express 5.3.0 and TypeScript 6.0.3. It exposes a versioned JSON API under `/api/v1`; current routes cover health and foundation authentication/session/capability operations only. No business-module or public ecommerce routes have been implemented. TypeScript and the versioned API contract remain implementation choices awaiting formal ratification under DMS-DEC-023; ADR-003 remains **Proposed technology detail**.

## ADR-004 — Use PostgreSQL as the system of record

**Status:** Proposed technology; PostgreSQL is confirmed by the README

**Context**

DMS stores related records that must remain consistent across customers, orders, stock, payments, approvals, suppliers and returns.

**Decision**

Use PostgreSQL as the authoritative relational database. Use migrations in version control, foreign keys, constraints, indexes and transactions. Use UUID identifiers for internal records.

**Why**

- Relational integrity is central to financial and inventory correctness.
- Transactions and row-level locking support concurrency-safe reservations and stock transfers.
- PostgreSQL supports reporting queries and JSONB for limited safe metadata without making the core model schemaless.
- A relational schema provides traceable links between orders, products, payments and stock events.

**Consequences**

- Production schema changes require reviewed migrations.
- Task 005 adopted explicit parameterised SQL through `pg` and `node-pg-migrate` for migrations, without an ORM. This implementation choice is documented below and remains subject to formal ratification under DMS-DEC-024.
- A managed database provider, region, size, backup policy and restore capability must be selected before deployment.

**Task 005 implementation evidence (PR #7, merged):** The API accesses PostgreSQL through `pg` 8.23.1 using explicit parameterised SQL and uses `node-pg-migrate` 9.0.0 for versioned migrations. No ORM is included. The initial migration creates only the eight foundation tables recorded in `docs/architecture/database-design.md`. The CI integration/migration checks use disposable PostgreSQL 17. This records the codebase's adopted query/migration tooling, not formal architecture ratification; ADR-004's status remains **Proposed technology** and DMS-DEC-024 remains Pending confirmation.

### Data representation conventions

- Money: integer minor units (kobo) plus currency code; no floating-point arithmetic.
- Quantity: fixed-precision numeric values with an agreed unit of measure.
- Timestamps: timezone-aware UTC values; business display/reporting in `Africa/Lagos`.
- Historical line items: snapshot the product description/SKU and transaction price at the time of sale.
- Financial and stock corrections: append a reversal/adjustment event; do not silently overwrite history.

## ADR-005 — Track inventory by variant and location, with in-transit ledger and configurable reservations

**Status:** Confirmed business rules; policy values remain configurable.

**Context**

The business holds stock at multiple physical locations. Orders have one fulfilment location in the first release. Confirmed orders reserve stock immediately, including when unpaid. Standard transfers require dispatch at the source and explicit receipt confirmation by Staff assigned to the destination. For the separate dedicated Ajose Warehouse-to-Sheraton Store pickup/receipt workflow, Task 010 records planning direction (pending formal confirmation under DMS-DEC-001/002) that the assigned Store Manager using the existing Manager role is also eligible when the active Sheraton assignment and explicit destination action permission pass (ADR-016). Reservation expiry must be configurable.

**Decision**

Track physical on-hand/reserved balances per (location_id, product_variant_id), maintain an append-only stock movement ledger, and store active reservations with expires_at and the reservation-policy version used. Track stock in transit separately from physical location balances using a transfer-item-scoped stock_in_transit_balances record and linked stock-movement events.

A transfer dispatch transaction decreases source on-hand and increases in-transit quantity. For standard transfers, a Staff user assigned to the destination location must confirm receipt; the receipt transaction decreases in-transit and increases destination on-hand. For the dedicated Ajose Warehouse-to-Sheraton Store workflow, Task 010 records planning direction (pending formal confirmation under DMS-DEC-001/002) that the assigned Store Manager using the existing Manager role may confirm receipt when the active Sheraton assignment and explicit destination-receipt permission pass (ADR-016). Partial receipts leave the remainder in transit. Discrepancies require attributed resolution.

On order confirmation, reserve the required quantity immediately from the order's single selected fulfilment location, whether the order is unpaid, partially paid or paid. A persisted, versioned reservation_policies record controls whether expiry is enabled, its duration and its eligibility scope. Every policy edit creates a new immutable version for future reservations. Each reservation stores a foreign key to the policy version used, its expiry timestamp and that policy version; the expiry worker evaluates eligibility against the referenced version, so configuration changes do not retroactively alter existing reservations.

**Why**

- Product-level totals alone cannot show where stock is held.
- Separating in-transit stock prevents dispatched goods from remaining available at the source or appearing prematurely at the destination.
- Destination Staff confirmation makes the receiving location accountable for physical receipt.
- Immediate reservation prevents confirmed orders from competing for the same available stock, independent of payment timing.
- Configurable expiry lets the business control how long stock remains committed.
- Ledger events, row locks and idempotency prevent double deductions or releases.

**Consequences**

- Available stock at a location is on-hand minus reserved; in-transit stock is excluded.
- Transfer dispatch/receipt and reservation creation/release/expiry are atomic, auditable and idempotent.
- Expiry processing locks and rechecks the order/reservation. It releases only active, due and policy-eligible reservations, reduces reserved quantity (not on-hand), records the expiry reason and places the order on fulfilment hold/reconfirmation. It does not silently cancel the order.
- Dispatch, cancellation and expiry races resolve through transactional state checks; a reservation can be consumed or expired, never both.
- A policy change applies to new reservations; changing existing expiry times requires an explicit authorised/audited action.
- Initial reservation duration, expiry-eligible payment/order states, grace period and warning rules remain configurable values to set.
- A first-release order cannot be fulfilled from multiple stock locations; all item reservations use its one fulfilment location.


## ADR-006 — Enforce confirmed role, location and payment permissions in the backend

**Status:** Existing backend-enforcement and payment controls remain confirmed. The revised location visibility/editing, cross-location approval and financial-overview direction recorded by Task 010 remains pending formal confirmation under DMS-DEC-001 and DMS-DEC-002.

**Context**

DMS has the existing Owner, Manager and Staff roles. The operating model distinguishes shared operational visibility from permission to change stock. The Owner has authority across both initial locations. The existing Manager role is used for the Sheraton Store Manager; it must not automatically confer unrestricted cross-location stock editing. The business also requires an auditable approval path when a non-Owner requests a stock-changing operation at the other location. Sensitive actions must be enforced at the API/domain layer, not by UI visibility.

**Decision**

Use the existing three role codes and explicit permissions mapped to those roles. Do not add a role code or infer broad authority from the generic Manager label. Enforce all protected actions with deny-by-default backend checks:

- **Owner:** full authority across both locations; may view and directly operate at either location without a second approver. The Owner may approve, reject or override another user's pending cross-location request. The Owner alone may access the consolidated financial overview across both locations: total money in, total money out, revenue, expenses and profit/loss.
- **Manager (Sheraton Store Manager assignment):** may view the operational dashboards and stock quantities/availability of both locations. Direct stock-changing operations are limited to the Manager's assigned location, Sheraton Store. The Manager may use the dedicated Warehouse-to-assigned-Sheraton pickup and destination-receipt actions only where the authenticated account has the Sheraton destination assignment and the explicit action permission. The Manager role alone does not grant direct Warehouse stock-edit permission.
- **Staff (Ajose Warehouse assignment):** may view the operational dashboards and stock quantities/availability of both locations. Direct stock-changing operations are limited to the Staff member's assigned location, Ajose Warehouse. Staff may record payment entries but may not verify them.
- **Shared operational visibility:** authorised operational users may view both Ajose Warehouse and Sheraton Store dashboards, stock quantities, availability and shared operational information needed for day-to-day stock management. This is read-only cross-location visibility for a user who is not assigned to that location; it does not grant direct stock-changing permission there.
- **Assigned-location operation:** a non-Owner may perform normal authorised stock-changing operations directly at the location to which the account is assigned, subject to its explicit action permission and other business rules.
- **Cross-location stock-change request:** when a non-Owner requests a stock-changing operation against the other location, the operation enters **Pending Approval** and must not change a live stock balance before approval. The approval route is:
  - A Sheraton Store Manager request affecting Ajose Warehouse requires approval from **one** authorised Ajose Warehouse Staff account.
  - An Ajose Warehouse Staff request affecting Sheraton Store requires approval from the Sheraton Store Manager.
  - The requester cannot approve their own request. The Owner may approve, reject or override another user's pending request.
  - The Owner performs their own stock-changing operations directly and does not need a second approver.
- **Approval integrity:** retain the requester, target location, proposed operation, reason and submission timestamp; retain the approver, decision, decision timestamp and outcome. On approval, revalidate current permissions and stock state, then commit the approved operation and resulting stock movement transactionally. Rejection changes no stock. Every request, decision, execution and Owner override remains attributable and auditable.
- **Separate transfer workflows:** Operations evaluated under this rule include manual stock adjustments/corrections, receiving that changes the target location's balance, stock-count reconciliation, other non-transfer stock operations that change quantities, and reservation/dispatch operations only when they directly change another location's stock and are not part of a separately authorised order workflow. Standard stock transfers, the dedicated Warehouse-to-Sheraton physical pickup and destination receipt remain governed by their separate transfer lifecycle. They do not enter the additional cross-location stock-change approval queue. Their source dispatch, in-transit accounting, destination receipt and discrepancy controls remain as defined in ADR-005 and ADR-016.
- **Payment permissions:** Staff may record payment entries; only Manager and Owner may verify them. Unverified entries remain excluded from verified-receipts reporting.
- **Financial overview:** the consolidated overview is Owner-only and must be enforced by backend authorisation and protected API responses. Shared operational dashboards must not expose these owner-only aggregates to Manager or Staff. This does not settle who may view or manage individual expense, payment, refund or other financial records.

**Why**

- Shared operational visibility supports coordinated stock decisions without creating unrestricted write access.
- Location-scoped direct changes preserve clear accountability for each physical stock location.
- A pending cross-location request gives the destination location a review opportunity before its balance changes.
- An Owner can exercise full authority without an artificial second-approver dependency, while every direct action and override remains attributable.
- Backend enforcement protects direct API calls as well as normal UI interactions.
- Separating the Owner-only financial summary from operational visibility prevents accidental exposure through shared dashboards.

**Consequences**

- Every protected endpoint/domain command must check the authenticated actor, explicit action permission and relevant assigned-location scope on the backend.
- A user's read access to both operational dashboards must be separate from the permission to create a stock movement at either location.
- The Manager role must not be treated as a global stock-edit grant. Store Manager direct edits are location-scoped to the approved Sheraton assignment.
- Cross-location approval requests must have no stock effect while pending; approval-time revalidation and transactional posting are mandatory. A requester cannot approve their own request.
- Standard transfers, physical pickup and destination receipt use their own lifecycle and do not acquire an extra cross-location approval step.
- Owner-only financial aggregates must not be returned by an API response available to Manager or Staff. The broader permission matrix for individual records and other modules remains open.
- Changes to assignments, permissions, requests, approvals, stock movements and Owner overrides must be auditable.

**Task 005 implementation evidence and reconciliation boundary:** The existing Task 005 helper currently grants Owner and the generic Manager role global stock-location access, and the current destination pickup helper is Staff-role-specific. Those are implementation facts at the inspected baseline, not the revised target behaviour. Task 010 changes documentation only. A later separately scoped and reviewed implementation task must reconcile the helpers and permission checks with this ADR without adding role codes or general Warehouse write access. The current permission seeds do not implement the approval workflow, the shared-read model or the Owner-only financial overview.

## ADR-007 — Use individual accounts and persistent PostgreSQL-backed sessions

**Status:** PostgreSQL session persistence is required; adapter/library choice is an implementation detail.

**Context**

DMS contains personal customer details, operational records and financial information. A small team still needs individual accountability and reliable session behaviour across API restarts and multiple instances.

**Decision**

Use individual invited/provisioned accounts and Argon2id password hashes. Use opaque server-side sessions delivered through secure, HttpOnly, SameSite cookies. Persist session records in PostgreSQL through a maintained PostgreSQL-backed Express session store and a migration-managed session table with expiry indexing/cleanup.

Production must never use Express MemoryStore, an in-memory session store or process-local session state. All API instances share the same PostgreSQL session store. Rotate session identifiers at authentication/privilege changes and revoke sessions on logout, password reset, account suspension and security incidents.

**Why**

- Shared logins prevent reliable attribution.
- PostgreSQL persistence means sessions survive process restarts and are shared across API instances.
- A central store supports revocation and expiry cleanup.
- Opaque cookies avoid exposing session data to frontend JavaScript.

**Consequences**

- No public self-registration is part of the initial design.
- Session storage schema and cleanup are managed by migrations/operations.
- Login throttling, CSRF controls, secure cookies, password reset, session expiry and revocation must be tested.
- Production configuration must fail closed if the persistent session store is unavailable; it must not silently fall back to an in-memory store.
- Whether MFA is required for Owner/Manager accounts remains a separate security-policy decision.

**Task 005 implementation evidence and limitations (PR #7, merged):** The API uses Argon2id hashes, provisioned accounts, `express-session` with `connect-pg-simple` 10.0.0, HttpOnly/SameSite=Lax cookies (Secure in production), login session regeneration, logout/session destruction, a session-revocation helper, idle-cookie expiry and absolute session-age handling. CSRF checks the exact configured Origin and a session-bound token. The initial Owner bootstrap is an interactive CLI operation using a transaction/advisory lock and an audit record. Production configuration requires explicit idle/absolute timeout values, Secure cookies and an HTTPS application origin; development example values are not approved production policy. Login throttling currently uses a process-local `express-rate-limit` limiter. MFA, approved session lifetime values, concurrent-session policy and high-risk-action re-authentication remain unresolved. ADR-007's stated status is unchanged.


## ADR-008 — Send transactional email through a provider adapter and database outbox

**Status:** Proposed; provider details pending verification

**Context**

Purchase receipts and order confirmations/updates must use Dscentsation's official company-hosted email identity. The current provider and supported SMTP/API sending method have not yet been confirmed.

**Decision**

Build a provider-neutral email adapter. Store messages in an email outbox in the same PostgreSQL transaction as the business event that requires a message. A worker sends messages and records attempts/outcomes. Configure SMTP or an API only after the existing company-hosted account has been verified.

**Why**

- Business events should not be lost when the API process stops after saving an order.
- Provider abstraction avoids coupling business logic to an unverified vendor.
- Retry and idempotency handling reduces missed or duplicated receipts.
- The sender remains the official company email identity.

**Consequences**

- Credentials and provider tokens are backend-only environment secrets.
- The worker must use deduplication keys and safe retry rules.
- Delivery failures should be visible to authorised Staff/Managers.
- Transactional and marketing messages remain separate; marketing consent is stored independently.
- Sender authentication, rate limits, SMTP/API access and delivery/bounce support must be verified.

**Task 005 implementation status:** No email provider adapter, email outbox, delivery-attempt table, background worker, sender credentials or email integration was implemented or provisioned. This ADR remains **Proposed; provider details pending verification**.

## ADR-009 — Store files in private object storage, not in PostgreSQL

**Status:** Proposed; provider pending selection

**Context**

DMS may hold receipt evidence, expense attachments, supplier invoices, proof of delivery and other company documents. The README proposes Supabase Storage or an equivalent service.

**Decision**

Store file bytes in a private object-storage bucket. Keep metadata, ownership and business-record references in PostgreSQL. Deliver files only through backend-authorised, short-lived signed URLs.

**Why**

- Object storage is a better fit for file bytes than relational rows.
- Private storage plus server authorisation prevents unrestricted public access.
- Database metadata makes uploads traceable to users and business records.
- A provider adapter or storage boundary avoids coupling the business model to a vendor.

**Consequences**

- No public bucket for business documents.
- Enforce allowed file types, file size, generated object keys and upload permissions.
- Consider malware scanning before files are made available to other users.
- Provider, storage region, retention, backup and lifecycle rules need confirmation.

**Task 005 implementation status:** No object-storage adapter, storage bucket, file metadata table, upload/download workflow or storage provider was implemented or provisioned. This ADR remains **Proposed; provider pending selection**.

## ADR-010 — Prefer Render Postgres, subject to backup, recovery and cost verification

**Status:** Preferred by the project manager; provisioning is conditional on verification.

**Context**

The README identifies Render as the proposed application host. The system requires a React frontend, Express API, PostgreSQL and potentially background workers. The project manager prefers Render Postgres, provided its operational safeguards and cost are acceptable.

**Decision**

Prefer Render for the frontend/API and Render Postgres for the managed database, reachable through private networking. Do not provision the production database until backup, recovery and cost checks have been completed and documented. Use a shared PostgreSQL-backed session store; production in-memory sessions are prohibited.

**Why**

- Aligns with the existing Render hosting direction and keeps the initial topology compact.
- A managed database reduces day-to-day database administration compared with self-hosting.
- Private connectivity and central persistence support the API and session store.

**Required verification before provisioning**

- Backup frequency, retention and backup availability for the selected plan.
- Point-in-time recovery support, limits and the actual restore procedure.
- A restore test (or documented pre-production restoration exercise) and evidence that data can be recovered.
- Recovery objectives appropriate to the business (RPO/RTO to be agreed).
- Region, private networking, connection limits, storage/compute capacity and operational constraints.
- Total recurring cost at expected workload, including database compute/storage, backup or recovery-related charges where applicable, frontend/API/worker services and required plan tiers.

**Consequences**

- Render Postgres is the preferred candidate, not a provisioned production service until the checks are accepted.
- Record verification findings and project-manager approval before production data is introduced.
- Use separate staging and production configuration; migrations are controlled deployment steps.
- No deployment or service provisioning is part of this architecture-correction task.

**Task 005 implementation status:** No Render frontend, API, worker or production PostgreSQL service was provisioned, and no deployment occurred. Render Postgres remains a preferred candidate subject to the verification and approval already stated in this ADR; its status is unchanged.


## ADR-011 — Use an automated test pyramid with special focus on transaction invariants

**Status:** Proposed

**Context**

The highest-risk defects are not visual; they include overselling, duplicate reservations, incorrect transfer receipts, payment history corruption and permission leaks.

**Decision**

Use frontend component tests, backend unit tests, PostgreSQL-backed API/integration tests and Playwright end-to-end tests. Add explicit concurrency/idempotency tests for stock and financial workflows.

**Why**

- Different test layers catch different failure modes.
- Database-backed tests are necessary for constraints and transaction behaviour.
- End-to-end tests verify complete user journeys, while unit tests provide fast feedback on domain rules.

**Consequences**

- Use synthetic data only.
- Tests must run in CI before merging.
- Test database migrations from a clean database.
- Production deployment should be blocked by failing critical tests.

**Task 005 implementation evidence (PR #7, merged):** The current CI workflow runs for pull requests targeting `main` and pushes to `main`. The implemented checks include Prettier, ESLint, TypeScript, Vitest, Supertest, React Testing Library, PostgreSQL-backed integration/security tests, clean migration and seed verification, rollback/reapplication, production-mode migration-up and rollback-guard checks, production builds and patch-whitespace verification. CI uses a disposable PostgreSQL 17 service. Playwright is not present in the package manifests or current workflow, and comprehensive user journeys, concurrent stock reservation/transfer invariants and financial-workflow tests remain future coverage. ADR-011 remains **Proposed**; implementation of this baseline does not approve the complete test strategy or gate policy.

## ADR-012 — Keep product registration manual and exclude the storefront

**Status:** Confirmed product requirement

**Context**

DMS is an internal operations platform. The README explicitly rejects bulk website catalogue import and catalogue synchronisation, and says products are entered manually in DMS.

**Decision**

DMS owns its internal product records. Staff create and maintain products in the authenticated application. Website-originated orders may be entered manually. There is no public storefront and no product catalogue sync in the initial scope.

**Why**

- This is the agreed scope and avoids coupling operational records to the website's catalogue.
- It keeps the internal product/stock records under business control.
- It prevents architecture work from silently expanding into ecommerce development.

**Consequences**

- Product creation is an authenticated, permission-checked workflow.
- No crawler, catalogue importer, scheduled sync or product-feed integration is included.
- Any future website-order integration must be scoped separately and must not imply product catalogue import.

## ADR-013 — Record sales, payments, expenses and refunds as distinct concepts

**Status:** Proposed financial model; payment recording and verification permissions confirmed.

**Context**

DMS must distinguish sales, actual payments received, product costs, expenses and estimated profit. Orders may be unpaid or partially paid; refunds and corrections need history.

**Decision**

Keep order totals, payment events, refunds, expenses and cost snapshots separate. Staff may record a payment entry, but only a Manager or the Owner may verify it. Only verified payment events count toward verified cash-received reports and paid-balance calculations. Derive outstanding balances and payment state from verified events or update a transactional summary with strict reconciliation rules.

**Why**

- Order value is not the same as cash received.
- A partial payment cannot be represented accurately by a single boolean.
- Separating entry from verification provides a second-person control.
- Refunds and corrections must not erase the original receipt.
- Estimated profit must not be presented as audited accounts.

**Consequences**

- Payment entry and payment verification are separate permissions and audit events.
- No payment gateway or automated bank reconciliation is assumed.
- Finance reports must label estimates clearly and use verified source records.

**Task 005 implementation status:** The migration seeds the payment-entry and payment-verification permission codes, but the physical schema contains no payment, refund, order, expense or cost tables and the API contains no financial workflow routes. The broader financial event/reporting model remains Proposed under ADR-013 and DMS-DEC-028; the permission seed does not implement that model.

## ADR-014 — Persist explicit receipt issuance records

**Status:** Required architecture design.

**Context**

The business requires unique receipt references, purchase receipts and paid receipts, as well as a communication history. A generated receipt is a business artifact; an email send attempt is a separate delivery event.

**Decision**

Create an immutable receipt_issuances record whenever a receipt is issued. Store a unique receipt reference, order/payment association, receipt type, issuer, issuance timestamp, currency/amount and a frozen transaction snapshot. Record void/reissue actions as append-only receipt issuance events. Link email-outbox/delivery attempts to the receipt issuance.

**Why**

- The business needs evidence of exactly which receipt was issued, when and by whom.
- Historical receipts must remain reproducible if product, customer or order details later change.
- Email failure must not erase or invalidate a correctly issued receipt.

**Consequences**

- Receipt issuance and email delivery are tracked independently.
- Receipt records are not silently overwritten or deleted; corrections create a void/reissue event and replacement reference.
- Receipt numbering/format and the exact business event that triggers each receipt type remain operational details to confirm.

**Task 005 implementation status:** No `receipt_issuances` or `receipt_issuance_events` table, receipt-generation workflow or email-outbox linkage was implemented. ADR-014 remains an architecture design requirement, not a delivered receipt feature.

## ADR-015 — Use one fulfilment location per order in the first release

**Status:** Confirmed first-release business rule.

**Context**

DMS supports multiple stock locations, but order fulfilment must remain operationally simple and traceable in the first release.

**Decision**

Each order has one required fulfilment_location_id. All items/reservations for that order are sourced from that location. Cross-location split fulfilment for a single order is not supported in the first release.

If stock is insufficient at the selected location, the system must not silently source stock from another location. Staff must correct the order, select another single location before confirmation where authorised, or arrange a stock transfer before fulfilment.

**Why**

- A single source location makes stock reservation, picking, dispatch, returns and audit history more predictable.
- It avoids hidden cross-location allocations and prevents fulfilment ambiguity.

**Consequences**

- orders.fulfilment_location_id is non-null.
- Reservations for all order items use that location.
- Multi-location/split fulfilment requires a separately approved future change.


## ADR-016 — Preserve dedicated Warehouse-to-Sheraton pickup controls under shared stock visibility

**Status:** Existing transfer-accounting and audit safeguards remain fixed. Shared stock visibility and eligibility of an assigned Store Manager for destination actions are Task 010 planning direction pending formal confirmation under DMS-DEC-001 and DMS-DEC-002.

**Context**

Ajose Warehouse and Sheraton Store are separate physical stock locations with independent balances. Authorised operational users are intended to have shared read-only visibility of both locations' dashboards, stock quantities and availability. That shared visibility does not give a non-Owner direct stock-changing permission at an unassigned location. The dedicated Warehouse-to-Sheraton pickup and destination-receipt workflow must continue to validate the exact transfer, destination assignment and explicit action permission, and must not grant general Warehouse write access.

**Decision**

Retain a dedicated `destination_staff_pickup` transfer mode and narrow backend action for an operational user assigned to the destination Sheraton Store:

- A pickup actor must have an active assignment to the destination Sheraton Store and the explicit pickup action permission. The existing Manager role is eligible where those checks pass; eligibility must not be hard-coded to the literal `STAFF` role. An assigned Staff account with the explicit permission may also qualify. No role code is added or changed.
- The actor may create or open a pickup transfer only with source = the configured Ajose Warehouse and destination = the Sheraton Store assigned to that actor. The actor records the actual quantity physically collected against each transfer item.
- Shared read-only operational views may show Warehouse and Sheraton stock quantities and availability to authorised operational users, including the assigned Sheraton Store Manager. That shared visibility is not a general Warehouse write grant. The pickup action itself remains limited to its exact Warehouse-to-assigned-Sheraton transfer and cannot be used for unrelated Warehouse stock changes or transfer management.
- The backend validates the authenticated actor, active destination assignment, explicit action permission, exact source/destination pair, transfer state, item quantities and current Warehouse available stock. It must derive assignments and transfer endpoints from trusted database records, not client-supplied IDs or role claims.
- The pickup command locks the relevant transfer, items and Warehouse balance rows. In one transaction it reduces Warehouse on-hand and increases the transfer-item-specific in-transit quantity by the same amount, appends the paired Warehouse-out and in-transit-in movement events, records an immutable pickup event, actor and timestamp, and updates the cumulative picked quantity/status.
- The pickup command need not return a second copy of the Warehouse balance. The shared operational read surface is governed by the shared-visibility rule above. An insufficient-stock result must not partially post the submitted event; it must not bypass the transactional revalidation of the current stock state.
- A user assigned to the destination Sheraton Store and holding the explicit destination-receipt permission may confirm the quantity physically received. The existing Manager role is eligible where those checks pass; the workflow must not require a literal `STAFF` role if that would block the assigned Store Manager. Receipt reduces in-transit and increases Sheraton on-hand atomically. The same person may perform pickup and receipt; each remains a separate event with separate actor/time attribution.
- Partial pickups and receipts are supported. Unpicked requested quantities remain open; unreceived quantities remain in transit.
- Discrepancies require a recorded quantity, reason, reporter, time and subsequent authorised resolution. No balance is silently adjusted to hide a mismatch.
- A transfer with no pickup may be cancelled without stock movements. After partial pickup, only the unpicked remainder may be cancelled; picked quantities remain in transit and must still be received, returned through a separately recorded reverse transfer, or formally resolved. It cannot be marked fully cancelled while picked quantity remains unreceived/unresolved.
- Transfers that remain in transit stay visible in ageing/open-transfer reporting; picked stock is not automatically expired or released.
- Pickup and receipt requests use idempotency keys. Same-key/same-payload retries return the original outcome; same-key/different-payload reuse is rejected.
- Standard stock transfers, this dedicated physical pickup and destination receipt remain separate transfer workflows; none is routed through the additional cross-location stock-change approval queue.

**Why**

- Operational users can coordinate using the same read-only view of both locations without giving every user direct write access to both.
- The person physically collecting goods can record the actual pickup while the source and in-transit balances remain transactionally correct.
- Destination assignment and explicit action permission ensure that pickup and receipt actions are available to the assigned Store Manager without broadening their Warehouse editing rights.
- Event-level actors, immutable movements and idempotency support accountability, reconciliation and duplicate prevention.

**Consequences**

- Backend checks must combine explicit action permissions with the actor's active destination assignment and exact transfer source/destination; frontend route visibility is not an access-control boundary.
- The destination Store Manager may be authorised for the assigned-Sheraton pickup and receipt actions under the existing Manager role, provided the assignment and explicit permission are present. A check that depends exclusively on role code `STAFF` is insufficient for this direction.
- Shared read-only visibility of Warehouse balances is separate from pickup authority. The pickup permission does not authorise Warehouse adjustments, receiving, arbitrary transfers or other direct Warehouse writes.
- Every successful pickup and receipt submission creates its own immutable event row with its own actor, timestamp and item quantities; partial actions never overwrite earlier event rows. Append-only stock movements provide the corresponding quantity-ledger evidence. The transfer header's `dispatched_by`/`dispatched_at` and `received_by`/`received_at` columns, where retained, are denormalised summaries only (first source-release action and final receipt-completing event respectively), not authoritative evidence for partial-operation history.
- The configured Ajose Warehouse/Sheraton Store location records and private account assignments must be established before enabling the action.



## 3. Decisions requiring project-manager confirmation

The following pre-existing project-manager decisions remain confirmed and are not changed by Task 010:

| Confirmed area | Rule |
|---|---|
| Transfer receipt | For standard transfers, Staff assigned to the destination location confirm physical receipt. |
| Payment permissions | Staff can record payments; only Managers and Owner can verify payments. |
| Database hosting preference | Render Postgres is preferred, subject to backup, recovery and cost verification before provisioning. |
| Order fulfilment | One fulfilment location per order in the first release; no cross-location split fulfilment. |
| Reservation timing | Reserve stock immediately on order confirmation, whether paid or unpaid. |
| Reservation expiry | Expiry must be configurable and persisted; each reservation snapshots its applied policy/expiry. |
| Sheraton pickup | A user assigned to the Sheraton destination and holding the explicit pickup permission may use only the dedicated Warehouse-to-assigned-Sheraton pickup action; this does not grant general Warehouse write access. |

The following Task 010 direction is recorded separately from those pre-existing confirmed decisions and is not formal business-owner approval evidence: shared read-only operational visibility of both locations; direct stock-changing operations limited to the actor's assigned location for non-Owners; cross-location stock-change requests routed for destination-location approval (with the Owner able to act directly and review another user's request); Owner-only consolidated financial overview; and assigned-Store-Manager eligibility for the dedicated Sheraton pickup/receipt actions when the assignment and explicit permission checks pass. DMS-DEC-001 and DMS-DEC-002 remain Pending confirmation. No approver, date or evidence reference has been supplied.

Remaining details requiring confirmation:

1. Confirm the canonical Warehouse and Sheraton location records/codes and the destination-account-to-Sheraton assignments used by ADR-016.
2. Initial reservation duration and expiry eligibility scope (unpaid-only or all undispatched confirmed orders).
3. Grace period, pre-expiry warning/notification and whether an authorised user may extend an existing reservation.
4. Transfer exception/escalation when no authorised destination-assigned actor is available, and the review/approval process for shortages or damage.
5. Detailed permissions for refunds, expense approvals, exports and user administration.
6. Accepted payment methods and what evidence is required before verification.
7. Receipt numbering/format and which business events issue an order receipt versus a payment receipt.
8. Company email provider, sender authentication and supported SMTP/API method.
9. File-storage provider/region, allowed types, size limits and retention.
10. Render Postgres backup/recovery findings, restore-test evidence, recovery objectives and total cost approval.
11. Record-retention, correction/deletion and privacy policy.


## 4. Explicit non-decisions

This task does not authorise or settle:

- Application scaffolding or feature implementation.
- Database provisioning or production migrations.
- Deployment, domains or hosting configuration.
- Selection/creation of email credentials or storage credentials.
- Importing/synchronising the public website product catalogue.
- Building a public ecommerce storefront/customer portal.
- Automated WhatsApp, Instagram, SMS, website-order or payment-gateway integrations.
- AI assistants, marketing automation or predictive analytics.
- Changes to the README roadmap/checklist.

## 5. Review and change process

1. Project manager reviews the three architecture documents together.
2. Confirmed business rules are recorded in the requirements source or a follow-up decision record.
3. Technical choices are accepted, amended or rejected before implementation planning.
4. If a new requirement conflicts with the manual-product-entry or internal-system boundaries, pause and request explicit approval rather than silently expanding scope.
5. The next implementation task should be issued only after the architecture review is complete.

**Review outcome:** Pending.
