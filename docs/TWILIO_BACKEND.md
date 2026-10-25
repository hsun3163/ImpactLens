# Twilio backend and reproducible release

This repository contains the **application-side SMS receiver and business logic**, not Twilio's managed SMS network, a provisioned phone number, account credentials, or a copy of the live database. The application source in this release mirrors deployed Sites v24, source `e1d9c5147b010b22d996c206e8acde7b6f742749`. Configure a new installation using the steps below.

## End-to-end path

```text
Teacher's ordinary SMS
  -> Twilio-managed receiving number
  -> HTTPS POST /api/sms/inbound (form-encoded, X-Twilio-Signature)
  -> Cloudflare Worker: verify URL/signature/account/destination/envelope
  -> deterministic numeric / repeat / reversal processing
  -> transactional D1 receipt and attendance records
  -> authenticated course, organization and TPW dashboard queries

Separately authorized leader's free-text SMS
  -> durable organization-scoped business request (not attendance)
  -> external assistant reads requests/context over authenticated /mcp
  -> bounded proposal -> authorized, audited execution
```

The receiver verifies the provider signature before accepting data. The exact configured public URL participates in signature verification. Provider redelivery is deduplicated by MessageSid. Unknown/inactive senders and invalid messages do not silently become counted attendance.

- `20 2`: 20 attendee visits, two session hours, 40 participant-hours. Zero attendees are valid; hours must be 0.25–24 in quarter-hour increments.
- `1`: repeat the latest eligible, non-reversed attendance baseline for the current binding. With no eligible baseline it is quarantined, not guessed or backfilled.
- `-20 2`: reverse one latest matching active session within the same sender/teacher/organization/program/course scope. It preserves the original receipt and records a reversal link; it does not insert negative attendance or delete history.
- Successful webhook handling returns empty TwiML; the application sends no acknowledgment SMS.

These are recorded activity measures, not unique participants or causal outcome estimates. Synthetic generated activity is labeled separately from SMS receipts and verified outcomes.

## Where the backend is in the code

| Responsibility | Files |
| --- | --- |
| Worker/API entry | `worker/index.ts`, `src/app/api/[[...path]]/route.ts`, `src/server/api.ts` |
| Signature and numeric/repeat/reversal parsing | `src/lib/sms.ts` |
| Inbound webhook, sender/course binding, private administration and queries | `src/server/sms-api.ts` |
| Atomic scoped reversal and deduplication | `src/server/sms-reversal.ts` |
| Receipt/generated-activity separation | `src/server/attendance-source.ts` |
| Database schema and additive migrations | `db/schema.ts`, `drizzle/0000_*.sql` through `drizzle/0009_*.sql` |
| Scoped external-agent business workflow | `src/server/business-agent-*.ts`, `src/server/business-admin-api.ts`, `src/app/mcp/route.ts` |
| Optional signed wake-up events | `src/server/business-events.ts`, `src/lib/business-event-security.ts` |
| Tests | `tests/sms.test.ts`, `tests/attendance-source.test.ts`, `tests/business-mcp.test.ts` and related tests |

## Configure your own authorized installation

1. Follow [backend setup](BACKEND.md) to provision the application's own Worker/Sites hosting, D1 `DB` and R2 `BUCKET` bindings, authentication and additive migrations. A different installation needs its own hosting project identity; the checked-in hosting manifest identifies the original application and does not grant access to it.
2. Set runtime configuration using your platform's secret/configuration controls. `.env.example` has **empty placeholders only**. Never commit real values, private phone lists, account IDs, grants, receipt logs or database exports.

   | Name | Meaning |
   | --- | --- |
   | `TPW_ADMIN_USER_IDS` | Explicit allowlist of authenticated Sites administrator user IDs |
   | `TWILIO_ACCOUNT_SID` | Authorized receiving Twilio account identifier |
   | `TWILIO_AUTH_TOKEN` | Twilio signing credential; keep secret |
   | `TWILIO_PHONE_NUMBER` | Your receiving number in E.164 format |
   | `TWILIO_WEBHOOK_URL` | Exact public HTTPS URL, `https://YOUR_HOST/api/sms/inbound`, without query parameters |

3. In the authorized Twilio number's incoming-message configuration, choose an HTTP webhook, method **POST**, with exactly the same URL as `TWILIO_WEBHOOK_URL`. This is a separate provider-console configuration; cloning the repository does not perform it. Do not route the webhook through a URL rewrite that changes the signed public URL.
4. Sign in as an allowlisted administrator at `/sms/admin`. Create/select the organization and program, maintain the course, and explicitly bind each authorized sender's E.164 phone to the intended program/course. The receiving number is shared; sender bindings determine scope. Changing a binding affects future receipts, not historical snapshots.
5. With permission to send a real test message, submit one numeric SMS and verify exactly one canonical receipt plus the expected course/organization/TPW deltas. Test duplicate delivery, an invalid message, repeat and reversal in a controlled test installation. Do not send live messages or change real records merely to run the unit tests.

The repository tests use fictional values and SQLite adapters. Real numeric SMS and reversal have also been exercised on the running application; see [verification](SMS_VALIDATION.md).

## Natural-language requests and external automation

Numeric, repeat and reversal handling requires no LLM. For free-text course maintenance, a TPW administrator must separately grant an exact sender leadership for one organization and grant the authenticated assistant account scoped business access. See [external assistant contract](EXTERNAL_AGENT.md). Attendance-only teacher registration is not a leadership grant.

An external assistant can use `business_list_requests`, `business_get_context`, proposal and execution tools through `/mcp`. A separately configured scheduled polling task can call those tools; **the repository does not include or automatically create that external schedule**. Optional [MCP Events](MCP_EVENTS.md) can wake a supported external assistant after callback-origin configuration and verified subscription. `MCP_EVENTS_CALLBACK_ORIGIN` is optional configuration, not a model API key. Subscription signing secrets are private runtime data and must not be exported.

Verify the assistant connection, organization grants and chosen polling/event setup with one authorized request. Deterministic SMS processing remains independent of that connection.

## Public-release data boundary

Public CDCR aggregates and reproducible extraction metadata live under `data/` and `public/data/`. Demo fixtures and `center-seed.ts` / `defy-seed.ts` are explicitly **fictional generated activity**, not participant records or verified outcomes. Fixed seed UUIDs are non-secret scope selectors, not credentials or authorization; the Defy fixture intentionally checks exact pre-existing course scope and is not a general fresh-install seed. A fresh installation should use the browser-local demos or its own authorized records, rather than recreate original private records to satisfy these selectors.

This release excludes live database contents, real SMS bodies/receipts, teacher contacts, grants, credentials, local `.env`/`.dev.vars`, `.wrangler`/`.sites-runtime`, dependencies and generated build artifacts. Do not copy those directories into a public repository.
