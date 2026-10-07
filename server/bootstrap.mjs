/** Explicit first upload preparation. No route, credentials, or upload is enabled. */
import {clone,digest} from '../app/core.mjs';
import {entities,hydrateSnapshot,canonicalJson,sameJson} from '../app/sync.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const fields=new Set(['workspace','requestId','records','review']);
/** Destination is pinned server configuration, never a client-selected URL to fetch. */
export async function validateBootstrap(request,destination){
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!fields.has(k)))throw new Error('Invalid first-upload request.');
  if(typeof destination!=='string'||!destination||destination.length>300)throw new Error('Configure the reviewed private destination.');
  if(typeof request.workspace!=='string'||!request.workspace||request.workspace.length>200||!UUID.test(request.requestId||''))throw new Error('Invalid first-upload identity.');
  if(!Array.isArray(request.records)||!request.records.length||request.records.length>10000||new TextEncoder().encode(JSON.stringify(request)).byteLength>5_000_000)throw new Error('First upload exceeds the reviewed size limit.');
  const review=request.review;
  if(!review||Object.keys(review).some(k=>!['confirmed','destination','payloadDigest'].includes(k))||review.confirmed!==true||review.destination!==destination||!HASH.test(review.payloadDigest||''))throw new Error('Confirm these records and their exact private destination before uploading.');
  for(const row of request.records)if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['collection','key','value'].includes(k)))throw new Error('Invalid first-upload record.');
  const state=hydrateSnapshot({workspace:request.workspace,version:1,records:request.records.map(row=>({...row,version:1})),operations:[]});
  const ordered=rows=>rows.slice().sort((a,b)=>(a.collection+'/'+a.key).localeCompare(b.collection+'/'+b.key));
  if(!sameJson(ordered(entities(state)),ordered(request.records)))throw new Error('First upload must include the complete reviewed workspace profile.');
  const payloadDigest=await digest(canonicalJson(request.records));
  if(payloadDigest!==review.payloadDigest)throw new Error('Records changed after the upload review.');
  return {workspace:request.workspace,requestId:request.requestId,records:clone(request.records),payloadDigest};
}
