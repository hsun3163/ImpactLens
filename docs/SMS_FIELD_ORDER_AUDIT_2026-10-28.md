# SMS field-order audit and regression checklist (2026-10-28)

## Canonical contract
SMS numeric format: `<attendee visits> <session hours>`, separated by ASCII spaces.
`16 2` = 16 visits, 2 hours, 32 participant-hours.
`20 2` = 20 visits, 2 hours, 40 participant-hours.
`-20 2` reverses one matching active event in the same scope; `1` repeats the latest eligible baseline.

## Confirmed from source
- `src/lib/sms.ts` parses the first field as attendees (0–10,000) and the second as hours (0.25–24, quarter-hour increments).
- `tests/sms.test.ts` checks `20 2` => 20 attendees / 120 minutes, bounds, invalid syntax, webhook and reversal.
- `docs/DEMO_RUNBOOK.md` uses `20 2`, `31 3`, with 51 visits, 5 hours, 133 participant-hours.
- Google Drive Team Fluffball pitch uses `16 2` without adjacent field labels.
- Deployment documentation reports v24 and 325 passing tests as of Oct 25; this audit does not revalidate production.

## Risk
Legacy `<hours> <participants>` input such as `2 16` is syntactically valid under the current parser: 2 visits and 16 hours. Multiplication is commutative, so participant-hours remains 32 while visits and session hours are swapped. Signature verification, deduplication and ordinary numeric bounds cannot identify sender intent. Values such as `2 20` also pass. `2 30` fails because 30 hours exceeds the bound, but that does not detect all reversals.

## User-facing copy
**Send: PEOPLE HOURS** — for example, **16 2** means **16 attendee visits for a 2-hour session**. To reverse that exact entry, send **-16 2**. Send **1** to repeat your latest eligible session. If unsure, confirm the numbers with your program administrator before sending.

Use this explicit sentence alongside every SMS example in the pitch, onboarding and live/demo UI. Avoid automatically swapping fields: both orders can be legitimate.

## Reproducible regression cases
| SMS | Expected |
| --- | --- |
| `16 2` | 16 attendees, 120 minutes, 1920 participant-minutes |
| `2 16` | 2 attendees, 960 minutes, 1920 participant-minutes; valid but potentially ambiguous |
| `2 20` | 2 attendees, 1200 minutes; valid but potentially ambiguous |
| `20 2` | 20 attendees, 120 minutes |
| `0 0.25` | 0 attendees, 15 minutes |
| `2 30` | invalid: hours exceed 24 |
| `-16 2` | reverse one matching scoped active `16 2` |
| `1` | repeat only with eligible current-scope baseline |

Add automated assertions for these cases to `tests/sms.test.ts` and run `npm run check` in a checkout. Confirm any warning UI against both real and synthetic input paths before enabling it.

## Deployment and data safety
This review makes no changes to production parser, database, receipts, historical counts or deployed hosting. Preserve original raw SMS, immutable counted records, and reversal provenance. If a protocol version becomes necessary, apply it prospectively to newly enrolled senders with explicit opt-in and versioned binding metadata; keep legacy receipts under their original semantics. Any historical correction requires authorized per-record review, original sender intent evidence, audit trail, and aggregate reconciliation in a staging copy before an approved production action.

## Remaining verification
Inspect all UI labels and seeded SMS examples; run local checks; inspect private quarantine and authorized sample receipts only in the real environment; confirm sender training and the hosted build hash. No historical corruption is established by this audit.
