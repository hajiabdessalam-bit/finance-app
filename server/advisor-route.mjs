/** Private AI deployment wiring. Readiness never comes from browser input. */
import {supabaseAdapter} from './supabase-adapter.mjs';
import {createAdvisorHttpHandler} from './advisor-http.mjs';
const unavailable=()=>Response.json({error:'private_advisor_not_configured'},{status:503,headers:{'cache-control':'no-store, private','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin, Authorization'}});
export async function configuredAdvisorRoute({env={},fetchImpl=globalThis.fetch,generate,configuration}={}){
 if(env.PLAN_PRIVATE_DATABASE_VERIFIED!=='true'||env.PLAN_PRIVATE_ADVISOR_ENABLED!=='true'||env.PLAN_AI_PROVIDER_VERIFIED!=='true'||typeof generate!=='function'||!configuration)return async()=>unavailable();
 try{
  const adapter=supabaseAdapter({url:env.PLAN_SUPABASE_URL,publishableKey:env.PLAN_SUPABASE_PUBLISHABLE_KEY,secretKey:env.PLAN_SUPABASE_SECRET_KEY,fetchImpl});
  return await createAdvisorHttpHandler({origin:env.PLAN_APP_ORIGIN,verifySession:adapter.verifySession,admit:adapter.admit,store:adapter.store,ledger:adapter.ledger,conversations:adapter.conversations,generate,configuration});
 }catch{return async()=>unavailable();}
}
