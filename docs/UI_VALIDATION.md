# UI validation record

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
