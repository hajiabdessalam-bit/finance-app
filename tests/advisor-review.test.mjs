import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import * as D from '../app/storage.mjs';
import {privateAdvisorReview} from '../frontend/advisor-review.mjs';
import {privateAdvisorTransport} from '../frontend/advisor-transport.mjs';
import {createAdvisorHttpHandler} from '../server/advisor-http.mjs';
const origin='https://plan.example.test',owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
async function fixture(run){
 const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();
 try{
  let cloud=C.fresh(),actor=owner,generations=0,previewHook=null,askHook=null;cloud.version=3;
  const snapshot=()=>({workspace:cloud.id,version:cloud.version,records:S.entities(cloud).map(r=>({...r,version:cloud.version})),operations:[]});
  await D.saveStore(db,cloud,0);const adoption=await S.prepareRemoteReview(cloud,snapshot());await D.adoptReviewedRemote(db,adoption,{expectedRevision:1,reviewDigest:adoption.digest,confirmed:true});
  const paid=new Set(),calls=[],handler=await createAdvisorHttpHandler({origin,verifySession:async()=>({id:actor,is_anonymous:false}),admit:async()=>({allowed:true}),store:{read:async()=>snapshot()},
   configuration:{provider:'Synthetic API',model:'Synthetic model',supportedFinanceTraffic:true,priceCheckedAt:new Date().toISOString(),maxInputTokens:1000,maxOutputTokens:100,maxSteps:1,inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,fixedMicroUsdPerStep:0},
   ledger:{reserve:async input=>{if(paid.has(input.requestId))return {status:'duplicate'};paid.add(input.requestId);return {status:'reserved'};},settle:async()=>{}},conversations:{save:async()=>({status:'saved'}),read:async()=>({messages:[],nextCursor:null})},generate:async()=>{generations++;await askHook?.();return {result:{text:'Synthetic answer'},chargedMicroUsd:20};}});
  const transport=privateAdvisorTransport({origin,currentOrigin:origin,tokenProvider:async()=>'synthetic-token',fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body).action);const response=await handler(new Request(url,{...options,headers:{...options.headers,origin}}));if(calls.at(-1)==='preview')await previewHook?.();return response;}});
  const controller=privateAdvisorReview({db,transport,cloudReader:{read:async()=>{calls.push('read');return snapshot();}},sessionIdentity:async()=>actor});
  const edit=async()=>{const row=await D.loadStore(db),next=C.mutate(row.state,'note-add',{},state=>state.notes.push({id:C.uid(),title:'Retained local edit',body:'',items:[]}));await D.saveStore(db,next,row.revision);};
  await run({db,controller,calls,edit,paid,generations:()=>generations,setActor:id=>actor=id,setCloud:fn=>cloud=fn(cloud),onPreview:fn=>previewHook=fn,onAsk:fn=>askHook=fn});
 }finally{db.close();if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;}
}
test('device-bound review uses identical synced records and explicit confirmation through the real AI HTTP boundary',()=>fixture(async f=>{
 assert.equal(f.calls.length,0);const before=await D.loadSyncContext(f.db),review=await f.controller.preview('Explain my goals.');assert.deepEqual(f.calls,['read','preview']);assert.equal(f.generations(),0);
 await assert.rejects(f.controller.ask(review),/Explicitly confirm/);assert.equal(f.calls.length,2);
 const result=await f.controller.ask(review,{confirmed:true,reviewDigest:review.digest});assert.equal(result.result.text,'Synthetic answer');assert.equal(result.deviceChanged,false);assert.equal(f.generations(),1);
 assert.equal((await f.controller.ask(review,{confirmed:true,reviewDigest:review.digest})).result.status,'review');assert.equal(f.generations(),1);
 await f.controller.history();assert.equal(f.generations(),1);assert.deepEqual(await D.loadSyncContext(f.db),before);
}));
test('pending edits, changed cloud contents, changed identity and changed device review cannot admit paid questions',()=>fixture(async f=>{
 const review=await f.controller.preview('Question'),count=f.calls.length;
 await assert.rejects(f.controller.ask({...review,revision:99},{confirmed:true,reviewDigest:review.digest}),/review changed/);
 f.setActor(other);await assert.rejects(f.controller.ask(review,{confirmed:true,reviewDigest:review.digest}),/changed after review/);f.setActor(owner);assert.equal(f.calls.length,count);
 f.setCloud(state=>({...state,name:'Changed cloud owner label'}));await assert.rejects(f.controller.preview('Question'),/records differ/);assert.equal(f.generations(),0);
 await f.edit();const before=f.calls.length;await assert.rejects(f.controller.preview('Question'),/pending device edits/);await assert.rejects(f.controller.ask(review,{confirmed:true,reviewDigest:review.digest}),/pending device edits/);assert.equal(f.calls.length,before);assert.equal(f.paid.size,0);
 await f.controller.history();assert.equal(f.calls.at(-1),'history');assert.equal((await D.loadStore(f.db)).state.notes.length,1);
}));
test('local edit during preview rejects advice; edit during a paid answer retains its old context and never overwrites the edit',()=>fixture(async f=>{
 const review=await f.controller.preview('Question');f.onAsk(f.edit);
 const result=await f.controller.ask(review,{confirmed:true,reviewDigest:review.digest});assert.equal(result.deviceChanged,true);assert.equal(result.result.contextVersion,3);assert.equal(f.generations(),1);assert.equal((await D.loadStore(f.db)).state.notes[0].title,'Retained local edit');
}));
test('a device edit arriving during aggregate preview cannot become an admitted review',()=>fixture(async f=>{
 f.onPreview(f.edit);await assert.rejects(f.controller.preview('Question'),/Device records changed/);assert.equal(f.paid.size,0);assert.equal(f.generations(),0);assert.equal((await D.loadStore(f.db)).state.notes.length,1);
}));
