/** Shared private HTTP bounds. No network, credentials or route initialization. */
const MAX_BODY=2_000_000;
export class Rejected extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
export function reply(status,value){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin, Authorization'}});}
export async function readJson(request,timeoutMs){
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
