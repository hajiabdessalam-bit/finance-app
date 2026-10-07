/** Optional transport preparation. Importing or constructing it sends nothing. */
import {clone} from '../app/core.mjs';
import {hydrateSnapshot} from '../app/sync.mjs';
const MAX_INPUT=2_000_000,MAX_OUTPUT=4_000_000;
const allowedOperation=new Set(['workspace','operationId','expectedVersion','type','patches']);
export function privateCloudTransport({origin,currentOrigin=globalThis.location?.origin,tokenProvider,fetchImpl=globalThis.fetch,timeoutMs=15000}){
  let base;try{base=new URL(origin);}catch{throw new Error('Configure the private app origin.');}
  if(base.protocol!=='https:'||base.origin!==origin||origin!==currentOrigin)throw new Error('Cloud transport requires the exact current HTTPS app origin.');
  if(typeof tokenProvider!=='function'||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('Configure authenticated bounded cloud transport.');
  const workspace=id=>{if(typeof id!=='string'||!id||id.length>200)throw new Error('Choose a valid workspace.');return id;};
  async function call(action,input){
    // Capture exact reviewed input before awaiting credentials. Never append an owner.
    input=clone(input);
    const body=JSON.stringify({action,...input});
    if(new TextEncoder().encode(body).byteLength>MAX_INPUT)throw new Error('This cloud request is too large. Keep it locally and review a smaller operation.');
    const controller=new AbortController();let timer,reader;
    const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new Error('timeout'));},timeoutMs);});
    let token;
    try{token=await Promise.race([Promise.resolve().then(()=>tokenProvider()),expired]);}
    catch{clearTimeout(timer);throw new Error('Sign-in could not be confirmed. Keep local records and try signing in again before comparing cloud records.');}
    if(typeof token!=='string'||!/^[A-Za-z0-9._~-]{1,10000}$/.test(token)){clearTimeout(timer);throw new Error('Sign in before reading or sending cloud records.');}
    const execute=(async()=>{
      const response=await fetchImpl(origin+'/api/plan/sync',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body,credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
      if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});controller.signal.throwIfAborted();}
      if(![200,409].includes(response.status)||response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw new Error('unconfirmed');}
      reader=response.body?.getReader();if(!reader)throw new Error('empty');const chunks=[];let size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_OUTPUT){void reader.cancel().catch(()=>{});throw new Error('oversized');}chunks.push(part.value);}}finally{reader.releaseLock();reader=null;}
      controller.signal.throwIfAborted();
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!payload||payload.action!==action||Object.keys(payload).sort().join(',')!=='action,result')throw new Error('invalid response');
      const result=payload.result;
      if(action==='read'){
        if(response.status!==200)throw new Error('invalid read');
        if(result!==null){if(result?.workspace!==input.workspace)throw new Error('different workspace');hydrateSnapshot(result);}
      }else{
        const statuses=action==='bootstrap'?['initialized','duplicate','conflict']:['applied','duplicate','conflict'];
        if(!result||Object.keys(result).sort().join(',')!=='status,version'||!statuses.includes(result.status)||!Number.isSafeInteger(result.version)||result.version<0||(response.status===409)!==(result.status==='conflict'))throw new Error('invalid result');
        if(action==='apply'&&(result.status==='applied'&&result.version!==input.request.expectedVersion+1||result.status==='duplicate'&&result.version<=input.request.expectedVersion)||action==='bootstrap'&&(result.version<1||result.status==='initialized'&&result.version!==1))throw new Error('invalid version');
      }
      controller.signal.throwIfAborted();return clone(result);
    })();
    try{return await Promise.race([execute,expired]);}catch{throw new Error('Cloud did not confirm this request. Keep local edits and read/review records before retrying.');}finally{clearTimeout(timer);}
  }
  return {
    read:id=>call('read',{workspace:workspace(id)}),
    apply:request=>{if(!request||Object.keys(request).some(k=>!allowedOperation.has(k)))throw new Error('Use a versioned operation without an owner field.');workspace(request.workspace);return call('apply',{request});},
    bootstrap:request=>{workspace(request?.workspace);if(request.review?.confirmed!==true)throw new Error('Review the exact first upload before sending it.');return call('bootstrap',{request});}
  };
}
