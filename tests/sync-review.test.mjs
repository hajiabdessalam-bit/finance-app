import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import * as D from '../app/storage.mjs';
const note=(s,title)=>C.mutate(s,'note-add',{},n=>n.notes.push({id:C.uid(),title,body:'中文 العربية',items:[]}));
const snapshot=s=>({workspace:s.id,version:7,records:S.entities(s).map(r=>({...r,version:7})),operations:[]});
async function isolated(run){const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();try{await run(db);}finally{db.close();if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;}}
const queue=db=>new Promise((resolve,reject)=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
test('a reviewed comparison binds both complete versions and preserves pending proposals',async()=>{
  const base=C.fresh(),local=note(base,'Device'),remote=note(base,'Cloud'),review=await S.prepareRemoteReview(local,snapshot(remote));
  assert.equal(review.automaticReplay,false);assert.equal(review.pending[0].id,local.operations[0].id);
  assert.equal(review.changes.filter(c=>c.collection==='notes').length,2);
  const approved=await S.verifyRemoteReview(local,review,review.digest);assert.deepEqual(approved.notes,remote.notes);assert.equal(approved.operations.length,0);assert.equal(local.notes[0].title,'Device');
  await assert.rejects(S.verifyRemoteReview(note(local,'Later'),review,review.digest),/changed/);
  const tampered=C.clone(review);tampered.remote.notes[0].title='Changed';await assert.rejects(S.verifyRemoteReview(local,tampered,tampered.digest),/changed/);
});
test('different imported history and rewritten shared originals cannot be adopted',async()=>{
  const local=C.fresh();local.legacy={raw:{months:{},goals:[],plan:[],original:'one'}};const remote=C.clone(local);remote.legacy.raw.original='two';
  await assert.rejects(S.prepareRemoteReview(local,snapshot(remote)),/imported history/);
  const a=C.fresh();a.accounts=[{id:'bank',name:'Bank',kind:'asset',currency:'CNY',opening:10000,baselineDate:C.today(a.timezone),baselineSeq:0,verified:true}];a.categories=[{id:'oneoff',name:'Other',type:'variable'}];
  const paid=C.addTransaction(a,{kind:'expense',date:C.today(a.timezone),amount:100,account:'bank',category:'oneoff'}),rewritten=C.clone(paid);rewritten.transactions[0].note='Changed original';
  await assert.rejects(S.prepareRemoteReview(paid,snapshot(rewritten)),/shared transaction/);
});
test('adopting a reviewed server version archives the full device history and queue atomically',async()=>isolated(async db=>{
  const base=C.fresh(),local=note(base,'Device'),remote=note(base,'Cloud');await D.saveStore(db,local,0);await D.saveDraft(db,{id:'d',input:'unsaved'});
  const review=await S.prepareRemoteReview(local,snapshot(remote));await assert.rejects(D.adoptReviewedRemote(db,review,{reviewDigest:review.digest,expectedRevision:1}),/confirm/);
  assert.equal(await D.adoptReviewedRemote(db,review,{reviewDigest:review.digest,expectedRevision:1,confirmed:true}),2);
  const row=await D.loadStore(db);assert.deepEqual(row.state.notes,remote.notes);assert.equal(row.state.version,7);assert.deepEqual(await queue(db),[]);assert.equal((await D.loadDrafts(db))[0].id,'d');
  const recovery=await D.syncRecovery(db);assert.deepEqual(recovery.reviews[0].previousLocal,local);assert.equal(recovery.reviews[0].operations[0].id,local.operations[0].id);assert.equal(recovery.hold.workspace,local.id);assert.equal(recovery.baseline.version,7);
  await D.saveStore(db,note(row.state,'After adoption'),2);assert.equal((await queue(db)).length,0);assert.equal((await D.syncRecovery(db)).currentPending.length,1);
}));
test('another tab saving after comparison cannot clear any queue or create a misleading adoption archive',async()=>isolated(async db=>{
  const base=C.fresh(),local=note(base,'Device');await D.saveStore(db,local,0);const review=await S.prepareRemoteReview(local,snapshot(note(base,'Cloud')));const later=note(local,'Later');await D.saveStore(db,later,1);
  await assert.rejects(D.adoptReviewedRemote(db,review,{reviewDigest:review.digest,expectedRevision:1,confirmed:true}),/Another tab/);
  assert.deepEqual((await D.loadStore(db)).state,later);assert.equal((await queue(db)).length,2);assert.equal((await D.syncRecovery(db)).reviews.length,0);
}));
test('restore recovery includes edits made after the hold and keeps earlier archived operations',async()=>isolated(async db=>{
  const original=note(C.fresh(),'Before');await D.saveStore(db,original,0);const restored=C.fresh();await D.saveStore(db,restored,1,null,{restore:true});const after=note(restored,'After');await D.saveStore(db,after,2);
  const recovery=await D.syncRecovery(db);assert.equal(recovery.archives[0].operations[0].id,original.operations[0].id);assert.equal(recovery.currentPending[0].id,after.operations[0].id);assert.equal(recovery.automaticReplay,false);
}));
