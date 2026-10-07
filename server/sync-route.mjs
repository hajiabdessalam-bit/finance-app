/** Private server deployment wiring. Explicit readiness is required; default is closed. */
import {supabaseAdapter} from './supabase-adapter.mjs';
import {createSyncHttpHandler} from './sync-http.mjs';
const unavailable=()=>Response.json({error:'private_sync_not_configured'},{status:503,headers:{'cache-control':'no-store, private','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Origin, Authorization'}});
export function configuredSyncRoute({env={},fetchImpl=globalThis.fetch}={}){
  // These attestations are server configuration, never accepted from request data.
  if(env.PLAN_PRIVATE_SYNC_ENABLED!=='true'||env.PLAN_PRIVATE_DATABASE_VERIFIED!=='true')return async()=>unavailable();
  try{
    const adapter=supabaseAdapter({url:env.PLAN_SUPABASE_URL,publishableKey:env.PLAN_SUPABASE_PUBLISHABLE_KEY,secretKey:env.PLAN_SUPABASE_SECRET_KEY,fetchImpl});
    return createSyncHttpHandler({origin:env.PLAN_APP_ORIGIN,destination:new URL(env.PLAN_SUPABASE_URL).origin,verifySession:adapter.verifySession,store:adapter.store,admit:adapter.admit});
  }catch{return async()=>unavailable();}
}
