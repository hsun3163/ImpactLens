import type { CourseSummaryWrite } from './course-summary';

/** Business data only. This protocol has no repository, shell, deployment or secret tools. */
export const BUSINESS_AGENT_PROTOCOL = 'impactlens.business.v1' as const;
export const BUSINESS_AGENT_OPERATIONS = ['requests.list', 'context.read', 'proposal.create', 'proposal.execute'] as const;
export type BusinessAgentOperation = typeof BUSINESS_AGENT_OPERATIONS[number];
export type BusinessCapability = 'requests.read' | 'courses.propose' | 'approved.execute';
/** Resolved by a separately configured trusted business authenticator, never the request body. The separately authenticated Sites MCP adapter also requires an explicit business grant. */
export type BusinessPrincipal = { id: string; organizationIds: readonly string[]; capabilities: readonly BusinessCapability[] };
export type BusinessCourseCommand = { type: 'course.create' | 'course.update'; course: CourseSummaryWrite };
export type BusinessRequest = {
  id: string; organizationId: string; receiptId: string; receivedAt: string; text: string; authorizationActive: boolean; status?: 'pending' | 'completed'; source?: 'sms' | 'admin-import';
};
export type BusinessRequestView = { id: string; organizationId: string; receivedAt: string; untrustedText: string; status?: 'pending' | 'completed' };
export type BusinessCourseContext = Omit<CourseSummaryWrite, 'notes'>;
export type BusinessContext = {
  protocol: typeof BUSINESS_AGENT_PROTOCOL; request: BusinessRequestView;
  courses: BusinessCourseContext[]; programs: { id: string; organizationId: string; name: string }[]; truncated: boolean;
};
export type BusinessProposal = {
  id: string; requestId: string; organizationId: string; actorId: string; command: BusinessCourseCommand;
  commandDigest: string; createdAt: string; status: 'proposed' | 'approved' | 'executed' | 'rejected';
  approval: { approvedBy: string; approvedAt: string; commandDigest: string } | null;
};
export type BusinessExecution = { proposalId: string; organizationId: string; resourceId: string; revision: number; replayed: boolean };
export type BusinessAudit = {
  id: string; action: 'proposal.created' | 'proposal.executed'; actorId: string; organizationId: string;
  requestId: string; proposalId: string; commandDigest: string; at: string;
};
/** Vendor-neutral seam: a separately authenticated HTTP client or the Sites MCP wrapper uses these same bounded operations. */
export interface BusinessAgentPort {
  listRequests(principal: BusinessPrincipal): Promise<BusinessRequestView[]>;
  readContext(principal: BusinessPrincipal, requestId: string): Promise<BusinessContext>;
  propose(principal: BusinessPrincipal, input: { requestId: string; idempotencyKey: string; command: unknown }): Promise<BusinessProposal>;
  executeApproved(principal: BusinessPrincipal, proposalId: string): Promise<BusinessExecution>;
}
