# Focused accessibility review

Reviewed 25 October 2026. This is a bounded improvement pass, **not a WCAG conformance claim or certification**. The intended user is comfortable with email and ordinary forms; the design keeps familiar controls and avoids another settings panel.

## Scope and evidence

- Screens: course maintenance (`/courses`, `/demo/courses`), SMS rehearsal (`/sms/demo`), private teacher/message administration, organization/TPW SMS dashboards, shared course attendance and contextual help.
- Source base: `b41cec3efb13d69e0384d8514d11b03612ab2280` (v12).
- A pre-change browser review exercised keyboard course editing/saving, SMS controls, session-table selection, help focus/hover/Escape/outside dismissal, 200% browser zoom, and a 320 CSS-pixel viewport. Those observed demo flows had no page-level horizontal overflow; tables scrolled within their own regions. This is not equivalent to testing every page, text-only resize mode, device or assistive technology.
- That review measured low contrast in meaningful course labels (about 2.7–3.0:1), SMS instructions (about 3.0:1), form labels (about 3.9:1), and error text (about 4.0:1). It also found rejected SMS feedback outside the narrow-screen viewport and missing field/error associations.
- This patch has source, pure-function, static-render/structure and numerical contrast regression tests. The final aggregate check covers all existing tests, type checking, source-data validation and production build. **Browser rechecking of this changed source is required after publication.** No live course/phone/message records were changed by this review.

## Principles applied

1. **Readable contrast and text.** Normal text needs at least 4.5:1 contrast; qualifying large text needs 3:1. Meaningful control boundaries and state indicators have a separate 3:1 requirement. Text sizing is a product choice, not a claim that WCAG specifies one universal font size. See [W3C contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).
2. **Familiar, clearly labeled controls.** Visible labels remain; persistent field hints are associated with their inputs. Supplemental explanations can be behind help, but necessary examples, units, warnings and errors stay visible. See [WAI labeling controls](https://www.w3.org/WAI/tutorials/forms/labels/) and [older users and accessibility](https://www.w3.org/WAI/older-users/).
3. **Useful feedback without interruption.** Errors should be apparent and connected to the relevant input. Successful actions use status messages; routine polling clocks should not repeatedly interrupt reading. See [WAI user notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) and [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
4. **Predictable contextual help.** Keep hover/focus help dismissible, hoverable and persistent while it is being read. The existing Escape, pointer-entry and tap behavior is retained. See [content on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html).
5. **Large enough controls and adaptable layout.** Our standalone-action target is 44px. WCAG 2.2 AA's minimum is 24px with specified exceptions, not an unconditional 44px rule. Inline desktop help remains 28px; narrow/coarse-pointer help is 44px. Check 200% text resizing and 320 CSS-pixel reflow without losing function. See [target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), and [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Changes

- Darkened meaningful muted text, source notes, placeholders, status/error text and control borders. Raised small ordinary labels/help to readable relative sizes while retaining visual hierarchy and the existing light backgrounds.
- Added consistent, high-contrast keyboard focus outlines and skip-to-content links. Secondary actions, dismiss/refresh controls and session-table buttons have larger targets.
- Added deliberate focus entry/return for course editors and attendance panels; teacher editing and number correction focus their fields. Imperative scrolling respects the reduced-motion preference.
- Kept course errors beside Save; structured completion/date-range errors now mark the relevant fields with `aria-invalid` and associate them with the focused error message. Existing drafts and validation rules remain intact.
- Moved synthetic SMS feedback beside the binding or SMS action. Rejections are focused/scrolled into view, including repeated attempts; background cross-tab notices do not intentionally take focus.
- Kept the changing last-refresh timestamp outside the dashboard live region. Connection-state messages and actual check-in feedback retain appropriate announcement semantics.
- Associated persistent phone-format, facility and whole-course-hours hints with their inputs. Organization selection buttons expose their selected state.
- Preserved chart text alternatives and the session table; added explicit column scopes, names and keyboard-focusable scroll regions rather than hundreds of chart-point Tab stops.

### Checked color pairs

These are numerical checks of selected CSS foreground/background pairs, not an exhaustive rendered-page audit:

- Secondary text `#52674b` on cream `#fffefa`: approximately **6.12:1**.
- The same text on pale green `#eef2e7`: approximately **5.44:1**.
- Form label `#3e5638` on cream: approximately **8.02:1**.
- Input boundary `#829478` against `#fcfdf8`: approximately **3.18:1**.
- Amber notice `#755620` on `#f7f2e2`: approximately **6.03:1**.
- Error text `#863b23` on `#fff3e9`: approximately **7.23:1**.

## Required post-publication checks

1. Re-measure the reported low-contrast labels, hints, notices and input boundaries on the deployed build. Check hover, focus, active and error states, not just defaults.
2. Repeat course list/editor, SMS rehearsal, help and chart-table flows at 200% zoom and 320 CSS pixels after the larger text styles. Distinguish page overflow from intentional table scrolling.
3. Use keyboard only: skip navigation, open/edit/cancel/save a course, open/close attendance, edit a teacher, open/cancel a correction, and select a chart session. Confirm visible focus and a logical return point.
4. Submit completions greater than participants and reversed dates. Confirm the draft remains, the error receives focus, and affected inputs expose the error association. Repeat the same rejected submission.
5. Submit an invalid synthetic text at a narrow viewport. Confirm the error is beside the form, focused and readable; saved bindings and counters remain unchanged. Then submit a valid text and confirm feedback and the chart.
6. Read the dashboard with a real screen reader. Confirm routine refresh timestamps are not announced, but meaningful changes are discoverable. Test keyboard and touch help, Escape and reading long help at zoom.
7. Verify reduced-motion behavior and text-only resizing. No real SMS or production record mutation is necessary for these checks.

## Limits

Review scope: source assertions and the documented public/demo UI checks. A full screen-reader/device matrix, formal WCAG audit and user study are separate evaluation work. Private administration and imported PDF/report views should be included in that broader review. The changes in this pass were limited to presentation and interaction.
