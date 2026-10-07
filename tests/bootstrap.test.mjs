import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../app/core.mjs';
import * as S from '../app/sync.mjs';
import {validateBootstrap} from '../server/bootstrap.mjs';
import {syncService} from '../server/sync-service.mjs';
const owner='11111111-1111-4111-8111-111111111111',destination='https://synthetic.supabase.co';
async function request(s=C.fresh()){const records=S.entities(s);return {workspace:s.id,requestId:C.uid(),records,review:{confirmed:true,destination,payloadDigest:await C.digest(S.canonicalJson(records))}};}
test('first upload contains complete records without replaying offline operations',async()=>{
  const state=C.mutate(C.fresh(),'note-add',{},n=>n.notes.push({id:'n',title:'Synthetic',body:'中文 العربية',items:[]}));const body=await request(state),checked=await validateBootstrap(body,destination);
  assert.equal(checked.workspace,state.id);assert.equal(checked.records.find(r=>r.collection==='preferences').value.seq,1);assert.equal(checked.records.some(r=>r.collection==='operations'),false);assert.equal(state.operations.length,1);
});
test('a changed payload, absent consent, wrong destination and owner injection cannot be uploaded',async()=>{
  const body=await request();await assert.rejects(validateBootstrap({...body,owner},destination),/Invalid/);
  for(const review of [{...body.review,confirmed:false},{...body.review,destination:'https://other.supabase.co'},{...body.review,payloadDigest:'a'.repeat(64)}])await assert.rejects(validateBootstrap({...body,review},destination),/Confirm|changed/);
  const incomplete=C.clone(body);delete incomplete.records.find(r=>r.collection==='preferences').value.settings;incomplete.review.payloadDigest=await C.digest(S.canonicalJson(incomplete.records));await assert.rejects(validateBootstrap(incomplete,destination),/complete/);
  await assert.rejects(validateBootstrap({...body,records:[...body.records,body.records[0]]},destination),/Inconsistent/);
});
test('verified actor is injected before a private first-upload adapter and invalid requests never reach it',async()=>{
  const calls=[],store={read:async()=>null,apply:async()=>{},bootstrap:async(actor,command)=>{calls.push({actor,command});return {status:'initialized',version:1};}},service=syncService({destination,store,verifySession:async token=>({id:owner,is_anonymous:token!=='valid'})}),body=await request();
  await assert.rejects(service.bootstrap({token:'anonymous',request:body}),/permanent/);await assert.rejects(service.bootstrap({token:'valid',request:{...body,review:{...body.review,confirmed:false}}}),/Confirm/);assert.equal(calls.length,0);
  assert.deepEqual(await service.bootstrap({token:'valid',request:body}),{status:'initialized',version:1});assert.equal(calls[0].actor,owner);assert.equal(calls[0].command.payloadDigest,body.review.payloadDigest);
});
