# ImpactLens delivery evidence

Verified on 24 October 2026. This is an independent Hack for Social Impact prototype, ready for discussion and refinement with TPW. It is not an official CDCR or TPW product.

## Access and source

- Public application: https://impactlens.inacra.chatgpt.site
- GitHub: https://github.com/hsun3163/ImpactLens
- Passing hosted CI: https://github.com/hsun3163/ImpactLens/actions/runs/40079891433
- CI source commit: c86a96ef52cad7a629b18eea45c7e0e8e90636e7
- Published version 2 source commit in hosting mirror: cafed504ef061df0475deb1fff9fef42bfbac2e2
- Hosted publication succeeded at 08:56 UTC. Repository and hosting mirror use separate commit histories; the application source corresponds to the same verified implementation.

## Implemented and checked

- Next.js 16 / React / TypeScript static application, custom responsive CSS and Recharts.
- 38 genuine CDCR public aggregate rows from two checksum-verified official reports.
- 19 complete fiscal-year release cohorts, FY2002–03 to FY2020–21.
- Latest three-year conviction outcome: 11,886 / 30,116, approximately 39.5%.
- Enhanced-credit comparison uses original counts, not subtraction of rounded percentages: earners 5,011/15,029 versus non-earners 6,875/15,087; earners minus non-earners is −12.2268 percentage points. This is an unadjusted descriptive association.
- Twenty-one automated tests pass; independent Python parsing checks source tables, counts, source hashes, locators, CSV consistency and projection parity.
- CI independently restores official PDFs, runs typechecking, unit tests, data validation and data-regeneration drift checks, and builds the site.
- Five browser tabs, cohort filters, real-data charts/tables, descriptive comparisons, browser-local aggregate CSV validation, deterministic workflow artifacts and downloadable CSV/Markdown reports.
- Browser checks cover a valid six-row synthetic upload, forbidden identifier headers, malformed CSV, stale-state clearing, workflow invalidation and completed downloads. See UI_VALIDATION.md for precise screen sizes and regression details.

## Data boundaries

Official data, six labeled synthetic demonstration rows, and user-uploaded aggregates remain distinct. No TPW organization-specific records are included. The current official outcome is conviction within 36 months, with supervision-status and other subgroup comparisons; the application does not claim to measure every rehabilitation outcome. The source excludes 539 latest-cohort releases without DOJ criminal-history records from conviction denominators. This is a record-availability limitation, not proof of perfect outcome ascertainment among included records.

CSV processing happens in browser memory. The application has no upload backend, database or model API. Strict column validation rejects identifying-column names; users remain responsible for keeping free-text labels and small-cell aggregates appropriately non-identifying.

## Workflow and usage

Research, statistical implementation, frontend engineering, independent source verification, documentation and browser validation were performed using separate native assistant roles, coordinated through shared artifacts. The shipped five-stage workflow is executable deterministic code. It does not run live LLM agents or autonomously retrieve new research.

No Codex CLI, Codex cloud task, Claude Code session or external coding-agent API was invoked for this project. No paid API or new subscription was used. This action record is distinct from provider-side billing/accounting that the application cannot inspect.

## Useful hackathon refinement

1. Ask TPW which population, program eligibility, outcome definition and follow-up period they want to evaluate.
2. Map their existing aggregate exports into the documented schema and quantify missing outcomes.
3. Choose one additional meaningful outcome beyond conviction, with a usable denominator and observation window.
4. Plan governed individual-level linkage and a defensible comparison design with subject-matter partners before estimating causal effects.
5. If a live model-assisted workflow is later desired, add it as an explicitly authorized, separately evaluated capability; retain deterministic calculations and source validation.
