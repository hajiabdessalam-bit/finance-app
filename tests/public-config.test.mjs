import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredPublicConfig,publicConnection} from '../server/public-config.mjs';
const env={PLAN_APP_ORIGIN:'https://plan.example.test',PLAN_SUPABASE_URL:'https://synthetic-plan.supabase.co',PLAN_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_public_key',PLAN_SUPABASE_SECRET_KEY:'PRIVATE_TEST_SECRET',PLAN_AI_API_KEY:'PRIVATE_PROVIDER_TEST',PLAN_PRIVATE_DATABASE_VERIFIED:'true',PLAN_PRIVATE_SYNC_ENABLED:'true'};
test('connection endpoint exposes only verified public metadata, never private keys or record data',async()=>{
 const handle=configuredPublicConfig({env}),result=await handle(new Request(env.PLAN_APP_ORIGIN+'/api/plan/config'));
 assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);assert.deepEqual(await result.json(),{projectUrl:env.PLAN_SUPABASE_URL,publishableKey:env.PLAN_SUPABASE_PUBLISHABLE_KEY,aiEnabled:false});
 assert.equal(JSON.stringify(publicConnection({env})).includes('PRIVATE'),false);
});
test('unverified projects, malformed public keys and wrong routes cannot advertise a ready private connection',async()=>{
 for(const changed of [{PLAN_PRIVATE_DATABASE_VERIFIED:'false'},{PLAN_PRIVATE_SYNC_ENABLED:'false'},{PLAN_SUPABASE_URL:'http://synthetic-plan.supabase.co'},{PLAN_SUPABASE_URL:'https://synthetic-plan.supabase.co/path'},{PLAN_SUPABASE_PUBLISHABLE_KEY:'sb_secret_not_public'}])assert.equal(publicConnection({env:{...env,...changed}}),null);
 const handle=configuredPublicConfig({env});assert.equal((await handle(new Request('https://other.example.test/api/plan/config'))).status,404);assert.equal((await handle(new Request(env.PLAN_APP_ORIGIN+'/api/plan/config?secret=yes'))).status,404);assert.equal((await handle(new Request(env.PLAN_APP_ORIGIN+'/api/plan/config',{method:'POST'}))).status,405);
 assert.equal((await configuredPublicConfig() (new Request(env.PLAN_APP_ORIGIN+'/api/plan/config'))).status,404);
});
