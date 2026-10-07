import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storageHealth} from '../app/storage.mjs';
test('optional browser estimates cannot make saved records appear unavailable',async()=>{
  assert.deepEqual(await storageHealth({estimate:async()=>({usage:10,quota:100})}),{usage:10,quota:100,persisted:null});
  assert.deepEqual(await storageHealth({estimate:async()=>{throw new Error('Estimate unavailable');},persisted:async()=>true}),{usage:null,quota:null,persisted:true});
  assert.deepEqual(await storageHealth({estimate:async()=>({usage:-1,quota:0}),persisted:async()=>{throw new Error('Unsupported');}}),{usage:null,quota:null,persisted:null});
  assert.equal(await storageHealth(null),null);
});
