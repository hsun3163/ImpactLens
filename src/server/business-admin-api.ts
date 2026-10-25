import { isBusinessRequestText } from '../lib/business-request-text';
import { isE164 } from '../lib/sms';
import { BusinessAgentError } from './business-agent-service';
import { businessId, REQUEST_SELECT } from './business-agent-d1';
type Row=Record<string,unknown>;
function only(body:Record<string,unknown>,fields:string[]){if(Object.keys(body).some(k=>!fields.includes(k)))throw new BusinessAgentError(400,'UNKNOWN_FIELD','Unsupported business permission field.');}
function active(value:unknown){if(typeof value!=='boolean')throw new BusinessAgentError(400,'ACTIVE_REQUIRED','Choose whether this separate permission is enabled.');return Number(value);}
function reason(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>500||/[\x00-\x1f\x7f]/.test(value))throw new BusinessAgentError(400,'REASON_REQUIRED','Provide an import reason of 1–500 characters.');return value.trim();}
/** Caller must enforce the existing TPW-admin and same-origin boundaries. */
export async function businessAdminData(db:D1Database,userId:string,userLabel:string){
  const [managers,agents,requests,proposals]=await db.batch<Row>([
    db.prepare('SELECT * FROM business_manager_grants ORDER BY created_at DESC,id'),
    db.prepare('SELECT * FROM business_agent_grants ORDER BY created_at DESC,id'),
    db.prepare(REQUEST_SELECT+' ORDER BY r.created_at DESC,r.id DESC LIMIT 50'),
    db.prepare('SELECT id,request_id,organization_id,status,created_at,executed_at,result_json FROM business_proposals ORDER BY created_at DESC,id DESC LIMIT 50'),
  ]);
  return {currentUserId:userId,currentUserLabel:userLabel,canManagePermissions:true,permissions:'business-only',
    managerGrants:managers.results.map(r=>({id:r.id,phone:r.phone,organizationId:r.organization_id,active:Boolean(r.active),revision:r.revision})),
    agentGrants:agents.results.map(r=>({id:r.id,subjectId:r.subject_id,organizationId:r.organization_id,active:Boolean(r.active),revision:r.revision})),
    requests:requests.results.map(r=>({id:r.id,receiptId:r.receipt_id,organizationId:r.organization_id,text:r.text,receivedAt:r.received_at,source:r.source,status:r.status,authorizationActive:Boolean(r.authorization_active)})),
    proposals:proposals.results.map(r=>({id:r.id,requestId:r.request_id,organizationId:r.organization_id,status:r.status,createdAt:r.created_at,executedAt:r.executed_at,result:r.result_json?JSON.parse(String(r.result_json)):null})),
  };
}
export async function mutateBusinessAdmin(db:D1Database,body:Record<string,unknown>,userId:string){
  const now=new Date().toISOString();
  if(body.action==='manager-grant'){
    only(body,['action','phone','organizationId','active']);const organizationId=businessId(body.organizationId);const enabled=active(body.active);
    if(typeof body.phone!=='string'||!isE164(body.phone.trim()))throw new BusinessAgentError(400,'INVALID_PHONE','Choose the exact international phone number.');const phone=body.phone.trim();
    const existing=await db.prepare('SELECT * FROM business_manager_grants WHERE phone=?').bind(phone).first<Row>();
    if(existing&&existing.organization_id!==organizationId)throw new BusinessAgentError(409,'MANAGER_SCOPE_FIXED','This phone already has a different explicit leader scope. Do not silently retarget it.');
    if(!existing&&!enabled)throw new BusinessAgentError(404,'GRANT_NOT_FOUND','No leader grant exists for this phone.');
    if(!await db.prepare('SELECT id FROM sms_organizations WHERE id=?'+(enabled?' AND active=1':'')).bind(organizationId).first())throw new BusinessAgentError(409,'ORGANIZATION_NOT_ACTIVE','Choose an existing active organization.');
    const id=existing?String(existing.id):crypto.randomUUID();
    await db.prepare(`INSERT INTO business_manager_grants(id,phone,organization_id,active,revision,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET active=excluded.active,revision=business_manager_grants.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE business_manager_grants.organization_id=excluded.organization_id AND business_manager_grants.active<>excluded.active`).bind(id,phone,organizationId,enabled,userId,userId,now,now).run();
    const saved=await db.prepare('SELECT * FROM business_manager_grants WHERE phone=?').bind(phone).first<Row>();
    if(!saved||saved.organization_id!==organizationId)throw new BusinessAgentError(409,'GRANT_CONFLICT','The permission changed. Refresh before trying again.');
    return {ok:true,id:saved.id,revision:saved.revision,role:'organization-leader'};
  }
  if(body.action==='agent-grant'){
    // No arbitrary subject field: this UI only authorizes the verified signed-in account.
    only(body,['action','organizationId','active']);const organizationId=businessId(body.organizationId);const enabled=active(body.active);
    const existing=await db.prepare('SELECT * FROM business_agent_grants WHERE subject_id=? AND organization_id=?').bind(userId,organizationId).first<Row>();
    if(!existing&&!enabled)throw new BusinessAgentError(404,'GRANT_NOT_FOUND','No business-agent grant exists for this account and organization.');
    if(!await db.prepare('SELECT id FROM sms_organizations WHERE id=?'+(enabled?' AND active=1':'')).bind(organizationId).first())throw new BusinessAgentError(409,'ORGANIZATION_NOT_ACTIVE','Choose an existing active organization.');
    const id=existing?String(existing.id):crypto.randomUUID();
    await db.prepare(`INSERT INTO business_agent_grants(id,subject_id,organization_id,active,revision,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,1,?,?,?,?) ON CONFLICT(subject_id,organization_id) DO UPDATE SET active=excluded.active,revision=business_agent_grants.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE business_agent_grants.active<>excluded.active`).bind(id,userId,organizationId,enabled,userId,userId,now,now).run();
    const saved=await db.prepare('SELECT id,revision FROM business_agent_grants WHERE subject_id=? AND organization_id=?').bind(userId,organizationId).first<Row>();
    return {ok:true,id:saved!.id,revision:saved!.revision,role:'business-agent'};
  }
  if(body.action==='import-request'){
    only(body,['action','recordId','organizationId','reason']);const recordId=businessId(body.recordId),organizationId=businessId(body.organizationId),explanation=reason(body.reason);
    const row=await db.prepare('SELECT * FROM sms_records WHERE id=?').bind(recordId).first<Row>();
    if(!row)throw new BusinessAgentError(404,'RECORD_NOT_FOUND','The original SMS was not found.');
    if(row.status!=='quarantined'||row.reason!=='INVALID_BODY'||!isBusinessRequestText(String(row.body)))throw new BusinessAgentError(409,'IMPORT_NOT_ELIGIBLE','Only a specific quarantined free-text SMS can be explicitly imported. Attendance messages are not business requests.');
    const previous=await db.prepare('SELECT id,organization_id FROM business_requests WHERE receipt_id=?').bind(recordId).first<Row>();
    if(previous){if(previous.organization_id!==organizationId)throw new BusinessAgentError(409,'IMPORT_SCOPE_CONFLICT','This receipt already belongs to another request scope.');return {ok:true,id:previous.id,replayed:true};}
    const id=crypto.randomUUID();
    const saved=await db.prepare(`INSERT INTO business_requests(id,receipt_id,organization_id,manager_grant_id,manager_grant_revision,text,received_at,source,status,imported_by,import_reason,created_at)
      SELECT ?,r.id,m.organization_id,m.id,m.revision,r.body,r.received_at,'admin-import','pending',?,?,?
      FROM sms_records r JOIN business_manager_grants m ON m.phone=r.sender_phone JOIN sms_organizations o ON o.id=m.organization_id
      WHERE r.id=? AND r.status='quarantined' AND r.reason='INVALID_BODY' AND m.organization_id=? AND m.active=1 AND o.active=1
        AND (r.organization_id IS NULL OR r.organization_id=m.organization_id)
      ON CONFLICT(receipt_id) DO NOTHING RETURNING id`).bind(id,userId,explanation,now,recordId,organizationId).first<Row>();
    if(saved)return {ok:true,id:saved.id,replayed:false};
    const raced=await db.prepare('SELECT id FROM business_requests WHERE receipt_id=? AND organization_id=?').bind(recordId,organizationId).first<Row>();
    if(raced)return {ok:true,id:raced.id,replayed:true};
    throw new BusinessAgentError(409,'IMPORT_NOT_AUTHORIZED','Grant this exact sender leadership in the original organization before importing this one request.');
  }
  throw new BusinessAgentError(400,'INVALID_ACTION','Choose an explicit leader grant, signed-in business grant, or single-record import.');
}
