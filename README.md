# ImpactLens

**A transparent, aggregate-only recidivism evidence dashboard.** Explore public California release-cohort outcomes, inspect the counts behind the percentages, and compare compatible cohorts without confusing association with program impact.

ImpactLens is a hackathon prototype, not a causal evaluation system or a tool for individual risk scoring, eligibility, sentencing, or supervision decisions.

## What is implemented

- Next.js 16 static-export application with React, TypeScript, and Recharts.
- Official, synthetic-demo, and user-uploaded datasets kept separate.
- Outcome, follow-up, release-year, and cohort-breakdown exploration; counts, observed rates, trend visualization, and per-row Wilson 95% model intervals.
- Descriptive cohort comparison with compatibility checks and explicit non-causal interpretation.
- Strict aggregate CSV validation, browser-memory processing, and downloadable outputs.
- An inspectable, deterministic five-stage audit workflow: Ingest → Validate → Analyze → Review → Report. It makes **no live language-model calls**.
- Archived primary sources, extraction evidence, reproducible data preparation, unit tests, and an independent data validator.

No backend, database, paid API, API key, account login, or external coding-agent service is required to run the application. The website fetches bundled public assets; selected CSV contents are processed locally, not uploaded to a server by this application.

## Run locally

Prerequisites: Node.js 24, npm, Python 3, and Poppler's `pdftotext`. On Ubuntu, install Poppler with `sudo apt-get install poppler-utils`.

```sh
npm ci
python3 scripts/prepare_public_data.py
npm run dev
```

Open `http://localhost:3000`. To validate and build:

```sh
python3 research/download_sources.py  # restore hash-verified PDFs on a fresh clone
npm run typecheck
npm test
npm run validate:data
npm run build
```

The build uses `next build --webpack` and creates `out/`, suitable for a static host. Tests run with `node --import tsx --test tests/*.test.ts`. The committed GitHub Actions workflow runs the checks on Node 24 and checks regenerated canonical data for drift. A workflow file is not evidence that hosted CI has run successfully; inspect the actual run before claiming a passing build.

## Three-minute demo

1. Open **Overview** in official mode. Select the overall FY2020–21 conviction cohort, with a 36-month follow-up. It contains 11,886 events among 30,116 eligible people: approximately 39.5%.
2. Inspect the 19-cohort trend, FY2002–03 through FY2020–21. A point is a different release cohort, not repeated measurement of the same people. Do not add its denominators.
3. In **Compare cohorts**, select the enhanced-credit breakdown. Credit earners have 5,011/15,029 observed convictions; non-earners have 6,875/15,087. The unrounded difference is approximately −12.23 percentage points, **not a causal credit effect**. Published one-decimal rates yield a slightly different rounded subtraction.
4. Open **Sources & methods** and follow the original report. Use the source ID and page/table evidence to verify the numerator, denominator, and cohort definition.
5. In **Upload data**, download the synthetic example CSV, import it, and inspect its explicitly uploaded label. Try an invalid count or forbidden identifier column to demonstrate rejection. Use only public or authorized, non-identifying aggregate data.
6. Run **Workflow**, inspect each stage, and download its JSON artifact. These are deterministic outputs, not transcripts of autonomous runtime agents.

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
- Browser-local does not mean inaccessible to browser extensions, screen sharing, local downloads, or someone using the device. Hosting providers can receive ordinary page/asset requests. Do not place confidential individual records into this prototype.

## Engineering and next steps

- [Architecture](docs/ARCHITECTURE.md)
- [Statistical methods and CSV contract](docs/STATISTICAL_METHODS.md)
- [Data dictionary](data/data_dictionary.md)
- [Development roles and deterministic workflow](docs/AGENT_WORKFLOW.md)
- [Evaluation roadmap](docs/EVALUATION_ROADMAP.md)

The roadmap describes future, governed evaluation work, not implemented linkage or a promise of causal identification. The [GitHub repository](https://github.com/hsun3163/ImpactLens) has been created. The code is prepared for static deployment; remote CI results and a hosted deployment must be verified separately. No passing hosted CI run or live deployment is asserted by this README.
