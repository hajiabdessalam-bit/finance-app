import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
function base(){const state=C.fresh();state.accounts=[{id:'bank',name:'Synthetic bank',kind:'asset',currency:state.currency,opening:100000,baselineDate:'2026-10-06',baselineSeq:0,verified:true}];state.goals=[{id:'g',name:'Synthetic gold',kind:'gold',target:10000,priority:1,quantity:2,archived:false},{id:'other',name:'Other goal',kind:'gold',target:10000,priority:2,quantity:2,archived:false}];state.categories=[{id:"oneoff",name:"Uncategorized",type:"variable"}];state.reservations={g:0,other:0};return state;}
const bad=(state,edit,pattern)=>{const altered=JSON.parse(JSON.stringify(state));edit(altered);assert.throws(()=>C.validateState(altered),pattern);};
test('restored purchases cannot borrow another goal or ordinary expense and latest history remains exact',()=>{
 const state=C.purchaseGoal(base(),{id:'g',amount:10000,account:'bank',date:'2026-10-06',quantity:2});C.validateState(C.clone(state));
 bad(state,n=>{n.goals[1].purchases=C.clone(n.goals[0].purchases);n.goals[1].purchase=C.clone(n.goals[0].purchase);},/does not match the ledger/);
 bad(state,n=>{n.transactions.at(-1).goal='other';},/does not match the ledger/);
 bad(state,n=>{n.transactions.at(-1).source='manual';},/does not match the ledger/);
 bad(state,n=>{n.goals[0].purchase.amount++;},/Latest purchase/);
});
test('restored goal and holding correction flags must agree with the retained reversal',()=>{
 const paid=C.purchaseGoal(base(),{id:'g',amount:10000,account:'bank',date:'2026-10-06',quantity:2}),reversed=C.reverseTransaction(paid,paid.transactions.at(-1).id);
 C.validateState(C.clone(reversed));
 bad(reversed,n=>{delete n.goals[0].purchases[0].reversedBy;delete n.goals[0].purchase.reversedBy;},/Invalid purchase correction/);
 bad(reversed,n=>{delete n.holdings[0].reversedBy;},/Gold holding/);
 bad(paid,n=>{n.holdings[0].goal='other';},/Gold holding/);
 bad(paid,n=>{n.holdings[0].cost++;},/Gold holding/);
 bad(paid,n=>{n.holdings[0].quantity++;},/Gold holding/);
});
test('restored outside repayments cannot be reused by another record or hide a correction',()=>{
 let state=C.giveOutside(base(),{name:'First',kind:'loan',amount:10000,account:'bank',date:'2026-10-06'});const first=state.outside[0].id;
 state=C.giveOutside(state,{name:'Second',kind:'loan',amount:10000,account:'bank',date:'2026-10-06'});state=C.returnOutside(state,{id:first,amount:3000,account:'bank',date:'2026-10-06'});
 bad(state,n=>{n.outside[1].returns=C.clone(n.outside[0].returns);n.outside[1].returned=3000;},/Outside return/);
 bad(state,n=>{n.transactions.find(t=>t.id===n.outside[0].transaction).outside=n.outside[1].id;},/Outside payment/);
 const reversed=C.reverseTransaction(state,state.outside[0].returns[0].transaction);C.validateState(C.clone(reversed));
 bad(reversed,n=>{delete n.outside[0].returns[0].reversedBy;n.outside[0].returned=3000;},/Invalid outside return correction/);
});
