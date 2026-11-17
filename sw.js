// Caches the app itself so it opens instantly (and offline). Data always comes fresh from OneDrive.
const CACHE = "logbook-v16";
const SHELL = ["./", "index.html", "app.css", "config.js", "js/app.js", "js/model.js", "js/gpx.js", "js/store.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.27.0/lib/msal-browser.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isShell = e.request.method === "GET" && (url.origin === location.origin || SHELL.includes(e.request.url));
  if (!isShell) return;   // OneDrive, Microsoft login, map tiles: straight to the network
  // network first (so updates show up), cache as fallback
  const fresh = url.origin === location.origin ? new Request(e.request, { cache: "no-cache" }) : e.request;   // always revalidate our own files
  e.respondWith(fetch(fresh).then((r) => {
    const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
