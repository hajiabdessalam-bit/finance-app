import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateSession} from '../frontend/private-session.mjs';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const config={url:'https://synthetic-plan.supabase.co',publishableKey:'sb_publishable_synthetic_test_key',now:()=>1000};
const user={id:owner,is_anonymous:false,email_confirmed_at:'2026-10-07T00:00:00Z'};
function fixture(){
  let session=null,verifiedUser={...user},callback=()=>{},onUser=null,onLogin=null;const calls=[];
  const auth={onAuthStateChange:fn=>{callback=fn;return {data:{subscription:{unsubscribe(){}}}};},
    getSession:async()=>({data:{session},error:null}),getUser:async token=>{calls.push(['verify',token]);await onUser?.();return {data:{user:verifiedUser},error:null};},
    signInWithPassword:async input=>{calls.push(['login',input.email]);await onLogin?.();session={access_token:'synthetic-token',expires_at:100,user:{id:owner}};callback('SIGNED_IN');return {data:{session},error:null};},
    signOut:async options=>{calls.push(['logout',options.scope]);session=null;callback('SIGNED_OUT');return {error:null};}};
  const controller=privateSession({...config,clientFactory:(url,key,options)=>{assert.equal(url,config.url);assert.equal(key,config.publishableKey);assert.deepEqual(options.auth,{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false});return {auth};}});
  return {controller,calls,auth,setUser:u=>verifiedUser=u,setSession:s=>session=s,onUser:fn=>onUser=fn,onLogin:fn=>onLogin=fn};
}
test('sign-in returns only verified permanent identity and credentials are transient',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);await assert.rejects(f.controller.token(),/verified/);
  assert.deepEqual(await f.controller.signIn({email:'sample@example.test',password:'synthetic-only'}),{id:owner});assert.equal(await f.controller.identity(),owner);assert.equal(await f.controller.token(),'synthetic-token');
  assert.equal(f.calls.filter(c=>c[0]==='verify').length,3);assert.deepEqual(await f.controller.signOut(),{signedOut:true});await assert.rejects(f.controller.identity(),/verified/);
});
test('anonymous, unconfirmed, revoked, mismatched and expired sessions cannot supply cloud credentials',async()=>{
  for(const bad of [{...user,is_anonymous:true},{...user,email_confirmed_at:null},{...user,id:other},null]){const f=fixture();f.setUser(bad);await assert.rejects(f.controller.signIn({email:'sample@example.test',password:'synthetic-only'}),/verified/);await assert.rejects(f.controller.token(),/verified/);}
  const f=fixture();await f.controller.signIn({email:'sample@example.test',password:'synthetic-only'});f.setSession({access_token:'synthetic-token',expires_at:0,user:{id:owner}});await assert.rejects(f.controller.token(),/verified/);
  f.auth.getSession=async()=>{throw new Error('private server details');};await assert.rejects(f.controller.identity(),error=>!error.message.includes('private server details'));
});
test('account changes during verification and sign-out during pending login stay signed out',async()=>{
  const f=fixture();await f.controller.signIn({email:'sample@example.test',password:'synthetic-only'});
  f.onUser(async()=>f.setSession({access_token:'other-token',expires_at:100,user:{id:other}}));await assert.rejects(f.controller.token(),/verified/);
  const delayed=fixture();let release;delayed.onLogin(()=>new Promise(resolve=>release=resolve));const pending=delayed.controller.signIn({email:'sample@example.test',password:'synthetic-only'});await Promise.resolve();await delayed.controller.signOut();release();await assert.rejects(pending,/verified/);await assert.rejects(delayed.controller.token(),/verified/);
});
test('actual pinned Supabase SDK uses memory-only login and server user verification with synthetic responses',async()=>{
  const calls=[];const sdkUser={...user,email:'sample@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-10-07T00:00:00Z'};
  const controller=privateSession({...config,fetchImpl:async(url,options)=>{calls.push({url:String(url),headers:options.headers});
    const body=String(url).includes('/token?')?{access_token:'synthetic-token',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'bearer',user:sdkUser}:sdkUser;
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});}});
  await Promise.resolve();assert.equal(calls.length,0);assert.deepEqual(await controller.signIn({email:sdkUser.email,password:'synthetic-only'}),{id:owner});assert.equal(await controller.token(),'synthetic-token');
  assert.ok(calls[0].url.includes('/auth/v1/token?grant_type=password'));assert.equal(calls.filter(c=>c.url.endsWith('/auth/v1/user')).length,2);assert.ok(calls.every(c=>c.url.startsWith(config.url+'/auth/v1/')));
});
test('a timed-out login cannot activate a late session or expose its credential',async()=>{
  let release,session=null;const controller=privateSession({...config,timeoutMs:5,clientFactory:()=>({auth:{onAuthStateChange(){},getSession:async()=>({data:{session}}),getUser:async()=>({data:{user}}),signOut:async()=>({error:null}),signInWithPassword:async()=>{await new Promise(resolve=>release=resolve);session={access_token:'late-synthetic-token',expires_at:100,user:{id:owner}};return {error:null};}}})});
  await assert.rejects(controller.signIn({email:'sample@example.test',password:'synthetic-only'}),/verified/);release();await Promise.resolve();await assert.rejects(controller.token(),/verified/);
});
