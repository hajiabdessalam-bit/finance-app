/** Preparation for private sync. No HTTP route or database write is enabled here. */
import {validateState,clone,today,dateKey} from '../app/core.mjs';
import {applyPatches,sameJson} from '../app/sync.mjs';
import {validateTransitions} from './transitions.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed=new Set(['workspace','operationId','expectedVersion','patches','type']);
export function validateEnvelope(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!allowed.has(k)))throw new Error('Invalid operation envelope.');
  if(typeof request.workspace!=='string'||!request.workspace||request.workspace.length>200)throw new Error('Invalid workspace.');
  if(!UUID.test(request.operationId||''))throw new Error('Invalid operation ID.');
  if(!Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<0)throw new Error('Invalid workspace version.');
  if(typeof request.type!=='string'||!request.type||request.type.length>100)throw new Error('Invalid operation type.');
  if(!Array.isArray(request.patches)||!request.patches.length||request.patches.length>1000)throw new Error('Invalid operation size.');
  if(new TextEncoder().encode(JSON.stringify(request)).byteLength>2_000_000)throw new Error('Operation is too large.');
}
/** Validate the entire resulting state against a trusted, atomic server snapshot.
 * Authentication, permanent-user ownership, replay lookup and CAS must precede/guard
 * this check in the future server transport. This function alone is not authorization.
 */
export function validateOperation(current,request,{asOf=today(current.timezone)}={}) {
  validateState(current);
  dateKey(asOf); // Trusted server time, never a field supplied in the operation.
  validateEnvelope(request);
  if(request.workspace!==current.id)throw new Error('Wrong workspace.');
  if(!Number.isSafeInteger(request.expectedVersion)||request.expectedVersion<0||request.expectedVersion!==current.version)throw new Error('Workspace version conflict.');
  const next=applyPatches(current,request.patches);
  if(next.id!==current.id||next.schema!==current.schema||next.currency!==current.currency)throw new Error('Workspace identity or currency cannot be replaced by sync.');
  if(next.cycleStart!==current.cycleStart)throw new Error('The original cycle start cannot be rewritten. Schedule a future change.');
  if(!sameJson(next.legacy,current.legacy))throw new Error('Original imported records cannot be rewritten by sync.');
  for(const old of current.cycleHistory){
    const replacement=next.cycleHistory.find(c=>c.id===old.id);
    if(!replacement)throw new Error('Cycle history cannot be removed.');
    if(sameJson(old,replacement))continue;
    const cancellation={...old,status:'cancelled'};
    if(request.type!=='cycle-cancel'||old.status==='cancelled'||old.effective<=asOf||!sameJson(cancellation,replacement)||current.cycleHistory.some(c=>c.status!=='cancelled'&&c.effective>old.effective))throw new Error('Only the last future cycle change can be cancelled; earlier cycle history is immutable.');
  }
  const additions=next.cycleHistory.filter(c=>!current.cycleHistory.some(old=>old.id===c.id));
  if(additions.length&&(request.type!=='cycle-scheduled'||additions.length!==1||additions[0].status!=='scheduled'||additions[0].effective<=asOf||current.cycleHistory.some(c=>c.status!=='cancelled'&&c.effective>=additions[0].effective)))throw new Error('New cycle changes must be future, chronological schedules.');
  if(next.seq!==current.seq+1)throw new Error('Operation sequence must advance exactly once.');
  const existing=new Set(current.transactions.map(t=>t.id));
  for(const t of next.transactions)if(!existing.has(t.id)){
    if(t.historical||t.seq!==next.seq||t.amount<=0)throw new Error('New transactions require a positive amount and the current operation sequence.');
  }
  next.version=current.version+1;
  validateState(next);
  validateTransitions(current,next,request,asOf);
  return clone(next);
}
