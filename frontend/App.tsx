import {useState} from 'react';
import {PrivateServices} from './components/PrivateServices';
import type {PrivateController} from './components/PrivateServices';
import {useWorkspace} from './useWorkspace';
import {Overview} from './components/Overview';
import {Planner} from './components/Planner';
import {Notes} from './components/Notes';
import {Debts} from './components/Debts';
import {Records} from './components/Records';
import {Preferences} from './components/Preferences';
import {Budget} from './components/Budget';
import {Calendar} from './components/Calendar';
import {Outside} from './components/Outside';
import {Goals} from './components/Goals';
import {Activity} from './components/Activity';
import {Accounts} from './components/Accounts';
import type {EditDraft} from './types';
type View='overview'|'planner'|'activity'|'goals'|'budget'|'calendar'|'outside'|'accounts'|'notes'|'preferences'|'records'|'debts'|'assistant'|'more';
const allViews:[View,string][]=[['overview','Overview'],['planner','Planner'],['activity','Activity'],['goals','Goals'],['budget','Budget'],['calendar','Calendar'],['outside','Outside'],['accounts','Accounts'],['notes','Notes'],['preferences','Preferences'],['records','Records'],['debts','Debts'],['assistant','Private assistant']];
const views:[View,string][]=[['overview','Home'],['activity','Activity'],['goals','Plan'],['more','More']];
function downloadDraft(draft:EditDraft){const url=URL.createObjectURL(new Blob([JSON.stringify({app:'plan-draft',reviewOnly:true,draft},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`plan-unsaved-draft-${draft.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function App({privateController}:{privateController?:PrivateController}={}){
  const [serviceBusy,setServiceBusy]=useState(false);
  const {state,error,loading,refresh,busy,drafts,saved,offlineStatus,commit,recovery}=useWorkspace(),[view,setView]=useState<View>('overview'),[activityReview,setActivityReview]=useState<{ids:string[];title:string}|null>(null);
  return <div className="shell"><aside className="sidebar"><div className="brand">P<span>L</span>AN</div><nav aria-label="Main navigation">{views.map(([id,label])=><button key={id} disabled={busy||serviceBusy} aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>{setActivityReview(null);setView(id);}}>{label}</button>)}</nav><div className="sidefoot">Private on this device<br/>PLAN beta<br/>{offlineStatus}</div></aside><main id="content" tabIndex={-1}><details className="notice"><summary>Saved on this device</summary><p>Changes save locally. Download a full JSON backup to keep an independent copy. Private cloud and AI require verified setup; open Private assistant to see connection status.</p><button className="button quiet" onClick={refresh} disabled={loading||busy||serviceBusy}>Refresh records</button></details>{error&&<div className="errorbanner" role="alert">{error}</div>}<p role="status">{busy?'Saving…':saved}</p>{drafts.length>0&&<section className="notice"><strong>{drafts.length} unsaved draft(s) retained</strong><p>Download and review against refreshed records. These edits have not been applied.</p>{drafts.map(draft=><button className="button quiet" key={draft.id} onClick={()=>downloadDraft(draft)}>Download draft · {draft.type||'change'}</button>)}</section>}{loading?<p role="status">Opening your private workspace…</p>:state?(view==='more'?<><h1>More</h1><div className="grid">{allViews.filter(([id])=>!['overview','activity','goals'].includes(id)).map(([id,label])=><button key={id} className="button quiet" onClick={()=>setView(id)}>{label}</button>)}</div></>:view==='assistant'?<PrivateServices controller={privateController} onBusy={setServiceBusy} onRecordsChanged={refresh}/>:view==='overview'?<Overview state={state} busy={busy} onNavigate={(target,evidence)=>{setActivityReview(evidence??null);setView(target);}}/>:view==='planner'?<Planner state={state}/>:view==='activity'?<Activity state={state} commit={commit} busy={busy} review={activityReview} onClearReview={()=>setActivityReview(null)}/>:view==='goals'?<Goals state={state} commit={commit} busy={busy}/>:view==='budget'?<Budget state={state} commit={commit} busy={busy}/>:view==='calendar'?<Calendar state={state} commit={commit} busy={busy}/>:view==='outside'?<Outside state={state} commit={commit} busy={busy}/>:view==='accounts'?<Accounts state={state} commit={commit} busy={busy}/>:view==='debts'?<Debts key={state.id+'-'+state.version+'-'+state.seq} state={state}/>:view==='records'?<Records state={state} commit={commit} busy={busy} recovery={recovery}/>:view==='preferences'?<Preferences state={state} commit={commit} busy={busy}/>:<Notes state={state} commit={commit} busy={busy}/>):<section className="card"><h1>No records in this browser yet.</h1><p>Open setup to review a local backup import or start an empty workspace. Records stay on this device.</p><a className="button primary" href="./">Open PLAN setup</a></section>}</main></div>;
}
