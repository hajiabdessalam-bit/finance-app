/** Device-bound AI review preparation. Never uploads or changes finance records. */
import {clone,digest} from '../app/core.mjs';
import {canonicalJson,entities,hydrateSnapshot,sameJson} from '../app/sync.mjs';
import {loadSyncContext} from '../app/storage.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sortedEntities=state=>entities(state).sort((a,b)=>`${a.collection}/${a.key}`.localeCompare(`${b.collection}/${b.key}`));
export function privateAdvisorReview({db,transport,cloudReader,sessionIdentity}){
 if(!db||typeof transport?.preview!=='function'||typeof transport?.ask!=='function'||typeof transport?.history!=='function'||typeof cloudReader?.read!=='function'||typeof sessionIdentity!=='function')throw new Error('Configure verified private sign-in, cloud records and AI transport.');
 let busy=false;
 const exclusive=async run=>{if(busy)throw new Error('Wait for the current AI review.');busy=true;try{return await run();}finally{busy=false;}};
 const identity=async()=>{const id=await sessionIdentity();if(!UUID.test(id||''))throw new Error('Sign in with a verified permanent account.');return id;};
 const unchangedActor=async actor=>{if(await identity()!==actor)throw new Error('Sign-in changed. Keep the question review and any cost hold; do not retry automatically.');};
 async function ready(){
  const context=await loadSyncContext(db),state=context.row.state;
  if(!state||context.hold||context.queue.length||state.operations.some(op=>op.sync==='pending')||context.baseline?.workspace!==state.id||context.baseline.version!==state.version||state.version<1)throw new Error('Compare and review all pending device edits before asking AI about current records.');
  return context;
 }
 async function unchanged(context,actor){await unchangedActor(actor);if(!sameJson(await loadSyncContext(db),context))throw new Error('Device records changed. Keep edits and prepare a fresh AI review.');}
 return {
  preview:prompt=>exclusive(async()=>{
   const actor=await identity(),context=await ready(),state=context.row.state;
   const snapshot=await cloudReader.read(state.id);await unchanged(context,actor);
   const remote=hydrateSnapshot(clone(snapshot));
   if(remote.id!==state.id||remote.version!==state.version||!sameJson(sortedEntities(remote),sortedEntities(state)))throw new Error('Cloud and device records differ. Compare both versions before asking AI.');
   const expectedWorkspaceDigest=await digest(canonicalJson(remote));
   const review=await transport.preview(state.id,prompt);await unchanged(context,actor);
   if(review.owner!==actor||review.workspace!==state.id||review.version!==state.version||review.workspaceDigest!==expectedWorkspaceDigest)throw new Error('Cloud records changed while preparing AI. Compare and prepare a fresh review.');
   const selection={app:'plan-device-advisor-review',schema:1,actor,revision:context.row.revision,contextDigest:await digest(canonicalJson(context)),review:clone(review),recordsChanged:false};
   return {...selection,digest:await digest(canonicalJson(selection))};
  }),
  ask:(review,{confirmed=false,reviewDigest}={})=>{
   const selected=clone(review);
   return exclusive(async()=>{
    if(confirmed!==true||selected?.app!=='plan-device-advisor-review'||selected.schema!==1||selected.recordsChanged!==false||selected.digest!==reviewDigest)throw new Error('Explicitly confirm this device review, summary, question and maximum cost.');
    const {digest:claimed,...contents}=selected;
    if(await digest(canonicalJson(contents))!==claimed)throw new Error('The device review changed. Prepare a fresh review.');
    const actor=await identity(),context=await ready();
    if(selected.actor!==actor||selected.review?.owner!==actor||context.row.revision!==selected.revision||await digest(canonicalJson(context))!==selected.contextDigest||selected.review.workspace!==context.row.state.id||selected.review.version!==context.row.state.version)throw new Error('Sign-in or device records changed after review. Nothing was sent.');
    await unchanged(context,actor);
    const result=await transport.ask(selected.review,{confirmed:true,reviewDigest:selected.review.digest});
    await unchangedActor(actor);
    // A completed paid answer remains readable if a concurrent local edit occurred.
    // Its context version is retained; it is never presented as current advice.
    const deviceChanged=!sameJson(await loadSyncContext(db),context);
    return {result:clone(result),deviceChanged,recordsChanged:false};
   });
  },
  history:({before=null,limit=20}={})=>exclusive(async()=>{
   const actor=await identity(),context=await loadSyncContext(db),workspace=context.row.state?.id;
   if(!workspace)throw new Error('Open a private workspace before reading saved answers.');
   const result=await transport.history({workspace,before,limit});await unchangedActor(actor);
   if((await loadSyncContext(db)).row.state?.id!==workspace)throw new Error('Workspace changed. Read saved answers for the selected workspace.');
   return result;
  })
 };
}
