/** Optional authenticated advisor transport. Construction sends and stores nothing. */
import {clone,digest} from '../app/core.mjs';
import {canonicalJson} from '../app/sync.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const quoteFields=['provider','model','supportedFinanceTraffic','priceCheckedAt','maxInputTokens','maxOutputTokens','maxSteps','inputMicroUsdPerMillion','outputMicroUsdPerMillion','fixedMicroUsdPerStep'];
const reviewFields=['app','schema','owner','workspace','version','requestId','prompt','summary','workspaceDigest','summaryDigest','promptDigest','configurationHash','configuration','reservedMicroUsd','recordsChanged','digest'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value,limit)=>typeof value==='string'&&!!value.trim()&&new TextEncoder().encode(value).byteLength<=limit;
const workspace=id=>{if(!text(id,800)||id.length>200)throw new Error('Choose the reviewed private workspace.');return id;};
async function validateReview(review,input={}){
 if(!exact(review,reviewFields)||review.app!=='plan-advisor-review'||review.schema!==1||!UUID.test(review.owner)||!UUID.test(review.requestId)||!Number.isSafeInteger(review.version)||review.version<1||!text(review.prompt,4000)||review.recordsChanged!==false||!Number.isSafeInteger(review.reservedMicroUsd)||review.reservedMicroUsd<0||review.reservedMicroUsd>1e12||['workspaceDigest','summaryDigest','promptDigest','configurationHash','digest'].some(key=>!HASH.test(review[key]))||!exact(review.configuration,quoteFields))throw new Error('The AI review could not be verified.');
 workspace(review.workspace);
 if(input.workspace!==undefined&&(review.workspace!==input.workspace||review.prompt!==input.prompt))throw new Error('The returned AI question or workspace changed.');
 const config=review.configuration;
 if(!text(config.provider,300)||!text(config.model,300)||config.supportedFinanceTraffic!==true||!Number.isFinite(Date.parse(config.priceCheckedAt))||['maxInputTokens','maxOutputTokens','maxSteps','inputMicroUsdPerMillion','outputMicroUsdPerMillion','fixedMicroUsdPerStep'].some(key=>!Number.isSafeInteger(config[key])||config[key]<0||config[key]>1e12)||config.maxInputTokens<1||config.maxOutputTokens<1||config.maxSteps<1||config.maxInputTokens>1e6||config.maxOutputTokens>1e6||config.maxSteps>10)throw new Error('The provider quote could not be verified.');
 const cost=Number(((BigInt(config.maxInputTokens)*BigInt(config.inputMicroUsdPerMillion)+BigInt(config.maxOutputTokens)*BigInt(config.outputMicroUsdPerMillion)+999999n)/1000000n+BigInt(config.fixedMicroUsdPerStep))*BigInt(config.maxSteps));
 const {digest:claimed,...contents}=review;
 if(cost!==review.reservedMicroUsd||await digest(JSON.stringify(config))!==review.configurationHash||await digest(review.prompt)!==review.promptDigest||new TextEncoder().encode(JSON.stringify(review.summary)).byteLength>256000||await digest(JSON.stringify(review.summary))!==review.summaryDigest||await digest(canonicalJson(contents))!==claimed)throw new Error('The reviewed summary, question or maximum cost changed.');
 return review;
}
export function privateAdvisorTransport({origin,currentOrigin=globalThis.location?.origin,tokenProvider,fetchImpl=globalThis.fetch,timeoutMs=90000}){
 let base;try{base=new URL(origin);}catch{throw new Error('Configure the private app origin.');}
 if(base.protocol!=='https:'||base.origin!==origin||origin!==currentOrigin||base.username||base.password)throw new Error('AI transport requires the exact current HTTPS app origin.');
 if(typeof tokenProvider!=='function'||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000)throw new Error('Configure verified sign-in and a bounded AI request deadline.');
 async function call(action,input){
  input=clone(input);const body=JSON.stringify({action,...input});if(new TextEncoder().encode(body).byteLength>2_000_000)throw new Error('Keep this AI request within its reviewed input bound.');
  const controller=new AbortController();let timer,reader;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new Error('AI request timed out.'));},timeoutMs);});
  const execute=async()=>{
   const token=await tokenProvider();controller.signal.throwIfAborted();if(typeof token!=='string'||!/^[A-Za-z0-9._~-]{1,10000}$/.test(token))throw new Error('Unverified sign-in.');
   const response=await fetchImpl(origin+'/api/plan/advisor',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body,credentials:'same-origin',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});controller.signal.throwIfAborted();}
   if(response.status!==200||response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){void response.body?.cancel().catch(()=>{});throw new Error('Unconfirmed answer.');}
   reader=response.body?.getReader();if(!reader)throw new Error('Missing response.');const chunks=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1_000_000){void reader.cancel().catch(()=>{});throw new Error('Unbounded response.');}chunks.push(part.value);}}finally{reader.releaseLock();reader=null;}
   controller.signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!exact(payload,['action','result'])||payload.action!==action)throw new Error('Wrong response.');
   const result=payload.result;
   if(action==='preview')await validateReview(result,input);
   else if(action==='ask'){
    if(result?.status==='review'){if(!exact(result,['status','reason'])||!text(result.reason,4000))throw new Error('Invalid review result.');}
    else if(!exact(result,['status','text','chargedMicroUsd','historySaved','requestId','workspace','contextVersion','summaryDigest','recordsChanged'])||result.status!=='complete'||!text(result.text,100000)||(result.chargedMicroUsd!==null&&(!Number.isSafeInteger(result.chargedMicroUsd)||result.chargedMicroUsd<0||result.chargedMicroUsd>input.review.reservedMicroUsd))||typeof result.historySaved!=='boolean'||result.requestId!==input.review.requestId||result.workspace!==input.review.workspace||result.contextVersion!==input.review.version||result.summaryDigest!==input.review.summaryDigest||result.recordsChanged!==false)throw new Error('Unconfirmed paid answer.');
   }else{
    if(!exact(result,['workspace','messages','nextCursor','recordsChanged'])||result.workspace!==input.workspace||result.recordsChanged!==false||!Array.isArray(result.messages)||result.messages.length>input.limit||result.nextCursor!==null&&!UUID.test(result.nextCursor||''))throw new Error('Invalid history.');
    const seen=new Set();for(const message of result.messages){if(!exact(message,['requestId','question','answer','at'])||!UUID.test(message.requestId)||seen.has(message.requestId)||!text(message.question,20000)||!text(message.answer,100000)||typeof message.at!=='string'||!Number.isFinite(Date.parse(message.at)))throw new Error('Invalid saved answer.');seen.add(message.requestId);}
    if(result.nextCursor!==null&&result.messages.at(-1)?.requestId!==result.nextCursor)throw new Error('Invalid history cursor.');
   }
   controller.signal.throwIfAborted();return clone(result);
  };
  try{return await Promise.race([execute(),expired]);}
  catch{throw new Error('AI did not confirm this request. Keep its review and any cost hold; do not retry automatically. Saved answers can be checked separately.');}
  finally{clearTimeout(timer);}
 }
 return {
  preview:(id,prompt)=>{workspace(id);if(!text(prompt,4000))throw new Error('Review a question of at most 4,000 bytes.');return call('preview',{workspace:id,prompt});},
  ask:async(review,{confirmed=false,reviewDigest}={})=>{const selected=clone(review);if(confirmed!==true||selected?.digest!==reviewDigest)throw new Error('Explicitly confirm the exact question, summary and maximum cost.');await validateReview(selected);return call('ask',{review:selected,reviewDigest,confirmed:true});},
  history:({workspace:id,before=null,limit=20})=>{workspace(id);if(before!==null&&!UUID.test(before)||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Choose a bounded saved-answer history page.');return call('history',{workspace:id,before,limit});}
 };
}
