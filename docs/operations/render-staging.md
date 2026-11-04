# DMS Render staging

This guide describes a **staging-only** Render environment for the repository at baseline `f43b14fa310e20ef26d4ae35e46382b14163a4a9`.

It is infrastructure configuration, not a deployment record. The Blueprint has not been applied, and no Render resource has been created or changed.

## Resources

The root `render.yaml` defines three separate staging resources:

| Resource | Render type | Configuration |
| --- | --- | --- |
| `dms-staging-api` | Node web service | Frankfurt, `0.5c-512mb`, paid so its pre-deploy migration command is available |
| `dms-staging-web` | Static site | Global CDN; no always-on compute instance |
| `dms-staging-db` | Render Postgres | Frankfurt, `0.1c-256mb`, 1 GB disk, PostgreSQL 17 |

The names and service URLs are staging identifiers. Do not reuse production databases, credentials, domains or data. The database Blueprint denies external IP connections; the API uses Render's private `connectionString` reference.

## Application settings verified in the repository

These settings were read from the application at the required baseline, rather than inferred from a generic Render template:

- The workspace is pnpm 12.16.1 and pins Node.js 26.13.0 in `.nvmrc`; the root `package.json` also requires Node 26.13.x. The Blueprint sets `NODE_VERSION=26.13.0` explicitly on both services so Render's changing default Node version cannot drift from the toolchain.
- API build: `pnpm --filter @dms/api build`. API start: `pnpm --filter @dms/api start`, which runs `node dist/server.js` from the API workspace.
- The API calls `listen(env.PORT)` without hard-coding a port or passing an explicit hostname; the listening port is Render's `PORT`. It calls `assertDatabaseReady()` before binding, so the schema must be migrated first. Confirm public reachability in the post-deploy smoke test; this infrastructure-only task does not change the server bind implementation.
- API health: `GET /api/v1/health`, returning `{ "data": { "status": "ok" } }`.
- API migrations: root script `pnpm db:migrate`. The existing migration runner runs upward migrations in one transaction. Production rollback is explicitly disabled by the current CLI.
- Frontend build: `pnpm --filter @dms/web build`; Vite publishes `apps/web/dist`.
- The frontend calls relative `/api/v1` paths with `credentials: 'include'`. `VITE_API_PROXY_TARGET` is only the Vite development-server proxy setting; it is not a production API-origin setting.
- The API has no CORS middleware. Its CSRF middleware requires the request `Origin` to equal `APP_ORIGIN`. Session cookies are HTTP-only, SameSite=Lax and use the `__Host-` prefix when secure cookies are enabled.

### Same-origin frontend/API routing

The static site's first rewrite forwards `/api/*` to the API service's public Render URL while keeping the browser's URL on the static-site origin. The second rewrite sends remaining paths to `/index.html` for the React SPA. The API therefore sees the browser's frontend origin and the browser can store the secure session cookie on the frontend host without a cross-origin CORS configuration.

Do not replace the API rewrite with a browser redirect. Do not change the frontend to call the API hostname directly unless the app's CORS and CSRF policies are deliberately redesigned and reviewed.

The browser-visible same-origin behavior, including POST bodies, `Set-Cookie`, CSRF headers and subsequent session requests, still needs a live staging smoke test after an owner-approved Blueprint apply. It has not been tested against a deployed service.

## Create the staging environment

1. Review and merge the Task 026 PR into `main`. Merging this PR alone does not create infrastructure.
2. In the Render Dashboard, choose **New → Blueprint**, connect `egbutaify2-ui/Dscentsation-Management-System`, select `main`, and choose the root `render.yaml`.
3. Inspect the proposed resource list before approving it. It must contain only `dms-staging-api`, `dms-staging-web` and `dms-staging-db`. Do not select or attach any existing production service or database.
4. When prompted for the `APP_ORIGIN` value, enter the actual static-site URL. With the name in this Blueprint it is expected to be `https://dms-staging-web.onrender.com`. Confirm the generated hostname in Render before entering it; use the actual URL if Render assigns a different one.
5. Confirm the API service's actual public `onrender.com` hostname as well. If Render assigns a different slug from `dms-staging-api.onrender.com`, update the static site's `/api/*` rewrite destination in `render.yaml` to that exact API URL before syncing the Blueprint. Allow Render to generate `SESSION_SECRET`; do not enter a production session secret. Review the internal database reference and Frankfurt region, then apply only after the staging owner approves the paid resources.

The API and frontend are configured to deploy from `main` only after GitHub checks pass. The Blueprint is intentionally not configured to deploy the Task 026 feature branch.

## Environment variables

Only the API service receives backend settings. The static site receives **no backend environment variables and no secrets**.

| Variable | Value/source | Service | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | API | Turns on the app's production security checks |
| `NODE_VERSION` | `26.13.0` | API and static site | Matches the repository's `.nvmrc` and package engine |
| `PORT` | Supplied by Render | API | HTTP listener port; do not hard-code one |
| `DATABASE_URL` | Render `fromDatabase` reference to `dms-staging-db.connectionString` | API | Private database connection |
| `DATABASE_SSL` | `false` | API | Uses the private Render database URL, not a public external URL |
| `SESSION_SECRET` | Render-generated random value | API | Signs session cookies |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` | API | Idle session lifetime |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | `12` | API | Absolute session lifetime |
| `COOKIE_SECURE` | `true` | API | Enables secure `__Host-dms.sid` cookie |
| `TRUST_PROXY` | `true` | API | Trusts Render's HTTPS proxy headers for secure cookies |
| `APP_ORIGIN` | Manually supplied `https://dms-staging-web.onrender.com` (or actual assigned static-site URL) | API | Exact origin required by CSRF middleware |
| `INVITATION_EXPIRY_HOURS` | `24` | API | Invitation expiry |

`DATABASE_URL` and `SESSION_SECRET` are never copied into the frontend. Do not add `DATABASE_URL`, `SESSION_SECRET`, SMTP keys or any private value to a `VITE_*` variable: Vite embeds frontend build variables in public browser assets. This configuration does not set `VITE_API_PROXY_TARGET`; the static-site rewrite handles production routing.

The `APP_ORIGIN` variable uses `sync: false`, so Render prompts for it on the initial Blueprint creation. Render does not prompt for `sync: false` values on later Blueprint syncs; update it manually in the API service's Environment page if the static-site hostname ever changes.

## Migrations and deployment ordering

The API's `preDeployCommand` runs:

```sh
npm install --global pnpm@12.16.1 &&
NODE_ENV=development pnpm install --frozen-lockfile &&
pnpm db:migrate
```

Render runs pre-deploy after the build and before switching the service to the new deploy. It runs on a separate instance, so this command installs pnpm and the workspace development dependencies again. That matters because this repository's migration runner (`tsx`) and `node-pg-migrate` are development dependencies. The `NODE_ENV=development` prefix applies only to dependency installation; the migration command then inherits the API service's `NODE_ENV=production` and the production security settings.

The API build command also installs the workspace with development dependencies before compiling TypeScript. The start command uses the existing production start script and does not run migrations. The API's own startup check refuses to listen if required tables are missing.

Migrations run automatically before each API deploy. They only run upward through the existing migration runner. Do not add destructive rollback operations to Render commands. Review new migrations and their compatibility with the currently deployed app before merging and deploying them.

Render's pre-deploy command is available for paid web services. The API plan in this Blueprint is therefore paid; a free API plan is not a compatible substitute for this migration arrangement.

## Initial staging Owner account

After the first deployment reports healthy and the API database migrations have completed:

1. Open the `dms-staging-api` service in Render and launch its Shell.
2. Ensure the pinned pnpm CLI is available in that shell:

   ```sh
   npm install --global pnpm@12.16.1
   ```

3. Run the existing interactive bootstrap command:

   ```sh
   pnpm --filter @dms/api owner:create
   ```

4. Supply the staging Owner email and display name. Enter a unique staging-only password when the hidden password prompts appear; the CLI requires at least 12 characters and asks for confirmation.
5. Confirm the success message and sign in at the staging frontend.

The CLI is explicitly interactive (TTY required), hashes the password with Argon2id, writes an audit event and refuses to create a second initial Owner. Do not put an Owner password in the Blueprint, source control, deployment command, environment variables or logs. Do not use production user accounts or passwords.

## Verification checklist after deployment

1. **Direct API health:** open `https://dms-staging-api.onrender.com/api/v1/health`. Expect HTTP 200 and `{ "data": { "status": "ok" } }`.
2. **Frontend and rewrite:** open `https://dms-staging-web.onrender.com`. Then open `https://dms-staging-web.onrender.com/api/v1/health`; it should return the same JSON through the same-origin rewrite.
3. **Browser requests:** sign in and confirm requests use the frontend host with paths such as `/api/v1/auth/csrf` and `/api/v1/auth/login`, not direct browser requests to the API host.
4. **Cookie:** confirm the session cookie is `__Host-dms.sid`, Secure, HttpOnly, Path=/, with SameSite=Lax, and has no Domain attribute.
5. **CSRF/session:** confirm a normal sign-in, authenticated session refresh and logout all succeed. Verify that an unsafe request with the wrong Origin is rejected.
6. **Schema:** inspect API logs for successful startup after migrations. If startup reports missing application tables, stop and inspect the pre-deploy migration logs; do not manually run rollback.
7. **Data isolation:** verify only staging/test records are present. Never import or connect production business data as part of this task.

These checks are manual acceptance tests for the first approved deployment. This Task 026 PR does not claim they have passed.

## Logs and troubleshooting

- **API build and migration logs:** Render Dashboard → `dms-staging-api` → Events/Deploys → select the deploy and inspect build and pre-deploy output.
- **API runtime logs:** the API service's Logs tab. Startup errors include a message when required tables are missing.
- **Frontend build logs:** Render Dashboard → `dms-staging-web` → Deploys → selected deploy.
- **Database events/metrics:** open `dms-staging-db` in the Render Dashboard and inspect connection/CPU/storage metrics.
- **Rewrite failures:** test the direct API health URL first. If it works but the frontend `/api/v1/health` path does not, check that the API rewrite appears before the SPA catch-all and that the destination hostname matches the actual API service URL.
- **CSRF failures:** check that API `APP_ORIGIN` exactly matches the frontend's HTTPS origin (no trailing path or slash), and that `TRUST_PROXY=true` and `COOKIE_SECURE=true` are set.

## Cost assumptions (USD)

Indicative Render list prices checked on 2 November 2026; they are not a quote and may change:

| Resource | Selected plan | Current list-price basis |
| --- | --- | ---: |
| API web service | `0.5c-512mb` (0.5 CPU / 512 MB) | about $7/month |
| Postgres | `0.1c-256mb` (0.1 CPU / 256 MB) | about $6/month |
| Postgres disk | 1 GB | included storage |
| Static frontend | Global CDN static site | $0/month |

**Estimated resource subtotal: about $13/month** while the paid API and database are active, before applicable taxes, metered usage, or a workspace subscription. Render's pricing lists static sites as free and includes 1 GB of Postgres SSD storage; additional database storage is currently listed at $0.30/GB/month.

The resource subtotal excludes any workspace-level subscription (if applicable), outbound bandwidth beyond the workspace allowance, build-pipeline usage beyond the included amount, taxes, and optional add-ons. The connected workspace's billing tier and remaining monthly allowances were not established by this read-only task; check the Render Billing page before approval. Render's current pricing describes Static Sites as free and lists the selected web and Postgres plan rates. The selected 1 GB Postgres disk matches the included SSD allowance; additional database storage is separately billed.

A paid Postgres instance is selected rather than Free because the Free Postgres service expires after 30 days and is intended for short-lived testing. A paid API instance is selected so the pre-deploy migration hook is available. No Key Value store, worker, persistent API disk, custom domain or extra web instance is included because the current application does not require one for the staging deployment described here.

Sources for current Render service syntax, routing, Node version selection, environment references, pre-deploy support and pricing:
- [Blueprint specification](https://render.com/docs/blueprint-spec)
- [Node.js version selection](https://render.com/docs/node-version)
- [Pre-deploy command and deployment lifecycle](https://render.com/docs/deploys)
- [Static-site rewrites](https://render.com/docs/redirects-rewrites)
- [Render compute plans](https://render.com/docs/compute-plans)
- [Render pricing](https://render.com/pricing)

## Validation and limitations

### Published Render JSON Schema validation — 3 November 2026

A complete structural validation of the rebased `render.yaml` was run against Render's published JSON Schema. This is independent of, and does not replace, Render CLI/workspace validation.

- **Schema source:** https://render.com/schema/render.yaml.json
- **Retrieved:** 2026-11-03 13:28:42 UTC; HTTP/2 200
- **Last-Modified response header:** Tue, 03 Nov 2026 04:36:59 GMT
- **Downloaded schema SHA-256:** `8a3fb8da6b4f55fe686fbefa790e011d3dd7895f013f355953c572a21ab6494a`
- **JSON Schema dialect:** Draft 2020-12
- **Validator:** Python `jsonschema` 4.26.0, using `Draft202012Validator` and `FormatChecker`
- **YAML parser:** PyYAML 6.0.3
- **Python runtime:** 3.14.4

The schema self-check passed. The schema contains 44 distinct `$ref` values; all are fragment-local references and no external references were found. The complete loaded YAML instance was validated with format checking enabled.

**Exact validation commands used in the CI run:**

```bash
schema_url="https://render.com/schema/render.yaml.json"
curl --fail --silent --show-error --location \
  --dump-header /tmp/render-schema-headers.txt "$schema_url" \
  --output /tmp/render-blueprint-schema.json
python -m pip install --disable-pip-version-check \
  "jsonschema==4.26.0" "PyYAML==6.0.3"
```

```bash
python - <<'PY'
import json
import sys
from pathlib import Path
from importlib.metadata import version
import yaml
from jsonschema import Draft202012Validator, FormatChecker

schema_path = Path("/tmp/render-blueprint-schema.json")
blueprint_path = Path("render.yaml")
schema = json.loads(schema_path.read_text(encoding="utf-8"))
print(f"Validator: jsonschema {version('jsonschema')}")
print(f"YAML parser: PyYAML {version('PyYAML')}")
print(f"JSON Schema dialect: {schema.get('$schema')}")
Draft202012Validator.check_schema(schema)
print("Published schema self-check: PASS")

refs = set()
def collect_refs(value):
    if isinstance(value, dict):
        ref = value.get("$ref")
        if isinstance(ref, str):
            refs.add(ref)
        for child in value.values():
            collect_refs(child)
    elif isinstance(value, list):
        for child in value:
            collect_refs(child)
collect_refs(schema)
external_refs = sorted(ref for ref in refs if not ref.startswith("#"))
print(f"Reference count: {len(refs)}")
print(f"External references: {external_refs}")
if external_refs:
    print("ERROR: Published schema contains external references; offline resolution is incomplete.")
    sys.exit(2)

instance = yaml.safe_load(blueprint_path.read_text(encoding="utf-8"))
validator = Draft202012Validator(schema, format_checker=FormatChecker())
errors = sorted(
    validator.iter_errors(instance),
    key=lambda e: (list(map(str, e.absolute_path)), e.message),
)
print(f"Blueprint file: {blueprint_path}")
print(f"Schema validation errors: {len(errors)}")
if errors:
    for index, error in enumerate(errors, start=1):
        path = "$" + "".join(
            f"[{part}]" if isinstance(part, int) else f".{part}"
            for part in error.absolute_path
        )
        print(f"{index}. {path}: {error.message}")
    sys.exit(1)
print("RESULT: PASS — render.yaml is valid against the complete published Render JSON Schema.")
PY
```

**Complete result:** schema self-check **PASS**; `render.yaml` schema errors **0**; process exited successfully. CI output: `RESULT: PASS — render.yaml is valid against the complete published Render JSON Schema.`

**Published-schema limitations:** the schema's PostgreSQL plan enum still includes legacy labels such as `starter`, `standard`, `pro`, `pro plus` and `basic-*` values alongside current resource-specific identifiers. It also includes `free`. The selected `0.1c-256mb` Postgres plan and `0.5c-512mb` web-service plan are present in the published enums, but a schema pass does not prove that a plan is currently purchasable or enabled for a particular workspace. JSON Schema validation checks document structure, fields, types and enumerated values; it does not check workspace conflicts, resource-name collisions with existing services, account-specific plan availability, billing approval, or actual assigned service hostnames. Those require Render-aware validation and owner review.

### Render-native CLI validation — still outstanding

The official Render CLI installer previously completed in a clean GitHub Actions runner and `render --version` returned `render v2.35.0`. The earlier command:

```bash
env -u RENDER_API_KEY render blueprints validate render.yaml
```

stopped before validation with exit code 1:

```text
Error: no workspace specified and no default workspace set.
Use --workspace or run 'render workspace set'
```

No workspace was selected and no login or workspace-setting flow was started. The connected account's only listed workspace was `My Workspace` (`tea-dabf1jn40ujc73arob00`); it has not been authorised as the DMS staging workspace. Do not run the following until the owner explicitly identifies the intended staging workspace and authorises an authenticated CLI session for it:

```bash
render blueprints validate render.yaml --workspace <authorised-staging-workspace-id>
```

No Blueprint sync, deploy, provisioning, resource creation, Render resource modification, production credential access, live health check or production change was performed.
