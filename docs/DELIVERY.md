# ImpactLens delivery evidence

The v1 static application was verified on 24 October 2026. This is an independent Hack for Social Impact prototype, ready for discussion and refinement with TPW. It is not an official CDCR or TPW product.

## v2 backend architecture: verified publication revision 3

The v2 architecture replaces the static export with a Sites/Vinext Cloudflare Worker, trusted-header ChatGPT authentication, owner-scoped aggregate projects in D1/R2, server-side validation/statistics, and stored reports. Browser import remains local until the user explicitly chooses to save. Architecture versions and hosting publication revision numbers are different: publication revision 3 is the first deployed v2 backend recorded here.

### Publication and source

- Public application: https://impactlens.inacra.chatgpt.site
- Sites publication revision 3 succeeded on **2026-10-24 at 14:27:39 UTC**.
- Hosting source commit: `a3bebddec24e503601e2502ed1f7464731fc6d61`.
- GitHub repository: https://github.com/hsun3163/ImpactLens
- GitHub synchronization and a hosted Actions run for the backend upgrade are **not yet verified**. The historical CI link below applies only to v1 and must not be presented as a passing v2 run.

### Executed checks

- **37 automated tests passed** for the v3 implementation, covering the retained statistical/CSV/data checks and backend security behavior.
- **13 actual local runtime checks passed** against the built Worker with local D1 and R2, not only mocks. They cover authenticated creation, reloading saved rows, server rates/Wilson intervals, report history, three persisted report formats, anonymous rejection, cross-origin rejection, and other-user denial. D1 records and all three R2 artifacts survived a complete Worker process restart. The initial pass was recorded at 14:26:18 UTC and restart verification at 14:28:01 UTC.
- **11 live anonymous/security checks passed** against the deployed site, including rejection of private access and stripping of caller-forged identity headers by the hosted gateway.
- The deployed canonical public dataset matches all **38 official aggregate rows**.
- **Authenticated cloud-browser checks passed:** explicit save, reload/reopen, server analysis, report generation, report-history refresh, and actual JSON/CSV/Markdown downloads. Downloaded files contain the expected six synthetic rows, correct counts/rates, and synthetic labels for the built-in Demo snapshot.
- Sign-out restored private-endpoint denial while public exploration continued to work; signing in again succeeded.
- Desktop layout was checked at a **1,173-pixel viewport**, with no horizontal overflow observed. Mobile viewport testing was unavailable in this pass and is not claimed.

These are layered checks, not a security certification. Synthetic identities establish cross-owner application behavior locally; no two-account hosted isolation test is claimed. See [UI_VALIDATION.md](UI_VALIDATION.md) and [BACKEND.md](BACKEND.md) for scope and remaining limitations.

### Follow-up revision and remaining verification

Browser QA found that importing a CSV containing an explicit synthetic label could downgrade that label to uploaded, although saving the built-in Demo preserved synthetic labels correctly. A corrective publication revision 4 is being prepared. Its exact source commit, publication result, final test count, and uploaded-synthetic-label regression are **pending**; v3 results above are not a claim that the fix is deployed or verified.

The GitHub push and new hosted CI result also remain pending. Dependency installation, final source regeneration, and final build results should be attached to the final revision rather than inferred from a prior run or an Actions badge.

The v2 privacy boundary differs materially from v1: explicitly saved aggregates persist in cloud storage and do not disappear at logout. No self-service deletion, retention guarantee, team sharing, or regulated-data certification is provided.

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
