/** Private server boundary preparation; no deployed route or credentials. */
import {clone} from '../app/core.mjs';
import {hydrateSnapshot,sameJson} from '../app/sync.mjs';
import {validateEnvelope,validateOperation} from './validation.mjs';
import {validateBootstrap} from './bootstrap.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** verifySession must perform server-confirmed verification, not decode client claims.
 * store uses server-only validated RPCs. Owner never comes from a request body. */
export function syncService({verifySession,store,destination}){
  if(typeof verifySession!=='function'||typeof store?.read!=='function'||typeof store?.apply!=='function')throw new Error('Provide a verified session and private store adapter.');
  const actor=async token=>{if(typeof token!=='string'||!token||token.length>10000)throw new Error('Sign in with a permanent account.');const user=await verifySession(token);if(!user||!UUID.test(user.id||'')||user.is_anonymous!==false)throw new Error('Sign in with a verified permanent account.');return user.id;};
  const workspace=id=>{if(typeof id!=='string'||!id||id.length>200)throw new Error('Invalid workspace.');return id;};
  return {
    async bootstrap({token,request}){
      const owner=await actor(token),command=await validateBootstrap(request,destination);
      if(typeof store.bootstrap!=='function')throw new Error('Reviewed first upload is not configured.');
      const result=await store.bootstrap(owner,command);
      if(!result||!['initialized','duplicate','conflict'].includes(result.status)||!Number.isSafeInteger(result.version)||result.version<1||result.status==='initialized'&&result.version!==1)throw new Error('The database did not confirm the first upload. Read and review cloud records before continuing.');
      return {status:result.status,version:result.version};
    },
    async read({token,workspace:id}){const owner=await actor(token),snapshot=await store.read(owner,workspace(id));if(!snapshot)return null;if(snapshot.workspace!==id)throw new Error('The store returned a different workspace.');hydrateSnapshot(snapshot);return clone(snapshot);},
    async apply({token,request}){
      const owner=await actor(token);validateEnvelope(request);const command=clone(request),snapshot=await store.read(owner,command.workspace);
      if(!snapshot)throw new Error('Review and initialize this workspace before sending incremental edits.');
      if(snapshot.workspace!==command.workspace)throw new Error('The store returned a different workspace.');
      const current=hydrateSnapshot(snapshot),previous=(snapshot.operations||[]).find(o=>o.id===command.operationId);
      if(previous){if(previous.type!==command.type||!sameJson(previous.patches,command.patches))throw new Error('An operation ID cannot be reused for different content.');return {status:'duplicate',version:current.version};}
      if(command.expectedVersion!==current.version)return {status:'conflict',version:current.version};
      validateOperation(current,command); // Whole-state financial and historical invariants.
      const result=await store.apply(owner,command); // Database CAS checks the same trusted version.
      if(!result||!['applied','duplicate','conflict'].includes(result.status)||!Number.isSafeInteger(result.version)||result.version<0||result.status==='applied'&&result.version!==current.version+1)throw new Error('The database did not confirm a valid operation result.');
      return {status:result.status,version:result.version};
    }
  };
}
