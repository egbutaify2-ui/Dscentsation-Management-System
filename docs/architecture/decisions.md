# Dscentsation Management System — Architecture Decisions

**Document status:** Proposed decisions for project-manager review  
**Task:** 002 — Technical Architecture  
**Decision rule:** Nothing in this document is considered approved until reviewed by the project manager/business owner.

This register records the reasons behind the proposed architecture and separates confirmed product constraints from technical recommendations.

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
- The ORM/data-access library remains an implementation choice to settle when repository scaffolding begins.
- A managed database provider, region, size, backup policy and restore capability must be selected before deployment.

### Data representation conventions

- Money: integer minor units (kobo) plus currency code; no floating-point arithmetic.
- Quantity: fixed-precision numeric values with an agreed unit of measure.
- Timestamps: timezone-aware UTC values; business display/reporting in `Africa/Lagos`.
- Historical line items: snapshot the product description/SKU and transaction price at the time of sale.
- Financial and stock corrections: append a reversal/adjustment event; do not silently overwrite history.

## ADR-005 — Track inventory by variant and location, with a movement ledger

**Status:** Proposed

**Context**

The business holds stock at multiple physical locations. A single product may have sizes/variants. Orders reserve stock before dispatch; transfers have a sending and receiving stage. Inventory accuracy is business-critical.

**Decision**

Use a unique current balance per (`location_id`, `product_variant_id`), and maintain an append-only stock movement ledger. Track active order reservations explicitly. Use transfer header/item records for inter-location movements.

**Why**

- Product-level totals alone cannot show where stock is held.
- A movement ledger explains how each balance changed and supports audit/reconciliation.
- Reservations prevent the same stock being promised to multiple confirmed orders.
- Explicit transfer dispatch and receipt prevents destination stock appearing before the goods arrive.
- Transactional updates and row locks protect concurrent order confirmation.

**Consequences**

- Available stock is calculated as on-hand minus reserved.
- Reserve, release, dispatch, transfer, receipt and adjustment operations must be atomic.
- Idempotency keys are required for retryable commands.
- The business must approve stock reservation timing, partial fulfilment, transfer approvals and the base unit/precision.

## ADR-006 — Enforce role-based and location-based permissions in the backend

**Status:** Proposed

**Context**

The system has three known roles: Owner, Manager and Staff. Some users may only work with assigned physical locations. Sensitive actions include financial access, expense approvals, refunds, user management and stock adjustments.

**Decision**

Use explicit permission records mapped to Owner, Manager and Staff roles. Add user-to-location access records to support location restrictions. Enforce permissions in backend middleware and domain services with deny-by-default behaviour.

**Why**

- Hiding UI controls is not a security boundary.
- A permission registry makes the final role matrix auditable and adjustable.
- Location restrictions are an additional scope rule, not an alternative role.
- Backend enforcement protects direct API requests as well as normal UI actions.

**Consequences**

- Exact role permissions, approval limits and cross-location visibility remain pending business approval.
- Owner access to all locations is the proposed default.
- Staff and Manager access can be constrained by explicit assignments.
- Any change to a user's role or location grants should create an audit record.

## ADR-007 — Prefer individual accounts and revocable server-side sessions

**Status:** Proposed

**Context**

DMS contains personal customer details, operational records and financial information. A small team still needs individual accountability and remote access.

**Decision**

Use individual invited/provisioned accounts. Hash passwords with Argon2id. Prefer opaque server-side sessions delivered through secure, `HttpOnly`, `SameSite` cookies; store session state server-side and support session revocation. Require HTTPS in hosted environments and CSRF protection for cookie-authenticated mutations.

**Why**

- Shared logins prevent reliable attribution.
- Server-side sessions can be invalidated centrally when an account is disabled or a session is compromised.
- Avoids storing long-lived bearer tokens in browser local storage.
- A password-reset flow can use short-lived, single-use, hashed reset tokens.

**Consequences**

- Public self-registration is not part of the initial design.
- Login throttling, secure cookies, CSRF controls, password reset, session expiry and logout invalidation must be tested.
- Email-based account recovery depends on verifying the company/transactional email service; it must not expose privileged account creation.
- Whether MFA is required for Owner/Manager accounts is a security policy question to confirm before launch.

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

## ADR-010 — Use Render as the proposed application hosting platform

**Status:** Proposed deployment direction; no services have been created

**Context**

The README identifies Render as the proposed application host. The system requires a React frontend, Express API, PostgreSQL and potentially a worker.

**Decision**

Target a Render-hosted frontend and Express API, with a managed PostgreSQL database reachable through private networking. A Render Postgres instance is a candidate to verify. Use a separate worker service only when email/background processing is introduced. Keep file storage in the selected private object-storage provider.

**Why**

- Matches the hosting direction already documented.
- Keeps the first deployment topology small.
- Separates web/API process concerns while preserving one database transaction boundary.
- Allows environment-specific configuration and secret management.

**Consequences**

- The exact database product, region, plan, backups, restore support, service sizing, custom domains and cost must be checked before provisioning.
- Use separate staging and production configurations.
- Run migrations as a controlled deployment step, not concurrently at every application startup.
- Production rollout remains gated by review and acceptance testing.
- No deployment is part of Task 002.

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

**Status:** Proposed, aligned to confirmed reporting requirements

**Context**

The README requires reports to distinguish sales, actual payments received, product costs, expenses and estimated profit. Orders may be unpaid or partially paid; refunds and corrections need history.

**Decision**

Keep order totals, payment events, refunds, expenses and cost snapshots separate. Derive outstanding balances and payment state from verified events or update a transactional summary with strict reconciliation rules.

**Why**

- Order value is not the same as cash received.
- A partial payment cannot be represented accurately by a single boolean.
- Refunds and corrections must not erase the original receipt.
- Estimated profit must not be presented as audited accounts.

**Consequences**

- Payment verification, payment methods and refund approval limits require business rules.
- No payment gateway or automated bank reconciliation is assumed.
- Finance reports must label estimates clearly and use verified source records.

## 3. Decisions requiring project-manager confirmation

The technical proposal cannot finalise these business rules on its own:

| Topic | Proposed default | Confirmation needed |
|---|---|---|
| Role matrix | Owner full access; Managers operational and approved management actions; Staff task-scoped access | Exact view/create/edit/approve/export permissions by module |
| Location scope | Owner sees all; Staff may be location-scoped; Manager scope configurable | Actual assignments and cross-location rules |
| Stock reservation | Reserve when order is confirmed | Whether order confirmation requires payment/deposit and how long reservations may remain open |
| Partial fulfilment | Model supports it, but workflow can be deferred | Whether one order may ship from multiple locations or in multiple deliveries |
| Transfers | Dispatch at source; increase destination only on confirmed receipt | Whether transfer creation, dispatch and receipt require separate approvals |
| Payments | Staff can record reported payment; authorised role verifies | Accepted methods, evidence and verification permissions |
| Refunds | Separate request, approval and processing | Role/amount approval limits and return-inspection dependency |
| Product variants | Stock each sellable variant | Whether all product records have variants and the unit/precision used |
| Company email | Provider-neutral SMTP/API adapter | Provider, sender mailbox, authentication and sending permissions |
| Database hosting | Managed PostgreSQL; Render Postgres candidate | Provider, region, plan, backup and recovery expectations |
| File storage | Private Supabase Storage or equivalent | Provider, region, permitted file types, size and retention |
| Privacy/retention | Least data necessary; access by role | Retention periods, deletion/correction policy and applicable compliance review |
| First-release procurement | Data model includes suppliers, POs and goods receipts | Whether all procurement functions ship in initial release or a later phase |

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