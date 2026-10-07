/** Optional memory-only Supabase sign-in preparation. No finance data is sent. */
import {createClient} from '@supabase/supabase-js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied=()=>new Error('Sign-in could not be verified. Keep local records and sign in again.');
export function privateSession({url,publishableKey,clientFactory=createClient,fetchImpl=globalThis.fetch,timeoutMs=15000,now=()=>Date.now()}){
  let target;try{target=new URL(url);}catch{throw new Error('Configure the verified private Supabase project.');}
  if(target.origin!==url||target.protocol!=='https:'||target.port||target.username||target.password||!/^[a-z0-9-]+\.supabase\.co$/.test(target.hostname)||!/^sb_publishable_[A-Za-z0-9_-]{10,200}$/.test(publishableKey||'')||typeof clientFactory!=='function'||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('Use the verified private project and its public publishable key.');
  const client=clientFactory(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetchImpl}});
  if(!client?.auth)throw new Error('Configure the supported authentication client.');
  let active=false,epoch=0,action=0;
  client.auth.onAuthStateChange(event=>{epoch++;if(event==='SIGNED_OUT')active=false;});
  const bounded=async run=>{let timer;try{return await Promise.race([Promise.resolve().then(run),new Promise((_,reject)=>{timer=setTimeout(()=>{active=false;action++;epoch++;reject(denied());},timeoutMs);})]);}catch{throw denied();}finally{clearTimeout(timer);}};
  async function verified(allowInactive=false){
    if(!allowInactive&&!active)throw denied();const start=epoch;
    const current=await client.auth.getSession(),session=current?.data?.session,token=session?.access_token;
    if(current?.error||typeof token!=='string'||!/^[A-Za-z0-9._~-]{1,10000}$/.test(token)||!Number.isFinite(session.expires_at)||session.expires_at*1000<=now())throw denied();
    const result=await client.auth.getUser(token),user=result?.data?.user;
    if(result?.error||!UUID.test(user?.id||'')||user.is_anonymous!==false||!(user.email_confirmed_at||user.phone_confirmed_at)||session.user?.id!==user.id)throw denied();
    const latest=await client.auth.getSession();
    if(epoch!==start||latest?.error||latest?.data?.session?.access_token!==token||latest.data.session.user?.id!==user.id||session.expires_at*1000<=now())throw denied();
    return {id:user.id,token};
  }
  return {
    signIn:({email,password})=>bounded(async()=>{
      if(typeof email!=='string'||!email.includes('@')||email.length>320||typeof password!=='string'||!password||new TextEncoder().encode(password).length>4096)throw denied();
      const ticket=++action;active=false;
      const result=await client.auth.signInWithPassword({email:email.trim(),password});
      if(result?.error||ticket!==action)throw denied();
      const credential=await verified(true);if(ticket!==action)throw denied();active=true;return {id:credential.id};
    }),
    identity:()=>bounded(async()=>(await verified()).id),
    token:()=>bounded(async()=>(await verified()).token),
    signOut:()=>{active=false;action++;epoch++;return bounded(async()=>{const result=await client.auth.signOut({scope:'local'});if(result?.error)throw denied();return {signedOut:true};});}
  };
}
