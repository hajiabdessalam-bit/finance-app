/** Explicit read/review/adoption preparation. No startup requests or uploads. */
import {clone} from '../app/core.mjs';
import {prepareRemoteReview,verifyRemoteReview,sameJson} from '../app/sync.mjs';
import {loadStore,adoptReviewedRemote} from '../app/storage.mjs';

export function privateCloudReview({db,transport}){
  if(!db||typeof transport?.read!=='function')throw new Error('Configure private local storage and an authenticated cloud reader.');
  let busy=false;
  const exclusive=async run=>{
    if(busy)throw new Error('Wait for the current cloud comparison to finish.');
    busy=true;try{return await run();}finally{busy=false;}
  };
  return {
    compare:()=>exclusive(async()=>{
      const before=await loadStore(db);
      if(!before.state)throw new Error('Open a local workspace before comparing cloud records.');
      const snapshot=await transport.read(before.state.id);
      const after=await loadStore(db);
      if(after.revision!==before.revision||!sameJson(after.state,before.state))throw new Error('Local records changed during the read. Compare again; all local edits are retained.');
      if(snapshot===null)return {kind:'empty',workspace:before.state.id,revision:before.revision,requiresFirstUploadReview:true};
      const review=await prepareRemoteReview(before.state,snapshot);
      return {kind:'comparison',revision:before.revision,review};
    }),
    adopt:(comparison,{confirmed=false,reviewDigest}={})=>{
      // Capture the displayed comparison before awaiting sign-in or a server read.
      const captured=clone(comparison);
      return exclusive(async()=>{
        if(confirmed!==true)throw new Error('Review both complete versions and confirm the selected cloud records.');
        if(captured?.kind!=='comparison'||!Number.isSafeInteger(captured.revision)||captured.revision<1)throw new Error('Prepare a cloud comparison before selecting records.');
        const before=await loadStore(db);
        if(before.revision!==captured.revision)throw new Error('Local records changed after review. Compare again.');
        await verifyRemoteReview(before.state,captured.review,reviewDigest);
        const latest=await transport.read(before.state.id);
        if(!sameJson(latest,captured.review.snapshot))throw new Error('Cloud records changed after review. Compare again; neither version was replaced.');
        const revision=await adoptReviewedRemote(db,captured.review,{expectedRevision:captured.revision,reviewDigest,confirmed:true});
        return {revision,state:clone(captured.review.remote),automaticReplay:false};
      });
    }
  };
}
