import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import * as D from '../app/storage.mjs';
import {privateCloud} from '../frontend/private-cloud.mjs';
import {createSyncHttpHandler} from '../server/sync-http.mjs';
const origin='https://plan.example.test',projectUrl='https://synthetic-plan.supabase.co',owner='11111111-1111-4111-8111-111111111111';
const user={id:owner,is_anonymous:false,email_confirmed_at:'2026-10-07T00:00:00Z',email:'sample@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-10-07T00:00:00Z'};
const note=s=>C.mutate(s,'note-add',{},n=>n.notes.push({id:C.uid(),title:'Synthetic',body:'中文 العربية',items:[]}));
async function fixture(run){
  const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();
  try{let cloud=C.fresh();cloud.version=7;const operations=[],calls=[];await D.saveStore(db,cloud,0);
    const snapshot=()=>({workspace:cloud.id,version:cloud.version,records:S.entities(cloud).map(r=>({...r,version:cloud.version})),operations:C.clone(operations)});
    const handler=createSyncHttpHandler({origin,verifySession:async token=>{assert.equal(token,'synthetic-token');return user;},admit:async()=>({allowed:true}),store:{read:async actor=>{assert.equal(actor,owner);return snapshot();},apply:async(actor,request)=>{assert.equal(actor,owner);cloud=S.applyPatches(cloud,request.patches);cloud.version++;operations.push({id:request.operationId,type:request.type,patches:request.patches});return {status:'applied',version:cloud.version};}}});
    const controller=privateCloud({db,origin,currentOrigin:origin,projectUrl,publishableKey:'sb_publishable_synthetic_test_key',verifiedConfiguration:true,fetchImpl:async(url,options)=>{
      if(String(url).startsWith(projectUrl+'/auth/v1/')){calls.push('auth');const body=String(url).includes('/token?')?{access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'bearer',user}:user;return Response.json(body);}
      assert.equal(url,origin+'/api/plan/sync');const command=JSON.parse(options.body);calls.push(command.action);return handler(new Request(url,{...options,headers:{...options.headers,origin}}));}});
    await run({db,controller,calls,snapshot});
  }finally{db.close();if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;}
}
test('verified sign-in, explicit cloud adoption and queue receipts connect through the actual SDK and HTTP boundary',()=>fixture(async f=>{
  assert.equal(f.calls.length,0);await assert.rejects(f.controller.compare(),/verified/);assert.equal(f.calls.length,0);
  assert.deepEqual(await f.controller.signIn({email:user.email,password:'synthetic-only'}),{id:owner});assert.ok(f.calls.every(c=>c==='auth'));
  const comparison=await f.controller.compare();assert.equal(comparison.actor,owner);assert.equal(comparison.kind,'comparison');
  await f.controller.adopt(comparison,{confirmed:true,reviewDigest:comparison.review.digest});const row=await D.loadStore(f.db),local=note(row.state);await D.saveStore(f.db,local,row.revision);
  const pending=await f.controller.previewPending(),before=f.calls.filter(c=>c!=='auth').length;assert.equal(before,2);
  assert.deepEqual(await f.controller.sendPending(pending,{confirmed:true,reviewDigest:pending.digest}),{revision:4,acknowledged:1,automaticReplay:false});
  assert.deepEqual(f.calls.filter(c=>c!=='auth'),['read','read','read','apply']);assert.equal((await D.loadSyncContext(f.db)).queue.length,0);assert.equal(f.snapshot().version,8);assert.deepEqual((await D.loadStore(f.db)).state.notes,local.notes);
  await f.controller.signOut();await assert.rejects(f.controller.previewPending(),/verified/);assert.deepEqual((await D.loadStore(f.db)).state.notes,local.notes);
}));
test('unverified configuration and altered account-bound comparisons cannot initialize or replace records',()=>fixture(async f=>{
  assert.throws(()=>privateCloud({}),/access-control verification/);await f.controller.signIn({email:user.email,password:'synthetic-only'});const review=await f.controller.compare(),row=await D.loadStore(f.db);
  await assert.rejects(f.controller.adopt({...review,actor:'22222222-2222-4222-8222-222222222222'},{confirmed:true,reviewDigest:review.review.digest}),/current signed-in account/);
  assert.deepEqual(await D.loadStore(f.db),row);assert.equal(typeof f.controller.bootstrap,'undefined');assert.ok(!f.calls.includes('apply'));
}));

test('an empty new device discovers and adopts the owned cloud workspace without uploading',async()=>{const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();try{const {privateCloudReview}=await import('../frontend/cloud-review.mjs');const state=C.fresh();const snapshot={workspace:state.id,version:1,records:S.entities(state).map(r=>({...r,version:1})),operations:[]};const review=privateCloudReview({db,transport:{read:async id=>{assert.ok(id==='@latest'||id===state.id);return snapshot;}}});const result=await review.compare();assert.equal(result.newDevice,true);await review.adopt(result,{confirmed:true,reviewDigest:result.review.digest});assert.equal((await D.loadSyncContext(db)).baseline.workspace,state.id);}finally{db.close();globalThis.indexedDB=previous;}});

