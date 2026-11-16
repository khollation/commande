// Banc de test : sert le site comme GitHub Pages, le branche sur les émulateurs Firebase
// et pilote un vrai navigateur (Chromium via Playwright).
//
// Sécurité : le navigateur est lancé avec un proxy mort. Seules les adresses locales
// (le site et les émulateurs) répondent ; il est donc impossible d'atteindre la vraie
// base de données ou d'envoyer une vraie notification pendant les tests.
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { startServer } = require("./server.cjs");
const emu = require("./emulator.cjs");

const REPO = path.join(__dirname, "..", "..");
const PROD_PROJECT = "internat-couffignal";
// Lundi 16 novembre 2026 à 20 h (heure de Paris) : la boutique est ouverte d'après les horaires par défaut.
const DEFAULT_TIME = "2026-11-16T20:00:00+01:00";

function mustReplace(text, search, replacement, label) {
  if (!text.includes(search)) throw new Error(`Banc de test : « ${search} » introuvable dans ${label}`);
  return text.split(search).join(replacement);
}

// Réécrit à la volée les fichiers qui initialisent Firebase pour viser les émulateurs.
function transformFor(version) {
  if (version === "original") {
    const sdk = "https://www.gstatic.com/firebasejs/10.14.1/";
    return (rel, buf) => {
      if (rel !== "config.js") return buf;
      return mustReplace(buf.toString("utf8"), PROD_PROJECT, emu.PROJECT, rel) + `
import { connectFirestoreEmulator as __fs } from "${sdk}firebase-firestore.js";
import { connectAuthEmulator as __au } from "${sdk}firebase-auth.js";
__fs(db, "127.0.0.1", 8080);
__au(auth, "http://127.0.0.1:9099", { disableWarnings: true });
`;
    };
  }
  return (rel, buf) => {
    if (rel === "config.js") return mustReplace(buf.toString("utf8"), PROD_PROJECT, emu.PROJECT, rel);
    if (rel === "js/firebase.js") return buf.toString("utf8") + `
import { connectFirestoreEmulator as __fs } from "../vendor/firebase/firebase-firestore.js";
__fs(db, "127.0.0.1", 8080);
`;
    if (rel === "js/auth.js") return buf.toString("utf8") + `
import { connectAuthEmulator as __au } from "../vendor/firebase/firebase-auth.js";
__au(auth, "http://127.0.0.1:9099", { disableWarnings: true });
`;
    return buf;
  };
}

async function assertEmulators() {
  try {
    await Promise.all([fetch(emu.FS + "/"), fetch(emu.AUTH + "/")]);
  } catch {
    throw new Error("Les émulateurs Firebase ne répondent pas. Lance les tests avec « npm test » depuis le dossier tests/.");
  }
}

/**
 * @param {object} o
 * @param {"new"|"original"} [o.version] version du site à servir
 * @param {string} [o.sdkDir] dossier du SDK Firebase 10.14.1 (uniquement pour la version d'origine, qui le charge depuis un CDN)
 */
async function startSite({ version = "new", sdkDir = process.env.FIREBASE_SDK_DIR } = {}) {
  await assertEmulators();
  const root = version === "original" ? path.join(REPO, "backup", "2026-11-16-version-originale") : REPO;
  const transform = transformFor(version);
  const server = await startServer({ root, transform });
  const browser = await chromium.launch({ proxy: { server: "http://127.0.0.1:9", bypass: "localhost,127.0.0.1" } });
  const contexts = [];

  async function newContext({ time = DEFAULT_TIME, viewport = { width: 390, height: 844 }, colorScheme = "light", serviceWorkers = "block", ...rest } = {}) {
    const context = await browser.newContext({
      viewport, colorScheme, serviceWorkers,
      locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 1, hasTouch: viewport.width < 700, ...rest
    });
    contexts.push(context);
    const ntfy = [], errors = [];
    context.ntfy = ntfy;
    context.errors = errors;
    await context.route("https://ntfy.sh/**", route => {
      ntfy.push(JSON.parse(route.request().postData() || "{}"));
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    });
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await context.route("https://www.gstatic.com/firebasejs/**", route => {
      if (!sdkDir) return route.abort();
      const file = path.join(sdkDir, path.basename(new URL(route.request().url()).pathname));
      return route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(file) });
    });
    context.on("page", page => {
      page.on("pageerror", e => errors.push("pageerror: " + e.message));
      page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
    });
    if (time) await context.clock.setFixedTime(new Date(time));
    return context;
  }

  return {
    url: server.url, origin: server.origin, browser, newContext, emu,
    async close() {
      await Promise.all(contexts.map(c => c.close().catch(() => {})));
      await browser.close();
      await server.close();
    }
  };
}

module.exports = { startSite, REPO, DEFAULT_TIME };
