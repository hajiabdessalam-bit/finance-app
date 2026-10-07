/** AI HTTP boundary preparation. No live route or model is initialized here. */
import {advisorService} from './advisor-service.mjs';
import {Rejected,reply,readJson} from './private-http.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function command(input){
 if(exact(input,['action','workspace','prompt'])&&input.action==='preview')return input;
 if(exact(input,['action','workspace','before','limit'])&&input.action==='history')return input;
 if(exact(input,['action','review','reviewDigest','confirmed'])&&input.action==='ask'&&input.confirmed===true&&typeof input.reviewDigest==='string'&&/^[a-f0-9]{64}$/.test(input.reviewDigest)&&input.review&&typeof input.review==='object'&&!Array.isArray(input.review))return input;
 throw new Rejected(400,'invalid_request');
}
export async function createAdvisorHttpHandler({origin,verifySession,admit,bodyTimeoutMs=10000,...dependencies}){
 let pinned;try{pinned=new URL(origin);}catch{throw new Error('Configure the exact private HTTPS app origin.');}
 if(pinned.protocol!=='https:'||pinned.origin!==origin||pinned.username||pinned.password)throw new Error('Configure the exact private HTTPS app origin.');
 if(typeof verifySession!=='function'||typeof admit!=='function')throw new Error('Configure verified sessions and a durable private account rate limit.');
 if(!Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<1||bodyTimeoutMs>10000)throw new Error('Invalid request read timeout.');
 const service=await advisorService({...dependencies,verifySession});
 return async request=>{
  try{
   const url=new URL(request.url);
   if(url.origin!==origin||url.pathname!=='/api/plan/advisor'||url.search)throw new Rejected(404,'not_found');
   if(request.method!=='POST')return reply(405,{error:'post_required'});
   if(request.headers.get('origin')!==origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))throw new Rejected(403,'origin_rejected');
   const authorization=request.headers.get('authorization')||'';
   if(!/^Bearer [A-Za-z0-9._~-]{1,10000}$/.test(authorization))throw new Rejected(401,'sign_in_required');
   const token=authorization.slice(7);let actor;
   try{actor=await verifySession(token);}catch{throw new Rejected(503,'sign_in_unavailable');}
   if(!UUID.test(actor?.id||'')||actor.is_anonymous!==false)throw new Rejected(401,'sign_in_required');
   let admission;try{admission=await admit({owner:actor.id});}catch{throw new Rejected(503,'advisor_unavailable');}
   if(typeof admission?.allowed!=='boolean')throw new Rejected(503,'advisor_unavailable');
   if(!admission.allowed){
    const retry=Number.isInteger(admission.retryAfterSeconds)&&admission.retryAfterSeconds>=1&&admission.retryAfterSeconds<=3600?admission.retryAfterSeconds:60;
    const response=reply(429,{error:'rate_limited',retryAfterSeconds:retry});response.headers.set('retry-after',String(retry));return response;
   }
   const input=command(await readJson(request,bodyTimeoutMs));let current;
   try{current=await verifySession(token);}catch{throw new Rejected(503,'sign_in_unavailable');}
   if(current?.id!==actor.id||current?.is_anonymous!==false)throw new Rejected(401,'sign_in_required');
   let result;try{
    result=input.action==='preview'?await service.preview({token,workspace:input.workspace,prompt:input.prompt}):input.action==='history'?await service.history({token,workspace:input.workspace,before:input.before,limit:input.limit}):await service.ask({token,review:input.review,reviewDigest:input.reviewDigest,confirmed:input.confirmed});
   }catch{return reply(422,{error:'review_required',message:'The answer or charge was not confirmed. Keep any cost hold, review the request and do not retry automatically.'});}
   const output=JSON.stringify({action:input.action,result});
   if(new TextEncoder().encode(output).byteLength>1_000_000)throw new Rejected(413,'response_too_large');
   return reply(200,JSON.parse(output));
  }catch(error){return error instanceof Rejected?reply(error.status,{error:error.code}):reply(500,{error:'request_failed'});}
 };
}
