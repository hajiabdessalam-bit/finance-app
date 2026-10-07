import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supabaseAdapter} from '../server/supabase-adapter.mjs';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
const jwt=(changes={})=>'e30.'+Buffer.from(JSON.stringify({sub:owner,iss:config.url+'/auth/v1',role:'authenticated',is_anonymous:false,session_id:'33333333-3333-4333-8333-333333333333',exp:Math.floor(Date.now()/1000)+3600,...changes})).toString('base64url')+'.c3ludGhldGlj';
const owner='11111111-1111-4111-8111-111111111111',config={url:'https://synthetic-project.supabase.co',publishableKey:'sb_publishable_SYNTHETIC',secretKey:'sb_secret_SYNTHETIC'};

test('private identity requires the authenticated token and an uncached owned active session',async()=>{
 const calls=[];let active=true,time=Date.now();
 const adapter=supabaseAdapter({...config,now:()=>time,fetchImpl:async(url,options)=>{
  calls.push({url,options});return Response.json(url.includes('/auth/')?{id:owner,is_anonymous:false}:active);
 }});
 const token=jwt();assert.deepEqual(await adapter.verifySession(token),{id:owner,is_anonymous:false});
 assert.deepEqual(JSON.parse(calls[1].options.body),{p_owner:owner,p_session:'33333333-3333-4333-8333-333333333333'});
 assert.equal(calls[1].options.headers.Authorization,undefined);
 active=false;assert.equal(await adapter.verifySession(token),null);assert.equal(calls.length,4);
 for(const changes of [{sub:crypto.randomUUID()},{session_id:'bad'},{session_id:null},{exp:0},{exp:1.5},{iss:'https://other.supabase.co/auth/v1'},{is_anonymous:true},{role:'service_role'}]){
  const before=calls.length;assert.equal(await adapter.verifySession(jwt(changes)),null);assert.equal(calls.length,before+1);
 }
 const before=calls.length;assert.equal(await adapter.verifySession('malformed'),null);assert.equal(calls.length,before+1);
 active={active:true};assert.equal(await adapter.verifySession(token),null);
 active=true;const exp=Math.floor(time/1000)+2;
 const expiring=supabaseAdapter({...config,now:()=>time,fetchImpl:async url=>{if(!url.includes('/auth/'))time=exp*1000;return Response.json(url.includes('/auth/')?{id:owner,is_anonymous:false}:true);}});
 assert.equal(await expiring.verifySession(jwt({exp})),null);
 const denied=supabaseAdapter({...config,fetchImpl:async()=>new Response('denied',{status:401})});assert.equal(await denied.verifySession(token),null);
 const unavailable=supabaseAdapter({...config,fetchImpl:async url=>url.includes('/auth/')?Response.json({id:owner,is_anonymous:false}):new Response('private error',{status:500})});
 await assert.rejects(unavailable.verifySession(token),/could not confirm/);
});

test('malformed UTF-8 cannot silently rewrite financial text in a database response',async()=>{
 const start=new TextEncoder().encode('{"name":"'),end=new TextEncoder().encode('"}'),bytes=new Uint8Array(start.length+1+end.length);bytes.set(start);bytes[start.length]=255;bytes.set(end,start.length+1);
 const adapter=supabaseAdapter({...config,fetchImpl:async()=>new Response(bytes)});await assert.rejects(adapter.store.read(owner,'w'),/could not confirm/);
});

test('private request deadlines cover stalled fetch and body and cancel late responses without retries',async()=>{
 let calls=0,cancelled=0,signal,resolve;
 const stalled=supabaseAdapter({...config,timeoutMs:5,fetchImpl:async(_url,options)=>{calls++;signal=options.signal;return new Promise(done=>{resolve=done;});}});
 await assert.rejects(stalled.store.read(owner,'w'),/No edit has been acknowledged/);assert.equal(signal.aborted,true);assert.equal(calls,1);
 resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(done=>setTimeout(done,0));assert.equal(cancelled,1);
 const slow=supabaseAdapter({...config,timeoutMs:5,fetchImpl:async()=>{calls++;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled++;}}));}});
 await assert.rejects(slow.store.read(owner,'w'),/could not confirm/);assert.equal(cancelled,2);assert.equal(calls,2);
 for(const timeoutMs of [0,15001,1.5])assert.throws(()=>supabaseAdapter({...config,timeoutMs}),/deadline/);
});

test('private conversation adapter bounds final text and page cursors, never authenticates with its server key as a bearer',async()=>{
 const calls=[],adapter=supabaseAdapter({...config,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({status:'saved'});}}),requestId=crypto.randomUUID(),input={owner,requestId,workspace:'w',question:'Synthetic 中文',answer:'Final answer'};
 assert.equal(calls.length,0);await adapter.conversations.save(input);await adapter.conversations.read({owner,workspace:'w',before:requestId,limit:10});
 assert.deepEqual(JSON.parse(calls[0].options.body),{p_owner:owner,p_request:requestId,p_workspace:'w',p_question:input.question,p_answer:input.answer});assert.deepEqual(JSON.parse(calls[1].options.body),{p_owner:owner,p_workspace:'w',p_before:requestId,p_limit:10});
 for(const call of calls){assert.equal(call.options.headers.apikey,config.secretKey);assert.equal(call.options.headers.Authorization,undefined);}
 assert.throws(()=>adapter.conversations.save({...input,question:'中'.repeat(6667)}),/bounded final answer/);assert.throws(()=>adapter.conversations.save({...input,answer:'x'.repeat(100001)}),/bounded final answer/);assert.throws(()=>adapter.conversations.read({owner,workspace:'w',limit:51}),/bounded/);assert.throws(()=>adapter.conversations.read({owner,workspace:'w',before:'not-a-cursor'}),/bounded/);assert.equal(calls.length,2);
});
test('identity uses the publishable key and user JWT, while private RPCs use only the secret API key',async()=>{const calls=[],adapter=supabaseAdapter({...config,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/auth/')?{id:owner,is_anonymous:false,email:'not-retained@example.test'}:url.endsWith('/plan_session_active')?true:{workspace:'synthetic'});}});assert.deepEqual(await adapter.verifySession(jwt()),{id:owner,is_anonymous:false});await adapter.store.read(owner,'synthetic');assert.equal(calls[0].options.headers.apikey,config.publishableKey);assert.equal(calls[0].options.headers.Authorization,'Bearer '+jwt());assert.equal(calls[2].options.headers.apikey,config.secretKey);assert.equal(Object.hasOwn(calls[2].options.headers,'Authorization'),false);assert.equal(calls[2].options.redirect,'error');assert.deepEqual(JSON.parse(calls[2].options.body),{p_owner:owner,p_workspace:'synthetic'});});
test('invalid endpoints or misplaced keys cannot send credentials',()=>{let calls=0;const fetchImpl=()=>{calls++;};for(const url of ['http://synthetic-project.supabase.co','https://evil.example','https://user:pass@synthetic-project.supabase.co','https://synthetic-project.supabase.co/redirect'])assert.throws(()=>supabaseAdapter({...config,url,fetchImpl}),/endpoint/);assert.throws(()=>supabaseAdapter({...config,secretKey:config.publishableKey,fetchImpl}),/keys/);assert.equal(calls,0);});
test('unverified auth and anonymous users never become permanent actors',async()=>{for(const response of [Response.json({id:owner,is_anonymous:true}),Response.json({id:owner}),new Response('denied',{status:401})]){const adapter=supabaseAdapter({...config,fetchImpl:async()=>response});assert.equal(await adapter.verifySession(jwt()),null);}});
test('network and database errors never echo credentials or raw server errors',async()=>{const adapter=supabaseAdapter({...config,fetchImpl:async()=>{throw new Error(config.secretKey+' private diagnostics');}});await assert.rejects(adapter.store.read(owner,'synthetic'),error=>error.message.includes('No edit')&&!error.message.includes(config.secretKey)&&!error.message.includes('diagnostics'));});
test('budget RPCs retain exact consent context and keep privileged credentials server-side',async()=>{const calls=[],adapter=supabaseAdapter({...config,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({status:'reserved'});}}),requestId=crypto.randomUUID(),hash='a'.repeat(64);await adapter.ledger.reserve({owner,requestId,reservedMicroUsd:100,configurationHash:hash,workspaceDigest:hash,summaryDigest:hash,promptDigest:hash});await adapter.ledger.settle({owner,requestId,status:'uncertain',chargedMicroUsd:null});assert.ok(calls[0].url.endsWith('/plan_ai_reserve'));assert.deepEqual(JSON.parse(calls[0].options.body),{p_owner:owner,p_id:requestId,p_amount:100,p_configuration_hash:hash,p_workspace_digest:hash,p_summary_digest:hash,p_prompt_digest:hash});assert.deepEqual(JSON.parse(calls[1].options.body),{p_owner:owner,p_id:requestId,p_status:'uncertain',p_charged:null});for(const call of calls){assert.equal(call.options.headers.apikey,config.secretKey);assert.equal(call.options.headers.Authorization,undefined);}});
test('first-upload RPC uses only the private key and rechecks the complete reviewed payload',async()=>{
 const calls=[],adapter=supabaseAdapter({...config,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({status:'initialized',version:1});}}),state=C.fresh(),records=S.entities(state),command={workspace:state.id,requestId:C.uid(),records,payloadDigest:await C.digest(S.canonicalJson(records))};
 await adapter.store.bootstrap(owner,command);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/plan_bootstrap_validated_workspace'));assert.equal(calls[0].options.headers.apikey,config.secretKey);assert.equal(calls[0].options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(calls[0].options.body),{p_owner:owner,p_workspace:state.id,p_request:command.requestId,p_digest:command.payloadDigest,p_records:records});
 await assert.rejects(adapter.store.bootstrap(owner,{...command,payloadDigest:'a'.repeat(64)}),/changed/);assert.equal(calls.length,1);
});

test('account admission uses only server credentials and a verified owner without a client clock or limit',async()=>{const calls=[],adapter=supabaseAdapter({...config,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({allowed:true,retryAfterSeconds:0});}});assert.deepEqual(await adapter.admit({owner}),{allowed:true,retryAfterSeconds:0});assert.ok(calls[0].url.endsWith('/plan_sync_admit'));assert.equal(calls[0].options.headers.apikey,config.secretKey);assert.equal(calls[0].options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(calls[0].options.body),{p_owner:owner});assert.throws(()=>adapter.admit({owner:'invalid'}),/verified actor/);assert.equal(calls.length,1);});
