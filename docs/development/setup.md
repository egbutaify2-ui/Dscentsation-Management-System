# DMS Development Setup

This guide covers the local application foundation only. It does not authorise production deployment, Render provisioning, production credentials or the use of real business data.

## 1. Toolchain

The workspace is pinned to:

- Node.js 26.13.0 (Active LTS).
- pnpm 12.16.1.
- React 19.3.0 and Vite 8.3.5.
- Express 5.3.0 and TypeScript 6.0.3.
- PostgreSQL access through `pg` 8.23.1 and migrations through `node-pg-migrate` 9.0.0.

The repository uses one pnpm workspace and one root `pnpm-lock.yaml`. Do not create app-level lockfiles or use npm/yarn.

## 2. First-time setup

1. Install Node.js 26.13.0 and enable Corepack.
2. From the repository root, run `corepack enable`.
3. Copy `.env.example` to `.env`.
4. Replace the local database URL and session secret with values for your own development environment.
5. Create a local PostgreSQL database matching `DATABASE_URL`.
6. Run `pnpm install --frozen-lockfile`.
7. Run `pnpm db:migrate`.
8. Start both apps with `pnpm dev`.

Vite runs at `http://localhost:5173` and proxies `/api` to `http://localhost:4000`. The API accepts same-origin mutations from the configured `APP_ORIGIN`.

## 3. Environment variables

| Variable                         | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`                       | `development`, `test` or `production`.                             |
| `PORT`                           | API listen port; defaults to 4000.                                 |
| `DATABASE_URL`                   | PostgreSQL connection string.                                      |
| `DATABASE_SSL`                   | Enable certificate-verified TLS for PostgreSQL.                    |
| `SESSION_SECRET`                 | Random session-signing secret, minimum 32 characters.              |
| `SESSION_IDLE_TIMEOUT_MINUTES`   | Idle session lifetime.                                             |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | Absolute session lifetime independent of activity.                 |
| `COOKIE_SECURE`                  | Must be true for production/HTTPS environments.                    |
| `TRUST_PROXY`                    | Enable only behind a trusted reverse proxy.                        |
| `APP_ORIGIN`                     | Exact browser origin permitted for cookie-authenticated mutations. |
| `VITE_API_PROXY_TARGET`          | Local Vite proxy target; not a secret.                             |

The timeout values in `.env.example` are local-only placeholders, not approved production session policy. Production startup refuses to continue when timeout values are missing, cookies are not secure, or the application origin is not HTTPS. Do not copy example values into production as approved policy.

Generate a unique random session secret for every environment. Never commit `.env`, credentials, tokens or real customer/financial data.

## 4. Database migrations

The initial migration creates only:

- `roles`, `permissions`, `role_permissions`
- `users`
- `locations`, `user_location_access`
- `user_sessions` (`connect-pg-simple`-compatible PostgreSQL session table)
- `audit_logs`

Apply migrations explicitly with `pnpm db:migrate`. The API does not run migrations on startup; it checks that the foundation migration was already applied and fails with an instruction if the schema is missing.

A rollback command is available as `pnpm db:rollback` for non-production environments only. The migration CLI refuses the `down` direction when `NODE_ENV=production`, exits non-zero and does so before invoking the migration runner. Normal `up` migrations remain available in production. For verification or recovery exercises, use a clean disposable development/test PostgreSQL database, inspect the migration `down` function and confirm the database contains no valuable data before running `pnpm db:rollback`; then reapply with `pnpm db:migrate` as appropriate. The initial rollback drops the foundation tables and their data. Never bypass this guard or run a destructive rollback against production data.

Role/permission seeds use stable codes and `ON CONFLICT DO NOTHING`. No physical locations or Staff assignments are seeded. Actual Warehouse/Sheraton records and assignments remain unprovided and are not invented.

## 5. Initial Owner bootstrap

Public self-registration is disabled. Create the first Owner account from an interactive terminal:

```bash
pnpm owner:create
```

The CLI asks for email and display name, then prompts for a password without echoing it. The password is entered twice. The command refuses to create a second Owner; it accepts no password argument and has no hard-coded account or credentials.

The Owner is created only after migrations. Creation is recorded in the append-only audit log.

## 6. Authentication and authorisation

The API provides:

- `GET /api/v1/health`
- `GET /api/v1/auth/csrf`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/session`
- `GET /api/v1/auth/capabilities` (authenticated)

Sessions use opaque cookies and PostgreSQL storage; production has no in-memory fallback. Cookies are HttpOnly, SameSite=Lax and secure in production. Session IDs rotate at login; a reusable rotation helper is provided for future privilege changes. CSRF protection checks the exact configured Origin and a session-bound token for state-changing requests.

Seeded permissions are limited to confirmed rules: payment entry (all roles), payment verification (Owner/Manager only), destination-assigned transfer receipt (Staff plus a location-assignment check), and the dedicated Warehouse-to-assigned-Sheraton pickup action (Staff plus ADR-016 source/destination/assignment checks). The related workflows are not implemented here.

The login rate limiter uses an in-process counter. It provides initial endpoint throttling but is not a distributed/global rate limiter for multiple API instances. A shared store requires a separate technical decision before horizontal scaling.

MFA has not been implemented or approved. Session idle/absolute timeout configuration is required for production, but values remain unapproved. Production deployment is not part of this task.

## 7. Checks

From the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm db:migrate
pnpm test
pnpm build
```

API integration tests require a disposable PostgreSQL database. Set `NODE_ENV=test`, `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN` and test timeout values. The suite uses synthetic `.invalid` user identities and synthetic location rows; run it against a disposable database only.

## 8. Technical choices for follow-up documentation

This task adopts explicit SQL through `pg` and migrations through `node-pg-migrate`, without an ORM. It uses `connect-pg-simple` for persistent sessions and a session-bound synchronizer token plus exact-Origin validation for CSRF. These choices should be recorded in a separate, reviewed architecture documentation update; this task does not rewrite ADRs or the decision register.
