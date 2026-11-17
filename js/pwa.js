// Application installable : enregistre le service worker (sw.js) et propose l'installation
// sur l'écran d'accueil, avec le bon mode d'emploi selon l'appareil.
import { $, $$, store, closeOnBackdrop } from "./ui.js";

const DISMISS_KEY = "kh_install_dismissed";
const DISMISS_DAYS = 30;
const ua = navigator.userAgent || "";
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
// Navigateurs intégrés aux applis (Instagram, Snapchat…) : ils ne savent pas installer une application.
const inAppBrowser = /Instagram|FBAN|FBAV|FB_IAB|Snapchat|TikTok|musical_ly|Bytedance/i.test(ua);

/** Vrai si la page tourne déjà comme une application installée. */
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
/** Vrai dans l'application native Android / iOS. */
export const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());

let promptEvent = null;   // événement d'installation fourni par Chrome, Edge, Samsung Internet…
let appName = "l'application";

const dismissed = () => Date.now() - Number(store.get(DISMISS_KEY) || 0) < DISMISS_DAYS * 864e5;
const installable = () => !isStandalone() && !isNative();
/** Faut-il mettre l'installation en avant ? Oui si le navigateur la propose ou sur iPhone / iPad. */
const shouldPromote = () => installable() && !dismissed() && (!!promptEvent || isIOS || (isAndroid && inAppBrowser));

function refresh() {
  $$("[data-install-card]").forEach(el => { el.hidden = !shouldPromote(); });
  $$("[data-install-link]").forEach(el => { el.hidden = !installable(); });
}

const SHARE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`;

function helpHtml() {
  if (inAppBrowser) {
    return `<p>Tu es dans le navigateur d'une autre appli (Instagram, Snapchat…), qui ne sait pas installer d'application.</p>
      <ol class="steps"><li>Touche le menu <strong>⋯</strong> en haut de l'écran.</li>
      <li>Choisis <strong>« Ouvrir dans ${isIOS ? "Safari" : "Chrome"} »</strong> (ou « Ouvrir dans le navigateur »).</li>
      <li>Reviens ensuite sur « Installer l'application ».</li></ol>`;
  }
  if (isIOS) {
    return `<ol class="steps"><li>Touche le bouton <strong>Partager</strong> ${SHARE_ICON} dans la barre de ton navigateur.</li>
      <li>Fais défiler et choisis <strong>« Sur l'écran d'accueil »</strong>.</li>
      <li>Touche <strong>« Ajouter »</strong> : l'icône apparaît avec tes autres applis.</li></ol>`;
  }
  if (isAndroid) {
    return `<ol class="steps"><li>Ouvre le menu <strong>⋮</strong> de ton navigateur.</li>
      <li>Choisis <strong>« Installer l'application »</strong> ou <strong>« Ajouter à l'écran d'accueil »</strong>.</li>
      <li>Valide : l'icône apparaît avec tes autres applis.</li></ol>`;
  }
  return `<ol class="steps"><li>Dans la barre d'adresse, clique sur l'icône d'installation (ou ouvre le menu du navigateur).</li>
    <li>Choisis <strong>« Installer ${appName} »</strong>.</li></ol>
    <p class="note">Sur téléphone, ouvre cette page puis utilise « Ajouter à l'écran d'accueil ».</p>`;
}

function showHelp() {
  const d = document.createElement("dialog");
  d.className = "sheet";
  d.innerHTML = `<div class="sheet-body"><h2>Installer ${appName}</h2>${helpHtml()}
    <p class="note">C'est le même site, en plus pratique : une icône sur ton écran d'accueil, en plein écran.</p>
    <div class="actions"><button class="btn" type="button">J'ai compris</button></div></div>`;
  closeOnBackdrop(d);
  $("button", d).onclick = () => d.close();
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
}

/** Lance l'installation : fenêtre du navigateur si elle existe, sinon mode d'emploi. */
export async function install() {
  if (!promptEvent) return showHelp();
  const ev = promptEvent;
  promptEvent = null;
  try {
    ev.prompt();
    await ev.userChoice;
  } catch {}
  refresh();
}

/**
 * À appeler une fois par page.
 * Dans le HTML : [data-install-card] = encart mis en avant, [data-install] = bouton qui installe,
 * [data-install-dismiss] = bouton « plus tard », [data-install-link] = lien discret toujours disponible.
 */
export function initPwa({ name } = {}) {
  if (name) appName = name;

  if ("serviceWorker" in navigator) {
    const register = () => navigator.serviceWorker.register("sw.js").catch(() => {});
    if (document.readyState === "complete") register(); else addEventListener("load", register);
  }

  addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptEvent = e; refresh(); });
  addEventListener("appinstalled", () => { promptEvent = null; refresh(); });
  document.addEventListener("click", e => {
    if (e.target.closest("[data-install-dismiss]")) { store.set(DISMISS_KEY, String(Date.now())); refresh(); }
    else if (e.target.closest("[data-install]")) install();
  });
  refresh();
}
