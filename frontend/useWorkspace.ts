import {useEffect,useState} from 'react';
import {openStore,loadStore} from '../app/storage.mjs';
import {verifiedWorkspace} from './domain';
import type {Workspace,StoredWorkspace} from './types';

let storagePromise:Promise<IDBDatabase>|undefined;
const storage=()=>storagePromise??=(openStore() as Promise<IDBDatabase>).catch(e=>{storagePromise=undefined;throw e;});
export function useWorkspace(){
  const [state,setState]=useState<Workspace|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[generation,setGeneration]=useState(0);
  useEffect(()=>{let current=true;setLoading(true);
    (async()=>{try{const db=await storage(),row=await loadStore(db) as StoredWorkspace;if(current){setState(row.state?verifiedWorkspace(row.state):null);setError('');}}catch(e){if(current){setState(null);setError(e instanceof Error?e.message:'Records could not be opened.');}}finally{if(current)setLoading(false);}})();
    return()=>{current=false;};
  },[generation]);
  return {state,error,loading,refresh:()=>setGeneration(n=>n+1)};
}
