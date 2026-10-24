# ImpactLens

[![Validate and build](https://github.com/hsun3163/ImpactLens/actions/workflows/ci.yml/badge.svg)](https://github.com/hsun3163/ImpactLens/actions/workflows/ci.yml)

**A transparent, aggregate-only recidivism evidence dashboard.** Explore public California release-cohort outcomes, inspect the counts behind the percentages, and compare compatible cohorts without confusing association with program impact.

ImpactLens is a hackathon prototype, not a causal evaluation system or a tool for individual risk scoring, eligibility, sentencing, or supervision decisions.

## Live application

https://impactlens.inacra.chatgpt.site

Public demonstration URL. Source: https://github.com/hsun3163/ImpactLens

**Version status:** the v2 backend was deployed as Sites publication revision 3 on October 24, 2026. Authenticated save/reopen, server analysis, and stored report downloads have been browser-tested. An imported-synthetic-label correction is awaiting revision 4 verification; GitHub synchronization/new CI are not yet verified. See [delivery evidence](docs/DELIVERY.md) for the exact source revision, passed checks, and limits. Historical v1 results apply only to the former static application.

## What v2 adds

- A Sites/Vinext application with React, TypeScript, and Recharts, running on Cloudflare Workers rather than a static export.
- Public official and synthetic demonstrations, plus optional sign-in through Sites' ChatGPT authentication for private, user-owned aggregate projects.
- Browser-local CSV preview followed by a separate, explicit **Save** action. Selecting a file alone does not upload its contents. Saving sends the aggregate CSV and project name to the backend.
- D1 project/report metadata and validated aggregate rows, with R2 CSV and generated-report artifacts. Saved projects can be reopened after a reload or on another signed-in device.
- Server-side validation and deterministic statistics using the same statistical and CSV functions as the browser, plus stored JSON, CSV, and Markdown reports.
- Owner checks on every private project, analysis, report, and download route. Project identifiers are not public sharing links.

## Preserved evidence features

- Official, synthetic-demo, and user-uploaded datasets remain separate; imported claims never become official provenance.
- Outcome, follow-up, release-year, and cohort-breakdown exploration; counts, observed rates, trend visualization, and per-row Wilson 95% model intervals.
- Descriptive cohort comparison with compatibility checks and explicit non-causal interpretation.
- Strict aggregate CSV validation and downloadable outputs.
- An inspectable, deterministic five-stage audit workflow: Ingest → Validate → Analyze → Review → Report. It makes **no live language-model calls**.
- Archived primary sources, extraction evidence, reproducible data preparation, unit tests, and an independent data validator.

No model API, model API key, external coding-agent service, or paid model subscription is required by the application. Cloud saving does require Sites authentication and provisioned D1/R2 bindings. Hosting/storage quotas or charges are separate from model/API use; this is not a promise of unlimited free hosting.

## Run locally

Prerequisites: Node.js 24 (package minimum 22.13), npm, Python 3, `curl`, and Poppler's `pdftotext`. On Ubuntu, install Poppler with `sudo apt-get install poppler-utils`.

```sh
npm run install:ci
python3 research/download_sources.py  # restore hash-verified PDFs on a fresh clone
python3 scripts/prepare_public_data.py
npm run dev
```

For private saving, initialize the local D1 schema using the [backend setup instructions](docs/BACKEND.md#local-setup-and-migrations). Open `http://localhost:5173`. The portable development server supplies a loopback-only mock sign-in for local testing; it is not a production account or proof that hosted authentication works. Do not expose this development server publicly. See [backend operations and API](docs/BACKEND.md) for storage, authentication, and deployment prerequisites.

To validate and build:

```sh
npm run typecheck
npm test
npm run validate:data
python3 research/extract_cdcr.py
python3 scripts/prepare_public_data.py
git diff --exit-code -- data public/data
npm run build
```

`npm run build` runs the Sites/Vinext build and produces `dist/client/` and `dist/server/wrangler.json`. It no longer creates a deployable static `out/` application. `npm start` runs the built Worker locally through Wrangler; it does not publish the site. Clean clones use the portable build path without requiring checkout-local execution settings.

Tests run with `node --import tsx --test tests/*.test.ts`, including backend security tests. GitHub Actions uses Node 24 and preserves the checksum-verified PDF restoration, independent data validation, and canonical-data drift gates alongside typechecking, tests, and a Worker build. A workflow file is not evidence that hosted CI has passed; inspect the run for the exact commit.

## Three-minute demo

1. Open **Overview** in official mode. Select the overall FY2020–21 conviction cohort, with a 36-month follow-up. It contains 11,886 events among 30,116 eligible people: approximately 39.5%.
2. Inspect the 19-cohort trend, FY2002–03 through FY2020–21. A point is a different release cohort, not repeated measurement of the same people. Do not add its denominators.
3. In **Compare cohorts**, select the enhanced-credit breakdown. Credit earners have 5,011/15,029 observed convictions; non-earners have 6,875/15,087. The unrounded difference is approximately −12.23 percentage points, **not a causal credit effect**. Published one-decimal rates yield a slightly different rounded subtraction.
4. Open **Sources & methods** and follow the original report. Use the source ID and page/table evidence to verify the numerator, denominator, and cohort definition.
5. In **Upload data**, download the synthetic example CSV, import it, and inspect its explicit synthetic warning. CSV imports remain user-supplied, not verified official evidence. Try an invalid count or forbidden identifier column to demonstrate rejection. Use only public or authorized, non-identifying aggregate data.
6. Run **Workflow**, inspect each stage, and download its JSON artifact. These are deterministic outputs, not transcripts of autonomous runtime agents.
7. To exercise persistence, sign in, select **Save dataset**, name the project, confirm its aggregate-only scope, and select **Save aggregate dataset**. In **Saved projects**, reopen it after a reload, then run server analysis or **Generate & save report**. Stored reports use all saved rows, not current dashboard filters; **Export brief** remains browser-local and filtered. These operations were exercised against publication revision 3; see the delivery record for the separate uploaded-synthetic-label regression still pending.

## Evidence baseline

The selected official extract has **38 rows**, all with actual published integer counts and a 36-month conviction outcome:

| Breakdown | Rows |
| --- | ---: |
| Statewide historical cohorts | 19 |
| Enhanced-credit groups | 2 |
| Supervision groups | 3 |
| Gender groups | 2 |
| Age groups | 10 |
| Enhanced Alternative Custody Programs | 2 |

Sources are the [CDCR statewide FY2020–21 report](https://www.cdcr.ca.gov/research/wp-content/uploads/sites/174/2026/06/Statewide-Recidivism-Report-for-Individuals-Released-in-Fiscal-Year-2020-21.pdf) and [FY2020–21 EACP supplement](https://www.cdcr.ca.gov/research/wp-content/uploads/sites/174/2026/09/Recidivism-Rates-for-EACP-Participants-FY-2020-21.pdf), archived on October 24, 2026. Publication dates and release-cohort dates are not interchangeable. These are selected public aggregates, not linked nonprofit client records or a complete extract of every report table.

`data/official_cdcr.*` retain the source-rich normalized records. `data/sources.json` stores source URLs, file hashes, and archival metadata; `data/extraction_evidence.json` records supporting source lines. `scripts/prepare_public_data.py` projects the canonical browser schema into `public/data/`; do not hand-edit those generated assets.

Raw PDFs and rendered/text inspection artifacts are archived locally but excluded from Git. A fresh clone restores the two canonical source PDFs from their official URLs and verifies the recorded SHA-256 checksums; this acquisition step requires network access and `curl`. Normalized data, extraction evidence, source manifests, and scripts are committed.

To reproduce from the evidence:

```sh
# Restore missing raw PDFs and verify recorded hashes; uses curl/network.
python3 research/download_sources.py
# Re-extract archived PDFs; requires pdftotext, no network/model.
python3 research/extract_cdcr.py
python3 scripts/prepare_public_data.py
python3 scripts/validate_data.py
# From a Git checkout, verify that regeneration has not changed committed evidence.
git diff --exit-code -- data public/data
```

A changed upstream PDF fails the downloader's hash check rather than silently replacing the evidence baseline. Review source changes before accepting regenerated output.

## Interpretation and privacy boundaries

- Conviction, arrest, and return to prison are different outcomes. The current official extract contains conviction only.
- The FY2020–21 conviction denominator excludes releases without the required automated RAP sheets; it is not the total release population. Unknown missing-outcome counts remain unknown, not zero.
- Groups can overlap across dimensions and years. MCRP and FCRP are different programs with different populations, not treatment and control groups. Statewide groups can contain program participants.
- Matching labels and follow-up windows do not establish exchangeability. Selection, baseline differences, policy, measurement, and follow-up can explain observed differences.
- Wilson intervals are binomial model intervals, not official CDCR estimates, causal-effect intervals, or sampling uncertainty about a fully observed administrative population.
- Upload limits are 1 MiB and 5,000 rows. The importer rejects unknown/identifier columns and invalid counts; it cannot detect every identifier hidden in free-text labels or prevent small-cell re-identification. This is **not a de-identification guarantee**.
- Importing a file only previews it in browser memory. Explicitly saving a project transmits its name and aggregate CSV to the application backend and persists validated rows and artifacts in D1/R2. Saved data does not disappear when the tab closes or the user signs out.
- Cloud saves also require normalized row JSON to fit within 1.5 MiB. The prototype limits each user to 25 projects and each project to 20 stored reports. These application limits are not a storage-service guarantee. There is no end-user deletion, retention-policy management, team sharing, or regulated-data compliance claim in v2.
- Owner scoping depends on the trusted Sites authentication gateway. Never deploy the Worker as an unprotected origin that accepts caller-supplied identity headers.
- Browser-local does not mean inaccessible to browser extensions, screen sharing, local downloads, or someone using the device. Hosting providers receive ordinary requests and explicitly saved content. Use only public or authorized non-identifying aggregates; do not place confidential individual records into this prototype.

## Engineering and next steps

- [Architecture](docs/ARCHITECTURE.md)
- [Backend operations and API](docs/BACKEND.md)
- [Statistical methods and CSV contract](docs/STATISTICAL_METHODS.md)
- [Data dictionary](data/data_dictionary.md)
- [Development roles and deterministic workflow](docs/AGENT_WORKFLOW.md)
- [Evaluation roadmap](docs/EVALUATION_ROADMAP.md)

The roadmap describes future, governed evaluation work, not capabilities conferred by adding a database. See [delivery evidence](docs/DELIVERY.md), [independent data validation](docs/VALIDATION.md), and [browser verification](docs/UI_VALIDATION.md). Historical v1 evidence is explicitly separated from verified v2 publication revision 3 checks and remaining revision 4/GitHub CI work. The Actions badge reflects repository checks, not a guarantee of hosted authentication, persistence, or security.
