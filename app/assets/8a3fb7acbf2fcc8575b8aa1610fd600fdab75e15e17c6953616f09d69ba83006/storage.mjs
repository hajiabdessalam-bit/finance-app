import {validateState, clone} from './core.mjs';
import {verifyRemoteReview,sameJson} from './sync.mjs';
import {verifyBackupReview} from './backup.mjs';
const DB='plan-finance-v2',VERSION=1;
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function complete(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Storage write failed.'));tx.onabort=()=>reject(tx.error||new Error('Storage transaction was cancelled.'));});}
export async function openStore() {
  if(!globalThis.indexedDB)throw new Error('This browser cannot store PLAN records. Use a supported browser before editing.');
  const req=indexedDB.open(DB,VERSION);
  req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('current');db.createObjectStore('snapshots',{keyPath:'id'});db.createObjectStore('outbox',{keyPath:'id'});};
  const db=await request(req);db.onversionchange=()=>db.close();return db;
}
export async function loadStore(db) {
  const tx=db.transaction('current','readonly'),row=await request(tx.objectStore('current').get('state'));
  if(!row)return {state:null,revision:0};
  validateState(row.state);return row;
}
/** State, recovery checkpoint, and idempotent outbox enter one IndexedDB transaction. */
export async function saveStore(db,state,expectedRevision,draftId=null,{restore=false}={}) {
  validateState(state);
  const tx=db.transaction(['current','snapshots','outbox'],'readwrite'),finished=complete(tx);
  const current=tx.objectStore('current'),row=await request(current.get('state'));
  if((row?.revision||0)!==expectedRevision){tx.abort();await finished.catch(()=>{});throw new Error('Another tab saved newer records. Reload before editing; your existing records are safe.');}
  if(draftId){const draft=await request(current.get(`draft:${draftId}`));if(!draft){tx.abort();await finished.catch(()=>{});throw new Error('This draft was already applied or discarded. No new changes were saved.');}current.delete(`draft:${draftId}`);}
  const revision=expectedRevision+1;
  if(row)tx.objectStore('snapshots').put({id:`${Date.now()}-${revision}`,at:new Date().toISOString(),revision:row.revision,state:row.state});
  current.put({state:clone(state),revision,savedAt:new Date().toISOString()},'state');
  const outbox=tx.objectStore('outbox'),queued=await request(outbox.getAll());
  let syncHold=await request(current.get('sync-hold'));
  if(restore){
    if(row){const id=crypto.randomUUID();current.put({id,at:new Date().toISOString(),revision:row.revision,workspace:row.state.id,state:clone(row.state),restoredWorkspace:state.id,operations:clone(queued),previousHold:syncHold||null,permanent:true},'restore-recovery:'+id);}
    // Preserve the old queue for review, but never replay it over restored records.
    // A future cloud bootstrap must explicitly resolve this hold before sending edits.
    if(queued.length)current.put({at:new Date().toISOString(),workspace:row?.state.id,operations:clone(queued)},`outbox-recovery:${crypto.randomUUID()}`);
    syncHold={workspace:state.id,reason:'Reviewed restore requires a new cloud baseline',at:new Date().toISOString()};
    current.put(syncHold,'sync-hold');
  }
  const pending=syncHold?[]:state.operations.filter(operation=>operation.sync==='pending');
  const pendingIds=new Set(pending.map(operation=>operation.id));
  for(const operation of queued)if(operation.stateId!==state.id||!pendingIds.has(operation.id))outbox.delete(operation.id);
  for(const operation of pending)outbox.put({...clone(operation),stateId:state.id});
  const keys=await request(tx.objectStore('snapshots').getAllKeys());
  for(const key of keys.slice(0,Math.max(0,keys.length-30)))tx.objectStore('snapshots').delete(key);
  await finished;return revision;
}
export async function snapshots(db) {
  const current=db.transaction('current','readonly').objectStore('current'),keys=await request(current.getAllKeys());
  const retained=await Promise.all(keys.filter(k=>String(k).startsWith('restore-recovery:')).map(k=>request(current.get(k))));
  const recent=await request(db.transaction('snapshots','readonly').objectStore('snapshots').getAll());
  return [...retained,...recent.filter(row=>!retained.some(saved=>saved.revision===row.revision&&saved.workspace===row.state.id))].sort((a,b)=>b.at.localeCompare(a.at)||b.revision-a.revision);
}
/** Restore only a confirmed, unchanged preview; saveStore makes retention and CAS atomic.
 * @param {IDBDatabase} db
 * @param {any} review
 * @param {{expectedRevision:number,reviewDigest:string,confirmed?:boolean}} options
 */
export async function restoreReviewedBackup(db,review,{expectedRevision,reviewDigest,confirmed=false}={}){
  if(confirmed!==true)throw new Error('Review the selected records and confirm the local replacement.');
  const row=await loadStore(db);
  if(row.revision!==expectedRevision)throw new Error('Another tab saved newer records. Preview the backup again.');
  const state=await verifyBackupReview(row.state,review,reviewDigest);
  const revision=await saveStore(db,state,expectedRevision,null,{restore:true});
  return {state,revision};
}
// Drafts are separate from confirmed records and never enter the sync outbox.
export async function saveDraft(db,draft) {
  const tx=db.transaction('current','readwrite'),done=complete(tx);
  tx.objectStore('current').put(clone(draft),`draft:${draft.id}`);await done;
}
export async function loadDrafts(db) {
  const store=db.transaction('current','readonly').objectStore('current');
  const keys=await request(store.getAllKeys());
  return Promise.all(keys.filter(k=>String(k).startsWith('draft:')).map(k=>request(db.transaction('current','readonly').objectStore('current').get(k))));
}
export async function removeDraft(db,id) {
  const tx=db.transaction('current','readwrite'),done=complete(tx);tx.objectStore('current').delete(`draft:${id}`);await done;
}
/** Local audit download only. These held operations must never be automatically replayed. */
export async function syncRecovery(db) {
  const store=db.transaction('current','readonly').objectStore('current');
  const keys=await request(store.getAllKeys());
  const archives=await Promise.all(keys.filter(k=>String(k).startsWith('outbox-recovery:')).map(k=>request(store.get(k))));
  const hold=await request(store.get('sync-hold'));
  const row=await request(store.get('state'));
  const reviews=await Promise.all(keys.filter(k=>String(k).startsWith('sync-review:')).map(k=>request(store.get(k))));
  const baseline=await request(store.get('cloud-baseline'));
  const restores=await Promise.all(keys.filter(k=>String(k).startsWith('restore-recovery:')).map(k=>request(store.get(k))));
  return {app:'plan-sync-recovery',schema:1,reviewOnly:true,automaticReplay:false,hold:hold||null,archives,
    restores,currentPending:row?.state.operations.filter(o=>o.sync==='pending').map(clone)||[],reviews,baseline:baseline||null};
}
/** Adopt only the exact reviewed server snapshot; retain both histories permanently on device.
 * Caller must obtain the snapshot from a verified server read and show this comparison.
 * No pending operation is automatically merged, discarded, rebased or replayed. */
export async function adoptReviewedRemote(db,review,{reviewDigest,expectedRevision,confirmed=false}={}){
  if(confirmed!==true)throw new Error('Review both versions and confirm the selected cloud records.');
  const remote=await verifyRemoteReview(review?.local,review,reviewDigest);
  const tx=db.transaction(['current','snapshots','outbox'],'readwrite'),finished=complete(tx),current=tx.objectStore('current');
  const row=await request(current.get('state'));
  if(!row||row.revision!==expectedRevision||!sameJson(row.state,review.local)){
    tx.abort();await finished.catch(()=>{});throw new Error('Another tab changed the records after review. Nothing has been replaced.');
  }
  const queue=await request(tx.objectStore('outbox').getAll()),hold=await request(current.get('sync-hold')),at=new Date().toISOString(),revision=row.revision+1;
  const archive={at,workspace:row.state.id,review:clone(review),previousLocal:clone(row.state),operations:clone(queue),previousHold:hold||null};
  current.put(archive,`sync-review:${crypto.randomUUID()}`);
  tx.objectStore('snapshots').put({id:`${Date.now()}-${revision}`,at,revision:row.revision,state:row.state});
  current.put({state:remote,revision,savedAt:at},'state');
  current.put({workspace:remote.id,version:remote.version,reviewDigest,at},'cloud-baseline');
  for(const op of queue)tx.objectStore('outbox').delete(op.id);
  if(queue.length||review.pending.length||hold)current.put({workspace:remote.id,reason:'Offline edits retained in the cloud comparison; review before enabling new sync',at},'sync-hold');
  else current.delete('sync-hold');
  await finished;return revision;
}
/** A verified caller may acknowledge one exact queued operation and receipt.
 * Revision, queue, reviewed baseline and hold checks share the same transaction.
 * This helper never sends records or enables synchronization by itself. */
export async function acknowledgeOperation(db,{workspace,operation,receipt,expectedRevision}){
  const captured=clone(operation),confirmed=clone(receipt);
  if(!captured||!Number.isSafeInteger(captured.baseVersion)||captured.version!==captured.baseVersion+1||!['applied','duplicate'].includes(confirmed?.status)||confirmed.version!==captured.version)throw new Error('An exact successful cloud receipt is required. Nothing was acknowledged.');
  const tx=db.transaction(['current','outbox'],'readwrite'),finished=complete(tx),current=tx.objectStore('current'),outbox=tx.objectStore('outbox');
  const row=await request(current.get('state')),hold=await request(current.get('sync-hold')),baseline=await request(current.get('cloud-baseline')),queued=await request(outbox.get(captured.id));
  const local=row?.state.operations.find(op=>op.id===captured.id),queueOperation=queued?Object.fromEntries(Object.entries(queued).filter(([key])=>key!=='stateId')):null;
  if(!row||row.revision!==expectedRevision||row.state.id!==workspace||hold||baseline?.workspace!==workspace||baseline.version!==captured.baseVersion||queued?.stateId!==workspace||local?.sync!=='pending'||!sameJson(local,captured)||!sameJson(queueOperation,captured)){
    tx.abort();await finished.catch(()=>{});throw new Error('Local records, queue or reviewed cloud baseline changed. Nothing was acknowledged.');
  }
  const state=clone(row.state),at=new Date().toISOString(),revision=row.revision+1;
  state.operations.find(op=>op.id===captured.id).sync='synced';
  current.put({state,revision,savedAt:at},'state');current.put({...baseline,version:confirmed.version,at},'cloud-baseline');outbox.delete(captured.id);
  await finished;return {state,revision};
}
/** Browser storage hints are optional. Their failure must never close a workspace. */
export async function storageHealth(storage=globalThis.navigator?.storage){
  if(!storage)return null;
  let usage=null,quota=null,persisted=null;
  if(typeof storage.estimate==='function')try{const estimate=await storage.estimate();if(Number.isFinite(estimate.usage)&&estimate.usage>=0)usage=estimate.usage;if(Number.isFinite(estimate.quota)&&estimate.quota>0)quota=estimate.quota;}catch{}
  if(typeof storage.persisted==='function')try{const result=await storage.persisted();if(typeof result==='boolean')persisted=result;}catch{}
  return {usage,quota,persisted};
}
