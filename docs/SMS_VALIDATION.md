# SMS module validation record

The checked SMS implementation was published as Sites revision 6 on October 24, 2026 at 20:13 UTC, at hosting source `0be5d80e82c5daff50a31d0ac8bfdd92a537d457`. The repository mirror uses its own commit history. Native publication success is established; provider/admin runtime configuration, real carrier delivery and hosted two-display acceptance remain unverified.

## Verified locally

- TypeScript typecheck passes for the preserved application plus SMS code/UI.
- Repository unit/security tests: **52 passed**, including 14 SMS-specific tests using the actual SQL migrations/triggers.
- Independent review: **23 checks passed** against real local Cloudflare D1/Miniflare, not only a mocked database. The independent harness covered signature/configuration failures, future signed parameters, simultaneous SID redelivery, concurrent admin retry, quarantine exclusion, one-phone mapping, reassignment/name history, scoped queries, private data, and the reused-phone/original-inactive-teacher regression.
- **12 runtime checks passed** against the built local Worker. These remain local-runtime evidence, not carrier or hosted-browser acceptance.
- All three migrations apply cleanly to an empty local D1 database. Migration 0000 is unchanged. New records and counter updates are atomic; an injected aggregate-write failure rolls back the ledger insert and a later retry counts once.
- SQLite EXPLAIN confirmed the live recent-feed queries use the new global and organization compound indexes rather than sorting the full history.
- Independent local timing sampled an accepted write followed by both organization and global API reads at approximately **60 ms** in one local D1 run. This is a local backend observation only, not a hosted/browser/carrier benchmark or guaranteed percentile.
- The existing official data validator passes: 38 rows matched against five PDF table pages, two SHA-256 checks, CSV parity, evidence associations and published counts/rounding/totals.
- Vinext production build succeeds and packages the Worker, client assets, and append-only migration files. The final checked application source is the hosting commit identified above.

## Not established by the local tests

- Twilio account/number availability, account restrictions, correct hosted runtime-secret configuration, or actual signed delivery from a teacher's phone.
- Production Sites gateway identity-header stripping and allowlist behavior for the final deployment.
- Hosted D1 migration/application status for the final published SMS revision.
- One-second webhook-arrival-to-both-displays visibility. Fast mode requests every 250 ms without overlap, but end-to-end visibility requires an actual two-screen observation with careful clock handling.
- Phone-to-carrier-to-provider delivery time. That interval is separate and not controlled by this application.
- Organization-specific staff authentication. Live organization pages are filtered TPW-admin displays, not separate organization login scopes.

## Final acceptance sequence

1. Publish the exact checked source and verify native deployment success and packaged migrations 0000/0001/0002.
2. Configure only the authorized provider account/number and TPW administrator IDs. Confirm anonymous and non-admin live requests remain rejected.
3. Add one authorized test organization, program and teacher phone through the maintenance form.
4. Open `/sms?fast=1` and `/sms/org/<id>?fast=1` in two visible foreground displays.
5. Send `20 2` from the registered phone. Confirm one private raw record, correct immutable attribution, +1 session/+20 visits/+2 session-hours/+40 participant-hours on both displays, and no outbound application acknowledgment SMS.
6. Record actual server receipt and first visible update on each screen. Do not equate an old row loaded on page-open with a new-message latency sample. Record carrier delivery separately when observable.
7. Re-deliver the same provider SID through the authorized provider tooling and verify no duplicate. Send invalid input and an unregistered sender only with authorized test contacts; confirm private quarantine and unchanged totals.

Synthetic rehearsal `/sms/demo` is clearly labeled and writes no live records. Never substitute its immediate browser-local animation for step 5's real SMS acceptance.
