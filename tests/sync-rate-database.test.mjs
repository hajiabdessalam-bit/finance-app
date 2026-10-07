import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let PGlite;try{({PGlite}=await import('../private/pg-tests/node_modules/@electric-sql/pglite/dist/index.js'));}catch{}
test('isolated PostgreSQL account sync admission',{skip:!PGlite},async t=>{
  const db=new PGlite(),alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema plan_private;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');grant usage on schema plan_private to service_role,authenticated,anon;`);
    await db.exec(await readFile(new URL('../database/sync-rate-draft.sql',import.meta.url),'utf8'));
    const role=async name=>db.exec('reset role;set role '+name),admit=async owner=>(await db.query('select public.plan_sync_admit($1) as result',[owner])).rows[0].result;
    await role('service_role');
    await t.test('60 requests are admitted, later requests denied with a bounded counter and retry',async()=>{const results=(await db.query('select public.plan_sync_admit($1) as result from generate_series(1,60)',[alice])).rows.map(r=>r.result);assert.ok(results.every(r=>r.allowed));for(let i=0;i<3;i++){const denied=await admit(alice);assert.equal(denied.allowed,false);assert.ok(denied.retryAfterSeconds>=1&&denied.retryAfterSeconds<=60);}assert.equal((await db.query('select requests from plan_private.sync_rate where owner_id=$1',[alice])).rows[0].requests,61);});
    await t.test('owners have separate counters and the server minute resets an old bucket',async()=>{assert.equal((await admit(bob)).allowed,true);await db.query("update plan_private.sync_rate set minute=date_trunc('minute',clock_timestamp())-interval '1 minute' where owner_id=$1",[alice]);assert.equal((await admit(alice)).allowed,true);assert.equal((await db.query('select requests from plan_private.sync_rate where owner_id=$1',[alice])).rows[0].requests,1);});
    await t.test('an earlier or delayed request cannot roll a newer bucket backwards',async()=>{await db.query("update plan_private.sync_rate set minute=date_trunc('minute',clock_timestamp())+interval '1 minute',requests=60 where owner_id=$1",[bob]);const denied=await admit(bob);assert.equal(denied.allowed,false);assert.equal((await db.query('select requests from plan_private.sync_rate where owner_id=$1',[bob])).rows[0].requests,61);});
    await t.test('browser roles cannot inspect, reset or invoke account admission',async()=>{for(const name of ['authenticated','anon']){await role(name);await assert.rejects(admit(alice),/permission denied/);await assert.rejects(db.exec('select * from plan_private.sync_rate'),/permission denied/);await assert.rejects(db.exec('update plan_private.sync_rate set requests=1'),/permission denied/);}});
    await t.test('missing and deleted identities cannot create rate buckets',async()=>{await role('service_role');await assert.rejects(admit(null),/identity required/);await assert.rejects(admit('33333333-3333-4333-8333-333333333333'),/foreign key/);assert.equal((await db.query('select count(*)::int as n from plan_private.sync_rate')).rows[0].n,2);});
  }finally{await db.close();}
});
