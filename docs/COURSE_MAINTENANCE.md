# Standalone course maintenance

Routes: `/courses` for existing TPW-administrator access; `/demo/courses` for a fully interactive browser-local synthetic demo. Nothing requires SMS configuration, a phone number, or entering Reports first. The default screen is **My courses**, with **Add course**, **Edit course**, and **Add another like this**. Program names are selected or created inside the course editor. Organization/program name administration is secondary. An optional `organizationId` query selects an existing organization, not a permission grant.

## Existing data, not another collection model

Live course writes reuse `course_summaries` and its revision checks. Organization and program names reuse `sms_organizations` and `sms_programs`; their historical phone bindings are not remapped. The metadata endpoint exposes names and IDs only, never raw SMS, phone numbers, teacher details or aggregates. All live routes keep the current TPW admin allowlist and same-origin write gate. Actual organization-specific membership/self-service authorization is not implemented.

The exact 31 facility values are from the existing spreadsheet's Constants tab. The three status labels are Planned, In Progress and Completed. Yard remains optional free text. Dates, per-participant whole-course hours, participant count and completion count stay nullable. Zero is explicit; a missing field never becomes zero. Existing unlisted facility labels are preserved when unchanged, not silently migrated. Notes is optional and secondary because it is present in the source sheet but not the recorded Google Form.

Each new course has its own ID. **Add another like this** copies only organization, program, facility and yard. It resets dates, hours, participants, completions and notes, and visibly starts at Planned. Records with identical organization, program, location and dates are not merged. Derived program year comes from start date; derived participant programming hours use course hours × completions, never SMS attendance or participant count.

No source spreadsheet rows were imported, edited or backfilled. There is no live source-sheet sync. Existing v7 summaries remain the live source. The demo clearly uses fictional records and only localStorage, under a dedicated versioned key; it makes no live API requests. It supports saved edits, new courses, reused-context courses, name creation/renames, reload and reset.

## Boundaries and verification

The SMS webhook, SMS ledger, aggregates and phone bindings are unchanged. The existing phone mapping remains program-level; there is no course-instance binding migration. Reporting and all existing SMS routes remain available; the old report-embedded editor now links to the standalone workspace.

New metadata creates carry a stable `createId`, so a lost response can be retried without duplicate organizations/programs. Renames use existing `id`; create and rename identifiers are mutually exclusive. New creation does not merge by name. Course saves keep the existing revision/idempotency behavior. Editing and navigation preserve an open draft until save or explicit discard.

The source spreadsheet does not establish strict form requiredness. The current implementation retains v7 numeric/date consistency validation and requires a reusable organization/program identity and one of the three statuses. It does not claim to preserve a separate textual TBD state beyond the existing nullable storage representation. No new survey indicators or outcome claims are added.
