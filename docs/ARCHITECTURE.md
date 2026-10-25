# Architecture

## Runtime architecture

ImpactLens runs on Sites/Vinext and Cloudflare Workers. React and Recharts provide the interface; D1 stores scoped application records and R2 stores aggregate CSV/report artifacts. A signed Twilio webhook handles deterministic attendance, repeat and reversal commands. Organization-scoped MCP tools connect an external assistant to auditable course-maintenance requests.

Public evidence exploration uses descriptive statistics. Runtime calculations and SMS attendance processing are deterministic; external natural-language interpretation uses the separately connected assistant. See [Twilio backend](TWILIO_BACKEND.md) and [business MCP](EXTERNAL_AGENT.md).

## Evidence preparation

1. **Primary evidence:** locally archived CDCR PDFs under `research/`, with hashes, byte sizes, original URLs, and access dates in committed `data/sources.json`. Raw PDFs, extracted text, and inspection PNGs are excluded from Git; `research/download_sources.py` restores the PDFs and verifies their recorded hashes.
2. **Extraction:** `research/extract_cdcr.py` invokes Poppler `pdftotext -layout`, extracts reviewed table lines, and writes source-rich CSV/JSON records and row-level extraction evidence. Records retain published rounded rates and printed/PDF page locators.
3. **Public projection:** `scripts/prepare_public_data.py` creates strict-schema `public/data/official.json`, `official.csv`, and supporting metadata. Generated public assets must not be hand-edited.
4. **Independent verification:** `scripts/validate_data.py` separately reads the archived PDFs and checks hashes, table extraction, counts, rounding, row coverage, provenance, CSV/JSON parity, and partition totals without importing the producer.

These preparation steps are not scheduled runtime data acquisition. The application does not autonomously discover new reports or refresh official evidence.

## Runtime data flow and trust boundaries

1. **Public exploration:** the browser loads bundled official or synthetic assets and calculates descriptive views. Dataset modes remain distinct.
2. **Local import:** a selected CSV is read and validated in browser memory. No selected CSV content is sent by this step. Explicit `synthetic` labels are retained as warnings about invented values; every other supplied kind, including `official`, becomes `uploaded`. This is warning preservation, not authentication of provenance.
3. **Explicit cloud save:** a signed-in user chooses to save a named project. The browser sends the CSV and name to a same-origin API. The server independently enforces byte/row/schema/count limits using the shared validator; client validation is not an authorization or integrity boundary.
4. **Persistence:** the backend associates the project with the authenticated Sites user ID, stores validated rows and metadata in D1, and writes normalized CSV to private R2 storage. A reload or sign-out does not delete this data. Explicit synthetic warnings survive browser import, saving, reopening, analysis, and reports; official claims are downgraded to user-supplied `uploaded` provenance.
5. **Server analysis:** a private analysis request loads the authenticated user's saved rows and uses the same deterministic TypeScript statistics as the browser. It does not accept client-computed percentages as authoritative.
6. **Stored reports:** an explicit report request generates deterministic JSON, safe CSV, and Markdown artifacts for the saved project, stores them in R2, and records metadata in D1. Reports are reproducible software output, not model reasoning or expert certification.
7. **Authorized download:** downloads resolve an owner-scoped D1 report before reading its R2 artifact. No direct public object URL or share-by-ID route is exposed.

Browser-generated exports and workflow artifacts remain local downloads. Stored server reports are a separate persistence path over all saved project rows, not the current dashboard selection. Neither path authenticates an uploaded source ID, label, or cohort definition. The official source registry is maintained with the application, not populated by following arbitrary uploaded URLs.

## Authentication and authorization

The application relies on Sites' trusted authentication gateway, which supplies `oai-authenticated-user-id` and `oai-authenticated-user-email`. Login/logout use the Sites routes, not an application-managed password database. The backend uses the user ID for ownership and does not persist the email or display name in project/report tables.

All private routes require identity and constrain reads/writes by the authenticated owner. A project or report UUID is only an identifier, not an access capability. Mutations require a matching `Origin` and reject `Sec-Fetch-Site: cross-site`. Private responses are not intended for shared caching. See `BACKEND.md` for the endpoint contract and exact runtime limits.

This trust model requires an ingress that strips untrusted identity headers and injects verified identity. Publishing an alternate direct Worker origin that trusts caller-supplied headers would invalidate it. Verify the actual hosted gateway, unauthenticated denial, and cross-user isolation before treating the deployment as verified.

Portable local development includes a loopback-only mock Sites sign-in. It is for exercising the UI, not validating real ChatGPT authentication. Unit tests with synthetic identities prove application behavior under those inputs, not the production gateway's identity guarantees.

## Code map

| Location | Responsibility |
| --- | --- |
| `src/app/` | Dashboard, layout, styles, auth helper, API route adapter |
| `src/lib/types.ts` | Aggregate-row and statistical result contracts |
| `src/lib/analysis.ts` | Shared Wilson intervals, summaries, descriptive comparisons |
| `src/lib/csv.ts` | Shared strict CSV parsing, validation, safe CSV export |
| `src/server/` | Authenticated project API, persistence, server analysis/report generation |
| `db/`, `drizzle/` | D1 schema and generated migrations |
| `worker/`, `vite.config.ts` | Vinext Worker entry point and Sites/Cloudflare build configuration |
| `.openai/hosting.json` | Sites project and `DB`/`BUCKET` binding names |
| `tests/` | Statistical, CSV, bundled-data, backend, and security tests |
| `research/`, `data/` | Evidence acquisition, extraction, source-rich records and registry |
| `public/data/` | Generated public browser assets |
| `scripts/` | Portable build/install support, public projection, independent validation |
| `.github/workflows/ci.yml` | Clean-install checks, source restoration, reproduction, Worker build |

## Statistical contract

A row is one aggregate cohort with a defined release year, grouping dimension, outcome, follow-up duration, numerator, denominator, and provenance. It is never a person. Counts determine rates; imported percentage columns are rejected. Optional missing-outcome counts describe otherwise eligible people outside the observed denominator; omission means unknown coverage.

Comparisons require compatible dimensions, release-year labels, outcomes, windows, and data kinds. They reject identical records and obvious overall/subgroup comparisons. These guards cannot prove disjoint membership, equal measurement, or exchangeability. No hypothesis test, adjusted treatment effect, survival estimator, or risk-difference interval is implemented. Moving calculations to a server does not change their inferential limits. See `STATISTICAL_METHODS.md`.

## Privacy, persistence, and operational limits

- CSV preview is local; explicit cloud saving is not. Only public or authorized, non-identifying aggregate data belongs in either path.
- Strict headers, bounded files/rows, integer counts, duplicate-ID rejection, and whole-batch rejection reduce accidental misuse but do not detect all identifying content or small-cell risks.
- Persistence is per authenticated user, not per organization or team. There are no collaborator invitations, public report links, or role-management controls.
- Saved data survives tab closure and logout. No self-service project deletion, retention scheduling, backup/restore guarantees, or regulated-data compliance certification is provided.
- R2 identifiers are not public links. Access control comes from authenticated owner checks, not from assuming identifiers remain secret.
- Local downloads, extensions, screenshots, device compromise, hosting administration, and provider logging are outside the application's owner-scoping guarantee.
- D1 and R2 are separate storage services; a stored report is not a cross-service transaction or backup guarantee. Operational failure and cleanup behavior must be tested, not inferred from the schema.

## Build and deployment

Use Node 24 and the committed npm lockfile. `npm run install:ci` installs locked dependencies; `npm run dev` serves the portable preview at port 5173; `npm run build` produces `dist/client/` and the Worker configuration at `dist/server/wrangler.json`. The old `out/` static export is not a v2 deployment artifact. `npm start` runs a built Worker locally, not a production deployment.

The Sites configuration binds D1 as `DB` and R2 as `BUCKET`. Production must provision these bindings, apply the generated D1 migrations, serve the client assets, and retain the trusted auth ingress. See `BACKEND.md` for the deployment checklist and `DELIVERY.md` for verification.

## Data and decision scope

The application operates on public outcome aggregates, saved aggregate projects and recorded program activity. Descriptive comparisons and labeled estimates support review and planning. Individual-level linkage, causal evaluation and regulated-data governance require a separately designed workflow; see [evaluation roadmap](EVALUATION_ROADMAP.md).
