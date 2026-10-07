import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh,mutate,clone,scheduleCycle,cancelCycle} from '../app/core.mjs';
import {diffEntities} from '../app/sync.mjs';
import {validateOperation} from '../server/validation.mjs';

function example(){const before=fresh(),after=mutate(before,'note-add',{},n=>n.notes.push({id:'n',title:'中文 العربية',body:'Private note',items:[]}));return {before,after,request:{workspace:before.id,operationId:crypto.randomUUID(),expectedVersion:0,type:'note-add',patches:diffEntities(before,after)}};}

test('note commands preserve other notes, checklist identity and archived progress',()=>{
  const before=fresh();before.notes=[{id:'one',title:'One',body:'',items:[{id:'i',text:'Task',done:false},{id:'j',text:'Other',done:true}]},{id:'two',title:'Two',body:'',items:[]}];
  const check=(type,apply)=>{const after=mutate(before,type,{},apply);return validateOperation(before,{workspace:before.id,operationId:crypto.randomUUID(),expectedVersion:before.version,type,patches:diffEntities(before,after)});};
  assert.doesNotThrow(()=>check('note-edit',n=>{n.notes[0].title='Edited';n.notes[0].updated=123;}));
  assert.doesNotThrow(()=>check('note-item-toggle',n=>{n.notes[0].items[0].done=true;}));
  assert.doesNotThrow(()=>check('note-archive',n=>{n.notes[0].archived=true;}));
  assert.throws(()=>check('note-edit',n=>{n.notes[0].title='Edited';n.notes[1].title='Unrelated';}),/one existing note/);
  assert.throws(()=>check('note-edit',n=>{n.notes[0].items[0].done=true;}),/retain checklist/);
  assert.throws(()=>check('note-item-toggle',n=>{n.notes[0].items[0].done=true;n.notes[0].items[0].text='Rewritten';}),/text or identity/);
  assert.throws(()=>check('note-item-toggle',n=>{n.notes[0].items[0].done=true;n.notes[0].items[1].done=false;}),/one checklist item/);
  assert.throws(()=>check('note-archive',n=>{n.notes[0].archived=true;n.notes[0].body='Rewritten';}),/retains all text/);
  assert.throws(()=>check('note-add',n=>{n.notes.push({id:'new',title:'New',body:'',items:[]});n.notes[0].title='Changed';}),/earlier notes/);
  before.notes[0].archived=true;
  assert.throws(()=>check('note-item-toggle',n=>{n.notes[0].items[0].done=true;}),/active note/);
  assert.doesNotThrow(()=>check('note-restore',n=>{n.notes[0].archived=false;}));
});
test('server validator accepts a valid complete candidate without mutating the trusted snapshot',()=>{const {before,after,request}=example(),old=clone(before);const next=validateOperation(before,request);assert.deepEqual(next.notes,after.notes);assert.equal(next.seq,1);assert.equal(next.version,1);assert.deepEqual(before,old);});
test('server validator rejects wrong owner workspace, stale versions and envelope injection',()=>{const {before,request}=example();assert.throws(()=>validateOperation(before,{...request,workspace:'another'}),/workspace/);assert.throws(()=>validateOperation(before,{...request,expectedVersion:1}),/conflict/);assert.throws(()=>validateOperation(before,{...request,owner:'attacker'}),/envelope/);assert.throws(()=>validateOperation(before,{...request,operationId:'retry'}),/ID/);});
test('server validator rejects invalid financial records and reused sequences',()=>{const {before,request}=example();assert.throws(()=>validateOperation(before,{...request,patches:request.patches.filter(p=>p.collection!=='preferences')}),/sequence/);assert.throws(()=>validateOperation(before,{...request,patches:[...request.patches,{collection:'goals',key:'g',action:'put',value:{id:'g',name:'Bad target',target:-1,priority:1}}]}),/target/);});
test('server validator cannot inject fabricated historical or zero-amount ledger entries',()=>{const {before,request}=example();before.categories=[{id:'other',name:'Other',type:'variable'}];for(const historical of [true,false]){const t={id:'t',kind:'expense',seq:historical?0:1,date:'2026-10-06',amount:0,postings:[],historical};assert.throws(()=>validateOperation(before,{...request,patches:[...request.patches,{collection:'transactions',key:'t',action:'put',value:t}]}),/New transactions/);}});
test('server validator rejects duplicate patches and unsafe reservation keys',()=>{const {before,request}=example();assert.throws(()=>validateOperation(before,{...request,patches:[...request.patches,request.patches[0]]}),/Duplicate/);assert.throws(()=>validateOperation(before,{...request,patches:[...request.patches,{collection:'reservations',key:'__proto__',action:'put',value:{amount:1}}]}),/Unsafe/);});

test('sync cannot rewrite base cycles, imported history or active cycle segments',()=>{const {before,request}=example();const prefs=request.patches.find(p=>p.collection==='preferences');for(const value of [{...prefs.value,cycleStart:1},{...prefs.value,legacy:{raw:'rewritten'}}])assert.throws(()=>validateOperation(before,{...request,patches:request.patches.map(p=>p===prefs?{...p,value}:p)}),/rewritten/);const scheduled=scheduleCycle(fresh(),{start:1,effective:'2026-10-15'},'2026-10-06');const altered=mutate(scheduled,'cycle-cancel',{},n=>{n.cycleHistory[0].status='cancelled';});const envelope={workspace:scheduled.id,operationId:crypto.randomUUID(),expectedVersion:scheduled.version,type:'cycle-cancel',patches:diffEntities(scheduled,altered)};assert.throws(()=>validateOperation(scheduled,envelope,{asOf:'2026-10-16'}),/immutable/);});
test('future cycle schedules and cancellation retain existing history through sync',()=>{const before=fresh(),after=scheduleCycle(before,{start:1,effective:'2026-10-15'},'2026-10-06');const request={workspace:before.id,operationId:crypto.randomUUID(),expectedVersion:before.version,type:'cycle-scheduled',patches:diffEntities(before,after)};const current=validateOperation(before,request,{asOf:'2026-10-06'});const cancelled=cancelCycle(current,current.cycleHistory[0].id,'2026-10-06');const next=validateOperation(current,{workspace:current.id,operationId:crypto.randomUUID(),expectedVersion:current.version,type:'cycle-cancel',patches:diffEntities(current,cancelled)},{asOf:'2026-10-06'});assert.equal(next.cycleHistory[0].status,'cancelled');assert.equal(next.cycleHistory[0].effective,'2026-10-15');assert.throws(()=>validateOperation(before,request,{asOf:'2026-10-16'}),/future/);});
