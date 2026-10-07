import {useEffect,useRef,useState} from 'react';
import type {privateCloud} from '../private-cloud.mjs';
export type PrivateController=ReturnType<typeof privateCloud>;
type DeviceReview=Awaited<ReturnType<PrivateController['prepareQuestion']>>;
type Answer=Awaited<ReturnType<PrivateController['askQuestion']>>;
type History=Awaited<ReturnType<PrivateController['savedAnswers']>>;
type Comparison=Awaited<ReturnType<PrivateController['compare']>>;
type QueueReview=Awaited<ReturnType<PrivateController['previewPending']>>;
const usd=(micro:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(micro/1_000_000);
export function PrivateServices({controller,onBusy,onRecordsChanged}:{controller?:PrivateController;onBusy:(busy:boolean)=>void;onRecordsChanged:()=>void}){
 const [signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [question,setQuestion]=useState(''),[review,setReview]=useState<DeviceReview|null>(null),[confirmed,setConfirmed]=useState(false),[answer,setAnswer]=useState<Answer|null>(null),[history,setHistory]=useState<History|null>(null);
 const [comparison,setComparison]=useState<Comparison|null>(null),[queue,setQueue]=useState<QueueReview|null>(null),[cloudConfirmed,setCloudConfirmed]=useState(false),[queueConfirmed,setQueueConfirmed]=useState(false);
 const active=useRef(true),running=useRef(false),epoch=useRef(0);
 useEffect(()=>{active.current=true;return()=>{active.current=false;epoch.current++;onBusy(false);};},[onBusy]);
 const run=async(action:()=>Promise<void>)=>{
  if(!controller||running.current)return;
  running.current=true;setBusy(true);onBusy(true);setError('');setStatus('');
  try{await action();}catch(e){if(active.current)setError(e instanceof Error?e.message:'This private request was not confirmed. Keep the review and check saved answers.');}
  finally{running.current=false;if(active.current){setBusy(false);onBusy(false);}}
 };
 const signIn=(form:HTMLFormElement)=>{
  const fields=new FormData(form),email=String(fields.get('email')||''),password=String(fields.get('password')||'');
  // Clear the visible password immediately; no credentials enter React state.
  form.reset();void run(async()=>{await controller!.signIn({email,password});if(active.current){epoch.current++;setSignedIn(true);setStatus('Signed in for this visit. Local records are unchanged.');}});
 };
 const signOut=async()=>{
  epoch.current++;setSignedIn(false);setQuestion('');setReview(null);setConfirmed(false);setAnswer(null);setHistory(null);setError('');setComparison(null);setQueue(null);setCloudConfirmed(false);setQueueConfirmed(false);
  try{await controller!.signOut();if(active.current)setStatus('Signed out. Your local records remain on this device.');}
  catch{if(active.current)setError('Local sign-in has been cleared. Server sign-out was not confirmed; sign in again before any private action.');}
 };
 const prepare=()=>void run(async()=>{
  const ticket=epoch.current,selected=question;setConfirmed(false);setAnswer(null);
  const result=await controller!.prepareQuestion(selected);
  if(active.current&&ticket===epoch.current){setReview(result);setStatus('Review the exact question, shared summary and maximum cost below.');}
 });
 const ask=()=>{if(!review||!confirmed)return;const selected=review,ticket=epoch.current;setConfirmed(false);void run(async()=>{
  const result=await controller!.askQuestion(selected,{confirmed:true,reviewDigest:selected.digest});
  if(active.current&&ticket===epoch.current){setAnswer(result);setStatus(result.result.status==='complete'?'Answer received. Finance records were not changed.':'This request needs review. Check saved answers before preparing another question.');}
 });};
 const readHistory=(before:string|null=null)=>void run(async()=>{
  const ticket=epoch.current,result=await controller!.savedAnswers({before,limit:20});
  if(active.current&&ticket===epoch.current){setHistory(result);setStatus('Saved answers loaded. No new model answer was generated.');}
 });
 const compare=()=>void run(async()=>{const ticket=epoch.current;setCloudConfirmed(false);setQueue(null);setReview(null);setConfirmed(false);const result=await controller!.compare();if(active.current&&ticket===epoch.current)setComparison(result);});
 const adopt=()=>{if(!comparison||comparison.kind!=='comparison'||!cloudConfirmed)return;const selected=comparison,ticket=epoch.current;setCloudConfirmed(false);void run(async()=>{
  await controller!.adopt(selected,{confirmed:true,reviewDigest:selected.review.digest});
  if(active.current&&ticket===epoch.current){setComparison(null);setQueue(null);setReview(null);setStatus('Reviewed cloud records selected. Previous device records and pending edits are retained for recovery.');onRecordsChanged();}
 });};
 const previewQueue=()=>void run(async()=>{const ticket=epoch.current;setQueueConfirmed(false);const result=await controller!.previewPending();if(active.current&&ticket===epoch.current)setQueue(result);});
 const sendQueue=()=>{if(!queue||!queueConfirmed)return;const selected=queue,ticket=epoch.current;setQueueConfirmed(false);void run(async()=>{
  const result=await controller!.sendPending(selected,{confirmed:true,reviewDigest:selected.digest});
  if(active.current&&ticket===epoch.current){setQueue(null);setComparison(null);setReview(null);setConfirmed(false);setStatus(`${result.acknowledged} reviewed edit(s) acknowledged. No automatic replay.`);onRecordsChanged();}
 });};
 return <><h1>Your private planning assistant.</h1><p>PLAN’s calculations remain available on this device. AI can explain reviewed figures and suggest ideas; it cannot change financial records.</p>
 {!controller?<section className="card"><h2>Private connection is awaiting setup</h2><p>Sign-in, cloud comparison and AI require the separate private project and verified provider setup. Your records remain local.</p><p>After connection, review and sync device edits first. Before each AI question, see its exact shared summary, provider and maximum cost. Saved answers can be read without generating another paid answer.</p></section>:<>
 <section className="card"><h2>Private sign-in</h2>{signedIn?<><p>Signed in for this visit. Nothing uploads automatically.</p><button className="button quiet" onClick={()=>void signOut()}>Sign out</button></>:<form aria-label="Private sign-in" onSubmit={e=>{e.preventDefault();signIn(e.currentTarget);}}><fieldset disabled={busy}><label>Email<input name="email" type="email" autoComplete="username" maxLength={320} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" required/></label><button className="button primary">Sign in</button></fieldset></form>}</section>
 {signedIn&&<><section className="card"><h2>Review device and cloud records</h2><p>Comparing reads your private cloud copy. Selecting it retains a complete device recovery copy and holds earlier edits for review.</p><button className="button quiet" disabled={busy} onClick={compare}>Compare both versions</button>{comparison&&(comparison.kind==='empty'?<p>No cloud workspace exists for these records. First upload requires a separate review; this screen cannot upload a backup.</p>:<div className="notice"><p>Device revision {comparison.revision} · Cloud version {comparison.review.remote.version} · {comparison.review.changes.length} record difference(s) · {comparison.review.pending.length} device edit(s) retained for review.</p><details><summary>Complete comparison and pending edits</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(comparison.review,null,2)}</pre></details><label><input type="checkbox" checked={cloudConfirmed} disabled={busy} onChange={e=>setCloudConfirmed(e.target.checked)}/> I reviewed both versions and choose these cloud records, preserving the previous device copy.</label><button className="button primary" disabled={busy||!cloudConfirmed} onClick={adopt}>Select reviewed cloud records</button></div>)}<h3>Send reviewed device edits</h3><p>PLAN sends only the exact reviewed queue against its cloud baseline. Differences or changed records stop the send.</p><button className="button quiet" disabled={busy} onClick={previewQueue}>Review pending edits</button>{queue&&<div className="notice"><p>{queue.operations.length} pending edit(s)</p><details><summary>Exact edits to send</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(queue.operations,null,2)}</pre></details><label><input type="checkbox" checked={queueConfirmed} disabled={busy} onChange={e=>setQueueConfirmed(e.target.checked)}/> I approve sending this exact queue.</label><button className="button primary" disabled={busy||!queueConfirmed} onClick={sendQueue}>Send reviewed edits</button><p>If a receipt is not confirmed, retain the queue and compare again. Edits are never automatically replayed.</p></div>}</section><section className="card"><h2>Ask about your reviewed plan</h2><label>Your question<textarea value={question} maxLength={4000} disabled={busy} onChange={e=>{setQuestion(e.target.value);setReview(null);setConfirmed(false);setAnswer(null);}} rows={4}/></label><p>Review device and cloud differences before using AI. Unsent local edits cannot be silently omitted.</p><button className="button quiet" disabled={busy||!question.trim()} onClick={prepare}>Prepare summary and cost review</button>
 {review&&<div className="notice"><h3>Review before sending</h3><p>{review.review.prompt}</p><p>Provider: {review.review.configuration.provider} · Model: {review.review.configuration.model}</p><p>Maximum cost: <strong>{usd(review.review.reservedMicroUsd)}</strong> · Cloud version {review.review.version}</p><details><summary>Exact shared financial summary</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(review.review.summary,null,2)}</pre></details><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/> I approve this question, shared summary and maximum cost.</label><button className="button primary" disabled={busy||!confirmed} onClick={ask}>Send reviewed question</button><p>If the request is not confirmed, keep this review and check saved answers. PLAN will not retry automatically.</p></div>}
 {answer&&<div className="notice">{answer.deviceChanged&&<p><strong>You edited device records during this answer.</strong> It refers to the earlier reviewed version.</p>}{answer.result.status==='complete'?<><h3>Answer · version {answer.result.contextVersion}</h3><p style={{whiteSpace:'pre-wrap'}}>{answer.result.text}</p><p>Confirmed cost: {usd(answer.result.chargedMicroUsd)} · {answer.result.historySaved?'Saved to private history.':'History save was not confirmed. Keep this answer before leaving.'}</p></>:<p>{answer.result.reason}</p>}</div>}</section>
 <section className="card"><h2>Saved answers</h2><p>Read existing answers without generating a new model response. Earlier advice retains its original date and question.</p><button className="button quiet" disabled={busy} onClick={()=>readHistory()}>Read saved answers</button>{history&&<>{history.messages.length===0&&<p>No saved answers on this page.</p>}{history.messages.map((message:{requestId:string;at:string;question:string;answer:string})=><details key={message.requestId}><summary>{message.at} · {message.question}</summary><p style={{whiteSpace:'pre-wrap'}}>{message.answer}</p></details>)}{history.nextCursor&&<button className="button quiet" disabled={busy} onClick={()=>readHistory(history.nextCursor)}>Read older answers</button>}</>}</section></>}
 </>}
 {error&&<p className="errorbanner" role="alert">{error}</p>}<p role="status">{busy?'Waiting for the private request…':status}</p></>;
}
