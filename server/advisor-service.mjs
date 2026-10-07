/** Read-only AI service preparation. No HTTP route or live provider is enabled. */
import {clone,digest} from '../app/core.mjs';
import {hydrateSnapshot,canonicalJson,sameJson} from '../app/sync.mjs';
import {advisorSummary} from './advisor.ts';
import {budgetedAdvisor,worstCaseCost} from './advisor-budget.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const configFields=['provider','model','supportedFinanceTraffic','priceCheckedAt','maxInputTokens','maxOutputTokens','maxSteps','inputMicroUsdPerMillion','outputMicroUsdPerMillion','fixedMicroUsdPerStep'];
export async function advisorService({verifySession,store,ledger,conversations,generate,configuration,now=()=>Date.now()}){
  if(typeof window!=='undefined'||typeof verifySession!=='function'||typeof store?.read!=='function'||typeof ledger?.reserve!=='function'||typeof ledger?.settle!=='function'||typeof conversations?.save!=='function'||typeof generate!=='function'||!configuration||Object.keys(configuration).some(key=>!configFields.includes(key)))throw new Error('Configure verified private AI dependencies without credentials in the public quote.');
  const config=clone(configuration),configurationHash=await digest(JSON.stringify(config)),reservedMicroUsd=worstCaseCost(config);
  const actor=async token=>{const user=await verifySession(token);if(!UUID.test(user?.id||'')||user.is_anonymous!==false)throw new Error('Sign in with a verified permanent account.');return user.id;};
  const freshQuote=()=>{const age=now()-Date.parse(config.priceCheckedAt);if(!Number.isFinite(age)||age<0||age>86400000)throw new Error('Recheck provider prices before reviewing or sending a question.');};
  const budgeted=budgetedAdvisor({ledger,configuration:config,configurationHash,now,generate:async input=>{
    freshQuote();const response=await generate(input),text=response?.result?.text;
    if(typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).byteLength>100000)throw new Error('A bounded complete final answer is required.');
    return {result:{text},chargedMicroUsd:response.chargedMicroUsd};
  }});
  async function prepare(owner,workspace,prompt,requestId){
    freshQuote();
    if(typeof workspace!=='string'||!workspace||workspace.length>200||typeof prompt!=='string'||!prompt.trim()||new TextEncoder().encode(prompt).byteLength>4000||!UUID.test(requestId||''))throw new Error('Review a workspace and a question of at most 4,000 bytes.');
    const snapshot=await store.read(owner,workspace);if(!snapshot||snapshot.workspace!==workspace||snapshot.version<1)throw new Error('Initialize and review this private workspace first.');
    const state=hydrateSnapshot(clone(snapshot)),summary=advisorSummary(state);
    const review={app:'plan-advisor-review',schema:1,owner,workspace,version:state.version,requestId,prompt,summary,
      workspaceDigest:await digest(canonicalJson(state)),summaryDigest:await digest(JSON.stringify(summary)),promptDigest:await digest(prompt),configurationHash,configuration:clone(config),reservedMicroUsd,recordsChanged:false};
    return {...review,digest:await digest(canonicalJson(review))};
  }
  return {
    history:async({token,workspace,before=null,limit=20})=>{
      const owner=await actor(token);
      if(typeof conversations.read!=='function'||typeof workspace!=='string'||!workspace||workspace.length>200||before!==null&&!UUID.test(before)||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Choose a bounded private history page.');
      const snapshot=await store.read(owner,workspace);
      if(!snapshot||snapshot.workspace!==workspace||snapshot.version<1)throw new Error('Review the owned private workspace first.');
      const page=await conversations.read({owner,workspace,before,limit});
      if(!page||!Array.isArray(page.messages)||page.messages.length>limit||page.nextCursor!==null&&!UUID.test(page.nextCursor||''))throw new Error('Private history could not be verified.');
      const seen=new Set();const messages=page.messages.map(message=>{
        if(!message||!UUID.test(message.requestId||'')||seen.has(message.requestId)||typeof message.question!=='string'||!message.question.trim()||new TextEncoder().encode(message.question).byteLength>20000||typeof message.answer!=='string'||!message.answer.trim()||new TextEncoder().encode(message.answer).byteLength>100000||typeof message.at!=='string'||!Number.isFinite(Date.parse(message.at)))throw new Error('Private history could not be verified.');
        seen.add(message.requestId);return {requestId:message.requestId,question:message.question,answer:message.answer,at:message.at};
      });
      if(page.nextCursor!==null&&messages.at(-1)?.requestId!==page.nextCursor)throw new Error('Private history could not be verified.');
      return {workspace,messages,nextCursor:page.nextCursor,recordsChanged:false};
    },
    preview:async({token,workspace,prompt})=>prepare(await actor(token),workspace,prompt,crypto.randomUUID()),
    ask:async({token,review,reviewDigest,confirmed=false})=>{
      const selected=clone(review);if(confirmed!==true)throw new Error('Review this question, exact summary, provider and maximum cost before sending.');
      const owner=await actor(token);
      if(selected?.app!=='plan-advisor-review'||selected.owner!==owner||selected.digest!==reviewDigest)throw new Error('Use the exact review for the signed-in account.');
      const current=await prepare(owner,selected.workspace,selected.prompt,selected.requestId);
      if(!sameJson(current,selected))throw new Error('Records, question or provider quote changed. Prepare a fresh review.');
      // Workspace and question are captured from the admitted review before any
      // budget/provider await. No later client selection can redirect history.
      const admittedWorkspace=selected.workspace,question=selected.prompt;
      const response=await budgeted({owner,requestId:selected.requestId,workspaceDigest:selected.workspaceDigest,summaryDigest:selected.summaryDigest,summary:selected.summary,prompt:question,
        consent:{confirmed:true,provider:config.provider,model:config.model,workspaceDigest:selected.workspaceDigest,summaryDigest:selected.summaryDigest,promptDigest:selected.promptDigest,configurationHash}});
      if(response.status!=='complete')return response;
      let historySaved=false;try{const saved=await conversations.save({owner,requestId:selected.requestId,workspace:admittedWorkspace,question,answer:response.result.text});historySaved=['saved','duplicate'].includes(saved?.status);}catch{}
      return {status:'complete',text:response.result.text,chargedMicroUsd:response.chargedMicroUsd,historySaved,requestId:selected.requestId,workspace:admittedWorkspace,contextVersion:selected.version,summaryDigest:selected.summaryDigest,recordsChanged:false};
    }
  };
}
