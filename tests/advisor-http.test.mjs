import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import {createAdvisorHttpHandler} from '../server/advisor-http.mjs';
const origin='https://plan.example.test',owner='11111111-1111-4111-8111-111111111111';
const configuration={provider:'Synthetic API',model:'Synthetic model',supportedFinanceTraffic:true,priceCheckedAt:new Date().toISOString(),maxInputTokens:1000,maxOutputTokens:100,maxSteps:1,inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,fixedMicroUsdPerStep:0};
async function setup(overrides={}){
 const state=C.fresh();state.version=1;state.name='PRIVATE OWNER';state.notes=[{id:'private-note',title:'PRIVATE NOTE',body:'Private history must stay here',items:[]}];
 const events=[],requests=new Set();const dependencies={origin,configuration,
  verifySession:async token=>{events.push('auth');return token==='verified'?{id:owner,is_anonymous:false}:token==='anonymous'?{id:owner,is_anonymous:true}:null;},
  admit:async({owner:actor})=>{assert.equal(actor,owner);events.push('admit');return {allowed:true};},
  store:{read:async(actor,workspace)=>{events.push('read');assert.equal(actor,owner);return workspace===state.id?{workspace,version:state.version,records:S.entities(state).map(r=>({...r,version:state.version})),operations:[]}:null;}},
  ledger:{reserve:async input=>{events.push('reserve');assert.equal(input.owner,owner);if(requests.has(input.requestId))return {status:'duplicate'};requests.add(input.requestId);return {status:'reserved'};},settle:async()=>events.push('settle')},
  conversations:{save:async()=>{events.push('save');return {status:'saved'};}},
  generate:async input=>{events.push('generate');assert.equal(JSON.stringify(input).includes('PRIVATE'),false);return {result:{text:'Synthetic safe answer'},chargedMicroUsd:20};},...overrides};
 return {state,events,dependencies,handler:await createAdvisorHttpHandler(dependencies)};
}
const request=(body,{url=origin+'/api/plan/advisor',method='POST',headers={}}={})=>new Request(url,{method,headers:{origin,authorization:'Bearer verified','content-type':'application/json',...headers},...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
async function preview(f){const response=await f.handler(request({action:'preview',workspace:f.state.id,prompt:'Explain the assumptions.'}));assert.equal(response.status,200);return (await response.json()).result;}
const ask=review=>({action:'ask',review,reviewDigest:review.digest,confirmed:true});

test('AI HTTP review and confirmed question compose aggregate admission, exact settlement and immutable read-only answers',async()=>{
 const f=await setup(),before=C.clone(f.state);assert.equal(f.events.length,0);const review=await preview(f);
 assert.equal(JSON.stringify(review).includes('PRIVATE'),false);assert.equal(f.events.includes('generate'),false);assert.equal(f.events.includes('reserve'),false);
 const response=await f.handler(request(ask(review)));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');assert.equal(response.headers.get('access-control-allow-origin'),null);
 const result=(await response.json()).result;assert.equal(result.text,'Synthetic safe answer');assert.equal(result.historySaved,true);assert.equal(result.recordsChanged,false);assert.equal(result.chargedMicroUsd,20);
 assert.deepEqual(f.events.filter(x=>['reserve','generate','settle','save'].includes(x)),['reserve','generate','settle','save']);assert.deepEqual(f.state,before);
 const duplicate=await f.handler(request(ask(review)));assert.equal((await duplicate.json()).result.status,'review');assert.equal(f.events.filter(x=>x==='generate').length,1);
});
test('wrong origin, token, route or owner injection cannot read or send private AI context',async()=>{
 const f=await setup(),body={action:'preview',workspace:f.state.id,prompt:'Question'};
 for(const [options,status] of [[{headers:{origin:'https://other.test'}},403],[{headers:{'sec-fetch-site':'cross-site'}},403],[{headers:{authorization:''}},401],[{headers:{authorization:'Bearer anonymous'}},401],[{url:origin+'/api/plan/advisor?key=private'},404],[{method:'GET'},405]])assert.equal((await f.handler(request(body,options))).status,status);
 assert.equal(f.events.includes('read'),false);assert.equal((await f.handler(request({...body,owner}))).status,400);assert.equal(f.events.includes('generate'),false);
});
test('missing confirmation, modified review and stale financial context cannot consume an AI budget',async()=>{
 const f=await setup(),review=await preview(f);
 assert.equal((await f.handler(request({...ask(review),confirmed:false}))).status,400);
 assert.equal((await f.handler(request(ask({...review,prompt:'Altered'})))).status,422);
 f.state.version++;assert.equal((await f.handler(request(ask(review)))).status,422);assert.equal(f.events.includes('reserve'),false);assert.equal(f.events.includes('generate'),false);
});
test('rate limits, missing auth and logout after input admission fail before cloud context or model access',async()=>{
 const limited=await setup({admit:async()=>({allowed:false,retryAfterSeconds:17})});const response=await limited.handler(request({action:'preview',workspace:limited.state.id,prompt:'Question'}));assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'17');assert.equal(limited.events.includes('read'),false);
 for(const next of [null,new Error('Private secret diagnostics')]){
  let checks=0;const f=await setup({verifySession:async()=>{if(++checks===1)return {id:owner,is_anonymous:false};if(next instanceof Error)throw next;return next;}});
  const denied=await f.handler(request({action:'preview',workspace:f.state.id,prompt:'Question'}));assert.equal(denied.status,next instanceof Error?503:401);assert.equal(f.events.includes('read'),false);assert.equal((await denied.text()).includes('diagnostics'),false);
 }
});
test('AI HTTP input bounds reject compression, oversized bytes, invalid Unicode and stalled streams',async()=>{
 const f=await setup({bodyTimeoutMs:5}),body={action:'preview',workspace:f.state.id,prompt:'Question'};
 assert.equal((await f.handler(request(body,{headers:{'content-encoding':'gzip'}}))).status,415);
 assert.equal((await f.handler(request(body,{headers:{'content-length':'2000001'}}))).status,413);
 const headers={origin,authorization:'Bearer verified','content-type':'application/json'};
 assert.equal((await f.handler(new Request(origin+'/api/plan/advisor',{method:'POST',headers,body:new Uint8Array([123,255,125])}))).status,400);
 let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});
 assert.equal((await f.handler(new Request(origin+'/api/plan/advisor',{method:'POST',headers,body:stream,duplex:'half'}))).status,408);assert.equal(cancelled,true);assert.equal(f.events.includes('read'),false);
});
test('provider failures preserve uncertain holds and hide private errors without paid retries',async()=>{
 const settlements=[];const f=await setup({generate:async()=>{f.events.push('generate');throw new Error('Private provider token');},ledger:{reserve:async()=>({status:'reserved'}),settle:async input=>settlements.push(C.clone(input))}}),review=await preview(f);
 const response=await f.handler(request(ask(review)));assert.equal(response.status,422);const text=await response.text();assert.equal(text.includes('token'),false);assert.ok(text.includes('do not retry automatically'));assert.equal(settlements[0].status,'uncertain');assert.equal(f.events.filter(x=>x==='generate').length,1);assert.equal(f.events.includes('save'),false);
});

test('explicit history read returns one owned bounded page and never regenerates paid answers',async()=>{
 const requestId=crypto.randomUUID(),f=await setup({conversations:{save:async()=>{},read:async({owner:actor,workspace,before,limit})=>{assert.equal(actor,owner);assert.equal(workspace,f.state.id);assert.equal(before,null);assert.equal(limit,1);return {messages:[{requestId,question:'Past question',answer:'Saved final answer',at:'2026-10-07T00:00:00Z'}],nextCursor:null};}}});
 const response=await f.handler(request({action:'history',workspace:f.state.id,before:null,limit:1}));assert.equal(response.status,200);assert.equal((await response.json()).result.messages[0].answer,'Saved final answer');assert.equal(f.events.includes('generate'),false);assert.equal(f.events.includes('reserve'),false);
 assert.equal((await f.handler(request({action:'history',workspace:f.state.id,before:null,limit:51}))).status,422);
});
