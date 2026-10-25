# Organization-leader SMS push events

This is an optional official MCP Events connection on the existing authenticated `/mcp` endpoint. It keeps deterministic teacher attendance and outside operations separate. No credentials, callback URL, subscription, event history or organization-specific seed is shipped in source.

## Configuration and activation

The server advertises `events` alongside `tools` in protocol `2026-07-28`. Authorized business accounts can discover `business.request.created` through `events/list`, filtered by exact `organizationId` from their existing active grants. The payload contains only `requestId` and `organizationId`; the assistant retrieves the request using existing bounded tools.

Subscription and delivery fail closed until the server-only runtime value `MCP_EVENTS_CALLBACK_ORIGIN` is configured. Do not guess this value. A native `events/subscribe` attempt from the installed official plugin can return `CallbackEndpointError` with `callback_origin_not_configured` and an origin-only `candidateOrigin`. No callback is contacted and no secret is saved in that state. Verify that origin came from the platform, then configure exactly that HTTPS origin, without path, query or trailing slash, through authorized Sites runtime configuration. No new public endpoint or custom token is needed.

This transport is for the Sites Cloudflare runtime without a privileged private origin. Do not reuse it in Node or a private-network host without an independently SSRF-safe fetch adapter. This is deliberately not an arbitrary webhook transport: callbacks must use that one independently approved origin within the OpenAI-controlled `chatgpt.com` or `openai.com` domains. IP literals, credentials, non-443 ports, fragments, ambiguous/encoded controls and lookalike domains are rejected. Delivery uses Cloudflare's public HTTP transport, `redirect: manual`, and rejects redirect responses. The implementation does not pretend to supply generic DNS pinning for arbitrary destinations. If the native platform supplies a different origin family, stop and verify its official transport rather than broadening the allowlist blindly.

After publication/rescan, discover the actual connected event source and its returned native trigger schema. Create one event-driven task, with no independent schedule, for the approved organization. The subscription callback URL and `whsec_` signing secret are supplied by ChatGPT, not entered into a user form or copied into chat. A new matching SMS must actually wake the subscribed conversation before calling the integration verified.

## Subscription lifecycle

`events/subscribe` validates the event, organization grant, callback and 24–64-byte canonical base64 secret. It sends a fresh signed verification challenge and requires a successful matching response before activation. Response bodies are bounded; verification and delivery timeouts are five seconds. Verification cache lasts five minutes from actual verification, not the last refresh.

Subscriptions are keyed deterministically by authenticated subject, callback URL, event and canonical organization filter. Repeated/concurrent requests reuse that identity. State, ownership, filters, private signing keys and expiry are stored in D1 across restarts. Default and maximum lifetime are 24 hours; a shorter requested `ttlMs` is honored with a one-minute minimum. Indefinite requests receive a finite expiry. Refresh can replace the key; old/new signatures overlap for at most five minutes. Keys and full callback URLs never appear in tools, browser DTOs, audit details or application logs.

`events/unsubscribe` is scoped and idempotent, disables the subscription, clears signing keys and stops pending deliveries. Agent-grant revocation or organization deactivation does the same. Leader-grant changes stop that leader's old request deliveries. Re-enabling or renewing after expiry does not resurrect earlier pending events. At most ten unexpired subscriptions are active per organization. Current grants and expiry are rechecked before each delivery attempt; already accepted network deliveries cannot be recalled, and all business read/write tools independently recheck permission.

## Atomic event boundary and delivery limits

Migration 0007 creates server-only subscription/outbox tables. An INSERT trigger enqueues a delivery only when a new canonical signed leader SMS request commits and a matching active subscription already exists. This shares the existing receipt/request transaction. Numeric attendance, exact `1`, malformed numeric-only reports, invalid/ungranted teacher messages, course writes and explicit historical imports create no events. Provider retries never create another event or reinterpret history.

After commit, the inbound route schedules delivery with `cloudflare:workers` `waitUntil`. Each callback uses Standard Webhooks HMAC-SHA256 over the exact serialized body, event ID and signing timestamp. Event ID/body remain stable across retries; signing timestamps are renewed. An atomic lease prevents concurrent workers sending the same pending delivery. An interrupted lease can be recovered by a later provider redelivery of the same SID without creating an event or resetting its attempt budget.

There are at most three immediate attempts, five seconds per HTTP request, with one- and two-second retry delays, bounded within the worker's 30-second background window. Only transient network failures, 429 and 5xx retry. Redirects and other 4xx, including 410/413, stop. Terminal delivery outcomes are audited without secrets. A 2xx means accepted by ChatGPT, not that the assistant has already executed a course change.

The D1 outbox is durable storage, **not a scheduler**. No Queue, cron, alarm or indefinite retry service is provisioned. If the worker is interrupted and no provider retry arrives, or all attempts fail, pending/failed state remains saved; there is no guaranteed autonomous later retry. No polling fallback is installed. The original business request remains available for authorized manual MCP pickup. Numeric/`1` never schedule this delivery work and do not depend on callback availability.

## Verification

Run `npm run check`. Tests use synthetic OpenAI-subdomain callbacks with injected transports; they make no callback network calls. They cover protocol discovery, fail-closed configuration, signatures/challenges, sanitized errors, refresh/rotation/expiry/unsubscribe, scope and revocation, concurrent subscription/delivery, atomic rollback, canonical event dedupe, historical silence, finite retries and unchanged attendance.

Live acceptance is separate: discover the event, verify/store the native subscription, send a fresh authorized leader SMS, observe signed delivery acceptance, then confirm the subscribed chat wakes and executes only through existing scoped idempotent course tools.

Sources: [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events), [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), [Cloudflare waitUntil limits](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil), [Cloudflare redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/).
