# Independent data and calculation validation

The canonical evidence contains 38 CDCR aggregate rows, independently matched to archived report tables with source hashes, integer counts, published rounding and row-level locators. The current release reran this validation successfully alongside 325 automated tests.

The detailed numerical review below was first recorded on October 24, 2026. Backend and browser verification are summarized separately in [DELIVERY.md](DELIVERY.md).

## Reproduce

- `python3 scripts/validate_data.py`
- `node --import tsx --test tests/data.test.ts`
- `node --import tsx --test tests/*.test.ts`

The Python validator is read-only and does not import or run `research/extract_cdcr.py`. It invokes Poppler against archived PDFs, independently tokenizes the reviewed table labels and columns, checks every numerator/denominator/published rate, verifies row-to-source and row-to-evidence associations, recomputes PDF SHA-256 and byte lengths, checks CSV/JSON equality, checks unique IDs and count bounds, and reconciles each complete classification separately. It requires Python 3 and Poppler, not network access or model inference. It rejects absent or ambiguous table matches. JavaScript tests load actual repository data, not just synthetic fixtures, and also check the browser-facing data through the production validator.

## Evidence reviewed

All 38 rows were checked against freshly extracted original PDF text:

| Official source | PDF page (one-based) | Printed page | Content | Extracted rows |
|---|---:|---:|---|---:|
| Statewide FY2020-21 | 62 | 52 | Table 15, 19 complete three-year conviction cohorts | 19 |
| Statewide FY2020-21 | 38 | 28 | Table 9, enhanced credits | 2 |
| Statewide FY2020-21 | 15 | 5 | Table 2, supervision | 3 |
| Statewide FY2020-21 | 42 | 32 | Table 11, gender and age | 12 |
| EACP FY2020-21 | 3 | 3 | Table 1, MCRP and FCRP conviction | 2 |

Additional definition/context pages reviewed: statewide PDF 13 (printed 3, denominator footnote and Table 1), 9 (printed viii, pandemic effects), 69–70 (printed 59–60, evaluation design and limitations); EACP PDF 1–2 and 7 (program composition and denominator footnotes). Historical-context text checked for Realignment and Proposition 47. No discrepancy was found in the 38 selected raw records.

## Reference checks

- Latest complete statewide cohort: 11,886 / 30,116 = 39.4673927480%, published 39.5%.
- Earned enhanced credits: 5,011 / 15,029; no enhanced credits: 6,875 / 15,087. Counts sum to 11,886 / 30,116.
- Exact-count earners-minus-non-earners difference: −12.2268278721 percentage points. Published one-decimal rates yield −12.3 points; these are different rounding conventions, not a discrepancy.
- MCRP: 247 / 804, published 30.7%; FCRP: 50 / 307, published 16.3%.
- Published rate tolerance: 0.050000001 percentage points, reflecting one-decimal rounding plus floating-point tolerance.
- Every age, gender, supervision and credit partition separately reconciles to the statewide counts. These dimensions must NEVER be summed together.

## Independent Wilson reference

The TypeScript Wilson score implementation was checked against an independent Python standard-library calculation using `statistics.NormalDist().inv_cdf(.975)`, not its own exported code. For count k, denominator n, p=k/n and z=Φ⁻¹(.975): center=(p+z²/(2n))/(1+z²/n), half-width=z·sqrt(p(1−p)/n+z²/(4n²))/(1+z²/n). Bounds are center ± half-width, bounded to [0,1].

| Actual cohort | Independent 95% lower | Independent 95% upper |
|---|---:|---:|
| Statewide | 0.38916738778429566 | 0.4002073335709477 |
| Enhanced credits earned | 0.3259283361844302 | 0.34100089913574383 |
| No enhanced credits | 0.4477555872771858 | 0.4636476301213698 |
| MCRP | 0.27630443254609216 | 0.33995690609262386 |
| FCRP | 0.12577394806492115 | 0.20829171748258885 |

All five actual-data interval comparisons pass at absolute tolerance 1e-12 on the proportion scale. Intervals are analytical overlays under a binomial model, not published CDCR estimates or sampling uncertainty about a fully observed administrative cohort. They do not address confounding, selection or outcome ascertainment.

## Interpretation and denominator restrictions

Conviction means subsequent felony or misdemeanor conviction within three years under the report's operational definition. It is not interchangeable with arrest or return to prison, or with the statutory definition based on offenses committed within three years. The statewide conviction population excludes 539 of 30,655 releases without automated DOJ RAP sheets; its denominator is 30,116. MCRP conviction uses 804, not its 808 total releases. FCRP uses 307. Program counts represent releases from those facilities, not everyone who ever participated.

2021-22 and 2022-23 lack complete three-year outcomes in Table 15 and are excluded, not assigned zero. The historical series is not a stable-policy experiment: Realignment, Proposition 47, changes in cohort composition, and COVID-era changes to policing, courts, programs and transfers affect interpretation. The report identifies the pandemic during both FY2020-21 release and follow-up windows. A falling historical line is not evidence of program impact.

Credits were not randomized. The observed difference is descriptive and unadjusted. MCRP versus FCRP is not treatment versus control; statewide gender groups include these program participants. CDCR warns against direct supervision-group comparisons because of demographic and other differences. Matching a year or label does not establish mutually exclusive or exchangeable cohorts. No individual risk or eligibility decisions are supported.

## Limits and execution notes

This verification independently checks extraction against the archived official PDFs, not every conclusion in those reports or whether newer publications exist. It does not certify deployment, network security, privacy of arbitrary free-text uploads, or browser accessibility. PDF text was read directly; this review does not claim visual rendering QA of every PDF page. Raw PDFs, SHA-256 hashes, exact table lines and deterministic checks make the extraction audit reproducible.

The public projection was independently checked against all 38 raw rows and successfully parsed through the production JSON validator and CSV parser. The added 539 unavailable RAP-sheet outcomes is correct only for the latest overall cohort (30,655 minus 30,116); tests require it to remain absent from other records. This count describes record availability, not proof of complete ascertainment of every conviction during follow-up. Printed/PDF/table locators are preserved exactly in the public text field.

Results: `python3 scripts/validate_data.py` passed; six actual-data integration tests passed. `node --import tsx --test tests/*.test.ts` passed all 20 tests at final review. To regenerate source products, use `python3 research/extract_cdcr.py` then `python3 scripts/prepare_public_data.py`; the independent validator intentionally does not mutate or invoke these producer scripts.

The sandbox blocked the `tsx --test` CLI's Unix-domain IPC socket (`EPERM`). `node --import tsx --test` runs the same test files without that CLI server and passed; this is an execution-path difference, not a test exemption.
