/** Optional composition for verified cloud setup. No automatic data traffic. */
import {clone} from '../app/core.mjs';
import {privateSession} from './private-session.mjs';
import {privateCloudTransport} from './cloud-transport.mjs';
import {privateCloudReview} from './cloud-review.mjs';
import {privateQueueSender} from './cloud-send.mjs';
import {privateAdvisorTransport} from './advisor-transport.mjs';
import {privateAdvisorReview} from './advisor-review.mjs';
import {privateFirstUpload} from './cloud-bootstrap.mjs';
export function privateCloud({db,origin,currentOrigin,projectUrl,publishableKey,verifiedConfiguration=false,fetchImpl=globalThis.fetch}){
  // This UI readiness attestation is not authorization. The server independently
  // verifies its configuration, current user, ownership and every operation.
  if(verifiedConfiguration!==true)throw new Error('Complete private project and access-control verification before configuring cloud controls.');
  const session=privateSession({url:projectUrl,publishableKey,fetchImpl}),base=privateCloudTransport({origin,currentOrigin,tokenProvider:session.token,fetchImpl});
  let busy=false,actor=null;
  const exclusive=async run=>{if(busy)throw new Error('Wait for the current private cloud action.');busy=true;try{return await run();}finally{busy=false;actor=null;}};
  const sameActor=async()=>{if(!actor||await session.identity()!==actor)throw new Error('Sign-in changed. Keep local records and prepare a fresh review.');};
  const transport={read:async workspace=>{await sameActor();const result=await base.read(workspace);await sameActor();return result;},apply:async request=>{await sameActor();return base.apply(request);},bootstrap:async request=>{await sameActor();const result=await base.bootstrap(request);await sameActor();return result;}};
  const comparison=privateCloudReview({db,transport}),sender=privateQueueSender({db,transport,sessionIdentity:session.identity});
  const advisor=privateAdvisorReview({db,transport:privateAdvisorTransport({origin,currentOrigin,tokenProvider:session.token,fetchImpl}),cloudReader:transport,sessionIdentity:session.identity});
  const firstUpload=privateFirstUpload({db,transport,destination:projectUrl});
  const signed=run=>exclusive(async()=>{actor=await session.identity();return run(actor);});
  return {
    signIn:credentials=>exclusive(()=>session.signIn(credentials)),
    createAccount:credentials=>exclusive(()=>session.createAccount(credentials)),
    // Sign-out can invalidate a pending action immediately; it never deletes money.
    signOut:()=>session.signOut(),
    compare:()=>signed(async id=>({actor:id,...await comparison.compare()})),
    adopt:(review,options)=>{const selected=clone(review),confirmed=clone(options);return signed(async id=>{if(selected.actor!==id)throw new Error('Prepare a comparison for the current signed-in account.');return comparison.adopt(selected,confirmed);});},
    previewPending:()=>signed(()=>sender.preview()),
    sendPending:(review,options)=>{const selected=clone(review),confirmed=clone(options);return signed(()=>sender.send(selected,confirmed));},
    prepareQuestion:prompt=>signed(()=>advisor.preview(prompt)),
    askQuestion:(review,options)=>{const selected=clone(review),confirmed=clone(options);return signed(()=>advisor.ask(selected,confirmed));},
    savedAnswers:options=>{const selected=clone(options??{});return signed(()=>advisor.history(selected));},
    prepareFirstUpload:()=>signed(async id=>({actor:id,...await firstUpload.preview()})),
    sendFirstUpload:(review,options)=>{const selected=clone(review),confirmed=clone(options);return signed(async id=>{if(selected.actor!==id)throw new Error('Prepare this upload for the current signed-in account.');const {actor:ignored,...upload}=selected;return firstUpload.send(upload,confirmed);});}
    // Upload is always an explicit separate action with an exact destination review.
  };
}
