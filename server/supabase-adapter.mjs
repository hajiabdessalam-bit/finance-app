/** Server-only adapter preparation. No credentials or network calls at module load. */
import {validateEnvelope} from './validation.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function supabaseAdapter({url,publishableKey,secretKey,fetchImpl=globalThis.fetch}){
  if(typeof window!=='undefined')throw new Error('The private database adapter must run on the server.');
  let base;try{base=new URL(url);}catch{throw new Error('Configure a valid Supabase project endpoint.');}
  if(base.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)||base.username||base.password||base.search||base.hash||base.pathname!=='/'||base.port)throw new Error('Use the configured HTTPS Supabase project endpoint.');
  if(typeof publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)||typeof secretKey!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey))throw new Error('Configure separate publishable and server secret keys.');
  const actor=id=>{if(!UUID.test(id||''))throw new Error('A verified actor is required.');return id;};
  async function request(path,{key=secretKey,token,body}={}){
    try{
      const response=await fetchImpl(new URL(path,base).href,{method:body===undefined?'GET':'POST',headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok){if(token&&(response.status===401||response.status===403))return null;throw new Error('Remote request failed.');}
      const reader=response.body?.getReader();if(!reader)throw new Error('No response body.');const chunks=[];let size=0;
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>10_000_000){await reader.cancel();throw new Error('Response is too large.');}chunks.push(part.value);}
      const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(buffer));
    }catch{throw new Error('Supabase could not confirm the request. No edit has been acknowledged.');}
  }
  return {
    async verifySession(token){if(typeof token!=='string'||!token||token.length>10000||/\s/.test(token))return null;const user=await request('/auth/v1/user',{key:publishableKey,token});if(!user||!UUID.test(user.id||'')||user.is_anonymous!==false)return null;return {id:user.id,is_anonymous:false};},
    store:{
      read:(owner,workspace)=>request('/rest/v1/rpc/plan_read_validated_workspace',{body:{p_owner:actor(owner),p_workspace:workspace}}),
      apply:(owner,command)=>{validateEnvelope(command);return request('/rest/v1/rpc/plan_apply_validated_operation',{body:{p_owner:actor(owner),p_workspace:command.workspace,p_operation:command.operationId,p_expected_version:command.expectedVersion,p_kind:command.type,p_patches:command.patches}});}
    }
  };
}
