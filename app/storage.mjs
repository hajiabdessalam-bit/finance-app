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
export async function saveStore(db,state,expectedRevision) {
  validateState(state);
  const tx=db.transaction(['current','snapshots','outbox'],'readwrite'),finished=complete(tx);
  const current=tx.objectStore('current'),row=await request(current.get('state'));
  if((row?.revision||0)!==expectedRevision){tx.abort();await finished.catch(()=>{});throw new Error('Another tab saved newer records. Reload before editing; your existing records are safe.');}
  const revision=expectedRevision+1;
  if(row)tx.objectStore('snapshots').put({id:`${Date.now()}-${revision}`,at:new Date().toISOString(),revision:row.revision,state:row.state});
  current.put({state:clone(state),revision,savedAt:new Date().toISOString()},'state');
  for(const operation of state.operations)if(operation.sync==='pending')tx.objectStore('outbox').put({...clone(operation),stateId:state.id});
  const keys=await request(tx.objectStore('snapshots').getAllKeys());
  for(const key of keys.slice(0,Math.max(0,keys.length-30)))tx.objectStore('snapshots').delete(key);
  await finished;return revision;
}
export async function snapshots(db) {
  return (await request(db.transaction('snapshots','readonly').objectStore('snapshots').getAll())).reverse();
}
export async function storageHealth(){if(navigator.storage?.estimate){const {usage,quota}=await navigator.storage.estimate();return {usage,quota,persisted:await navigator.storage.persisted()};}return null;}
