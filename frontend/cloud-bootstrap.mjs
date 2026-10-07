/** Explicit first-upload preparation. Constructing this controller sends nothing. */
import {clone,digest} from '../app/core.mjs';
import {entities,canonicalJson,sameJson} from '../app/sync.mjs';
import {loadStore} from '../app/storage.mjs';
const MAX_BODY=2_000_000;
export function privateFirstUpload({db,transport,destination}){
  let target;try{target=new URL(destination);}catch{throw new Error('Configure the exact reviewed private project.');}
  if(target.protocol!=='https:'||target.origin!==destination||!/^[a-z0-9-]+\.supabase\.co$/.test(target.hostname)||target.port||target.username||target.password||!db||typeof transport?.read!=='function'||typeof transport?.bootstrap!=='function')throw new Error('Configure the exact reviewed private project and authenticated transport.');
  let busy=false;
  const exclusive=async run=>{if(busy)throw new Error('Wait for the current first-upload review.');busy=true;try{return await run();}finally{busy=false;}};
  const prepare=async(row,requestId)=>{
    if(!row.state)throw new Error('Open a local workspace before preparing first upload.');
    const records=entities(row.state),payloadDigest=await digest(canonicalJson(records));
    const request={workspace:row.state.id,requestId,records,review:{confirmed:true,destination,payloadDigest}};
    if(new TextEncoder().encode(JSON.stringify({action:'bootstrap',request})).byteLength>MAX_BODY)throw new Error('These records exceed the first-upload transport limit. Keep the complete local backup; do not trim original history to fit.');
    const review={app:'plan-first-upload-review',schema:1,revision:row.revision,state:clone(row.state),destination,request,includesImportedHistory:row.state.legacy!==null,automaticReplay:false};
    return {...review,digest:await digest(canonicalJson(review))};
  };
  return {
    preview:()=>exclusive(async()=>prepare(await loadStore(db),crypto.randomUUID())),
    send:(review,{confirmed=false,reviewDigest}={})=>{
      const selected=clone(review);
      return exclusive(async()=>{
        if(confirmed!==true)throw new Error('Review all records, imported history and the private destination before explicitly confirming first upload.');
        if(selected?.app!=='plan-first-upload-review'||selected.schema!==1||selected.destination!==destination||reviewDigest!==selected.digest||!/^[0-9a-f-]{36}$/i.test(selected.request?.requestId||''))throw new Error('Prepare and confirm the exact first-upload review.');
        const row=await loadStore(db);
        if(row.revision!==selected.revision||!sameJson(row.state,selected.state))throw new Error('Local records changed after the first-upload preview. Preview again.');
        const rebuilt=await prepare(row,selected.request.requestId);
        if(!sameJson(rebuilt,selected))throw new Error('The first-upload review changed. Nothing was sent.');
        if(await transport.read(row.state.id)!==null)throw new Error('Cloud records already exist. Compare both versions; first upload cannot replace them.');
        const latest=await loadStore(db);
        if(latest.revision!==row.revision||!sameJson(latest.state,row.state))throw new Error('Local records changed during the cloud read. Preview again.');
        const result=await transport.bootstrap(clone(selected.request));
        // Even a confirmed server receipt never clears local edits or establishes a
        // client baseline. Read and compare the exact server snapshot separately.
        return {result:clone(result),requiresCloudComparison:true,automaticReplay:false};
      });
    }
  };
}
