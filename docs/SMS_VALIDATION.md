# SMS verification

## Current release

The deployed v24 receiver supports signed numeric attendance, exact `1` repeat commands, scoped negative reversals, deduplication, private administration and course/organization/TPW queries.

The public-source release passed **325/325 automated tests**, TypeScript checking, PDF-backed data validation and a production Worker build. Real numeric SMS processing has been exercised; a real negative reversal was verified on **October 25, 2026 at 18:45:14 UTC**.

## Automated coverage

The tests exercise signature/configuration failures, provider redelivery, concurrent operations, sender/course scope, immutable history, quarantine exclusion, repeat baselines, reversal matching, aggregate consistency, role revocation and MCP authorization. SQL-backed checks apply the real migrations. Public-data checks independently match 38 rows to the original report tables.

## Reproduce on an authorized test installation

1. Follow [Twilio setup](TWILIO_BACKEND.md), apply the additive migrations and configure the administrator allowlist.
2. Create/select the test organization, program and course; bind an authorized sender.
3. Open the course, organization and TPW displays. Send `20 2` and check +1 session, +20 visits, +2 session-hours and +40 participant-hours.
4. Send `1` and confirm it repeats the eligible baseline for the same binding.
5. Send `-20 2` and confirm one latest matching active session is reversed, with its original receipt retained.
6. Check duplicate provider delivery, invalid input and an unknown sender: duplicates count once and invalid/unknown input stays outside counted totals.
7. Verify anonymous/non-admin rejection and preservation of private contact and receipt data.

Use server receipt and visible-update timestamps when measuring latency. The presentation polling interval and carrier delivery time are distinct measurements. The browser-local `/sms/demo` route provides fictional rehearsal without sending messages or writing live records.

Historical local-D1 and built-Worker checks are summarized in [DELIVERY.md](DELIVERY.md).
