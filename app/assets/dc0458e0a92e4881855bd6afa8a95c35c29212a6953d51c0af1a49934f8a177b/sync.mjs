/** Transport-independent sync protocol. It sends versioned operations, never a last-writer-wins state blob. */
import {clone,validateState,fresh,digest} from './core.mjs';
export const COLLECTIONS=['accounts','transactions','reconciliations','categories','budgets','goals','obligations','outside','notes','holdings','cycleHistory','imports'];
const preferences=s=>({schema:s.schema,id:s.id,seq:s.seq,currency:s.currency,timezone:s.timezone,cycleStart:s.cycleStart,name:s.name,settings:clone(s.settings),legacy:clone(s.legacy)});
const PROFILE_KEYS=new Set(['schema','id','seq','currency','timezone','cycleStart','name','settings','legacy']);
export function entities(state) {
  validateState(state);const rows=[];
  for(const collection of COLLECTIONS)for(const record of state[collection])rows.push({collection,key:String(record.id),value:clone(record)});
  for(const [key,amount]of Object.entries(state.reservations))rows.push({collection:'reservations',key,value:{amount}});
  rows.push({collection:'preferences',key:'profile',value:preferences(state)});
  return rows;
}
const identity=p=>`${p.collection}/${p.key}`;
/** JSONB may reorder object keys. Arrays remain ordered; object key order is immaterial. */
export function sameJson(a,b) {
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)!==Array.isArray(b))return false;
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return ak.length===bk.length&&ak.every((key,i)=>key===bk[i]&&sameJson(a[key],b[key]));
}
export function diffEntities(before,after) {
  const old=new Map(entities(before).map(e=>[identity(e),e])),patches=[];
  for(const next of entities(after)) {
    const previous=old.get(identity(next));old.delete(identity(next));
    if(!previous||!sameJson(previous.value,next.value)){
      const value=next.collection==='preferences'&&previous?Object.fromEntries(Object.entries(next.value).filter(([key,value])=>!sameJson(value,previous.value[key]))):next.value;
      patches.push({...next,value,action:'put'});
    }
  }
  // Deletion is never propagated silently. Archive/reverse records instead.
  if(old.size)throw new Error('Sync cannot delete financial history. Archive or reverse the record.');
  return patches;
}
export function applyPatches(state,patches) {
  if(!Array.isArray(patches))throw new Error('Invalid sync patches.');
  const next=clone(state);
  const seen=new Set();
  for(const patch of patches) {
    if(!patch||patch.action!=='put'||typeof patch.key!=='string'||!patch.key||!patch.value||typeof patch.value!=='object'||Array.isArray(patch.value))throw new Error('Invalid sync patch.');
    if(seen.has(identity(patch)))throw new Error('Duplicate sync record.');seen.add(identity(patch));
    if(['__proto__','constructor','prototype'].includes(patch.key))throw new Error('Unsafe sync key.');
    if(patch.collection==='preferences'){
      if(patch.key!=='profile'||!patch.value||Object.keys(patch.value).some(k=>!PROFILE_KEYS.has(k)))throw new Error('Invalid workspace preferences.');
      Object.assign(next,clone(patch.value));
    }
    else if(patch.collection==='reservations')next.reservations[patch.key]=patch.value.amount;
    else {
      if(!COLLECTIONS.includes(patch.collection)||String(patch.value.id)!==patch.key)throw new Error('Unknown collection or inconsistent record ID.');
      const collection=next[patch.collection],index=collection.findIndex(r=>String(r.id)===patch.key);
      if(patch.collection==='transactions'&&index>=0&&!sameJson(collection[index],patch.value))throw new Error('Transactions are immutable. Add a linked correction.');
      if(index<0)collection.push(clone(patch.value));else collection[index]=clone(patch.value);
    }
  }
  return next;
}
/** Rebuild a verified state from one atomic server snapshot, never from mixed reads. */
export function hydrateSnapshot(snapshot) {
  if(!snapshot||typeof snapshot.workspace!=='string'||!Number.isSafeInteger(snapshot.version)||snapshot.version<0||!Array.isArray(snapshot.records))throw new Error('Invalid cloud snapshot.');
  const ids=new Set(),patches=[];
  for(const r of snapshot.records){const id=identity(r);if(ids.has(id)||!Number.isSafeInteger(r.version)||r.version<1||r.version>snapshot.version)throw new Error('Inconsistent cloud records.');ids.add(id);patches.push({collection:r.collection,key:r.key,value:r.value,action:'put'});}
  if(!ids.has('preferences/profile'))throw new Error('Cloud workspace is not initialized.');
  const next=applyPatches(fresh(),patches);
  if(next.id!==snapshot.workspace)throw new Error('Cloud records belong to a different workspace.');
  next.version=snapshot.version;
  // Older previews did not transmit seq. Derive a safe lower bound for recovery.
  next.seq=Math.max(next.seq,...next.transactions.map(t=>t.seq),...next.accounts.map(a=>a.baselineSeq),...next.reconciliations.map(r=>r.seq||0));
  next.operations=[];
  if(snapshot.operations!==undefined){
    if(!Array.isArray(snapshot.operations))throw new Error('Invalid cloud operation audit.');
    const operationIds=new Set(),versions=new Set();
    if(snapshot.operations.some(o=>!o||typeof o!=='object'||!Array.isArray(o.patches)))throw new Error('Invalid cloud operation audit.');
    for(const operation of snapshot.operations.slice().sort((a,b)=>a.version-b.version)){
      const seq=operation.patches?.find(p=>p.collection==='preferences'&&p.key==='profile')?.value?.seq;
      if(typeof operation.id!=='string'||!operation.id||operationIds.has(operation.id)||!Number.isSafeInteger(operation.version)||operation.version<1||operation.version>snapshot.version||versions.has(operation.version)||typeof operation.type!=='string'||!operation.type||operation.type.length>100||!Array.isArray(operation.patches)||!Number.isSafeInteger(seq)||seq<1||seq>next.seq||typeof operation.at!=='string'||!Number.isFinite(Date.parse(operation.at)))throw new Error('Inconsistent cloud operation audit.');
      operationIds.add(operation.id);versions.add(operation.version);
      next.operations.push({id:operation.id,type:operation.type,input:{},patches:clone(operation.patches),baseVersion:operation.version-1,version:operation.version,seq,at:operation.at,sync:'synced',provenance:'cloud'});
    }
  }
  validateState(next);return next;
}
export function conflictReview(local,remote) {
  validateState(local);validateState(remote);if(local.id!==remote.id)throw new Error('Cannot compare different workspaces.');
  const ours=new Map(entities(local).map(e=>[identity(e),e])),changes=[];
  for(const theirs of entities(remote)){const key=identity(theirs),mine=ours.get(key);ours.delete(key);if(!mine||!sameJson(mine.value,theirs.value))changes.push({collection:theirs.collection,key:theirs.key,local:mine?.value||null,remote:theirs.value});}
  for(const mine of ours.values())changes.push({collection:mine.collection,key:mine.key,local:mine.value,remote:null});
  return {changes,pending:local.operations.filter(o=>o.sync==='pending').map(clone),requiresReview:true};
}
/** Stable JSON digests bind a review to exact records, independent of JSONB key order. */
export function canonicalJson(value) {
  const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  return JSON.stringify(sort(clone(value)));
}
function compatibleSnapshots(local,remote){
  if(local.id!==remote.id||local.schema!==remote.schema||local.currency!==remote.currency)throw new Error('Cloud records belong to a different workspace or currency.');
  if(!sameJson(local.legacy,remote.legacy))throw new Error('Original imported history differs. Keep both backups and investigate before replacing records.');
  const originals=new Map(local.transactions.map(t=>[t.id,t]));
  for(const t of remote.transactions)if(originals.has(t.id)&&!sameJson(originals.get(t.id),t))throw new Error('A shared transaction was rewritten. Keep both versions for investigation.');
}
/** A verified server read supplies snapshot. This function does not authenticate or transmit. */
export async function prepareRemoteReview(local,snapshot){
  validateState(local);const remote=hydrateSnapshot(snapshot);compatibleSnapshots(local,remote);
  const review={app:'plan-sync-review',schema:1,workspace:local.id,local:clone(local),snapshot:clone(snapshot),remote,
    localDigest:await digest(canonicalJson(local)),remoteDigest:await digest(canonicalJson(remote)),
    ...conflictReview(local,remote),automaticReplay:false};
  return {...review,digest:await digest(canonicalJson(review))};
}
export async function verifyRemoteReview(current,review,reviewDigest){
  validateState(current);
  if(!review||review.app!=='plan-sync-review'||review.schema!==1||typeof reviewDigest!=='string'||reviewDigest!==review.digest)throw new Error('Review the exact cloud comparison before continuing.');
  if(await digest(canonicalJson(current))!==review.localDigest)throw new Error('Local records changed after this review. Prepare a fresh comparison.');
  const rebuilt=await prepareRemoteReview(current,review.snapshot);
  if(rebuilt.digest!==reviewDigest||!sameJson(rebuilt,review))throw new Error('The comparison changed after review. Nothing has been replaced.');
  return clone(rebuilt.remote);
}
export class SyncConflict extends Error {
  constructor(remoteVersion,operation){super('Another device changed this workspace. Review the remote records before applying your pending edit.');this.name='SyncConflict';this.remoteVersion=remoteVersion;this.operation=operation;}
}
/** Call only after sign-in, explicit cloud selection, and server ownership checks. */
export async function flushOperations({workspace,operations,remoteVersion,transport,onAck=async()=>{}}) {
  if(typeof workspace!=='string'||!workspace||workspace.length>200||!Number.isSafeInteger(remoteVersion)||remoteVersion<0||!Array.isArray(operations)||typeof transport?.apply!=='function'||typeof onAck!=='function')throw new Error('Choose an authenticated workspace and its exact cloud baseline.');
  // Freeze the entire reviewed queue before any network or acknowledgment await.
  // A newer server version must never become a replacement base for an old edit.
  const captured=clone(operations),ids=new Set();
  for(let i=0;i<captured.length;i++){
    const op=captured[i],base=remoteVersion+i;
    if(!op||typeof op.id!=='string'||!op.id||ids.has(op.id)||typeof op.type!=='string'||!op.type||!Array.isArray(op.patches)||op.baseVersion!==base||op.version!==base+1||!Number.isSafeInteger(op.version))throw new Error('Review the exact contiguous operation versions before sending edits. No automatic rebasing is allowed.');
    ids.add(op.id);
  }
  let version=remoteVersion;
  for(const op of captured) {
    const result=await transport.apply({workspace,operationId:op.id,expectedVersion:op.baseVersion,patches:clone(op.patches),type:op.type});
    if(!result||!Number.isSafeInteger(result.version)||result.version<0||!['applied','duplicate','conflict'].includes(result.status))throw new Error('Server did not confirm this operation. Nothing was acknowledged.');
    if(result.status==='conflict')throw new SyncConflict(result.version,op);
    if(result.status==='duplicate'&&result.version>op.version)throw new SyncConflict(result.version,op);
    if(result.version!==op.version)throw new Error('Server did not confirm the exact operation version. Nothing was acknowledged.');
    version=result.version;await onAck(op.id,version);
  }
  return version;
}
