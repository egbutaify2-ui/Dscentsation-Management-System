# Dscentsation Management System (DMS)

An internal business management platform being actively built for Dscentsation's Nigerian operations. DMS brings orders, inventory, customers, sales, expenses, suppliers, receipts and operational reporting into one reliable system.

> **Project status — active development:** DMS is in its build phase. The team is implementing working modules in parallel, not just documenting plans. Customer Management backend (Task 011, PR [#14](https://github.com/egbutaify2-ui/Dscentsation-Management-System/pull/14)) and Supplier Directory backend foundation (Task 020, PR [#16](https://github.com/egbutaify2-ui/Dscentsation-Management-System/pull/16)) are merged into `main`. Active implementation continues on Expense Management (PR [#17](https://github.com/egbutaify2-ui/Dscentsation-Management-System/pull/17)), Order Capture (Task 022), Expense Management frontend (Task 023), Supplier Directory frontend (Task 024) and Customer Management frontend (Task 034).
>
> **Build direction:** New tasks are implementation tasks: build features, fix bugs, integrate modules, improve the UI and add the tests needed to ship them. Investigation-only and audit-only task streams are not the default. When a dependency is pending, agents should build the independent parts instead of leaving the whole task idle.
>
> **Latest feature merge:** Supplier Directory backend Task 020 merged through PR #16 at `64ac4b6a11c3ddce39a3646cdede0d570e338f77`. Customer Management (migration 004) and Supplier Directory (migration 005) are available in `main`. Expense migration 006 remains in its active PR and must follow migration 005.

## Contents

- [Product vision](#product-vision)
- [Business context and confirmed decisions](#business-context-and-confirmed-decisions)
- [Scope and boundaries](#scope-and-boundaries)
- [Modules and planned capabilities](#modules-and-planned-capabilities)
- [Core business workflows](#core-business-workflows)
- [Users and permissions](#users-and-permissions)
- [Identity, user accounts and activity accountability](#identity-user-accounts-and-activity-accountability)
- [Inventory rules](#inventory-rules)
- [Inventory implementation readiness](#inventory-implementation-readiness)
- [Application architecture and technology status](#application-architecture-and-technology-status)
- [Security and data integrity](#security-and-data-integrity)
- [Development roadmap and progress](#development-roadmap-and-progress)
- [Working agreement](#working-agreement)

---

## Product vision

Build a professional, secure and dependable system that helps Dscentsation manage its day-to-day Nigerian business operations from one dashboard.

Today, operational information can be spread across WhatsApp conversations, manual records and separate tools. DMS is intended to create a consistent record of what the business sells, what stock it holds and where, what customers have ordered, what has been paid, what has been spent and what still needs attention.

The owner should be able to monitor Nigerian operations remotely from the UK, while managers and staff use the same system according to their responsibilities.

## Business context and confirmed decisions

| Area | Confirmed requirement |
|---|---|
| Business | Dscentsation |
| Initial operating scope | Nigerian operations |
| Team size | Approximately 3–5 users |
| Owner | Based in the UK; needs remote business visibility |
| Order sources | WhatsApp, Instagram, website and phone calls |
| Currency | Nigerian Naira (NGN / ₦) |
| Business timezone | Africa/Lagos |
| Inventory | Two initial physical stock locations: Ajose Warehouse (main warehouse and stock holding) and Sheraton Store (customer-facing walk-in retail); each has an independent balance. Unique codes, addresses/identifiers and secure account mappings remain pending under DMS-DEC-001. |
| User roles | Owner, Manager and Staff |
| Company email | Existing company-hosted email account |
| Product records | Staff will add products manually in DMS |

### Important product decision: manual product records

DMS is an internal business management system, not an ecommerce storefront or a copy of the Dscentsation website.

- Products will be created and maintained manually inside DMS when needed.
- We will **not** bulk-import the existing website product catalogue.
- We will **not** build website product-catalogue synchronisation as part of the agreed scope.
- Orders that originate from the website can be recorded in DMS by staff. Automatic website-order integration is a separate future possibility and is not assumed for the first version.
- Products entered in DMS will be used to track quantities, stock locations, sales and stock movements.

## Scope and boundaries

### Included in the planned system

- Internal dashboard for business operations.
- Orders from all four agreed sales channels.
- Manual product and customer registration.
- Multi-location inventory and stock movement tracking.
- Sales, payment and expense records.
- Supplier, procurement, return and refund records.
- Customer purchase history and communication history.
- Purchase receipts and customer email notifications sent using Dscentsation's official company-hosted email identity.
- Business reports, staff permissions and audit history.

### Not part of the agreed initial scope

- A public online shopping storefront.
- Bulk import of the website's product catalogue.
- Automatic synchronisation of the website product catalogue.
- Public customer accounts or customer-facing shopping functionality.
- Automatic ingestion of WhatsApp or Instagram conversations unless a separate integration is designed and approved.
- AI features before reliable operational records and reporting are in place.

The source repository is public for portfolio and code collaboration purposes. A public repository does **not** make the deployed business application or its data public. Production access must require authentication and server-side authorisation. No real customer, order, stock or financial data may be committed to this repository.

## Modules and planned capabilities

All items below describe planned functionality; they are not claims that the features have already been implemented.

### 1. Dashboard and business overview

- Summary of sales, orders, payments, expenses and stock.
- Pending orders and fulfilment status.
- Low-stock and stock alerts across locations.
- Recent business activity.
- Quick links to common staff actions.
- Management visibility across the Nigerian operation.

### 2. Order management

- Register orders received through WhatsApp, Instagram, the website or phone calls.
- Record customer, order source, products, quantities, unit prices, discounts, delivery fees and totals.
- Assign an order to the relevant fulfilment/stock location.
- Track order status: Received, Confirmed, Processing, Packed, Dispatched and Delivered.
- Track cancelled and failed orders with reasons.
- Record delivery method, rider/courier details and dispatch/delivery dates.
- Support delivery assignments and a delivery queue so staff can see which rider/courier is responsible for each order.
- Track delivery attempts, proof/status notes and failed-delivery reasons.
- Search and review complete order history.
- Track who created and updated each order.

### 3. Product records

- Manually create and edit products in DMS.
- Record product name, description, SKU or internal code (where used), category, image (optional), variant/size (where relevant), selling price and cost price.
- Activate or archive products without deleting transaction history.
- Keep product details separate from stock quantities, because one product may be held at several locations.
- Do not depend on the website catalogue as a product data source.

### 4. Multi-location inventory and stock management

- Create and manage multiple stock locations.
- Track each product's on-hand, reserved and available quantities per location.
- Receive stock into a selected location.
- Reserve stock for confirmed orders.
- Record dispatch/sale movements and release reservations correctly.
- Transfer stock between locations with dispatch and receiving confirmation.
- Record damaged, missing, returned and adjusted stock with a reason.
- Support physical stock counts and reconciliation.
- Show stock movement history by product, location, date and staff member.
- Configure low-stock thresholds and alerts per product/location.
- Report stock valuation using recorded cost information.
- Provide shared read-only operational dashboards, stock quantities and availability for Ajose Warehouse and Sheraton Store to authorised operational users; direct stock-changing operations remain location-scoped.
- Route non-Owner requests for non-transfer stock changes affecting the other location through destination-location approval. Reservation or dispatch is included only when it directly changes another location's stock outside a separately authorised order workflow. Standard transfers and the dedicated Ajose Warehouse-to-assigned-Sheraton pickup/receipt workflow remain separate.

### 5. Customer management (CRM)

- Create and maintain customer profiles.
- Store necessary contact information, including phone number and email where provided.
- View each customer's order and purchase history.
- Search customers and identify repeat customers.
- Keep a history of receipts and customer communications.
- Record feedback and service notes where appropriate.
- Support customer segmentation and repeat-customer identification.
- Optionally record customer birthdays and preferences where supplied appropriately.
- Support consent-based birthday messages, personalised follow-ups and relevant product recommendations as future customer-retention features.
- Keep marketing consent separate from transactional communications.

### 6. Receipts and customer communications

- Generate unique order and receipt references.
- Generate branded purchase receipts with products, quantities, prices, discounts, fees and totals.
- Send order confirmations and paid receipts by email.
- Send dispatch and delivery updates.
- Use Dscentsation's **official company-hosted email identity** as the sender, not a staff member's personal email.
- Record email attempts and delivery/provider outcomes where available; surface failures for follow-up.
- Keep a communication history against the customer/order.
- Keep transactional messages separate from promotional messages.

The email provider and its supported sending method (SMTP or API) must be verified before implementation. Credentials must remain in backend environment secrets and must never be placed in frontend code or committed to GitHub.

SMS and WhatsApp Business notifications are possible later integrations. They require provider selection, configuration and any necessary customer consent; they are not assumed to be working in the first release.

### 7. Sales and payment tracking

- Record sales and link them to orders.
- Support payment methods used by the business, configured as needed.
- Track Unpaid, Partially Paid, Paid and Refunded/Partially Refunded states as applicable.
- Record amount, date, payment method, reference and staff member.
- Track outstanding balances.
- Preserve payment history and corrections rather than silently overwriting financial events.
- Provide daily, weekly and monthly sales summaries.

DMS is an operational management system. Financial reports must clearly distinguish sales, actual payments received, product costs, expenses and estimated profit. Reports must not present estimates as audited accounts.

### 8. Expense management

- Record expenses with date, amount, category, description and payment method.
- Support categories such as logistics, salaries, advertising, rent, utilities, supplies and other business costs.
- Attach supporting receipts/documents where appropriate.
- Submit expenses for review and approval.
- Record approval/rejection, approver and decision date.
- Search and report expenses by date, category and status.
- Provide a future central document area for business documents such as invoices, supplier files, policies and operational records, with role-restricted access.

### 9. Supplier and procurement management

- Maintain supplier records and contact information.
- Create and track purchase orders.
- Record supplier invoices and amounts due.
- Record goods received into a specified stock location.
- Update inventory through verified goods-received transactions.
- Track supplier payments and purchase history.

### 10. Returns, exchanges and refunds

- Register return and exchange requests.
- Record reasons, items, quantities and order references.
- Review and approve returns/refunds according to permissions.
- Track refund amounts and payment status.
- Inspect returned items before deciding whether they can return to sellable stock.
- Record resulting stock movements and keep a complete history.

### 11. Reports and analytics

- Sales and payment summaries.
- Outstanding orders and fulfilment performance.
- Product sales and best-selling items.
- Stock on hand, reserved stock and low-stock reports by location.
- Stock movement and transfer reports.
- Expense summaries.
- Supplier and procurement reports.
- Returns and refund summaries.
- Customer repeat-purchase and retention indicators.
- Estimated gross margin/profit using recorded costs and expenses.

### 12. Staff, administration and audit history

- Individual accounts for the Owner, Managers and Staff.
- Configurable role-based permissions enforced by the backend.
- Restrict sensitive financial, user-management and configuration actions.
- Keep shared read-only operational visibility of both initial stock locations separate from location-scoped direct stock-changing permissions.
- Record important actions: who created, changed, approved, transferred or cancelled a record and when.
- Provide management access to relevant activity history.
- Protect sensitive business settings and integrations.

### 13. Future business intelligence

After the operational modules are reliable, consider:
- An AI business assistant that answers operational questions using authorised DMS records.
- An AI product assistant that helps staff find suitable products or suggest fragrance options using the product information DMS actually contains.
- Sales and stock-demand forecasting based on sufficient historical business data.

Example questions for the AI business assistant include:

- Which products sold most this month?
- Which locations need restocking?
- Which orders have not been delivered?
- How much was spent on logistics this week?

AI-generated answers must be grounded in actual records, respect user permissions and make the underlying figures traceable. This is a later phase, not a prerequisite for the first release.

## Core business workflows

### A. Register and fulfil an order

1. Staff receives an order through WhatsApp, Instagram, the website or a phone call.
2. Staff creates the order in DMS and selects its source.
3. Staff selects or creates the customer and adds manually registered products and quantities.
4. DMS checks available stock at the chosen location.
5. When the order is confirmed, stock is reserved so it cannot be promised to another order.
6. Staff records payment as unpaid, partially paid or paid based on verified payment.
7. DMS creates the appropriate order confirmation or paid receipt and sends it through Dscentsation's company email.
8. Staff updates processing, packing and dispatch details.
9. At dispatch, the system records the stock movement and releases the reservation.
10. Staff marks delivery as completed or records a failed delivery.
11. Order, payment, inventory and customer history remain linked.

### B. Receive and transfer stock

1. Staff records incoming stock against a product and destination location.
2. DMS records the quantity received and the person who recorded it.
3. For a transfer, staff creates a transfer from one location to another.
4. The sending location dispatches the transfer.
5. The receiving location confirms the quantity received.
6. DMS records both sides of the movement and flags discrepancies for review.

### C. Record and approve an expense

1. Staff enters the expense details and attaches evidence where available.
2. The expense is submitted for approval.
3. An authorised Manager or Owner reviews and approves or rejects it.
4. DMS records the decision and includes approved expenses in reports.

## Users and permissions

The shared operational visibility, location-scoped direct-edit, cross-location approval and Owner-only financial overview rules below reflect Task 010 planning direction and remain pending formal confirmation under DMS-DEC-001/002. Existing payment-entry/payment-verification permissions remain unchanged.

| Role | Intended access |
|---|---|
| **Owner** | Full authority across both locations; may view and operate at Ajose Warehouse and Sheraton Store without location restriction; may approve/reject/override another user's pending cross-location request; and alone may access the consolidated financial overview. |
| **Manager (Sheraton Store Manager assignment)** | May view both operational location dashboards, stock quantities and availability; direct stock-changing operations are limited to the assigned Sheraton Store. May use the dedicated Warehouse-to-assigned-Sheraton pickup and destination-receipt actions where the active destination assignment and explicit action permission pass. The generic Manager role does not grant unrestricted cross-location stock editing. |
| **Staff (Ajose Warehouse assignment)** | May view both operational location dashboards, stock quantities and availability; direct stock-changing operations are limited to the assigned Ajose Warehouse. Cross-location stock-changing requests require the destination-location approval described below. |

**Shared operational visibility is not shared write access.** Authorised operational users use the same operational screens and can view both Ajose Warehouse and Sheraton Store quantities/availability. A non-Owner may carry out normal authorised stock-changing operations directly only at the location assigned to that account. The actual account-to-location mappings must be configured privately through an authorised process; do not place employee names, personal email addresses or account IDs in this public repository.

**Cross-location stock-change approval (Task 010 planning direction, pending formal confirmation):** a non-Owner request to change stock at the other location enters **Pending Approval** and must not change a live balance before approval. A Sheraton Store Manager request affecting Ajose Warehouse requires approval from any one authorised Ajose Warehouse Staff account. An Ajose Warehouse Staff request affecting Sheraton Store requires approval from the Sheraton Store Manager. The requester cannot approve their own request. The Owner may approve, reject or override another user's pending request; the Owner's own direct operations need no second approver. The request and decision retain requester/approver, target location, proposed operation, reason, timestamps, decision and outcome; approval revalidates current stock and permissions and posts transactionally; rejection changes no stock. The cross-location approval scope includes manual stock adjustments/corrections, receiving that changes the target location's balance, stock-count reconciliation and other non-transfer stock operations that change quantities. A reservation or dispatch is included only when it directly changes stock at a location other than the actor's assigned location and occurs outside a separately authorised order workflow; participation in an otherwise separately authorised order workflow does not, by itself, create an additional cross-location approval requirement. Standard stock transfers, the dedicated physical pickup from Ajose Warehouse to the assigned Sheraton Store, and destination receipt for that transfer remain separate workflows governed by their own transfer lifecycles and are not routed through this additional approval queue.

**Owner-only consolidated financial overview (Task 010 planning direction, pending formal confirmation):** only the Owner may see total money in, total money out, revenue, expenses and profit/loss consolidated across both locations. Backend authorisation and protected API responses must prevent Manager and Staff from receiving these aggregates; hiding a frontend panel is not sufficient. This does not settle broader access to individual payment, expense, refund or other financial records.

Permissions must be enforced by backend APIs and database access patterns, not only by hiding buttons in the user interface. Task 008 introduces only the explicit `users.view` and `users.manage` permissions for employee administration and assigns them to Owner only. Manager and Staff do not receive employee-administration permissions. The complete permission matrix remains unresolved under DMS-DEC-002. The Task 010 access rules above are planning direction, not formal business-owner approval evidence; DMS-DEC-001 and DMS-DEC-002 remain Pending confirmation.

## Identity, user accounts and activity accountability

DMS must identify the individual person performing each authenticated action. This is a core security and operational requirement, not an optional reporting feature.

### Individual employee accounts

- Every Owner, Manager and Staff member must use their own named account and unique email address. Shared accounts and shared passwords are not permitted.
- An account must identify the employee, their active/suspended status and the access role approved for them. Location assignments and permissions must be checked by the backend against approved business rules.
- An authorised administrator must be able to create or invite an employee, issue a secure account-setup process, suspend/reactivate access and revoke that employee's active sessions. The exact administrator permissions remain subject to the business permission matrix.
- Employees should set their own password through a secure, single-use, expiring setup or reset link. Passwords must never be sent in plain text, stored in plain text, or placed in Render environment variables.
- Passwords are stored only as secure password hashes. Task 005 implements Argon2id password hashing, provisioned accounts and an interactive initial Owner bootstrap CLI. Task 008 adds the Owner-facing employee directory, Manager/Staff invitations, one-time initial password setup, suspension/reactivation and session revocation. Password recovery/reset remains out of scope.
- Render environment variables are for application/service configuration and secrets (for example, database connection and session signing secrets), not for maintaining each employee's login credentials. Employee account records and password hashes belong in the protected PostgreSQL user store.

### Session and login accountability

- The system must associate each authenticated session with the individual user account that created it. The backend must derive the actor identity and role from the validated server-side session, never from a user ID, role or timestamp supplied by the browser.
- Record successful and failed login attempts and logout events. The foundation already records these authentication events and stores sessions in PostgreSQL.
- The complete searchable session-history capability must eventually make it possible for authorised administrators to see session events and status, including sign-in time, sign-out/expiry/revocation where available. Task 008 exposes account creation time and last successful login only; it does not implement session-history browsing.
- Task 008 revokes every employee session transactionally when an account is suspended and allows the Owner to revoke sessions manually. Reactivation does not restore previous sessions. Do not expose raw session cookies, session secrets or reusable session identifiers.
- MFA, approved session idle/absolute lifetimes, high-risk-action re-authentication and the detailed session-management policy remain unresolved and must not be assumed.

### Immutable activity and change history

For each important business action, DMS must retain enough information to answer: **who did it, what record was affected, what changed, and when did it happen?**

The audit record should capture, as appropriate:

- The actor's stable user ID and readable identity at the time of the action.
- The action performed and the affected record type and ID.
- The authoritative event timestamp and a request/correlation reference.
- The previous and new values for changed business fields, or an explicit before/after change set.
- A reason or explanation when a sensitive correction, override, cancellation, approval or adjustment requires one under the approved business rules.
- The outcome of the action, including rejected/failed attempts where the event is security-relevant.

Examples include creating or editing a customer, changing an order status, changing a scheduled delivery date/time, recording or verifying a payment, adjusting stock, receiving a transfer, approving an expense, suspending an employee or changing access.

**Date and time changes require special care:** if a user changes a business date or time, preserve the previous value and the new value as part of the change history. Also preserve the separate timestamp showing when the edit itself occurred. The audit timestamp must never be overwritten just because a business date/time field was changed.

### Timestamp and audit integrity rules

- Store authoritative event timestamps in PostgreSQL as UTC timestamps (timestamptz) using server/database time, not a browser-provided clock.
- Display dates and times in the DMS business timezone, Africa/Lagos, unless a separately approved requirement calls for another timezone.
- Keep the business date/time recorded on an order, delivery, payment or other record distinct from the audit event timestamp that records when a user changed it.
- Audit history must be append-only through the application and protected at the database level. Ordinary application users must not be able to edit or delete audit records.
- Never place passwords, password hashes, session cookies, tokens, secrets or unnecessary sensitive personal/payment data in audit metadata.
- User accounts may be suspended or deactivated, but historical activity must remain attributable. Do not delete an employee's identity in a way that breaks historical audit records.
- Provide an activity-history screen with appropriate filters (for example, employee, action, record and date range) for roles authorised under the completed permission matrix. Do not expose activity records to users who are not authorised to view them.

### Current implementation boundary

Task 005 provides the authentication foundation: individual provisioned user accounts, Argon2id password hashes, PostgreSQL-backed sessions, Owner bootstrap, login success/failure and logout audit events, an append-only audit table, request IDs and database protection against audit UPDATE, DELETE and TRUNCATE. Task 007 adds Product Management audit events. Task 008 adds the employee directory, Owner-only employee administration permissions, manual Manager/Staff invitation links, secure initial password setup, status changes, session revocation and transactional audit events.

Still future work includes password recovery/reset, administrator session-history browsing, a searchable audit-history dashboard, before/after field-level history across every business record and comprehensive business-event audit coverage. Task 008 does not implement those capabilities.

## Inventory rules

Inventory accuracy is business-critical. The implementation must follow these rules:

- Stock is tracked per product **and** per location.
- **On-hand** is the quantity physically recorded at a location.
- **Reserved** is stock committed to confirmed orders but not yet dispatched.
- **Available** is calculated as on-hand minus reserved.
- Confirming an order reserves stock; it must not create duplicate deductions.
- Dispatch records the outgoing stock movement and releases the reservation.
- Cancelling an order releases its reservation.
- Transfers must be traceable from dispatch at the source to receipt at the destination.
- Adjustments require a reason and an audit record.
- Returned goods must be inspected before being added back to sellable stock.
- Critical stock changes must be protected against concurrent updates and recorded transactionally.
- Authorised operational users can view both Ajose Warehouse and Sheraton Store stock quantities and availability; shared visibility does not grant direct cross-location editing.
- Non-Owner direct stock-changing operations are limited to the assigned location. Other-location stock-change requests remain pending until an authorised destination-location approver approves them, with the Owner able to act directly or review another user's request.
- Standard transfers, dedicated Warehouse-to-Sheraton physical pickup and destination receipt remain separate workflows, not part of the additional cross-location approval queue.

## Inventory implementation readiness

The DMS Task 009 readiness pack is complete and merged through PR #11. It records the verified implementation baseline, confirmed business rules, unresolved decisions, dependencies and recommended sequence. It did not introduce inventory feature code, migrations, screens, stock balances or real stock records. Inventory implementation has not started and remains blocked pending the approvals in the [Inventory Implementation Readiness & Decision Pack](docs/operations/inventory-implementation-readiness.md).

## Application architecture and technology status

Task 005 established the initial application foundation in `main`. The table below separates code that exists from proposals and infrastructure that have not been provisioned.

| Area | Implemented Task 005 foundation | Remaining boundary |
|---|---|---|
| Workspace | pnpm 12.16.1 workspace/monorepo; Node.js 26.13.0; separate `apps/web` and `apps/api` applications. | The code structure is consistent with a modular-monolith proposal; formal architecture ratification remains tracked in DMS-DEC-021. |
| Web frontend | React 19.3.0, TypeScript 6.0.3 and Vite 8.3.5; sign-in, authenticated shell, dashboard and the merged permission-aware Product Management experience. | Other operational screens are not implemented. TypeScript/Vite formal ratification remains open. |
| API | Node.js 26.13.0, Express 5.3.0 and TypeScript 6.0.3; authenticated Product Management and Customer Management routes under `/api/v1` are merged into `main`. | Inventory, Order and Finance routes remain unimplemented. The API is not a public customer/ecommerce API. |
| Database | PostgreSQL via `pg` 8.23.1, explicit parameterised SQL, `node-pg-migrate` 9.0.0 and no ORM. Task 007 adds three product tables; merged Task 008 migration 003 adds `user_invitations`, the invited status and last-active-Owner protections. | Other business schema is not implemented. CI uses disposable PostgreSQL; no production database has been provisioned. |
| Authentication | Task 005 provides Argon2id login, PostgreSQL-backed sessions, secure cookies, CSRF and the Owner bootstrap. Task 008 adds employee invitations, initial password setup, last-login display, suspension/reactivation and transactional session revocation. | Password recovery, session-history browsing, MFA, approved production idle/absolute session values, high-risk-action re-authentication and a distributed rate limiter remain unresolved or unimplemented. |
| Roles, permissions and audit | Six `products.*` permissions and two `users.*` permissions are assigned to Owner only. Product and employee-account lifecycle events use transactional before/after audit records; append-only audit protections remain. | DMS-DEC-002 remains open; these Owner-only assignments do not define the complete role-permission matrix. Audit coverage for future business modules remains incomplete. |
| Verification | Prettier, ESLint, TypeScript checks, Vitest, Supertest, React Testing Library, PostgreSQL-backed API integration tests, migration/seed/rollback/reapplication checks and production builds in GitHub Actions. | Comprehensive Playwright journeys and business-specific stock-concurrency, inventory-transfer and financial-workflow coverage remain future work. |
| Infrastructure and integrations | No Task 005 production infrastructure or external integration was provisioned. | Render hosting/database, background workers, email delivery, file storage, production secrets, backups and deployment remain subject to separate verification and approval. |

The implementation details and evidence are reconciled in [the architecture overview](docs/architecture/overview.md), [database design](docs/architecture/database-design.md), [architecture decisions](docs/architecture/decisions.md) and [decision register](docs/architecture/decision-register.md). A codebase implementation is evidence of what was built, not automatic approval of a Proposed architecture decision.

## Security and data integrity

- Never commit .env files, passwords, API keys, SMTP credentials, database URLs or other secrets.
- Use environment variables/secret management for backend integrations.
- Do not put private credentials in frontend bundles.
- Do not commit real customer information, receipts, order histories, stock records or financial records.
- Require authentication for the deployed application.
- Enforce permissions on the backend for every protected operation.
- Validate and authorise all API inputs.
- Use database transactions for orders, reservations, dispatches, transfers, payments and other critical operations.
- Maintain traceable audit history for sensitive actions.
- Do not silently overwrite or delete historical financial or stock movements.
- Plan and test database backups and recovery.
- Use synthetic data for development and automated tests.
- Protect file uploads and restrict access to private business documents.
- Apply secure session/token handling, rate limiting and appropriate error logging.
- The public GitHub repository must contain source code and safe documentation only, never production data.

## Development roadmap and progress

This checklist is the project's shared delivery record. It helps coding agents and contributors see what has shipped, what is being built and what comes next.

**A checkbox is marked complete only after the functionality has been implemented and the relevant checks have passed.** Planning or documenting a feature does not count as implementing it.

### Phase 0 — Discovery and project setup

- [x] Establish the business problem and product vision.
- [x] Confirm initial scope: Dscentsation's Nigerian operations.
- [x] Confirm order sources: WhatsApp, Instagram, website and phone calls.
- [x] Confirm approximately 3–5 users and Owner, Manager and Staff roles.
- [x] Confirm multi-location inventory requirement.
- [x] Confirm company-hosted email as the sender for customer purchase emails.
- [x] Confirm products will be entered manually; no bulk website catalogue import.
- [x] Create the public GitHub repository.
- [x] Establish this central README and project progress checklist.
- [x] Document and independently review the dedicated Ajose Warehouse-to-Sheraton Store physical pickup and destination receipt workflow, separate Warehouse and Sheraton stock balances, destination-assigned pickup permissions and ADR-016 security boundaries (Task 002; merged PRs #3 and #4).
- [ ] Verify the current company email provider's supported SMTP/API sending method and requirements.
- [x] Identify the two initial operating stock locations and purposes: Ajose Warehouse (main warehouse and stock holding) and Sheraton Store (customer-facing walk-in retail). This does not approve unique location codes, addresses/identifiers or actual account assignments.
- [ ] Approve unique location codes and any required address/identifying details; securely establish employee-to-location mappings and assignment authority (DMS-DEC-001).
- [ ] Formally approve the supplied location/access direction and complete the broader role/permission matrix; preserve outstanding monetary approval limits under DMS-DEC-003.
- [ ] Finalise operational rules for payment verification, order cancellation, dispatch, returns and refunds.
- [ ] Approve the initial technical architecture and deployment plan.

### Phase 1 — Application foundation

- [x] Define the repository structure and initial development conventions (pnpm monorepo, workspace scripts and shared TypeScript configuration).
- [x] Set up the React/Vite frontend and Express/TypeScript backend applications.
- [x] Configure Prettier, ESLint, TypeScript checks and GitHub Actions CI.
- [x] Define development/test environment variables and production security validation. Production secrets and service provisioning remain pending.
- [x] Establish the PostgreSQL development/test connection and versioned migration workflow. CI migration, seed replay, rollback and reapplication have been verified against disposable PostgreSQL only; production database provisioning remains pending.
- [ ] Define the complete application database schema and entity relationships. The current migration contains only the eight foundation tables; business-module schema design remains open.
- [x] Implement and test provisioned-account authentication, Argon2id password hashing, PostgreSQL-backed sessions, CSRF protection, session rotation, expiry and revocation.
- [ ] Complete the Owner, Manager and Staff business permission matrix. The foundation seeds only the three established roles and four currently confirmed permission codes; the full matrix remains open.
- [x] Implement the append-only audit-table foundation, including authentication/bootstrap audit events and database rejection of UPDATE, DELETE and TRUNCATE. Full business-event coverage and before/after field history remain pending.
- [x] Implement the employee directory, Manager/Staff invitations, secure initial password setup, suspension/reactivation and session revocation (Task 008, merged PR #10).
- [ ] Implement employee password recovery/reset.
- [ ] Implement authorised session-history and activity-history views, including employee/action/record/date filters.
- [ ] Record business changes with the authenticated actor, authoritative UTC event time, affected record and before/after values; retain the separate audit timestamp when a business date/time is edited.
- [x] Build the responsive application shell, login screen, role identity display, placeholder navigation and initial dashboard shell.

### Phase 2 — Products and multi-location inventory

- [x] Implement manual product creation, editing and archiving (Task 007, merged PR #9).
- [x] Implement product categories and optional variants/SKUs (Task 007, merged PR #9).
- [ ] Implement stock location management.
- [ ] Implement stock balances per product and location.
- [ ] Implement stock receiving.
- [ ] Implement stock reservations and release rules.
- [ ] Implement dispatch/sale stock movements.
- [ ] Implement stock transfers with sending and receiving confirmation.
- [ ] Implement stock adjustments with reasons and audit history.
- [ ] Implement physical stock counts and reconciliation.
- [ ] Implement low-stock thresholds and alerts.
- [ ] Implement inventory history and stock valuation reports.
- [ ] Test concurrent stock changes and prevention of overselling.

### Phase 3 — Customers and order management

- [ ] Implement customer registration and customer search.
- [ ] Implement customer profiles and purchase history.
- [ ] Implement order creation for all four agreed order sources.
- [ ] Implement order line items, prices, discounts and delivery fees.
- [ ] Implement order fulfilment statuses and status history.
- [ ] Implement location assignment and stock availability checks.
- [ ] Implement payment status and payment records.
- [ ] Link order confirmation, reservation, dispatch and cancellation safely.
- [ ] Implement delivery/rider details and failed-delivery records.
- [ ] Implement order search, filters and operational queues.
- [ ] Test order lifecycle and inventory consistency end to end.

### Phase 4 — Receipts and customer notifications

- [ ] Verify the company-hosted email sending capability.
- [ ] Configure secure backend email credentials and sender identity.
- [ ] Design Dscentsation-branded email templates.
- [ ] Implement unique order and receipt references.
- [ ] Implement receipt generation and paid/unpaid message rules.
- [ ] Send transactional emails from the official Dscentsation company email identity.
- [ ] Record email sending outcomes and failures.
- [ ] Implement dispatch and delivery email notifications.
- [ ] Test email delivery, failure handling and duplicate-send prevention.
- [ ] Evaluate a Nigerian SMS provider for a later notification integration.

### Phase 5 — Sales, expenses and finance

- [ ] Implement sales summaries and payment-method reporting.
- [ ] Implement unpaid and partially paid order tracking.
- [ ] Implement expense categories and expense recording.
- [ ] Implement supporting expense document uploads.
- [ ] Implement expense submission and approval workflow.
- [ ] Implement supplier payment and other outgoing payment records.
- [ ] Implement revenue, cost and expense reporting.
- [ ] Implement clearly labelled estimated profitability reports.
- [ ] Test financial calculations and audit history.

### Phase 6 — Suppliers, procurement, returns and refunds

- [ ] Implement supplier records.
- [ ] Implement purchase orders.
- [ ] Implement goods-received workflow linked to stock locations.
- [ ] Implement supplier invoices and payment tracking.
- [ ] Implement return and exchange requests.
- [ ] Implement return inspection and stock disposition.
- [ ] Implement refund recording and approvals.
- [ ] Test procurement, returns, refunds and resulting stock movements.

### Phase 7 — Reporting and operational oversight

- [ ] Implement dashboard metrics using verified database records.
- [ ] Implement daily, weekly and monthly reports.
- [ ] Implement sales-by-product and sales-by-channel reports.
- [ ] Implement stock and low-stock reports by location.
- [ ] Implement order fulfilment and outstanding-order reports.
- [ ] Implement expense and supplier reports.
- [ ] Implement role-appropriate reporting access.
- [ ] Verify report totals against source transactions.

### Phase 8 — Quality, deployment and handover

- [ ] Add unit tests for business rules.
- [ ] Add integration tests for API and database workflows.
- [ ] Add end-to-end tests for important staff journeys.
- [ ] Review security, permissions and sensitive-data handling.
- [ ] Configure production hosting and secrets.
- [ ] Configure database backups and test restoration.
- [ ] Configure error monitoring and operational logging.
- [ ] Deploy a production-ready version.
- [ ] Run user acceptance testing with Dscentsation staff.
- [ ] Fix issues identified during acceptance testing.
- [ ] Prepare staff instructions and operational handover.

### Phase 9 — Future enhancements and optional extensions

These ideas were raised during product planning. They are documented so future agents and the business can consider them, but they are not commitments for the first release. Prioritisation requires a separate decision.

- [ ] Evaluate WhatsApp Business integration for approved customer communications and operational workflows.
- [ ] Evaluate automatic website-order integration (orders only; never product-catalogue import/synchronisation unless the business changes that decision).
- [ ] Evaluate SMS notifications through a suitable Nigerian provider.
- [ ] Add delivery/rider assignment management and delivery performance reporting.
- [ ] Add discount rules, coupon codes and promotion tracking.
- [ ] Add marketing campaign/source attribution to understand which campaigns generate enquiries and sales.
- [ ] Expand the product image/media library for consistent internal product records.
- [ ] Build a central, permission-controlled document management area for invoices and company documents.
- [ ] Add staff task assignment and internal operational reminders.
- [ ] Evaluate staff attendance and leave tracking if Dscentsation wants HR functionality in this platform.
- [ ] Add customer feedback requests and consent-based follow-up campaigns.
- [ ] Add opt-in birthday greetings and customer milestone messages.
- [ ] Add consent-based personalised product recommendations based on purchase history and recorded preferences.
- [ ] Add advanced business analytics and sales/stock-demand forecasting when enough reliable history exists.
- [ ] Evaluate an AI product assistant and an AI business assistant grounded in authorised DMS records.

Marketing campaigns, birthday messages and product recommendations must respect customer consent and applicable privacy requirements. Operational receipts and order updates remain separate from promotional messages.

### Current project position

**Implemented in `main`:** Application foundation, authentication and employee account administration, Product Management, Customer Management (migration 004), Supplier Directory backend foundation (migration 005), and Task 010 documentation reconciliation.

**Recently shipped:**

- **Task 011 — Customer Management:** merged through PR [#14](https://github.com/egbutaify2-ui/Dscentsation-Management-System/pull/14). Customer database, API/service and tests are in `main`.
- **Task 020 — Supplier Directory backend:** merged through PR [#16](https://github.com/egbutaify2-ui/Dscentsation-Management-System/pull/16), merge commit `64ac4b6a11c3ddce39a3646cdede0d570e338f77`. Migration 005, supplier APIs, audit integration and automated tests are in `main`.

**Active implementation work:**

- **Task 021 — Expense Categories & Draft Expenses:** PR [#17](https://github.com/egbutaify2-ui/Dscentsation-Management-System/pull/17), branch `task-021-expense-foundation`. Backend migration 006 and APIs are implemented in the PR; it needs integration after migration 005. Expense frontend work is continuing in parallel.
- **Task 022 — Order Capture:** independent order-capture components and merged customer integration are being implemented. Database migration 007 follows migration 006.
- **Task 023 — Expense Management frontend:** build the user-facing expense/category screens against the Task 021 API.
- **Task 024 — Supplier Directory frontend:** build the user-facing supplier screens against the merged supplier API.
- **Task 034 — Customer Management frontend:** implement the internal customer register, server-side search by name/phone/email, active/archived/all filters, pagination, profile view/edit, creation and confirmed archive against the already-merged Customer API. Work is on `task-034-customer-management-frontend`; it is independent of PRs #22 and #24.

Customer permission codes (`customers.view`, `customers.create`, `customers.update`, `customers.archive`) remain defined but intentionally unassigned to Owner, Manager and Staff while DMS-DEC-002 is pending. The frontend gates each action by the permission returned in the authenticated session; Task 034 does not change role assignments.

**Remaining build areas:** Inventory balances and movements, order fulfilment, incoming customer payments, receipts and notifications, procurement workflows, returns/refunds, reporting and production deployment still need implementation. Build these in practical increments while keeping independent development moving.


## Working agreement

**We are coding and developing now. The priority is to ship working DMS functionality.**

1. The project manager issues scoped implementation tasks with clear outcomes.
2. Coding agents build features, fix bugs, integrate modules, improve the interface and add the tests needed for delivery.
3. Agents work in parallel where practical. If one integration dependency is pending, build the independent components instead of waiting idle.
4. Keep implementation updates short and useful: report what was built, what works, relevant test results and any genuine blocker.
5. Make necessary engineering decisions close to the code. Do not replace implementation work with another investigation or architecture document unless the project manager specifically asks for it.
6. The project manager checks progress at meaningful milestones and focuses feedback on issues that materially affect functionality, data integrity, security or business operations. Avoid repetitive audit cycles and unnecessary approval ceremonies.
7. Update this README as functionality ships. Do not mark incomplete or merely planned functionality as complete.

Agents should read this README and follow the established repository conventions before making changes. Preserve confirmed business rules and existing data. When a real business decision or technical dependency blocks one part of a feature, isolate that part and continue with the work that can safely be built.


---

**Dscentsation Management System (DMS)**
*One system. Clear records. Better business operations.*
