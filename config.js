import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const app = initializeApp({
  apiKey: "AIzaSyAII2fbLkzkTnK8v3mzYQRNlIvVnFNB8bA",
  authDomain: "internat-couffignal.firebaseapp.com",
  projectId: "internat-couffignal",
  storageBucket: "internat-couffignal.firebasestorage.app",
  messagingSenderId: "357179569899",
  appId: "1:357179569899:web:d7403543dc19e1f212f0ae"
});

export const db = getFirestore(app);
export const auth = getAuth(app);

// À MODIFIER : nom affiché et info de paiement Wero
export const SHOP = {
  name: "La Khôllation",
  wero: "COMPLÈTE ICI ton numéro ou identifiant Wero"
};

// Catégories affichées sur le site, dans cet ordre
export const CATEGORIES = ["Boissons", "Snacks", "Formules"];

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = c => (c / 100).toFixed(2).replace(".", ",") + " €";
// ---------- Horaires d'ouverture ----------
// 0 = dimanche, 1 = lundi … 6 = samedi. Liste vide = fermé toute la journée.
export const SCHEDULE = {
  0: [["20:00", "22:30"]],
  1: [["17:30", "18:30"], ["19:00", "22:30"]],
  2: [["17:30", "18:30"], ["19:00", "22:30"]],
  3: [["17:30", "18:30"], ["19:00", "22:30"]],
  4: [["17:30", "18:30"], ["19:00", "22:30"]],
  5: [["17:30", "18:30"], ["19:00", "22:30"]],
  6: []
};
export const LAST_ORDER = "22:30";      // utilisée par « Ouvrir maintenant »
export const LAST_DELIVERY = "23:00";   // heure de livraison maximale
const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

export const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const todayKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// s = réglages manuels venant de la base (ou null). Ils ne valent que pour la date du jour.
export function shopStatus(s, d = new Date()) {
  const m = d.getHours() * 60 + d.getMinutes(), day = d.getDay();
  const mode = s && s.date === todayKey(d) ? s.mode : "auto";
  let wins = SCHEDULE[day] || [];
  if (mode === "custom") wins = [[s.from, s.to]];
  else if (mode === "open") wins = [["00:00", LAST_ORDER]];
  else if (mode === "closed") wins = [];
  const cur = wins.find(([a, b]) => m >= toMin(a) && m < toMin(b));
  if (cur) return { open: true, mode, text: "Ouvert jusqu'à " + cur[1] };
  const next = wins.find(([a]) => toMin(a) > m);
  if (next) return { open: false, mode, text: "Fermé · réouverture à " + next[0] };
  for (let i = 1; i <= 7; i++) {
    const w = SCHEDULE[(day + i) % 7];
    if (w && w.length) return { open: false, mode, text: "Fermé · prochaine ouverture " + (i === 1 ? "demain" : DAYS[(day + i) % 7]) + " à " + w[0][0] };
  }
  return { open: false, mode, text: "Fermé" };
}
