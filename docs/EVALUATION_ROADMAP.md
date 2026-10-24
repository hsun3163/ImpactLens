# Evaluation roadmap

## Current evidence, current limits

The working prototype explores published aggregate counts. It can reproduce source-derived rates, expose denominator and follow-up choices, and flag incompatible comparisons. It cannot estimate a program's causal effect, establish individual outcomes, or connect nonprofit participation records to official justice outcomes. Its independent validator checks data fidelity, not program effectiveness. The v2 backend adds owner-scoped storage and deterministic report generation; it does not expand the permitted data to identifiable records or add causal identification.

The following stages are proposed work. None implies that consent, legal authority, data agreements, linkage access, a credible comparison group, or causal identification already exists.

## 1. Define a useful evaluation question

With program staff, affected community members, and an independent evaluator, specify the decision to support, target population, intervention, comparison, eligibility dates, time zero, outcome definition, and follow-up horizon. Separate implementation questions (reach, retention, service delivery) from outcome questions and causal-effect questions. Pre-specify the estimand and analysis plan before looking for a favorable result.

Deliverable: a protocol that distinguishes conviction, arrest, reincarceration, employment, housing, and participant-defined outcomes rather than reducing success to a single recidivism number.

## 2. Establish governance before individual linkage

Obtain an appropriate legal basis, consent where required and meaningful, data-use agreements, ethics/IRB review where applicable, and review by the organizations and communities affected. Define permitted uses, access roles, retention/deletion, auditing, incident response, disclosure review, and withdrawal limitations. Prohibit individual punitive or eligibility decisions based on this dashboard.

Only then consider a separately secured environment for minimum-necessary, pseudonymized participant-level data. Keep linkage identifiers separated from analysis records. Do not treat the new authenticated aggregate-project backend as a repository for personal justice records. Consent alone does not remove legal, security, or fairness obligations.

Deliverable: a reviewed governance and security plan, not an uploaded spreadsheet of identifiers.

## 3. Determine whether credible measurement and linkage are possible

Assess eligibility coverage, participation dates/intensity, baseline covariates measured before treatment, outcome capture, geography, repeat releases, duplicates, and calendar alignment. Validate linkage precision/recall against an authorized reference where feasible; examine differential linkage failure across groups. Document changes in court/reporting systems and the difference between absence of a recorded event and a known non-event.

Specify the denominator at each stage: eligible, enrolled, linked, observed, and analyzed. Account for death, migration, incarceration exposure, and other relevant loss to follow-up. Missingness must not become a success outcome by default.

Deliverable: a data-quality and linkage report with exclusions, uncertainty, and a decision on whether the data can answer the question at all.

## 4. Choose a comparison design that the evidence supports

A randomized design may be appropriate only when ethical and operationally feasible. Otherwise consider a carefully justified quasi-experimental design, such as a defensible eligibility cutoff or credible policy rollout. Matching or weighting alone cannot remove unmeasured confounding. A simple before/after trend, comparison with statewide averages, or contrast between different programs is not sufficient.

Review baseline risk, eligibility, motivation, referral pathways, service availability, time served, geography, age, prior history, calendar period, and other substantively justified pre-treatment confounders. Avoid conditioning on consequences of treatment. Address immortal-time bias and inconsistent time zero. Evaluate overlap and balance; abandon effect estimation when assumptions fail.

Deliverable: a documented design and explicit identifying assumptions, with an honest descriptive-only fallback.

## 5. Analyze uncertainty and robustness

Use models suited to the estimand and observation process. Where appropriate, account for clustering, repeated releases, competing events, varying observation time, and censoring. Pre-specify missing-data methods and sensitivity analyses for non-random missingness, linkage error, unmeasured confounding, alternative definitions, and calendar effects. Separate exploratory subgroup analysis from pre-specified tests and consider multiplicity.

Do not treat the prototype's Wilson intervals as sufficient for this work. Aggregate administrative counts and causal estimates have different uncertainty requirements.

Deliverable: independently reviewed results, reproducible analysis code, diagnostics, and sensitivity findings, including null or inconclusive results.

## 6. Publish responsibly and evaluate usefulness

Apply agreed small-cell suppression, complementary suppression, aggregation, and disclosure review before releasing outputs. Report denominators, follow-up completeness, exclusions, effect scale, uncertainty, limitations, and adverse or unintended outcomes. Ensure accessible explanations and involve stakeholders in interpretation. Audit whether dashboard use improves decisions without stigmatizing groups or encouraging individual risk judgments.

Success gates for a later pilot include source fidelity, clear interpretation in user testing, acceptable accessibility, verified privacy controls, adequate outcome coverage, a defensible design, and independent review. Numerical thresholds should be chosen in the protocol with stakeholders, not invented after results are known.

## Near-term engineering work

Before treating the v2 backend as deployment-verified: verify the Sites authentication gateway, real D1/R2 bindings and migrations, save/reload/report behavior, cross-user isolation, and invalid/cross-origin request rejection. Evaluate retention/deletion, operational recovery, rate limiting, and abuse controls before broader use.

Before a broader deployment: complete browser-level regression and accessibility testing, verify deployment access controls, review dependency/security updates, test upload/export behavior across browsers, and confirm that warning language is understood. Further datasets need their own provenance review, outcome/denominator mapping, independent extraction checks, and explicit separation from the current official baseline.
