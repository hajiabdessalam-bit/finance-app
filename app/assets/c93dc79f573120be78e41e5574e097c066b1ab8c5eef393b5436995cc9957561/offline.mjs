/** Public shell installation only. Never force a reload of unsaved forms. */
export function installOffline(onStatus){
  let disposed=false,registration,installing;
  const status=value=>{if(!disposed)onStatus(value);};
  const report=()=>status(registration?.waiting?'Offline app ready · close all PLAN tabs to apply the update':'Offline shell installed');
  const changed=()=>{if(installing?.state==='installed')report();else if(installing?.state==='redundant')status('Offline update unavailable · existing records remain local');};
  const found=()=>{installing=registration?.installing;if(installing)installing.addEventListener('statechange',changed);};
  if(!('serviceWorker' in navigator)||location.protocol==='file:'){status('Offline installation unavailable');return()=>{disposed=true;};}
  navigator.serviceWorker.register('./sw.js').then(async reg=>{registration=reg;if(disposed)return;reg.addEventListener('updatefound',found);found();await navigator.serviceWorker.ready;report();}).catch(()=>status('Offline installation unavailable'));
  return()=>{disposed=true;registration?.removeEventListener('updatefound',found);installing?.removeEventListener('statechange',changed);};
}
