# TPW SMS check-in demonstration

## Deterministic attendance modules

1. **Database:** D1 stores organizations, programs, one teacher-phone binding per sender (optionally to a saved concrete course), immutable inbound SMS records, and deterministic program totals.
2. **Front end:** TPW's overall display, organization-filtered displays, and a three-step organization → program → teacher maintenance form. The existing CDCR evidence explorer and saved aggregate projects remain separate and unchanged.
3. **SMS entry:** one dedicated Twilio SMS number posts every inbound message to one signed webhook. The receiver stores the record and derives totals in the same database transaction. Attendance does not depend on a scheduled job or LLM and sends no outbound acknowledgment SMS. Separately authorized organization-leader free text may enter the business queue described in [External assistant](EXTERNAL_AGENT.md); it never increments attendance.

A teacher first sends `20 2`: **20 participant visits, 2 session hours, 40 participant-hours, 1 session**. After a valid report for the currently bound course, a new SMS containing `1` adds another session using that same sender’s latest accepted attendance and duration for that course. Every teacher sends to the same number. Sender-phone lookup supplies the organization/program and, after an explicit administrator binding, the concrete course. No organization or program code is needed in the SMS.

These are self-reported activity counts, not unique participant counts, verified outcomes, or causal evidence about rehabilitation. Do not enter participant names, health information, or justice-system details in a message.

## Routes

- `/` — preserved CDCR evidence explorer and private saved-aggregate workspace.
- `/sms` — TPW overall live display, accessible only to configured TPW administrators.
- `/sms/org/<organization UUID>` — organization-filtered live display under the same TPW admin boundary.
- `/sms/admin` — simple organization, program, phone-binding maintenance and private inbound ledger.
- `/sms/reports` — administrator-only recorded-activity reports, funding brief, and separate course-summary review/save. See [reporting contract](REPORTING.md).
- `/sms/demo/reports` — fixed-date, explicitly synthetic reporting example; no live requests or writes.
- `/sms/demo` — explicitly synthetic, browser-local rehearsal sharing saved demo courses with `/demo/courses`. It demonstrates explicit fictional phone/course binding, simulated SMS, a course line and organization/TPW totals. It does not send SMS or access the live database; reload preserves it and Reset restores the synthetic sample.
- Add `?fast=1` to live display routes for presentation polling at 250 ms. Normal visible display polling is 1 second; hidden tabs back off. Polls do not overlap.

Dashboard views remain filtered displays for TPW administrators, not new organization login accounts. Separately granted leader phones and Sites business-assistant accounts may access only their bounded business workflow. Adding a phone creates only a teacher; leadership and assistant access require separate explicit permissions. Do not share administrator sessions as a substitute for scoped access. See [business roles and MCP](EXTERNAL_AGENT.md).

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
4. Open `/sms/admin` signed in as an allowlisted account. Add an organization, its program(s), and each teacher's phone with exactly one selected program. For course-level attendance, first save a course in `/courses`, then explicitly select it in the teacher binding. Program-only bindings remain supported; omitting courseId preserves an existing binding, while explicit null removes it for future messages. Use only authorized teacher contact information. The organization's relation is derived from the selected program, not independently free-typed.
5. Open the TPW display and the corresponding organization display on two visible screens, enable fast display, and send a real SMS from a registered phone.

Missing or invalid provider settings fail closed with HTTP 503. Missing administrator configuration never opens records to arbitrary signed-in users. A binding-present indicator is not a successful end-to-end SMS test.

## Exact input contract

- Numeric entry: exactly two numeric fields separated by one or more ASCII spaces, with optional outer whitespace.
- Repeat entry: exactly `1` after outer whitespace is removed. Each new provider MessageSid adds **one new session**, not a duplicate of the old record. The sender must have a concrete current course binding and an accepted baseline in that same teacher/sender/course/organization/program. Never derive values from course planned hours, participant metadata, another teacher or an earlier course.
- Baselines use serialized acceptance order, not wall-clock timestamps or chart receipt order. A numeric report or an explicit audited numeric correction establishes values; a later accepted repeat can carry them forward through its immutable source reference. Pre-upgrade counted rows use processing time, receipt time and database row order as their deterministic legacy fallback.
- No baseline: save a `REPEAT_BASELINE_REQUIRED` quarantine without changing totals. Send the two numbers first, then a **new** `1`. Provider redelivery or ordinary Retry never backfills a previously unresolved repeat from later data.
- Attendees: integer **0–10,000**, no sign, exponent, comma, or leading zeros.
- Session hours: **0.25–24**, in quarter-hour increments. Accepted fractional suffixes: `.25`, `.5`, `.50`, `.75`; whole hours use `2`, not `2.00`.
- Examples: `20 2`, `7 1.5`, `0 0.25`, `100 3.75`.
- Free text, tabs/newlines between fields, extra fields, negative values, unsupported fractions, and attached media are not counted.
- Text over 1,600 characters is invalid and quarantined within the bounded envelope limit. The HTTP form itself is streaming-limited to 24 KiB; malformed or excessive envelopes are rejected rather than stored.

Teachers receive **no application-generated SMS reply**, even when input is invalid. A successful HTTP response is empty TwiML (`<Response></Response>`), which acknowledges provider delivery without sending a message. Administrators see quarantine reasons privately. If a teacher makes a formatting mistake, have them send a new corrected SMS; the original is never edited.

## Records, mapping and deterministic totals

New schema is appended in `drizzle/0001_pink_captain_stacy.sql`, with fast-poll indexes in `drizzle/0002_orange_dormammu.sql`, course summaries in 0003 and additive course attribution in `drizzle/0004_course_sms_binding.sql`, and nullable repeat provenance/acceptance order/manual-correction audit in `drizzle/0005_sms_repeat_shortcut.sql`; and scoped business roles/requests/proposals/audit in `drizzle/0006_business_roles_mcp.sql`; historical migrations are unchanged. Drizzle schema/journal/snapshot are committed alongside it. Migrations contain schema only, never fixtures, phone numbers, or seed records.

- `sms_organizations`: name, stable ID/slug, active state.
- `sms_programs`: name, one fixed parent organization, active state.
- `sms_teachers`: name, globally unique E.164 phone, exactly one current program, optional concrete course ID, active state. A selected course must belong to that same organization/program; one sender cannot select multiple courses. The organization is derived from that program. To move a teacher, edit their existing binding. To move a program's work to another organization, create a new program and move bindings; an existing program's parent cannot change.
- `sms_records`: unique Twilio MessageSid, raw body and sender phone, receipt/processing timestamps, parsed metrics, counted/quarantined status/reason, and organization/program IDs and names snapshotted at receipt. New course-bound messages also snapshot course ID, organization/program identity, facility, yard and course start/end dates. Those dates describe course metadata, not the date of the reported session. Explicit quarantine recovery includes the administrator ID and processing timestamp. Repeats preserve the raw `1`, resolve immutable metrics and current-course snapshot, and store `repeated_from_record_id`; following the reference chain reaches an explicit numeric report or audited correction. `accepted_order` is allocated in the same atomic acceptance statement. The private admin API exposes `repeatedFromRecordId`, `acceptedOrder`, `manualCorrection` and `canCorrect`.
- `sms_aggregates`: program totals, organization ID, latest receipt time. Database triggers increment these inside the same transaction as a counted insert or a guarded quarantine→counted transition.

Metrics use integer minutes: sessions = record count; participant visits = sum of attendees; session hours = sum of session minutes / 60; participant-hours = sum of attendees × session minutes / 60. Visits are **not unique people**. Organization and global totals sum disjoint program counters, not CDCR outcome denominators.

Provider retries use `ON CONFLICT(message_sid) DO NOTHING`. Even simultaneous duplicates cannot double count. Replayed messages do not change attribution after a phone is reassigned, renamed, or disabled. If aggregation fails, the entire insert rolls back, the webhook returns 500, and a provider retry can safely complete it.

Unknown senders and inactive bindings produce stored quarantines with zero effect on totals. Once an administrator fixes the mapping, an explicit **Retry** can count an eligible quarantined SMS exactly once. Automatic provider redelivery never retries quarantines. If the original record already had a known organization/program snapshot, retry preserves that original attribution and names; if it was unknown, the new explicit program attribution is recorded. Course attribution is never backfilled: a null course ID stays null even on explicit retry. An originally assigned course and its existing snapshot are preserved. A stale course binding quarantines new messages as INVALID_COURSE rather than counting under a guessed course. Counted records are database-enforced immutable. Invalid-body records cannot use ordinary Retry. An inactive repeat can use Retry only if its original baseline, resolved values and course were already frozen at receipt; Retry does not select a newer baseline.

A separate, deliberate **Correct values** action supports an administrator’s explicitly confirmed correction of an `INVALID_BODY` or `REPEAT_BASELINE_REQUIRED` quarantine with known original teacher/organization/program attribution. It requires numeric attendees, session hours and a 1–500 character reason, and preserves the raw SMS, provider SID, receipt time, names, original course and snapshot. Its immutable `manualCorrection` audit records source `manual`, administrator, correction timestamp, reason, original quarantine reason and explicit metrics. The original mapping must be active and any original course must still match its organization/program. Unknown attribution and already-resolved repeat metrics cannot be invented or rewritten. The guarded quarantine→counted transition updates counters once; an identical duplicate correction is idempotent, while changing an already counted record is rejected. This is not automatic retroactive interpretation of historical `1` messages.

Disabling an organization, program, or teacher stops **new** submissions from counting; it does not erase historical totals. Existing counters remain visible even for archived entities. There are no deletion controls in this prototype. Establish authorized retention/deletion and operational abuse limits before production use. A newly changed teacher phone does not automatically reassign the old number to another teacher.

## Separate unbound-course estimates

Existing course participants × whole-course hours per participant can provide a configured participant-hour estimate for an offering without a phone binding. Each saved course ID contributes at most once; multiple branches are separate course IDs. All lifecycle statuses are included as estimates, not claims of delivered service. Disabled phone bindings remain bindings, and archiving an organization/program does not silently remove its configured estimate.

Missing participants or hours remain unknown, even if the other input is zero. Two known inputs may produce a genuine zero. Summary coverage records the number of unbound courses and those missing values. The existing summaries and TPW/organization dashboards return a separate `serviceEstimate` (`participantHours`, `courseCount`, `missingValuesCount`), calculated across every course in the selected scope, not just the 100 visible cards. Individual course summaries also expose `serviceEstimate.hasPhoneBinding` and nullable `participantHours`.

These values use existing fields only, with no schema migration or additional collection. They never change SMS records, counters, attendance lines, dated activity reports, or the existing whole-course hours × completers calculation. Unbinding a phone can make its course eligible for a configured estimate, but all earlier SMS activity remains intact. Estimates and actual activity may overlap and must not be added together.

## API and privacy

- `POST /api/sms/inbound`: form-encoded Twilio webhook. Verifies HMAC-SHA1 against the exact configured public URL plus **all** sorted received scalar fields, constant-time Web Crypto signature verification; duplicate form keys are rejected. Account SID, recipient number, origin/path and absence of query must match. Invalid signatures never enter the ledger.
- `GET /api/sms/session`: availability/access flags; no raw records, token, or phone number to anonymous/unauthorized users.
- `GET /api/sms/dashboard[?organizationId=<UUID>]`: allowlisted-admin aggregate totals and an aggregate-only recent activity feed. No teacher names, sender phones, raw SMS, MessageSid, or secrets. The filter is server-side.
- `GET /api/sms/course-attendance?courseId=<UUID>`: allowlisted-admin counted-only course totals and up to 1,000 recent points in SMS receipt order, with full-sequence positions, immutable identity snapshots and explicit truncation; optional organization/program filters must match. No phone, raw body, teacher identity or provider SID.
- `GET /api/sms/admin`: allowlisted-admin maintenance lists and the latest 50 raw records with total counted/quarantined counts.
- `POST /api/sms/admin`: same-origin JSON actions `organization`, `program`, `teacher`, `retry`, or `correct`, with strict allowed fields and server validation.

Every live read is private/no-store and every write checks authorization and origin, except the externally signed webhook, which intentionally uses signature authentication rather than browser CSRF checks. Trusted identity headers must continue to come from Sites Dispatch; a direct Worker accepting arbitrary caller headers is not a secure deployment. No contact/raw-text public endpoint, client-bundled credential, outbound SMS client, model dependency, or model key is present.

## Dashboard refresh and timing

Normal visible displays poll every second; presentation mode polls every 250 ms without overlap. Measure receipt-to-screen latency separately from phone/carrier delivery. Network, database and rendering time contribute to the observed result.

The dashboard reads four queries in one D1 batch/transaction for consistent counts and one round trip. Direct D1 bindings use the primary database; no read-replica Sessions API is enabled. No cache or optimistic counter precedes a committed record.

Each record has `receivedAt` captured on webhook-handler entry and `processedAt` captured immediately before its transactional write. `processedAt` is a processing timestamp, **not an exact commit timestamp**. A dashboard can only observe the record after commit. Response `generatedAt` is the server's response-assembly time. Browser first-observed time can show an approximate receipt→screen age, subject to browser/server clock skew; verify the end-to-end target by recording both screens or using synchronized clocks. Old rows loaded on first opening and explicitly retried quarantines are not new-message latency samples.

Real numeric SMS intake and reversal have been exercised on the running application. Use a synchronized real-message observation when reporting an end-to-end latency figure.

## Local verification and deployment

```sh
npm run install:ci
npm run typecheck
npm test
npm run validate:data
npm run build
```

If the default npm cache is unavailable, use a writable cache, for example `npm_config_cache=/tmp/impactlens-npm-cache npm run install:ci`. The existing PDF hash-check tests require the archived public source PDFs; restore them using `python3 research/download_sources.py` when absent.

Apply only unapplied migrations to a local database, in order. A fresh local database needs all migrations, including additive course summaries (0003) and course-SMS bindings (0004) and repeat/correction audit (0005):

```sh
for migration in drizzle/[0-9]*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
    d1 execute DB --local --config dist/server/wrangler.json \
    --persist-to .wrangler/state --file "$migration"
done
```

Existing local databases need only their unapplied migrations; a database already at SMS migration 0002 needs 0003–0005; a database at course-summary migration 0003 needs 0004–0005; a database already at course binding 0004 needs only 0005. Migration 0004 assigns no production phones, inserts no courses and leaves historical totals untouched. Migration 0005 adds nullable columns, indexes and audit guards only; it does not change any old record, resolve old `1` messages, or update counters. Never rerun or modify the applied historical migration. Local secrets belong in ignored `.dev.vars`, with synthetic test values, never production credentials. Local emulated storage is separate from hosted data. Publish through the existing Sites workflow; Sites applies packaged pending migrations before uploading the Worker.

`tests/sms.test.ts` executes actual SQLite migrations and trigger SQL. It covers parser boundaries, canonical signatures including new fields, account/recipient/path checks, configuration failure, anonymous/non-admin/CSRF rejection, global/org counts, one-phone binding, immutable historical attribution, quarantine recovery, concurrent duplicates, no outbound reply, raw-data privacy, transaction rollback/retry, same-course repeat baselines, zero attendance, equal-timestamp/concurrent acceptance order, source immutability, no retrospective repeat resolution, manual correction validation/audit/idempotency, and additive migration preservation. Existing CDCR/security tests remain part of `npm test`.

Current verification and provider/hosting acceptance should be recorded against the exact published source revision. A synthetic rehearsal is useful for showing the flow but must never be presented as a real inbound SMS.

## Two-function presentation

See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for the four-minute pitch, combined synthetic rehearsal, known limits and required post-publication real-SMS acceptance. Course maintenance remains independent of SMS setup. Phone binding is an explicit one-time admin control outside the course form. Referenced course organization/program identities are fixed; later metadata edits and phone rebindings never change historical course snapshots.

## Program participant estimate

The main SMS dashboard's **Program participants** metric sums one estimate per organization/program: the highest counted attendance when any counted SMS exists (including zero), otherwise the highest known configured course participant count. It does not add repeated attendance visits or mix configured values into an observed maximum. Unknown programs remain explicit in coverage help. All course statuses and full history are included; bindings and list/chart caps cannot change the result. This estimate assumes no population turnover and is not an individually deduplicated people count.

The course chart uses the same rule within that one course. Session-level points, raw summed attendance and participant-hours remain unchanged in the ledger and reports. Separate unbound configured participant-hours and TPW completed-course hours retain their existing meanings.
