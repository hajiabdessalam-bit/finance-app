/** Request/Response boundary preparation. No route, credentials or network is enabled. */
import {syncService} from './sync-service.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY=2_000_000,MAX_RESPONSE=4_000_000;
class Rejected extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
function reply(status,value){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin, Authorization'}});}
async function readJson(request,timeoutMs){
  if(request.headers.get('content-encoding')&&!/^identity$/i.test(request.headers.get('content-encoding')))throw new Rejected(415,'unsupported_encoding');
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))throw new Rejected(415,'json_required');
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BODY))throw new Rejected(413,'request_too_large');
  if(!request.body)throw new Rejected(400,'invalid_request');
  const reader=request.body.getReader(),chunks=[];let size=0,timer;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Rejected(408,'request_timeout'));void reader.cancel().catch(()=>{});},timeoutMs);});
  const collect=(async()=>{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){void reader.cancel().catch(()=>{});throw new Rejected(413,'request_too_large');}chunks.push(value);}if(declared!==null&&Number(declared)!==size)throw new Rejected(400,'invalid_length');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Rejected(400,'invalid_json');}})();
  try{return await Promise.race([collect,expired]);}finally{clearTimeout(timer);}
}
function command(body){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Rejected(400,'invalid_request');
  const keys=Object.keys(body),read=body.action==='read',write=['apply','bootstrap'].includes(body.action);
  if((!read&&!write)||keys.length!==2||!keys.includes('action')||!keys.includes(read?'workspace':'request'))throw new Rejected(400,'invalid_request');
  if(read&&(typeof body.workspace!=='string'||!body.workspace||body.workspace.length>200))throw new Rejected(400,'invalid_request');
  if(write&&(!body.request||typeof body.request!=='object'||Array.isArray(body.request)))throw new Rejected(400,'invalid_request');
  return body;
}
/** Pin one HTTPS origin. Bearer identity is server-confirmed before reading finance input.
 * No cookie auth, CORS wildcard, redirect, logging or automatic retry is performed here.
 * Configure a rate limit and private store before attaching this handler to a route. */
export function createSyncHttpHandler({origin,verifySession,store,destination,bodyTimeoutMs=10000}){
  let pinned;try{pinned=new URL(origin);}catch{throw new Error('Configure the exact private HTTPS app origin.');}
  if(pinned.protocol!=='https:'||pinned.origin!==origin||pinned.username||pinned.password)throw new Error('Configure the exact private HTTPS app origin.');
  if(!Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<1||bodyTimeoutMs>10000)throw new Error('Invalid request read timeout.');
  syncService({verifySession,store,destination}); // Reject incomplete wiring before receiving requests.
  return async request=>{
    try{
      const url=new URL(request.url);
      if(url.origin!==origin||url.pathname!=='/api/plan/sync'||url.search)throw new Rejected(404,'not_found');
      if(request.method!=='POST')return reply(405,{error:'post_required'});
      if(request.headers.get('origin')!==origin||!['same-origin','none',null].includes(request.headers.get('sec-fetch-site')))throw new Rejected(403,'origin_rejected');
      const authorization=request.headers.get('authorization')||'';
      if(!/^Bearer [A-Za-z0-9._~-]{1,10000}$/.test(authorization))throw new Rejected(401,'sign_in_required');
      const token=authorization.slice(7);let user;
      try{user=await verifySession(token);}catch{throw new Rejected(503,'sign_in_unavailable');}
      if(!user||!UUID.test(user.id||'')||user.is_anonymous!==false)throw new Rejected(401,'sign_in_required');
      const input=command(await readJson(request,bodyTimeoutMs)),service=syncService({verifySession:async()=>user,store,destination});
      let result;
      try{result=input.action==='read'?await service.read({token,workspace:input.workspace}):await service[input.action]({token,request:input.request});}catch{return reply(422,{error:'review_required',message:'The request was not confirmed. Read and review records before retrying.'});}
      const output=JSON.stringify({action:input.action,result});
      if(new TextEncoder().encode(output).byteLength>MAX_RESPONSE)throw new Rejected(413,'response_too_large');
      return reply(result?.status==='conflict'?409:200,JSON.parse(output));
    }catch(error){return error instanceof Rejected?reply(error.status,{error:error.code}):reply(500,{error:'request_failed'});}
  };
}
