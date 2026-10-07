import {clone,uid} from './core.mjs';
import {saveStore,saveDraft} from './storage.mjs';
/** Retain failed edits independently; never retry against newer records implicitly. */
export async function saveEdit(db,{state,revision,type,input,build}){
  let proposedState;
  try{
    proposedState=build(clone(state));
    const nextRevision=await saveStore(db,proposedState,revision);
    return {state:proposedState,revision:nextRevision};
  }catch(cause){
    const draft={id:uid(),at:new Date().toISOString(),source:'react',type,input:clone(input),baseRevision:revision,workspace:state.id,reason:cause instanceof Error?cause.message:'The edit could not be saved.',...(proposedState?{proposedState:clone(proposedState)}:{})};
    let retained=true;
    try{await saveDraft(db,draft);}catch{retained=false;}
    const error=new Error(`${draft.reason} ${retained?'Your edit was retained as a separate draft.':'Draft storage also failed. Download the draft before closing this page.'}`);
    error.draft=draft;throw error;
  }
}
