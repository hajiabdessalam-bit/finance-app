/** Transport-independent sync protocol. It sends versioned operations, never a last-writer-wins state blob. */
import {clone,validateState} from './core.mjs';
export const COLLECTIONS=['accounts','transactions','reconciliations','categories','budgets','goals','obligations','outside','notes','holdings','cycleHistory','imports'];
const preferences=s=>({schema:s.schema,id:s.id,currency:s.currency,timezone:s.timezone,cycleStart:s.cycleStart,name:s.name,settings:clone(s.settings),legacy:clone(s.legacy)});
export function entities(state) {
  validateState(state);const rows=[];
  for(const collection of COLLECTIONS)for(const record of state[collection])rows.push({collection,key:String(record.id),value:clone(record)});
  for(const [key,amount]of Object.entries(state.reservations))rows.push({collection:'reservations',key,value:{amount}});
  rows.push({collection:'preferences',key:'profile',value:preferences(state)});
  return rows;
}
const identity=p=>`${p.collection}/${p.key}`;
export function diffEntities(before,after) {
  const old=new Map(entities(before).map(e=>[identity(e),e])),patches=[];
  for(const next of entities(after)) {
    const previous=old.get(identity(next));old.delete(identity(next));
    if(!previous||JSON.stringify(previous.value)!==JSON.stringify(next.value))patches.push({...next,action:'put'});
  }
  // Deletion is never propagated silently. Archive/reverse records instead.
  if(old.size)throw new Error('Sync cannot delete financial history. Archive or reverse the record.');
  return patches;
}
export function applyPatches(state,patches) {
  const next=clone(state);
  for(const patch of patches) {
    if(patch.action!=='put'||typeof patch.key!=='string')throw new Error('Invalid sync patch.');
    if(patch.collection==='preferences')Object.assign(next,clone(patch.value));
    else if(patch.collection==='reservations')next.reservations[patch.key]=patch.value.amount;
    else {
      if(!COLLECTIONS.includes(patch.collection)||String(patch.value.id)!==patch.key)throw new Error('Unknown collection or inconsistent record ID.');
      const collection=next[patch.collection],index=collection.findIndex(r=>String(r.id)===patch.key);
      if(index<0)collection.push(clone(patch.value));else collection[index]=clone(patch.value);
    }
  }
  return next;
}
export class SyncConflict extends Error {
  constructor(remoteVersion,operation){super('Another device changed this workspace. Review the remote records before applying your pending edit.');this.name='SyncConflict';this.remoteVersion=remoteVersion;this.operation=operation;}
}
/** Call only after sign-in, explicit cloud selection, and server ownership checks. */
export async function flushOperations({workspace,operations,remoteVersion,transport,onAck=async()=>{}}) {
  let version=remoteVersion;
  for(const op of operations) {
    if(!op.id||!Array.isArray(op.patches))throw new Error('Operation is missing its immutable ID or patches.');
    const result=await transport.apply({workspace,operationId:op.id,expectedVersion:version,patches:clone(op.patches),type:op.type});
    if(result.status==='conflict')throw new SyncConflict(result.version,op);
    if(!['applied','duplicate'].includes(result.status)||!Number.isSafeInteger(result.version))throw new Error('Server did not confirm this operation. Nothing was acknowledged.');
    version=result.version;await onAck(op.id,version);
  }
  return version;
}
