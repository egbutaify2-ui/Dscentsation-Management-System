# Dscentsation Management System (DMS)

A centralised internal business management platform for Dscentsation's Nigerian operations. DMS is being planned to bring orders, inventory, customers, sales, expenses, suppliers, receipts and operational reporting into one reliable system.

> **Project status:** Requirements and initial project documentation are established. Application implementation has not started. The checklist below is the source of truth for progress and will be updated only after work is reviewed and verified.

## Contents

- [Product vision](#product-vision)
- [Business context and confirmed decisions](#business-context-and-confirmed-decisions)
- [Scope and boundaries](#scope-and-boundaries)
- [Modules and planned capabilities](#modules-and-planned-capabilities)
- [Core business workflows](#core-business-workflows)
- [Users and permissions](#users-and-permissions)
- [Inventory rules](#inventory-rules)
- [Proposed technology](#proposed-technology)
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
| Inventory | Multiple physical stock locations |
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
- Optionally restrict staff to assigned stock locations.
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

| Role | Intended access |
|---|---|
| **Owner** | Full business oversight, user and system administration, financial visibility, approvals, reports and all stock locations. |
| **Manager** | Day-to-day operations, orders, customers, inventory, suppliers, returns, permitted reports and authorised approvals. |
| **Staff** | Restricted operational access for assigned tasks, such as registering orders, customers, receipts and permitted stock actions. |

Permissions must be enforced by backend APIs and database access patterns, not only by hiding buttons in the user interface. The exact permission matrix will be defined during architecture and authentication work.

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

## Proposed technology

The initial technical direction is:

| Layer | Proposed technology |
|---|---|
| Web frontend | React |
| Backend API | Node.js and Express |
| Database | PostgreSQL |
| Application hosting | Render |
| File storage | Supabase Storage or an equivalent suitable service |
| Authentication | Secure server-side authentication and role-based authorisation |
| Email | Dscentsation's company-hosted email through a verified SMTP/API sending integration |
| SMS | A suitable Nigerian provider, to be selected if/when SMS is implemented |

These are the agreed proposed technologies, not evidence of an existing implementation. Specific hosting, database and email configuration must be verified before deployment.

The application should be modular, with clear boundaries between orders, inventory, finance, customers, notifications and administration.

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

This checklist is the project's shared progress record. It is intended to help future coding agents and contributors understand what has been decided, what is complete and what comes next.

**A checkbox is marked complete only after the work has been implemented (where applicable), reviewed and supported by evidence.** Planning a feature does not count as implementing it.

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
- [x] Document and independently review the Sheraton-to-Warehouse stock pickup workflow, separate Warehouse and Sheraton stock balances, restricted Staff pickup permissions and ADR-016 security boundaries (Task 002; merged PRs #3 and #4).
- [ ] Verify the current company email provider's supported SMTP/API sending method and requirements.
- [ ] Identify and name the actual stock locations and their operating processes.
- [ ] Agree the detailed role/permission matrix and approval limits.
- [ ] Finalise operational rules for payment verification, order cancellation, dispatch, returns and refunds.
- [ ] Approve the initial technical architecture and deployment plan.

### Phase 1 — Application foundation

- [ ] Define repository structure and development conventions.
- [ ] Set up frontend and backend applications.
- [ ] Configure code quality tools, formatting and linting.
- [ ] Configure development, test and production environment variables.
- [ ] Establish PostgreSQL database and migration workflow.
- [ ] Define the database schema and entity relationships.
- [ ] Implement authentication and secure sessions.
- [ ] Implement Owner, Manager and Staff roles and backend permissions.
- [ ] Implement audit logging for sensitive actions.
- [ ] Build the main application layout, navigation and responsive dashboard shell.

### Phase 2 — Products and multi-location inventory

- [ ] Implement manual product creation, editing and archiving.
- [ ] Implement product categories and optional variants/SKUs.
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

**Completed:** Business discovery, core requirements, product scope decisions, public repository creation, initial project documentation and Task 002 architecture work for the Sheraton-to-Warehouse pickup workflow (ADR-016), independently reviewed and merged in PRs #3 and #4.

**Current task:** Resolve the remaining architecture decisions and continue implementation planning. Task 002 and its approved pickup architecture are complete, but overall technical architecture approval and deployment plan approval remain pending.

**Not yet implemented:** No database has been provisioned. The application, authentication, dashboard, business modules, integrations and deployment have not been implemented.

**Next development task:** Resolve the remaining architecture decisions, confirm the repository structure and database boundaries, and agree the implementation sequence before application code is introduced.

## Working agreement

The project is managed in small, reviewable tasks:

1. The project manager defines one clearly scoped task and its acceptance criteria.
2. A coding agent inspects the repository and implements that task.
3. The agent reports files changed, important decisions, test commands/results, Git status and relevant diffs.
4. The implementation is reviewed against the requirements. Unsupported claims are not accepted.
5. Corrections are made before the task is approved.
6. Only verified work is marked complete in this README.
7. The next task is issued after review.

Agents must read this README before making changes. If implementation reveals a requirement conflict or a necessary design decision, they must report it rather than silently changing the agreed scope.

---

**Dscentsation Management System (DMS)**  
*One system. Clear records. Better business operations.*
