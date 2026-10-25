import { BUSINESS_AGENT_OPERATIONS, BUSINESS_AGENT_PROTOCOL, type BusinessAgentPort, type BusinessPrincipal } from '../lib/business-agent-contract';
import { BusinessAgentError } from './business-agent-service';

export const BUSINESS_AGENT_PATH = '/api/business-agent/v1';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
export type BusinessPrincipalResolver = (request: Request) => Promise<BusinessPrincipal | null>;
/** No default resolver, no browser-admin fallback, no credentials or outbound transport. */
export function createBusinessAgentHttp(adapter?: { service: BusinessAgentPort; resolvePrincipal: BusinessPrincipalResolver }) {
  return async (request: Request): Promise<Response> => {
    if (!adapter) return reply({ code: 'BUSINESS_AGENT_NOT_CONFIGURED', error: 'The external business interface is not connected.' }, 503);
    try {
      if (new URL(request.url).pathname !== BUSINESS_AGENT_PATH || new URL(request.url).search) throw new BusinessAgentError(404, 'NOT_FOUND', 'Business endpoint not found.');
      if (request.method !== 'POST') throw new BusinessAgentError(405, 'METHOD_NOT_ALLOWED', 'Use POST for the business protocol.');
      const principal = await adapter.resolvePrincipal(request);
      if (!principal) throw new BusinessAgentError(401, 'BUSINESS_AUTH_REQUIRED', 'A separately authorized business identity is required.');
      if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new BusinessAgentError(415, 'JSON_REQUIRED', 'Send JSON.');
      const reader = request.body?.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let body = ''; let length = 0;
      if (reader) try {
        while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength;
          if (length > 16384) { await reader.cancel(); throw new BusinessAgentError(413, 'BODY_TOO_LARGE', 'Business requests are limited to 16 KiB.'); }
          body += decoder.decode(value, { stream: true }); }
        body += decoder.decode();
      } catch (error) { if (error instanceof BusinessAgentError) throw error; throw new BusinessAgentError(400, 'INVALID_JSON', 'Send valid UTF-8 JSON.'); }
      finally { reader.releaseLock(); }
      let input: Record<string, unknown>;
      try { const parsed = JSON.parse(body); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); input = parsed; }
      catch { throw new BusinessAgentError(400, 'INVALID_JSON', 'Send a JSON object.'); }
      if (input.protocol !== BUSINESS_AGENT_PROTOCOL || !BUSINESS_AGENT_OPERATIONS.includes(input.operation as typeof BUSINESS_AGENT_OPERATIONS[number]))
        throw new BusinessAgentError(400, 'UNSUPPORTED_OPERATION', 'Use a supported business protocol operation.');
      const fields: Record<string, string[]> = {
        'requests.list': [], 'context.read': ['requestId'], 'proposal.create': ['requestId', 'idempotencyKey', 'command'], 'proposal.execute': ['proposalId'],
      };
      if (Object.keys(input).some(key => !['protocol', 'operation', ...fields[String(input.operation)]].includes(key))) throw new BusinessAgentError(400, 'UNKNOWN_FIELD', 'Unsupported business request field.');
      let result: unknown;
      switch (input.operation) {
        case 'requests.list': result = await adapter.service.listRequests(principal); break;
        case 'context.read': result = await adapter.service.readContext(principal, input.requestId as string); break;
        case 'proposal.create': result = await adapter.service.propose(principal, { requestId: input.requestId as string, idempotencyKey: input.idempotencyKey as string, command: input.command }); break;
        case 'proposal.execute': result = await adapter.service.executeApproved(principal, input.proposalId as string); break;
      }
      return reply({ protocol: BUSINESS_AGENT_PROTOCOL, result });
    } catch (error) {
      if (error instanceof BusinessAgentError) return reply({ code: error.code, error: error.message }, error.status);
      return reply({ code: 'BUSINESS_UNAVAILABLE', error: 'The business operation could not be completed. Retry with the same idempotency key.' }, 500);
    }
  };
}
/** Production is deliberately disconnected. Supplying headers cannot enable it. */
export const handleBusinessAgentHttp = createBusinessAgentHttp();
