# ImpactLens delivery evidence

The v1 static application was verified on 24 October 2026. This is an independent Hack for Social Impact prototype, ready for discussion and refinement with TPW. It is not an official CDCR or TPW product.

## SMS module: publication revision 6

- Public application: https://impactlens.inacra.chatgpt.site
- Sites publication revision 6 succeeded on **2026-10-24 at 20:13 UTC**, using hosting source `0be5d80e82c5daff50a31d0ac8bfdd92a537d457`.
- The source mirror contains the SMS schema, append-only migrations 0001/0002, signed inbound webhook, private TPW/organization displays, maintenance form, tests and operational documentation. Migration 0000 and the existing aggregate-data features are preserved.
- Local verification passed: typechecking, **52 unit/security tests**, **23 independent real-local-D1 checks**, **12 built-Worker runtime checks**, official-data validation and the production Worker build. The exact scope and limits are in [SMS_VALIDATION.md](SMS_VALIDATION.md).
- The runtime still needs authorized provider/number and TPW-admin configuration. **No real carrier→webhook→two-displays acceptance or hosted one-second latency result is claimed.** The public `/sms/demo` route is synthetic and browser-local; it is not a substitute for live delivery.
- This publication identifier is separate from the GitHub source history. Inspect the Actions run for the exact GitHub commit containing this section; earlier backend runs below do not validate the SMS source.

See [SMS_DEMO.md](SMS_DEMO.md) for setup, acceptance steps and privacy boundaries. Organization pages currently use the same TPW-admin access boundary; they are filtered displays, not separate organization-staff accounts.

## Historical v2 backend architecture: publication revision 4

The v2 architecture replaces the static export with a Sites/Vinext Cloudflare Worker, trusted-header ChatGPT authentication, owner-scoped aggregate projects in D1/R2, server-side validation/statistics, and stored reports. Browser import remains local until the user explicitly chooses to save. Architecture versions and hosting publication numbers are distinct: revisions 3 and 4 both use the v2 backend architecture.

### Publication revision 4 and source

- Public application: https://impactlens.inacra.chatgpt.site
- Sites publication revision 4 succeeded on **2026-10-24 at 14:53:48 UTC**.
- Hosting source commit: `156269a539eeb778b45aa7e96bae47ec70fdc992`.
- GitHub repository: https://github.com/hsun3163/ImpactLens
- Backend source pushed to GitHub: `500da191720ac0224f504d6d894856e385f741e2`; the branch update was confirmed.
- Hosted backend CI: https://github.com/hsun3163/ImpactLens/actions/runs/40104610755. **All jobs and steps passed** for exact head `500da191720ac0224f504d6d894856e385f741e2`, verified at **14:55:57 UTC**. This includes locked dependency installation, typechecking, tests, checksum-verified PDF restoration, independent source-data validation, canonical-data regeneration/drift checks, Worker build, and deployment-artifact checks.

The repository and hosting mirror use distinct commit histories. The hosting commit above identifies the published artifact; the GitHub commit identifies the pushed backend source. A later documentation-only commit is separate from either implementation identifier.

### Publication revision 4 checks

- **Typechecking, all 38 automated tests, and the Worker production build passed.** The added regression preserves explicit synthetic labels through browser parsing, save serialization, D1 reopening, server analysis, and all three report formats. Supplied official claims still become uploaded, never verified official evidence.
- **All 11 live anonymous/security checks passed again** after v4 publication, including private-route rejection and stripping of caller-forged identity headers at the hosted gateway.
- Existing saved projects reopen after the upgrade, and previously stored reports remain byte-identical. The upgrade does not rewrite old project/report records.
- The final authenticated cloud-browser regression **passed at 14:55 UTC**: import the demo CSV → explicitly save → reload/reopen → run server analysis → generate a stored report → download JSON, CSV, and Markdown. Inspected JSON/CSV retain all six synthetic rows and correct counts/rates; JSON row warnings and the Markdown `SYNTHETIC DATA` warning are present. This verifies the stored artifacts, not merely the import banner.

### Broader backend and browser checks from publication revision 3

Publication revision 3 succeeded at **14:27:39 UTC** on 2026-10-24 with hosting source `a3bebddec24e503601e2502ed1f7464731fc6d61`.

- Its automated suite passed 37 tests before the v4 regression was added.
- **13 actual local runtime checks passed** against the built Worker with local D1 and R2, not only mocks. They cover authenticated creation, reloading saved rows, server rates/Wilson intervals, report history, three persisted report formats, anonymous rejection, cross-origin rejection, and other-user denial. D1 records and all three R2 artifacts survived a complete Worker process restart. The initial pass was recorded at 14:26:18 UTC and restart verification at 14:28:01 UTC.
- **11 live anonymous/security checks passed**, and the deployed canonical public dataset matched all **38 official aggregate rows**.
- **Authenticated cloud-browser checks passed:** explicit save, reload/reopen, server analysis, report generation, report-history refresh, and actual JSON/CSV/Markdown downloads. Inspected downloads contained the six expected synthetic rows and correct counts/rates when saving the built-in Demo dataset.
- Sign-out restored private-endpoint denial while public exploration continued to work; signing in again succeeded.
- Desktop layout was checked at a **1,173-pixel viewport**, with no horizontal overflow observed. Mobile viewport testing was unavailable and is not claimed.

These are layered checks, not a security certification. Synthetic identities establish cross-owner application behavior locally; no two-account hosted isolation test is claimed. See [UI_VALIDATION.md](UI_VALIDATION.md) and [BACKEND.md](BACKEND.md) for scope and limitations.

### Verification and operational limits

The deployed v4 implementation, final imported-synthetic-report regression, and linked backend CI run are verified above. A subsequent documentation-only commit requires its own GitHub CI result; the passing run cited here is tied to its exact backend-source head. These results do not imply a full security, accessibility, or production-readiness audit.

The v2 privacy boundary differs materially from v1: explicitly saved aggregates persist in cloud storage and do not disappear at logout. No self-service deletion, retention guarantee, team sharing, or regulated-data certification is provided. Already stored records are not retroactively relabeled by the synthetic-import fix.

## Historical v1 access and source

- Public application: https://impactlens.inacra.chatgpt.site
- GitHub: https://github.com/hsun3163/ImpactLens
- Passing hosted CI: https://github.com/hsun3163/ImpactLens/actions/runs/40079891433
- CI source commit: c86a96ef52cad7a629b18eea45c7e0e8e90636e7
- Static-site publication revision 2 source commit in hosting mirror (still v1 architecture): cafed504ef061df0475deb1fff9fef42bfbac2e2
- Hosted publication succeeded at 08:56 UTC. Repository and hosting mirror use separate commit histories; the application source corresponds to the same verified implementation.

## Historical v1 implementation and checks

- Next.js 16 / React / TypeScript static application, custom responsive CSS and Recharts.
- 38 genuine CDCR public aggregate rows from two checksum-verified official reports.
- 19 complete fiscal-year release cohorts, FY2002–03 to FY2020–21.
- Latest three-year conviction outcome: 11,886 / 30,116, approximately 39.5%.
- Enhanced-credit comparison uses original counts, not subtraction of rounded percentages: earners 5,011/15,029 versus non-earners 6,875/15,087; earners minus non-earners is −12.2268 percentage points. This is an unadjusted descriptive association.
- Twenty-one automated tests pass; independent Python parsing checks source tables, counts, source hashes, locators, CSV consistency and projection parity.
- CI independently restores official PDFs, runs typechecking, unit tests, data validation and data-regeneration drift checks, and builds the site.
- Five browser tabs, cohort filters, real-data charts/tables, descriptive comparisons, browser-local aggregate CSV validation, deterministic workflow artifacts and downloadable CSV/Markdown reports.
- Browser checks cover a valid six-row synthetic upload, forbidden identifier headers, malformed CSV, stale-state clearing, workflow invalidation and completed downloads. See UI_VALIDATION.md for precise screen sizes and regression details.

## Historical v1 data boundaries

Official data, six labeled synthetic demonstration rows, and user-uploaded aggregates remain distinct. No TPW organization-specific records are included. The current official outcome is conviction within 36 months, with supervision-status and other subgroup comparisons; the application does not claim to measure every rehabilitation outcome. The source excludes 539 latest-cohort releases without DOJ criminal-history records from conviction denominators. This is a record-availability limitation, not proof of perfect outcome ascertainment among included records.

In v1, CSV processing happened in browser memory and there was no upload backend or database. This statement no longer describes explicit cloud saving in v2. Neither version invokes a runtime model API. Strict column validation rejects identifying-column names; users remain responsible for keeping free-text labels and small-cell aggregates appropriately non-identifying.

## Development workflow and usage

Research, statistical implementation, frontend engineering, independent source verification, documentation and browser validation were performed using separate native assistant roles, coordinated through shared artifacts. The shipped five-stage workflow is executable deterministic code. It does not run live LLM agents or autonomously retrieve new research.

No Codex CLI, Codex cloud task, Claude Code session or external coding-agent API was invoked for this project. No paid API or new subscription was used. This action record is distinct from provider-side billing/accounting that the application cannot inspect.

## Useful hackathon refinement

1. Ask TPW which population, program eligibility, outcome definition and follow-up period they want to evaluate.
2. Map their existing aggregate exports into the documented schema and quantify missing outcomes.
3. Choose one additional meaningful outcome beyond conviction, with a usable denominator and observation window.
4. Plan governed individual-level linkage and a defensible comparison design with subject-matter partners before estimating causal effects.
5. If a live model-assisted workflow is later desired, add it as an explicitly authorized, separately evaluated capability; retain deterministic calculations and source validation.
