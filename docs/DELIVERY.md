# ImpactLens release and verification

## Current application

- [Live application](https://impactlens.inacra.chatgpt.site)
- [Source repository](https://github.com/hsun3163/ImpactLens)
- Deployed Sites revision: **v24**, source `e1d9c5147b010b22d996c206e8acde7b6f742749`.
- Features: reusable course maintenance; signed SMS intake, repeat and reversal; course/organization/TPW activity dashboards; multicenter views; labeled estimates; scoped business MCP tools; aggregate projects and reports; public CDCR evidence exploration.

## Release checks — October 25, 2026

The isolated public-source artifact passed:

- TypeScript checking.
- **325/325 automated tests**, including transactional attendance, duplicate delivery, reversal, authorization and MCP behavior.
- Independent validation of **38 official rows** against five PDF table pages, including two SHA-256 checks, source associations, counts, rounding, totals and CSV parity.
- Canonical data regeneration with no changes.
- Production Worker/client build, hosting manifest and ten packaged SQL migrations.

Live numeric SMS receipt and dashboard processing were exercised. A real negative SMS reversal was verified on October 25 at **18:45:14 UTC**. SMS timing is reported as functional behavior rather than a measured end-to-end latency benchmark.

[Actions runs](https://github.com/hsun3163/ImpactLens/actions) identify CI results by exact repository commit. Sites and GitHub have separate commit histories; the source hash above identifies the deployed artifact.

## Reproducible public data

The evidence explorer includes 38 published CDCR aggregate rows from two checksum-verified reports. The latest three-year conviction outcome is 11,886 / 30,116, approximately 39.5%. Enhanced-credit groups retain the original counts, 5,011/15,029 and 6,875/15,087; their difference is descriptive and unadjusted.

Official aggregates, user imports and fictional fixtures have separate provenance. Public release files include schema, migrations and fictional activity generators. Live phone bindings, raw SMS, grants and credentials remain in private runtime storage.

## Historical verification references

These references preserve the earlier implementation audit trail:

| Release | Evidence |
| --- | --- |
| v1 static baseline, October 24 | [CI run 40079891433](https://github.com/hsun3163/ImpactLens/actions/runs/40079891433), source `c86a96ef52cad7a629b18eea45c7e0e8e90636e7`; 21 tests and reviewed public-data/browser flows |
| Backend publication 3, October 24 14:27:39 UTC | Sites source `a3bebddec24e503601e2502ed1f7464731fc6d61`; 37 tests, 13 built-Worker checks, D1/R2 persistence across restart and authenticated report downloads |
| Backend publication 4, October 24 14:53:48 UTC | Sites source `156269a539eeb778b45aa7e96bae47ec70fdc992`; synthetic-label preservation, 38 tests and 11 live anonymous/security checks |
| Backend CI | [Run 40104610755](https://github.com/hsun3163/ImpactLens/actions/runs/40104610755), GitHub source `500da191720ac0224f504d6d894856e385f741e2`; every job and step passed |
| SMS publication 6, October 24 20:13 UTC | Sites source `0be5d80e82c5daff50a31d0ac8bfdd92a537d457`; 52 tests, 23 independent local-D1 checks and 12 built-Worker checks |

Detailed source calculations remain in [VALIDATION.md](VALIDATION.md), browser observations in [UI_VALIDATION.md](UI_VALIDATION.md), and current SMS reproduction steps in [SMS_VALIDATION.md](SMS_VALIDATION.md).
