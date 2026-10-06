/** Financial transition checks for the private sync boundary. */
import {accountBalance,summary,scheduledEvents} from '../app/core.mjs';
import {sameJson} from '../app/sync.mjs';
const scopes={
  'account-add':['accounts'],reconcile:['accounts','reconciliations'],'balance-review':['reconciliations'],
  transaction:['transactions'],reverse:['transactions','goals','holdings','outside','obligations'],
  'transaction-correct':['transactions'],'goal-purchase':['transactions','goals','reservations','holdings','obligations'],
  reserve:['reservations'],release:['reservations'],'archive-goal':['goals','reservations'],
  'goal-add':['goals','reservations'],'goal-edit':['goals'],
  'outside-given':['transactions','outside'],'outside-return':['transactions','outside'],'outside-classify':['outside'],
  'obligation-add':['obligations'],'obligation-paid':['obligations'],
  'obligation-skip':['obligations'],'obligation-stop':['obligations'],'obligation-replace':['obligations'],
  'obligation-restore':['obligations'],
  'csv-import':['imports'],'csv-undo':['imports'],
  'budget-set':['budgets'],'category-add':['categories'],'category-archive':['categories'],
  'note-add':['notes'],'note-edit':['notes'],'note-item-toggle':['notes'],'note-archive':['notes'],'note-restore':['notes'],
  settings:[],'cycle-scheduled':['cycleHistory'],'cycle-cancel':['cycleHistory']
};
const changed=(a,b,keys)=>keys.some(k=>!sameJson(a[k],b[k]));
const without=(record,keys)=>Object.fromEntries(Object.entries(record).filter(([key])=>!keys.includes(key)));
export function validateTransitions(current,next,request,asOf){
  const scope=scopes[request.type];
  if(!scope)throw new Error('Unsupported sync operation type.');
  for(const patch of request.patches){
    if(patch.collection==='preferences'){
      const allowed=request.type==='settings'?['seq','name','timezone','settings']:['seq'];
      if(Object.entries(patch.value).some(([key,value])=>!allowed.includes(key)&&!sameJson(value,current[key])))throw new Error('This operation cannot change workspace preferences.');
    }else if(!scope.includes(patch.collection))throw new Error('This operation cannot change that collection.');
  }
  const newChecks=next.reconciliations.filter(r=>!current.reconciliations.some(old=>old.id===r.id));
  if(newChecks.length&&(request.type!=='reconcile'||newChecks.length!==1))throw new Error('Only a balance check can establish a baseline.');
  for(const old of current.accounts){
    const account=next.accounts.find(a=>a.id===old.id);
    if(account.kind!==old.kind||account.currency!==old.currency)throw new Error('Account type and currency cannot be rewritten.');
    if(changed(old,account,['opening','baselineDate','baselineSeq','verified'])){
      const r=newChecks[0],expected=r?accountBalance(current,old.id,r.date):null;
      if(request.type!=='reconcile'||!r||r.account!==old.id||r.seq!==next.seq||r.date<old.baselineDate||r.date>asOf||r.expected!==expected||r.difference!==(expected===null?null:r.balance-expected)||r.status!==(expected===null||r.balance===expected?'matched':'unresolved')||r.review!==undefined||account.opening!==r.balance||account.baselineDate!==r.date||account.baselineSeq!==next.seq||account.verified!==true)throw new Error('A checked balance requires matching, dated reconciliation evidence.');
    }
  }
  for(const account of next.accounts.filter(a=>!current.accounts.some(old=>old.id===a.id)))if(request.type!=='account-add'||account.opening!==null||account.verified===true||account.baselineSeq!==next.seq||account.baselineDate>asOf)throw new Error('New accounts start without a verified balance.');
  if(newChecks.length){const r=newChecks[0],account=next.accounts.find(a=>a.id===r.account);if(!current.accounts.some(a=>a.id===r.account)||account.baselineSeq!==next.seq)throw new Error('A balance check must update its existing account baseline.');}
  for(const old of current.reconciliations){
    const r=next.reconciliations.find(r=>r.id===old.id);
    if(sameJson(old,r))continue;
    if(request.type!=='balance-review'||old.status!=='unresolved'||r.status!=='reviewed'||!sameJson(without(old,['status','review']),without(r,['status','review'])))throw new Error('Original balance evidence is immutable; add a review explanation.');
  }
  const increases=Object.entries(next.reservations).filter(([id,amount])=>amount>(current.reservations[id]||0));
  if(increases.length){
    const [id,amount]=increases[0],goal=current.goals.find(g=>g.id===id),available=summary(current,asOf).available;
    if(request.type!=='reserve'||increases.length!==1||!goal||goal.archived||available===null||amount-(current.reservations[id]||0)>available)throw new Error('Reserve only available cash for one active goal.');
  }
  for(const old of current.goals){
    const goal=next.goals.find(g=>g.id===old.id);
    if(request.type==='goal-edit'&&!sameJson(without(old,['target','priority','desired','flexible']),without(goal,['target','priority','desired','flexible'])))throw new Error('Goal edits cannot rewrite purchase history or ownership.');
  }
  for(const old of current.obligations){
    const event=next.obligations.find(o=>o.id===old.id);
    if(sameJson(old,event))continue;
    if(request.type==='obligation-add')throw new Error('Adding a schedule cannot rewrite existing events.');
    if(['obligation-stop','obligation-replace'].includes(request.type)){
      if(old.templateId||old.goal||old.archived||!sameJson(without(old,['cancelAfter','stopReason']),without(event,['cancelAfter','stopReason']))||!event.stopReason?.trim()||!event.cancelAfter||event.cancelAfter<asOf||request.type==='obligation-replace'&&event.cancelAfter<=asOf||old.cancelAfter&&event.cancelAfter>=old.cancelAfter)throw new Error('Only a dated future stop may change an existing ordinary template.');
    }
    if(request.type==='obligation-skip'&&(old.paid||old.skipped||event.skipped!==true||!sameJson(without(old,['skipped','skipReason']),without(event,['skipped','skipReason']))))throw new Error('Cancel only an unpaid occurrence without rewriting its schedule.');
    if(request.type==='obligation-restore'&&(!old.skipped||old.paid||event.skipped!==false||!sameJson(without(old,['skipped']),without(event,['skipped']))))throw new Error('Restore only the original cancelled occurrence.');
  }
  const addedEvents=next.obligations.filter(o=>!current.obligations.some(old=>old.id===o.id));
  if(['obligation-stop','obligation-restore'].includes(request.type)&&addedEvents.length)throw new Error('This schedule review cannot invent another event.');
  if(request.type==='obligation-replace'){
    const changedTemplates=current.obligations.filter(old=>!sameJson(old,next.obligations.find(o=>o.id===old.id)));
    const event=addedEvents[0],old=changedTemplates[0];
    if(addedEvents.length!==1||changedTemplates.length!==1||event.replacesTemplate!==old.id||event.date!==next.obligations.find(o=>o.id===old.id).cancelAfter)throw new Error('A replacement must retain one prior template and its exact dated boundary.');
  }
  for(const event of addedEvents){
    if(['obligation-add','obligation-replace'].includes(request.type)&&(event.paid||event.transaction||event.templateId||event.skipped))throw new Error('New templates cannot contain invented payment history.');
    if(request.type==='obligation-skip'){
      const expected=scheduledEvents(current,{from:event.date,to:event.date}).find(o=>o.id===event.id);if(!expected||expected.paid||expected.skipped||event.skipped!==true||!sameJson(without(expected,['recurrence','skipped','skipReason']),without(event,['recurrence','skipped','skipReason'])))throw new Error('Cancelled occurrence must match the original schedule.');
    }
  }
  for(const t of next.transactions.filter(t=>!current.transactions.some(old=>old.id===t.id)))if(t.date>asOf)throw new Error('Future payments belong on the calendar, not in actual transactions.');
}
