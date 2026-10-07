import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Optional local-only test runtime; never bundled into the deployed app.
let PGlite;
try{({PGlite}=await import('../private/pg-tests/node_modules/@electric-sql/pglite/dist/index.js'));}catch{}
test('isolated PostgreSQL ownership and operation rules',{skip:!PGlite},async t=>{
  const db=new PGlite();
  const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values ('${alice}'),('${bob}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated,anon,service_role;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    await db.exec(await readFile(new URL('../database/schema-draft.sql',import.meta.url),'utf8'));
    const actor=async(id,anonymous=false,role='authenticated')=>{await db.exec(`reset role; set role ${role};`);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,is_anonymous:anonymous})]);};
    const backend=async()=>actor(null,false,'service_role');
    const apply=async(id,version,patches)=> (await db.query('select public.plan_apply_validated_operation($1,$2,$3,$4,$5,$6::jsonb) as result',[alice,'test-workspace',id,version,'test',JSON.stringify(patches)])).rows[0].result;
    const patch=(collection,key,value)=>({action:'put',collection,key,value});
    const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const initial=[patch('notes','note',{id:'note',title:'Synthetic',body:'',items:[]}),patch('transactions','entry',{id:'entry',amount:100}),patch('preferences','profile',{schema:2,seq:0,name:'Synthetic'})];
    await backend();
    await t.test('private server applies and reads an atomic snapshot',async()=>{assert.equal((await apply(first,0,initial)).status,'applied');await actor(alice);const result=(await db.query("select public.plan_read_workspace('test-workspace') as result")).rows[0].result;assert.equal(result.version,1);assert.equal(result.records.length,3);assert.equal(result.operations.length,1);await backend();});
    await t.test('retry is idempotent and stale writes conflict',async()=>{assert.equal((await apply(first,0,initial)).status,'duplicate');assert.equal((await apply(second,0,[])).status,'conflict');});
    await t.test('operation ID reuse cannot replace its original content',async()=>{await assert.rejects(apply(first,1,[]),/cannot be reused/);});
    await t.test('ledger originals cannot be overwritten',async()=>{await assert.rejects(apply(second,1,[patch('transactions','entry',{id:'entry',amount:999})]),/immutable/);assert.equal((await db.query("select public.plan_read_validated_workspace($1,'test-workspace') as result",[alice])).rows[0].result.version,1);});
    await t.test('another user cannot read or update the owner records',async()=>{await actor(bob);assert.equal((await db.query("select public.plan_read_workspace('test-workspace') as result")).rows[0].result,null);assert.equal((await db.query('select * from plan_private.records')).rows.length,0);await assert.rejects(db.query("update plan_private.workspaces set version=99 where id='test-workspace' returning id"),/permission denied/);await backend();});
    await t.test('anonymous signed-in accounts have no access',async()=>{await actor(alice,true);await assert.rejects(db.query("select public.plan_read_workspace('test-workspace')"),/permanent/);assert.equal((await db.query('select * from plan_private.records')).rows.length,0);await assert.rejects(apply(second,1,[]),/permission denied/);await backend();});
    await t.test('unauthenticated callers cannot call financial RPCs',async()=>{await actor(null,false,'anon');await assert.rejects(db.query("select public.plan_read_workspace('test-workspace')"),/permission denied/);await assert.rejects(db.query('select * from plan_private.records'),/permission denied/);await backend();});
    await t.test('browser cannot write directly, call private RPCs or delete history',async()=>{await actor(alice);await assert.rejects(apply(second,1,initial),/permission denied/);await assert.rejects(db.query("insert into plan_private.workspaces(owner_id,id) values($1,'bypass')",[alice]),/permission denied/);await assert.rejects(db.query("select public.plan_read_validated_workspace($1,'test-workspace')",[alice]),/permission denied/);await assert.rejects(db.query('delete from plan_private.records'),/permission denied/);await assert.rejects(db.query('update plan_private.records set owner_id=$1',[bob]),/permission denied/);});
    await t.test('incremental preference fields merge without dropping the stored profile',async()=>{await backend();assert.equal((await apply(second,1,[patch('preferences','profile',{seq:1})])).status,'applied');const result=(await db.query("select public.plan_read_validated_workspace($1,'test-workspace') as result",[alice])).rows[0].result;assert.deepEqual(result.records.find(r=>r.collection==='preferences').value,{schema:2,seq:1,name:'Synthetic'});});
  }finally{await db.close();}
});
