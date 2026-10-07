import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredAdvisorRoute} from '../server/advisor-route.mjs';
test('deployment AI route stays closed even with readiness flags until verified private generator and configuration are supplied',async()=>{
 let calls=0;const env={PLAN_PRIVATE_DATABASE_VERIFIED:'true',PLAN_PRIVATE_ADVISOR_ENABLED:'true',PLAN_AI_PROVIDER_VERIFIED:'true'};
 for(const options of [{},{env},{env,configuration:{}},{env,generate:async()=>{}},{env,generate:async()=>{},configuration:{apiKey:'MUST_NOT_BE_PUBLIC'}}]){
  const handler=await configuredAdvisorRoute({...options,fetchImpl:async()=>{calls++;throw new Error('No network authorized');}});
  const response=await handler(new Request('https://plan.example.test/api/plan/advisor'));assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'private_advisor_not_configured'});assert.equal(response.headers.get('cache-control'),'no-store, private');
 }
 assert.equal(calls,0);
});
