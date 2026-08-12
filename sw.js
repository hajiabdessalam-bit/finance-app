/* Plan — offline service worker
   ------------------------------------------------------------------
   Network first, cache second.

   Online : always fetch the newest file from GitHub, then keep a copy.
            This is what makes an edit you push show up next time you
            open the app — you never have to clear anything.
   Offline: serve the copy that was kept. If a page is asked for that
            was never cached, fall back to the app itself.

   You only ever need to touch the line below. Change the number and
   every phone gets a clean cache next time it is online.            */
var CACHE = "plan-v1";

var FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* one missing file must not sink the whole install */
      return Promise.all(FILES.map(function (f) {
        return c.add(f).catch(function () {});
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (req.url.indexOf("http") !== 0) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      });
    })
  );
});

/* the app can ask for a clean slate */
self.addEventListener("message", function (e) {
  if (e.data === "wipe") {
    caches.keys().then(function (keys) {
      keys.forEach(function (k) { caches.delete(k); });
    });
  }
});
