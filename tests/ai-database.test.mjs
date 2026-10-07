import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let PGlite;try{({PGlite}=await import('../private/pg-tests/node_modules/@electric-sql/pglite/dist/index.js'));}catch{}
test('isolated PostgreSQL AI budget reservations and private ownership',{skip:!PGlite},async t=>{
  const db=new PGlite(),alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64);
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    await db.exec(await readFile(new URL('../database/schema-draft.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../database/ai-budget-draft.sql',import.meta.url),'utf8'));
    const role=async(name='service_role',id=null,anonymous=false)=>{await db.exec(`reset role;set role ${name}`);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,is_anonymous:anonymous})]);};
    await role();await db.query("insert into plan_private.ai_budgets(owner_id,period,limit_micro,max_requests) values($1,to_char(now() at time zone 'UTC','YYYY-MM'),5000,10),($2,to_char(now() at time zone 'UTC','YYYY-MM'),1000,1)",[alice,bob]);
    const reserve=async(id,amount=4200,summary=hash,owner=alice)=>(await db.query('select public.plan_ai_reserve($1,$2,$3,$4,$4,$5,$4) as result',[owner,id,amount,hash,summary])).rows[0].result;
    const settle=async(id,status,charged)=>(await db.query('select public.plan_ai_settle($1,$2,$3,$4) as result',[alice,id,status,charged])).rows[0].result;
    const budget=async()=>(await db.query('select * from plan_private.ai_budgets where owner_id=$1',[alice])).rows[0];
    const first=crypto.randomUUID(),second=crypto.randomUUID();
    await t.test('unfunded owners are denied; admitted requests reserve capacity once',async()=>{assert.equal((await reserve(crypto.randomUUID(),4200,hash,bob)).status,'denied');assert.equal((await reserve(first)).status,'reserved');assert.equal((await reserve(first)).status,'duplicate');assert.equal((await budget()).held_micro,4200);assert.equal((await reserve(second,1000)).status,'denied');assert.equal((await budget()).requests,1);});
    await t.test('a reused request ID cannot replace the reviewed context',async()=>{await assert.rejects(reserve(first,4200,'b'.repeat(64)),/cannot be reused/);assert.equal((await budget()).held_micro,4200);});
    await t.test('uncertain charges keep the reservation across later retries',async()=>{assert.equal((await settle(first,'uncertain',null)).status,'uncertain');assert.equal((await reserve(first)).requestStatus,'uncertain');assert.equal((await budget()).held_micro,4200);});
    await t.test('confirmed settlement releases only the unused reservation and is idempotent',async()=>{assert.equal((await settle(first,'complete',100)).status,'complete');assert.equal((await settle(first,'complete',100)).status,'duplicate');assert.equal((await budget()).held_micro,0);assert.equal((await budget()).used_micro,100);await assert.rejects(settle(first,'complete',0),/immutable/);});
    await t.test('an overrun is recorded honestly and pauses all further requests',async()=>{assert.equal((await reserve(second,4000)).status,'reserved');assert.equal((await settle(second,'overrun',5000)).status,'overrun');const row=await budget();assert.equal(row.used_micro,5100);assert.equal(row.held_micro,0);assert.equal(row.paused,true);assert.equal((await reserve(crypto.randomUUID(),0)).status,'denied');});
    await t.test('even a zero-priced request is limited by the request-count budget',async()=>{assert.equal((await reserve(crypto.randomUUID(),0,hash,bob)).status,'reserved');assert.equal((await reserve(crypto.randomUUID(),0,hash,bob)).status,'denied');});
    await t.test('browser callers cannot alter limits or reservations and see only their own usage',async()=>{await role('authenticated',bob);assert.equal((await db.query('select * from plan_private.ai_requests')).rows.length,1);await assert.rejects(reserve(crypto.randomUUID(),0),/permission denied/);await assert.rejects(db.exec('update plan_private.ai_budgets set limit_micro=1000000'),/permission denied/);await role('authenticated',alice,true);assert.equal((await db.query('select * from plan_private.ai_budgets')).rows.length,0);await role('anon');await assert.rejects(db.exec('select * from plan_private.ai_requests'),/permission denied/);});
  }finally{await db.close();}
});
