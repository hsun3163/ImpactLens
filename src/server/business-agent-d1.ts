import { validateCourseSummary, type CourseSummaryWrite } from '../lib/course-summary';
import { parseSmsCommand } from '../lib/sms';
import { BusinessAgentError, type BusinessRepository } from './business-agent-service';
import type { BusinessPrincipal, BusinessProposal, BusinessRequest, BusinessExecution } from '../lib/business-agent-contract';

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function businessId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BusinessAgentError(400,'INVALID_ID','Choose a valid business record.');
  return value.toLowerCase();
}
export const REQUEST_SELECT = `SELECT r.*, (m.active=1 AND m.revision=r.manager_grant_revision AND m.organization_id=r.organization_id AND o.active=1) authorization_active
  FROM business_requests r JOIN business_manager_grants m ON m.id=r.manager_grant_id JOIN sms_organizations o ON o.id=r.organization_id`;
const scope = (ids: readonly string[]) => ids.length ? `(${ids.map(()=>'?').join(',')})` : '(NULL)';
export function businessRequestView(row: Row): BusinessRequest {
  return { id:String(row.id),organizationId:String(row.organization_id),receiptId:String(row.receipt_id),receivedAt:String(row.received_at),text:String(row.text),
    authorizationActive:Boolean(row.authorization_active),status:row.status as 'pending'|'completed',source:row.source as 'sms'|'admin-import' };
}
function course(row: Row): CourseSummaryWrite {
  return validateCourseSummary({id:row.id,revision:row.revision,organizationId:row.organization_id,programId:row.program_id,status:row.status,facility:row.facility,yard:row.yard,
    startDate:row.start_date,endDate:row.end_date,courseHoursPerParticipant:row.course_hours_per_participant,participants:row.participants,completers:row.completers,notes:row.notes});
}
export function proposalView(row: Row): BusinessProposal {
  const authority=JSON.parse(String(row.authority_json));
  return {id:String(row.id),requestId:String(row.request_id),organizationId:String(row.organization_id),actorId:String(row.actor_id),command:JSON.parse(String(row.command_json)),
    commandDigest:String(row.command_digest),createdAt:String(row.created_at),status:row.status as 'approved'|'executed',
    approval:{approvedBy:`standing-manager-grant:${authority.managerGrantId}@${authority.managerGrantRevision}`,approvedAt:String(row.created_at),commandDigest:String(row.command_digest)}};
}
export async function resolveSitesBusinessPrincipal(request: Request, db: D1Database): Promise<BusinessPrincipal> {
  // This resolver is used ONLY by the Sites-authenticated /mcp route. It is never
  // installed in the generic external HTTP adapter, which remains disconnected.
  const id=request.headers.get('oai-authenticated-user-id'); const email=request.headers.get('oai-authenticated-user-email');
  if (!id || !email || id.length>256 || email.length>320) throw new BusinessAgentError(401,'BUSINESS_AUTH_REQUIRED','Sign in with the authorized Sites account.');
  const rows=await db.prepare(`SELECT g.organization_id FROM business_agent_grants g JOIN sms_organizations o ON o.id=g.organization_id
    WHERE g.subject_id=? AND g.active=1 AND o.active=1 ORDER BY g.organization_id`).bind(id).all<Row>();
  if(!rows.results.length)throw new BusinessAgentError(403,'BUSINESS_GRANT_REQUIRED','This account has no active organization-scoped business grant.');
  return {id,organizationIds:rows.results.map(r=>String(r.organization_id)),capabilities:['requests.read','courses.propose','approved.execute']};
}
/** Called within the SAME D1 batch as a brand-new canonical SMS receipt insert.
 * The random receipt ID belongs to this attempt, so a SID replay cannot enqueue
 * an older row after a role is granted. Existing receipt classifications stay put.
 */
export function newManagerRequestStatement(db: D1Database, receiptId: string, now: string) {
  return db.prepare(`INSERT INTO business_requests(id,receipt_id,organization_id,manager_grant_id,manager_grant_revision,text,received_at,source,status,created_at)
    SELECT ?,r.id,m.organization_id,m.id,m.revision,r.body,r.received_at,'sms','pending',?
    FROM sms_records r JOIN business_manager_grants m ON m.phone=r.sender_phone JOIN sms_organizations o ON o.id=m.organization_id
    WHERE r.id=? AND r.status='quarantined' AND r.reason='INVALID_BODY' AND m.active=1 AND o.active=1
    ON CONFLICT(receipt_id) DO NOTHING`).bind(crypto.randomUUID(),now,receiptId);
}
export function createD1BusinessRepository(db: D1Database): BusinessRepository {
  const getProposal=async(id:string,ids:readonly string[])=>{
    const row=await db.prepare(`SELECT * FROM business_proposals WHERE id=? AND organization_id IN ${scope(ids)}`).bind(id,...ids).first<Row>();
    return row?proposalView(row):null;
  };
  return {
    async listRequests(ids,limit) {
      const rows=await db.prepare(REQUEST_SELECT+` WHERE r.organization_id IN ${scope(ids)} AND r.status='pending' AND m.active=1 AND m.revision=r.manager_grant_revision AND o.active=1 ORDER BY r.created_at,r.id LIMIT ?`).bind(...ids,Math.min(20,limit)).all<Row>();
      return rows.results.map(businessRequestView);
    },
    async getRequest(id,ids){const row=await db.prepare(REQUEST_SELECT+` WHERE r.id=? AND r.organization_id IN ${scope(ids)}`).bind(id,...ids).first<Row>();return row?businessRequestView(row):null;},
    async getContext(organizationId,limit){
      const [courses,programs]=await db.batch<Row>([
        db.prepare('SELECT * FROM course_summaries WHERE organization_id=? ORDER BY updated_at DESC,id LIMIT ?').bind(organizationId,Math.min(20,limit)+1),
        db.prepare('SELECT id,organization_id,name FROM sms_programs WHERE organization_id=? AND active=1 ORDER BY name,id LIMIT ?').bind(organizationId,Math.min(20,limit)+1),
      ]);
      return {courses:courses.results.slice(0,limit).map(course),programs:programs.results.slice(0,limit).map(p=>({id:String(p.id),organizationId:String(p.organization_id),name:String(p.name)})),truncated:courses.results.length>limit||programs.results.length>limit};
    },
    async getCourse(org,id){const row=await db.prepare('SELECT * FROM course_summaries WHERE id=? AND organization_id=?').bind(id,org).first<Row>();return row?course(row):null;},
    async programBelongsTo(org,program){return Boolean(await db.prepare('SELECT p.id FROM sms_programs p JOIN sms_organizations o ON o.id=p.organization_id WHERE p.id=? AND p.organization_id=? AND p.active=1 AND o.active=1').bind(program,org).first());},
    async findProposalByKey(org,actor,key){const row=await db.prepare('SELECT * FROM business_proposals WHERE organization_id=? AND actor_id=? AND idempotency_key=?').bind(org,actor,key).first<Row>();return row?proposalView(row):null;},
    async createProposal({proposal,idempotencyKey}) {
      const row=await db.prepare(`INSERT INTO business_proposals(id,request_id,organization_id,actor_id,agent_grant_id,agent_grant_revision,idempotency_key,command_json,command_digest,authority_json,status,created_at)
        SELECT ?,r.id,r.organization_id,?,a.id,a.revision,?,?,?,
          json_object('kind','standing-leader-delegation','managerGrantId',m.id,'managerGrantRevision',m.revision,'agentGrantId',a.id,'agentGrantRevision',a.revision,'commandDigest',?),
          'approved',? FROM business_requests r JOIN business_manager_grants m ON m.id=r.manager_grant_id
          JOIN business_agent_grants a ON a.organization_id=r.organization_id AND a.subject_id=? JOIN sms_organizations o ON o.id=r.organization_id
        WHERE r.id=? AND r.organization_id=? AND r.status='pending' AND m.active=1 AND m.revision=r.manager_grant_revision AND a.active=1 AND o.active=1
        ON CONFLICT(organization_id,actor_id,idempotency_key) DO NOTHING RETURNING *`)
        .bind(proposal.id,proposal.actorId,idempotencyKey,JSON.stringify(proposal.command),proposal.commandDigest,proposal.commandDigest,proposal.createdAt,proposal.actorId,proposal.requestId,proposal.organizationId).first<Row>();
      if(row)return proposalView(row);
      const old=await db.prepare('SELECT * FROM business_proposals WHERE organization_id=? AND actor_id=? AND idempotency_key=?').bind(proposal.organizationId,proposal.actorId,idempotencyKey).first<Row>();
      if(old){if(old.command_digest!==proposal.commandDigest||old.request_id!==proposal.requestId)throw new BusinessAgentError(409,'IDEMPOTENCY_CONFLICT','This key already belongs to a different request or command.');return proposalView(old);}
      throw new BusinessAgentError(409,'REQUEST_NOT_EXECUTABLE','The request is completed or its standing authority changed.');
    },
    getProposal,
    async executeApprovedAtomically({proposal,actorId,audit}) {
      let changed:Row|null;
      try {
        changed=await db.prepare(`UPDATE business_proposals SET status='executed',executed_by=?,executed_at=?,result_json=
          json_object('proposalId',id,'organizationId',organization_id,'resourceId',json_extract(command_json,'$.course.id'),'revision',json_extract(command_json,'$.course.revision')+1)
          WHERE id=? AND organization_id=? AND actor_id=? AND command_digest=? AND status='approved' RETURNING result_json`)
          .bind(actorId,audit.at,proposal.id,proposal.organizationId,actorId,proposal.commandDigest).first<Row>();
      } catch {throw new BusinessAgentError(409,'EXECUTION_CONFLICT','The grant, request or course revision changed. Nothing was applied. Refresh before trying again.');}
      if(changed)return {...JSON.parse(String(changed.result_json)),replayed:false} as BusinessExecution;
      const row=await db.prepare(`SELECT p.result_json FROM business_proposals p JOIN business_agent_grants a ON a.id=p.agent_grant_id
        JOIN business_requests r ON r.id=p.request_id JOIN business_manager_grants m ON m.id=r.manager_grant_id JOIN sms_organizations o ON o.id=p.organization_id
        WHERE p.id=? AND p.organization_id=? AND p.actor_id=? AND p.command_digest=? AND p.status='executed'
          AND a.active=1 AND a.revision=p.agent_grant_revision AND m.active=1 AND m.revision=r.manager_grant_revision AND o.active=1`)
        .bind(proposal.id,proposal.organizationId,actorId,proposal.commandDigest).first<Row>();
      if(row)return {...JSON.parse(String(row.result_json)),replayed:true} as BusinessExecution;
      throw new BusinessAgentError(409,'EXECUTION_CONFLICT','The proposal is unavailable under the current business authority.');
    },
    async enqueueFromCanonicalReceipt(){
      // Production uses newManagerRequestStatement in the canonical ingress batch.
      // Do not offer a standalone operation that could import historical receipts.
      throw new BusinessAgentError(409,'CANONICAL_TRANSACTION_REQUIRED','Business SMS intake must share the new receipt transaction.');
    },
  };
}
