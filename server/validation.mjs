/** Preparation for private sync. No HTTP route or database write is enabled here. */
import {validateState,clone} from '../app/core.mjs';
import {applyPatches} from '../app/sync.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed=new Set(['workspace','operationId','expectedVersion','patches','type']);
/** Validate the entire resulting state against a trusted, atomic server snapshot.
 * Authentication, permanent-user ownership, replay lookup and CAS must precede/guard
 * this check in the future server transport. This function alone is not authorization.
 */
export function validateOperation(current,request) {
  validateState(current);
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!allowed.has(k)))throw new Error('Invalid operation envelope.');
  if(request.workspace!==current.id)throw new Error('Wrong workspace.');
  if(!UUID.test(request.operationId||''))throw new Error('Invalid operation ID.');
  if(!Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<0||request.expectedVersion!==current.version)throw new Error('Workspace version conflict.');
  if(typeof request.type!=='string'||!request.type||request.type.length>100)throw new Error('Invalid operation type.');
  if(!Array.isArray(request.patches)||!request.patches.length||request.patches.length>1000)throw new Error('Invalid operation size.');
  // Below the platform's request ceiling, measured in UTF-8 bytes rather than characters.
  if(new TextEncoder().encode(JSON.stringify(request)).byteLength>2_000_000)throw new Error('Operation is too large.');
  const next=applyPatches(current,request.patches);
  if(next.id!==current.id||next.schema!==current.schema||next.currency!==current.currency)throw new Error('Workspace identity or currency cannot be replaced by sync.');
  if(next.seq!==current.seq+1)throw new Error('Operation sequence must advance exactly once.');
  const existing=new Set(current.transactions.map(t=>t.id));
  for(const t of next.transactions)if(!existing.has(t.id)){
    if(t.historical||t.seq!==next.seq||t.amount<=0)throw new Error('New transactions require a positive amount and the current operation sequence.');
  }
  next.version=current.version+1;
  validateState(next);
  return clone(next);
}
