# Supabase PostgreSQL for DMS staging

**Decision scope:** DMS staging only. The project owner selected Supabase PostgreSQL for staging on 16 November 2026. This selection does not approve a production plan, production data use, or project provisioning.

## Current state and safety boundaries

- No DMS Supabase project has been created or provisioned.
- No DMS database password, connection string or other Supabase credential exists in this repository or has been supplied for this task.
- The Render staging Blueprint has not been applied. No staging service, database connection, migration, deployment, backup or restore test has been performed.
- The existing Supabase project named **Stack-it Project** belongs to a separate product. It must not be opened, connected, changed or reused for DMS.
- Create a separate project for DMS only after the project owner separately authorises provisioning. This document does not create a project or grant that authorisation.

The React frontend, Node/Express API, `pg` pool, SQL migrations and PostgreSQL-backed Express sessions remain unchanged. Supabase is the hosted PostgreSQL provider for the planned staging environment; DMS does not adopt Supabase Auth, the Supabase Data API or a new client-side database architecture.

## 1. Create a separate DMS project when authorised

1. In the approved Supabase organisation, create a new project specifically for DMS. Use a clear DMS staging project name and an approved region; consider the Render API region and expected users when selecting the database region.
2. Confirm the project is independent of **Stack-it Project**. Do not reuse a project reference, database password, API key, organisation secret or connection URL from Stack-it.
3. Select a plan only after checking current capacity, pause behaviour, backup features, region, connection limits and price against the intended staging use. Free is not automatically suitable for operational business records; see [Free-plan limitations](#7-free-plan-limitations-and-production-readiness).
4. Set a unique, strong database password in the Supabase Dashboard. Store it in an approved password manager. Do not send it in chat, add it to Git, place it in a local committed file or reuse an application/session password.

Project creation, plan acceptance and credential generation remain owner-authorised operational actions and are outside this task.

## 2. Copy the exact Shared Pooler Session-mode connection string

For the existing long-running Node API, the default staging choice is the **Shared Pooler — Session mode — port 5432** when the Render network requires IPv4.

1. Open the dedicated DMS project's Supabase Dashboard and select **Connect**.
2. Choose **Session pooler** (shared pooler, session mode).
3. Copy the complete connection string shown by the Dashboard. Use the exact host, port, database name and username supplied there.
4. Do not derive a pooler hostname from the project reference or region. Supabase states that a region can have multiple pooler clusters; the Dashboard is the source of the exact host. Shared-pooler usernames also differ from direct-connection usernames.
5. Confirm that the selected Session Pooler URL uses port `5432`. Do not silently substitute the Transaction Pooler URL on port `6543`.

The Session Pooler is the IPv4-capable alternative to a direct connection. Supabase documents direct connections as IPv6 by default (unless the project's network plan/add-on provides IPv4), while the shared pooler is available over IPv4. Direct database connections may be considered only after Render's outbound IPv6 connectivity has been verified for the actual service.

### Why Session mode, not Transaction mode

The API is a long-running Express process with a persistent `pg.Pool` and PostgreSQL-backed sessions. Session mode preserves a database connection for the lifetime of its client session. Transaction mode on port `6543` returns a connection to the pool after each transaction and does not preserve session-level state between transactions; the shared transaction pooler also has prepared-statement and other session-feature limitations. Those trade-offs are unnecessary for the current API. Do not choose transaction mode without a demonstrated technical requirement and a reviewed compatibility test.

Supabase's connection guide documents the supported modes, IP versions, usernames, ports and Transaction-mode limitations: [Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 3. Set the Render API secret safely

After the dedicated DMS project and exact Session Pooler URL exist:

1. Open the **dms-staging-api** service in the Render Dashboard.
2. Open **Environment** and add/update `DATABASE_URL` with the complete connection string copied from the DMS project's **Connect → Session pooler** dialog.
3. Treat `DATABASE_URL` as a secret. Enter it only in the Render API service's protected Environment settings. Do not put it in `render.yaml`, a PR, a GitHub Actions variable, a frontend setting, a `VITE_*` variable, a ticket or a log.
4. Set `DATABASE_SSL=true` on the API service. The current `apps/api/src/db/pool.ts` maps this setting to TLS with `rejectUnauthorized: true`, which verifies the server certificate. Do not set it to false or disable certificate verification to bypass a connection error.
5. Keep `DATABASE_URL` and all database credentials off **dms-staging-web**. The static frontend needs only its same-origin `/api/*` rewrite.
6. Keep the existing `SESSION_SECRET` generated for the API by Render. It is a separate secret and is not the database password.

The Blueprint declares `DATABASE_URL` as `sync: false` so no connection string is stored or synchronised from Git. The operator supplies the secret through Render's protected service environment settings. `DATABASE_SSL` is explicitly `true`.

### URL-encode reserved password characters

A PostgreSQL URI embeds the password in a URL component. Percent-encode reserved characters in the **password component only** before saving the URI. For example, `@` becomes `%40`, `:` becomes `%3A`, `/` becomes `%2F`, `#` becomes `%23`, `?` becomes `%3F`, and a literal `%` becomes `%25`.

Do not encode the entire connection string, do not double-encode an already encoded password, and do not edit the Dashboard-provided host or username. Prefer a secure URI-encoding tool that does not retain or transmit the password. Never paste the resulting URI into this repository or a support conversation.

## 4. Test connectivity and TLS

Do not mark the connection as verified merely because Render accepted an environment value.

1. Check the Dashboard-provided URL's host, username, database and port against the **Session pooler** selection. Do not print the URL or password when checking it.
2. Confirm the Render API service has `DATABASE_SSL=true`. The API's `pg.Pool` must retain certificate verification (`rejectUnauthorized: true`).
3. With the secret present, run the existing migration step in a controlled staging deployment. A successful `preDeployCommand` database connection and migration is evidence of network, authentication and TLS connectivity. Inspect logs for success/failure messages only; never echo environment values.
4. Confirm API startup passes `assertDatabaseReady()`, then check `GET /api/v1/health` directly and through the frontend's same-origin `/api/v1/health` rewrite.
5. Check Supabase pooler connection limits against the API pool's current maximum of 10 connections per API instance, plus any additional replicas or administrative connections. Do not increase pool size or replicas without a capacity review.
6. If a connection fails, verify the exact Dashboard URL and password encoding, Render environment value, selected port/mode, Supabase network restrictions and certificate chain. Do not switch off TLS verification or change to Transaction mode as a workaround.

A health response alone does not prove a correct backup, successful restore or production-readiness.

## 5. Migration procedure

DMS continues to use checked-in SQL/JavaScript migrations through `node-pg-migrate`; Supabase-specific schema tooling is not substituted for the repository's migration runner.

1. Confirm the DMS project is a clean staging database and the API's `DATABASE_URL` points to that project.
2. Confirm `DATABASE_SSL=true` and the Session Pooler URL uses port `5432`.
3. Review the migration diff and CI evidence before applying any release.
4. Let the Render API's existing `preDeployCommand` run `pnpm db:migrate` before the API starts. The command and API start command are preserved in `render.yaml`.
5. Confirm the migration command completed and the API startup schema check passed. Keep migration logs, commit SHA and deployment record as evidence.
6. Do not edit or apply production schema manually in the Supabase SQL Editor. Do not run destructive rollback commands against staging or production data. The existing production rollback guard remains in force.

The GitHub Actions integration suite continues to use its own disposable PostgreSQL service. It must not be redirected to a hosted Supabase project.

## 6. Backups, exports and restore testing

Backups are an operational requirement, not something this task has configured or verified.

- Before any business data is introduced, assign an operational owner and establish an encrypted, access-controlled **off-site export** location that is independent of the Supabase project. Never store backup files in Git, the web build, public buckets or an unprotected workstation.
- Schedule regular logical exports. A daily encrypted export is a prudent minimum starting recommendation for staging/business data, but final frequency and retention must be agreed against the business's recovery objectives.
- Supabase recommends regular exports for Free projects using its CLI `supabase db dump` command. The CLI's default dump is schema-only; it excludes data and custom roles unless requested. Include schema, data and any required custom-role exports in the backup procedure, and verify the output files are non-empty and readable.
- Supabase-managed schemas such as `auth` and `storage` are excluded from the CLI dump. Database backups also do not include objects stored through the Supabase Storage API. If DMS later adopts those services, define and test separate exports for those objects and their access metadata.
- Encrypt backups in transit and at rest, restrict access, record timestamps and checksums, monitor failed or missing export runs, and retain more than one recovery point under an approved retention schedule.
- Perform a restore test at least monthly as a proposed baseline and after a material backup-process or migration change. Restore into a separate disposable project or isolated database; never overwrite the live source to test recovery.
- After restore, verify schema and migration history, application-table counts, relationships/constraints, a synthetic login/session flow, API startup and health checks. Record duration, missing data, errors and the tested recovery point. Do not claim a restore is tested until this evidence exists.

See Supabase's [Database Backups guide](https://supabase.com/docs/guides/platform/backups) and [CLI `supabase db dump` reference](https://supabase.com/docs/reference/cli/supabase-db-dump). Supabase notes that platform daily backups do not include Storage API objects.

## 7. Free-plan limitations and production readiness

The Supabase Free plan must not be treated as automatically suitable for live DMS business data:

- Free projects may pause after one week of inactivity.
- The Free plan does not include automatic daily database backups.
- The currently published Free plan includes 500 MB of database size per project, shared CPU/500 MB RAM and 5 GB egress. Limits and overage rules can change; check actual usage and the live pricing/limits before choosing a plan.
- The currently published Pro plan includes daily backups with seven-day retention and avoids the Free-plan inactivity pause. Pricing, compute charges and included allowances must still be checked at approval time.

If DMS requires non-pausing service and automatic daily backups before operational reliance, a paid plan should be selected before that reliance. This is a recommendation, not a recorded budget or a purchase approval.

Production readiness remains unresolved under DMS-DEC-019. Before any production adoption, obtain explicit approval of the monthly/annual total cost; region and network fit; capacity and connection limits; availability/reliability expectations; backup frequency/retention; restore procedure and successful restore-test evidence; Recovery Point Objective (RPO), Recovery Time Objective (RTO), monitoring and operational ownership. No RPO, RTO or production budget is approved by this document.

Official references:
- [Supabase database connection options](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase pricing and current plan limits](https://supabase.com/pricing)
