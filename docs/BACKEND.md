# Backend operations and API

## Aggregate-project backend

v2 adds persistent, user-owned aggregate projects and deterministic server reports to the public evidence explorer. The implementation uses Sites/Vinext on Cloudflare Workers, a D1 binding named `DB`, and an R2 binding named `BUCKET`. It makes no runtime LLM calls or external research/API requests. Storage bindings are application infrastructure, not model services.

This guide covers aggregate storage, API behavior and installation. For SMS and assistant services, see [Twilio backend](TWILIO_BACKEND.md). Release checks are in [DELIVERY.md](DELIVERY.md).

## What is local, and what is saved

- **Choose CSV file / Upload data:** parse and preview in browser memory. Signing in does not automatically save the file. Local-only data is discarded when the page state is lost.
- **Save dataset:** open a confirmation form showing the active dataset and full row count, choose a project name, and acknowledge that the data is authorized, non-identifying aggregates only.
- **Save aggregate dataset:** transmit the project name and aggregate CSV to the same-origin backend. The server validates again and persists a new immutable snapshot. The snapshot contains all active dataset rows, not just dashboard-filtered rows.
- **Saved projects → Open:** load the signed-in user's stored snapshot. Uploaded/official source claims are treated as user-supplied and unverified; explicit synthetic labels remain synthetic so invented values never lose their warning.
- **Run server analysis:** calculate descriptive results over every stored row of that project.
- **Generate & save report:** generate and persist reports for every stored row. Existing dashboard filters do not narrow the stored report.
- **Brief / JSON / CSV:** download authorized stored artifacts. The existing **Export brief** dashboard action remains a separate, browser-generated selected-row report.

Saving a snapshot of bundled official data does not create new authenticated official evidence. The public source registry and original canonical extract remain the evidence baseline. Saving never grants a user-supplied dataset official provenance.

## Authentication boundary

The public page, official/synthetic assets, and `GET /api/session` are readable without sign-in. Private routes require both Sites-injected headers:

- `oai-authenticated-user-id`
- `oai-authenticated-user-email`

The API uses the user ID for record ownership. Email/display name can be used for the current session display but are not stored in project or report records. Sign-in and sign-out use `/signin-with-chatgpt` and `/signout-with-chatgpt`; the application does not collect or manage passwords.

These headers are trustworthy only behind the Sites authentication gateway. The production ingress must strip client-supplied identity headers and provide its own verified values. Do not expose an alternate direct Worker endpoint that trusts arbitrary header values. Synthetic-header unit tests verify application authorization logic, not the integrity of a production gateway.

Every private lookup is owner-filtered. A missing or other user's project/report returns `404`; UUIDs and artifact paths are not public access tokens. Report downloads check both report and parent-project ownership before reading R2. There is no public R2 object route or shared-report link.

POST requests require an `Origin` exactly matching the request origin and reject `Sec-Fetch-Site: cross-site`. They use `application/json`, reject unsupported fields, and enforce streaming request-size limits even without a trustworthy Content-Length. API responses use private/no-store cache controls. Downloaded files use attachment disposition and a restrictive document policy. These controls do not replace hosted security testing or operational abuse controls.

## API contract

All paths below are same-origin. Private endpoints require a signed-in Sites session. Responses use JSON except artifact downloads.

| Method and path | Request | Response / behavior |
| --- | --- | --- |
| `GET /api/session` | None | `authenticated`, session `user` or null, sign-in/out URLs, binding availability, and application limits. Does not return saved data. |
| `GET /api/projects` | None | `{ projects }`, newest first, for the current owner only. |
| `POST /api/projects` | `{ "name": "Aggregate project", "csv": "…" }` | `201 { project, warnings }`. Independently parses/validates and saves an immutable snapshot. |
| `GET /api/projects/:id` | None | `{ project, rows }`, with validated saved rows. |
| `GET /api/projects/:id/analysis` | None | Per-row `summaries`, dataset-level `warnings`, `rowCount`, `computedAt`, and deterministic `engine`. All saved rows; no automatic pooling. |
| `GET /api/projects/:id/reports` | None | `{ reports }`, newest first, for the owned project. |
| `POST /api/projects/:id/reports` | Empty JSON object `{}` | `201 { report }`; persists JSON, CSV, and Markdown over all saved rows. |
| `GET /api/reports/:id/download?format=json` | `format` is `json`, `csv`, or `md`; default `json` | Owner-checked artifact download. |

Project metadata includes `id`, `name`, `rowCount`, `createdAt`, and `updatedAt`. Report metadata includes `id`, `projectId`, `rowCount`, `createdAt`, and same-origin download URLs. Ownership fields, storage keys, and another user's data are not part of the returned metadata.

Errors use `{ "error": "human-readable message", "code": "MACHINE_CODE", "details": ["optional validation detail"] }`:

| Status | Typical reason |
| --- | --- |
| `400` | Malformed JSON, unsupported fields, invalid project name, missing CSV, or invalid artifact format |
| `401` | Sign-in required |
| `403` | Missing/wrong Origin or cross-site mutation |
| `404` | Missing or not-owned record, unavailable artifact, or unknown endpoint |
| `405` | Unsupported method/operation |
| `409` | Project or report quota reached |
| `413` | Oversize JSON request or normalized stored dataset |
| `415` | Request content type is not JSON |
| `422` | CSV/schema validation failed, including a CSV exceeding its own size/row limit |
| `500` | Internal storage error or saved-data validation failure, without disclosing backend internals |
| `503` | Required D1/R2 binding unavailable; public demo remains independent |

Binding presence reported by `/api/session` is not a health check for migrated tables, successful storage writes, or the user's access to a particular project.

## Data model, artifacts, and provenance

D1 tables:

- `projects`: UUID, authenticated owner ID, project name, validated rows as JSON, row count, normalized-CSV R2 key, and timestamps.
- `reports`: UUID, project ID, owner ID, timestamp, row count, and JSON/CSV/Markdown R2 keys.

R2 stores normalized CSV and generated artifacts, not a raw arbitrary-file upload. Original file names are not storage paths. UUID-based object paths are internal; confidentiality still depends on owner authorization rather than guessing difficulty.

The server uses `parseAggregateCsv`, `validateAggregateRows`, `summarizeRow`, and `aggregateRowsToCsv` from shared modules. Numeric rates and Wilson intervals are derived from stored counts. Both browser import and server parsing preserve explicit `synthetic` labels as invented-value warnings. All other kinds, including imported `official` claims, become `uploaded`. No saved snapshot is independently authenticated by saving it.

JSON includes report/project metadata, schema/engine versions, per-row summaries, and interpretation warnings. CSV contains normalized aggregate rows with spreadsheet-formula neutralization. Markdown contains counts, rates, Wilson intervals, source-label caveats, and descriptive-only warnings; user-supplied labels are escaped as inert text. Missing-outcome counts are retained in JSON/CSV and are never interpreted as zero merely because omitted.

The engine label identifies deterministic application behavior, not a live model or a guarantee of scientific validity. A report uses all project rows individually; it does not sum overlapping denominators or infer a treatment effect.

## Prototype limits and persistence

| Limit | Value |
| --- | ---: |
| UTF-8 CSV content | 1,048,576 bytes (1 MiB) |
| Nonblank aggregate rows | 5,000 |
| Individual text label | 500 characters |
| Project name | 1–100 characters after trimming; no control characters |
| Normalized stored rows JSON | 1,572,864 bytes (1.5 MiB) |
| Saved projects | 25 per authenticated user |
| Stored reports | 20 per project |

The normalized JSON cap can reject a CSV that passed browser import because serialized rows consume more space. The JSON request envelope allows bounded encoding overhead; it does not raise the CSV limit. Quotas bound prototype use, not provider billing, service capacity, or requests per second.

Projects are immutable snapshots: there are no project edits, deletion endpoints, collaborative access controls, or retention-management UI in this version. Closing the tab, clearing browser data, or signing out does not remove D1/R2 data. Do not promise automatic expiry, deletion, backup, disaster recovery, or compliance certification. Before a sensitive or production pilot, establish a reviewed retention/deletion process and operational controls outside this prototype.

D1 metadata writes and R2 object writes are separate operations. The backend attempts to remove newly written objects if a related database operation fails, including a quota rejection; cleanup is best-effort rather than a cross-service transaction guarantee. Unknown network outcomes should be checked in the saved list before retrying a save/report action, because repeated successful POSTs create separate snapshots/reports.

The schema rejects identifying column names and unexpected fields but cannot detect all identifiers hidden in names/labels or all small-cell re-identification risks. Authentication and storage do not make individual justice-system data appropriate for this application.

## Local setup and migrations

Use Node 24, npm, Python 3, `curl`, and Poppler. The repository keeps a portable execution path for clean clones. Checkout-local managed-runtime state is excluded from Git.

```sh
npm run install:ci
npm run build
```

For a fresh local D1 database, apply the committed SQL migrations once, in filename order, before exercising saved projects:

```sh
for migration in drizzle/[0-9]*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
    d1 execute DB --local --config dist/server/wrangler.json \
    --persist-to .wrangler/state --file "$migration"
done
npm run dev
```

This initializes local storage, not the hosted database. Do not blindly rerun CREATE-table SQL on an existing database; apply only migrations not yet applied. `npm run db:generate` creates migrations after intentional schema changes; it is not a substitute for applying them or a routine startup command.

Open `http://localhost:5173`. The portable dev server supplies a loopback-only mock Sites sign-in and strips inbound auth headers before applying the local identity. This is only a development aid, not a real ChatGPT account or hosted authentication test. Do not expose it publicly. `npm start` instead runs the built Worker with local Wrangler persistence; it is not a production publish command and does not promise the dev server's mock-auth flow.

Local `.wrangler/` state is separate from hosted D1/R2 storage and is ignored by Git. Removing local emulator state is not a way to remove hosted data.

## Build, publication, and verification checklist

`npm run build` produces client assets under `dist/client/`, Worker configuration at `dist/server/wrangler.json`, and Sites metadata/migrations under `dist/.openai/`. `.openai/hosting.json` declares `DB` and `BUCKET`; these declarations are not credentials and do not provision storage by running a local build.

Sites publication consumes the deployment artifact, provisions the declared bindings, and applies packaged D1 migrations. Verify the publication result and actual runtime rather than assuming source configuration is sufficient. A generic static host cannot run v2. A non-Sites deployment additionally requires a compatible trusted authentication ingress and deliberate migration/storage setup.

Before marking v2 delivery complete:

1. Restore the official PDFs with checksum verification, rerun typechecking, all tests including backend security, independent data validation, and canonical-data drift checks.
2. Build from locked dependencies through the portable path; inspect the expected Worker/client and migration artifacts.
3. Verify the exact GitHub commit and hosted CI run, then the matching Sites publication.
4. Verify unauthenticated browsing, private-route rejection, and that forged client identity headers do not bypass the deployed authentication gateway.
5. With authorized test aggregates, save, reload, reopen, analyze, generate reports, and download/inspect all artifact formats.
6. Verify cross-user access denial, invalid/cross-origin writes, quota handling, and interrupted/repeated actions. Distinguish mock-unit, local-integration, and hosted evidence.
7. Record what was actually checked, which identities/environments were used without exposing credentials, and any blocked or untested cases. A successful build is not a security audit.
