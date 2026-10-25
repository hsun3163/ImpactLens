# Standalone course maintenance

Routes: `/courses` for existing TPW-administrator access; `/demo/courses` for a fully interactive browser-local synthetic demo. Nothing requires SMS configuration, a phone number, or entering Reports first. The default screen is **My courses**, with **Add course**, **Edit course**, and **Add another like this**. Program names are selected or created inside the course editor. Organization/program name administration is secondary. An optional `organizationId` query selects an existing organization, not a permission grant.

## Existing data, not another collection model

Live course writes reuse `course_summaries` and its revision checks. Organization and program names reuse `sms_organizations` and `sms_programs`; their historical phone bindings are not remapped. The metadata endpoint exposes names and IDs only, never raw SMS, phone numbers, teacher details or aggregates. All live routes keep the current TPW admin allowlist and same-origin write gate. Actual organization-specific membership/self-service authorization is not implemented.

The exact 31 facility values are from the existing spreadsheet's Constants tab. The three status labels are Planned, In Progress and Completed. Yard remains optional free text, with reusable saved choices scoped to the organization and facility and an Add option. Dates, per-participant whole-course hours, participant count and completion count stay nullable. Zero is explicit; a missing field never becomes zero. Existing unlisted facility labels are preserved when unchanged, not silently migrated. Notes is optional and secondary because it is present in the source sheet but not the recorded Google Form.

Each new course has its own ID. **Add another like this** copies organization, program, facility and yard plus the saved participant count and whole-course hours as editable defaults. It resets dates, completions and notes, and visibly starts at Planned. Unknown values stay blank and saved zeros stay zero. Records with identical organization, program, location and dates are not merged. Derived program year comes from start date; derived participant programming hours use course hours × completions, never SMS attendance or participant count.

No source spreadsheet rows were imported, edited or backfilled. There is no live source-sheet sync. Existing v7 summaries remain the live source. The demo clearly uses fictional records and only localStorage, under a dedicated versioned key shared with the combined `/sms/demo` rehearsal; it makes no live API requests. Existing v1 course data is migrated without discarding saved courses. It supports saved edits, new courses, reused-context courses, name creation/renames, reload and reset.

## Boundaries and verification

The signed SMS webhook and atomic aggregate counters remain intact. Additive migration 0004 adds an optional explicit phone-to-course binding and immutable course snapshots to new SMS. Existing program-level mappings and historical records remain unassigned; there is no automatic backfill. Binding is managed separately in SMS administration, never required by the core course form. Course cards expose counted, receipt-ordered attendance points. Reporting and all existing SMS routes remain available; the old report-embedded editor now links to the standalone workspace.

New metadata creates carry a stable `createId`, so a lost response can be retried without duplicate organizations/programs. Renames use existing `id`; create and rename identifiers are mutually exclusive. New creation does not merge by name. Course saves keep the existing revision/idempotency behavior. Editing and navigation preserve an open draft until save or explicit discard.

The form validates numeric/date consistency and requires a reusable organization/program identity plus one of the three statuses. Unknown values use the existing nullable representation. The fields follow the established collection schema.

## Course-bound attendance

A course referenced by a phone binding or SMS history cannot be moved to another organization/program. Create another course for that work; facility, yard, dates and other manual fields remain editable. Each accepted SMS keeps its original course identity snapshot, including historical names/location/dates. A course rename or phone rebind never rewrites counted history. The attendance graph uses SMS receipt order, not class dates, and never recalculates the manual course results. See [demo runbook](DEMO_RUNBOOK.md) for the two-input presentation and post-publication acceptance.
