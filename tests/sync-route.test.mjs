import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import {configuredSyncRoute} from '../server/sync-route.mjs';
const origin='https://plan.example.test',url='https://synthetic.supabase.co',owner='11111111-1111-4111-8111-111111111111';
const env={PLAN_PRIVATE_SYNC_ENABLED:'true',PLAN_PRIVATE_DATABASE_VERIFIED:'true',PLAN_APP_ORIGIN:origin,PLAN_SUPABASE_URL:url,PLAN_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',PLAN_SUPABASE_SECRET_KEY:'sb_secret_synthetic'};
const token='e30.'+Buffer.from(JSON.stringify({sub:owner,iss:url+'/auth/v1',role:'authenticated',is_anonymous:false,session_id:'33333333-3333-4333-8333-333333333333',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.c3ludGhldGlj';
const req=(body,headers={})=>new Request(origin+'/api/plan/sync',{method:'POST',headers:{origin,authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(body)});
test('deployment route stays closed without explicit database readiness and valid private runtime configuration',async()=>{
  let calls=0;for(const config of [{},{...env,PLAN_PRIVATE_SYNC_ENABLED:'false'},{...env,PLAN_PRIVATE_DATABASE_VERIFIED:'false'},{...env,PLAN_SUPABASE_SECRET_KEY:''},{...env,PLAN_APP_ORIGIN:'*'},{...env,PLAN_SUPABASE_URL:'https://attacker.test'}]){
    const handler=configuredSyncRoute({env:config,fetchImpl:async()=>{calls++;throw new Error('Should not connect');}});const response=await handler(req({action:'read',workspace:'w'}));assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store, private');assert.deepEqual(await response.json(),{error:'private_sync_not_configured'});
  }assert.equal(calls,0);
});
test('configured route performs verified identity, durable admission and private read in order; no secrets enter responses',async()=>{
  const state=C.fresh();state.version=1;const snapshot={workspace:state.id,version:1,records:S.entities(state).map(r=>({...r,version:1})),operations:[]},calls=[];
  const handler=configuredSyncRoute({env,fetchImpl:async(endpoint,options)=>{calls.push({endpoint,options});if(endpoint.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:false});if(endpoint.endsWith('/plan_session_active'))return Response.json(true);if(endpoint.endsWith('/plan_sync_admit'))return Response.json({allowed:true});if(endpoint.endsWith('/plan_read_validated_workspace'))return Response.json(snapshot);throw new Error('Unexpected call');}});
  assert.equal(calls.length,0);const response=await handler(req({action:'read',workspace:state.id}));assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes('sb_secret'),false);assert.equal(JSON.parse(text).result.workspace,state.id);
  assert.deepEqual(calls.map(c=>new URL(c.endpoint).pathname),['/auth/v1/user','/rest/v1/rpc/plan_session_active','/rest/v1/rpc/plan_sync_admit','/auth/v1/user','/rest/v1/rpc/plan_session_active','/rest/v1/rpc/plan_read_validated_workspace']);assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);assert.equal(calls[0].options.headers.apikey,env.PLAN_SUPABASE_PUBLISHABLE_KEY);
  for(const call of calls.filter(c=>!c.endpoint.endsWith('/auth/v1/user'))){assert.equal(call.options.headers.apikey,env.PLAN_SUPABASE_SECRET_KEY);assert.equal(call.options.headers.Authorization,undefined);assert.equal(JSON.parse(call.options.body).p_owner,owner);}
});
test('configured route rejects foreign origins before verification and missing admission cannot read finance records',async()=>{
  const calls=[];const handler=configuredSyncRoute({env,fetchImpl:async endpoint=>{calls.push(endpoint);return endpoint.endsWith('/auth/v1/user')?Response.json({id:owner,is_anonymous:false}):endpoint.endsWith('/plan_session_active')?Response.json(true):Response.json({allowed:false,retryAfterSeconds:30});}});
  assert.equal((await handler(req({action:'read',workspace:'w'},{origin:'https://other.test'}))).status,403);assert.equal(calls.length,0);
  const denied=await handler(req({action:'read',workspace:'w'}));assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'30');assert.equal(calls.length,3);
});

test('logout rejects a still unexpired authenticated token before finance admission or reads',async()=>{
 let active=true;const calls=[];
 const handler=configuredSyncRoute({env,fetchImpl:async endpoint=>{
  calls.push(endpoint);if(endpoint.endsWith('/auth/v1/user'))return Response.json({id:owner,is_anonymous:false});
  if(endpoint.endsWith('/plan_session_active'))return Response.json(active);
  if(endpoint.endsWith('/plan_sync_admit'))return Response.json({allowed:false,retryAfterSeconds:30});
  throw new Error('No financial access permitted');
 }});
 assert.equal((await handler(req({action:'read',workspace:'w'}))).status,429);
 active=false;calls.length=0;
 const response=await handler(req({action:'read',workspace:'w'}));assert.equal(response.status,401);
 assert.deepEqual(await response.json(),{error:'sign_in_required'});assert.equal(calls.length,2);
 assert.equal(calls.some(c=>c.endsWith('/plan_sync_admit')||c.endsWith('/plan_read_validated_workspace')),false);
});
