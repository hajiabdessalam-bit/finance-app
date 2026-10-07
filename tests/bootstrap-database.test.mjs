import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
let PGlite;try{({PGlite}=await import('../private/pg-tests/node_modules/@electric-sql/pglite/dist/index.js'));}catch{}
test('isolated first-upload ownership, retries, conflicts and transaction rollback',{skip:!PGlite},async t=>{
  const db=new PGlite(),alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222';
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${alice}'),('${bob}');
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to authenticated,anon,service_role;grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    await db.exec(await readFile(new URL('../database/schema-draft.sql',import.meta.url),'utf8'));await db.exec(await readFile(new URL('../database/bootstrap-draft.sql',import.meta.url),'utf8'));
    const state=C.fresh(),rows=S.entities(state),hash=await C.digest(S.canonicalJson(rows)),first=C.uid(),later=C.uid();
    const role=async(name,id=alice,anonymous=false)=>{await db.exec('reset role;set role '+name);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,is_anonymous:anonymous})]);};
    const init=async(id=first,records=rows,workspace=state.id,digest=hash,owner=alice)=>(await db.query('select public.plan_bootstrap_validated_workspace($1,$2,$3,$4,$5::jsonb) as result',[owner,workspace,id,digest,JSON.stringify(records)])).rows[0].result;
    const snapshot=async(owner=alice)=>(await db.query('select public.plan_read_validated_workspace($1,$2) as result',[owner,state.id])).rows[0].result;
    await role('service_role');
    await t.test('initial records commit once and reconstruct the complete state',async()=>{assert.deepEqual(await init(),{status:'initialized',version:1});assert.deepEqual(S.entities(S.hydrateSnapshot(await snapshot())),rows);});
    await t.test('a lost-response retry is idempotent but different content cannot reuse its ID',async()=>{assert.equal((await init()).status,'duplicate');await assert.rejects(init(first,rows,state.id,'a'.repeat(64)),/cannot be reused/);assert.equal((await snapshot()).version,1);});
    await t.test('a second first upload cannot overwrite an existing workspace',async()=>{const other=C.clone(rows);other.find(r=>r.collection==='preferences').value.name='Replacement';assert.equal((await init(later,other)).status,'conflict');assert.equal(S.hydrateSnapshot(await snapshot()).name,state.name);});
    await t.test('later incremental edits survive a retry of the first upload',async()=>{const op=C.uid(),patches=[{collection:'preferences',key:'profile',action:'put',value:{seq:1,name:'Later'}}];await db.query('select public.plan_apply_validated_operation($1,$2,$3,1,$4,$5::jsonb)',[alice,state.id,op,'settings',JSON.stringify(patches)]);assert.deepEqual(await init(),{status:'duplicate',version:2});assert.equal(S.hydrateSnapshot(await snapshot()).name,'Later');});
    await t.test('a failing record rolls back all rows and the newly created workspace',async()=>{const failedId='rollback',records=C.clone(rows);records.find(r=>r.collection==='preferences').value.id=failedId;records.push({collection:'unknown',key:'bad',value:{}});await assert.rejects(init(C.uid(),records,failedId),/check constraint/);assert.equal((await db.query('select count(*)::int as n from plan_private.workspaces where id=$1',[failedId])).rows[0].n,0);});
    await t.test('duplicate rows are rejected rather than hiding an overwritten record',async()=>{await assert.rejects(init(C.uid(),[...rows,rows[0]],'duplicate'),/Duplicate/);});
    await t.test('browser users and anonymous users cannot initialize or inspect private receipts',async()=>{for(const [name,id,anonymous] of [['authenticated',alice,false],['authenticated',alice,true],['anon',null,false]]){await role(name,id,anonymous);await assert.rejects(init(),/permission denied/);await assert.rejects(db.query('select * from plan_private.bootstrap_receipts'),/permission denied/);}await role('authenticated',bob);assert.equal((await db.query('select public.plan_read_workspace($1) as result',[state.id])).rows[0].result,null);});
  }finally{await db.close();}
});
