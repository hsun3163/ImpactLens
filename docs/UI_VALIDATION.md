# UI validation record

## v2 backend: deployed browser verification, publication revision 3

Checked on 2026-10-24 against https://impactlens.inacra.chatgpt.site after publication at **14:27:39 UTC**, hosting source commit `a3bebddec24e503601e2502ed1f7464731fc6d61`. Checks used the cloud browser. This is evidence for the v2 backend architecture, distinct from the historical v1 static-site checks below.

### Authenticated browser flows passed

- Signed in through Sites and explicitly saved an aggregate project.
- Reloaded the application and reopened the saved project, demonstrating hosted persistence beyond browser state.
- Ran server analysis and checked the expected aggregate results.
- Generated a stored report and refreshed report history.
- Downloaded the actual JSON, CSV, and Markdown artifacts and inspected their content: six expected synthetic rows, correct counts/rates, and retained synthetic labels when saving the built-in Demo dataset.
- Signed out, confirmed private endpoints denied access while the public demo remained usable, and signed in again successfully.
- Inspected the desktop layout at a 1,173-pixel viewport; no horizontal overflow was observed.

### Separate API/runtime evidence

- Eleven live anonymous/security checks passed, including private-route rejection and stripping of forged identity headers at the deployed authentication gateway. Public canonical data matches the 38-row evidence baseline.
- Thirteen checks against the actual locally built Worker with D1/R2 passed, including owner isolation, cross-origin mutation rejection, server analysis, report/history storage, all three artifact formats, and persistence through a full Worker process restart.
- These local owner-isolation tests used synthetic identities. They are not evidence of a two-account hosted browser test.

### Finding requiring publication revision 4

The built-in Demo snapshot retained synthetic labels, but importing a CSV containing explicit synthetic labels could relabel it as uploaded. The correction is in progress. The final source revision, publication, test rerun, and browser regression for this imported-CSV path remain pending. Do not describe the v3 pass as verification of that later fix.

### Verification limits

Mobile viewport testing was unavailable, so this pass does not establish mobile/physical-device behavior. No two-account hosted isolation test or full browser accessibility audit is claimed. Unit/local checks for invalid input, quota limits, and request controls are not a substitute for exercising every failure and interrupted/repeated-action path in the hosted browser.

The following entries preserve historical v1 observations, including an initial blocked attempt and later successful deployed checks. Their timestamps, static-build details, and old test counts do not override this v2 record.

## Historical v1 verification

Checked 2026-10-24. This record distinguishes source/unit verification from actual browser interaction.

## Browser setup and current limit

A cloud Chromium browser was discovered through CUA. Attempted a static Python HTTP server for `out/` on port 4173. A retained PTY reported `Serving HTTP on 0.0.0.0 port 4173`, but a separate executor readiness request returned connection refused (HTTP 000), and cloud-browser navigation to `http://localhost:4173` returned `net::ERR_CONNECTION_REFUSED`. A diagnostic server and readiness request in the same execution invocation returned HTTP 200; cross-invocation localhost access still failed, indicating execution/network isolation rather than an application HTTP failure. Local preview is therefore infrastructure-blocked. No unsupported browser or alternate automation framework was used.

No local screenshot was captured, and no visual/mobile/file-chooser/download behavior is claimed verified. Screenshot destination reserved: `/tmp/impactlens-qa` (outside application source). Deployed URL verification is pending availability.

## Independently executed checks

- `npm test`: 20 tests passed, 0 failed.
- Read browser-facing official and demonstration JSON directly: 38 official rows and 6 synthetic rows.
- Confirmed 19 overall historical cohorts.
- Latest overall row: 2020-21, conviction, 36 months, 11,886 events / 30,116 people (39.5% rounded); 539 missing outcomes recorded.
- Enhanced-credit comparison input: no enhanced credits 6,875 / 15,087; earned enhanced credits 5,011 / 15,029. Production comparison tests confirm unrounded-count arithmetic and noncausal interpretation.
- CSV tests exercise valid import, BOM/CRLF/quoted cells, PII and unknown-header rejection, malformed CSV rejection, duplicate IDs, invalid counts, limits, and export formula neutralization.

## Source inspection (not interactive verification)

Five tabs are implemented: Overview, Compare cohorts, Upload data, Workflow, Sources & methods. Upload uses a file chooser/drop target and browser-local parsing. CSV and Markdown brief download actions construct Blob downloads. Workflow calls the production validator and has five inspectable JSON artifacts. Changes to dataset/filter state clear previous workflow artifacts.

Source-review findings were sent to implementation owner: reconcile follow-up selection when changing to an outcome with different valid windows; align fractional follow-up validation with the UI's positive-integer contract.

## Required deployed-browser pass

1. Open default dashboard; verify latest overall count/rate and historical trend.
2. Visit all five tabs and source register.
3. Change year, breakdown, outcome and follow-up selections; verify appropriate empty states and state reconciliation.
4. Compare enhanced-credit groups; verify displayed counts, rates and A-minus-B percentage-point gap.
5. Switch synthetic mode; verify six rows remain explicitly labeled synthetic and separated from official data.
6. Choose valid `public/data/demo.csv`, then PII-header and malformed CSV fixtures; verify success/rejection UI and no stale uploaded results.
7. Download selected CSV and Markdown evidence brief; inspect actual saved file contents.
8. Run pipeline, inspect actual validation artifact, change filters, and verify reset.
9. Inspect mobile viewport/menu and save screenshots using documented CUA support, if available.

## Production access check

The deployed owner-private URL `https://impactlens.inacra.chatgpt.site/` was opened through cloud-browser CUA. It served the expected private access gate (title `Sign in required`, heading `Log in to access`) rather than application content. Selecting `Continue with ChatGPT` led to the official `https://auth.openai.com/log-in` page. This browser has no existing authenticated session. The sign-in form currently offers an email-identifier step and Google, Apple, Microsoft, or phone sign-in. No credentials were entered, no access restrictions were bypassed, and sharing was not changed. Application UI interactions, mobile rendering, uploads and downloads remain unverified in the browser pending authentication.

## Public production UI pass (2026-10-24, after authorized sharing change)

The same deployed URL now serves the application publicly. The prior authentication blocker is resolved. All interactions below were executed through CUA on the deployed site, not inferred from source.

- Default Overview: 2020-21 / overall / conviction / 36 months; 39.5%, 11,886 events / 30,116 people; Wilson interval 38.9–40.0%. Release selector exposes all 19 years.
- Historical selection: choosing 2002-03 updates counts to 47,443 / 99,482 and 47.7%.
- Compare cohorts: overall selection correctly requests a subgroup breakdown. Enhanced Credit shows no-credit 6,875 / 15,087 (45.6%) versus earned-credit 5,011 / 15,029 (33.3%), with correct +12.2 percentage-point A-minus-B gap and noncausal caveats.
- Workflow: run produced all five artifacts; Ingest shows 38 official rows. Validate shows 38 valid rows, no errors, and actual missingness/free-text privacy warnings. Switching Demo resets every stage to not run. Rerun shows mode synthetic, 6 rows.
- Demo labeling: visible `SYNTHETIC · Not real outcomes` and explicit not-real-people/program-results notice.
- Sources & methods: both official CDCR source records, source IDs, tables/page references, original links, definitions, missingness and uncertainty limitations visible.
- Upload: supported file chooser accepted checked-in `public/data/demo.csv`; UI showed 6 rows ready, filename, self-reported/unverified mode and browser-only notice. Fake synthetic identifier-header fixture was rejected with `Personal-identifier columns are forbidden: email`. Malformed fixture rejected with `Malformed CSV: unclosed quoted field.` Failed imports clear prior uploaded rows and disable Export brief.
- Downloads: clicked CSV and Export brief, waited for actual completed downloads, then read files. CSV contains the exact latest row and all schema fields. Markdown contains count/rate, Wilson interval, source URL/page, missing 539, interpretation limits, selected CSV and no-live-AI statement. Copies: `/workspace/shared/impactlens-qa/official.csv`, `official-brief.md`.
- Responsive check: resized the cloud Chromium window with documented native mouse drag to a 500-pixel content viewport. Filters and metric cards reflow; upload form becomes one column; navigation becomes hamburger. Open navigation then Overview worked. This is narrow-desktop responsive testing, not physical mobile/device emulation.
- Screenshots outside source: `/workspace/shared/impactlens-qa/mobile-overview.png` and `/workspace/shared/impactlens-qa/desktop-overview.png` (full-page PNGs).

A temporary `/tmp` fixture path was not visible to the browser file reader; placing synthetic fixtures in the shared workspace resolved the filesystem-boundary issue. This was not an application parser failure.

Pending final revision regression: positive-integer follow-up rejection and outcome/window reconciliation fixes are being deployed by the owner.

## Final revision regression

Freshly reloaded deployed revision with source commit `cafed504ef061df0475deb1fff9fef42bfbac2e2` at 08:56 UTC:

- Header now says `Browser-only uploads`.
- Synthetic 1.5-month fixture rejected with `Row 2: followupMonths must be a positive safe integer.`
- Synthetic two-outcome fixture imported successfully: conviction at 36 months displays 10/100 = 10.0%. Selecting rearrest automatically reconciles follow-up to 12 months and displays 20/100 = 20.0%, without the previous empty selection.
- Downloaded final Markdown brief and inspected `Next evaluation steps`: cohort eligibility/definitions, missingness, baseline risk and participation measures, and governed adjusted evaluation. Saved `/workspace/shared/impactlens-qa/final-brief.md`.
- Source register still renders the two exact official CDCR PDF links, source IDs and printed/PDF page references.
- Saved final desktop screenshot: `/workspace/shared/impactlens-qa/final-desktop-overview.png`.
- Latest independent unit run: 21 tests passed, 0 failed.

Exact 390px/device emulation was not verified. The browser advertises no viewport capability, native window resizing bottoms out at approximately 500px, and opening DevTools showed an organization policy block. The restriction was respected, dismissed, and not bypassed. Responsive claims are limited to the actual approximately 500px narrow-browser check described above.

Final result: core deployed browser interactions and both targeted regressions passed; no remaining observed core UI failure. Device-specific 390px testing remains a stated verification limit.
