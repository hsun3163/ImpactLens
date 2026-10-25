# Recorded activity and course summaries

This iteration adds two complementary tools without adding collection indicators. It is deterministic software, not an autonomous or conversational agent. No model or outbound SMS service is called.

## Workspace and audience

- `/sms/reports`: private TPW administrator workspace with recorded-activity and course-summary tabs.
- `/sms/reports?organizationId=<UUID>`: preselected organization; the filter is not a separate organization permission grant.
- `/sms/demo/reports`: visibly fictional, fixed-date sample. It does not query live data, save summaries, or send SMS. Its exports retain the synthetic label.

The existing `/` CDCR workspace and `/sms` live display are separate. The dashboard's one-second / optional 250-ms polling and webhook contract are unchanged. Reports refresh independently and do not add queries to the low-latency dashboard read.

The shared SMS administrator gate protects every live report and summary read/write. Summary writes also require the same-origin and JSON checks. The Site audience and TPW allowlist govern live access. Downloaded briefs remain local until explicitly shared.

## Recorded-activity contract

`GET /api/sms/report` accepts `start`, `end` (ISO calendar dates), `group=week|month`, and optional organization/program UUIDs. A program must belong to the selected organization. Unknown, repeated, malformed, future-ending, reversed, or over-366-day filter ranges are rejected. The default is this UTC month through today. Empty valid scopes return an honest empty report.

The endpoint reads only counted `sms_records` and existing program/organization metadata, in one D1 snapshot. It returns daily-derived period totals, weekly or monthly buckets, current-period program activity, and first/last recorded dates. It never returns teacher names, sender phones, raw SMS bodies, provider message IDs, or administrator IDs. No report API mutates the ledger or counter tables.

Definitions:

- Participant visits: sum of reported attendance; returning participants count again. Not unique people.
- Session hours: sum of reported session minutes / 60.
- Participant-hours: sum of attendance × session minutes / 60, assuming full-session attendance. Not an independently measured dose.
- Average attendance: visits / accepted session reports, including zero-attendance reports. Missing if there are no reports.
- Active reporting weeks: distinct Monday-start UTC weeks containing a report. Not participant adherence, retention, or a scheduled-service completion measure.
- Periods use original SMS **receipt dates in UTC**, not verified session dates or later quarantine processing dates. Explicitly recovered quarantines retain their original receipt date.
- Each comparison uses the immediately preceding equal-length date window. Percentages are unavailable when either period has no reports or the prior participant-hours denominator is zero. Labels describe recorded activity, not verified growth/decline in actual delivery.
- Empty bins mean no accepted check-ins, not that no service occurred. Boundary bins are marked partial. Reporting completeness remains unknown; having records at both ends does not prove complete coverage.

The funding brief is assembled from the exact selected report. Copy, text download, and print contain the scope, provenance, numbers, coverage, assumptions, and generation time. It makes no outcomes, causal, recidivism, retention, or future funding-return claim. Course-summary figures are not silently added to SMS activity. There is no generated budget or fabricated ask amount. The donor-oriented language is an activity account, not evidence of program effectiveness.

## Separate course summaries

The review-and-save form reuses existing organization/program metadata and only the existing TPW course-summary fields: facility, yard, program/organization, planned/in-progress/completed status, course dates, course hours per participant, participants, completers, and notes. These are organization-reported summaries, not inferred from SMS. Blank values remain unknown rather than becoming zero.

Summary records have their own additive table, validation, revision control, and client-generated record identity. Retrying the same save cannot create a duplicate or overwrite a different payload. Conflicting edits require reload/review. Summary rows never touch `sms_records` or `sms_aggregates`; no participant/course total is added across these streams, and cross-course participants are never labeled unique people. Notes should contain aggregate program context only, not participant names or sensitive individual information.

This first iteration does not bulk-import the authoritative sheet, deduplicate overlapping courses, reconcile course dates with receipt dates, or infer completers/unique participants from SMS. It does not create organization-specific accounts, new collection indicators, a shortcut text of `1`, automated reminders, conversational SMS, or outbound messages.

## Migration and verification

Migration 0003 is additive to the previously applied SMS schema; existing ledger tables, immutability triggers, counters, mappings, and secrets are untouched. Apply it only through the authorized publication workflow, which packages pending Drizzle migrations. Do not rerun historical migrations or seed live fixtures.

`npm run check` is the aggregate local gate: typecheck, all tests, independent CDCR data validation, and production build. Report tests cover calendar validation, zero denominators, zero-attendance sessions, UTC edges, privacy/authorization, historical programs, gap labels, and export provenance. Summary tests cover its schema and retry/edit contract. Local passes are not evidence of production migration, hosted authentication, or browser interaction; those need independent checks against the published revision.
## Course summaries (manual source, separate from SMS)

- `GET /api/sms/summaries?organizationId=<UUID>` returns the latest 100 updated summaries, with `limit` and `truncated`, plus existing organization/program selector metadata. It exposes no teacher or contact fields. A missing filter shows all organizations. Names come from the current organization/program registry.
- `POST /api/sms/summaries` accepts only a client-generated UUID `id`, an expected integer `revision` (0 for create), existing organization/program references, facility, yard, lifecycle status (`planned`, `in-progress`, `completed`), start/end dates, course hours per participant, participants, completers, and notes. Dates use YYYY-MM-DD; optional blank/omitted values become null. Explicit zero remains zero. Counts are nonnegative integers; hours are nonnegative numbers; all are bounded at 1,000,000. Completers cannot exceed participants when both are reported.
- The parent SMS router requires the existing admin allowlist for reads and writes, and same-origin checks for writes. The isolated handler returns safe JSON with private/no-store headers. It never logs raw notes or database failures.
- Creates return 201 at revision 1. Edits use an atomic revision compare-and-swap. An identical retry at the immediately resulting revision returns 200 with `replayed: true`; a stale or competing edit returns 409 without overwriting. The browser retains the client UUID and review payload on an uncertain save so retrying does not duplicate records.
- UI: choose an existing organization/program and one of three statuses, complete only familiar fields, review, then save. Saved records can be edited; drafts are not replaced by background refreshes. A conflict offers a deliberate reload of the latest saved version. Source labels, null-vs-zero labels, and planned-vs-reported labels are shown throughout.
- Course participant/completer counts are manually reported per course. They are never inferred from SMS visits, never rolled up as unique people across courses, and never written into `sms_records` or `sms_aggregates`. Course hours per participant are not SMS-delivered session hours. No new indicators, IDs for people, surveys, reasons, budgets, or waitlists are collected.
- Migration `0003_course_summaries.sql` is additive and schema-only. Its generated Drizzle snapshot and journal entry accompany it; historical migrations are unchanged. The existing build helper packages the whole drizzle directory. No hosted or persistent database was changed during implementation. Apply only pending migrations through the existing authorized deployment workflow; subsequent migration 0004 is described below.
- Verification: `tests/course-summary.test.ts` runs all real SQLite migrations in memory and covers nullable values, validation, metadata-only selectors, source separation, create retries, edit retries, conflicting concurrent writes, bounded listing, private headers, and safe failures. Run `npm run typecheck` and `node --import tsx --test tests/course-summary.test.ts tests/sms.test.ts` for the focused checks. Hosted auth/storage and browser rendering still require deployment-specific verification.

## Course activity drill-down

Additive migration 0004 optionally binds future SMS to a concrete saved course. The course attendance endpoint and chart expose counted receipt-ordered points separately from this reporting module. No manual values or existing report calculations are changed. Existing unassigned SMS remains unassigned, referenced courses cannot change organization/program, and one-time phone binding is outside the course form. See [SMS contract](SMS_DEMO.md) and [demo runbook](DEMO_RUNBOOK.md). Apply only pending migrations, not historical ones.
