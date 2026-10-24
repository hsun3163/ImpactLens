# ImpactLens statistical methods and aggregate CSV contract

## Descriptive estimand

Each row describes one cohort, outcome, release-year label and follow-up duration. The displayed percentage is exactly `100 × events / denominator`. Counts are authoritative; an uploaded rate column is rejected rather than trusted or reconciled. No rows are summed automatically: different grouping dimensions, follow-up windows, overall totals and subgroups can describe the same people.

A valid denominator is a positive safe integer; events are a safe integer between zero and denominator. Follow-up months must be a positive safe integer. Release year is a nonempty text label, supporting fiscal-year labels. The importer cannot verify that outcome wording, dates or cohort membership are substantively correct.

## Interval calculation

The per-row interval is the two-sided 95% Wilson score interval with `z = 1.959963984540054`. For `p = events/n`, its center is `(p + z²/(2n))/(1 + z²/n)` and half-width is `z × sqrt(p(1-p)/n + z²/(4n²))/(1 + z²/n)`. Bounds are displayed as percentages; boundary estimates remain finite and bounds lie between zero and one.

This interval assumes a binomial model. It does not model dependence, confounding, measurement error, censoring, selection or missingness. For a complete administrative population, the observed rate is known for those recorded individuals: the interval is not sampling uncertainty about that population. It can only be read as model-based variability under an explicitly hypothetical repeated process. It is not an official CDCR interval. Small cohorts, fewer than five events, or fewer than five non-events trigger a sparse-count warning.

## Cohort comparison

A comparison requires identical release-year labels, outcome labels, follow-up duration, grouping dimension and data kind, plus distinct cohort identifiers and labels (or programs). Overall populations are not compared against their subgroups. Even these checks cannot establish equivalent measurement or non-overlapping membership. Source definitions need human verification.

The reported risk difference is `rate A − rate B`, in percentage points. It is a descriptive association, never a causal program effect. No causal adjustment, significance test, pooled denominator, or risk-difference interval is produced. Selection into programs, baseline risk, unmeasured confounding, incomplete follow-up and overlapping cohorts may explain differences. Do not infer program effectiveness from these charts.

## Follow-up coverage and missing outcomes

`denominator` is the number with an observed outcome under the row's stated definition and time window. Optional `missingOutcomes` counts otherwise eligible people whose outcome is unknown, outside that denominator. When supplied, coverage is `100 × denominator/(denominator + missingOutcomes)`. When omitted, coverage is unknown, not 100%. Missing observations are not treated as events or non-events. They do not change the displayed observed-outcome rate. An unknown count or a positive missing count generates a warning. This tool does not perform time-to-event estimation, censoring adjustment or imputation. When a source uses a different denominator definition, document that limitation rather than inventing a missing count.

## Aggregate CSV format

UTF-8 CSV, at most 1 MiB (1,048,576 bytes) and 5,000 nonblank data rows. Headers are case-sensitive. Quoted commas, newlines, doubled quotes, CRLF and an initial UTF-8 BOM are supported. The first nonblank record is the header.

Required columns:
- `id`: unique nonempty cohort-row identifier, never a personal identifier.
- `releaseYear`: nonempty year or fiscal-year label.
- `groupType`: grouping dimension, such as age or program participation.
- `group`: cohort label, such as 25–34.
- `denominator`: positive integer observed-outcome count.
- `events`: integer event count from zero through denominator.
- `outcome`: precise outcome definition, such as reconviction, not a generic success label.
- `followupMonths`: positive safe integer number of months.
- `sourceId`: source report or dataset label.
- `sourcePage`: source page, table or other locator. Use an explicit descriptive locator for unpaginated sources.

Optional columns:
- `program`: nonempty program label.
- `missingOutcomes`: nonnegative integer; a blank cell means unknown.
- `dataKind`: accepted for export round-trips. Both browser import and server parsing preserve an explicit `synthetic` label to keep invented-value warnings. Every other supplied kind, including `official`, becomes `uploaded`. A supplied label never establishes verified provenance.

All other columns are rejected, including supplied rates and source URL columns. Source links belong in the dashboard's separately maintained source registry. Personal-identifier columns such as email, participant ID, CDCR number, date of birth and names are forbidden. Free-text labels cannot be reliably screened for identifiers: users must supply only appropriately aggregated, non-identifying data they are authorized to use. This schema is not an anonymization or de-identification guarantee. Avoid small-cell data that could identify people. Text labels are limited to 500 characters.

Example:

```csv
id,releaseYear,groupType,group,denominator,events,outcome,followupMonths,sourceId,sourcePage,program,missingOutcomes
example-a,2020,participation,Program participants,100,25,Reconviction,36,nonprofit-report,Table 2,Example program,5
example-b,2020,participation,Comparison group,120,36,Reconviction,36,nonprofit-report,Table 2,,
```

Example numbers are illustrative, not official findings. Imported rows are first validated in the browser. If the user explicitly saves a project, the server independently parses and validates the CSV using the same shared schema. Both paths reject the whole file when any row fails, rather than silently excluding invalid rows. Browser import is not itself a server upload. The CSV reader uses explicit decimal numeric syntax, not hexadecimal, scientific notation or permissive `parseFloat`. Zero denominators, negative or fractional event counts, duplicate IDs, unexpected fields, malformed quoting and nonfinite numbers are rejected.

## Export safety and limitations

CSV exports quote every field, double embedded quotes, and prefix spreadsheet-formula-like text with an apostrophe. This can change the literal value of a formula-like text label on reimport, deliberately prioritizing spreadsheet safety. Do not treat uploaded provenance or program labels as authenticated. Keep official, synthetic demonstration and uploaded datasets separate.

## Server calculation and saved-report scope

The v2 backend uses the shared `src/lib/analysis.ts` and `src/lib/csv.ts` functions rather than a separate statistical implementation. Saving never upgrades uploaded provenance to official. A server result remains descriptive and subject to the same overlap, denominator, missingness, and binomial-model limits described above.

Stored reports describe every saved project row. They retain explicit synthetic warnings but never grant official provenance to a saved user-supplied snapshot. Browser filters and a browser-local export should not be assumed to change a saved project or previously generated report. No model-generated analysis, pooled cross-dimension denominator, causal estimate, or individual risk score is added by server persistence.

## Verification

Deterministic unit tests cover hand-calculated Wilson values, all boundary counts for denominators 1–100, rate derivation, compatibility guards, missing-outcome coverage, valid and malformed CSVs, PII/unknown headers, duplicate IDs, limits and spreadsheet formula neutralization. No third-party statistical or CSV dependency is needed.
