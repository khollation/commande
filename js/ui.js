// Éléments d'interface partagés par toutes les pages :
// thème clair / sombre, thème de saison, messages éphémères, confirmations, état du réseau.
import { currentSeason } from "./core.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Mémoire locale du navigateur, sans jamais planter (navigation privée, stockage plein…). */
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  del(key) { try { localStorage.removeItem(key); } catch {} },
  json(key, fallback = null) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
};

// ---------- Thème ----------
const THEME_COLORS = { light: "#F5F7FA", dark: "#0E1626" };

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[theme];
  const btn = $("#theme");
  if (btn) btn.setAttribute("aria-label", theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre");
}

export function initTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  const btn = $("#theme");
  if (btn) btn.onclick = () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    store.set("theme", theme);
  };
  // Tant que la personne n'a pas choisi elle-même, on suit le réglage de son téléphone.
  const media = matchMedia("(prefers-color-scheme: dark)");
  if (media.addEventListener) media.addEventListener("change", e => { if (!store.get("theme")) applyTheme(e.matches ? "dark" : "light"); });

  // Thème de saison : mémorisé pour être appliqué dès le chargement à la prochaine visite.
  const season = currentSeason();
  if (season) document.documentElement.dataset.season = season;
  else delete document.documentElement.dataset.season;
  if (season) store.set("season", season); else store.del("season");
}

// ---------- Messages éphémères ----------
let toastBox;

/**
 * Affiche un message en bas de l'écran pendant quelques secondes.
 * type : "info" | "ok" | "error". action : { label, run } ajoute un bouton.
 */
export function toast(message, { type = "info", action = null, duration = 4500 } = {}) {
  if (!toastBox) {
    toastBox = document.createElement("div");
    toastBox.className = "toasts";
    toastBox.setAttribute("role", "status");
    toastBox.setAttribute("aria-live", "polite");
    if ("popover" in toastBox) toastBox.popover = "manual";
    document.body.append(toastBox);
  }
  // Repasse au premier plan, y compris au-dessus d'une fenêtre ouverte.
  if (toastBox.popover) { try { if (toastBox.matches(":popover-open")) toastBox.hidePopover(); toastBox.showPopover(); } catch {} }

  const el = document.createElement("div");
  el.className = "toast " + type;
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);
  const close = () => {
    clearTimeout(timer);
    el.classList.add("out");
    setTimeout(() => el.remove(), 220);
  };
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = action.label;
    b.onclick = () => { close(); action.run(); };
    el.append(b);
  }
  toastBox.append(el);
  const timer = setTimeout(close, action ? Math.max(duration, 7000) : duration);
  return close;
}

// ---------- Fenêtres ----------
/** Ferme la fenêtre quand on touche le fond assombri (et seulement lui). */
export function closeOnBackdrop(dialog) {
  let downOnBackdrop = false;
  dialog.addEventListener("pointerdown", e => { downOnBackdrop = e.target === dialog; });
  dialog.addEventListener("click", e => { if (e.target === dialog && downOnBackdrop) dialog.close(); });
}

/** Ouvre une fenêtre avec le contenu HTML donné (déjà échappé). Elle se détruit à la fermeture. */
export function openSheet(html, { wide = false } = {}) {
  const d = document.createElement("dialog");
  d.className = "sheet" + (wide ? " wide" : "");
  d.innerHTML = `<div class="sheet-body">${html}</div>`;
  closeOnBackdrop(d);
  d.addEventListener("click", e => { if (e.target.closest("[data-close]")) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

/** Demande une confirmation. Renvoie une promesse : true si la personne confirme. */
export function confirmDialog({ title, text = "", ok = "Confirmer", cancel = "Annuler", danger = false } = {}) {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = "sheet confirm";
    d.innerHTML = `<form method="dialog" class="sheet-body"><h2></h2><p></p>
      <div class="actions"><button class="btn alt" value="no"></button><button class="btn" value="yes"></button></div></form>`;
    $("h2", d).textContent = title;
    $("p", d).textContent = text;
    $("p", d).hidden = !text;
    const [no, yes] = $$("button", d);
    no.textContent = cancel;
    yes.textContent = ok;
    if (danger) yes.classList.add("red");
    closeOnBackdrop(d);
    d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
    document.body.append(d);
    d.showModal();
    yes.focus();
  });
}

// ---------- Réseau ----------
/** Bandeau « Hors ligne » affiché tant que l'appareil n'a pas de connexion. */
export function initNetworkBanner() {
  const el = document.createElement("div");
  el.className = "offline";
  el.setAttribute("role", "status");
  el.textContent = "Hors ligne · ce qui est affiché n'est peut-être plus à jour";
  el.hidden = navigator.onLine !== false;
  document.body.prepend(el);
  addEventListener("online", () => { el.hidden = true; });
  addEventListener("offline", () => { el.hidden = false; });
}
