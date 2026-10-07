import {configuredAdvisorRoute} from './advisor-route.mjs';
import {createZenTextProvider} from './zen-provider.mjs';
const configuration={provider:'OpenCode Zen',model:'deepseek-v4.1-flash',supportedFinanceTraffic:true,priceCheckedAt:'2026-10-07T18:00:00.000Z',maxInputTokens:16384,maxOutputTokens:1200,maxSteps:1,inputMicroUsdPerMillion:300000,outputMicroUsdPerMillion:1200000,fixedMicroUsdPerStep:0};
let generate;
if(process.env.PLAN_OPENCODE_API_KEY)generate=createZenTextProvider({apiKey:process.env.PLAN_OPENCODE_API_KEY,countInputTokens:messages=>{
 const bytes=new TextEncoder().encode(JSON.stringify(messages)).byteLength;
 if(bytes>12000)throw new Error('Keep the financial summary and question brief.');
 // Conservative byte-level bound with framing headroom, not an exact tokenizer.
 return bytes+2048;
}});
const handle=await configuredAdvisorRoute({env:process.env,generate,configuration});
export default {fetch:request=>handle(request)};
