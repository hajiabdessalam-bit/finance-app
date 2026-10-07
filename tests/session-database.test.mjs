import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let PGlite;try{({PGlite}=await import('../private/pg-tests/node_modules/@electric-sql/pglite/dist/index.js'));}catch{}
test('isolated session lookup requires private service identity and the exact owner, and logout removes access',{skip:!PGlite},async()=>{
 const db=new PGlite(),owner=crypto.randomUUID(),other=crypto.randomUUID(),session=crypto.randomUUID();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.sessions(id uuid primary key,user_id uuid not null,private_secret text);');
  await db.query('insert into auth.sessions values($1,$2,$3)',[session,owner,'SYNTHETIC_NOT_READABLE']);
  await db.exec(await readFile(new URL('../database/session-draft.sql',import.meta.url),'utf8'));
  await db.exec('set role service_role');
  const active=async(user,id)=>(await db.query('select public.plan_session_active($1,$2) as active',[user,id])).rows[0].active;
  assert.equal(await active(owner,session),true);assert.equal(await active(other,session),false);assert.equal(await active(owner,crypto.randomUUID()),false);
  await assert.rejects(active(null,session),/Verified/);
  await assert.rejects(db.exec('select private_secret from auth.sessions'),/permission denied/);
  await assert.rejects(db.exec('delete from auth.sessions'),/permission denied/);
  for(const role of ['anon','authenticated']){
   await db.exec('reset role;set role '+role);await assert.rejects(active(owner,session),/permission denied/);
  }
  await db.exec('reset role');await db.query('delete from auth.sessions where id=$1',[session]);await db.exec('set role service_role');assert.equal(await active(owner,session),false);
 }finally{await db.close();}
});
