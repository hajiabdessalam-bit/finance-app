import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import * as D from '../app/storage.mjs';
import {privateQueueSender} from '../frontend/cloud-send.mjs';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const note=(s,title)=>C.mutate(s,'note-add',{},n=>n.notes.push({id:C.uid(),title,body:'中文 العربية',items:[]}));
async function fixture(run){
  const old=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();
  try{const initial=C.fresh();await D.saveStore(db,initial,0);const snapshot={workspace:initial.id,version:7,records:S.entities(initial).map(r=>({...r,version:7})),operations:[]};
    const review=await S.prepareRemoteReview(initial,snapshot);await D.adoptReviewedRemote(db,review,{reviewDigest:review.digest,expectedRevision:1,confirmed:true});
    const state=note(note((await D.loadStore(db)).state,'First'),'Second');await D.saveStore(db,state,2);let actor=owner,cloudVersion=7,onRead=null,onApply=null;const calls=[];
    const transport={read:async()=>{calls.push('read');await onRead?.();return {...snapshot,version:cloudVersion};},apply:async request=>{calls.push(C.clone(request));if(onApply)return onApply(request);cloudVersion++;return {status:'applied',version:cloudVersion};}};
    const sender=privateQueueSender({db,transport,sessionIdentity:async()=>actor});
    await run({db,state,calls,sender,setActor:v=>actor=v,setVersion:v=>cloudVersion=v,onRead:fn=>onRead=fn,onApply:fn=>onApply=fn});
  }finally{db.close();if(old===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=old;}
}
const send=(f,r)=>f.sender.send(r,{confirmed:true,reviewDigest:r.digest});
test('queue preview is inert and explicit sending keeps exact versions and atomic receipts',()=>fixture(async f=>{
  assert.equal(f.calls.length,0);const r=await f.sender.preview();assert.equal(f.calls.length,0);await assert.rejects(f.sender.send(r,{reviewDigest:r.digest}),/explicitly confirm/);
  assert.deepEqual(await send(f,r),{revision:5,acknowledged:2,automaticReplay:false});assert.deepEqual(f.calls.slice(1).map(c=>c.expectedVersion),[7,8]);assert.ok(f.calls.slice(1).every(c=>!Object.hasOwn(c,'owner')));
  const context=await D.loadSyncContext(f.db);assert.equal(context.queue.length,0);assert.equal(context.baseline.version,9);assert.deepEqual(context.row.state.notes,f.state.notes);
}));
test('changed session, local edits, review or cloud version never sends stale edits',()=>fixture(async f=>{
  const r=await f.sender.preview();f.setActor(other);await assert.rejects(send(f,r),/changed after review/);assert.equal(f.calls.length,0);f.setActor(owner);
  const altered=C.clone(r);altered.operations[0].type='settings';await assert.rejects(send(f,altered),/changed after review/);assert.equal(f.calls.length,0);
  f.setVersion(8);await assert.rejects(send(f,r),/Cloud records changed/);assert.equal(f.calls.length,1);f.setVersion(7);
  f.onRead(async()=>D.saveStore(f.db,note(f.state,'Concurrent'),3));await assert.rejects(send(f,r),/local records changed/);assert.equal(f.calls.length,2);assert.equal((await D.loadSyncContext(f.db)).queue.length,3);
}));
test('uncertain writes and session changes after server acceptance preserve the queue without retry',()=>fixture(async f=>{
  const r=await f.sender.preview();f.onApply(async()=>{throw new Error('Uncertain');});await assert.rejects(send(f,r),/Uncertain/);assert.equal(f.calls.length,2);assert.equal((await D.loadSyncContext(f.db)).queue.length,2);
  f.onApply(async()=>{f.setActor(other);return {status:'applied',version:8};});await assert.rejects(send(f,r),/Sign-in changed/);assert.equal(f.calls.length,4);assert.equal((await D.loadSyncContext(f.db)).queue.length,2);assert.equal((await D.syncRecovery(f.db)).baseline.version,7);
}));
test('a restored device queue remains held and cannot be previewed for automatic sending',()=>fixture(async f=>{
  await D.saveStore(f.db,f.state,3,null,{restore:true});await assert.rejects(f.sender.preview(),/restore hold/);assert.equal(f.calls.length,0);assert.equal((await D.syncRecovery(f.db)).restores[0].operations.length,2);
}));
