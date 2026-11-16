# DMS Render application staging

This guide describes the planned Render-hosted frontend and API for DMS staging, with Supabase PostgreSQL as the separately managed staging database. It is infrastructure configuration, not a deployment record.

**Current status:** The Render Blueprint has not been applied. No Render staging service or DMS Supabase project has been created, no credentials exist for DMS staging, and no migrations or live smoke tests have been run. The project owner selected Supabase PostgreSQL for DMS staging on 16 November 2026; this is not production database approval. See [Supabase PostgreSQL operations](./supabase-postgres.md).

## Resources

The root `render.yaml` defines exactly two Render application resources:

| Resource | Render type | Configuration |
| --- | --- | --- |
| `dms-staging-api` | Node web service | Frankfurt, `0.5c-512mb`; builds and runs the Express API |
| `dms-staging-web` | Static site | Static frontend published from `apps/web/dist` |

PostgreSQL is external to this Render Blueprint. The Blueprint does not define a Render database resource. A separate DMS Supabase project must be created only after separate owner authorisation. Never use the unrelated **Stack-it Project**.

## Application settings verified in the repository

- The workspace uses pnpm 12.16.1 and pins Node.js 26.13.0 in `.nvmrc`; the root `package.json` requires Node 26.13.x. The Blueprint sets `NODE_VERSION=26.13.0` explicitly on both services.
- API build: `pnpm --filter @dms/api build`. API start: `pnpm --filter @dms/api start`, which runs the API production entry point.
- API health: `GET /api/v1/health`.
- The API calls `listen(env.PORT)` and calls `assertDatabaseReady()` before binding. The database must therefore be reachable and migrated before the API starts.
- API migrations: root script `pnpm db:migrate`. The migration runner applies checked-in upward migrations. Production rollback is explicitly disabled by the current CLI.
- Frontend build: `pnpm --filter @dms/web build`; Vite publishes `apps/web/dist`.
- The frontend calls relative `/api/v1` paths with `credentials: 'include'`. `VITE_API_PROXY_TARGET` is only the Vite development-server proxy setting.
- The API has no CORS middleware. CSRF middleware requires the request `Origin` to equal `APP_ORIGIN`. Session cookies are HTTP-only, SameSite=Lax and use the `__Host-` prefix when secure cookies are enabled.

### Same-origin frontend/API routing

The static site's first rewrite forwards `/api/*` to the API service's public Render URL while keeping the browser URL on the static-site origin. The second rewrite sends remaining paths to `/index.html` for the React SPA. The API therefore sees the browser's frontend origin, and the browser can store the secure session cookie on the frontend host without cross-origin CORS configuration.

Do not replace the API rewrite with a browser redirect. Do not change the frontend to call the API hostname directly unless the app's CORS and CSRF policies are deliberately redesigned and reviewed. The API rewrite must remain before the SPA fallback.

## Configure the staging environment after separate authorisation

1. Obtain separate owner authorisation before creating a DMS Supabase project. Follow [Supabase PostgreSQL operations](./supabase-postgres.md). Do not access or reuse **Stack-it Project**.
2. In that DMS project, copy the exact **Connect → Session pooler** connection string. Use Shared Pooler Session mode on port `5432` as the default when IPv4 is required. Never construct or guess the host or username.
3. Set the Render API's `DATABASE_URL` manually in the protected service Environment settings. Use the full Dashboard-provided URI; URL-encode reserved password characters in the password component only. Do not put the URL in Git, the Blueprint, frontend variables or logs.
4. Set API `DATABASE_SSL=true`. The existing API pool applies TLS with certificate verification (`rejectUnauthorized: true`).
5. In the Render Dashboard, choose **New → Blueprint**, connect `egbutaify2-ui/Dscentsation-Management-System`, select `main`, and inspect the proposed resources. It must contain only `dms-staging-api` and `dms-staging-web`; it must not create a database resource.
6. Supply the real static-site URL as API `APP_ORIGIN`. The expected Render slug is `https://dms-staging-web.onrender.com`, but confirm the actual hostname before setting it. The API rewrite destination currently expects `https://dms-staging-api.onrender.com`; update that destination only if Render assigns a different API hostname and review the change.
7. Confirm `DATABASE_URL`, `DATABASE_SSL`, `APP_ORIGIN` and the generated `SESSION_SECRET` exist only on the API. Do not copy database/session secrets into the static site.
8. Review the Render API service plan and Supabase plan/limits and approve their costs before applying any Blueprint. This task does not apply the Blueprint or deploy either service.

The API and frontend deploy from `main` only after GitHub checks pass. The Blueprint remains pinned to `main`, not this task branch.

## Environment variables

Only the API service receives backend settings. The static site receives no backend environment variables and no secrets.

| Variable | Value/source | Service | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | API | Enables production security checks |
| `NODE_VERSION` | `26.13.0` | API and static site | Matches the repository toolchain |
| `PORT` | Supplied by Render | API | HTTP listener port; do not hard-code |
| `DATABASE_URL` | Manually supplied secret from the DMS Supabase Dashboard's Session Pooler connection dialog; `sync: false` in Blueprint | API only | PostgreSQL connection |
| `DATABASE_SSL` | `true` | API only | Enables certificate-verified TLS |
| `SESSION_SECRET` | Render-generated random value | API only | Signs session cookies |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` | API | Staging idle session lifetime |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | `12` | API | Staging absolute session lifetime |
| `COOKIE_SECURE` | `true` | API | Enables secure `__Host-dms.sid` cookie |
| `TRUST_PROXY` | `true` | API | Trusts Render's HTTPS proxy headers |
| `APP_ORIGIN` | Manually supplied actual static-site HTTPS origin; `sync: false` | API | Exact origin required by CSRF middleware |
| `INVITATION_EXPIRY_HOURS` | `24` | API | Invitation expiry |

`DATABASE_URL` and `SESSION_SECRET` must never be copied into the frontend. Do not add `DATABASE_URL`, `SESSION_SECRET`, SMTP keys or any private value to a `VITE_*` variable: Vite embeds frontend build variables in public browser assets. The static-site rewrite handles production API routing, so `VITE_API_PROXY_TARGET` is not set in the production frontend.

Render does not store the value of a `sync: false` variable in the Blueprint. Keep the secret in the API service's protected Environment settings, and update it there if it rotates.

## Migrations and deployment ordering

The API's `preDeployCommand` is preserved:

```sh
npm install --global pnpm@12.16.1 &&
NODE_ENV=development pnpm install --frozen-lockfile &&
pnpm db:migrate
```

The API build command installs workspace development dependencies before compiling TypeScript. Render runs pre-deploy after the build and before switching the service to the new deploy. The migration command must connect to the dedicated DMS Supabase database and finish successfully before the API starts. Set the API's secret `DATABASE_URL` and `DATABASE_SSL=true` before the first deploy; a missing or invalid connection causes migration/startup failure.

The migration runner applies only the checked-in upward migrations. Do not add destructive rollback operations to deployment commands. Review new migrations and compatibility with the currently deployed app before merging and deploying them. The start command remains `pnpm --filter @dms/api start`; it does not run migrations at startup.

## Initial staging Owner account

Only after an owner-approved staging deployment reports healthy and migrations have completed:

1. Open `dms-staging-api` in the Render Dashboard and launch its Shell.
2. Ensure pnpm 12.16.1 is available.
3. Run `pnpm --filter @dms/api owner:create`.
4. Supply a staging Owner email and display name, then enter a unique staging-only password when the hidden password prompts appear.
5. Confirm the success message and sign in through the staging frontend.

The CLI is interactive, hashes the password with Argon2id, writes an audit event and refuses to create a second initial Owner. Do not put an Owner password in the Blueprint, source control, deployment command, environment variables or logs. Do not use production user accounts or passwords.

## Verification checklist after an approved deployment

1. **Direct API health:** open the actual API hostname at `/api/v1/health`; expect HTTP 200 and the API health JSON.
2. **Frontend and rewrite:** open the static-site URL and then `/api/v1/health` on the same frontend host. It should return the API health JSON through the same-origin rewrite.
3. **Database/TLS:** inspect the pre-deploy migration output and API startup logs for successful database connection and schema readiness. Never print environment values.
4. **Browser requests:** sign in and confirm requests use the frontend host with paths such as `/api/v1/auth/csrf` and `/api/v1/auth/login`, not direct browser requests to the API host.
5. **Cookie:** confirm the session cookie is `__Host-dms.sid`, Secure, HttpOnly, Path=/, SameSite=Lax and has no Domain attribute.
6. **CSRF/session:** confirm sign-in, authenticated session refresh and logout succeed. Verify that an unsafe request with the wrong Origin is rejected.
7. **Data isolation:** verify that only synthetic staging/test records are present. Never import or connect production business data as part of staging setup.

These are acceptance checks for a future approved deployment. None has been performed by this documentation/configuration task.

## Troubleshooting and cost

- **Migration or API startup failure:** verify the API's secret `DATABASE_URL` is the exact DMS Session Pooler URI from Dashboard Connect, port is `5432`, the password is URL-encoded correctly, and `DATABASE_SSL=true`.
- **Connection-limit errors:** compare the API pool's maximum (10 per instance) and replica count with current Supabase shared-pooler limits and project usage. Do not increase the pool without checking the selected plan.
- **TLS errors:** verify the certificate chain and environment setting. Do not set `DATABASE_SSL=false` or turn off certificate verification.
- **Rewrite failures:** test direct API health first. If that works but the frontend health path does not, check the API rewrite ordering and its actual hostname.
- **CSRF failures:** ensure `APP_ORIGIN` exactly matches the frontend's HTTPS origin, with no trailing path or slash.

No combined Render/Supabase monthly cost has been approved or calculated. Check current Render service charges and the selected Supabase plan, compute, storage, egress and backup charges before deployment. Production backup, restore, availability, reliability and total-cost approval remain open under DMS-DEC-019.

## References

- [Supabase PostgreSQL connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase pricing](https://supabase.com/pricing)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render pre-deploy and deployment lifecycle](https://render.com/docs/deploys)
- [Render static-site rewrites](https://render.com/docs/redirects-rewrites)
