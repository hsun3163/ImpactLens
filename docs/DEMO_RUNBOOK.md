# ImpactLens: two inputs, one shared picture

## Running app

- Course maintenance: https://impactlens.inacra.chatgpt.site/courses
- Browser-local course rehearsal: https://impactlens.inacra.chatgpt.site/demo/courses
- Combined synthetic SMS rehearsal: https://impactlens.inacra.chatgpt.site/sms/demo
- Live TPW dashboard: https://impactlens.inacra.chatgpt.site/sms
- One-time live phone binding: https://impactlens.inacra.chatgpt.site/sms/admin
- Organization dashboard: use the organization link in the live TPW dashboard. It contains that organization's saved ID, not its name.

The deployed v24 app provides these course and SMS flows. Use the fictional demo routes for rehearsal and authorized live records for a real-message demonstration.

## The two input functions

1. **Maintain each course once, reuse what is already known.** Select a saved organization and program, choose an existing facility, reuse or add a yard, and maintain the existing course dates/status/results. “Add another like this” copies the organization, program, facility and yard, plus participant count and whole-course hours as editable defaults. Dates, completions and notes are cleared. This replaces repeatedly filling the same context into a blank form. It adds no new survey indicators.
2. **Report a session using an ordinary text message.** After an administrator explicitly associates a teacher's phone with one saved course, the teacher sends `20 2` to the shared receiver: 20 participant visits, 2 session hours, 40 participant-hours and one session. No teacher app, model, account signup, or organization code in the text is required.

The result is a line connecting counted SMS attendance points for that course, plus the organization and TPW totals. The graph sequence is **SMS receipt order**, not actual class dates. These are self-reported visits, not unique people, attendance adherence or causal rehabilitation outcomes.

## Four-minute pitch

- **0:00–0:35 | The burden.** A partner organization repeats the same program/location information for multiple courses. Session activity then arrives separately. Show the saved course workspace, not another long intake wizard.
- **0:35–1:35 | Input 1.** Open `/demo/courses`. Reuse a saved organization/program, choose a facility, reuse/add a yard, and save a new course. Use “Add another like this” to show context reuse and editable participant/hour defaults while dates, completions and notes reset. State that all displayed rehearsal records are fictional and stored in this browser.
- **1:35–2:40 | Input 2.** Open `/sms/demo` in the same browser. Select the newly saved course and explicitly bind the fictional sender. Simulate `20 2`, then `31 3`. A real teacher uses their normal messaging app; this rehearsal sends no text. The synthetic flow follows the same exact numeric parser.
- **2:40–3:25 | Shared visibility.** Show the new connected course points, organization totals and TPW totals. Explain receipt-order labels and the distinction between session visits and whole-course participants/completions.
- **3:25–4:00 | Trust and boundary.** Invalid messages do not change the graph or totals; duplicate provider delivery cannot double count; private live data remains behind the existing administrator allowlist. Finish with the core value: reusable course context, ordinary SMS, visible recorded activity. Show the separate organization-leader request/MCP workflow when the required scoped grants and assistant connection are configured.

If a newly deployed live course/phone binding and an actual phone are available with authorization, replace the simulated text segment with a real send. Otherwise keep the synthetic banner visible and do not claim an actual carrier-to-dashboard test.

## Required rehearsal checks

Use fictional data only in the demo routes. Demo reset changes browser-local rehearsal data, not live records.

1. Reset the demo. Search for a course, reset again and confirm the search/filter no longer hides the restored courses.
2. Add or select an organization/program. Add a course, selecting a source facility and adding an allowed free-text yard. Save and reload. Confirm it persists.
3. Add another course like it. Confirm organization/program/facility/yard are reused while dates, hours, participants, completions and notes are blank and status starts Planned.
4. Choose that course in `/sms/demo` and explicitly save the fictional phone binding. Confirm the same saved course is used, not a separately invented fixture.
5. Simulate `20 2`, then `31 3`. Relative to the displayed baseline, totals must gain **2 sessions, 51 visits, 5 session hours and 133 participant-hours**. The selected course must gain two points.
6. Simulate `0 0.25`. It must add a real zero-attendance point and one session with 0.25 session hours, adding zero visits and zero participant-hours.
7. Simulate invalid text and an unregistered sender. Neither should create a counted point or alter dashboard totals.
8. Switch/rebind to a different saved course. Only later check-ins use the new course; the old course retains its points. Reload both pages and verify course maintenance did not erase rehearsal bindings or records.
9. Exercise cancel/discard, repeated save clicks, an open draft during reload/cross-tab changes, empty states and reset. Never silently overwrite an unsaved course draft.

## Live acceptance after publication

Live actions below require an authorized administrator and an authorized teacher phone. They are not performed by a source migration or a build.

1. Confirm the deployment contains additive migration `0004_course_sms_binding.sql`. Existing program totals and counted SMS must remain unchanged. Existing teacher mappings and SMS must remain course-unassigned until an administrator explicitly binds a phone for future messages.
2. Sign in with an allowlisted account. Create or select the intended saved course using `/courses`; do not invent courses solely to attach historical SMS.
3. In `/sms/admin`, edit the existing authorized teacher binding, select its matching organization/program/course, and save. One sender maps to one current course. Every organization uses the same configured receiver shown privately in administration.
4. Open the course attendance view, the relevant organization dashboard and the TPW dashboard. Record their starting totals. Send a new ordinary numeric SMS from that bound phone to the configured receiver.
5. Verify exactly one new course point and the expected deltas on both dashboards. For a latency measurement, capture the original SMS receipt timestamp and first visible update separately from carrier delivery.
6. Confirm the empty TwiML response sends no application-generated SMS reply. Check the private quarantine ledger if nothing counted. Do not repeatedly resend the same message as an attempted “retry” without understanding whether each is a distinct SMS.
7. Test unauthenticated and non-allowlisted sessions: no live course points, contact details, raw SMS or live dashboards may be returned. Organization display URLs remain admin-filtered views, not delegated organization accounts.

## Known limits and honest claims

- Synthetic rehearsal runs only in browser storage, without Twilio or the production database. Its speed is not evidence of live end-to-end speed. Do not enter real phone numbers or private records there.
- Numeric SMS contains no session date. The line is receipt-ordered, with a stable ID tie-break for equal timestamps. Late explicit quarantine recovery can add an earlier receipt to the sequence. It does not reconstruct class dates.
- Only counted SMS explicitly attributed to a course at receipt can appear in that course's series. Historical and unknown-sender unassigned records remain unassigned even after recovery. They still contribute to appropriate program/organization/TPW totals when counted.
- Phone rebinding and metadata renaming do not rewrite existing SMS snapshots. A course referenced by a binding or SMS cannot move to a different organization/program; create a separate course instead. Course details may be corrected without changing past snapshots.
- Course charts show at most the latest 1,000 counted points, labeled when truncated. Course totals include all its counted records.
- Manual course hours per participant × participants completed remain a separate whole-course derived measure. SMS participant-hours sum attendance × session hours. Neither replaces the other.
- No new collection indicators, individual-participant tracking, outcomes/recidivism inference, conversational agent, paid add-on, outbound acknowledgment, or organization-user access is part of these two functions.
- Facility vocabulary stays the existing 31-value source list. Yard is optional existing free text with reuse suggestions scoped to organization and facility. No source spreadsheet import, backfill or live spreadsheet synchronization is implied.

## Engineering verification

Run `npm run check` after the final change. It includes type checking, all unit/SQLite/API/security tests, source-data validation and the production build. Tests cover additive migration, legacy records, explicit binding, ownership consistency, immutable history, quarantine recovery, zero attendance, duplicate delivery, unchanged aggregates, private access and receipt sequencing. Local tests do not replace the hosted acceptance above.
