# ImpactLens official CDCR aggregate data

38 observed rows, extracted from two archived CDCR PDFs on 2026-10-24. No personal identifiers, simulated observations, inferred event counts, or individual-level records. Every row has a published integer numerator and denominator. This is a selected extract, not the full CDCR dataset.

## Files and reproduction

- official_cdcr.json and official_cdcr.csv contain identical records.
- sources.json records original URLs, access date, exact raw PDF path, byte count and SHA-256.
- extraction_evidence.json preserves the actual PDF text line supporting every row.
- Run `python research/extract_cdcr.py` from any directory with Python 3 and Poppler pdftotext available. This re-extracts the archived PDFs, validates rows, and rewrites the normalized files. No model or network call occurs in extraction.

## Fields

- id: stable composite slug, unique within this extract.
- releaseYear: California fiscal-year string; e.g. 2020-21 means July 1, 2020 through June 30, 2021, not the publication year.
- groupType: overall, enhanced_credit, supervision, gender, age, or program. These are separate classification dimensions, NOT disjoint groups that may be summed together.
- group: source-derived cohort label. All releases refers only to eligible releases with available automated California DOJ RAP sheets for conviction outcomes.
- denominator: published release-cohort count eligible for this outcome.
- events: published number of individuals convicted during the cumulative follow-up period, not number of offenses or convictions.
- ratePct: published percentage, rounded to one decimal. Compute precise rates for statistics from events / denominator; published differences can differ slightly from unrounded differences.
- outcome: conviction only in this curated extract. Never substitute arrest or return-to-prison.
- followupMonths: 36 for every current row. No incomplete 2021-22 or 2022-23 three-year observations are included.
- sourceId: foreign key to sources.json id.
- sourcePage: printed page number.
- sourcePdfPage: one-based PDF page number, suitable for #page= links.
- sourceTable: official table number stored as string.
- dataKind: official means counts directly extracted from official published aggregates, not synthetic or individual data.

## Outcome and population definition

CDCR's operational three-year conviction outcome is subsequent felony or misdemeanor conviction within three years of release for a person previously incarcerated for a felony. The state statutory definition refers to a new felony or misdemeanor committed within three years; the report's operational definition refers to subsequent conviction. Preserve that distinction when describing the source. Cohorts include adult-institution releases to parole, Post-Release Community Supervision (PRCS), and direct discharge, including qualifying re-releases during the fiscal year. The statewide report Appendix F (printed pp59-60, PDF pp69-70) supplies definitions, methods, and limitations.

FY2020-21 arrest/conviction denominator is 30,116 people with automated DOJ RAP sheets, while all releases and return-to-prison denominator are 30,655. Return-to-prison counts only CDCR custody, not county jail. These are NOT interchangeable denominators or outcomes. This extract intentionally contains conviction only.

EACP counts include people released from MCRP/FCRP facilities, not everyone ever participating in these programs. MCRP has 804 people with RAP sheets versus 808 total releases. FCRP has 307 in both populations. See EACP report notes, p7.

## Comparisons and safeguards

- Preferred demo comparison: enhanced_credit, FY2020-21, conviction, 36 months. Credit earners and non-earners are disjoint and exhaustive for this cohort; counts sum to statewide total. The groups were not randomized. Eligibility, baseline composition, time served, selection, and program availability may explain differences. An association is not program impact or causation.
- MCRP and FCRP are different-gender programs, not treatment versus control. Do not compare them as evidence of program effectiveness. Statewide gender groups include their program participants and are overlapping, not independent controls.
- CDCR explicitly advises against direct causal comparisons of PRCS, parole and direct discharge owing to composition differences (statewide report printed p5). Same-group prior-year comparisons are preferred, though this extract has only latest-year supervision rows.
- Age and gender data support descriptive exploration only. Do not make individual risk decisions or eligibility decisions from these aggregates.
- Do not sum rows across dimensions, years, or overlapping groups. Do not join nonprofit data merely by a similar program name; require compatible cohort, outcome, window, geography, and denominator definition, then keep provenance separate.
- Earlier cohorts were affected by legislation (including Realignment and Proposition 47); later follow-up overlapped COVID-19, disruption of programs, courts, and crime patterns. A time trend is not an intervention effect.
- Source suppresses rates for denominators below 30; no such rows are in this curated extract. Consider stronger privacy/small-cell policy for uploaded nonprofit data.
- Any confidence interval or two-proportion comparison is an analytic overlay, not a CDCR-published estimate. These are administrative cohort counts, not a random sample; a binomial model does not remedy confounding, selection, measurement error, or generalizability.
