import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import {createAdvisorHttpHandler} from '../server/advisor-http.mjs';
import {privateAdvisorTransport} from '../frontend/advisor-transport.mjs';
const origin='https://plan.example.test',owner='11111111-1111-4111-8111-111111111111';
async function fixture(){
 const state=C.fresh();state.version=1;state.name='PRIVATE OWNER';state.notes=[{id:'private-note',title:'PRIVATE NOTE',body:'Never transmitted',items:[]}];
 const calls=[],paid=new Set();let generations=0,tokenProvider=async()=>'verified';
 const handler=await createAdvisorHttpHandler({origin,verifySession:async token=>token==='verified'?{id:owner,is_anonymous:false}:null,admit:async()=>({allowed:true}),
  store:{read:async()=>({workspace:state.id,version:state.version,records:S.entities(state).map(r=>({...r,version:state.version})),operations:[]})},
  configuration:{provider:'Synthetic API',model:'Synthetic model',supportedFinanceTraffic:true,priceCheckedAt:new Date().toISOString(),maxInputTokens:1000,maxOutputTokens:100,maxSteps:1,inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,fixedMicroUsdPerStep:0},
  ledger:{reserve:async input=>{if(paid.has(input.requestId))return {status:'duplicate'};paid.add(input.requestId);return {status:'reserved'};},settle:async()=>{}},
  conversations:{save:async()=>({status:'saved'}),read:async()=>({messages:[],nextCursor:null})},generate:async()=>{generations++;return {result:{text:'Synthetic answer'},chargedMicroUsd:20};}});
 const fetchImpl=async(url,options)=>{calls.push({url,options});return handler(new Request(url,{...options,headers:{...options.headers,origin,'sec-fetch-site':'same-origin'}}));};
 const config={origin,currentOrigin:origin,tokenProvider:()=>tokenProvider(),fetchImpl};
 return {state,calls,config,transport:privateAdvisorTransport(config),generations:()=>generations,setToken:fn=>tokenProvider=fn};
}
test('inert advisor transport connects exact aggregate review, explicit question and saved history through real HTTP validation',async()=>{
 const f=await fixture();assert.equal(f.calls.length,0);const before=C.clone(f.state),review=await f.transport.preview(f.state.id,'Explain my goals.');assert.equal(f.generations(),0);assert.equal(JSON.stringify(review).includes('PRIVATE'),false);
 await assert.rejects(f.transport.ask(review),/Explicitly confirm/);assert.equal(f.calls.length,1);
 const result=await f.transport.ask(review,{confirmed:true,reviewDigest:review.digest});assert.equal(result.text,'Synthetic answer');assert.equal(result.chargedMicroUsd,20);assert.equal(f.generations(),1);
 assert.equal((await f.transport.ask(review,{confirmed:true,reviewDigest:review.digest})).status,'review');assert.equal(f.generations(),1);
 assert.equal((await f.transport.history({workspace:f.state.id})).messages.length,0);assert.equal(f.generations(),1);assert.deepEqual(f.state,before);
 for(const call of f.calls){assert.equal(call.url,origin+'/api/plan/advisor');assert.equal(call.options.credentials,'omit');assert.equal(call.options.redirect,'error');assert.equal(call.options.cache,'no-store');assert.equal(Object.hasOwn(JSON.parse(call.options.body),'owner'),false);assert.equal(call.options.body.includes('PRIVATE'),false);}
});
test('captured reviewed question cannot change while verified credentials are pending',async()=>{
 const f=await fixture(),review=await f.transport.preview(f.state.id,'Original question');let resolve,requested=false;
 f.setToken(()=>{requested=true;return new Promise(done=>{resolve=done;});});
 const sent=f.transport.ask(review,{confirmed:true,reviewDigest:review.digest});review.prompt='Mutated later';
 while(!requested)await new Promise(done=>setTimeout(done,0));resolve('verified');
 assert.equal((await sent).text,'Synthetic answer');assert.equal(JSON.parse(f.calls.at(-1).options.body).review.prompt,'Original question');
});
test('invalid or changed review, quotes and results cannot be accepted or sent as confirmed answers',async()=>{
 const f=await fixture(),review=await f.transport.preview(f.state.id,'Question');const count=f.calls.length;
 for(const changed of [{...review,prompt:'Altered'},{...review,reservedMicroUsd:0},{...review,configuration:{...review.configuration,apiKey:'UNEXPECTED_SECRET'}}])await assert.rejects(f.transport.ask(changed,{confirmed:true,reviewDigest:changed.digest}),/review|quote|changed/);
 assert.equal(f.calls.length,count);assert.throws(()=>f.transport.history({workspace:f.state.id,limit:51}),/bounded/);
 const corrupt=privateAdvisorTransport({...f.config,fetchImpl:async()=>Response.json({action:'ask',result:{status:'complete',text:'Wrong context',chargedMicroUsd:9999}})});
 await assert.rejects(corrupt.ask(review,{confirmed:true,reviewDigest:review.digest}),/did not confirm/);
 const badReview=privateAdvisorTransport({...f.config,fetchImpl:async()=>Response.json({action:'preview',result:{...review,workspace:'foreign'}})});
 await assert.rejects(badReview.preview(f.state.id,'Question'),/did not confirm/);
 for(const value of ['http://plan.example.test','https://other.test',origin+'/'])assert.throws(()=>privateAdvisorTransport({...f.config,origin:value}),/HTTPS/);
});
test('one deadline bounds credentials, late fetch and streamed AI responses without retries or private error leakage',async()=>{
 const f=await fixture();let calls=0,cancelled=0,resolve;
 const credentials=privateAdvisorTransport({...f.config,timeoutMs:5,tokenProvider:()=>new Promise(done=>{resolve=done;}),fetchImpl:async()=>{calls++;}});
 await assert.rejects(credentials.preview(f.state.id,'Question'),/do not retry automatically/);resolve('verified');await new Promise(done=>setTimeout(done,0));assert.equal(calls,0);
 const late=privateAdvisorTransport({...f.config,timeoutMs:5,fetchImpl:async()=>{calls++;return new Promise(done=>{resolve=done;});}});
 await assert.rejects(late.preview(f.state.id,'Question'),/did not confirm/);resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));await new Promise(done=>setTimeout(done,0));assert.equal(cancelled,1);assert.equal(calls,1);
 const slow=privateAdvisorTransport({...f.config,timeoutMs:5,fetchImpl:async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}});}});
 await assert.rejects(slow.preview(f.state.id,'Question'),/did not confirm/);assert.equal(cancelled,2);assert.equal(calls,2);
 const failed=privateAdvisorTransport({...f.config,fetchImpl:async()=>{throw Error('PRIVATE_TOKEN');}});await assert.rejects(failed.preview(f.state.id,'Question'),error=>!error.message.includes('PRIVATE_TOKEN'));
});
