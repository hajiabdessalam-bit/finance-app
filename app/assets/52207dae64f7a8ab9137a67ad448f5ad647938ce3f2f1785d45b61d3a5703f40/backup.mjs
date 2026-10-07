import {clone,digest,migrateLegacy,today,validateState} from './core.mjs';
const MAX_BYTES=10_000_000;
/** Prepare an explicit local replacement, bound to both complete workspace versions. */
export async function prepareBackupReview(current,raw,{asOf=today(current?.timezone||'Asia/Shanghai')}={}){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>MAX_BYTES)throw new Error('Review a JSON backup of at most 10 MB.');
  let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('This is not valid JSON.');}
  let candidate,kind;
  if(parsed?.app==='plan'&&parsed.schema===2){
    if(typeof parsed.digest!=='string'||await digest(JSON.stringify(parsed.data))!==parsed.digest)throw new Error('Backup integrity check failed. No records were replaced.');
    candidate=clone(validateState(parsed.data));kind='full-backup';
  }else{
    const hash=await digest(raw);
    if(current?.imports.some(i=>i.id===hash))throw new Error('This original backup is already imported. Newer records have been kept.');
    candidate=await migrateLegacy(raw,asOf);kind='original-backup';
  }
  return reviewCandidate(current,candidate,{asOf,kind});
}
export async function reviewCandidate(current,candidate,{asOf=today(current?.timezone||'Asia/Shanghai'),kind='recovery-copy'}={}){
  if(current)validateState(current);validateState(candidate);
  const data={app:'plan-local-restore-review',schema:1,asOf,kind,baseDigest:current?await digest(JSON.stringify(current)):null,candidateDigest:await digest(JSON.stringify(candidate)),candidate:clone(candidate)};
  return {...data,digest:await digest(JSON.stringify(data))};
}
export async function verifyBackupReview(current,review,reviewDigest){
  if(!review||review.app!=='plan-local-restore-review'||review.schema!==1||!['full-backup','original-backup','recovery-copy'].includes(review.kind))throw new Error('Prepare and review this backup again.');
  const {digest:hash,...data}=review;
  if(typeof reviewDigest!=='string'||hash!==reviewDigest||await digest(JSON.stringify(data))!==hash)throw new Error('The backup review changed. Preview it again before restoring.');
  if((current?await digest(JSON.stringify(current)):null)!==review.baseDigest)throw new Error('Records changed after preview. Review the backup again before restoring.');
  if(await digest(JSON.stringify(review.candidate))!==review.candidateDigest)throw new Error('The selected backup changed. Preview it again.');
  return clone(validateState(review.candidate));
}
