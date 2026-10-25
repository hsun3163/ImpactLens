import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handleSmsApi, type SmsRuntime } from '../src/server/sms-api';
import { CENTER_COLLECTION } from '../src/server/center-seed';
import { fundingStory } from '../src/lib/sms-report';

function fixture() {
  const sqlite=new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
  const prepare=(sql:string)=>{ let values:any[]=[]; const stmt={bind(...args:any[]){values=args;return stmt;},async all(){return {results:sqlite.prepare(sql).all(...values),meta:{}};},async first(){return sqlite.prepare(sql).get(...values)??null;},async run(){const r=sqlite.prepare(sql).run(...values);return {results:[],meta:{changes:Number(r.changes)}};}};return stmt;};
  const db={prepare,async batch(stmts:ReturnType<typeof prepare>[]){sqlite.exec('BEGIN');try{const rows=[];for(const stmt of stmts)rows.push(await stmt.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
  const env:SmsRuntime={DB:db,TPW_ADMIN_USER_IDS:'admin'};
  const api=(path:string,body?:unknown,user:string|null='admin',extra:Record<string,string>={})=>handleSmsApi(new Request('https://impact.test'+path,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}),...(body?{'content-type':'application/json',origin:'https://impact.test'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})}),env);
  return {sqlite,api};
}

test('generated center collection is protected, explicit, fixed and idempotent',async()=>{
 const f=fixture();try{
  for(const [user,status] of [[null,401],['other',403]] as const)assert.equal((await f.api('/api/sms/center-collection',{action:'populate-centers'},user)).status,status);
  assert.equal((await f.api('/api/sms/center-collection')).status,405);
  assert.equal((await f.api('/api/sms/center-collection',{action:'populate-centers'},'admin',{origin:'https://other.test'})).status,403);
  assert.equal((await f.api('/api/sms/center-collection',{action:'populate-centers',organizationId:'injection'})).status,400);
  assert.equal((await f.api('/api/sms/center-collection',{action:'other'})).status,400);
  assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM generated_activity').get() as any).n,0);
  for(let n=0;n<2;n++){const r=await f.api('/api/sms/center-collection',{action:'populate-centers'});assert.equal(r.status,200,await r.clone().text());}
  assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM generated_activity').get() as any).n,72);
  for(const table of ['sms_records','sms_teachers','sms_aggregates','business_manager_grants','business_agent_grants'])assert.equal((f.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as any).n,0);
 }finally{f.sqlite.close();}
});

test('center and TPW totals, program maxima, charts and reports use the same disjoint activity',async()=>{
 const f=fixture();try{
  assert.equal((await f.api('/api/sms/center-collection',{action:'populate-centers'})).status,200);
  const dashboard=await (await f.api('/api/sms/dashboard')).json() as any;
  const expected=f.sqlite.prepare('SELECT COUNT(*) sessions,SUM(attendees) attendees,SUM(session_minutes) sessionMinutes,SUM(attendees*session_minutes) participantMinutes FROM generated_activity').get();
  assert.deepEqual(dashboard.totals,{...expected}); assert.equal(dashboard.organizations.length,4); assert.equal(dashboard.programs.length,12); assert.equal(dashboard.participantEstimate.participants,282);
  const sum={sessions:0,attendees:0,sessionMinutes:0,participantMinutes:0};
  for(const center of CENTER_COLLECTION){
   const response=await f.api('/api/sms/dashboard?organizationId='+center.id+'&includeCourses=1'); assert.equal(response.status,200,await response.clone().text());const data=await response.json() as any;
   for(const key of Object.keys(sum) as (keyof typeof sum)[])sum[key]+=data.totals[key];
   assert.equal(data.courseAttendance.length,3); assert.ok(data.courseAttendance.every((c:any)=>c.points.length===6&&c.course.organizationId===center.id));
   for(const course of data.courseAttendance){
    const details=await (await f.api('/api/sms/course-attendance?courseId='+course.course.id)).json() as any;
    assert.deepEqual(details.totals,course.totals); assert.deepEqual(details.points,course.points);
   }
  }
  assert.deepEqual(sum,dashboard.totals);
  // A later genuine SMS record is added through the original storage path and
  // counted once beside the generated collection; trigger counters remain SMS-only.
  const center=CENTER_COLLECTION[0],program=center.programs[0];
  f.sqlite.prepare(`INSERT INTO sms_records(id,message_sid,sender_phone,body,status,teacher_id,organization_id,program_id,organization_name,program_name,attendees,session_minutes,received_at,processed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('live-record','SM'+'a'.repeat(32),'+14155550101','7 1','counted','test-teacher',center.id,program.id,center.name,program.name,7,60,'2026-10-25T12:00:00.000Z','2026-10-25T12:00:00.000Z');
  const after=await (await f.api('/api/sms/dashboard')).json() as any;
  assert.equal(after.totals.sessions,dashboard.totals.sessions+1);
  assert.equal(after.participantEstimate.participants,282);
  assert.equal(after.totals.participantMinutes,dashboard.totals.participantMinutes+420);
  assert.equal((f.sqlite.prepare('SELECT SUM(sessions) n FROM sms_aggregates').get() as any).n,1);
  const reportResponse=await f.api('/api/sms/report?start=2026-01-01&end=2026-10-25');assert.equal(reportResponse.status,200);
  const report=await reportResponse.json() as any;assert.equal(report.source,'mixed-activity');
  assert.equal(report.current.sessions,after.totals.sessions);assert.equal(report.current.participantMinutes,after.totals.participantMinutes);
  assert.match(fundingStory(report).text,/Includes generated center records/);
  assert.doesNotMatch(JSON.stringify(dashboard),/sender_phone|senderPhone|messageSid|created_by/);
 }finally{f.sqlite.close();}
});
