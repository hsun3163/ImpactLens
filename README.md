# ImpactLens

[![Validate and build](https://github.com/hsun3163/ImpactLens/actions/workflows/ci.yml/badge.svg)](https://github.com/hsun3163/ImpactLens/actions/workflows/ci.yml)

**Turn everyday program activity into a shared, traceable picture.** ImpactLens brings together reusable program records, ordinary SMS attendance, organization and TPW dashboards, and public rehabilitation evidence.

[Open ImpactLens](https://impactlens.inacra.chatgpt.site) · [Try the SMS demo](https://impactlens.inacra.chatgpt.site/sms/demo) · [Explore the source](https://github.com/hsun3163/ImpactLens)

## What it does

- **Maintain programs once.** Reuse organization, program and facility details across courses; track dates, participation, completion and recorded activity.
- **Report attendance by SMS.** Send `20 2` for 20 attendee visits over two hours. Send `1` to repeat the current course's latest eligible session, or `-20 2` to reverse one matching session while preserving its history.
- **See the shared picture.** Course attendance charts feed organization and TPW dashboards, multicenter views, reports and labeled estimates.
- **Handle leader requests through an assistant.** Organization-scoped permissions connect free-text requests to bounded MCP tools for context, proposals and audited course updates.
- **Explore public evidence.** Inspect 38 CDCR aggregate rows, source counts, compatible cohort comparisons and descriptive statistical intervals. Official evidence, imported aggregates and fictional demonstrations retain separate provenance.
- **Save and reopen work.** Authenticated users can save aggregate projects and generate JSON, CSV and Markdown reports.

Activity totals describe reported sessions and visits. Cohort comparisons are descriptive associations; modeled estimates are labeled separately from measured outcomes.

## How Twilio fits

```text
Teacher SMS → Twilio receiving number → signed HTTPS webhook
→ deterministic validation and parsing → transactional D1 records
→ course, organization and TPW dashboards
```

The repository includes the receiver, signature verification, repeat/reversal logic, database schema, dashboard queries and tests. Twilio supplies the phone number and managed SMS delivery. Runtime credentials stay in the hosting secret store.

See [Twilio backend and setup](docs/TWILIO_BACKEND.md) for the source-file map, configuration variables, sender bindings and external-assistant integration.

## Run locally

Use Node.js 24, npm, Python 3, `curl` and Poppler's `pdftotext`.

```sh
npm run install:ci
python3 research/download_sources.py
python3 scripts/prepare_public_data.py
npm run dev
```

Open `http://localhost:5173`. Follow [backend setup](docs/BACKEND.md) for local D1 migrations and private project storage. Browser-local demos use fictional fixtures; keep the development server on loopback.

```sh
npm run check
```

The release check passed **325 tests**, TypeScript checking, independent PDF-backed data validation and the production Worker build. Canonical data regeneration matched the committed data. [GitHub Actions](https://github.com/hsun3163/ImpactLens/actions) records checks for each repository commit.

## Source and database

This source release mirrors deployed Sites **v24**, source `e1d9c5147b010b22d996c206e8acde7b6f742749`. Real numeric SMS intake and SMS reversal have been exercised on the running application. [Verification record](docs/DELIVERY.md).

The repository includes schema, additive migrations, public aggregate data and reconstructible fictional fixtures. Live phone contacts, raw SMS, account grants and credentials stay private. Set up a new installation with your own hosting project and runtime configuration from `.env.example`.

## Guides

- [Twilio backend and configuration](docs/TWILIO_BACKEND.md)
- [Course maintenance](docs/COURSE_MAINTENANCE.md) and [demo runbook](docs/DEMO_RUNBOOK.md)
- [External assistant and MCP permissions](docs/EXTERNAL_AGENT.md)
- [Reporting](docs/REPORTING.md) and [statistical methods](docs/STATISTICAL_METHODS.md)
- [Architecture](docs/ARCHITECTURE.md), [backend setup](docs/BACKEND.md) and [source-data validation](docs/VALIDATION.md)
- [Accessibility review](docs/ACCESSIBILITY_REVIEW.md) and [evaluation roadmap](docs/EVALUATION_ROADMAP.md)
