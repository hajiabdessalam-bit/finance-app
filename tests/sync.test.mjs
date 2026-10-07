import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,clone,mutate,validateState} from '../app/core.mjs';
import {diffEntities,applyPatches,flushOperations,SyncConflict,entities,hydrateSnapshot,conflictReview,sameJson} from '../app/sync.mjs';
function transport(){let version=0;const ids=new Set();return {apply:async({operationId,expectedVersion})=>{if(ids.has(operationId))return {status:'duplicate',version};if(expectedVersion!==version)return {status:'conflict',version};ids.add(operationId);return {status:'applied',version:++version};},version:()=>version};}

test('queue preflight refuses implicit rebasing, version gaps and duplicate IDs before any request',async()=>{
  let calls=0;const sender={apply:async()=>{calls++;return {status:'applied',version:1};}},one={id:'a',type:'note',patches:[],baseVersion:0,version:1};
  for(const operations of [[one,{...one,id:'b',baseVersion:2,version:3}],[one,{...one,baseVersion:1,version:2}],[{...one,baseVersion:7,version:8}]])await assert.rejects(flushOperations({workspace:'w',operations,remoteVersion:0,transport:sender}),/No automatic rebasing/);
  assert.equal(calls,0);
});
test('captured queue content cannot change while a previous request or acknowledgment is pending',async()=>{
  const operations=[{id:'a',type:'note',patches:[],baseVersion:0,version:1},{id:'b',type:'note',patches:[{value:{title:'Reviewed'}}],baseVersion:1,version:2}],sent=[];
  await flushOperations({workspace:'w',operations,remoteVersion:0,transport:{apply:async command=>{sent.push(command);if(sent.length===1){operations[1].patches[0].value.title='Changed';operations[1].baseVersion=99;operations.push({id:'c'});}return {status:'applied',version:command.expectedVersion+1};}},onAck:async()=>{operations[1].type='Changed';}});
  assert.equal(sent.length,2);assert.equal(sent[1].expectedVersion,1);assert.equal(sent[1].type,'note');assert.equal(sent[1].patches[0].value.title,'Reviewed');
});
test('duplicate receipt after other device edits stops the queue for review without acknowledging or rebasing',async()=>{
  const operations=[{id:'a',type:'note',patches:[],baseVersion:0,version:1},{id:'b',type:'note',patches:[],baseVersion:1,version:2}];let calls=0,acks=0;
  await assert.rejects(flushOperations({workspace:'w',operations,remoteVersion:0,transport:{apply:async()=>{calls++;return {status:'duplicate',version:4};}},onAck:async()=>acks++}),SyncConflict);assert.equal(calls,1);assert.equal(acks,0);assert.equal(operations.length,2);
});
test('malformed, old or skipped acknowledgments never discard a pending edit',async()=>{
  const operations=[{id:'a',type:'note',patches:[],baseVersion:0,version:1}];let acks=0;
  for(const result of [null,{status:'applied',version:4},{status:'applied',version:-1},{status:'duplicate',version:0},{status:'unknown',version:1}])await assert.rejects(flushOperations({workspace:'w',operations,remoteVersion:0,transport:{apply:async()=>result},onAck:async()=>acks++}),/did not confirm/);
  assert.equal(acks,0);
});
test('sync changes individual records and retains original history',()=>{const before=fresh(),after=mutate(before,'note-add',{},n=>n.notes.push({id:'n',title:'Idea',body:'中文 العربية',items:[]}));const patches=diffEntities(before,after);assert.equal(patches.length,2);assert.equal(patches[0].collection,'notes');assert.deepEqual(applyPatches(before,patches).notes,after.notes);});
test('sync refuses hard deletion of records',()=>{const before=fresh();before.notes=[{id:'n',title:'Saved',body:'',items:[]}];const after=clone(before);after.notes=[];assert.throws(()=>diffEntities(before,after),/cannot delete/);});
test('retry after lost network response uses the same immutable operation ID',async()=>{const server=transport(),operations=[{id:'one',type:'note',patches:[],baseVersion:0,version:1}];await flushOperations({workspace:'w',operations,remoteVersion:0,transport:server});const ack=[];const result=await flushOperations({workspace:'w',operations,remoteVersion:0,transport:server,onAck:async id=>ack.push(id)});assert.equal(result,1);assert.equal(server.version(),1);assert.deepEqual(ack,['one']);});
test('two devices changing the same version produce a reviewable conflict',async()=>{const server=transport();await flushOperations({workspace:'w',operations:[{id:'a',type:'note',patches:[],baseVersion:0,version:1}],remoteVersion:0,transport:server});let acknowledged=false;await assert.rejects(flushOperations({workspace:'w',operations:[{id:'b',type:'note',patches:[],baseVersion:0,version:1}],remoteVersion:0,transport:server,onAck:async()=>{acknowledged=true;}}),SyncConflict);assert.equal(acknowledged,false);assert.equal(server.version(),1);});
test('failed transport does not acknowledge or discard the queue',async()=>{let ack=0;const operations=[{id:'a',type:'note',patches:[],baseVersion:0,version:1}];await assert.rejects(flushOperations({workspace:'w',operations,remoteVersion:0,transport:{apply:async()=>{throw new Error('Offline');}},onAck:async()=>{ack++;}}),/Offline/);assert.equal(ack,0);assert.equal(operations.length,1);});
test('JSONB key reordering does not create false edits or immutable-ledger conflicts',()=>{const s=fresh();s.transactions=[{id:'t',amount:100,postings:[{account:'bank',amount:-100}]}];const reordered={postings:[{amount:-100,account:'bank'}],amount:100,id:'t'};assert.equal(sameJson(s.transactions[0],reordered),true);assert.doesNotThrow(()=>applyPatches(s,[{collection:'transactions',key:'t',action:'put',value:reordered}]));assert.equal(sameJson([1,2],[2,1]),false);assert.equal(sameJson({a:undefined},{b:undefined}),false);});

test('cloud JSONB reordering preserves complete legacy text while changed values or array order are rejected',()=>{
 const s=fresh(),raw={months:{},goals:[],plan:[],unknown:{z:'preserved',a:[{z:2,a:1},'second']}};
 s.legacy={raw,rawText:JSON.stringify(raw)};
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(k=>[k,reorder(value[k])])):value;
 const snapshot={workspace:s.id,version:1,records:entities(s).map(e=>({...e,value:reorder(e.value),version:1})),operations:[]};
 const result=hydrateSnapshot(snapshot);assert.equal(result.legacy.rawText,s.legacy.rawText);
 result.legacy.raw.unknown.z='changed';assert.throws(()=>validateState(result),/differs/);
 result.legacy.raw.unknown.z='preserved';result.legacy.raw.unknown.a.reverse();assert.throws(()=>validateState(result),/differs/);
});

test('private reads retain original JSON field order for older signed-in clients without rewriting stored data',async()=>{
 const s=fresh(),raw={months:{},goals:[],plan:[],z:{b:2,a:1},a:'original'};
 s.legacy={raw,rawText:JSON.stringify(raw)};
 const records=entities(s);records.find(r=>r.collection==='preferences').value.legacy.raw={a:'original',z:{a:1,b:2},plan:[],goals:[],months:{}};
 const snapshot={workspace:s.id,version:1,records:records.map(e=>({...e,version:1})),operations:[]};
 const {syncService}=await import('../server/sync-service.mjs');
 const service=syncService({verifySession:async()=>({id:'11111111-1111-4111-8111-111111111111',is_anonymous:false}),store:{read:async()=>snapshot,apply:async()=>{throw Error('no write');}}});
 const result=await service.read({token:'synthetic',workspace:s.id}),legacy=result.records.find(r=>r.collection==='preferences').value.legacy;
 assert.equal(JSON.stringify(legacy.raw),legacy.rawText);assert.notEqual(JSON.stringify(snapshot.records.find(r=>r.collection==='preferences').value.legacy.raw),legacy.rawText);
});

test('atomic cloud hydration restores balances with sequence watermarks',()=>{let s=fresh();s.accounts=[{id:'bank',name:'Bank',kind:'asset',currency:'CNY',opening:100000,baselineDate:'2026-10-06',baselineSeq:0}];s.categories=[{id:'oneoff',name:'Other',type:'variable'}];s=mutate(s,'test',{},n=>{n.transactions.push({id:'t',seq:n.seq,kind:'expense',date:'2026-10-06',amount:10000,account:'bank',category:'oneoff',postings:[{account:'bank',amount:-10000}],historical:false});});const snapshot={workspace:s.id,version:7,records:entities(s).map(r=>({...r,version:7}))};const result=hydrateSnapshot(snapshot);assert.equal(result.seq,s.seq);assert.equal(result.version,7);assert.deepEqual(result.transactions,s.transactions);assert.equal(result.operations.length,0);assert.throws(()=>hydrateSnapshot({...snapshot,workspace:'wrong'}),/different/);assert.throws(()=>hydrateSnapshot({...snapshot,records:[...snapshot.records,snapshot.records[0]]}),/Inconsistent/);});
test('sync refuses rewritten transactions and profile injection',()=>{const s=fresh();assert.throws(()=>applyPatches(s,[{collection:'preferences',key:'profile',action:'put',value:{accounts:[]}}]),/preferences/);s.transactions=[{id:'t',amount:100}];assert.throws(()=>applyPatches(s,[{collection:'transactions',key:'t',action:'put',value:{id:'t',amount:200}}]),/immutable/);});
test('conflict review retains pending proposals without silently merging changes',()=>{const s=fresh(),local=mutate(s,'note',{},n=>n.notes.push({id:'n',title:'Local',body:'',items:[]})),remote=mutate(s,'note',{},n=>n.notes.push({id:'n',title:'Remote',body:'',items:[]}));const review=conflictReview(local,remote);assert.equal(review.requiresReview,true);assert.equal(review.changes.find(c=>c.collection==='notes').local.title,'Local');assert.equal(review.changes.find(c=>c.collection==='notes').remote.title,'Remote');assert.equal(review.pending.length,1);assert.equal(local.notes[0].title,'Local');});

test('incremental edits do not copy the original backup into every queued preference patch',()=>{const before=fresh();before.legacy={raw:{months:{},goals:[],plan:[],largePrivateHistory:'x'.repeat(100000)}};const after=mutate(before,'note-add',{},n=>n.notes.push({id:'n',title:'Synthetic',body:'',items:[]}));const queued=after.operations.at(-1).patches.find(p=>p.collection==='preferences');assert.deepEqual(queued.value,{seq:1});const delta=diffEntities(before,after);assert.deepEqual(delta.find(p=>p.collection==='preferences').value,{seq:1});assert.deepEqual(applyPatches(before,delta).legacy,before.legacy);assert.ok(JSON.stringify(delta).length<1000);assert.deepEqual(entities(after).find(e=>e.collection==='preferences').value.legacy,before.legacy);});
