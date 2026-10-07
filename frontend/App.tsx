import {useState} from 'react';
import {useWorkspace} from './useWorkspace';
import {Overview} from './components/Overview';
import {Planner} from './components/Planner';
import {Notes} from './components/Notes';
import {Budget} from './components/Budget';
import {Goals} from './components/Goals';
import {Activity} from './components/Activity';
import {Accounts} from './components/Accounts';
import type {EditDraft} from './types';
type View='overview'|'planner'|'activity'|'goals'|'budget'|'accounts'|'notes';
const views:[View,string][]=[['overview','Overview'],['planner','Planner'],['activity','Activity'],['goals','Goals'],['budget','Budget'],['accounts','Accounts'],['notes','Notes']];
function downloadDraft(draft:EditDraft){const url=URL.createObjectURL(new Blob([JSON.stringify({app:'plan-draft',reviewOnly:true,draft},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`plan-unsaved-draft-${draft.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function App(){
  const {state,error,loading,refresh,busy,drafts,saved,offlineStatus,commit}=useWorkspace(),[view,setView]=useState<View>('overview');
  return <div className="shell"><aside className="sidebar"><div className="brand">P<span>L</span>AN</div><nav aria-label="Main navigation">{views.map(([id,label])=><button key={id} disabled={busy} aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</nav><div className="sidefoot">Private on this device<br/>React development preview<br/>{offlineStatus}</div></aside><main id="content" tabIndex={-1}><div className="notice"><strong>Frontend development preview</strong><p>Budgets, goals, actual entries, reversals, balance checks, notes and checklists save to this device’s existing workspace. Other editing workflows remain in the <a href="./">main app</a>.</p><button className="button quiet" onClick={refresh} disabled={loading||busy}>Refresh records</button></div>{error&&<div className="errorbanner" role="alert">{error}</div>}<p role="status">{busy?'Saving…':saved}</p>{drafts.length>0&&<section className="notice"><strong>{drafts.length} unsaved draft(s) retained</strong><p>Download and review against refreshed records. These edits have not been applied.</p>{drafts.map(draft=><button className="button quiet" key={draft.id} onClick={()=>downloadDraft(draft)}>Download draft · {draft.type||'change'}</button>)}</section>}{loading?<p role="status">Opening your private workspace…</p>:state?(view==='overview'?<Overview state={state}/>:view==='planner'?<Planner state={state}/>:view==='activity'?<Activity state={state} commit={commit} busy={busy}/>:view==='goals'?<Goals state={state} commit={commit} busy={busy}/>:view==='budget'?<Budget state={state} commit={commit} busy={busy}/>:view==='accounts'?<Accounts state={state} commit={commit} busy={busy}/>:<Notes state={state} commit={commit} busy={busy}/>):<section className="card"><h1>No workspace on this origin.</h1><p>Use the main app’s local import or start-empty workflow. This preview does not upload records.</p></section>}</main></div>;
}
