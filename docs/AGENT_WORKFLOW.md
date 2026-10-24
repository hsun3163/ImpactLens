# Development roles and application workflow

## Two different meanings of “agent”

Native AI roles assisted development of this prototype. The shipped application does **not** invoke those roles, call a model API, or autonomously research new evidence. Its five-stage workflow and server-generated reports are deterministic software. Calling these runtime stages live AI agents would be inaccurate.

## Development collaboration actually used

Work was divided into native, separately scoped roles:

- **Evidence research:** locate official CDCR reports, archive source PDFs, extract reviewed aggregate tables, and document provenance and interpretation limits.
- **Statistical implementation:** define aggregate contracts, implement deterministic calculations and CSV safeguards, and create numerical/parser tests.
- **Frontend implementation:** build the dashboard, filtering, uploads, source register, visualizations, and inspectable workflow outputs.
- **Independent validation:** re-read source evidence with a separate validator and test counts, locators, hashes, rounding, and data consistency without trusting the producer alone.
- **Integration/data engineering and delivery:** reconcile source-rich records with the strict browser schema, integrate components, review results, and prepare build/delivery evidence.
- **Documentation:** explain reproducibility, privacy boundaries, architecture, and the distinction between current features and future evaluation work.

For the v2 upgrade, separately scoped native roles cover the authenticated Worker API and D1/R2 persistence, frontend save/reopen/report interactions, backend security testing, and documentation/CI updates. Hosted deployment verification remains a separate delivery step.

Separate roles improve review coverage but do not make a result infallible. The archived evidence, executable checks, and recorded outputs matter more than an AI reviewer's assertion.

## Tool and quota scope

Development used native assistant collaboration and the available execution tools. No Codex CLI task, Codex cloud task, Claude Code session, or external coding-agent service was invoked for this project. The application has no model credentials or paid model/API dependency. Package installation, local execution, native assistant work, and hosting/storage are distinct from external coding-agent quota use.

This is a statement about actions performed, not an independent audit of provider billing, platform accounting, or future hosting charges. Do not promise zero cost across services merely because the runtime requires no paid API.

## Deterministic in-app stages

1. **Ingest:** capture the active dataset and its provenance category. Official, synthetic, and uploaded records remain distinct.
2. **Validate:** run schema/count checks and report errors or warnings. A valid schema does not authenticate uploaded claims or prove anonymization.
3. **Analyze:** compute observed rates and per-row model intervals from counts; retain source IDs and follow-up definitions.
4. **Review:** expose rule-based interpretation cautions, compatibility/missingness issues, and limits. This is not an expert review or causal assessment.
5. **Report:** assemble inspectable, downloadable structured outputs for the selected run.

Artifacts describe the active data and calculations; they are not model reasoning traces, independent research reports, or signed attestations. Regenerate them after changing the dataset or filters rather than treating stale output as current evidence. Downloaded files can be shared or retained outside the app, so users remain responsible for their contents.

## Persistent reports are not runtime agents

The v2 backend validates saved CSVs and computes reports from saved aggregate rows using shared deterministic functions. The server does not ask an LLM to choose a method, calculate a result, judge the user, fetch new evidence, or write an ungrounded narrative. Stored JSON, CSV, and Markdown outputs can be reopened after a reload because they are persisted in D1/R2, not because an autonomous process continues after the user leaves.

Choosing a CSV and running the browser workflow do not implicitly save it. Saving a project and generating a stored report are explicit actions. The browser's selected-row export and a report over saved project data are separate outputs; inspect each artifact's scope and provenance rather than assuming they are interchangeable.

## Verification and honest delivery

The local checks are TypeScript typechecking, Node unit tests, independent Python data validation, canonical-data regeneration, backend authorization/storage tests, and a production Worker build. GitHub Actions is configured to restore source PDFs with checksum verification and repeat these checks on a clean Node 24 runner using the portable build path. Browser QA and hosted access checks provide separate evidence; a successful unit test is not proof that every control works in a deployed browser.

Verified delivery and remaining scope are recorded in DELIVERY.md; source and browser verification are recorded separately. Historical v1 evidence does not verify the v2 auth gateway, D1/R2 provisioning, cross-user isolation, or persistence after reload.
