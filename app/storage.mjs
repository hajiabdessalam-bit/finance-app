import {validateState, clone} from './core.mjs';
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
  return (await request(db.transaction('snapshots','readonly').objectStore('snapshots').getAll())).reverse();
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
  return {app:'plan-sync-recovery',schema:1,reviewOnly:true,automaticReplay:false,hold:hold||null,archives};
}
export async function storageHealth(){if(navigator.storage?.estimate){const {usage,quota}=await navigator.storage.estimate();return {usage,quota,persisted:await navigator.storage.persisted()};}return null;}
