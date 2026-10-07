import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import * as D from '../app/storage.mjs';
const note=(s,title)=>C.mutate(s,'note-add',{},n=>n.notes.push({id:C.uid(),title,body:'中文 العربية',items:[]}));
const readQueue=db=>new Promise((resolve,reject)=>{const r=db.transaction('outbox').objectStore('outbox').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function fixture(run){
  const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();
  try{
    const initial=C.fresh();await D.saveStore(db,initial,0);
    const review=await S.prepareRemoteReview(initial,{workspace:initial.id,version:7,records:S.entities(initial).map(r=>({...r,version:7})),operations:[]});
    await D.adoptReviewedRemote(db,review,{reviewDigest:review.digest,expectedRevision:1,confirmed:true});
    const first=note((await D.loadStore(db)).state,'First'),second=note(first,'Second');await D.saveStore(db,second,2);
    await D.saveDraft(db,{id:'retained',input:{title:'Unfinished'}});
    await run({db,state:second,operation:first.operations.at(-1),revision:3});
  }finally{db.close();if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;}
}
test('exact receipts atomically acknowledge one queued edit and advance the reviewed baseline',()=>fixture(async f=>{
  const result=await D.acknowledgeOperation(f.db,{workspace:f.state.id,operation:f.operation,receipt:{status:'applied',version:8},expectedRevision:3});
  assert.equal(result.revision,4);assert.equal(result.state.operations[0].sync,'synced');assert.equal(result.state.operations[1].sync,'pending');
  assert.deepEqual(result.state.notes,f.state.notes);assert.equal((await readQueue(f.db)).length,1);assert.equal((await D.syncRecovery(f.db)).baseline.version,8);
  const next=result.state.operations[1];await D.acknowledgeOperation(f.db,{workspace:f.state.id,operation:next,receipt:{status:'duplicate',version:9},expectedRevision:4});
  assert.equal((await readQueue(f.db)).length,0);assert.equal((await D.syncRecovery(f.db)).baseline.version,9);assert.equal((await D.loadDrafts(f.db))[0].id,'retained');
}));
test('wrong receipts, rewritten operations and out-of-order acknowledgments retain every queued edit',()=>fixture(async f=>{
  const options={workspace:f.state.id,operation:f.operation,receipt:{status:'applied',version:8},expectedRevision:3};
  for(const altered of [{receipt:{status:'conflict',version:8}},{receipt:{status:'duplicate',version:9}},{workspace:'other'},{operation:f.state.operations[1],receipt:{status:'applied',version:9}},{operation:{...f.operation,type:'settings'}},{expectedRevision:2}])await assert.rejects(D.acknowledgeOperation(f.db,{...options,...altered}),/Nothing was acknowledged/);
  assert.deepEqual((await D.loadStore(f.db)).state,f.state);assert.equal((await readQueue(f.db)).length,2);assert.equal((await D.syncRecovery(f.db)).baseline.version,7);
}));
test('a concurrent local edit or reviewed restore prevents receipt acknowledgment without losing records',()=>fixture(async f=>{
  const newer=note(f.state,'Concurrent');await D.saveStore(f.db,newer,3);
  await assert.rejects(D.acknowledgeOperation(f.db,{workspace:f.state.id,operation:f.operation,receipt:{status:'applied',version:8},expectedRevision:3}),/Nothing was acknowledged/);
  assert.deepEqual((await D.loadStore(f.db)).state,newer);assert.equal((await readQueue(f.db)).length,3);
  await D.saveStore(f.db,newer,4,null,{restore:true});
  await assert.rejects(D.acknowledgeOperation(f.db,{workspace:f.state.id,operation:f.operation,receipt:{status:'applied',version:8},expectedRevision:5}),/Nothing was acknowledged/);
  assert.equal((await D.syncRecovery(f.db)).restores[0].operations.length,3);assert.deepEqual((await D.loadStore(f.db)).state,newer);
}));
