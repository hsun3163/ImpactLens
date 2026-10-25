import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {CENTER_COLLECTION,CENTER_COLLECTION_BATCH_ID,CENTER_COLLECTION_MANIFEST,CENTER_COLLECTION_SOURCE,seedCenterCollection} from '../src/server/center-seed';

function fixture(failAt=-1){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`drizzle/${file}`,'utf8').replaceAll('--> statement-breakpoint',''));
  const prepare=(sql:string)=>{
    let values:any[]=[];
    const statement={bind(...args:any[]){assert.ok(args.length<=100, `Too many bound parameters: ${args.length}`);values=args;return statement;},async first(){return sqlite.prepare(sql).get(...values)??null;},async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)},results:[]};}};
    return statement;
  };
  const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){assert.ok(statements.length<=50, `Too many batch statements: ${statements.length}`);sqlite.exec('BEGIN');try{const result=[];for(let i=0;i<statements.length;i++){if(i===failAt)throw Error('injected atomic failure');result.push(await statements[i].run());}sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
  const count=(table:string)=>Number((sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n);
  return {sqlite,db,count};
}
test('collection is bounded, fictional, internally sourced and uniquely identified',()=>{
  assert.deepEqual([CENTER_COLLECTION_MANIFEST.centers,CENTER_COLLECTION_MANIFEST.programs,CENTER_COLLECTION_MANIFEST.courses,CENTER_COLLECTION_MANIFEST.sessions],[4,12,12,72]);
  assert.equal(CENTER_COLLECTION_MANIFEST.fictional,true);
  const ids=CENTER_COLLECTION.flatMap(c=>[c.id,...c.programs.flatMap(p=>[p.id,p.courseId,...p.sessions.map(s=>s.id)])]);
  assert.equal(new Set(ids).size,ids.length);
  for(const item of ids)assert.match(item,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for(const c of CENTER_COLLECTION)for(const p of c.programs){assert.equal(p.sessions.length,6);assert.ok(new Set(p.sessions.map(s=>s.attendees)).size>1);}
});
test('seed is persisted atomically, leaves SMS and grants untouched, and retries do not overwrite edits',async()=>{
  const {sqlite,db,count}=fixture();
  try{
    sqlite.exec("INSERT INTO sms_organizations VALUES('retained','Retained organization','retained',1,'before','before');INSERT INTO sms_records(id,message_sid,sender_phone,body,status,received_at) VALUES('retained-record','retained-sid','retained-phone','retain raw original','quarantined','before')");
    const rawBefore=sqlite.prepare('SELECT * FROM sms_records').all();
    const result=await seedCenterCollection(db,'test-admin');assert.equal(result.alreadyPresent,false);
    assert.equal(count('sms_organizations'),5);assert.equal(count('sms_programs'),12);assert.equal(count('course_summaries'),12);assert.equal(count('generated_activity'),72);
    assert.equal(count('sms_aggregates'),0);assert.equal(count('sms_teachers'),0);assert.equal(count('business_manager_grants'),0);assert.equal(count('business_agent_grants'),0);
    assert.deepEqual(sqlite.prepare('SELECT * FROM sms_records').all(),rawBefore);
    const audit=sqlite.prepare('SELECT * FROM center_seed_batches').get() as any;
    assert.equal(audit.source,CENTER_COLLECTION_SOURCE);assert.equal(audit.created_by,'test-admin');assert.equal(audit.id,CENTER_COLLECTION_BATCH_ID);
    assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM generated_activity WHERE source=?').get(CENTER_COLLECTION_SOURCE) as any).n,72);
    sqlite.prepare('UPDATE sms_organizations SET name=? WHERE id=?').run('User edited name',CENTER_COLLECTION[0].id);
    const again=await seedCenterCollection(db,'different-admin');assert.equal(again.alreadyPresent,true);assert.equal(count('generated_activity'),72);
    assert.equal((sqlite.prepare('SELECT name FROM sms_organizations WHERE id=?').get(CENTER_COLLECTION[0].id) as any).name,'User edited name');
    assert.equal((sqlite.prepare('SELECT created_by FROM center_seed_batches').get() as any).created_by,'test-admin');
    const expectedMinutes=CENTER_COLLECTION.reduce((sum,c)=>sum+c.programs.reduce((s,p)=>s+p.sessions.reduce((a,r)=>a+r.attendees*r.sessionMinutes,0),0),0);
    assert.equal((sqlite.prepare('SELECT SUM(attendees*session_minutes) minutes FROM generated_activity').get() as any).minutes,expectedMinutes);
  }finally{sqlite.close();}
});
test('a failed batch leaves neither partial centers nor a false completed marker',async()=>{
  const {sqlite,db,count}=fixture(8);try{await assert.rejects(seedCenterCollection(db,'test-admin'));for(const table of ['center_seed_batches','sms_organizations','sms_programs','course_summaries','generated_activity'])assert.equal(count(table),0);}finally{sqlite.close();}
});
test('seed rejects absent actor before writing',async()=>{const {sqlite,db,count}=fixture();try{await assert.rejects(seedCenterCollection(db,''));assert.equal(count('center_seed_batches'),0);}finally{sqlite.close();}});
