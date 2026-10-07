import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import * as D from '../app/storage.mjs';
import {privateCloudReview} from '../frontend/cloud-review.mjs';
import {privateCloudTransport} from '../frontend/cloud-transport.mjs';
import {createSyncHttpHandler} from '../server/sync-http.mjs';
const origin='https://plan.example.test',owner='11111111-1111-4111-8111-111111111111';
const note=(s,title)=>C.mutate(s,'note-add',{},n=>n.notes.push({id:C.uid(),title,body:'中文 العربية',items:[]}));
const snap=s=>({workspace:s.id,version:7,records:S.entities(s).map(r=>({...r,version:7})),operations:[]});
async function fixture(run){
  const previous=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await D.openStore();
  try{const base=C.fresh(),local=note(base,'Device'),remote=note(base,'Cloud');await D.saveStore(db,local,0);await D.saveDraft(db,{id:'draft',input:{title:'Unfinished'}});
    let snapshot=snap(remote);const calls=[];
    const handler=createSyncHttpHandler({origin,verifySession:async()=>({id:owner,is_anonymous:false}),admit:async()=>({allowed:true}),store:{read:async actor=>{assert.equal(actor,owner);return C.clone(snapshot);},apply:async()=>{throw new Error('No write authorized');}}});
    const transport=privateCloudTransport({origin,currentOrigin:origin,tokenProvider:async()=>'valid',fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return handler(new Request(url,{...options,headers:{...options.headers,origin}}));}});
    await run({db,local,remote,calls,transport,reviewer:privateCloudReview({db,transport}),setSnapshot:value=>snapshot=value});
  }finally{db.close();if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous;}
}
test('explicit authenticated comparison and fresh adoption retain full local records, held operations and drafts without uploading',()=>fixture(async f=>{
  assert.equal(f.calls.length,0);const compared=await f.reviewer.compare();assert.equal(compared.kind,'comparison');assert.equal(compared.review.pending.length,1);
  const result=await f.reviewer.adopt(compared,{confirmed:true,reviewDigest:compared.review.digest});assert.equal(result.revision,2);assert.equal(result.automaticReplay,false);
  assert.deepEqual((await D.loadStore(f.db)).state.notes,f.remote.notes);const audit=await D.syncRecovery(f.db);assert.deepEqual(audit.reviews[0].previousLocal,f.local);assert.ok(audit.hold);assert.equal((await D.loadDrafts(f.db))[0].id,'draft');assert.deepEqual(f.calls.map(c=>c.action),['read','read']);
}));
test('remote changes, empty cloud and unconfirmed/tampered selection never replace or upload records',()=>fixture(async f=>{
  const compared=await f.reviewer.compare();await assert.rejects(f.reviewer.adopt(compared,{reviewDigest:compared.review.digest}),/confirm/);
  const altered=C.clone(compared);altered.review.remote.notes[0].title='Changed';await assert.rejects(f.reviewer.adopt(altered,{confirmed:true,reviewDigest:compared.review.digest}),/changed/);
  f.setSnapshot(snap(note(f.remote,'Later cloud')));await assert.rejects(f.reviewer.adopt(compared,{confirmed:true,reviewDigest:compared.review.digest}),/Cloud records changed/);
  assert.deepEqual((await D.loadStore(f.db)).state,f.local);assert.equal((await D.syncRecovery(f.db)).reviews.length,0);
  f.setSnapshot(null);assert.deepEqual(await f.reviewer.compare(),{kind:'empty',workspace:f.local.id,revision:1,requiresFirstUploadReview:true});assert.ok(f.calls.every(c=>c.action==='read'));
}));
test('local edits while reading or after review stay safe; uncertain reads do not retry',()=>fixture(async f=>{
  const delayed=privateCloudReview({db:f.db,transport:{read:async id=>{await D.saveStore(f.db,note(f.local,'During read'),1);return f.transport.read(id);}}});
  await assert.rejects(delayed.compare(),/changed during/);assert.equal((await D.loadStore(f.db)).state.notes.length,2);
  const compared=await f.reviewer.compare();const newer=note((await D.loadStore(f.db)).state,'After review');await D.saveStore(f.db,newer,2);
  const count=f.calls.length;await assert.rejects(f.reviewer.adopt(compared,{confirmed:true,reviewDigest:compared.review.digest}),/changed after/);assert.equal(f.calls.length,count);assert.deepEqual((await D.loadStore(f.db)).state,newer);
  let attempts=0;const uncertain=privateCloudReview({db:f.db,transport:{read:async()=>{attempts++;throw new Error('Unconfirmed');}}});await assert.rejects(uncertain.compare(),/Unconfirmed/);assert.equal(attempts,1);assert.equal((await D.syncRecovery(f.db)).reviews.length,0);
}));
test('overlapping review actions are refused and local CAS protects edits made during final server read',()=>fixture(async f=>{
  let release;const gate=new Promise(resolve=>release=resolve);const busy=privateCloudReview({db:f.db,transport:{read:async id=>{await gate;return f.transport.read(id);}}});
  const pending=busy.compare();await assert.rejects(busy.compare(),/Wait/);release();const compared=await pending;
  const race=privateCloudReview({db:f.db,transport:{read:async id=>{await D.saveStore(f.db,note(f.local,'Concurrent'),1);return f.transport.read(id);}}});
  await assert.rejects(race.adopt(compared,{confirmed:true,reviewDigest:compared.review.digest}),/Another tab/);assert.equal((await D.loadStore(f.db)).state.notes.length,2);assert.equal((await D.syncRecovery(f.db)).reviews.length,0);
}));
