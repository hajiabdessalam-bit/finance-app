import {useState} from 'react';
import {useWorkspace} from './useWorkspace';
import {Overview} from './components/Overview';
import {Planner} from './components/Planner';
import {Notes} from './components/Notes';
type View='overview'|'planner'|'notes';
const views:[View,string][]=[['overview','Overview'],['planner','Planner'],['notes','Notes']];
export function App(){
  const {state,error,loading,refresh}=useWorkspace(),[view,setView]=useState<View>('overview');
  return <div className="shell"><aside className="sidebar"><div className="brand">P<span>L</span>AN</div><nav aria-label="Main navigation">{views.map(([id,label])=><button key={id} aria-current={view===id?'page':undefined} className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</nav><div className="sidefoot">Private on this device<br/>React development preview</div></aside><main id="content" tabIndex={-1}><div className="notice"><strong>Frontend development preview</strong><p>This page can read this origin’s existing workspace and compare scenarios. Editing remains in the <a href="./">main app</a>.</p><button className="button quiet" onClick={refresh} disabled={loading}>Refresh records</button></div>{error&&<div className="errorbanner" role="alert">{error}</div>}{loading?<p role="status">Opening your private workspace…</p>:state?(view==='overview'?<Overview state={state}/>:view==='planner'?<Planner state={state}/>:<Notes state={state}/>):<section className="card"><h1>No workspace on this origin.</h1><p>Use the main app’s local import or start-empty workflow. This preview does not upload records.</p></section>}</main></div>;
}
