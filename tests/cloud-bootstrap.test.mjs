import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as D from '../app/storage.mjs';
import {privateFirstUpload} from '../frontend/cloud-bootstrap.mjs';
import {validateBootstrap} from '../server/bootstrap.mjs';
const destination='https://synthetic.supabase.co';
async function fixture(run){const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();try{const state=C.fresh();state.legacy={raw:{months:{},goals:[],plan:[],synthetic:'Retain original unknown fields'}};await D.saveStore(db,state,0);const calls=[],transport={read:async()=>{calls.push('read');return null;},bootstrap:async request=>{calls.push('bootstrap');await validateBootstrap(request,destination);return {status:'initialized',version:1};}};await run({db,state,calls,transport,controller:privateFirstUpload({db,transport,destination})});}finally{db.close();if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;}}
test('first-upload preview binds complete records and destination; explicit upload does not clear local history or establish a baseline',()=>fixture(async f=>{
  assert.equal(f.calls.length,0);const review=await f.controller.preview();assert.equal(review.includesImportedHistory,true);assert.equal(f.calls.length,0);
  const result=await f.controller.send(review,{confirmed:true,reviewDigest:review.digest});assert.equal(result.requiresCloudComparison,true);assert.deepEqual(f.calls,['read','bootstrap']);assert.deepEqual((await D.loadStore(f.db)).state,f.state);assert.equal((await D.syncRecovery(f.db)).baseline,null);
}));
test('unconfirmed, modified or stale first-upload reviews cannot reach the network',()=>fixture(async f=>{
  const review=await f.controller.preview();await assert.rejects(f.controller.send(review,{reviewDigest:review.digest}),/explicitly confirming/);
  const altered=C.clone(review);altered.request.records[0].value.seq=9;await assert.rejects(f.controller.send(altered,{confirmed:true,reviewDigest:review.digest}),/review changed/);
  const newer=C.mutate(f.state,'note-add',{},n=>n.notes.push({id:C.uid(),title:'Later',body:'',items:[]}));await D.saveStore(f.db,newer,1);await assert.rejects(f.controller.send(review,{confirmed:true,reviewDigest:review.digest}),/changed after/);assert.deepEqual(f.calls,[]);
}));
test('existing cloud, concurrent local changes and uncertain writes preserve all records and do not retry',()=>fixture(async f=>{
  for(const read of [async()=>({workspace:f.state.id}),async()=>{await D.saveStore(f.db,C.mutate(f.state,'note-add',{},n=>n.notes.push({id:C.uid(),title:'Concurrent',body:'',items:[]})),1);return null;}]){
    const controller=privateFirstUpload({db:f.db,destination,transport:{read,bootstrap:async()=>{throw new Error('Must not send');}}}),review=await controller.preview();await assert.rejects(controller.send(review,{confirmed:true,reviewDigest:review.digest}),/already exist|changed during/);
  }
  let attempts=0;const controller=privateFirstUpload({db:f.db,destination,transport:{read:async()=>null,bootstrap:async()=>{attempts++;throw new Error('Unconfirmed write');}}}),review=await controller.preview();await assert.rejects(controller.send(review,{confirmed:true,reviewDigest:review.digest}),/Unconfirmed/);assert.equal(attempts,1);assert.equal((await D.loadStore(f.db)).state.notes.length,1);assert.equal((await D.syncRecovery(f.db)).baseline,null);
}));
test('oversized original history is retained locally and cannot be silently trimmed for upload',()=>fixture(async f=>{
  const large=C.clone(f.state);large.legacy.raw.synthetic='x'.repeat(2_000_000);await D.saveStore(f.db,large,1);await assert.rejects(f.controller.preview(),/do not trim original history/);assert.deepEqual(f.calls,[]);assert.equal((await D.loadStore(f.db)).state.legacy.raw.synthetic.length,2_000_000);
  assert.throws(()=>privateFirstUpload({db:f.db,transport:f.transport,destination:'https://attacker.test'}),/exact reviewed/);
}));
