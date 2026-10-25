# External assistant: separate business and operations entrances

## Implemented business connection

ImpactLens exposes a small vendor-neutral business service through the official Sites MCP entrance, not an embedded general-purpose agent or an operations platform. The external assistant may separately have repository/test/deploy capabilities, but no business request can access or forward to them.

- `src/lib/business-agent-contract.ts`: bounded request/context/course commands.
- `src/server/business-agent-service.ts`: scope, capabilities, validation and idempotency rules.
- `src/server/business-agent-d1.ts` and migrations `0006_business_roles_mcp.sql` and `0007_business_events.sql`: durable grants, canonical-receipt requests, proposals, execution results and append-only audit.
- `src/server/business-agent-mcp.ts`, `src/app/mcp/route.ts`: official authenticated Sites MCP adapter.
- `src/server/business-admin-api.ts`: separate TPW administrator permission management and explicit single-receipt import.

The generic `POST /api/business-agent/v1` remains disconnected and returns HTTP 503 `BUSINESS_AGENT_NOT_CONFIGURED`. It does not trust Sites identity headers or reuse an administrator session as external HTTP credentials. Only the official Sites-authenticated `/mcp` adapter resolves the forwarded Sites caller identity, and even that caller needs a separate active organization-scoped business grant. Public Site visibility, ChatGPT sign-in and TPW administrator status alone grant no business tools.

Migrations create the schema. Configure organization grants and the assistant connection separately using the steps below.

## Separate roles

1. **Teacher:** adding a phone always creates an attendance-only teacher binding. Numeric attendance and exact `1` remain deterministic code. Names, course bindings and free-text claims never infer leadership.
2. **Organization leader:** a TPW administrator separately grants one exact E.164 phone leadership for one organization. New verified free-text receipts from that sender can queue course-maintenance requests in that fixed organization.
3. **Business assistant:** a TPW administrator separately grants the verified current Sites account access to one organization. The current UI cannot grant an arbitrary account ID. This scope supports request/context reads, proposals and execution under the leader's standing delegation, not role management or operational access.

The existing `TPW_ADMIN_USER_IDS` allowlist remains the permission-management boundary; it is not a new owner-identity model and is not expanded by this feature. The two scoped grants are separate, audited actions. Revoke either to stop dependent execution. Re-enabling creates a new grant revision and does not revive an old proposal's authority.

## MCP contract

The hosting manifest declares `mcp`. Stateless JSON-RPC `POST /mcp` supports `server/discover` (protocol `2026-07-28`), `tools/list`, and `tools/call`. Discovery schemas contain no private data. Every tool call resolves the current business grant. UTF-8 JSON bodies are capped at 24 KiB.

- `business_list_requests`: at most 20 currently authorized pending requests.
- `business_get_context(requestId)`: original organization scope, explicitly untrusted request text, at most 20 courses and active programs; truncation is explicit. Excludes teacher contacts, raw provider identifiers, secrets and private course notes.
- `business_propose_course(requestId, idempotencyKey, command)`: only `course.create` or `course.update` using validated course fields and existing program IDs. The organization is fixed by the original request, not by SMS instructions. Updates require the current revision, cannot change the program parent, and preserve existing private notes. Unknown counts/hours remain null; metadata is not attendance.
- `business_get_proposal(proposalId)`: the current account's scoped proposal and status.
- `business_execute_proposal(proposalId)`: apply that exact proposal once under the original leader's explicit standing delegation and the assistant's scoped grant.

Proposing alone does not mutate courses. Production proposals snapshot the two current grant IDs/revisions and exact command digest as standing authority; routine authorized leader requests do not need an additional owner-review page. There is no self-approval or permission-grant tool. Stable proposal keys are unique per actor/organization; altered commands or requests under the same key conflict. Duplicate execution returns the original result.

No tool accepts SQL, shell commands, arbitrary URLs, credentials, deployments, operations logs, generic tool invocation, permission changes or outbound SMS.

## Durable intake and execution

Signed SMS keeps its existing signature, account, destination and envelope checks. Each newly inserted provider MessageSid creates one immutable canonical receipt. A qualifying free-text receipt and its optional leader request are inserted in one D1 batch. Provider redelivery never imports an older receipt after a role change. The receipt keeps its original quarantine classification; a linked business request is a distinct auditable interpretation and never increments attendance totals.

Old quarantines remain untouched. A TPW administrator may explicitly import one eligible free-text receipt by exact record ID, matching active leader organization and required reason. Import preserves original text, provider ID, timestamp and classification, is idempotent, and cannot convert numeric or repeat attendance into business commands. No bulk or automatic historical import exists.

SQLite triggers make proposal execution, course mutation, request completion and audit one atomic transaction. They recheck both grant revisions, original sender/organization, active program parent and expected course revision at commit. A concurrent revocation or stale course prevents the write; audit failure rolls everything back. Receipt, request, proposal and audit history cannot be rewritten. One request can complete through only one proposal.

## Authorized deployment and verification

After publishing, separately apply only the approved leader phone/organization and signed-in account/organization grants in the collapsed Organization permissions section. Connect the owner-private plugin created by Sites through its official connection flow. Saving permission does not itself establish a plugin connection.

First verify authenticated `business_list_requests`; then use a newly sent leader SMS, inspect its context, propose the exact requested course change and execute it. Verify the returned resource/revision in the course list and request status. Importing an older receipt is optional and requires its own explicit selection.

Manual MCP pickup remains available. The optional [MCP Events connection](MCP_EVENTS.md) adds a signed push wake-up only after an approved callback origin and a native subscription are configured and verified. An external scheduled task can also poll the MCP request tools. Configure that schedule in the assistant environment. Numeric/repeat/reversal processing and dashboard queries run independently of the assistant connection.

Run `npm run check`. `tests/business-agent.test.ts` retains fake-adapter contract tests; `tests/business-mcp.test.ts` applies the real migrations to SQLite and exercises the production D1/MCP handlers, atomic rollback, concurrent dedupe, revocation, scope and old-receipt safety. Local tests do not substitute for the separately verified live Sites connection.
