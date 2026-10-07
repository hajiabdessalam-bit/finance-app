import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=new URL('../app/',import.meta.url),origin='https://plan.example';
async function harness({tamper=false}={}){
  const listeners={},stores=new Map([['plan-v2-shell-old',new Map([['old',new Response('Old release')]])],['another-app',new Map()]]);let offline=false,requests=0;
  const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);return {put:async(url,response)=>rows.set(String(url),response.clone()),match:async url=>rows.get(String(url))?.clone()};},keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)};
  const fetch=async url=>{requests++;if(offline)throw new Error('Offline');const path=new URL(url).pathname.slice(1)||'index.html';const bytes=await readFile(new URL(path,app));return new Response(tamper&&path==='index.html'?'A different release':bytes);};
  runInNewContext(await readFile(new URL('sw.js',app),'utf8'),{self:{location:{origin,href:`${origin}/sw.js`},addEventListener:(name,callback)=>listeners[name]=callback},caches,fetch,URL,Response,crypto,Uint8Array,Array,Promise,Error});
  const lifecycle=type=>new Promise((resolve,reject)=>listeners[type]({waitUntil:promise=>promise.then(resolve,reject)}));
  const request=async path=>{let response;listeners.fetch({request:new Request(`${origin}${path}`),respondWith:promise=>response=promise});return response?await response:null;};
  return {stores,lifecycle,request,goOffline:()=>offline=true,requests:()=>requests};
}
test('an installed public release loads both interfaces offline without mixing network assets',async()=>{const h=await harness();await h.lifecycle('install');h.goOffline();const count=h.requests(),native=await h.request('/'),react=await h.request('/react.html');assert.equal(native.status,200);assert.equal(react.status,200);const html=await native.text(),script=html.match(/src="\.([^\"]+)"/)[1];assert.match(script,/\/assets\/[a-f0-9]{64}\/ui.mjs/);assert.equal((await h.request(script)).status,200);assert.equal(h.requests(),count);});
test('a changed asset aborts installation and preserves the previous working release',async()=>{const h=await harness({tamper:true});await assert.rejects(h.lifecycle('install'),/changed while installing/);assert.ok(h.stores.has('plan-v2-shell-old'));assert.equal(h.stores.size,2);});
test('only public shell paths are intercepted; API, backups and unrelated files stay uncached',async()=>{const h=await harness();await h.lifecycle('install');for(const path of ['/api/sync','/finance-backup-2026-10-06.json','/private/records.json','/sw.js'])assert.equal(await h.request(path),null);});
test('activation retires older PLAN shells while preserving other application caches',async()=>{const h=await harness();await h.lifecycle('install');await h.lifecycle('activate');assert.equal(h.stores.has('plan-v2-shell-old'),false);assert.equal(h.stores.has('another-app'),true);assert.equal(h.stores.size,2);});
