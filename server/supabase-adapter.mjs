/** Server-only adapter preparation. No credentials or network calls at module load. */
import {validateEnvelope} from './validation.mjs';
import {validateBootstrap} from './bootstrap.mjs';
import {Buffer} from 'node:buffer';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function supabaseAdapter({url,publishableKey,secretKey,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=15000}){
  if(typeof window!=='undefined')throw new Error('The private database adapter must run on the server.');
  let base;try{base=new URL(url);}catch{throw new Error('Configure a valid Supabase project endpoint.');}
  if(base.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)||base.username||base.password||base.search||base.hash||base.pathname!=='/'||base.port)throw new Error('Use the configured HTTPS Supabase project endpoint.');
  if(typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)||typeof secretKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey))throw new Error('Configure separate publishable and server secret keys.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('Configure a bounded private request deadline.');
  const actor=id=>{if(!UUID.test(id||''))throw new Error('A verified actor is required.');return id;};
  const conversationWorkspace=id=>{if(typeof id!=='string'||!id||id.length>200)throw new Error('Choose the admitted private workspace.');return id;};
  async function request(path,{key=secretKey,token,body}={}){
    const controller=new AbortController();let timer;
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Private request timed out.'));},timeoutMs);});
    const execute=async()=>{
      const response=await fetchImpl(new URL(path,base).href,{method:body===undefined?'GET':'POST',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:controller.signal});
      if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});controller.signal.throwIfAborted();}
      if(!response.ok){void response.body?.cancel().catch(()=>{});if(token&&(response.status===401||response.status===403))return null;throw new Error('Remote request failed.');}
      const reader=response.body?.getReader();if(!reader)throw new Error('No response body.');const chunks=[];let size=0;
      const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10_000_000){void reader.cancel().catch(()=>{});throw new Error('Response is too large.');}chunks.push(part.value);}}
      finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
      controller.signal.throwIfAborted();
      const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
    };
    try{return await Promise.race([execute(),expired]);}
    catch{throw new Error('Supabase could not confirm the request. No edit has been acknowledged.');}
    finally{clearTimeout(timer);}
  }
  return {
    admit:({owner})=>request('/rest/v1/rpc/plan_sync_admit',{body:{p_owner:actor(owner)}}),
    async verifySession(token){
      if(typeof token!=='string'||!token||token.length>10000||/\s/.test(token))return null;
      // Auth authenticates the exact token before any decoded claim is trusted.
      const user=await request('/auth/v1/user',{key:publishableKey,token});
      if(!user||!UUID.test(user.id||'')||user.is_anonymous!==false)return null;
      let claims;try{
        const parts=token.split('.');if(parts.length!==3||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))return null;
        claims=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(parts[1],'base64url')));
      }catch{return null;}
      if(!claims||claims.sub!==user.id||claims.iss!==base.origin+'/auth/v1'||claims.role!=='authenticated'||claims.is_anonymous!==false||!UUID.test(claims.session_id||'')||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now())return null;
      // Logout removes auth.sessions. No cache: an expired or removed session fails closed.
      const active=await request('/rest/v1/rpc/plan_session_active',{body:{p_owner:user.id,p_session:claims.session_id}});
      if(active!==true||claims.exp*1000<=now())return null;
      return {id:user.id,is_anonymous:false};
    },
    store:{
      bootstrap:async(owner,command)=>{
        // Repeat payload validation at the private write boundary. No client owner is used.
        const checked=await validateBootstrap({workspace:command.workspace,requestId:command.requestId,records:command.records,review:{confirmed:true,destination:base.origin,payloadDigest:command.payloadDigest}},base.origin);
        return request('/rest/v1/rpc/plan_bootstrap_validated_workspace',{body:{p_owner:actor(owner),p_workspace:checked.workspace,p_request:checked.requestId,p_digest:checked.payloadDigest,p_records:checked.records}});
      },
      read:(owner,workspace)=>request('/rest/v1/rpc/plan_read_validated_workspace',{body:{p_owner:actor(owner),p_workspace:workspace}}),
      apply:(owner,command)=>{validateEnvelope(command);return request('/rest/v1/rpc/plan_apply_validated_operation',{body:{p_owner:actor(owner),p_workspace:command.workspace,p_operation:command.operationId,p_expected_version:command.expectedVersion,p_kind:command.type,p_patches:command.patches}});}
    },
    conversations:{
      save:({owner,requestId,workspace,question,answer})=>{
        if(!UUID.test(requestId||'')||typeof question!=='string'||!question.trim()||new TextEncoder().encode(question).byteLength>20000||typeof answer!=='string'||!answer.trim()||new TextEncoder().encode(answer).byteLength>100000)throw new Error('Use the admitted question and bounded final answer.');
        return request('/rest/v1/rpc/plan_ai_save_conversation',{body:{p_owner:actor(owner),p_request:requestId,p_workspace:conversationWorkspace(workspace),p_question:question,p_answer:answer}});
      },
      read:({owner,workspace,before=null,limit=20})=>{
        if(before!==null&&!UUID.test(before)||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Choose a bounded private conversation history page.');
        return request('/rest/v1/rpc/plan_ai_read_conversations',{body:{p_owner:actor(owner),p_workspace:conversationWorkspace(workspace),p_before:before,p_limit:limit}});
      }
    },
    ledger:{
      reserve:({owner,requestId,reservedMicroUsd,configurationHash,workspaceDigest,summaryDigest,promptDigest})=>request('/rest/v1/rpc/plan_ai_reserve',{body:{p_owner:actor(owner),p_id:requestId,p_amount:reservedMicroUsd,p_configuration_hash:configurationHash,p_workspace_digest:workspaceDigest,p_summary_digest:summaryDigest,p_prompt_digest:promptDigest}}),
      settle:({owner,requestId,status,chargedMicroUsd})=>request('/rest/v1/rpc/plan_ai_settle',{body:{p_owner:actor(owner),p_id:requestId,p_status:status,p_charged:chargedMicroUsd}})
    }
  };
}
