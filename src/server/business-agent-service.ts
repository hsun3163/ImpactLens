import { isBusinessRequestText } from '../lib/business-request-text';
import { validateCourseSummary, type CourseSummaryWrite } from '../lib/course-summary';
import { isE164, parseSmsCommand } from '../lib/sms';
import {
  BUSINESS_AGENT_PROTOCOL, type BusinessAgentPort, type BusinessAudit, type BusinessCapability, type BusinessContext,
  type BusinessCourseCommand, type BusinessExecution, type BusinessPrincipal, type BusinessProposal, type BusinessRequest, type BusinessRequestView,
} from '../lib/business-agent-contract';

export class BusinessAgentError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIMIT = 20;
const capabilities: BusinessCapability[] = ['requests.read', 'courses.propose', 'approved.execute'];
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BusinessAgentError(400, 'INVALID_ID', 'Use a valid resource ID.');
  return value.toLowerCase();
}
function authorize(principal: BusinessPrincipal, capability: BusinessCapability) {
  if (!principal || typeof principal.id !== 'string' || !principal.id || principal.id.length > 256
    || !Array.isArray(principal.organizationIds) || !principal.organizationIds.length || principal.organizationIds.some(item => typeof item !== 'string' || !UUID.test(item))
    || !Array.isArray(principal.capabilities) || principal.capabilities.some(item => !capabilities.includes(item)) || !principal.capabilities.includes(capability))
    throw new BusinessAgentError(403, 'BUSINESS_ACCESS_DENIED', 'This business operation is not authorized.');
}
function scope(principal: BusinessPrincipal, organizationId: string) {
  if (!principal.organizationIds.includes(organizationId)) throw new BusinessAgentError(404, 'REQUEST_NOT_FOUND', 'The business request is unavailable in this scope.');
}
function requestView(request: BusinessRequest): BusinessRequestView {
  return { id: request.id, organizationId: request.organizationId, receivedAt: request.receivedAt, untrustedText: request.text.slice(0, 1600), ...(request.status ? {status:request.status} : {}) };
}
export async function businessCommandDigest(command: BusinessCourseCommand): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(command)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
/** Trusted product-side persistence port. The Sites MCP adapter uses the D1 implementation.
 * Writes MUST atomically enforce the supplied scope/revision/digest and append audit:
 * - proposal key is unique per actor + organization; changed payload replays conflict;
 * - execute rechecks current business-principal and manager authorization, approval digest, current course
 *   revision and program parent, applies once and records an immutable result;
 * - duplicate execute returns that result; a failed write adds no audit or mutation.
 * An outside agent never implements or receives this repository port.
 */
export interface BusinessRepository {
  listRequests(organizationIds: readonly string[], limit: number): Promise<BusinessRequest[]>;
  getRequest(requestId: string, organizationIds: readonly string[]): Promise<BusinessRequest | null>;
  getContext(organizationId: string, limit: number): Promise<{ courses: CourseSummaryWrite[]; programs: { id: string; organizationId: string; name: string }[]; truncated: boolean }>;
  getCourse(organizationId: string, courseId: string): Promise<CourseSummaryWrite | null>;
  programBelongsTo(organizationId: string, programId: string): Promise<boolean>;
  findProposalByKey?(organizationId: string, actorId: string, key: string): Promise<BusinessProposal | null>;
  createProposal(input: { proposal: BusinessProposal; idempotencyKey: string; audit: BusinessAudit }): Promise<BusinessProposal>;
  getProposal(proposalId: string, organizationIds: readonly string[]): Promise<BusinessProposal | null>;
  executeApprovedAtomically(input: { proposal: BusinessProposal; actorId: string; audit: BusinessAudit }): Promise<BusinessExecution>;
  /** Unique canonical receipt ID AND provider SID. Never import old quarantines. */
  enqueueFromCanonicalReceipt(input: { receiptId: string; messageSid: string; organizationId: string; managerId: string; text: string; receivedAt: string }): Promise<{ requestId: string; replayed: boolean }>;
}
export function createBusinessAgentService(repository: BusinessRepository, clock = () => new Date().toISOString()): BusinessAgentPort {
  async function request(principal: BusinessPrincipal, requestId: string) {
    const found = await repository.getRequest(id(requestId), principal.organizationIds);
    if (!found) throw new BusinessAgentError(404, 'REQUEST_NOT_FOUND', 'The business request is unavailable in this scope.');
    scope(principal, found.organizationId);
    if (!found.authorizationActive) throw new BusinessAgentError(403, 'REQUEST_AUTHORIZATION_INACTIVE', 'The original manager authorization is no longer active.');
    return found;
  }
  async function command(value: unknown, organizationId: string, checkRevision = true): Promise<BusinessCourseCommand> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BusinessAgentError(400, 'INVALID_COMMAND', 'Use a supported business command.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !['type', 'course'].includes(key)) || !['course.create', 'course.update'].includes(String(input.type)))
      throw new BusinessAgentError(400, 'INVALID_COMMAND', 'Only course creation or updates are supported.');
    let course: CourseSummaryWrite;
    try { course = validateCourseSummary(input.course); } catch { throw new BusinessAgentError(400, 'INVALID_COURSE', 'The proposed course fields are invalid.'); }
    if (course.organizationId !== organizationId) throw new BusinessAgentError(403, 'CROSS_ORGANIZATION_COMMAND', 'A proposal must stay within its original request organization.');
    if (!await repository.programBelongsTo(organizationId, course.programId)) throw new BusinessAgentError(403, 'PROGRAM_SCOPE_MISMATCH', 'The program must belong to the request organization.');
    if (input.type === 'course.create' && course.revision !== 0) throw new BusinessAgentError(409, 'REVISION_CONFLICT', 'A new course starts at revision zero.');
    if (input.type === 'course.update') {
      if (course.notes !== null) throw new BusinessAgentError(400, 'NOTES_NOT_SUPPORTED', 'This business adapter preserves existing course notes; edit notes in the private course workspace.');
      const current = await repository.getCourse(organizationId, course.id);
      if (!current || current.organizationId !== organizationId) throw new BusinessAgentError(404, 'COURSE_NOT_FOUND', 'The course is unavailable in this organization.');
      if (course.revision < 1 || (checkRevision && current.revision !== course.revision)) throw new BusinessAgentError(409, 'REVISION_CONFLICT', 'The course changed. Read its current context before proposing again.');
      // The business seam cannot move a course between programs, even if the UI could.
      if (current.programId !== course.programId) throw new BusinessAgentError(403, 'COURSE_PARENT_FIXED', 'An external proposal cannot change a course parent.');
    }
    return { type: input.type as BusinessCourseCommand['type'], course };
  }
  function audit(action: BusinessAudit['action'], actorId: string, proposal: BusinessProposal): BusinessAudit {
    return { id: crypto.randomUUID(), action, actorId, organizationId: proposal.organizationId, requestId: proposal.requestId,
      proposalId: proposal.id, commandDigest: proposal.commandDigest, at: clock() };
  }
  return {
    async listRequests(principal) {
      authorize(principal, 'requests.read');
      const rows = await repository.listRequests(principal.organizationIds, LIMIT);
      rows.forEach(row => scope(principal, row.organizationId));
      return rows.filter(row => row.authorizationActive).slice(0, LIMIT).map(requestView);
    },
    async readContext(principal, requestId) {
      authorize(principal, 'requests.read'); const found = await request(principal, requestId);
      const data = await repository.getContext(found.organizationId, LIMIT);
      if (data.courses.some(course => course.organizationId !== found.organizationId) || data.programs.some(program => program.organizationId !== found.organizationId))
        throw new BusinessAgentError(500, 'CONTEXT_SCOPE_ERROR', 'Business context could not be safely scoped.');
      const context: BusinessContext = { protocol: BUSINESS_AGENT_PROTOCOL, request: requestView(found),
        courses: data.courses.slice(0, LIMIT).map(course => ({ id: course.id, revision: course.revision, organizationId: course.organizationId,
          programId: course.programId, facility: course.facility, yard: course.yard, status: course.status, startDate: course.startDate, endDate: course.endDate,
          courseHoursPerParticipant: course.courseHoursPerParticipant, participants: course.participants, completers: course.completers })),
        programs: data.programs.slice(0, LIMIT).map(program => ({ id: program.id, organizationId: program.organizationId, name: program.name })),
        truncated: data.truncated || data.courses.length > LIMIT || data.programs.length > LIMIT };
      return context;
    },
    async propose(principal, input) {
      authorize(principal, 'courses.propose'); const found = await request(principal, input.requestId);
      if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(input.idempotencyKey)) throw new BusinessAgentError(400, 'INVALID_IDEMPOTENCY_KEY', 'Provide a stable idempotency key of 1–80 supported characters.');
      // Durable replay precedes current-revision validation: the same successful
      // command may itself have advanced that revision on a previous attempt.
      const prior = await repository.findProposalByKey?.(found.organizationId, principal.id, input.idempotencyKey);
      if (prior) {
        const raw = input.command as Record<string, unknown> | null;
        let replay: BusinessCourseCommand;
        try {
          if (!raw || Object.keys(raw).some(key => !['type','course'].includes(key)) || !['course.create','course.update'].includes(String(raw.type))) throw new Error();
          replay = {type:raw.type as BusinessCourseCommand['type'],course:validateCourseSummary(raw.course)};
        } catch {throw new BusinessAgentError(400,'INVALID_COMMAND','Use a valid business command.');}
        if (prior.requestId !== found.id || prior.commandDigest !== await businessCommandDigest(replay)) throw new BusinessAgentError(409,'IDEMPOTENCY_CONFLICT','This key already belongs to a different request or command.');
        return prior;
      }
      const validated = await command(input.command, found.organizationId);
      const proposal: BusinessProposal = { id: crypto.randomUUID(), requestId: found.id, organizationId: found.organizationId, actorId: principal.id,
        command: validated, commandDigest: await businessCommandDigest(validated), createdAt: clock(), status: 'proposed', approval: null };
      return repository.createProposal({ proposal, idempotencyKey: input.idempotencyKey, audit: audit('proposal.created', principal.id, proposal) });
    },
    async executeApproved(principal, proposalId) {
      authorize(principal, 'approved.execute');
      const proposal = await repository.getProposal(id(proposalId), principal.organizationIds);
      if (!proposal) throw new BusinessAgentError(404, 'PROPOSAL_NOT_FOUND', 'The proposal is unavailable in this scope.');
      scope(principal, proposal.organizationId); const found = await request(principal, proposal.requestId);
      if (found.organizationId !== proposal.organizationId) throw new BusinessAgentError(403, 'PROPOSAL_SCOPE_MISMATCH', 'The proposal no longer matches its original scope.');
      if (!['approved', 'executed'].includes(proposal.status) || !proposal.approval?.approvedBy || !proposal.approval.approvedAt
        || proposal.approval.commandDigest !== proposal.commandDigest || await businessCommandDigest(proposal.command) !== proposal.commandDigest)
        throw new BusinessAgentError(409, 'APPROVAL_REQUIRED', 'This exact proposal needs product-side approval before execution.');
      // Atomic persistence owns the final revision check and replay result. A
      // concurrent retry may have read 'approved' just before another call committed.
      if (proposal.status !== 'executed') await command(proposal.command, proposal.organizationId, false);
      return repository.executeApprovedAtomically({ proposal, actorId: principal.id, audit: audit('proposal.executed', principal.id, proposal) });
    },
  };
}

/** Portable trusted inbound contract seam, deliberately not exposed by HTTP.
 * The canonical receipt must have just been inserted by the signed SMS ingress;
 * manager scope comes from separate explicit provisioning, never SMS text or a
 * teacher mapping. The D1 implementation instead inserts the request in the same
 * canonical ingress batch; standalone D1 enqueue is deliberately rejected.
 */
export async function acceptManagerBusinessReceipt(repository: BusinessRepository, input: {
  receipt: { id: string; messageSid: string; senderPhone: string; body: string; receivedAt: string; providerVerified: boolean; newlyInserted: boolean; mediaCount: number };
  manager: { id: string; organizationId: string; phone: string; active: boolean } | null;
}) {
  const { receipt, manager } = input;
  if (!receipt.providerVerified) throw new BusinessAgentError(403, 'UNVERIFIED_RECEIPT', 'A verified provider receipt is required.');
  if (!receipt.newlyInserted) return { queued: false as const, reason: 'existing-receipt' as const };
  if (parseSmsCommand(receipt.body).ok) return { queued: false as const, reason: 'attendance-command' as const };
  if (!manager?.active || !isE164(receipt.senderPhone) || manager.phone !== receipt.senderPhone) return { queued: false as const, reason: 'manager-not-authorized' as const };
  if (receipt.mediaCount !== 0 || !isBusinessRequestText(receipt.body) || !/^SM[0-9a-f]{32}$/i.test(receipt.messageSid)) throw new BusinessAgentError(400, 'INVALID_MANAGER_REQUEST', 'The manager request is invalid.');
  return { queued: true as const, ...await repository.enqueueFromCanonicalReceipt({ receiptId: id(receipt.id), messageSid: receipt.messageSid,
    organizationId: id(manager.organizationId), managerId: id(manager.id), text: receipt.body, receivedAt: receipt.receivedAt }) };
}
