import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import {advisorService} from '../server/advisor-service.mjs';
const owner='11111111-1111-4111-8111-111111111111';
const config={provider:'Synthetic API',model:'Synthetic model',supportedFinanceTraffic:true,priceCheckedAt:new Date().toISOString(),maxInputTokens:1000,maxOutputTokens:100,maxSteps:1,inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,fixedMicroUsdPerStep:0};
async function fixture(){
  let state=C.fresh();state.version=7;state.name='PRIVATE OWNER';state.notes=[{id:'private-note',title:'PRIVATE NOTE',body:'Never send this',items:[]}];state.accounts=[{id:'private-bank',name:'PRIVATE BANK',kind:'asset',currency:state.currency,opening:10000,baselineDate:C.today(state.timezone),baselineSeq:0}];
  const calls=[],saved=[],requestIds=new Set();let onGenerate=null,saveFails=false,charge=20;
  const dependencies={verifySession:async token=>token==='verified'?{id:owner,is_anonymous:false}:null,store:{read:async(actor,workspace)=>{assert.equal(actor,owner);if(workspace!==state.id)return null;return {workspace:state.id,version:state.version,records:S.entities(state).map(r=>({...r,version:state.version})),operations:[]};}},
    ledger:{reserve:async input=>{calls.push(['reserve',C.clone(input)]);if(requestIds.has(input.requestId))return {status:'duplicate'};requestIds.add(input.requestId);return {status:'reserved'};},settle:async input=>calls.push(['settle',C.clone(input)])},
    conversations:{save:async input=>{saved.push(C.clone(input));if(saveFails)throw Error('private details');return {status:'saved'};}},generate:async input=>{calls.push(['generate',C.clone(input)]);await onGenerate?.();return {result:{text:'Synthetic answer',reasoning_content:'Never return hidden reasoning'},chargedMicroUsd:charge};},configuration:config};
  const service=await advisorService(dependencies);
  return {service,calls,saved,dependencies,state:()=>state,setState:s=>state=s,onGenerate:fn=>onGenerate=fn,failSave:()=>saveFails=true,setCharge:v=>charge=v};
}
const preview=f=>f.service.preview({token:'verified',workspace:f.state().id,prompt:'Explain my goal assumptions.'});
const ask=(f,review)=>f.service.ask({token:'verified',review,reviewDigest:review.digest,confirmed:true});
test('review uses only approved aggregates; one admitted request settles and retains its captured question',async()=>{
  const f=await fixture(),before=C.clone(f.state()),review=await preview(f);assert.equal(f.calls.length,0);assert.equal(review.reservedMicroUsd,1200);assert.ok(!JSON.stringify(review).includes('PRIVATE'));assert.ok(!JSON.stringify(review).includes('Never send this'));
  await assert.rejects(f.service.ask({token:'verified',review,reviewDigest:review.digest}),/maximum cost/);assert.equal(f.calls.length,0);
  const result=await ask(f,review);assert.equal(result.historySaved,true);assert.equal(result.text,'Synthetic answer');assert.equal(result.chargedMicroUsd,20);assert.ok(!JSON.stringify(result).includes('reasoning'));assert.deepEqual(f.calls.map(c=>c[0]),['reserve','generate','settle']);assert.equal(f.saved[0].workspace,before.id);assert.equal(f.saved[0].question,review.prompt);assert.deepEqual(f.state(),before);
  assert.equal((await ask(f,review)).status,'review');assert.equal(f.calls.filter(c=>c[0]==='generate').length,1);
});
test('changed records, altered question, foreign identity and expired quote cannot reach the model',async()=>{
  const f=await fixture(),review=await preview(f);await assert.rejects(ask(f,{...review,prompt:'Different'}),/changed/);await assert.rejects(ask(f,{...review,owner:'22222222-2222-4222-8222-222222222222'}),/signed-in/);
  await assert.rejects(f.service.ask({token:'unverified',review,reviewDigest:review.digest,confirmed:true}),/permanent/);f.setState({...f.state(),version:8});await assert.rejects(ask(f,review),/changed/);assert.equal(f.calls.length,0);
  const expired=await advisorService({...f.dependencies,now:()=>Date.parse(config.priceCheckedAt)+86400001});await assert.rejects(expired.preview({token:'verified',workspace:f.state().id,prompt:'Question'}),/prices/);
  await assert.rejects(advisorService({...f.dependencies,configuration:{...config,apiKey:'should-never-be-returned'}}),/credentials/);
});
test('uncertain charge keeps its reservation and saved history cannot be redirected by later review mutation',async()=>{
  const uncertain=await fixture();uncertain.setCharge(null);await assert.rejects(ask(uncertain,await preview(uncertain)),/complete charge/);assert.equal(uncertain.calls.at(-1)[1].status,'uncertain');assert.equal(uncertain.saved.length,0);
  const f=await fixture(),review=await preview(f),workspace=review.workspace;f.onGenerate(async()=>{review.workspace='different-workspace';review.prompt='Changed later';});const result=await ask(f,review);assert.equal(result.workspace,workspace);assert.equal(f.saved[0].workspace,workspace);assert.equal(f.saved[0].question,'Explain my goal assumptions.');
});
test('history failure retains a confirmed paid answer and does not repeat the provider',async()=>{
  const f=await fixture();f.failSave();const review=await preview(f),result=await ask(f,review);assert.equal(result.status,'complete');assert.equal(result.historySaved,false);assert.equal(result.text,'Synthetic answer');assert.equal(f.calls.at(-1)[1].status,'complete');assert.equal((await ask(f,review)).status,'review');assert.equal(f.calls.filter(c=>c[0]==='generate').length,1);
});
