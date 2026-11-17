// Service worker de La Khôllation : c'est lui qui rend le site installable comme une application
// et utilisable avec une mauvaise connexion.
//
// Principe : « le réseau d'abord ». Tant qu'il y a du réseau, on sert toujours la dernière version
// des pages : une modification publiée sur GitHub est visible au chargement suivant, sans rien faire
// de plus. Sans réseau (ou si le réseau est trop lent), on sert la copie gardée par le téléphone.
//
// Les dossiers fonts/, icons/ et vendor/ ne changent jamais : ils sont servis depuis la copie locale.
// Si tu remplaces un fichier dans l'un de ces dossiers, augmente le numéro ci-dessous (v1 → v2).
const CACHE = "khollation-v1";

// Fichiers de la boutique téléchargés dès l'installation (l'admin est mis en cache à sa première visite).
const SHELL = [
  "./", "index.html", "style.css", "config.js", "manifest.webmanifest",
  "js/shop.js", "js/core.js", "js/ui.js", "js/pwa.js", "js/firebase.js",
  "vendor/firebase/firebase-app.js", "vendor/firebase/firebase-firestore.js",
  "fonts/bricolage-grotesque-latin.woff2", "icons/icon-192.png"
];
const IMMUTABLE = /\/(fonts|icons|vendor)\//;
const TIMEOUT = 4000;   // au-delà de 4 s sans réponse du réseau, on sert la copie locale

const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: "reload" })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("khollation-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  // On ne s'occupe que des fichiers du site : la base de données, les notifications, etc. passent directement.
  if (req.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  // L'ancienne version sauvegardée est servie telle quelle.
  if (url.pathname.startsWith(SCOPE + "backup/")) return;
  event.respondWith(IMMUTABLE.test(url.pathname) ? cacheFirst(req) : networkFirst(req, event));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Demande la version la plus récente au serveur (sans se fier au cache HTTP du navigateur). */
async function fresh(req) {
  if (req.mode !== "navigate") return fetch(req, { cache: "no-cache" });
  const res = await fetch(req.url, { cache: "no-cache", credentials: "same-origin" });
  return res.redirected ? Response.redirect(res.url, 302) : res;
}

async function networkFirst(req, event) {
  const cache = await caches.open(CACHE);
  const options = { ignoreSearch: req.mode === "navigate" };
  const fromNetwork = fresh(req).then(res => {
    if (res.ok) event.waitUntil(cache.put(req, res.clone()));
    return res;
  });
  fromNetwork.catch(() => {});   // l'échec est traité ci-dessous
  const cached = await cache.match(req, options);
  try {
    if (!cached) return await fromNetwork;
    // Une copie existe : on laisse sa chance au réseau, puis on sert la copie s'il tarde.
    return await Promise.race([fromNetwork, new Promise((_, reject) => setTimeout(reject, TIMEOUT))]);
  } catch {
    if (cached) return cached;
    if (req.mode === "navigate") {
      const home = await cache.match(new URL("index.html", self.registration.scope).href);
      return home || offlinePage();
    }
    return Response.error();
  }
}

function offlinePage() {
  return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors ligne</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#F5F7FA;color:#12305A;text-align:center">
<div style="padding:2rem"><h1>Pas de connexion</h1><p>Vérifie ton réseau puis réessaie.</p>
<button onclick="location.reload()" style="font:inherit;font-weight:700;padding:.7rem 1.2rem;border:0;border-radius:.7rem;background:#2447E8;color:#fff">Réessayer</button></div>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
