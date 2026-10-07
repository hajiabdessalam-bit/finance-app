import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import * as C from '../app/core.mjs';
import {openStore,saveStore,loadStore,loadDrafts} from '../app/storage.mjs';
import {saveEdit} from '../app/edit-session.mjs';
async function isolated(run){const original=globalThis.indexedDB;globalThis.indexedDB=new IDBFactory();const db=await openStore();try{await run(db);}finally{db.close();if(original===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=original;}}
const add=(s,title)=>C.mutate(s,'note-add',{},n=>n.notes.push({id:C.uid(),title,body:'',items:[]}));
test('a concurrent tab save retains the proposed edit without replacing newer records',async()=>isolated(async db=>{const state=C.fresh();await saveStore(db,state,0);const newer=add(state,'Other tab');await saveStore(db,newer,1);await assert.rejects(saveEdit(db,{state,revision:1,type:'note-add',input:{title:'中文 العربية'},build:s=>add(s,'中文 العربية')}),error=>{assert.match(error.message,/Another tab/);assert.equal(error.draft.proposedState.notes[0].title,'中文 العربية');return true;});assert.deepEqual((await loadStore(db)).state,newer);assert.equal((await loadDrafts(db)).length,1);}));
test('invalid financial input retains the form and never changes confirmed records',async()=>isolated(async db=>{const state=C.fresh();await saveStore(db,state,0);await assert.rejects(saveEdit(db,{state,revision:1,type:'reconcile',input:{balance:'NaN'},build:()=>{C.money('NaN');}}),/retained/);assert.deepEqual((await loadStore(db)).state,state);const [draft]=await loadDrafts(db);assert.deepEqual(draft.input,{balance:'NaN'});assert.equal(draft.proposedState,undefined);}));
test('successful edits preserve existing recovery drafts and advance the revision once',async()=>isolated(async db=>{const state=C.fresh();await saveStore(db,state,0);const result=await saveEdit(db,{state,revision:1,type:'note-add',input:{title:'New'},build:s=>add(s,'New')});assert.equal(result.revision,2);assert.equal(result.state.notes.length,1);assert.deepEqual((await loadStore(db)).state,result.state);assert.equal((await loadDrafts(db)).length,0);}));
