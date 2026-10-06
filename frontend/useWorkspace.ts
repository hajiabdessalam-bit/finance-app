import {useEffect,useState,useRef} from 'react';
import {openStore,loadStore,loadDrafts} from '../app/storage.mjs';
import {saveEdit} from '../app/edit-session.mjs';
import {verifiedWorkspace} from './domain';
import type {Workspace,StoredWorkspace,EditDraft,CommitEdit} from './types';

let storagePromise:Promise<IDBDatabase>|undefined;
const storage=()=>storagePromise??=(openStore() as Promise<IDBDatabase>).catch(e=>{storagePromise=undefined;throw e;});
export function useWorkspace(){
  const [state,setState]=useState<Workspace|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[generation,setGeneration]=useState(0);
  const [busy,setBusy]=useState(false),[drafts,setDrafts]=useState<EditDraft[]>([]),[saved,setSaved]=useState('');
  const rowRef=useRef<StoredWorkspace>({state:null,revision:0}),busyRef=useRef(false);
  useEffect(()=>{let current=true;setLoading(true);
    (async()=>{try{const db=await storage(),row=await loadStore(db) as StoredWorkspace,retained=await loadDrafts(db) as EditDraft[];if(current){rowRef.current=row;setState(row.state?verifiedWorkspace(row.state):null);setDrafts(retained);setError('');}}catch(e){if(current){setState(null);setError(e instanceof Error?e.message:'Records could not be opened.');}}finally{if(current)setLoading(false);}})();
    return()=>{current=false;};
  },[generation]);
  const commit:CommitEdit=async(type,input,build)=>{
    if(busyRef.current||loading||!rowRef.current.state)return false;
    busyRef.current=true;setBusy(true);setError('');setSaved('');
    try{const db=await storage(),row=rowRef.current;
      const result=await saveEdit(db,{state:row.state,revision:row.revision,type,input,build});
      rowRef.current={state:verifiedWorkspace(result.state),revision:result.revision};setState(rowRef.current.state);setSaved('Saved on this device');return true;
    }catch(e){setError(e instanceof Error?e.message:'The edit could not be saved.');const draft=(e as {draft?:EditDraft}).draft;if(draft)setDrafts(items=>[...items,draft]);return false;}
    finally{busyRef.current=false;setBusy(false);}
  };
  return {state,error,loading,busy,drafts,saved,commit,refresh:()=>{if(!busyRef.current)setGeneration(n=>n+1);}};
}
