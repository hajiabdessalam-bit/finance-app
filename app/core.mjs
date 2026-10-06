/** PLAN financial rules. Money is always an integer in the currency's minor unit. */
export const SCHEMA = 2;
export const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
export function money(value) {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) fail('Enter an amount with no more than two decimal places.');
  const negative = text.startsWith('-');
  const [whole, fraction=''] = text.replace(/^-/,'').split('.');
  const n = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(n) || n > 1e14) fail('Amount is too large.');
  return negative ? -n : n;
}
export function validMoney(n, label='Amount', signed=false) {
  if (!Number.isSafeInteger(n) || Math.abs(n)>1e14 || (!signed && n<0)) fail(`${label} is invalid.`);
  return n;
}
export function dateKey(value) {
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Use a date in YYYY-MM-DD format.');
  const [y,m,d] = value.split('-').map(Number);
  if (y<1900 || y>2200 || m<1 || m>12 || d<1 || d>new Date(Date.UTC(y,m,0)).getUTCDate()) fail('Date does not exist.');
  return value;
}
export function dayAt(year,month,day) {
  const end = new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return `${year}-${String(month+1).padStart(2,'0')}-${String(Math.min(day,end)).padStart(2,'0')}`;
}
export function addMonths(key,n) {
  const [y,m] = key.split('-').map(Number), d = new Date(Date.UTC(y,m-1+n,1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
export function periodKey(date,start=15) {
  dateKey(date);
  const [y,m,d] = date.split('-').map(Number);
  return d<Math.min(start,new Date(Date.UTC(y,m,0)).getUTCDate()) ? addMonths(`${y}-${String(m).padStart(2,'0')}`,-1) : date.slice(0,7);
}
export function periodDates(key,start=15) {
  const [y,m] = key.split('-').map(Number), [ny,nm] = addMonths(key,1).split('-').map(Number);
  const from=dayAt(y,m-1,start), next=dayAt(ny,nm-1,start);
  const end=new Date(`${next}T12:00:00Z`); end.setUTCDate(end.getUTCDate()-1);
  return {from,to:end.toISOString().slice(0,10),next};
}
export function today(timezone='Asia/Shanghai') {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const pick=t=>parts.find(p=>p.type===t).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
export const uid = () => globalThis.crypto.randomUUID();
export function fresh() {
  return {schema:SCHEMA, id:uid(),version:0,seq:0,currency:'CNY',timezone:'Asia/Shanghai',cycleStart:15,
    name:'',accounts:[],transactions:[],reconciliations:[],categories:[],budgets:[],goals:[],reservations:{},
    obligations:[],outside:[],notes:[],holdings:[],operations:[],imports:[],legacy:null,
    settings:{reserve:0,monthlyProtection:0,forecastPeriods:12},cycleHistory:[]};
}
function cleanJson(value,depth=0) {
  if(depth>40) fail('Backup nesting is too deep.');
  if(typeof value==='number'&&!Number.isFinite(value)) fail('Backup contains an invalid number.');
  if(value&&typeof value==='object') for(const key of Object.keys(value)) {
    if(['__proto__','prototype','constructor'].includes(key)) fail('Backup contains unsafe object keys.');
    cleanJson(value[key],depth+1);
  }
}
function string(v,label,max=10000) { if(typeof v!=='string'||v.length>max) fail(`${label} is invalid.`); }
function unique(list,label) { const ids=new Set();for(const item of list){if(!object(item)||!['string','number'].includes(typeof item.id))fail(`${label} record is invalid.`);const key=String(item.id);if(ids.has(key))fail(`${label} contains duplicate IDs.`);ids.add(key);} }
export function readLegacy(raw) {
  if(typeof raw!=='string'||raw.length>5e6) fail('Backup is empty or larger than 5 MB.');
  let wrapped;try{wrapped=JSON.parse(raw);}catch{fail('This is not valid JSON.');}
  cleanJson(wrapped);
  if(!object(wrapped))fail('Backup must be an object.');
  let data=wrapped;
  if(own(wrapped,'app')||own(wrapped,'schema')) {
    if(wrapped.app!=='plan'||wrapped.schema!==1||!object(wrapped.data))fail('This is not a supported PLAN backup.');
    data=wrapped.data;
  }
  if(!object(data.months)||!Array.isArray(data.goals)||!Array.isArray(data.plan))fail('Backup has missing months, goals or categories.');
  if(!Number.isInteger(data.cycleStart||15)||(data.cycleStart||15)<1||(data.cycleStart||15)>31)fail('Financial start day is invalid.');
  unique(data.goals,'Goals');unique(data.plan,'Categories');
  for(const g of data.goals) {string(g.name,'Goal name',300);validMoney(money(g.target),'Goal target');if(!Number.isFinite(g.pct)||g.pct<0||g.pct>100)fail('Goal percentage is invalid.');}
  const catIds=new Set(data.plan.map(c=>String(c.id)));
  for(const c of data.plan) {string(c.name,'Category name',300);if(!['fixed','variable','savings','buffer'].includes(c.type))fail('Category type is invalid.');}
  const expenseIds=new Set();
  for(const [key,m] of Object.entries(data.months)) {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)||!object(m)||!object(m.alloc)||!object(m.locks)||!Array.isArray(m.spend)||!Array.isArray(m.changes)||!object(m.split))fail(`Invalid monthly plan: ${key}.`);
    dateKey(key+'-01');validMoney(money(m.salary),'Salary');
    for(const [id,v] of Object.entries(m.alloc)) {if(!catIds.has(id))fail('Budget refers to a missing category.');validMoney(money(v),'Budget');}
    if(m.override!==null&&m.override!==undefined)validMoney(money(m.override),'Savings override',true);
    let pct=0;for(const v of Object.values(m.split)) {if(!Number.isFinite(v)||v<0||v>100)fail('Invalid historical goal split.');pct+=v;}if(pct>100.00001)fail('Historical goal split exceeds 100%.');
    for(const e of m.spend) {
      if(!object(e)||!Number.isFinite(e.ts)||!['string','number'].includes(typeof e.id))fail('Expense has invalid identity or timestamp.');
      if(expenseIds.has(String(e.id)))fail('Duplicate expense ID.');expenseIds.add(String(e.id));
      validMoney(money(e.amount),'Expense');string(e.note||'','Expense note');
      if(!catIds.has(e.cat)&&!['oneoff','buffer'].includes(e.cat))fail('Expense has a missing category.');
      dateKey(new Date(e.ts).toISOString().slice(0,10));
    }
    for(const c of m.changes) {if(!object(c)||!Number.isFinite(c.ts))fail('Invalid budget change.');validMoney(money(c.from),'Change');validMoney(money(c.to),'Change');}
  }
  if(data.card) {validMoney(money(data.card.used),'Card balance');validMoney(money(data.card.limit),'Card limit');if(!Number.isInteger(data.card.payDay)||data.card.payDay<1||data.card.payDay>31)fail('Card payment day is invalid.');}
  for(const kind of ['given','borrowed']) {
    const list=data.outside?.[kind]||[];if(!Array.isArray(list))fail('Outside records are invalid.');unique(list,'Outside');
    for(const r of list) {dateKey(r.on);validMoney(money(r.amount),'Outside amount');string(r.person||'','Person',300);if(r.backOn)dateKey(r.backOn);if(r.repaidOn)dateKey(r.repaidOn);if(r.back!=null)validMoney(money(r.back),'Return');}
  }
  if(data.notes&&!Array.isArray(data.notes))fail('Notes are invalid.');
  return {wrapped,data};
}
export async function digest(raw) {
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  return [...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function legacyForecast(data,key,asOf) {
  const m=data.months[key],start=data.cycleStart||15;
  const fixed=data.plan.filter(c=>c.type==='fixed').reduce((s,c)=>s+money(m.alloc[c.id]||0),0);
  const variable=data.plan.filter(c=>c.type==='variable').reduce((s,c)=>s+money(m.alloc[c.id]||0),0);
  const loggedVariable=m.spend.filter(e=>!['oneoff','buffer'].includes(e.cat)).reduce((s,e)=>s+money(e.amount),0);
  const given=(data.outside?.given||[]).filter(g=>periodKey(g.on,start)===key).reduce((s,g)=>s+money(g.amount),0);
  const repaid=(data.outside?.borrowed||[]).filter(g=>g.repaidOn&&periodKey(g.repaidOn,start)===key).reduce((s,g)=>s+money(g.amount),0);
  const returned=(data.outside?.given||[]).filter(g=>g.backOn&&periodKey(g.backOn,start)===key).reduce((s,g)=>s+money(g.back??g.amount),0);
  const oneoff=m.spend.filter(e=>e.cat==='oneoff').reduce((s,e)=>s+money(e.amount),0)+given+repaid;
  const buffer=money(m.alloc.buffer||0),bufferUsed=m.locks.buffer?0:Math.min(oneoff,buffer);
  const closed=key<periodKey(asOf,start);
  const predicted=money(m.salary)-fixed-Math.max(variable,loggedVariable)-(closed?bufferUsed:Math.max(buffer,bufferUsed))-(oneoff-bufferUsed)+returned;
  return {predicted,recorded:m.override==null?null:money(m.override),status:m.override==null?'estimated':'legacy-recorded'};
}
export async function migrateLegacy(raw,asOf='2026-10-06') {
  dateKey(asOf);const {wrapped,data}=readLegacy(raw),hash=await digest(raw),state=fresh();
  state.id='legacy-'+hash;state.name=data.name||'';state.cycleStart=data.cycleStart||15;
  state.imports=[{id:hash,kind:'legacy',at:new Date().toISOString()}];
  state.legacy={digest:hash,raw:wrapped,rawText:raw,asOf,estimates:Object.keys(data.months).sort().map(key=>({key,...legacyForecast(data,key,asOf)}))};
  state.categories=data.plan.map(c=>({id:String(c.id),name:c.name,type:c.type,archived:false}));
  state.categories.push({id:'oneoff',name:'Uncategorized',type:'variable',archived:false});
  state.accounts=[{id:'bank',name:'Bank / savings',kind:'asset',currency:'CNY',opening:null,baselineDate:asOf,baselineSeq:0},
    {id:'cash',name:'Cash wallet',kind:'asset',currency:'CNY',opening:null,baselineDate:asOf,baselineSeq:0},
    {id:'card',name:'Credit card',kind:'liability',currency:'CNY',opening:-money(data.card?.used||0),limit:money(data.card?.limit||0),baselineDate:asOf,baselineSeq:0,verified:false}];
  for(const [key,m] of Object.entries(data.months)) {
    state.budgets.push({id:key,key,salary:money(m.salary),alloc:Object.fromEntries(Object.entries(m.alloc).map(([k,v])=>[k,money(v)])),locks:clone(m.locks),split:clone(m.split),status:key<periodKey(asOf,state.cycleStart)?'historical':'planned',source:'legacy',revision:0});
    for(const e of m.spend) {
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:state.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(e.ts));
      const get=t=>parts.find(x=>x.type===t).value,date=`${get('year')}-${get('month')}-${get('day')}`;
      state.transactions.push({id:'legacy-expense-'+e.id,seq:0,kind:'expense',amount:money(e.amount),date,category:e.cat,note:e.note||'',account:e.method==='card'?'card':'bank',postings:[],historical:true,source:'legacy',legacyPeriod:key,legacyId:e.id});
    }
  }
  state.goals=data.goals.map((g,i)=>({id:String(g.id),name:g.name,target:money(g.target),priority:i+1,desired:g.deadline||'',flexible:true,protected:g.id==='emergency',share:g.pct,archived:false,kind:'saving',icon:g.e||'◇'}));
  for(const g of state.goals)state.reservations[g.id]=0;
  for(const r of data.outside?.given||[])state.outside.push({id:'legacy-given-'+r.id,name:r.person||'',note:r.note||'',amount:money(r.amount),date:r.on,kind:'unclassified',returned:r.backOn?money(r.back??r.amount):0,returnDate:r.backOn||'',source:'legacy'});
  for(const r of data.outside?.borrowed||[]) {
    const id='debt-'+r.id;
    state.accounts.push({id,name:`Borrowed: ${r.person||'Unknown'}`,kind:'liability',currency:'CNY',opening:r.repaidOn?0:-money(r.amount),baselineDate:asOf,baselineSeq:0,verified:false});
    state.outside.push({id:'legacy-borrowed-'+r.id,name:r.person||'',note:r.note||'',amount:money(r.amount),date:r.on,kind:'borrowed',account:id,due:r.due||'',source:'legacy'});
  }
  state.notes=clone(data.notes||[]).map(n=>({...n,id:String(n.id),goal:n.goal||''}));
  state.settings.cardPayDay=data.card?.payDay||18;
  validateState(state);return state;
}
export function validateState(s) {
  cleanJson(s);
  if(!object(s)||s.schema!==SCHEMA||typeof s.id!=='string'||!s.id||!Number.isSafeInteger(s.version)||s.version<0||!Number.isSafeInteger(s.seq)||s.seq<0)fail('Unsupported state version.');
  if(!['CNY','USD','EUR','MAD','GBP'].includes(s.currency))fail('Unsupported currency.');
  try{new Intl.DateTimeFormat('en',{timeZone:s.timezone});}catch{fail('Invalid timezone.');}
  if(!Number.isInteger(s.cycleStart)||s.cycleStart<1||s.cycleStart>31)fail('Invalid financial start day.');
  for(const key of ['accounts','transactions','reconciliations','categories','budgets','goals','obligations','outside','notes','holdings','operations','imports','cycleHistory'])if(!Array.isArray(s[key]))fail(`Missing ${key}.`);
  if(!object(s.reservations)||!object(s.settings))fail('Settings or reservations are missing.');
  for(const key of ['accounts','transactions','categories','budgets','goals','outside','notes','holdings','operations'])unique(s[key],key);
  unique(s.obligations,'obligations');
  unique(s.imports,'imports');
  const accounts=new Set(s.accounts.map(a=>a.id)),categories=new Set(s.categories.map(c=>c.id)),goals=new Set(s.goals.map(g=>g.id));
  for(const a of s.accounts) {string(a.name,'Account name',300);if(!['asset','liability'].includes(a.kind)||a.currency!==s.currency)fail('Account type/currency is invalid.');if(a.opening!==null)validMoney(a.opening,'Opening balance',true);dateKey(a.baselineDate);if(!Number.isSafeInteger(a.baselineSeq)||a.baselineSeq<0||a.baselineSeq>s.seq)fail('Account baseline is invalid.');}
  const transactionIds=new Set(s.transactions.map(t=>t.id));
  for(const t of s.transactions) {
    string(t.note||'','Transaction note');dateKey(t.date);validMoney(t.amount,'Transaction amount');if(!Array.isArray(t.postings))fail('Missing postings.');
    if(!Number.isSafeInteger(t.seq)||t.seq<0||t.seq>s.seq)fail('Invalid transaction sequence.');
    if(t.category&&!categories.has(t.category))fail('Missing transaction category.');
    if(t.splits){if(!Array.isArray(t.splits)||t.splits.length<2||!['expense','refund'].includes(t.kind))fail('Invalid split transaction.');let total=0;for(const part of t.splits){if(!categories.has(part.category))fail('Split refers to a missing category.');validMoney(part.amount,'Split amount');if(part.amount<=0)fail('Split amounts must be positive.');total+=part.amount;}if(total!==t.amount)fail('Split amounts must equal the transaction total.');}
    for(const p of t.postings) {if(!accounts.has(p.account))fail('Missing posting account.');validMoney(p.amount,'Posting amount',true);}
    if(!['expense','income','refund','transfer','repayment','borrow','loan-out','loan-return','reversal'].includes(t.kind))fail('Invalid transaction type.');
    if(t.historical){if(t.postings.length||t.seq!==0)fail('Imported historical entries must not post to current balances.');}
    else if(t.kind==='reversal'){
      if(!transactionIds.has(t.reverses))fail('Correction refers to a missing transaction.');
      const original=s.transactions.find(x=>x.id===t.reverses);
      if(original.historical||original.kind==='reversal'||t.seq<=original.seq||t.postings.length!==original.postings.length||t.amount!==original.amount||t.postings.some((p,i)=>p.account!==original.postings[i].account||p.amount!==-original.postings[i].amount))fail('Correction postings are invalid.');
    } else {
      if(t.amount<=0||t.seq===0)fail('Actual transactions require a positive amount and sequence.');
      const paired=['transfer','repayment','borrow'].includes(t.kind),positive=['income','refund','loan-return'].includes(t.kind);
      if(t.postings.length!==(paired?2:1)||t.postings[0].account!==t.account||t.postings[0].amount!==(positive?t.amount:-t.amount))fail('Transaction postings do not match its amount.');
      if(paired&&(t.account===t.toAccount||t.postings[1].account!==t.toAccount||t.postings[1].amount!==t.amount))fail('Transfer postings are invalid.');
      const a=s.accounts.find(a=>a.id===t.account),to=s.accounts.find(a=>a.id===t.toAccount);
      if(t.kind==='income'&&a?.kind!=='asset'||t.kind==='transfer'&&(a?.kind!=='asset'||to?.kind!=='asset')||t.kind==='repayment'&&(a?.kind!=='asset'||to?.kind!=='liability')||t.kind==='borrow'&&(a?.kind!=='liability'||to?.kind!=='asset'))fail('Transaction account types do not match its purpose.');
    }
  }
  const reversals=s.transactions.filter(t=>t.reverses).map(t=>t.reverses);if(new Set(reversals).size!==reversals.length)fail('A transaction has been reversed more than once.');
  for(const batch of s.imports)if(batch.type==='csv'){
    if(!Array.isArray(batch.transactionIds)||!batch.transactionIds.length||new Set(batch.transactionIds).size!==batch.transactionIds.length||typeof batch.undone!=='boolean')fail('Invalid CSV import history.');
    for(const id of batch.transactionIds){const t=s.transactions.find(t=>t.id===id);if(!t||t.source!=='csv'||t.historical||batch.undone&&!reversals.includes(id))fail('CSV import history does not match its transactions.');}
  }
  for(const b of s.budgets) {if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.key)||!object(b.alloc)||!object(b.locks))fail('Invalid budget.');validMoney(b.salary,'Salary');for(const [id,n]of Object.entries(b.alloc)){if(!categories.has(id))fail('Missing budget category.');validMoney(n,'Budget allocation');}}
  for(const g of s.goals) {string(g.name,'Goal name',300);validMoney(g.target,'Goal target');if(g.desired)dateKey(g.desired);if(!Number.isInteger(g.priority)||g.priority<1||g.priority>1000)fail('Invalid goal priority.');if(g.recurringCost!=null)validMoney(g.recurringCost,'Ongoing cost');if(g.unitPrice!=null)validMoney(g.unitPrice,'Price quote');if(g.fees!=null)validMoney(g.fees,'Fees');if(g.quantity!=null&&(!Number.isFinite(g.quantity)||g.quantity<=0))fail('Quantity must be positive.');if(g.quoteDate)dateKey(g.quoteDate);}
  for(const g of s.goals){
    if(g.flexible===false&&!g.desired)fail('A hard deadline needs a date.');
    if(g.purchases&&!Array.isArray(g.purchases))fail('Invalid purchase history.');
    const purchases=g.purchases||[g.purchase].filter(Boolean),seen=new Set();
    for(const p of purchases){const t=s.transactions.find(t=>t.id===p.transaction);validMoney(p.amount,'Purchase cost');dateKey(p.date);if(!t||t.kind!=='expense'||t.amount!==p.amount||t.date!==p.date||seen.has(p.transaction))fail('Purchase history does not match the ledger.');seen.add(p.transaction);if(p.complete!=null&&typeof p.complete!=='boolean')fail('Invalid purchase completion flag.');if(p.reversedBy&&!s.transactions.some(t=>t.id===p.reversedBy&&t.reverses===p.transaction))fail('Invalid purchase correction.');}
  }
  for(const [id,n]of Object.entries(s.reservations)){if(!goals.has(id))fail('Missing reservation goal.');validMoney(n,'Goal reservation');}
  for(const r of s.reconciliations) {if(!accounts.has(r.account))fail('Missing reconciliation account.');dateKey(r.date);validMoney(r.balance,'Balance',true);if(r.difference!==null)validMoney(r.difference,'Difference',true);}
  for(const o of s.outside){validMoney(o.amount,'Outside amount');dateKey(o.date);if(o.returned!=null)validMoney(o.returned,'Returned amount');if((o.returned||0)>o.amount)fail('Returned amount exceeds the original record.');if(!['unclassified','gift','loan','investment','borrowed'].includes(o.kind))fail('Invalid outside classification.');}
  for(const o of s.outside){
    if(o.transaction){const t=s.transactions.find(t=>t.id===o.transaction);if(!t||t.historical||t.amount!==o.amount||t.date!==o.date||t.account!==o.account||t.kind!==(o.kind==='gift'?'expense':'loan-out'))fail('Outside payment does not match its cash entry.');if(o.reversedBy&&!s.transactions.some(t=>t.id===o.reversedBy&&t.reverses===o.transaction))fail('Invalid outside payment correction.');}
    if(o.returns){if(!Array.isArray(o.returns))fail('Invalid return history.');unique(o.returns,'returns');let total=0;for(const r of o.returns){const t=s.transactions.find(t=>t.id===r.transaction);if(!t||t.kind!=='loan-return'||t.amount!==r.amount||t.date!==r.date)fail('Outside return does not match its cash entry.');if(r.reversedBy){if(!s.transactions.some(t=>t.id===r.reversedBy&&t.reverses===r.transaction))fail('Invalid outside return correction.');}else total+=r.amount;}if(o.transaction&&total!==(o.returned||0))fail('Outstanding outside balance does not match its returns.');}
  }
  for(const o of s.obligations){string(o.name,'Event name',300);dateKey(o.date);validMoney(o.amount,'Scheduled amount',true);if(!['bill','income'].includes(o.kind)||!accounts.has(o.account)||(o.debtAccount&&!accounts.has(o.debtAccount)))fail('Invalid scheduled event.');if(o.kind==='income'&&o.amount>=0||o.kind==='bill'&&o.amount<=0)fail('Scheduled event sign does not match its type.');if(o.recurrence){if(!['monthly','weekly'].includes(o.recurrence.unit)||!Number.isInteger(o.recurrence.interval)||o.recurrence.interval<1||o.recurrence.interval>12)fail('Invalid repeat schedule.');if(o.recurrence.until){dateKey(o.recurrence.until);if(o.recurrence.until<o.date)fail('Repeat end precedes its start.');}}if(o.transaction&&!transactionIds.has(o.transaction))fail('Scheduled payment refers to a missing transaction.');}
  for(const h of s.holdings){validMoney(h.cost,'Holding cost');dateKey(h.date);if(h.quantity!=null&&(!Number.isFinite(h.quantity)||h.quantity<=0))fail('Invalid holding quantity.');}
  for(const c of s.categories){string(c.name,'Category name',300);if(!['fixed','variable','savings','buffer'].includes(c.type))fail('Invalid category type.');}
  for(const n of s.notes){string(n.title||'','Note title');string(n.body||'','Note body',50000);if(n.items&&!Array.isArray(n.items))fail('Invalid checklist.');}
  for(const key of ['reserve','monthlyProtection'])validMoney(s.settings[key],'Reserve');
  if(s.legacy?.raw){readLegacy(JSON.stringify(s.legacy.raw));if(s.legacy.rawText&&JSON.stringify(JSON.parse(s.legacy.rawText))!==JSON.stringify(s.legacy.raw))fail('Preserved original backup differs from its records.');}
  return s;
}
export function accountBalance(s,id,asOf=today(s.timezone)) {
  const a=s.accounts.find(a=>a.id===id);if(!a)fail('Account does not exist.');
  if(a.opening===null||asOf<a.baselineDate)return null;
  let result=a.opening;
  for(const t of s.transactions)if(t.seq>a.baselineSeq&&t.date<=asOf){
    // A later statement check already incorporates the original cash movement.
    // Correcting that old entry changes history, not a freshly verified bank balance.
    if(t.kind==='reversal'&&s.transactions.find(x=>x.id===t.reverses)?.seq<=a.baselineSeq)continue;
    for(const p of t.postings)if(p.account===id)result+=p.amount;
  }
  validMoney(result,'Calculated balance',true);return result;
}
export function summary(s,asOf=today(s.timezone)) {
  const asset=s.accounts.filter(a=>a.kind==='asset'),missing=asset.some(a=>accountBalance(s,a.id,asOf)===null);
  const cash=asset.reduce((n,a)=>n+(accountBalance(s,a.id,asOf)??0),0);
  const debt=s.accounts.filter(a=>a.kind==='liability').reduce((n,a)=>n+Math.max(0,-(accountBalance(s,a.id,asOf)??0)),0);
  const reserved=Object.values(s.reservations).reduce((a,b)=>a+b,0);
  const protectedAmount=Math.max(s.settings.reserve,s.goals.filter(g=>g.protected&&!g.archived).reduce((n,g)=>n+(s.reservations[g.id]||0),0));
  const extraReserve=Math.max(0,s.settings.reserve-s.goals.filter(g=>g.protected&&!g.archived).reduce((n,g)=>n+(s.reservations[g.id]||0),0));
  return {cash:missing?null:cash,knownCash:cash,debt,reserved,protected:protectedAmount,available:missing?null:cash-reserved-extraReserve,missing};
}
export function periodForecast(s,key,{mode='budget',extraExpense=0,incomeChange=0}={}) {
  const budgets=s.budgets.slice().sort((a,b)=>a.key.localeCompare(b.key));
  const b=budgets.find(b=>b.key===key)||budgets.filter(b=>b.key<=key).at(-1)||budgets[0];
  if(!b)return {income:0,spending:0,buffer:0,capacity:0,confidence:'No budget',assumptions:['Set a salary and spending budget.'],budget:null};
  const spendCats=s.categories.filter(c=>!['savings','buffer'].includes(c.type));
  const reversed=new Set(s.transactions.filter(t=>t.reverses).map(t=>t.reverses));
  const recorded=s.transactions.filter(t=>!reversed.has(t.id)&&periodKey(t.date,s.cycleStart)===key);
  const actualFor=id=>recorded.reduce((n,t)=>{const amount=t.splits?t.splits.filter(p=>p.category===id).reduce((a,b)=>a+b.amount,0):t.category===id?t.amount:0;return n+(t.kind==='expense'?amount:t.kind==='refund'?-amount:0);},0);
  let spending=spendCats.filter(c=>c.id!=='oneoff').reduce((n,c)=>n+Math.max(b.alloc[c.id]||0,actualFor(c.id)),0),buffer=b.alloc.buffer||0;
  const outside=s.outside.filter(o=>o.kind!=='borrowed'&&!o.reversedBy&&periodKey(o.date,s.cycleStart)===key&&!recorded.some(t=>t.id===o.transaction&&t.kind==='expense')).reduce((n,o)=>n+o.amount,0);
  const oneoff=Math.max(0,actualFor('oneoff'))+outside;
  spending+=Math.max(0,oneoff-(b.locks.buffer?0:buffer));
  const ranges=[1,2,3].map(n=>addMonths(key,-n));
  const histories=ranges.map(k=>s.transactions.filter(t=>!t.historical&&t.kind==='expense'&&periodKey(t.date,s.cycleStart)===k).reduce((n,t)=>n+t.amount,0));
  if(mode==='history'&&histories.some(n=>n>0))spending=Math.max(spending,Math.round(histories.reduce((a,b)=>a+b,0)/histories.filter(n=>n>0).length));
  if(mode==='conservative')spending=Math.ceil(spending*1.15);
  const income=b.salary+incomeChange;
  const committed=s.goals.filter(g=>g.completed&&g.recurringCost&&!g.recurringIncludedInBudget&&!g.purchase?.reversedBy).reduce((n,g)=>n+g.recurringCost,0);
  return {income,spending,buffer,committed,capacity:income-spending-buffer-extraExpense-committed,confidence:'Budget assumption',budget:b,
    assumptions:[`Salary and budget from ${b.key}.`,'Regular spending is reserved even when not individually logged.','Borrowing and expected repayments are not recurring income.',mode==='conservative'?'Spending increased by 15% for this scenario.':'Future income is not confirmed cash.']};
}
export function goalPurchases(g) {return (g.purchases||[g.purchase].filter(Boolean)).filter(p=>!p.reversedBy);}
export function goalRemaining(g) {return Math.max(0,g.target-goalPurchases(g).reduce((n,p)=>n+p.amount,0));}
/** Joint allocation: one pool, priority order, no reuse of funds; never spend protected savings. */
export function planGoals(s,{asOf=today(s.timezone),periods=12,mode='budget',extraExpense=0,incomeChange=0,protection=s.settings.monthlyProtection}={}) {
  dateKey(asOf);validMoney(extraExpense,'Extra expense');validMoney(incomeChange,'Income change',true);validMoney(protection,'Monthly protection');
  const now=summary(s,asOf),start=periodKey(asOf,s.cycleStart);
  const goals=s.goals.filter(g=>!g.archived&&!g.protected).slice().sort((a,b)=>{
    const ah=a.flexible===false&&!!a.desired,bh=b.flexible===false&&!!b.desired;
    return ah&&bh?a.desired.localeCompare(b.desired)||a.priority-b.priority||a.id.localeCompare(b.id):Number(bh)-Number(ah)||a.priority-b.priority||a.id.localeCompare(b.id);
  });
  const results=goals.map(g=>({id:g.id,name:g.name,target:goalRemaining(g),funded:now.missing?0:s.reservations[g.id]||0,remaining:Math.max(0,goalRemaining(g)-(now.missing?0:s.reservations[g.id]||0)),ready:null,deadline:g.desired||'',hard:g.flexible===false,late:false,allocations:[]}));
  const rows=[],warnings=[];
  if(now.missing)warnings.push('Account balances need a weekly check. Existing cash is excluded until verified.');
  let pool=Math.max(0,now.available??0);
  let existingShortfall=now.missing?now.protected:Math.max(0,-(now.available??0));
  let ongoingCost=0;
  const distribute=(date,key)=>{for(const g of results){const take=Math.min(pool,g.remaining);g.funded+=take;g.remaining-=take;pool-=take;if(take)g.allocations.push({key,amount:take,date});if(!g.remaining&&!g.ready){g.ready=date;ongoingCost+=s.goals.find(x=>x.id===g.id)?.recurringCost||0;}}};
  if(!now.missing&&existingShortfall===0)distribute(asOf,'existing');
  for(let i=1;i<=Math.min(60,Math.max(1,periods));i++) {
    const key=addMonths(start,i),forecast=periodForecast(s,key,{mode,extraExpense,incomeChange}),dates=periodDates(key,s.cycleStart);
    const delta=forecast.capacity-protection-ongoingCost-existingShortfall;
    const carriedShortfall=existingShortfall;existingShortfall=0;
    // A deficit consumes the unallocated purchase pool. If insufficient, the scenario is infeasible.
    if(delta<0) {
      const shortage=Math.max(0,-delta-pool);pool=Math.max(0,pool+delta);
      if(shortage){warnings.push(`${key}: shortfall of ${shortage} minor units after reserve contribution. No later purchase dates are reliable.`);rows.push({key,date:dates.to,capacity:forecast.capacity,protected:protection,contribution:delta,pool,shortage});break;}
    } else pool+=delta;
    const before=results.map(g=>g.funded);distribute(dates.to,key);
    rows.push({key,date:dates.to,capacity:forecast.capacity,protected:protection,contribution:delta,pool,allocated:results.reduce((n,g,j)=>n+g.funded-before[j],0),shortage:0,ongoingCost,carriedShortfall});
  }
  for(const g of results)g.late=!!g.deadline&&(!g.ready||g.ready>g.deadline);
  if(now.available!==null&&now.available<0)warnings.push('Cash is below existing reservations and reserve. The shortfall is deducted before funding purchases. Review balances and allocations.');
  if(results.some(g=>g.late))warnings.push('At least one desired date cannot be met under these assumptions. Try changing priority, price, spending or income.');
  return {results,rows,warnings,pool,mode,asOf,assumptions:['Dates are end-of-period funding estimates; check bill timing before buying.','Hard deadlines are funded earliest first, then flexible goals follow your priority.','Current period future surplus is excluded to avoid spending money twice.','Protected goals and reserve remain untouched.',...periodForecast(s,addMonths(start,1),{mode}).assumptions]};
}
export function cashCalendar(s,{asOf=today(s.timezone),days=60,events=[]}={}) {
  dateKey(asOf);if(!Number.isInteger(days)||days<1||days>730)fail('Calendar range must be 1–730 days.');
  const sum=summary(s,asOf);if(sum.cash===null)return {known:false,rows:[],minimum:null,warnings:['Verify every cash account before checking daily liquidity.']};
  const end=new Date(`${asOf}T12:00:00Z`);end.setUTCDate(end.getUTCDate()+days);const to=end.toISOString().slice(0,10);
  const dated=events.map(e=>{dateKey(e.date);validMoney(e.amount,'Cash event',true);return {...e};});
  for(const o of scheduledEvents(s,{from:asOf,to,includeOverdue:true}))if(!o.paid)dated.push({date:o.date<asOf?asOf:o.date,due:o.date,overdue:o.date<asOf,amount:-o.amount,name:o.name,account:o.account,estimated:true});
  dated.sort((a,b)=>a.date.localeCompare(b.date)||a.amount-b.amount);
  let running=sum.cash,minimum=running;const rows=[],accountBalances=Object.fromEntries(s.accounts.filter(a=>a.kind==='asset').map(a=>[a.id,accountBalance(s,a.id,asOf)])),warnings=[];
  for(const e of dated)if(e.date>=asOf&&e.date<=to){running+=e.amount;minimum=Math.min(minimum,running);if(e.account&&own(accountBalances,e.account)){accountBalances[e.account]+=e.amount;if(accountBalances[e.account]<0)warnings.push(`${e.name}: the selected account is short on ${e.date}. Transfer money before paying.`);}rows.push({...e,balance:running,accountBalance:e.account?accountBalances[e.account]:null});}
  if(minimum<sum.protected)warnings.push('Cash falls below the protected reserve before a scheduled income arrives.');
  if(dated.some(e=>e.overdue))warnings.push('Unpaid overdue events are included today. Record payment or revise their schedule.');
  return {known:true,rows,minimum,accountBalances,warnings:[...new Set(warnings)]};
}
/** Expand templates without marking any future occurrence paid or creating income. */
export function scheduledEvents(s,{from=today(s.timezone),to=from,includeOverdue=false}={}) {
  dateKey(from);dateKey(to);if(to<from)fail('Schedule end precedes its start.');
  const rows=[],stored=new Map(s.obligations.map(o=>[o.id,o]));
  for(const o of s.obligations.filter(o=>!o.templateId&&!o.archived)){
    let date=o.date,index=0;
    while(date<=to){
      const id=index?`${o.id}@${date}`:o.id,existing=stored.get(id),occurrence=existing||{...clone(o),id,date,templateId:o.id,paid:false};
      if(date>=from||includeOverdue&&!occurrence.paid)rows.push(occurrence);
      if(!o.recurrence)break;
      index++;if(index>20000)fail('Repeat schedule is too long.');
      if(o.recurrence.unit==='monthly'){const key=addMonths(o.date.slice(0,7),index*o.recurrence.interval),[y,m]=key.split('-').map(Number);date=dayAt(y,m-1,Number(o.date.slice(8)));}
      else{const next=new Date(`${o.date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+index*7*o.recurrence.interval);date=next.toISOString().slice(0,10);}
      if(o.recurrence.until&&date>o.recurrence.until)break;
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function recordScheduled(s,id,date=today(s.timezone)) {
  dateKey(date);if(date>today(s.timezone))fail('Expected income or bills cannot be recorded as paid in advance.');
  const o=scheduledEvents(s,{from:'1900-01-01',to:date}).find(o=>o.id===id);
  if(!o||o.paid)fail('Choose an unpaid occurrence due by the payment date.');
  const kind=o.kind==='income'?'income':o.debtAccount?'repayment':'expense';
  let next=addTransaction(s,{kind,amount:Math.abs(o.amount),date,account:o.account,toAccount:o.debtAccount||'',category:'oneoff',note:o.name,source:'scheduled'});
  return mutate(next,'obligation-paid',{id,date},n=>{
    let record=n.obligations.find(x=>x.id===id);if(!record){record=clone(o);delete record.recurrence;n.obligations.push(record);}
    record.paid=true;record.paidDate=date;record.transaction=n.transactions.at(-1).id;
  });
}
export function mutate(state,type,input,apply,operationId=uid()) {
  if(state.operations.some(o=>o.id===operationId))return state;
  const next=clone(state);next.seq++;next.version++;
  apply(next);
  const patches=[];
  for(const collection of ['accounts','transactions','reconciliations','categories','budgets','goals','obligations','outside','notes','holdings','cycleHistory','imports']) {
    const previous=new Map(state[collection].map(r=>[String(r.id),r]));
    for(const record of next[collection])if(!previous.has(String(record.id))||JSON.stringify(previous.get(String(record.id)))!==JSON.stringify(record))patches.push({collection,key:String(record.id),value:clone(record),action:'put'});
    if(state[collection].some(r=>!next[collection].some(x=>String(x.id)===String(r.id))))fail('Financial records cannot be deleted. Archive or correct them.');
  }
  for(const [key,amount]of Object.entries(next.reservations))if(state.reservations[key]!==amount)patches.push({collection:'reservations',key,value:{amount},action:'put'});
  const profile=s=>({schema:s.schema,id:s.id,seq:s.seq,currency:s.currency,timezone:s.timezone,cycleStart:s.cycleStart,name:s.name,settings:s.settings,legacy:s.legacy});
  if(JSON.stringify(profile(state))!==JSON.stringify(profile(next)))patches.push({collection:'preferences',key:'profile',value:clone(profile(next)),action:'put'});
  next.operations.push({id:operationId,type,input:clone(input),patches,baseVersion:state.version,version:next.version,seq:next.seq,at:new Date().toISOString(),sync:'pending'});
  validateState(next);return next;
}
export function addTransaction(s,input,operationId) {
  const {kind,date,amount,account,toAccount,category='',note=''}=input;
  dateKey(date);validMoney(amount,'Transaction amount');if(amount<=0)fail('Amount must be above zero.');string(note,'Note');
  const a=s.accounts.find(a=>a.id===account),to=s.accounts.find(a=>a.id===toAccount);
  if(!a)fail('Choose an account.');if(category&&!s.categories.some(c=>c.id===category))fail('Choose a category.');
  let postings;
  if(['expense','loan-out'].includes(kind))postings=[{account,amount:-amount}];
  else if(['income','refund','loan-return'].includes(kind)) {if(a.kind!=='asset'&&kind==='income')fail('Income must arrive in a cash account.');postings=[{account,amount}];}
  else if(['transfer','repayment','borrow'].includes(kind)) {
    if(!to||to.id===a.id)fail('Choose a different destination account.');
    if(kind==='transfer'&&(a.kind!=='asset'||to.kind!=='asset'))fail('Transfers are between your cash accounts.');
    if(kind==='repayment'&&(a.kind!=='asset'||to.kind!=='liability'))fail('Repayment moves cash to a debt account.');
    if(kind==='borrow'&&(a.kind!=='liability'||to.kind!=='asset'))fail('Borrowing moves money from debt to cash.');
    postings=[{account,amount:-amount},{account:toAccount,amount}];
  } else fail('Unsupported transaction kind.');
  return mutate(s,'transaction',input,n=>n.transactions.push({id:uid(),seq:n.seq,kind,date,amount,account,toAccount:toAccount||'',category,note,postings,historical:false,source:input.source||'manual',importKey:input.importKey||'',...(input.splits?{splits:clone(input.splits)}:{})}),operationId);
}
export function reverseTransaction(s,id,reason='Correction') {
  const t=s.transactions.find(t=>t.id===id);if(!t||t.historical||t.kind==='reversal'||s.transactions.some(x=>x.reverses===id))fail('This transaction cannot be reversed.');
  if(s.outside.some(o=>o.transaction===id&&(o.returned||0)>0))fail('Reverse the linked returns before correcting the original outgoing money.');
  return mutate(s,'reverse',{id,reason},n=>{
    const reversalId=uid();
    n.transactions.push({id:reversalId,seq:n.seq,kind:'reversal',date:t.date,amount:t.amount,account:t.account||'',toAccount:t.toAccount||'',category:t.category,note:reason,postings:t.postings.map(p=>({account:p.account,amount:-p.amount})),reverses:id,historical:false,source:'correction'});
    for(const record of n.outside)for(const returned of record.returns||[])if(returned.transaction===id&&!returned.reversedBy){record.returned-=returned.amount;returned.reversedBy=reversalId;}
    for(const record of n.outside)if(record.transaction===id)record.reversedBy=reversalId;
    for(const g of n.goals)if([...(g.purchases||[]),g.purchase].filter(Boolean).some(p=>p.transaction===id&&!p.reversedBy)){
      for(const p of [...(g.purchases||[]),g.purchase].filter(Boolean))if(p.transaction===id)p.reversedBy=reversalId;
      g.completed=goalPurchases(g).some(p=>p.complete!==false);if(g.archiveReason!=='manual')g.archived=g.completed;
      // Restoring a reservation automatically could spend cash already assigned elsewhere.
      // Keep it released and ask the user to review their allocation.
      for(const h of n.holdings)if(h.transaction===id)h.reversedBy=reversalId;
      for(const o of n.obligations)if(o.purchaseTransaction===id)o.archived=true;
    }
    for(const o of n.obligations)if(o.transaction===id){o.paid=false;o.reversedBy=reversalId;o.transaction='';}
  });
}
/** A planned purchase is one operation: cash, goal completion and holdings agree. */
export function purchaseGoal(s,{id,amount,account,date,complete=true,quantity=null}) {
  const g=s.goals.find(g=>g.id===id);dateKey(date);validMoney(amount,'Purchase amount');
  if(!g||g.archived||g.protected)fail('Choose an active purchase goal.');
  if(amount<=0||date>today(s.timezone))fail('Record a positive purchase that has already happened.');
  if(typeof complete!=='boolean')fail('Choose whether this finishes the purchase.');
  if(quantity!==null&&(!Number.isFinite(quantity)||quantity<=0))fail('Purchased quantity must be positive.');
  if(g.kind==='gold'&&!complete&&quantity===null)fail('Enter the actual gold quantity for a partial purchase.');
  const a=s.accounts.find(a=>a.id===account),balance=accountBalance(s,account,date),sum=summary(s,date);
  if(a.kind!=='asset'||balance===null||balance<amount)fail('Verify sufficient cash in this account before buying.');
  if(sum.available===null||amount>sum.available+(s.reservations[id]||0))fail('This purchase would use protected cash or money reserved for another goal.');
  const transaction=uid();
  return mutate(s,'goal-purchase',{id,amount,account,date,complete,quantity},n=>{
    n.transactions.push({id:transaction,seq:n.seq,kind:'expense',amount,date,account,toAccount:'',category:'oneoff',note:`Goal purchase: ${g.name}`,postings:[{account,amount:-amount}],historical:false,source:'goal',goal:id});
    const goal=n.goals.find(x=>x.id===id),beforeReservation=n.reservations[id]||0;
    goal.purchases=[...(goal.purchases||[goal.purchase].filter(Boolean)),{transaction,amount,date,complete,releasedReservation:beforeReservation,quantity}];goal.purchase=goal.purchases.at(-1);goal.completed=complete;goal.archived=complete;if(complete)goal.archiveReason='purchased';n.reservations[id]=complete?0:Math.max(0,beforeReservation-amount);
    if(goal.kind==='gold'){const remainingQuantity=goal.quantity==null?null:Math.max(0,goal.quantity-n.holdings.filter(h=>h.goal===id&&!h.reversedBy).reduce((total,h)=>total+(h.quantity||0),0));n.holdings.push({id:uid(),name:goal.name,quantity:quantity??(complete&&remainingQuantity>0?remainingQuantity:null),cost:amount,date,goal:id,transaction});}
    if(complete&&goal.recurringCost){const key=addMonths(date.slice(0,7),1),[y,m]=key.split('-').map(Number);n.obligations.push({id:uid(),name:`${goal.name}: ongoing cost`,kind:'bill',amount:goal.recurringCost,date:dayAt(y,m-1,Number(date.slice(8))),account,paid:false,recurrence:{unit:'monthly',interval:1,until:''},goal:id,purchaseTransaction:transaction});}
  });
}
export function reconcile(s,{account,date,balance,note=''}) {
  dateKey(date);validMoney(balance,'Balance',true);
  const a=s.accounts.find(a=>a.id===account);if(!a)fail('Choose an account.');if(date<a.baselineDate)fail('A balance check cannot precede the latest baseline.');
  const expected=accountBalance(s,account,date);
  return mutate(s,'reconcile',{account,date,balance,note},n=>{
    n.reconciliations.push({id:uid(),account,date,balance,expected,difference:expected===null?null:balance-expected,note,status:expected===null||balance===expected?'matched':'unresolved',seq:n.seq});
    const next=n.accounts.find(a=>a.id===account);next.opening=balance;next.baselineDate=date;next.baselineSeq=n.seq;next.verified=true;
  });
}
export function reserveGoal(s,id,amount) {
  validMoney(amount,'Reservation');const g=s.goals.find(g=>g.id===id);if(!g||g.archived)fail('Choose an active goal.');
  const sum=summary(s);if(sum.available===null)fail('Verify cash balances first.');
  if(amount>sum.available)fail('This reservation exceeds unreserved cash.');
  return mutate(s,'reserve',{id,amount},n=>{n.reservations[id]=(n.reservations[id]||0)+amount;});
}
export function releaseGoal(s,id,amount) {
  validMoney(amount,'Release');if(amount>(s.reservations[id]||0))fail('Cannot release more than this goal holds.');
  return mutate(s,'release',{id,amount},n=>{n.reservations[id]-=amount;});
}
export function archiveGoal(s,id) {
  if(!s.goals.some(g=>g.id===id))fail('Goal not found.');
  return mutate(s,'archive-goal',{id},n=>{const goal=n.goals.find(g=>g.id===id);goal.archived=true;goal.archiveReason='manual';n.reservations[id]=0;});
}
/** Record one outgoing cash movement and its recoverable outside-money record together. */
export function giveOutside(s,{name,kind,amount,account,date,note='',due=''}) {
  string(name,'Person / purpose',300);string(note,'Note');dateKey(date);if(due)dateKey(due);
  validMoney(amount,'Outside amount');if(!name.trim()||amount<=0||!['gift','loan','investment'].includes(kind))fail('Enter a purpose, positive amount and outside classification.');
  const a=s.accounts.find(a=>a.id===account);if(a?.kind!=='asset')fail('Choose the cash account this money left.');
  if(date>today(s.timezone))fail('Record money already sent; use the calendar for a future payment.');
  const id=uid(),transaction=uid();
  return mutate(s,'outside-given',{name,kind,amount,account,date,note,due},n=>{
    n.transactions.push({id:transaction,seq:n.seq,kind:kind==='gift'?'expense':'loan-out',amount,account,toAccount:'',date,category:'oneoff',note:note||`${kind}: ${name}`,postings:[{account,amount:-amount}],historical:false,source:'outside',outside:id});
    n.outside.push({id,name:name.trim(),kind,amount,account,date,note,due,returned:0,returns:[],transaction,source:'manual'});
  });
}
export function returnOutside(s,{id,amount,account,date,note=''}) {
  const record=s.outside.find(o=>o.id===id);validMoney(amount,'Return amount');dateKey(date);
  if(!record||record.reversedBy||!['loan','investment'].includes(record.kind))fail('Choose an active loan or investment record.');
  if(amount<=0||amount>record.amount-(record.returned||0))fail('Return must not exceed the outstanding amount.');
  if(s.accounts.find(a=>a.id===account)?.kind!=='asset')fail('Return must arrive in a cash account.');
  if(date<record.date||date>today(s.timezone))fail('Record a return received on or after the original payment, through today.');
  string(note,'Note');const transaction=uid();
  return mutate(s,'outside-return',{id,amount,date,account,note},n=>{
    n.transactions.push({id:transaction,seq:n.seq,kind:'loan-return',amount,account,toAccount:'',date,category:'',note:note||`Return: ${record.name}`,postings:[{account,amount}],historical:false,source:'outside',outside:id});
    const r=n.outside.find(o=>o.id===id);r.returned=(r.returned||0)+amount;r.returns=[...(r.returns||[]),{id:uid(),amount,date,transaction}];
  });
}
export function debtPayoff({balance,annualRate=0,payment,periods=600}) {
  validMoney(balance,'Debt');validMoney(payment,'Payment');
  if(!Number.isFinite(annualRate)||annualRate<0||annualRate>100)fail('Interest rate must be between 0 and 100 percent.');
  if(balance===0)return {months:0,total:0,interest:0,rows:[],feasible:true};
  if(payment<=0)return {months:null,total:0,interest:0,rows:[],feasible:false,reason:'Set a positive payment.'};
  const rows=[];let left=balance,total=0,interest=0;
  for(let i=1;i<=Math.min(600,periods);i++) {
    const fee=Math.round(left*annualRate/1200);
    if(fee>=payment)return {months:null,total,interest,rows,feasible:false,reason:'The payment does not cover monthly interest.'};
    const paid=Math.min(payment,left+fee);left=left+fee-paid;total+=paid;interest+=fee;rows.push({month:i,paid,interest:fee,remaining:left});
    if(left===0)return {months:i,total,interest,rows,feasible:true};
  }
  return {months:null,total,interest,rows,feasible:false,reason:'Not repaid within the 600-month limit.'};
}
export function csvParse(raw) {
  if(typeof raw!=='string'||raw.length>5e6)fail('CSV is empty or too large.');
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<raw.length;i++) {
    const c=raw[i];
    if(c==='"'){if(quoted&&raw[i+1]==='"'){cell+='"';i++;}else if(quoted){quoted=false;}else if(cell===''){quoted=true;}else fail('Unexpected quote in CSV.');}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)fail('CSV has an unclosed quote.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if(rows.length<2)fail('CSV needs column headings and at least one record.');
  const headers=rows.shift().map(v=>v.replace(/^\uFEFF/,'').trim());if(new Set(headers).size!==headers.length)fail('CSV headings must be unique.');
  if(rows.some(r=>r.length!==headers.length))fail('CSV rows have different column counts.');
  return {headers,rows};
}
export async function csvPreview(s,raw,{date,amount,note,account,category='oneoff',sign='negative-expense',creditKind='income',kindColumn='',toAccount=''}) {
  const csv=csvParse(raw),di=csv.headers.indexOf(date),ai=csv.headers.indexOf(amount),ni=csv.headers.indexOf(note);
  if(di<0||ai<0)fail('Map the date and amount columns.');
  if(!['negative-expense','positive-expense'].includes(sign)||!['income','refund'].includes(creditKind))fail('Choose valid sign and received-money mappings.');
  const ki=kindColumn?csv.headers.indexOf(kindColumn):-1;if(kindColumn&&ki<0)fail('Map the transaction type column.');
  const results=[],seen=new Set(s.transactions.map(t=>t.importKey).filter(Boolean));
  for(const row of csv.rows) {
    try{
      const dateValue=dateKey(row[di].trim()),value=money(row[ai].trim()),text=ni<0?'':row[ni];
      const kind=ki>=0?row[ki].trim().toLowerCase():sign==='positive-expense'?(value>=0?'expense':'refund'):(value<0?'expense':creditKind);
      const record={date:dateValue,amount:Math.abs(value),note:text,kind,account,toAccount,category,source:'csv'};
      // Run the same rules as a manual entry so invalid rows fail during preview.
      addTransaction(s,record);
      const key=await digest(JSON.stringify([account,dateValue,value,text]));
      const duplicate=seen.has(key);seen.add(key);results.push({record:{...record,importKey:key},duplicate,error:''});
    }catch(e){results.push({record:null,duplicate:false,error:e.message});}
  }
  return results;
}
export function applyCsv(s,rows) {
  if(rows.some(r=>r.error))fail('Fix invalid rows before importing.');
  let next=s;for(const r of rows)if(!r.duplicate&&!next.transactions.some(t=>t.importKey===r.record.importKey))next=addTransaction(next,r.record);
  const before=new Set(s.transactions.map(t=>t.id)),transactionIds=next.transactions.filter(t=>!before.has(t.id)).map(t=>t.id);
  if(transactionIds.length)next=mutate(next,'csv-import',{transactionIds},n=>n.imports.push({id:uid(),type:'csv',transactionIds,at:new Date().toISOString(),undone:false}));
  return next;
}
export function undoCsv(s,id) {
  const batch=s.imports.find(i=>i.id===id&&i.type==='csv');if(!batch||batch.undone)fail('Choose a CSV import that has not been undone.');
  let next=s;for(const transaction of batch.transactionIds)if(!next.transactions.some(t=>t.reverses===transaction))next=reverseTransaction(next,transaction,'Undo CSV import');
  return mutate(next,'csv-undo',{id},n=>{const item=n.imports.find(i=>i.id===id);item.undone=true;item.undoneAt=new Date().toISOString();});
}
export function expenseTotal(s,key) {
  const reversed=new Set(s.transactions.filter(t=>t.reverses).map(t=>t.reverses));
  return s.transactions.filter(t=>!reversed.has(t.id)&&periodKey(t.date,s.cycleStart)===key).reduce((n,t)=>n+(t.kind==='expense'?t.amount:t.kind==='refund'?-t.amount:0),0);
}
export function spendingInsights(s,key=periodKey(today(s.timezone),s.cycleStart)) {
  const b=s.budgets.find(b=>b.key===key),reversed=new Set(s.transactions.filter(t=>t.reverses).map(t=>t.reverses));
  const tx=s.transactions.filter(t=>!reversed.has(t.id)&&['expense','refund'].includes(t.kind)&&periodKey(t.date,s.cycleStart)===key),out=[];
  for(const category of s.categories.filter(c=>!['savings','buffer'].includes(c.type))) {
    const contributing=tx.filter(t=>t.splits?t.splits.some(p=>p.category===category.id):t.category===category.id);
    const actual=contributing.reduce((n,t)=>{const value=t.splits?t.splits.filter(p=>p.category===category.id).reduce((a,b)=>a+b.amount,0):t.amount;return n+(t.kind==='refund'?-value:value);},0),budget=b?.alloc[category.id]||0;
    if(actual>budget&&category.id!=='oneoff')out.push({kind:'over-budget',category:category.id,title:category.name,amount:actual-budget,evidence:contributing.map(t=>t.id)});
  }
  const unclassified=tx.filter(t=>t.category==='oneoff'&&!t.splits);
  if(unclassified.length)out.push({kind:'review',category:'oneoff',title:'Categorize recorded spending',count:unclassified.length,evidence:unclassified.map(t=>t.id)});
  if(!tx.length)out.push({kind:'missing',title:'No recorded expenses in this period',evidence:[]});
  const unresolved=s.reconciliations.filter(r=>r.status==='unresolved');
  if(unresolved.length)out.push({kind:'balance-review',title:'Investigate balance differences',count:unresolved.length,evidence:unresolved.map(r=>r.id)});
  return out;
}
export function csvExport(s) {
  const escape=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  // Prefix spreadsheet formula characters; retain actual values in the JSON backup.
  const safe=v=>typeof v==='string'&&/^[=+@\-\t\r]/.test(v)?"'"+v:v;
  return [['id','date','kind','amount','currency','account','category','note','source','historical'],...s.transactions.map(t=>[t.id,t.date,t.kind,(t.amount/100).toFixed(2),s.currency,t.account,t.category,t.note,t.source,t.historical])].map(r=>r.map(v=>escape(safe(v))).join(',')).join('\r\n');
}
