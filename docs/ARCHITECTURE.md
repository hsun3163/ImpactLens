# Architecture

## Scope

ImpactLens is a static, client-side evidence exploration application. Next.js 16 exports HTML, JavaScript, styles, and public data into `out/`. React manages browser state; Recharts renders descriptive visualizations. There is no application backend, persistent upload store, model gateway, or runtime agent orchestrator.

## Data flow and trust boundaries

1. **Primary evidence:** locally archived CDCR PDFs under `research/`, with hashes, byte sizes, original URLs, and access dates in committed `data/sources.json`. Raw PDFs, extracted text, and inspection PNGs are excluded from Git; `research/download_sources.py` restores the PDFs and verifies their recorded hashes before validation.
2. **Extraction:** `research/extract_cdcr.py` invokes Poppler `pdftotext -layout`, extracts reviewed table lines, and writes `data/official_cdcr.json`, CSV, and row-level extraction evidence. These source-rich records retain published rounded rates and printed/PDF page locators.
3. **Public projection:** `scripts/prepare_public_data.py` creates browser-ready `public/data/official.json`, `official.csv`, and supporting metadata. The projection deliberately follows the strict application schema rather than passing arbitrary raw-source fields into the importer.
4. **Independent verification:** `scripts/validate_data.py` separately reads the archived PDFs and checks source hashes, token-position extraction, counts, rounding, row coverage, provenance, CSV/JSON parity, and partition totals. It does not rely on importing the extraction producer.
5. **Runtime ingestion:** the browser loads static public assets or reads a user-selected aggregate CSV into memory. Uploaded data is always labeled `uploaded`, even if the file claims `official` provenance.
6. **Analysis and presentation:** shared TypeScript functions derive rates, Wilson intervals, coverage when known, and comparison compatibility. UI filters select rows without pooling overlapping records.
7. **Exports:** browser-generated CSV/JSON downloads remain under the user's control. They are not server submissions. CSV text is escaped and formula-like prefixes neutralized by the shared export helper.

The source registry is maintained with the application, not populated from arbitrary uploaded URLs. An uploaded source ID or cohort label is a claim supplied by the user, not authenticated evidence.

## Code map

| Location | Responsibility |
| --- | --- |
| `src/app/` | Dashboard, interaction, layout, and styles |
| `src/lib/types.ts` | Aggregate-row and result contracts |
| `src/lib/analysis.ts` | Wilson intervals, summaries, descriptive comparisons |
| `src/lib/csv.ts` | Strict CSV parsing, validation, safe CSV export |
| `tests/` | Deterministic statistical, parser, and bundled-data tests |
| `research/` | Archived evidence, acquisition, extraction, research notes |
| `data/` | Source-rich normalized evidence and source registry |
| `public/data/` | Generated static browser assets |
| `scripts/` | Public projection and independent validation |
| `.github/workflows/ci.yml` | Clean-install checks and reproducibility gate |

## Statistical contract

A row is one aggregate cohort with a defined release year, grouping dimension, outcome, follow-up duration, numerator, denominator, and provenance. It is never a person. Counts determine rates; imported percentage columns are rejected. Optional missing-outcome counts describe otherwise eligible people outside the observed denominator; omission means unknown coverage.

Comparisons require compatible dimensions, release-year labels, outcomes, windows, and data kinds. They reject identical records and obvious overall/subgroup comparisons. These guards are necessary but not sufficient: they cannot prove disjoint membership, equal measurement, or exchangeability. Results are unadjusted descriptive differences. No hypothesis test, adjusted treatment effect, survival estimator, or risk-difference interval is implemented. See `STATISTICAL_METHODS.md` for exact formulas and limits.

## Privacy and security properties

- No application code sends selected CSV contents to a server; data remains in browser state until discarded or the tab is reloaded/closed.
- No account system, analytics SDK, API credentials, or persistent client database is needed.
- Strict headers, bounded file/row sizes, valid integer counts, duplicate-ID rejection, and batch rejection reduce accidental misuse.
- Identifier-header checks are not semantic PII detection. Free-text labels, small cells, and combinations of public aggregates can still expose information.
- Local downloads persist outside the app. Extensions, device compromise, screenshots, and host request logging are outside this guarantee.
- The prototype does not meet a claimed regulated-data compliance standard and must not ingest identifiable justice-system records.

## Build and deployment

Use Node 24 and the committed npm lockfile. A fresh-clone data validation requires `python3 research/download_sources.py`, with network access to official CDCR URLs; analysis and extraction thereafter run without network/model calls. `npm run build` produces a static export; no Node server or runtime secret is required at the hosting destination. A deployment must serve `/data/` and Next.js static assets correctly. Deploying under a path prefix needs an explicit configuration review.

Sites/Cloudflare is an intended static-host destination, initially owner-private where supported. Access controls must be verified on the actual deployment; static export alone does not create privacy protection. Do not infer deployment, public availability, repository creation, or CI success from configuration files. Record verified URLs and check results only after those steps complete.

## Deliberately not implemented

Individual-level record ingestion/linkage, nonprofit connectors, identity resolution, cloud persistence, live LLM agents, causal estimation, production authentication/authorization, and automated policy decisions. These require a different governance and threat model, not merely an extra upload field.
