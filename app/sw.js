const CACHE='plan-v2-shell-2';
const SHELL=['./','./index.html','./style.css','./ui.mjs','./core.mjs','./storage.mjs','./sync.mjs','./manifest.json','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('plan-v2-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  // Cache only the public app shell. Never cache API responses or private finance exports.
  if(event.request.method!=='GET'||u.origin!==self.location.origin||!SHELL.some(p=>new URL(p,self.location.href).pathname===u.pathname))return;
  event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}return r;}).catch(()=>caches.match(event.request)));
});
