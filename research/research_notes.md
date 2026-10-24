# CDCR evidence acquisition and findings

Accessed 2026-10-24. Official report index: https://www.cdcr.ca.gov/research/offender-outcomes-characteristics/offender-recidivism/

The latest statewide report on the index is for FY2020-21 releases, published June 2026. The selected EACP report URL is dated September 2026. The FY2019-20 statewide PDF is also retained as an auxiliary download but is not used for normalized rows; the newer report contains its trend observation.

## Observed findings, not causal claims

- FY2020-21 statewide: 11,886 convictions among 30,116 eligible releases, published 39.5%, compared with 13,395/34,215 (39.1%) for FY2019-20. Published-rate increase: 0.4 percentage points.
- Enhanced credit earning: 5,011/15,029 (33.3%) with credits versus 6,875/15,087 (45.6%) without, Table 9 printed p28 / PDF p38. Published-rate gap is -12.3 percentage points. This is observational, unadjusted association and not a causal evaluation.
- Exact unrounded credit-rate difference is approximately -12.227 percentage points; preserve counts for deterministic calculations rather than reverse-engineering counts from rounded percentages.
- MCRP: 247/804 (30.7%); FCRP: 50/307 (16.3%), EACP Table 1 p3. No synthetic controls added. Program participant selection is documented in source p7; these program groups should not be compared to each other as treatment/control.

## Scope and validation

38 rows: 19 statewide complete three-year cohorts (FY2002-03 through FY2020-21), 2 credit groups, 3 supervision groups, 2 gender groups, 10 age groups, and 2 EACP programs. The extraction script matches exact source table lines, checks numerator bounds and 0.051 percentage-point rounding tolerance, tests IDs and cohort partition totals. Each row has page/table provenance and its actual extracted line.

All raw PDFs were downloaded from cdcr.ca.gov with curl, verified as PDFs, and converted using pdftotext -layout. Source manifests include byte size and SHA-256. No paid services, private person records, external coding agents, model-generated statistics, or fabricated data were used.
