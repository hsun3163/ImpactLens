import type { BusinessPrincipal } from '../lib/business-agent-contract';
import { CallbackValidationError, validateCallbackUrl, parseEventSecret, signEventBody, constantTimeEqual } from '../lib/business-event-security';
import { businessId } from './business-agent-d1';

export const BUSINESS_REQUEST_EVENT = 'business.request.created';
const DAY = 24 * 60 * 60 * 1000;
const VERIFY_CACHE = 5 * 60 * 1000;
const ROTATION_WINDOW = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
type Row = Record<string, unknown>;
export type BusinessEventsRuntime = { DB?: D1Database; MCP_EVENTS_CALLBACK_ORIGIN?: string };
export type EventDependencies = { fetcher?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> };
export class EventProtocolError extends Error {
  constructor(public code: number, message: string, public data?: Record<string, unknown>) { super(message); }
}
const invalid = () => new EventProtocolError(-32602, 'Invalid event subscription parameters.');
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function only(value: Record<string, unknown>, fields: string[]) { if (Object.keys(value).some(key => !fields.includes(key))) throw invalid(); }
const iso = (now: number) => new Date(now).toISOString();
function callback(value: unknown, origin?: string) {
  try { return validateCallbackUrl(value, origin); }
  catch (error) {
    if (error instanceof CallbackValidationError) throw new EventProtocolError(-32015, 'The official callback origin must be approved before delivery.', { reason: error.reason, ...(error.candidateOrigin ? { candidateOrigin: error.candidateOrigin } : {}) });
    throw invalid();
  }
}
async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join(''); }
async function subscriptionId(subjectId: string, url: string, organizationId: string) {
  return 'sub_' + await digest(JSON.stringify([subjectId, url, BUSINESS_REQUEST_EVENT, { organizationId }]));
}
export function eventCatalog(principal: BusinessPrincipal) {
  return { events: [{ name: BUSINESS_REQUEST_EVENT,
    description: 'A new authorized organization-leader SMS course request was saved. Includes only request and organization IDs. Read its context with the bounded business tools; attendance numbers and exact 1 never emit this event. Delivery requires an approved official callback origin.',
    delivery: ['webhook'], inputSchema: { type: 'object', additionalProperties: false, required: ['organizationId'], properties: { organizationId: { type: 'string', format: 'uuid', enum: [...principal.organizationIds] } } },
    payloadSchema: { type: 'object', additionalProperties: false, required: ['requestId', 'organizationId'], properties: { requestId: { type: 'string', format: 'uuid' }, organizationId: { type: 'string', format: 'uuid' } } },
  }] };
}
async function signedPost(url: URL, secret: string, previousSecret: string | null, id: string, subscription: string, body: string, now: number, fetcher: typeof fetch) {
  const timestamp = Math.floor(now / 1000);
  const signature = await signEventBody(secret, id, timestamp, body);
  const previous = previousSecret ? ' ' + await signEventBody(previousSecret, id, timestamp, body) : '';
  // Cloudflare fetch supports manual, not redirect:error. Never follow a Location.
  return fetcher(url.href, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: {
    'Content-Type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(timestamp),
    'webhook-signature': signature + previous, 'X-MCP-Subscription-Id': subscription,
  }, body });
}
async function smallJson(response: Response) {
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 4096) { await reader.cancel(); throw new Error('large'); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export async function handleEventMethod(method: string, paramsValue: unknown, principal: BusinessPrincipal, env: BusinessEventsRuntime, deps: EventDependencies = {}) {
  const params = object(paramsValue ?? {}); const db = env.DB!; const clock = deps.now ?? Date.now; const fetcher = deps.fetcher ?? fetch;
  if (method === 'events/list') { only(params, ['cursor', '_meta']); if (params.cursor != null) throw invalid(); return eventCatalog(principal); }
  if (!['events/subscribe', 'events/unsubscribe'].includes(method)) throw new EventProtocolError(-32601, 'Method not found');
  only(params, method === 'events/subscribe' ? ['name', 'arguments', 'delivery', 'cursor', 'ttlMs', '_meta'] : ['name', 'arguments', 'delivery', '_meta']);
  if (params.name !== BUSINESS_REQUEST_EVENT || params.cursor != null) throw invalid();
  const args = object(params.arguments); only(args, ['organizationId']);
  let organizationId: string; try { organizationId = businessId(args.organizationId); } catch { throw invalid(); }
  if (!principal.organizationIds.includes(organizationId)) throw new EventProtocolError(-32001, 'Event scope is not authorized.');
  const delivery = object(params.delivery); only(delivery, method === 'events/subscribe' ? ['mode', 'url', 'secret'] : ['mode', 'url']);
  if (delivery.mode !== 'webhook') throw invalid();
  // Unsubscribe never sends traffic and must still work if the configured origin changed.
  let url: URL;
  if (method === 'events/unsubscribe') {
    try { url = new URL(String(delivery.url)); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw invalid(); } catch { throw invalid(); }
  } else url = callback(delivery.url, env.MCP_EVENTS_CALLBACK_ORIGIN);
  const id = await subscriptionId(principal.id, url.href, organizationId); const now = clock();
  if (method === 'events/unsubscribe') {
    await db.prepare(`UPDATE business_event_subscriptions SET active=0,secret=NULL,previous_secret=NULL,previous_secret_until=NULL,revision=revision+1,updated_at=? WHERE id=? AND subject_id=? AND active=1`).bind(iso(now), id, principal.id).run();
    return {};
  }
  try { parseEventSecret(delivery.secret); } catch { throw new EventProtocolError(-32602, 'A valid webhook signing secret is required.'); }
  const secret = delivery.secret as string;
  if (params.ttlMs !== undefined && params.ttlMs !== null && (typeof params.ttlMs !== 'number' || !Number.isSafeInteger(params.ttlMs) || params.ttlMs <= 0)) throw invalid();
  const lifetime = typeof params.ttlMs === 'number' ? Math.max(60000, Math.min(DAY, params.ttlMs)) : DAY;
  const previous = await db.prepare('SELECT * FROM business_event_subscriptions WHERE id=? AND subject_id=?').bind(id, principal.id).first<Row>();
  const cachedVerification = Boolean(previous?.active && previous.secret === secret && String(previous.expires_at) > iso(now) && Date.parse(String(previous.verified_at)) > now - VERIFY_CACHE);
  if (!cachedVerification) {
    const challenge = crypto.randomUUID(); const verificationId = 'verify_' + crypto.randomUUID();
    try {
      const response = await signedPost(url, secret, null, verificationId, id, JSON.stringify({ type: 'verification', challenge }), now, fetcher);
      if (!response.ok) { await response.body?.cancel(); throw new Error('status'); }
      const result = await smallJson(response);
      if (!result || typeof result.challenge !== 'string' || !constantTimeEqual(challenge, result.challenge)) throw new Error('challenge');
    } catch (error) {
      throw new EventProtocolError(-32015, 'The official callback could not be verified.', { reason: error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'challenge_failed' });
    }
  }
  const committedAt = clock(); const expiration = iso(committedAt + lifetime); let grantedExpiration = expiration;
  const oldKey = previous?.active && String(previous.expires_at)>iso(committedAt) && previous.secret !== secret ? String(previous.secret) : previous?.previous_secret && String(previous.previous_secret_until) > iso(committedAt) ? String(previous.previous_secret) : null;
  const oldUntil = oldKey ? previous?.secret !== secret ? iso(committedAt + ROTATION_WINDOW) : String(previous!.previous_secret_until) : null;
  // The INSERT/UPDATE guards recheck live authority after callback verification.
  try {
    const saved = await db.prepare(`INSERT INTO business_event_subscriptions
      (id,subject_id,organization_id,agent_grant_id,agent_grant_revision,event_name,callback_url,secret,previous_secret,previous_secret_until,active,revision,expires_at,verified_at,created_at,updated_at)
      SELECT ?,g.subject_id,g.organization_id,g.id,g.revision,?,?,?,?,?,1,1,?,?,?,? FROM business_agent_grants g JOIN sms_organizations o ON o.id=g.organization_id
      WHERE g.subject_id=? AND g.organization_id=? AND g.active=1 AND o.active=1
      ON CONFLICT(id) DO UPDATE SET agent_grant_id=excluded.agent_grant_id,agent_grant_revision=excluded.agent_grant_revision,
        secret=excluded.secret,previous_secret=excluded.previous_secret,previous_secret_until=excluded.previous_secret_until,active=1,
        revision=business_event_subscriptions.revision+1,expires_at=excluded.expires_at,verified_at=excluded.verified_at,updated_at=excluded.updated_at
      WHERE business_event_subscriptions.revision=? RETURNING id`)
      .bind(id, BUSINESS_REQUEST_EVENT, url.href, secret, oldKey, oldUntil, expiration, cachedVerification ? String(previous!.verified_at) : iso(committedAt), iso(committedAt), iso(committedAt), principal.id, organizationId, previous?.revision ?? 0).first<Row>();
    if (!saved) {
      const raced = await db.prepare(`SELECT s.expires_at FROM business_event_subscriptions s JOIN business_agent_grants g ON g.id=s.agent_grant_id JOIN sms_organizations o ON o.id=s.organization_id
        WHERE s.id=? AND s.subject_id=? AND s.active=1 AND s.secret=? AND s.expires_at>? AND g.active=1 AND g.revision=s.agent_grant_revision AND o.active=1`)
        .bind(id,principal.id,secret,iso(committedAt)).first<Row>();
      if(!raced)throw new Error('authority_or_revision');
      grantedExpiration=String(raced.expires_at);
    }
  } catch { throw new EventProtocolError(-32001, 'Subscription authority or revision changed. Retry the same subscription.'); }
  return { id, refreshBefore: grantedExpiration, cursor: null, truncated: false };
}

const DELIVERY_SELECT = `SELECT d.*,s.subject_id,s.organization_id,s.callback_url,s.secret,s.previous_secret,s.previous_secret_until,s.active subscription_active,s.expires_at,
  s.agent_grant_revision,g.active agent_active,g.revision current_agent_revision,o.active organization_active,
  r.received_at,r.status request_status,r.manager_grant_revision,m.active manager_active,m.revision current_manager_revision
  FROM business_event_outbox d JOIN business_event_subscriptions s ON s.id=d.subscription_id
  JOIN business_agent_grants g ON g.id=s.agent_grant_id JOIN sms_organizations o ON o.id=s.organization_id
  JOIN business_requests r ON r.id=d.request_id JOIN business_manager_grants m ON m.id=r.manager_grant_id`;
function authorizedDelivery(row: Row, now: number) {
  return Boolean(row.subscription_active && row.agent_active && row.organization_active && row.manager_active && row.secret
    && row.agent_grant_revision === row.current_agent_revision && row.manager_grant_revision === row.current_manager_revision
    && row.request_status === 'pending' && String(row.expires_at) > iso(now));
}
/** A bounded, immediate push after commit. Persisted outbox is not a scheduler. */
export async function deliverBusinessEvents(db: D1Database, env: BusinessEventsRuntime, receiptId: string, deps: EventDependencies = {}) {
  if (!env.MCP_EVENTS_CALLBACK_ORIGIN) return;
  const clock = deps.now ?? Date.now; const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))); const fetcher = deps.fetcher ?? fetch;
  const rows = await db.prepare(DELIVERY_SELECT + " WHERE r.receipt_id=? AND (d.status='pending' OR (d.status='delivering' AND d.lease_until<?)) ORDER BY d.id LIMIT 10").bind(receiptId,iso(clock())).all<Row>();
  await Promise.all(rows.results.map(async initial => {
    const lease = crypto.randomUUID(); const started = clock();
    const claimed = await db.prepare(`UPDATE business_event_outbox SET status='delivering',lease_token=?,lease_until=?,updated_at=? WHERE id=? AND (status='pending' OR (status='delivering' AND lease_until<?)) RETURNING id`).bind(lease, iso(started + 25000), iso(started), initial.id,iso(started)).first<Row>();
    if (!claimed) return;
    async function finish(status: 'delivered'|'failed'|'stopped', reason: string) {
      await db.prepare(`UPDATE business_event_outbox SET status=?,last_reason=?,updated_at=?,delivered_at=?,lease_token=NULL,lease_until=NULL WHERE id=? AND status='delivering' AND lease_token=?`)
        .bind(status, reason, iso(clock()), status === 'delivered' ? iso(clock()) : null, initial.id, lease).run();
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const row = await db.prepare(DELIVERY_SELECT + " WHERE d.id=? AND d.status='delivering' AND d.lease_token=?").bind(initial.id, lease).first<Row>();
      if (!row) return;
      if (!authorizedDelivery(row, clock())) { await finish('stopped', 'authority_inactive'); return; }
      let url: URL; try { url = validateCallbackUrl(row.callback_url, env.MCP_EVENTS_CALLBACK_ORIGIN); } catch { await finish('stopped', 'callback_not_allowed'); return; }
      const consumed = await db.prepare("UPDATE business_event_outbox SET attempts=attempts+1,updated_at=? WHERE id=? AND status='delivering' AND lease_token=? AND attempts<3 RETURNING attempts").bind(iso(clock()), initial.id, lease).first<Row>();
      if (!consumed) { await finish('failed','attempt_budget_exhausted'); return; }
      // Small, stable payload: no SMS body, phone, provider SID or instructions.
      const body = JSON.stringify({ eventId: row.event_id, name: BUSINESS_REQUEST_EVENT, timestamp: row.received_at,
        data: { requestId: row.request_id, organizationId: row.organization_id }, cursor: null });
      let reason = 'network_error'; let retry = true;
      try {
        const prior = row.previous_secret && String(row.previous_secret_until) > iso(clock()) ? String(row.previous_secret) : null;
        const response = await signedPost(url, String(row.secret), prior, String(row.event_id), String(row.subscription_id), body, clock(), fetcher);
        await response.body?.cancel();
        if (response.ok) { await finish('delivered', 'accepted'); return; }
        reason = `http_${response.status}`; retry = response.status === 429 || response.status >= 500;
      } catch (error) { reason = error instanceof Error && ['TimeoutError','AbortError'].includes(error.name) ? 'timeout' : 'network_error'; }
      if (!retry || attempt === MAX_ATTEMPTS - 1 || clock() - started > 19000) { await finish('failed', reason); return; }
      await sleep(1000 * 2 ** attempt);
    }
  }));
}

/** Redelivery may recover an expired delivery lease, never create a new event or
 * reinterpret an older SMS. The outbox already fixes the original request. */
export async function deliverBusinessEventsForSid(db: D1Database, env: BusinessEventsRuntime, messageSid: string, deps: EventDependencies = {}) {
  if (!env.MCP_EVENTS_CALLBACK_ORIGIN) return;
  const row = await db.prepare(`SELECT r.id FROM sms_records r JOIN business_requests q ON q.receipt_id=r.id JOIN business_event_outbox d ON d.request_id=q.id
    WHERE r.message_sid=? AND d.status IN ('pending','delivering') LIMIT 1`).bind(messageSid).first<Row>();
  if (row) await deliverBusinessEvents(db,env,String(row.id),deps);
}
