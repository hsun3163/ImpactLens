# TPW SMS check-in demonstration

## Three modules, no model

1. **Database:** D1 stores organizations, programs, one teacher-phone binding per sender, immutable inbound SMS records, and deterministic program totals.
2. **Front end:** TPW's overall display, organization-filtered displays, and a three-step organization → program → teacher maintenance form. The existing CDCR evidence explorer and saved aggregate projects remain separate and unchanged.
3. **SMS entry:** one dedicated Twilio SMS number posts every inbound message to one signed webhook. The receiver stores the record and derives totals in the same database transaction. No queue, scheduled job, LLM, outbound acknowledgment SMS, or participant-level tracking is involved.

A teacher sends `20 2`: **20 participant visits, 2 session hours, 40 participant-hours, 1 session**. Every teacher sends to the same number. Sender-phone lookup supplies the organization/program. No organization or program code is needed in the SMS.

These are self-reported activity counts, not unique participant counts, verified outcomes, or causal evidence about rehabilitation. Do not enter participant names, health information, or justice-system details in a message.

## Routes

- `/` — preserved CDCR evidence explorer and private saved-aggregate workspace.
- `/sms` — TPW overall live display, accessible only to configured TPW administrators.
- `/sms/org/<organization UUID>` — organization-filtered live display under the same TPW admin boundary.
- `/sms/admin` — simple organization, program, phone-binding maintenance and private inbound ledger.
- `/sms/demo` — explicitly synthetic, browser-memory rehearsal. It does not send SMS or write to the live database. Reloading resets it.
- Add `?fast=1` to live display routes for presentation polling at 250 ms. Normal visible display polling is 1 second; hidden tabs back off. Polls do not overlap.

The demonstration deliberately does **not** implement separate organization accounts or delegated organization permissions. Organization views are filtered displays for TPW administrators, not authorization boundaries for organization staff. A different signed-in account cannot read any live data unless explicitly allowlisted. Do not share an administrator session with organizations as a substitute for scoped access.

## One-time authorized provider setup

The implementation does not buy a number, create a Twilio account, generate credentials, or change hosting secrets. These steps require the account owner's authorized setup.

1. Use one SMS-capable dedicated Twilio number in the authorized account. In the number's incoming-message configuration choose **Webhook**, **POST**, and the exact HTTPS URL below. Do not configure a reply TwiML application or fallback that sends messages. A trial/provider account can impose verification or country restrictions; verify them with the account owner.
2. Configure these runtime values through the Sites secret-management interface, never in Git, frontend code, a URL, or the hosting manifest:
   - `TWILIO_ACCOUNT_SID`: the account owning the dedicated number, `AC…`.
   - `TWILIO_AUTH_TOKEN`: that account's current auth token, used only to verify incoming signatures. No outbound API calls are made.
   - `TWILIO_PHONE_NUMBER`: the dedicated recipient in international E.164 format, such as `+14155550123`.
   - `TWILIO_WEBHOOK_URL`: exactly `https://impactlens.inacra.chatgpt.site/api/sms/inbound`, no trailing slash or query.
   - `TPW_ADMIN_USER_IDS`: comma-separated **stable Sites authenticated user IDs** for explicitly authorized TPW administrators. These are not emails or phone numbers. Obtain the signed-in owner's ID from the existing private session UI/API, not a client-provided form.
3. Preserve the existing Site audience. The current public Site makes the webhook reachable without ChatGPT sign-in; it does not make the SMS records public. The webhook has its own HMAC signature/account/recipient checks. A private Site's login gateway would block ordinary Twilio delivery and needs a separately supported service-access design.
4. Open `/sms/admin` signed in as an allowlisted account. Add an organization, its program(s), and each teacher's phone with exactly one selected program. Use only authorized teacher contact information. The organization's relation is derived from the selected program, not independently free-typed.
5. Open the TPW display and the corresponding organization display on two visible screens, enable fast display, and send a real SMS from a registered phone.

Missing or invalid provider settings fail closed with HTTP 503. Missing administrator configuration never opens records to arbitrary signed-in users. A binding-present indicator is not a successful end-to-end SMS test.

## Exact input contract

- Exactly two numeric fields separated by one or more ASCII spaces, with optional outer whitespace.
- Attendees: integer **0–10,000**, no sign, exponent, comma, or leading zeros.
- Session hours: **0.25–24**, in quarter-hour increments. Accepted fractional suffixes: `.25`, `.5`, `.50`, `.75`; whole hours use `2`, not `2.00`.
- Examples: `20 2`, `7 1.5`, `0 0.25`, `100 3.75`.
- Free text, tabs/newlines between fields, extra fields, negative values, unsupported fractions, and attached media are not counted.
- Text over 1,600 characters is invalid and quarantined within the bounded envelope limit. The HTTP form itself is streaming-limited to 24 KiB; malformed or excessive envelopes are rejected rather than stored.

Teachers receive **no application-generated SMS reply**, even when input is invalid. A successful HTTP response is empty TwiML (`<Response></Response>`), which acknowledges provider delivery without sending a message. Administrators see quarantine reasons privately. If a teacher makes a formatting mistake, have them send a new corrected SMS; the original is never edited.

## Records, mapping and deterministic totals

New schema is appended in `drizzle/0001_pink_captain_stacy.sql`, with fast-poll indexes in `drizzle/0002_orange_dormammu.sql`; migration 0000 is unchanged. Drizzle schema/journal/snapshot are committed alongside it. Migrations contain schema only, never fixtures, phone numbers, or seed records.

- `sms_organizations`: name, stable ID/slug, active state.
- `sms_programs`: name, one fixed parent organization, active state.
- `sms_teachers`: name, globally unique E.164 phone, exactly one current program, active state. The organization is derived from that program. To move a teacher, edit their existing binding. To move a program's work to another organization, create a new program and move bindings; an existing program's parent cannot change.
- `sms_records`: unique Twilio MessageSid, raw body and sender phone, receipt/processing timestamps, parsed metrics, counted/quarantined status/reason, and organization/program IDs and names snapshotted at receipt. Explicit quarantine recovery includes the administrator ID and processing timestamp.
- `sms_aggregates`: program totals, organization ID, latest receipt time. Database triggers increment these inside the same transaction as a counted insert or a guarded quarantine→counted transition.

Metrics use integer minutes: sessions = record count; participant visits = sum of attendees; session hours = sum of session minutes / 60; participant-hours = sum of attendees × session minutes / 60. Visits are **not unique people**. Organization and global totals sum disjoint program counters, not CDCR outcome denominators.

Provider retries use `ON CONFLICT(message_sid) DO NOTHING`. Even simultaneous duplicates cannot double count. Replayed messages do not change attribution after a phone is reassigned, renamed, or disabled. If aggregation fails, the entire insert rolls back, the webhook returns 500, and a provider retry can safely complete it.

Unknown senders and inactive bindings produce stored quarantines with zero effect on totals. Once an administrator fixes the mapping, an explicit **Retry** can count an eligible quarantined SMS exactly once. Automatic provider redelivery never retries quarantines. If the original record already had a known organization/program snapshot, retry preserves that original attribution and names; if it was unknown, the new explicit attribution is recorded. Counted records are database-enforced immutable. Invalid-body records cannot be retried or rewritten.

Disabling an organization, program, or teacher stops **new** submissions from counting; it does not erase historical totals. Existing counters remain visible even for archived entities. There are no deletion controls in this prototype. Establish authorized retention/deletion and operational abuse limits before production use. A newly changed teacher phone does not automatically reassign the old number to another teacher.

## API and privacy

- `POST /api/sms/inbound`: form-encoded Twilio webhook. Verifies HMAC-SHA1 against the exact configured public URL plus **all** sorted received scalar fields, constant-time Web Crypto signature verification; duplicate form keys are rejected. Account SID, recipient number, origin/path and absence of query must match. Invalid signatures never enter the ledger.
- `GET /api/sms/session`: availability/access flags; no raw records, token, or phone number to anonymous/unauthorized users.
- `GET /api/sms/dashboard[?organizationId=<UUID>]`: allowlisted-admin aggregate totals and an aggregate-only recent activity feed. No teacher names, sender phones, raw SMS, MessageSid, or secrets. The filter is server-side.
- `GET /api/sms/admin`: allowlisted-admin maintenance lists and the latest 50 raw records with total counted/quarantined counts.
- `POST /api/sms/admin`: same-origin JSON actions `organization`, `program`, `teacher`, or `retry`, with strict allowed fields and server validation.

Every live read is private/no-store and every write checks authorization and origin, except the externally signed webhook, which intentionally uses signature authentication rather than browser CSRF checks. Trusted identity headers must continue to come from Sites Dispatch; a direct Worker accepting arbitrary caller headers is not a secure deployment. No contact/raw-text public endpoint, client-bundled credential, outbound SMS client, model dependency, or model key is present.

## Latency and honest measurement

The presentation target is **one second from webhook arrival to both visible displays updating**, not a guarantee. Phone → carrier → Twilio delivery is a separate, uncontrolled interval. Normal polling is 1 second; fast display polls every 250 ms, visible and non-overlapping. Network and rendering delays still apply, and slow responses reduce actual poll frequency.

The dashboard reads four queries in one D1 batch/transaction for consistent counts and one round trip. Direct D1 bindings use the primary database; no read-replica Sessions API is enabled. No cache or optimistic counter precedes a committed record.

Each record has `receivedAt` captured on webhook-handler entry and `processedAt` captured immediately before its transactional write. `processedAt` is a processing timestamp, **not an exact commit timestamp**. A dashboard can only observe the record after commit. Response `generatedAt` is the server's response-assembly time. Browser first-observed time can show an approximate receipt→screen age, subject to browser/server clock skew; verify the end-to-end target by recording both screens or using synchronized clocks. Old rows loaded on first opening and explicitly retried quarantines are not new-message latency samples.

Do not claim carrier delivery, hosted ingestion, or sub-second visible updates from local unit-test timings. The provider configuration and a real phone-to-both-screens test remain necessary acceptance steps.

## Local verification and deployment

```sh
npm run install:ci
npm run typecheck
npm test
npm run validate:data
npm run build
```

If the default npm cache is unavailable, use a writable cache, for example `npm_config_cache=/tmp/impactlens-npm-cache npm run install:ci`. The existing PDF hash-check tests require the archived public source PDFs; restore them using `python3 research/download_sources.py` when absent.

Apply only unapplied migrations to a local database, in order. A fresh local database needs all three migrations:

```sh
for migration in drizzle/[0-9]*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
    d1 execute DB --local --config dist/server/wrangler.json \
    --persist-to .wrangler/state --file "$migration"
done
```

Existing local databases with migration 0000 already applied need migrations 0001 and 0002. Never rerun or modify the applied historical migration. Local secrets belong in ignored `.dev.vars`, with synthetic test values, never production credentials. Local emulated storage is separate from hosted data. Publish through the existing Sites workflow; Sites applies packaged pending migrations before uploading the Worker.

`tests/sms.test.ts` executes actual SQLite migrations and trigger SQL. It covers parser boundaries, canonical signatures including new fields, account/recipient/path checks, configuration failure, anonymous/non-admin/CSRF rejection, global/org counts, one-phone binding, immutable historical attribution, quarantine recovery, concurrent duplicates, no outbound reply, raw-data privacy, and transaction rollback/retry. Existing CDCR/security tests remain part of `npm test`.

Current verification and provider/hosting acceptance should be recorded against the exact published source revision. A synthetic rehearsal is useful for showing the flow but must never be presented as a real inbound SMS.
