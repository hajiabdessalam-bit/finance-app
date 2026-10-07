/** Provider-independent admission control preparation. No provider is configured. */
import {digest,clone} from '../app/core.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
function integer(value,label,max=1e12){if(!Number.isSafeInteger(value)||value<0||value>max)throw new Error(`${label} must be an exact, nonnegative integer.`);return value;}
/** Rates are explicit micro-USD per million tokens, not finance currency units.
 * The configured adapter must enforce input/output/step bounds and account for
 * every billable token (including reasoning) and fixed fees. No guessed prices. */
export function worstCaseCost(config){
  integer(config.maxInputTokens,'Input limit',1_000_000);integer(config.maxOutputTokens,'Output limit',1_000_000);integer(config.maxSteps,'Step limit',10);
  if(!config.maxInputTokens||!config.maxOutputTokens||!config.maxSteps)throw new Error('Provide positive request limits.');
  const input=BigInt(integer(config.inputMicroUsdPerMillion,'Input price')),output=BigInt(integer(config.outputMicroUsdPerMillion,'Output price')),fixed=BigInt(integer(config.fixedMicroUsdPerStep,'Fixed fees'));
  const perStep=(BigInt(config.maxInputTokens)*input+BigInt(config.maxOutputTokens)*output+999999n)/1000000n+fixed;
  return integer(Number(perStep*BigInt(config.maxSteps)),'Reserved cost');
}
/** Ledger.reserve must atomically reserve capacity in a DURABLE owner budget.
 * Duplicate/uncertain requests are review-only; they must never run twice.
 * A process-local counter does not satisfy this interface's contract. Owner and
 * workspace digest must come from a server-verified permanent user's snapshot,
 * never from unverified request-body identity fields. No HTTP route is enabled. */
export function budgetedAdvisor({ledger,generate,configuration,configurationHash,now=()=>Date.now()}){
  if(typeof ledger?.reserve!=='function'||typeof ledger?.settle!=='function'||typeof generate!=='function'||!DIGEST.test(configurationHash||''))throw new Error('Provide a durable budget ledger and reviewed provider configuration.');
  if(typeof configuration?.provider!=='string'||!configuration.provider||typeof configuration.model!=='string'||!configuration.model||configuration.supportedFinanceTraffic!==true)throw new Error('Confirm supported finance API access before configuring an advisor.');
  configuration=clone(configuration);
  const priceCheckedAt=Date.parse(configuration.priceCheckedAt);
  if(!Number.isFinite(priceCheckedAt))throw new Error('Provide a recently checked provider price quote.');
  const reservedMicroUsd=worstCaseCost(configuration);
  return async({owner,requestId,workspaceDigest,summaryDigest,consent,summary,prompt})=>{
    if(!UUID.test(owner||'')||!UUID.test(requestId||'')||!DIGEST.test(workspaceDigest||'')||!DIGEST.test(summaryDigest||''))throw new Error('Invalid authenticated request context.');
    const quoteAge=now()-priceCheckedAt;
    if(!Number.isFinite(quoteAge)||quoteAge<0||quoteAge>86400000)throw new Error('Recheck provider prices before sending another request.');
    if(!consent||consent.confirmed!==true||consent.provider!==configuration.provider||consent.model!==configuration.model||consent.workspaceDigest!==workspaceDigest||consent.summaryDigest!==summaryDigest||consent.configurationHash!==configurationHash)throw new Error('Review this provider, model and current financial summary before sending.');
    const serialized=JSON.stringify(summary);
    if(typeof serialized!=='string'||new TextEncoder().encode(serialized).length>256000||await digest(serialized)!==summaryDigest||await digest(JSON.stringify(configuration))!==configurationHash)throw new Error('The reviewed summary or provider configuration changed.');
    if(typeof prompt!=='string'||!prompt.trim()||new TextEncoder().encode(prompt).length>4000)throw new Error('Keep the planning question within 4,000 bytes.');
    const promptDigest=await digest(prompt);
    if(consent.promptDigest!==promptDigest)throw new Error('Review the exact planning question before sending.');
    // Trusted caller computes digests from the exact reviewed summary/snapshot;
    // the adapter verifies token bounds before sending anything to the provider.
    const admission=await ledger.reserve({owner,requestId,configurationHash,workspaceDigest,summaryDigest,promptDigest,reservedMicroUsd});
    if(admission?.status==='duplicate')return {status:'review',reason:'This request already exists. Review its saved result or uncertain charge.'};
    if(admission?.status!=='reserved')throw new Error('The AI budget cannot cover this request. No model request was sent.');
    let response;
    try{response=await generate({summary:JSON.parse(serialized),prompt,maxInputTokens:configuration.maxInputTokens,maxOutputTokens:configuration.maxOutputTokens,maxSteps:configuration.maxSteps});}
    catch{await ledger.settle({owner,requestId,status:'uncertain',chargedMicroUsd:null});throw new Error('The provider did not confirm a result. Its budget reservation is held for review.');}
    const charged=response?.chargedMicroUsd;
    if(charged===null&&response?.result){
      await ledger.settle({owner,requestId,status:'uncertain',chargedMicroUsd:null});
      return {status:'complete',result:response.result,chargedMicroUsd:null};
    }
    if(!Number.isSafeInteger(charged)||charged<0||charged>1e12){await ledger.settle({owner,requestId,status:'uncertain',chargedMicroUsd:null});throw new Error('The provider did not confirm its complete charge. Its reservation is held for review.');}
    await ledger.settle({owner,requestId,status:charged>reservedMicroUsd?'overrun':'complete',chargedMicroUsd:charged});
    if(charged>reservedMicroUsd)throw new Error('The provider exceeded its configured bound. Further requests require price and budget review.');
    return {status:'complete',result:response.result,chargedMicroUsd:charged};
  };
}
