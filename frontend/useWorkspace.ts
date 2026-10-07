import {useEffect,useState,useRef} from 'react';
import {openStore,loadStore,loadDrafts,snapshots,syncRecovery,restoreReviewedBackup,saveDraft} from '../app/storage.mjs';
import {saveEdit} from '../app/edit-session.mjs';
import {installOffline} from '../app/offline.mjs';
import {verifiedWorkspace} from './domain';
import type {Workspace,StoredWorkspace,EditDraft,CommitEdit,RecoveryControls} from './types';

let storagePromise:Promise<IDBDatabase>|undefined;
const storage=()=>storagePromise??=(openStore() as Promise<IDBDatabase>).catch(e=>{storagePromise=undefined;throw e;});
export function useWorkspace(){
  const [state,setState]=useState<Workspace|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[generation,setGeneration]=useState(0);
  const [busy,setBusy]=useState(false),[drafts,setDrafts]=useState<EditDraft[]>([]),[saved,setSaved]=useState('');
  const [offlineStatus,setOfflineStatus]=useState('Preparing offline shell…');
  useEffect(()=>installOffline(setOfflineStatus),[]);
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
  const recovery:RecoveryControls={
    load:async()=>{const db=await storage(),[copies,audit]=await Promise.all([snapshots(db),syncRecovery(db)]);return {copies:copies as Awaited<ReturnType<RecoveryControls['load']>>['copies'],audit:audit as Awaited<ReturnType<RecoveryControls['load']>>['audit']};},
    restore:async review=>{
      if(busyRef.current||loading||!rowRef.current.state)return false;
      busyRef.current=true;setBusy(true);setError('');setSaved('');
      const row=rowRef.current,previousWorkspace=row.state?.id;
      try{const db=await storage(),result=await restoreReviewedBackup(db,review,{expectedRevision:row.revision,reviewDigest:review.digest,confirmed:true});rowRef.current={state:verifiedWorkspace(result.state),revision:result.revision};setState(rowRef.current.state);setSaved('Reviewed restore saved on this device. The previous full version and drafts are retained.');return true;}
      catch(e){const reason=e instanceof Error?e.message:'The restore could not be saved.',draft:EditDraft={id:crypto.randomUUID(),at:new Date().toISOString(),source:'react',type:'local-restore',baseRevision:row.revision,workspace:previousWorkspace,input:review,reason};setDrafts(items=>[...items,draft]);try{await saveDraft(await storage(),draft);setError(reason+' The unapplied restore review was retained as a separate draft.');}catch{setError(reason+' Draft storage also failed. Download the draft before closing.');}return false;}
      finally{busyRef.current=false;setBusy(false);}
    }
  };
  return {state,error,loading,busy,drafts,saved,offlineStatus,commit,recovery,refresh:()=>{if(!busyRef.current)setGeneration(n=>n+1);}};
}
