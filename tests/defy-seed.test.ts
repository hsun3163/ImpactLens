import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {DEFY_ACTIVITY_COURSES,DEFY_ACTIVITY_SOURCE,DEFY_ORGANIZATION_ID,DEFY_PROGRAM_ID,seedDefyActivity} from '../src/server/defy-seed';
function fixture(failAt=-1,beforeBatch?:(db:DatabaseSync)=>void){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(`drizzle/${file}`,'utf8').replaceAll('--> statement-breakpoint',''));
 sqlite.prepare('INSERT INTO sms_organizations VALUES(?,?,?,1,?,?)').run(DEFY_ORGANIZATION_ID,'Defy SIM','defy-sim','original','original');
 sqlite.prepare('INSERT INTO sms_programs VALUES(?,?,?,1,?,?)').run(DEFY_PROGRAM_ID,DEFY_ORGANIZATION_ID,'CEO of Your New Life','original','original');
 for(const c of DEFY_ACTIVITY_COURSES)sqlite.prepare('INSERT INTO course_summaries(id,revision,organization_id,program_id,facility,status,participants,created_at,updated_at) VALUES(?,1,?,?,?,\'planned\',20,\'original\',\'original\')').run(c.id,DEFY_ORGANIZATION_ID,DEFY_PROGRAM_ID,c.facility);
 sqlite.prepare('INSERT INTO course_summaries(id,revision,organization_id,program_id,facility,status,created_at,updated_at) VALUES(?,1,?,?,?,\'completed\',\'original\',\'original\')').run('kvsp-retained',DEFY_ORGANIZATION_ID,DEFY_PROGRAM_ID,'Kern Valley State Prison');
 sqlite.exec("INSERT INTO sms_records(id,message_sid,sender_phone,body,status,received_at) VALUES('original-sms','original-sid','original-phone','30 6','quarantined','original')");
 const prepare=(sql:string)=>{let args:any[]=[];const st={bind(...v:any[]){assert.ok(v.length<=100);args=v;return st;},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)},results:[]};}};return st;};
 const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){assert.equal(statements.length,3);beforeBatch?.(sqlite);sqlite.exec('BEGIN');try{const result=[];for(let i=0;i<statements.length;i++){if(i===failAt)throw Error('batch failure');result.push(await statements[i].run());}sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}as unknown as D1Database;
 const count=(name:string)=>Number((sqlite.prepare(`SELECT COUNT(*) n FROM ${name}`).get()as any).n);
 return {sqlite,db,count};
}
test('fixed Defy activity seeds only two requested existing courses with provenance and no summary/SMS changes',async()=>{
 const{sqlite,db,count}=fixture();try{
 const summaries=sqlite.prepare('SELECT * FROM course_summaries').all(),sms=sqlite.prepare('SELECT * FROM sms_records').all();
 const result=await seedDefyActivity(db,'admin');assert.equal(result.alreadyPresent,false);assert.equal(count('generated_activity'),12);assert.equal(count('center_seed_batches'),1);
 assert.deepEqual(sqlite.prepare('SELECT * FROM course_summaries').all(),summaries);assert.deepEqual(sqlite.prepare('SELECT * FROM sms_records').all(),sms);
 assert.equal((sqlite.prepare('SELECT SUM(attendees*session_minutes)/60 hours FROM generated_activity').get()as any).hours,384);
 assert.equal(count('sms_teachers'),0);assert.equal(count('business_manager_grants'),0);assert.equal(count('business_agent_grants'),0);
 for(const row of sqlite.prepare('SELECT * FROM generated_activity').all()as any[]){assert.equal(row.source,DEFY_ACTIVITY_SOURCE);assert.ok(DEFY_ACTIVITY_COURSES.some(c=>c.id===row.course_id));const snapshot=JSON.parse(row.course_snapshot_json);assert.equal(snapshot.startDate,null);assert.equal(snapshot.endDate,null);assert.equal(snapshot.organizationName,'Defy SIM');}
 assert.equal(JSON.parse((sqlite.prepare('SELECT manifest_json FROM center_seed_batches').get()as any).manifest_json).fictional,true);
 assert.equal((await seedDefyActivity(db,'other-admin')).alreadyPresent,true);assert.equal(count('generated_activity'),12);assert.equal((sqlite.prepare('SELECT created_by FROM center_seed_batches').get()as any).created_by,'admin');
 }finally{sqlite.close();}
});
test('missing or mismatched target fails before any seed writes',async()=>{
 for(const mutation of ["DELETE FROM course_summaries WHERE id='1660ac7b-a4f4-4e2e-974b-d31db061de71'","UPDATE course_summaries SET facility='different' WHERE id='1660ac7b-a4f4-4e2e-974b-d31db061de71'"]){const{sqlite,db,count}=fixture();try{sqlite.exec(mutation);await assert.rejects(seedDefyActivity(db,'admin'));assert.equal(count('generated_activity'),0);assert.equal(count('center_seed_batches'),0);}finally{sqlite.close();}}
});
test('in-transaction scope change aborts without false audit or points',async()=>{
 const{sqlite,db,count}=fixture(-1,s=>s.exec("UPDATE course_summaries SET facility='changed concurrently' WHERE id='1660ac7b-a4f4-4e2e-974b-d31db061de71'"));try{await assert.rejects(seedDefyActivity(db,'admin'));assert.equal(count('generated_activity'),0);assert.equal(count('center_seed_batches'),0);}finally{sqlite.close();}
});
test('batch failure rolls back all additions and absent actor cannot seed',async()=>{
 const{sqlite,db,count}=fixture(2);try{await assert.rejects(seedDefyActivity(db,''));await assert.rejects(seedDefyActivity(db,'admin'));assert.equal(count('generated_activity'),0);assert.equal(count('center_seed_batches'),0);}finally{sqlite.close();}
});
