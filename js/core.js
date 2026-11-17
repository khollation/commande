// Fonctions communes à toutes les pages.
// Aucune dépendance à Firebase ni à la page : elles se testent seules.
import { SCHEDULE, LAST_ORDER, LAST_DELIVERY, CATEGORIES, SEASON, LOW_STOCK } from "../config.js";

// ---------- Texte et montants ----------
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Échappe un texte avant de l'insérer dans du HTML. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ENTITIES[c]);
/** 350 → « 3,50 € » */
export const eur = cents => ((Number(cents) || 0) / 100).toFixed(2).replace(".", ",") + " €";
/** « 3,5 » ou « 3.50 » → 350 (NaN si le texte n'est pas un montant) */
export const toCents = v => Math.round(parseFloat(String(v).replace(",", ".").trim()) * 100);
export const plural = (n, one, many) => n + " " + (n > 1 ? many : one);
/** Minuscules, sans accents ni espaces superflus : pour comparer deux saisies. */
export const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

// ---------- Heures et dates ----------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = t => typeof t === "string" && HHMM.test(t);
export const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const fromMin = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
export const nowMin = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
/** Date locale au format AAAA-MM-JJ */
export const todayKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
/** « 2026-11-16 » → « 16/11/2026 » */
export const frDate = key => key.split("-").reverse().join("/");
export const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « dans 12 min », « dans 1 h 05 » */
export function inMinutes(mins) {
  if (mins < 60) return "dans " + mins + " min";
  return "dans " + Math.floor(mins / 60) + " h " + String(mins % 60).padStart(2, "0");
}

// ---------- Ouverture de la boutique ----------
/**
 * État de la boutique à l'instant d.
 * s = réglage manuel venant de la base (ou null). Il ne vaut que pour la date du jour.
 * Renvoie { open, mode, text, until? } ; until = heure de fin du créneau en cours.
 */
export function shopStatus(s, d = new Date()) {
  const m = nowMin(d), day = d.getDay();
  let mode = s && s.date === todayKey(d) ? s.mode : "auto";
  let wins = SCHEDULE[day] || [];
  if (mode === "custom" && isTime(s.from) && isTime(s.to)) wins = [[s.from, s.to]];
  else if (mode === "open") wins = [["00:00", LAST_ORDER]];
  else if (mode === "closed") wins = [];
  else mode = "auto";
  const cur = wins.find(([a, b]) => m >= toMin(a) && m < toMin(b));
  if (cur) return { open: true, mode, text: "Ouvert jusqu'à " + cur[1], until: cur[1] };
  const next = wins.find(([a]) => toMin(a) > m);
  if (next) return { open: false, mode, text: "Fermé · réouverture à " + next[0] };
  for (let i = 1; i <= 7; i++) {
    const w = SCHEDULE[(day + i) % 7];
    if (w && w.length) return { open: false, mode, text: "Fermé · prochaine ouverture " + (i === 1 ? "demain" : DAYS[(day + i) % 7]) + " à " + w[0][0] };
  }
  return { open: false, mode, text: "Fermé" };
}

/**
 * Heure de livraison la plus tardive acceptée. C'est LAST_DELIVERY, sauf si la boutique
 * est exceptionnellement ouverte plus tard : on laisse alors 30 min après la fermeture.
 */
export function lastDelivery(shop) {
  const late = shop && shop.open && shop.until ? toMin(shop.until) + 30 : 0;
  return fromMin(Math.min(23 * 60 + 59, Math.max(toMin(LAST_DELIVERY), late)));
}

// ---------- Produits ----------
export const isLow = p => p.stock > 0 && p.stock <= LOW_STOCK;
const byName = (a, b) => String(a.name).localeCompare(String(b.name), "fr", { sensitivity: "base", numeric: true });

/** Range les produits par catégorie, dans l'ordre de CATEGORIES puis « Autres ». */
export function groupByCategory(products) {
  return [...CATEGORIES, "Autres"]
    .map(name => ({
      name, id: "cat-" + slug(name),
      list: products.filter(p => (CATEGORIES.includes(p.category) ? p.category : "Autres") === name).sort(byName)
    }))
    .filter(g => g.list.length);
}

// ---------- Thème de saison ----------
/** Renvoie "noel", "halloween", "ete" ou "" selon le réglage SEASON et la date. */
export function currentSeason(d = new Date(), setting = SEASON) {
  if (setting !== "auto") return ["noel", "halloween", "ete"].includes(setting) ? setting : "";
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  if (md >= 1201 && md <= 1231) return "noel";
  if (md >= 1024 && md <= 1031) return "halloween";
  if (md >= 615 && md <= 706) return "ete";
  return "";
}
