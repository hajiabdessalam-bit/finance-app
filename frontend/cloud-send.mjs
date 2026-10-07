/** Reviewed queue sender preparation. No sign-in, timer or automatic replay. */
import {clone,digest} from '../app/core.mjs';
import {canonicalJson,sameJson,flushOperations} from '../app/sync.mjs';
import {loadSyncContext,acknowledgeOperation} from '../app/storage.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function privateQueueSender({db,transport,sessionIdentity}){
  if(!db||typeof transport?.read!=='function'||typeof transport?.apply!=='function'||typeof sessionIdentity!=='function')throw new Error('Configure a verified private session and transport before reviewing edits.');
  let busy=false;
  const exclusive=async run=>{if(busy)throw new Error('Wait for the current queue review.');busy=true;try{return await run();}finally{busy=false;}};
  const identity=async()=>{const id=await sessionIdentity();if(!UUID.test(id||''))throw new Error('Sign in with a permanent verified account before sending edits.');return id;};
  async function prepare(context,actor){
    const {row,baseline,hold,queue}=context;
    if(!row.state||hold||baseline?.workspace!==row.state.id||!Number.isSafeInteger(baseline.version)||baseline.version<1)throw new Error('A reviewed cloud baseline without a restore hold is required. Compare records first.');
    const operations=row.state.operations.filter(op=>op.sync==='pending');
    if(!operations.length||operations.length!==queue.length)throw new Error('Review a complete nonempty device queue before sending.');
    for(let i=0;i<operations.length;i++){
      const op=operations[i],queued=queue.find(q=>q.id===op.id),record=queued?Object.fromEntries(Object.entries(queued).filter(([key])=>key!=='stateId')):null;
      if(queued?.stateId!==row.state.id||!sameJson(record,op)||op.baseVersion!==baseline.version+i||op.version!==op.baseVersion+1)throw new Error('The queue does not match its reviewed cloud baseline. Keep edits and compare records.');
    }
    const review={app:'plan-queue-review',schema:1,actor,context:clone(context),operations:clone(operations),automaticReplay:false};
    return {...review,digest:await digest(canonicalJson(review))};
  }
  return {
    preview:()=>exclusive(async()=>prepare(await loadSyncContext(db),await identity())),
    send:(review,{confirmed=false,reviewDigest}={})=>{
      const selected=clone(review);
      return exclusive(async()=>{
        if(confirmed!==true)throw new Error('Review and explicitly confirm these pending edits before sending.');
        const actor=await identity(),context=await loadSyncContext(db),rebuilt=await prepare(context,actor);
        if(selected?.app!=='plan-queue-review'||selected.digest!==reviewDigest||!sameJson(rebuilt,selected))throw new Error('The session, records or queue changed after review. Nothing was sent.');
        const snapshot=await transport.read(context.row.state.id);
        if(snapshot?.workspace!==context.row.state.id||snapshot.version!==context.baseline.version)throw new Error('Cloud records changed. Compare both versions before sending edits.');
        let revision=context.row.revision;const receipts=new Map();
        const unchanged=async()=>{if(await identity()!==actor||(await loadSyncContext(db)).row.revision!==revision)throw new Error('The session or local records changed. Keep pending edits and compare records.');};
        await unchanged();
        await flushOperations({workspace:context.row.state.id,operations:selected.operations,remoteVersion:context.baseline.version,
          transport:{apply:async request=>{await unchanged();const receipt=await transport.apply(request);receipts.set(request.operationId,clone(receipt));return receipt;}},
          onAck:async(id,version)=>{if(await identity()!==actor)throw new Error('Sign-in changed before the receipt could be retained. Keep pending edits for review.');const receipt=receipts.get(id),op=selected.operations.find(o=>o.id===id);if(receipt?.version!==version)throw new Error('The exact receipt was not retained.');const result=await acknowledgeOperation(db,{workspace:context.row.state.id,operation:op,receipt,expectedRevision:revision});revision=result.revision;}});
        return {revision,acknowledged:selected.operations.length,automaticReplay:false};
      });
    }
  };
}
