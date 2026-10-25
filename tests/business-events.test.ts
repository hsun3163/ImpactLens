import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { handleSmsApi,type SmsRuntime } from '../src/server/sms-api';
import { handleBusinessMcp } from '../src/server/business-agent-mcp';
import { deliverBusinessEvents, deliverBusinessEventsForSid, BUSINESS_REQUEST_EVENT } from '../src/server/business-events';
import { signEventBody } from '../src/lib/business-event-security';

const ORIGIN='https://impactlens.example.test',ACCOUNT='AC'+'a'.repeat(32),TOKEN='synthetic-test-token-no-real-secret',PHONE='+12025550101';
const OWNER='site-owner',OTHER='site-other',VIEWER='public-viewer';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
 let beforeExecute:(()=>void)|undefined;
 const prepare=(sql:string)=>{let values:any[]=[];const before=()=>{if(sql.startsWith("UPDATE business_proposals SET status='executed'")&&beforeExecute){const fn=beforeExecute;beforeExecute=undefined;fn();}};
  const statement={bind(...args:any[]){values=args;return statement;},allNow(){before();return {success:true,results:sqlite.prepare(sql).all(...values),meta:{}};},async first(column?:string){before();const row=sqlite.prepare(sql).get(...values) as any;return row?column?row[column]:row:null;},async all(){return statement.allNow();},async run(){before();const r=sqlite.prepare(sql).run(...values);return {success:true,results:[],meta:{changes:Number(r.changes)}};}};return statement;};
 const env:SmsRuntime={DB:{prepare,async batch(statements:ReturnType<typeof prepare>[]){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.allNow());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}} as unknown as D1Database,TPW_ADMIN_USER_IDS:OWNER,TWILIO_ACCOUNT_SID:ACCOUNT,TWILIO_AUTH_TOKEN:TOKEN,TWILIO_PHONE_NUMBER:'+12025550999',TWILIO_WEBHOOK_URL:ORIGIN+'/api/sms/inbound'};
 const auth=(user:string|null):Record<string,string>=>user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{};
 async function api(path:string,body?:unknown,user:string|null=OWNER,extra:Record<string,string>={}){return handleSmsApi(new Request(ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{...auth(user),...(body===undefined?{}:{'content-type':'application/json',origin:ORIGIN}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);}
 let sid=0;
 async function sms(body:string,overrides:Record<string,string>={},background?:(promise:Promise<unknown>)=>void){const params=new URLSearchParams({AccountSid:ACCOUNT,To:env.TWILIO_PHONE_NUMBER!,From:PHONE,Body:body,MessageSid:'SM'+(++sid).toString(16).padStart(32,'0'),NumMedia:'0',...overrides});const signature=createHmac('sha1',TOKEN).update(env.TWILIO_WEBHOOK_URL!+[...params.keys()].sort().map(k=>k+params.get(k)!).join('')).digest('base64');return handleSmsApi(new Request(env.TWILIO_WEBHOOK_URL!,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:params.toString()}),env,background);}
 async function mcp(name:string,args:Record<string,unknown>={},user:string|null=OWNER){const response=await handleBusinessMcp(new Request(ORIGIN+'/mcp',{method:'POST',headers:{...auth(user),'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'test',method:'tools/call',params:{name,arguments:args}})}),env);const rpc=await response.json() as any;return {response,rpc,value:JSON.parse(rpc.result.content[0].text),error:rpc.result.isError};}
 async function create(action:string,body:Record<string,unknown>){const r=await api('/api/sms/admin',{action,...body});assert.equal(r.status,201,await r.clone().text());return (await r.json() as any).id as string;}
 async function mapping(phone=PHONE,suffix=''){const organizationId=await create('organization',{name:'Synthetic Org'+suffix});const programId=await create('program',{organizationId,name:'CEO'+suffix});const teacherId=await create('teacher',{phone,name:'Teacher'+suffix,programId});return {organizationId,programId,teacherId,phone};}
 async function grant(m:{organizationId:string;phone:string},kind:'manager-grant'|'agent-grant'='manager-grant',active=true){const response=await api('/api/sms/business-admin',{action:kind,organizationId:m.organizationId,...(kind==='manager-grant'?{phone:m.phone}:{}),active});assert.equal(response.status,200,await response.clone().text());return response.json() as Promise<any>;}
 async function setup(){const m=await mapping();await grant(m);await grant(m,'agent-grant');return m;}
 async function queue(text='Add a program at prison A for the CEO class'){assert.equal((await sms(text)).status,200);return sqlite.prepare('SELECT * FROM business_requests ORDER BY rowid DESC LIMIT 1').get() as any;}
 function command(m:{organizationId:string;programId:string},overrides:Record<string,unknown>={}){return {type:'course.create',course:{id:crypto.randomUUID(),revision:0,organizationId:m.organizationId,programId:m.programId,status:'planned',facility:'Prison A (simulation)',participants:null,courseHoursPerParticipant:null,...overrides}};}
 async function propose(requestId:string,cmd:unknown,key='stable'){return mcp('business_propose_course',{requestId,idempotencyKey:key,command:cmd});}
 return {sqlite,env,api,sms,mcp,mapping,grant,setup,queue,command,propose,setBeforeExecute(fn:()=>void){beforeExecute=fn;}};
}


const CALLBACK_ORIGIN='https://events.chatgpt.com'; // Synthetic, never contacted; fetch is injected in every delivery test.
const CALLBACK=CALLBACK_ORIGIN+'/synthetic-callback?private=not-for-logs';
const SECRET='whsec_'+Buffer.alloc(32,7).toString('base64');
const NEXT_SECRET='whsec_'+Buffer.alloc(32,8).toString('base64');
function transport(){
 const calls:{url:string;init:RequestInit;body:any}[]=[];let eventStatus=200;let wrongChallenge=false;let onFetch:(()=>void)|undefined;
 const fetcher=(async(url:any,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));calls.push({url:String(url),init:init!,body});onFetch?.();return body.type==='verification'?Response.json({challenge:wrongChallenge?'wrong':body.challenge}):new Response(null,{status:eventStatus});}) as typeof fetch;
 return {calls,fetcher,setStatus(value:number){eventStatus=value;},setWrong(value:boolean){wrongChallenge=value;},setOnFetch(fn:()=>void){onFetch=fn;}};
}
async function eventRpc(f:ReturnType<typeof fixture>,method:string,params:unknown={},user:string|null=OWNER,fetcher=transport().fetcher,now?:()=>number){
 const r=await handleBusinessMcp(new Request(ORIGIN+'/mcp',{method:'POST',headers:{'content-type':'application/json',...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env,{fetcher,now});return r.json() as Promise<any>;
}
const input=(organizationId:string,extra:Record<string,unknown>={})=>({name:BUSINESS_REQUEST_EVENT,arguments:{organizationId},delivery:{mode:'webhook',url:CALLBACK,secret:SECRET},...extra});
async function subscription(f:ReturnType<typeof fixture>,m:{organizationId:string},t=transport(),now?:()=>number){f.env.MCP_EVENTS_CALLBACK_ORIGIN=CALLBACK_ORIGIN;const rpc=await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher,now);assert.ok(!rpc.error,JSON.stringify(rpc));return {id:rpc.result.id,t,rpc};}
function outbox(f:ReturnType<typeof fixture>){return f.sqlite.prepare('SELECT * FROM business_event_outbox ORDER BY created_at,id').all() as any[];}

test('events discovery is protocol-native, authenticated, scoped and independent of callback configuration',async()=>{
 const f=fixture();try{const m=await f.setup();const catalog=await eventRpc(f,'events/list');assert.equal(catalog.result.events[0].name,BUSINESS_REQUEST_EVENT);assert.deepEqual(catalog.result.events[0].inputSchema.properties.organizationId.enum,[m.organizationId]);assert.deepEqual(catalog.result.events[0].payloadSchema.required,['requestId','organizationId']);for(const user of [null,VIEWER])assert.ok((await eventRpc(f,'events/list',{},user)).error);const denied=await eventRpc(f,'events/subscribe',input(crypto.randomUUID()));assert.equal(denied.error.code,-32001);assert.equal((await eventRpc(f,'events/subscribe',input(m.organizationId,{cursor:'old'}))).error.code,-32602);
 }finally{f.sqlite.close();}
});
test('unconfigured or mismatched callback origin fails closed without sending traffic, saving secrets or exposing paths',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();const rpc=await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher);assert.equal(rpc.error.code,-32015);assert.equal(rpc.error.data.candidateOrigin,CALLBACK_ORIGIN);assert.doesNotMatch(JSON.stringify(rpc),/private=|synthetic-callback|whsec_/);assert.equal(t.calls.length,0);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_event_subscriptions').get() as any).n,0);f.env.MCP_EVENTS_CALLBACK_ORIGIN='https://another.chatgpt.com';assert.ok((await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher)).error);assert.equal(t.calls.length,0);
 }finally{f.sqlite.close();}
});
test('callback challenge is signed, redirect-blocked and required before any subscription becomes active',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();f.env.MCP_EVENTS_CALLBACK_ORIGIN=CALLBACK_ORIGIN;t.setWrong(true);assert.equal((await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher)).error.data.reason,'challenge_failed');assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_event_subscriptions').get() as any).n,0);t.setWrong(false);const s=await subscription(f,m,t);const call=t.calls.at(-1)!;assert.equal(call.init.redirect,'manual');assert.deepEqual(Object.keys(call.body).sort(),['challenge','type']);const headers=new Headers(call.init.headers);assert.equal(headers.get('X-MCP-Subscription-Id'),s.id);assert.equal(headers.get('webhook-signature'),await signEventBody(SECRET,headers.get('webhook-id')!,Number(headers.get('webhook-timestamp')),String(call.init.body)));assert.doesNotMatch(JSON.stringify(s.rpc),/whsec_|private=|secret/);
 }finally{f.sqlite.close();}
});
test('subscription refresh is durable/idempotent, honors finite lifetime, rotates signatures and clears secrets on unsubscribe',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();let now=Date.now();const clock=()=>now;const s=await subscription(f,m,t,clock);const rpc=await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher,clock);assert.equal(rpc.result.id,s.id);assert.equal(t.calls.length,1,'verified destination cache avoids duplicate challenges');const original=f.sqlite.prepare('SELECT * FROM business_event_subscriptions').get() as any;now+=60000;const rotation=await eventRpc(f,'events/subscribe',input(m.organizationId,{delivery:{mode:'webhook',url:CALLBACK,secret:NEXT_SECRET},ttlMs:120000}),OWNER,t.fetcher,clock);assert.equal(rotation.result.id,s.id);assert.equal(Date.parse(rotation.result.refreshBefore)-now,120000);const row=f.sqlite.prepare('SELECT * FROM business_event_subscriptions').get() as any;assert.equal(row.secret,NEXT_SECRET);assert.equal(row.previous_secret,SECRET);assert.equal(row.created_at,original.created_at);
 const q=await f.queue();await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:t.fetcher,now:clock,sleep:async()=>{}});const event=t.calls.at(-1)!;assert.equal(new Headers(event.init.headers).get('webhook-signature')!.split(' ').length,2);assert.equal(outbox(f)[0].status,'delivered');
 const stop={name:BUSINESS_REQUEST_EVENT,arguments:{organizationId:m.organizationId},delivery:{mode:'webhook',url:CALLBACK}};assert.deepEqual((await eventRpc(f,'events/unsubscribe',stop,OWNER,t.fetcher,clock)).result,{resultType:'complete'});assert.deepEqual((await eventRpc(f,'events/unsubscribe',stop,OWNER,t.fetcher,clock)).result,{resultType:'complete'});const stopped=f.sqlite.prepare('SELECT * FROM business_event_subscriptions').get() as any;assert.equal(stopped.active,0);assert.equal(stopped.secret,null);assert.equal(stopped.previous_secret,null);
 }finally{f.sqlite.close();}
});
test('new leader SMS creates one canonical outbox event; duplicates, attendance, course changes and old imports emit none',async()=>{
 const f=fixture();try{const m=await f.setup();await f.sms('Old before subscription');const old=f.sqlite.prepare('SELECT * FROM sms_records').get() as any;const s=await subscription(f,m);assert.equal(outbox(f).length,0);const MessageSid='SM'+'f'.repeat(32);await Promise.all(Array.from({length:6},()=>f.sms('New leader request',{MessageSid})));assert.equal(outbox(f).length,1);const q=f.sqlite.prepare('SELECT * FROM business_requests WHERE receipt_id<>?').get(old.id) as any;
 await f.sms('4 1');await f.sms('1');await f.api('/api/sms/summaries',{id:crypto.randomUUID(),revision:0,organizationId:m.organizationId,programId:m.programId,status:'planned'});assert.equal(outbox(f).length,1);
 await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:s.t.fetcher,sleep:async()=>{}});assert.equal(outbox(f)[0].status,'delivered');const event=s.t.calls.at(-1)!.body;assert.deepEqual(event.data,{requestId:q.id,organizationId:m.organizationId});assert.equal(event.eventId,'evt_'+q.id);assert.equal(event.cursor,null);assert.doesNotMatch(JSON.stringify(event),/New leader|12025550101|message_sid|Body|instruction/);
 await Promise.all(Array.from({length:5},()=>deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:s.t.fetcher,sleep:async()=>{}})));assert.equal(s.t.calls.filter(c=>c.body.eventId).length,1);
 }finally{f.sqlite.close();}
});
test('explicit historical import after subscription stays silent and has no outbox record',async()=>{
 const f=fixture();try{const m=await f.mapping();await f.sms('Old historical request');const old=f.sqlite.prepare('SELECT * FROM sms_records').get() as any;await f.grant(m);await f.grant(m,'agent-grant');await subscription(f,m);assert.equal((await f.api('/api/sms/business-admin',{action:'import-request',recordId:old.id,organizationId:m.organizationId,reason:'Authorized explicit import'})).status,200);assert.equal(outbox(f).length,0);
 }finally{f.sqlite.close();}
});
test('transient deliveries retry at most three times with identical IDs/body and fresh signatures; permanent failures stop',async()=>{
 for(const status of [503,429,410,413,302]){const f=fixture();try{const m=await f.setup(),s=await subscription(f,m);const q=await f.queue();s.t.setStatus(status);let now=Date.now();const sleeps:number[]=[];await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:s.t.fetcher,now:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;}});const calls=s.t.calls.filter(c=>c.body.eventId);assert.equal(calls.length,[503,429].includes(status)?3:1);assert.equal(outbox(f)[0].status,'failed');assert.equal(outbox(f)[0].attempts,calls.length);assert.ok(calls.every(c=>c.init.body===calls[0].init.body));if(calls.length>1){assert.deepEqual(sleeps,[1000,2000]);assert.notEqual(new Headers(calls[0].init.headers).get('webhook-signature'),new Headers(calls[1].init.headers).get('webhook-signature'));}assert.equal((f.sqlite.prepare("SELECT COUNT(*) n FROM business_audit WHERE action='events.failed'").get() as any).n,1);
 }finally{f.sqlite.close();}}
});
test('revocation and expiry suppress queued deliveries; re-enable never resurrects an old event',async()=>{
 for(const kind of ['agent-grant','manager-grant','expired'] as const){const f=fixture();try{const m=await f.setup(),s=await subscription(f,m);const q=await f.queue();if(kind!=='expired')await f.grant(m,kind,false);await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:s.t.fetcher,now:()=>Date.now()+(kind==='expired'?2*86400000:0),sleep:async()=>{}});assert.equal(s.t.calls.filter(c=>c.body.eventId).length,0);assert.equal(outbox(f)[0].status,'stopped');if(kind!=='expired'){await f.grant(m,kind,true);await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:s.t.fetcher,sleep:async()=>{}});assert.equal(s.t.calls.filter(c=>c.body.eventId).length,0);}
 }finally{f.sqlite.close();}}
});
test('revocation during verification prevents activation and audit/queue failures preserve atomicity',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();f.env.MCP_EVENTS_CALLBACK_ORIGIN=CALLBACK_ORIGIN;t.setOnFetch(()=>f.sqlite.prepare('UPDATE business_agent_grants SET active=0,revision=revision+1,updated_at=?').run(new Date().toISOString()));assert.ok((await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher)).error);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_event_subscriptions').get() as any).n,0);await f.grant(m,'agent-grant',true);t.setOnFetch(()=>{});await subscription(f,m,t);f.sqlite.exec("CREATE TRIGGER fail_event_outbox BEFORE INSERT ON business_event_outbox BEGIN SELECT RAISE(ABORT,'synthetic');END;");assert.equal((await f.sms('New request')).status,500);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_requests').get() as any).n,0);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM sms_records').get() as any).n,0);
 }finally{f.sqlite.close();}
});
test('event credentials never reach admin DTOs, tools or audit details',async()=>{
 const f=fixture();try{const m=await f.setup();await subscription(f,m);const admin=await(await f.api('/api/sms/business-admin')).json();const tools=(await f.mcp('business_list_requests')).value;const audit=f.sqlite.prepare('SELECT * FROM business_audit').all();assert.doesNotMatch(JSON.stringify({admin,tools,audit}),/whsec_|synthetic-callback|private=|previous_secret|callback_url/);
 }finally{f.sqlite.close();}
});


test('concurrent subscription retries share identity and concurrent dispatch claims a delivery only once',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();f.env.MCP_EVENTS_CALLBACK_ORIGIN=CALLBACK_ORIGIN;const subs=await Promise.all(Array.from({length:6},()=>eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher)));assert.ok(subs.every(r=>r.result?.id),JSON.stringify(subs));assert.equal(new Set(subs.map(r=>r.result.id)).size,1);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_event_subscriptions').get() as any).n,1);const q=await f.queue();await Promise.all(Array.from({length:6},()=>deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:t.fetcher,sleep:async()=>{}})));assert.equal(t.calls.filter(c=>c.body.eventId).length,1);assert.equal(outbox(f)[0].status,'delivered');
 }finally{f.sqlite.close();}
});
test('expired delivery leases can resume on provider retry without a new event or extra attempt budget',async()=>{
 const f=fixture();try{const m=await f.setup(),s=await subscription(f,m);const q=await f.queue();const r=f.sqlite.prepare('SELECT * FROM sms_records WHERE id=?').get(q.receipt_id) as any;const event=outbox(f)[0];f.sqlite.prepare("UPDATE business_event_outbox SET status='delivering',attempts=1,lease_token='interrupted',lease_until=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),event.id);await deliverBusinessEventsForSid(f.env.DB!,f.env,r.message_sid,{fetcher:s.t.fetcher,sleep:async()=>{}});assert.equal(outbox(f).length,1);assert.equal(outbox(f)[0].event_id,event.event_id);assert.equal(outbox(f)[0].attempts,2);assert.equal(outbox(f)[0].status,'delivered');
 }finally{f.sqlite.close();}
});
test('teacher numeric and exact 1 never schedule an event task; callback outage cannot block their accounting',async()=>{
 const f=fixture();try{const m=await f.setup();await subscription(f,m);const tasks:Promise<unknown>[]=[];await f.sms('5 1',{},task=>tasks.push(task));await f.sms('1',{},task=>tasks.push(task));assert.equal(tasks.length,0);assert.equal(outbox(f).length,0);assert.equal((f.sqlite.prepare("SELECT COUNT(*) n FROM sms_records WHERE status='counted'").get() as any).n,1);
 }finally{f.sqlite.close();}
});
test('verification cache expires from actual verification time; changed origin cannot receive an existing delivery',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();let now=Date.now();await subscription(f,m,t,()=>now);now+=4*60000;await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher,()=>now);assert.equal(t.calls.length,1);now+=2*60000;await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher,()=>now);assert.equal(t.calls.length,2);const q=await f.queue();f.env.MCP_EVENTS_CALLBACK_ORIGIN='https://another.chatgpt.com';await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:t.fetcher,now:()=>now,sleep:async()=>{}});assert.equal(t.calls.filter(c=>c.body.eventId).length,0);assert.equal(outbox(f)[0].status,'stopped');
 }finally{f.sqlite.close();}
});


test('renewing an expired subscription never replays an old pending event into the renewed lifetime',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();let now=Date.now();f.env.MCP_EVENTS_CALLBACK_ORIGIN=CALLBACK_ORIGIN;const first=await eventRpc(f,'events/subscribe',input(m.organizationId,{ttlMs:60000}),OWNER,t.fetcher,()=>now);assert.ok(first.result);const q=await f.queue();assert.equal(outbox(f)[0].status,'pending');now+=120000;const renewed=await eventRpc(f,'events/subscribe',input(m.organizationId,{ttlMs:60000}),OWNER,t.fetcher,()=>now);assert.equal(renewed.result.id,first.result.id);assert.equal(outbox(f)[0].status,'stopped');await deliverBusinessEvents(f.env.DB!,f.env,q.receipt_id,{fetcher:t.fetcher,now:()=>now,sleep:async()=>{}});assert.equal(t.calls.filter(c=>c.body.eventId).length,0);
 }finally{f.sqlite.close();}
});
test('expired-active subscription refresh cannot bypass the ten-current-subscription limit',async()=>{
 const f=fixture();try{const m=await f.setup(),t=transport();let now=Date.now();f.env.MCP_EVENTS_CALLBACK_ORIGIN=CALLBACK_ORIGIN;const first=await eventRpc(f,'events/subscribe',input(m.organizationId,{ttlMs:60000}),OWNER,t.fetcher,()=>now);assert.ok(first.result);now+=120000;for(let i=0;i<10;i++){const rpc=await eventRpc(f,'events/subscribe',input(m.organizationId,{delivery:{mode:'webhook',url:CALLBACK+'&new='+i,secret:SECRET}}),OWNER,t.fetcher,()=>now);assert.ok(rpc.result,JSON.stringify(rpc));}const blocked=await eventRpc(f,'events/subscribe',input(m.organizationId),OWNER,t.fetcher,()=>now);assert.ok(blocked.error);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_event_subscriptions WHERE active=1 AND expires_at>?').get(new Date(now).toISOString()) as any).n,10);
 }finally{f.sqlite.close();}
});


test('malformed numeric attendance remains quarantined rather than becoming an assistant event',async()=>{
 const f=fixture();try{const m=await f.setup();await subscription(f,m);for(const body of ['20 25','2','20 0','10001 2','20,4','1e2 2','-1 2'])assert.equal((await f.sms(body)).status,200);assert.equal((f.sqlite.prepare('SELECT COUNT(*) n FROM business_requests').get() as any).n,0);assert.equal(outbox(f).length,0);assert.equal((f.sqlite.prepare("SELECT COUNT(*) n FROM sms_records WHERE status='quarantined'").get() as any).n,7);const record=f.sqlite.prepare('SELECT * FROM sms_records LIMIT 1').get() as any;assert.equal((await f.api('/api/sms/business-admin',{action:'import-request',recordId:record.id,organizationId:m.organizationId,reason:'Must remain attendance'})).status,409);
 }finally{f.sqlite.close();}
});
