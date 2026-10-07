import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
function fixture(){const s=C.fresh();s.accounts=[{id:'bank',name:'Bank',kind:'asset',currency:'CNY',opening:0,baselineDate:'2026-10-06',baselineSeq:0}];s.categories=[{id:'flex',name:'Flexible spending',type:'variable'},{id:'rent',name:'Rent',type:'fixed'}];s.budgets=[{id:'base',key:'2026-09',salary:100000,alloc:{flex:30000,rent:20000},locks:{}}];s.goals=[{id:'g',name:'Purchase',target:70001,priority:1}];s.reservations={g:0};return s;}
const input={id:'g',category:'flex',deadline:'2026-11-14',asOf:'2026-10-06',periods:3};
test('flexible spending path finds the minimum exact reduction without editing saved records',()=>{
  const s=fixture(),original=C.clone(s),r=C.goalSpendingPath(s,input);assert.equal(r.feasible,true);assert.equal(r.spendingReduction,20001);assert.equal(r.ready,input.deadline);assert.deepEqual(r.allowances,[{key:'2026-10',before:30000,after:9999,reduction:20001,locked:false}]);assert.deepEqual(s,original);
  const less=C.clone(s);less.budgets[0].alloc.flex-=20000;assert.notEqual(C.planGoals(less,{asOf:input.asOf,periods:3}).results[0].ready,input.deadline);
});
test('locked allowances, protected contributions and earlier goals are not spent by a reduction scenario',()=>{
  const s=fixture();s.budgets[0].locks.flex=true;assert.equal(C.goalSpendingPath(s,input).feasible,false);s.budgets[0].locks.flex=false;s.settings.monthlyProtection=10000;assert.equal(C.goalSpendingPath(s,input).feasible,false);
  s.settings.monthlyProtection=0;s.goals.push({id:'earlier',name:'Earlier',target:10000,priority:2,desired:'2026-11-13',flexible:false});s.reservations.earlier=0;assert.equal(C.goalSpendingPath(s,input).feasible,false);
});
test('a linked scheduled bill remains payable even after lowering its flexible allowance',()=>{
  const s=fixture();s.obligations=[{id:'bill',name:'Committed bill',kind:'bill',amount:25000,date:'2026-10-20',account:'bank',budgetCategory:'flex',paid:false}];assert.equal(C.goalSpendingPath(s,input).feasible,false);
});
test('sufficient existing savings need no spending cut; missing transition budgets cannot be bypassed',()=>{
  const s=fixture();s.accounts[0].opening=70001;assert.equal(C.goalSpendingPath(s,input).spendingReduction,0);
  const transition=C.scheduleCycle(fixture(),{start:1,effective:'2026-10-15'},input.asOf);const r=C.goalSpendingPath(transition,{...input,deadline:'2026-12-01'});assert.equal(r.feasible,false);assert.match(r.reason,/transition-period/);
  assert.equal(C.goalSpendingPath(fixture(),{...input,deadline:'2026-10-20'}).feasible,false);
  assert.throws(()=>C.goalSpendingPath(fixture(),{...input,category:'rent'}),/flexible/);
});
test('different future budgets retain their own amounts and locked periods contribute no reduction',()=>{
  const s=fixture();s.goals[0].target=120001;s.budgets.push({id:'future',key:'2026-11',salary:100000,alloc:{flex:10000,rent:20000},locks:{flex:true}});const original=C.clone(s);
  const r=C.goalSpendingPath(s,{...input,deadline:'2026-12-14'});assert.equal(r.spendingReduction,1);assert.deepEqual(r.allowances.map(p=>[p.key,p.before,p.after,p.reduction,p.locked]),[['2026-10',30000,29999,1,false],['2026-11',10000,10000,0,true]]);assert.deepEqual(s,original);
});
