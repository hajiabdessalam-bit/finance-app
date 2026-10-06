const CACHE='plan-v2-shell-3';
const SHELL=['./','./index.html','./style.css','./ui.mjs','./core.mjs','./storage.mjs','./sync.mjs','./manifest.json','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('plan-v2-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  // Cache only the public app shell. Never cache API responses or private finance exports.
  if(event.request.method!=='GET'||u.origin!==self.location.origin||!SHELL.some(p=>new URL(p,self.location.href).pathname===u.pathname))return;
  const network=fetch(event.request);
  // Keep cache writes alive even after the response has been delivered.
  event.waitUntil(network.then(async response=>{if(response.ok){const copy=response.clone(),cache=await caches.open(CACHE);await cache.put(event.request,copy);}}).catch(()=>{}));
  event.respondWith(network.catch(async()=>{
    const cached=await (await caches.open(CACHE)).match(event.request);
    return cached||new Response('PLAN is unavailable offline until its public app shell has been installed.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }));
});
