// Page admin : commandes en direct, produits, ouverture de la boutique, bannière d'annonce.
import { CATEGORIES, SCHEDULE, LOW_STOCK } from "../config.js";
import { esc, eur, toCents, plural, norm, shopStatus, todayKey, frDate, toMin, nowMin, isTime, groupByCategory, isLow, inMinutes, DAYS } from "./core.js";
import { db, collection, doc, onSnapshot, query, orderBy, limit, where, getDocs, updateDoc, deleteDoc, addDoc, setDoc, writeBatch, increment } from "./firebase.js";
import { initSession, logout, currentUser } from "./session.js";
import { $, $$, store, initTheme, initNetworkBanner, toast, confirmDialog, openSheet } from "./ui.js";
import { initPwa } from "./pwa.js";

initTheme();
initNetworkBanner();
initPwa({ name: "l'appli Admin" });

const fail = (what, err) => toast(what + " : " + (err && err.message ? err.message : "erreur inconnue"), { type: "error", duration: 7000 });
const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const itemsOf = o => (Array.isArray(o.items) ? o.items : []);
const dateOf = o => (o.createdAt && typeof o.createdAt.toDate === "function" ? o.createdAt.toDate() : null);
const hhmm = d => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// ══════════════ État ══════════════
let orders = [], products = [], productsLoaded = false, settings = null;
let unsubs = [], unsubOrders = null;
let filter = "toutes";
let ordersLimit = 100;
let newest = 0;                 // date de la commande la plus récente déjà vue (en millisecondes)
const fresh = new Set();        // commandes arrivées à l'instant : mises en avant une fois

// ══════════════ Onglets ══════════════
const TABS = { commandes: "Commandes", produits: "Produits", boutique: "Boutique" };

function showTab(name) {
  if (!TABS[name]) name = "commandes";
  for (const t of Object.keys(TABS)) $("#tab-" + t).hidden = t !== name;
  for (const a of $$("#tabs [data-tab]")) {
    if (a.dataset.tab === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (currentUser()) $("#page-title").textContent = TABS[name];
  if (location.hash.slice(1) !== name) history.replaceState(null, "", "#" + name);
  scrollTo(0, 0);
}
$("#tabs").addEventListener("click", e => {
  const a = e.target.closest("[data-tab]");
  if (!a) return;
  e.preventDefault();
  showTab(a.dataset.tab);
});
addEventListener("hashchange", () => showTab(location.hash.slice(1)));

// ══════════════ Son et pastille ══════════════
let audio = null;
let soundOn = store.get("kh_sound") !== "0";

/** Les navigateurs n'autorisent le son qu'après un premier geste : on prépare la sortie audio à ce moment-là. */
function unlockSound() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch {}
}
addEventListener("pointerdown", unlockSound, { passive: true });
addEventListener("keydown", unlockSound);

function chime(force = false) {
  if (!audio || (!soundOn && !force)) return;
  try {
    const t0 = audio.currentTime + 0.02;
    [880, 1174.66].forEach((freq, i) => {
      const osc = audio.createOscillator(), gain = audio.createGain(), t = t0 + i * 0.17;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.34);
    });
  } catch {}
}
$("#snd").checked = soundOn;
$("#snd").onchange = e => { soundOn = e.target.checked; store.set("kh_sound", soundOn ? "1" : "0"); };
$("#snd-test").onclick = () => { unlockSound(); chime(true); };

/** Pastille sur l'icône de l'application installée (quand l'appareil le permet). */
function setBadge(n) {
  try {
    if (n && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
    else if (!n && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch {}
}

// ══════════════ Connexion ══════════════
$("#out").onclick = logout;

function stopListening() {
  unsubs.forEach(u => u());
  unsubs = [];
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
}

initSession({
  onOut() {
    stopListening();
    orders = []; products = []; productsLoaded = false; newest = 0;
    $("#page-title").textContent = "Admin";
    document.title = "Admin · Commandes";
    setBadge(0);
  },
  onIn(user) {
    stopListening();
    $("#who").textContent = user.email || "";
    showTab(location.hash.slice(1) || "commandes");
    subscribeOrders();
    unsubs.push(onSnapshot(query(collection(db, "products"), orderBy("name")), snap => {
      products = snap.docs.map(d => cleanProduct(d.id, d.data()));
      productsLoaded = true;
      renderProducts();
      renderLowStock();
    }, err => fail("Lecture des produits impossible", err)));
    unsubs.push(onSnapshot(doc(db, "settings", "shop"), s => {
      settings = s.exists() ? s.data() : null;
      renderShop();
    }, err => { $("#shopinfo").className = "status closed"; $("#shopinfo").textContent = "Erreur : " + err.message; }));
    unsubs.push(onSnapshot(doc(db, "settings", "announce"), s => {
      if (announceDirty) return;   // on ne remplace pas une saisie en cours
      const d = s.exists() ? s.data() : {};
      $("#an-text").value = d.text || "";
      $("#an-on").checked = !!d.on;
    }, () => {}));
  }
});

// ══════════════ Commandes ══════════════
const FILTERS = [
  ["toutes", "Toutes", () => true],
  ["nouvelle", "Nouvelles", o => o.status === "nouvelle"],
  ["validée", "À livrer", o => o.status === "validée"],
  ["impayées", "Non payées", o => !o.paid && o.status !== "annulée"],
  ["livrée", "Livrées", o => o.status === "livrée"]
];
const STATUS_CLASS = { nouvelle: "s-new", "validée": "s-ok", "livrée": "s-done", "annulée": "s-off" };
const isActive = o => o.status === "nouvelle" || o.status === "validée";

function subscribeOrders() {
  if (unsubOrders) unsubOrders();
  let first = true;
  unsubOrders = onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(ordersLimit)), snap => {
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const millis = o => { const d = dateOf(o); return d ? d.getTime() : 0; };
    // Une commande est « nouvelle » si elle est plus récente que tout ce qu'on a déjà vu :
    // ainsi une ancienne commande qui remonte dans la liste ne déclenche pas d'alerte.
    if (!first) {
      const news = orders.filter(o => millis(o) > newest);
      if (news.length) announce(news);
    }
    newest = Math.max(newest, ...orders.map(millis));
    first = false;
    $("#more").hidden = snap.size < ordersLimit;
    renderOrders();
  }, err => fail("Lecture des commandes impossible", err));
}
$("#more").onclick = () => { ordersLimit += 100; subscribeOrders(); };

function announce(news) {
  news.forEach(o => fresh.add(o.id));
  chime();
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  const o = news[0];
  toast(news.length > 1 ? news.length + " nouvelles commandes" : "Nouvelle commande : " + (o.name || "?") + " · ch. " + (o.room || "?"), { type: "ok" });
}

/** Moment prévu de la livraison (pour trier les commandes à livrer). */
function due(o) {
  const d = dateOf(o);
  if (!d) return Infinity;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return day + (isTime(o.deliveryTime) ? toMin(o.deliveryTime) : 24 * 60) * 60000;
}

/** Délai restant avant la livraison d'une commande en cours passée aujourd'hui. */
function eta(o) {
  const d = dateOf(o);
  if (!isActive(o) || !d || !isTime(o.deliveryTime) || todayKey(d) !== todayKey(new Date())) return null;
  const diff = toMin(o.deliveryTime) - nowMin();
  if (diff > 0) return { text: inMinutes(diff), late: false };
  if (diff > -5) return { text: "maintenant", late: false };
  return { text: "en retard de " + inMinutes(-diff).slice(5), late: true };
}

function dayLabel(key) {
  if (!key) return "En cours d'envoi";
  const now = new Date(), yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === todayKey(now)) return "Aujourd'hui";
  if (key === todayKey(yesterday)) return "Hier";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function orderHtml(o) {
  const d = dateOf(o), e = eta(o);
  const when = !d ? "…" : todayKey(d) === todayKey(new Date()) ? hhmm(d) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " + hhmm(d);
  const btn = (act, label, cls = "") => `<button type="button" class="btn sm ${cls}" data-act="${act}">${label}</button>`;
  const cash = o.payment !== "wero";
  return `<article class="order ${STATUS_CLASS[o.status] || ""}${fresh.has(o.id) ? " fresh" : ""}" data-id="${esc(o.id)}">
    <div class="top"><button type="button" class="who" data-act="histo" title="Voir l'historique de ce client">${esc(o.name)} · ch. ${esc(o.room)}</button><span class="amount">${eur(o.totalCents)}</span></div>
    <div class="meta">${when} · ${cash ? "Espèces" : "Wero"}</div>
    <div class="deliv">🕒 Livraison souhaitée : <strong>${esc(o.deliveryTime || "non précisée")}</strong>${e ? ` <span class="eta${e.late ? " late" : ""}">${e.text}</span>` : ""}</div>
    ${o.comment ? `<div class="comment">💬 ${esc(o.comment)}</div>` : ""}
    <ul>${itemsOf(o).map(i => `<li>${esc(i.qty)} × ${esc(i.name)}</li>`).join("")}</ul>
    <div class="chips tags"><span class="tag st">${esc(o.status)}</span><span class="tag ${o.paid ? "ok" : ""}">${o.paid ? "payée" : "non payée"}</span></div>
    <div class="chips acts">
      ${o.status === "nouvelle" ? btn("valider", "Valider") : ""}
      ${o.status === "validée" ? btn("livrer", "Livrée") : ""}
      ${o.status !== "annulée" ? btn("payer", o.paid ? "Marquer non payée" : "Marquer payée", "alt") : ""}
      ${cash && !o.paid && o.status !== "annulée" ? btn("rendu", "Rendu de monnaie", "alt") : ""}
      ${isActive(o) ? btn("annuler", "Annuler", "red") : ""}
      ${o.status === "livrée" || o.status === "annulée" ? btn("suppr", "Supprimer", "alt") : ""}
    </div></article>`;
}

function renderToday() {
  const today = todayKey(new Date());
  const day = orders.filter(o => { const d = dateOf(o); return d && todayKey(d) === today && o.status !== "annulée"; });
  const tiles = [
    ["Commandes du jour", day.length],
    ["Ventes du jour", eur(sum(day, o => o.totalCents))],
    ["À traiter", orders.filter(isActive).length],
    ["Non payé", eur(sum(orders.filter(o => !o.paid && o.status !== "annulée"), o => o.totalCents))]
  ];
  $("#today").innerHTML = tiles.map(([label, value]) => `<div class="kpi"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong></div>`).join("");
}

function renderOrders() {
  const n = orders.filter(o => o.status === "nouvelle").length;
  document.title = (n ? `(${n}) ` : "") + "Admin · Commandes";
  setBadge(n);
  $("#n-new").hidden = !n;
  $("#n-new").textContent = n;
  renderToday();
  $("#filters").innerHTML = FILTERS.map(([key, label, fn]) =>
    `<button type="button" class="chip" aria-pressed="${key === filter}" data-filter="${key}">${label} <span class="count">${orders.filter(fn).length}</span></button>`).join("");

  let shown = orders.filter(FILTERS.find(f => f[0] === filter)[2]);
  const byDue = filter === "validée";   // à livrer : la plus urgente en premier
  if (byDue) shown = [...shown].sort((a, b) => due(a) - due(b));
  let lastDay = null;
  $("#orders").innerHTML = shown.length ? shown.map(o => {
    const d = dateOf(o), day = d ? todayKey(d) : "";
    const head = !byDue && day !== lastDay ? `<h3 class="day">${dayLabel(day)}</h3>` : "";
    lastDay = day;
    return head + orderHtml(o);
  }).join("") : `<p class="empty">Aucune commande dans cette catégorie.</p>`;
  fresh.clear();
}

$("#filters").addEventListener("click", e => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  filter = b.dataset.filter;
  renderOrders();
});

const setPaid = (id, paid) => updateDoc(doc(db, "orders", id), { paid }).catch(err => fail("Action impossible", err));

async function cancelOrder(o) {
  if (!productsLoaded) return toast("Les produits sont encore en cours de chargement, réessaie dans un instant.");
  const batch = writeBatch(db), missing = [];
  for (const i of itemsOf(o)) {
    const qty = Math.floor(Number(i.qty)) || 0;
    if (qty <= 0) continue;
    // Un produit supprimé depuis ne peut plus être remis en stock : on l'ignore au lieu de tout bloquer.
    if (products.some(p => p.id === i.id)) batch.update(doc(db, "products", i.id), { stock: increment(qty) });
    else missing.push(i.name);
  }
  batch.update(doc(db, "orders", o.id), { status: "annulée" });
  await batch.commit();
  toast(missing.length ? "Commande annulée. Stock non remis pour " + missing.join(", ") + " (produit supprimé)." : "Commande annulée, le stock est remis en vente.");
}

$("#orders").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const o = orders.find(x => x.id === b.closest(".order").dataset.id);
  if (!o) return;
  const act = b.dataset.act, ref = doc(db, "orders", o.id), who = (o.name || "ce client");
  if (act === "histo") return showHistory(o);
  if (act === "rendu") return showChange(o);
  try {
    if (act === "valider") { b.disabled = true; await updateDoc(ref, { status: "validée" }); }
    else if (act === "livrer") {
      b.disabled = true;
      await updateDoc(ref, { status: "livrée" });
      if (!o.paid) toast("Commande de " + who + " livrée.", { action: { label: "Marquer payée", run: () => setPaid(o.id, true) } });
    }
    else if (act === "payer") { b.disabled = true; await updateDoc(ref, { paid: !o.paid }); }
    else if (act === "annuler") {
      if (await confirmDialog({ title: "Annuler la commande de " + who + " ?", text: "Les produits seront remis en stock.", ok: "Annuler la commande", cancel: "Retour", danger: true })) await cancelOrder(o);
    }
    else if (act === "suppr") {
      if (await confirmDialog({ title: "Supprimer cette commande ?", text: "Elle disparaîtra aussi de la compta.", ok: "Supprimer", danger: true })) await deleteDoc(ref);
    }
  } catch (err) {
    b.disabled = false;
    fail("Action impossible", err);
  }
});

/** Met à jour les délais (« dans 12 min », « en retard de… ») sans redessiner les cartes. */
function refreshEtas() {
  for (const card of $$("#orders .order")) {
    const o = orders.find(x => x.id === card.dataset.id), span = $(".eta", card);
    const e = o ? eta(o) : null;
    if (span && e) { span.textContent = e.text; span.classList.toggle("late", e.late); }
    else if (span && !e) span.remove();
  }
}

// ---------- Rendu de monnaie ----------
const COINS = [[5000, "50 €"], [2000, "20 €"], [1000, "10 €"], [500, "5 €"], [200, "2 €"], [100, "1 €"], [50, "50 c"], [20, "20 c"], [10, "10 c"], [5, "5 c"], [2, "2 c"], [1, "1 c"]];
function breakdown(cents) {
  const parts = [];
  for (const [value, label] of COINS) {
    const n = Math.floor(cents / value);
    if (n) { parts.push(n + " × " + label); cents -= n * value; }
  }
  return parts.join(" + ");
}

function showChange(o) {
  const total = Math.round(Number(o.totalCents)) || 0;
  const quick = [500, 1000, 2000, 5000].filter(v => v > total);
  const d = openSheet(`<h2>Rendu de monnaie</h2>
    <p class="total-line"><span>${esc(o.name)} · ch. ${esc(o.room)}</span><strong>${eur(total)}</strong></p>
    <label for="given">Montant donné (€)</label>
    <input id="given" type="number" inputmode="decimal" step="0.01" min="0" placeholder="${(total / 100).toFixed(2)}">
    <div class="chips"><button type="button" class="chip" data-give="${total}">Appoint</button>${quick.map(v => `<button type="button" class="chip" data-give="${v}">${eur(v)}</button>`).join("")}</div>
    <div class="change" id="change" aria-live="polite" hidden><strong></strong><small></small></div>
    <div class="actions"><button type="button" class="btn alt" data-close>Fermer</button><button type="button" class="btn ok" id="paid">Marquer payée</button></div>`);
  const input = $("#given", d), out = $("#change", d);
  const update = () => {
    const given = toCents(input.value);
    out.hidden = !Number.isFinite(given);
    if (out.hidden) return;
    const diff = given - total;
    out.classList.toggle("short", diff < 0);
    $("strong", out).textContent = diff < 0 ? "Il manque " + eur(-diff) : diff === 0 ? "Le compte est bon" : "À rendre : " + eur(diff);
    $("small", out).textContent = diff > 0 ? breakdown(diff) : "";
  };
  input.addEventListener("input", update);
  d.addEventListener("click", e => {
    const b = e.target.closest("[data-give]");
    if (!b) return;
    input.value = (Number(b.dataset.give) / 100).toFixed(2);
    update();
  });
  $("#paid", d).onclick = async () => { await setPaid(o.id, true); d.close(); toast("Commande de " + (o.name || "ce client") + " marquée payée.", { type: "ok" }); };
  input.focus();
}

// ---------- Historique d'un client ----------
async function showHistory(o) {
  const d = openSheet(`<h2>${esc(o.name)} · ch. ${esc(o.room)}</h2><div id="histo"><p class="note">Chargement de l'historique…</p></div>
    <div class="actions"><button type="button" class="btn" data-close>Fermer</button></div>`, { wide: true });
  // Les commandes déjà affichées + toutes celles de la même chambre enregistrées dans la base.
  const byId = new Map(orders.filter(x => norm(x.room) === norm(o.room)).map(x => [x.id, x]));
  try {
    const snap = await getDocs(query(collection(db, "orders"), where("room", "==", o.room)));
    snap.forEach(s => byId.set(s.id, { id: s.id, ...s.data() }));
  } catch {}
  if (!d.isConnected) return;
  const room = [...byId.values()];
  const mine = room.filter(x => norm(x.name) === norm(o.name)).sort((a, b) => (dateOf(b) || 0) - (dateOf(a) || 0));
  const kept = mine.filter(x => x.status !== "annulée");
  const top = {};
  kept.forEach(x => itemsOf(x).forEach(i => { top[i.name] = (top[i.name] || 0) + (Number(i.qty) || 0); }));
  const favorites = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const others = room.length - mine.length;
  $("#histo", d).innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi-label">Commandes</span><strong class="kpi-value">${kept.length}</strong></div>
      <div class="kpi"><span class="kpi-label">Total dépensé</span><strong class="kpi-value">${eur(sum(kept, x => x.totalCents))}</strong></div>
      <div class="kpi"><span class="kpi-label">Reste à payer</span><strong class="kpi-value">${eur(sum(kept.filter(x => !x.paid), x => x.totalCents))}</strong></div>
    </div>
    ${favorites.length ? `<p class="note">Prend le plus souvent : ${favorites.map(([name, q]) => esc(name) + " (" + q + ")").join(", ")}</p>` : ""}
    <ul class="histo">${mine.map(x => {
      const when = dateOf(x);
      return `<li><div class="top"><span>${when ? frDate(todayKey(when)) + " à " + hhmm(when) : "…"}</span><span>${eur(x.totalCents)}</span></div>
        <div class="meta">${itemsOf(x).map(i => esc(i.qty) + " × " + esc(i.name)).join(", ")}</div>
        <div class="chips tags"><span class="tag st">${esc(x.status)}</span><span class="tag ${x.paid ? "ok" : ""}">${x.paid ? "payée" : "non payée"}</span></div></li>`;
    }).join("")}</ul>
    ${others > 0 ? `<p class="note">${plural(others, "autre commande vient", "autres commandes viennent")} de la même chambre sous un autre prénom.</p>` : ""}`;
}

// ══════════════ Produits ══════════════
const cleanProduct = (id, d) => ({
  id,
  name: String(d.name ?? ""),
  priceCents: Math.round(Number(d.priceCents)) || 0,
  stock: Math.max(0, Math.floor(Number(d.stock)) || 0),
  emoji: d.emoji || "🥤",
  image: typeof d.image === "string" ? d.image : "",
  category: d.category || "",
  badge: d.badge || ""
});

const CAT_OPTIONS = [...CATEGORIES.map(c => [c, c]), ["", "Autres (sans catégorie)"]];
const BADGE_OPTIONS = [["", "Aucun badge"], ["new", "Badge Nouveau"], ["promo", "Badge Promo"]];
const options = list => list.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
$("#ac").innerHTML = options(CAT_OPTIONS);

/** Réduit une photo en vignette carrée de 240 px (JPEG), enregistrée directement dans la fiche du produit. */
function resize(file, size = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d"), s = Math.min(img.width, img.height);
      g.fillStyle = "#fff";
      g.fillRect(0, 0, size, size);
      g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image illisible")); };
    img.src = url;
  });
}

const prodEls = new Map();   // idProduit → fiche : conservée d'un affichage à l'autre pour ne pas perdre une saisie
let prodLayout = null;

function buildProd(p) {
  const el = document.createElement("details");
  el.className = "prod";
  el.dataset.id = p.id;
  el.innerHTML = `
    <summary>
      <span class="thumb sm"></span>
      <span class="prod-name"></span>
      <span class="tag prod-tag" hidden></span>
      <span class="prod-price"></span>
      <span class="prod-stock" title="En stock"></span>
    </summary>
    <div class="prod-body">
      <div class="row-emoji">
        <label>Emoji<input type="text" data-f="emoji" maxlength="10"></label>
        <label>Nom<input type="text" data-f="name" maxlength="60"></label>
      </div>
      <div class="row2 even">
        <label>Prix (€)<input type="number" data-f="price" inputmode="decimal" step="0.01" min="0"></label>
        <label>Stock<input type="number" data-f="stock" inputmode="numeric" step="1" min="0"></label>
      </div>
      <div class="row2 even">
        <label>Catégorie<select data-f="cat">${options(CAT_OPTIONS)}</select></label>
        <label>Badge<select data-f="badge">${options(BADGE_OPTIONS)}</select></label>
      </div>
      <div class="chips acts">
        <button type="button" class="btn sm" data-p="save">Enregistrer</button>
        <button type="button" class="btn sm alt" data-p="restock">Réassort</button>
        <label class="btn sm alt">Changer l'image<input type="file" accept="image/*" data-f="img" hidden></label>
        <button type="button" class="btn sm alt" data-p="noimg">Retirer l'image</button>
        <button type="button" class="btn sm red" data-p="del">Supprimer</button>
      </div>
    </div>`;
  return el;
}

function syncProd(el, p) {
  const out = p.stock < 1, low = isLow(p);
  const picture = p.image ? "i" + p.image.length + p.image.slice(-24) : "e" + p.emoji;
  if (el.dataset.picture !== picture) {
    el.dataset.picture = picture;
    $(".thumb", el).innerHTML = p.image ? `<img class="pimg" src="${esc(p.image)}" alt="">` : `<span class="emoji">${esc(p.emoji)}</span>`;
  }
  $(".prod-name", el).textContent = p.name;
  $(".prod-price", el).textContent = eur(p.priceCents);
  $(".prod-stock", el).textContent = p.stock;
  const tag = $(".prod-tag", el);
  tag.hidden = !out && !low;
  tag.textContent = out ? "Épuisé" : "Stock faible";
  tag.classList.toggle("off", out);
  tag.classList.toggle("warn", !out && low);
  $('[data-p="noimg"]', el).hidden = !p.image;
  // Les champs que l'admin est en train de modifier ne sont pas écrasés par une mise à jour venue de la base.
  const set = (field, value) => {
    const input = $(`[data-f="${field}"]`, el);
    if (!input.dataset.dirty && input.value !== value) input.value = value;
  };
  set("emoji", p.emoji);
  set("name", p.name);
  set("price", (p.priceCents / 100).toFixed(2));
  set("stock", String(p.stock));
  $('[data-f="cat"]', el).value = CATEGORIES.includes(p.category) ? p.category : "";
  $('[data-f="badge"]', el).value = p.badge === "new" || p.badge === "promo" ? p.badge : "";
}

function renderProducts() {
  const search = $("#search"), box = $("#products");
  search.hidden = products.length <= 8;
  const q = search.hidden ? "" : norm(search.value);
  const groups = groupByCategory(q ? products.filter(p => norm(p.name).includes(q)) : products);
  for (const id of [...prodEls.keys()]) if (!products.some(p => p.id === id)) prodEls.delete(id);
  for (const p of products) {
    if (!prodEls.has(p.id)) prodEls.set(p.id, buildProd(p));
    syncProd(prodEls.get(p.id), p);
  }
  // On ne déplace les fiches que si leur ordre a changé : une saisie en cours n'est jamais interrompue.
  const layout = groups.map(g => g.name + ":" + g.list.map(p => p.id).join(",")).join("|") || "vide:" + q;
  if (layout === prodLayout) return;
  prodLayout = layout;
  if (!groups.length) {
    box.innerHTML = `<p class="empty">${q ? "Aucun produit ne correspond à cette recherche." : "Aucun produit pour le moment. Ajoute le premier ci-dessus."}</p>`;
    return;
  }
  const active = document.activeElement, frag = document.createDocumentFragment();
  for (const g of groups) {
    const h = document.createElement("h3");
    h.className = "day";
    h.textContent = g.name + " (" + g.list.length + ")";
    frag.append(h, ...g.list.map(p => prodEls.get(p.id)));
  }
  box.replaceChildren(frag);
  if (active && box.contains(active)) active.focus({ preventScroll: true });
}
$("#search").addEventListener("input", renderProducts);

function renderLowStock() {
  const el = $("#lowstock");
  const low = LOW_STOCK > 0 ? products.filter(p => p.stock < 1 || isLow(p)).sort((a, b) => a.stock - b.stock) : [];
  el.hidden = !low.length;
  el.textContent = low.length ? "⚠️ Stock faible : " + low.map(p => p.name + (p.stock ? " (" + p.stock + ")" : " (épuisé)")).join(" · ") : "";
}
$("#lowstock").onclick = () => showTab("produits");

const prodOf = el => products.find(p => p.id === el.closest(".prod").dataset.id);

$("#products").addEventListener("input", e => {
  const f = e.target.dataset.f;
  if (f === "name" || f === "emoji" || f === "price" || f === "stock") {
    e.target.dataset.dirty = "1";
    e.target.closest(".prod").classList.add("dirty");
  }
});

$("#products").addEventListener("change", async e => {
  const el = e.target, f = el.dataset.f, p = el.closest(".prod") && prodOf(el);
  if (!p) return;
  const ref = doc(db, "products", p.id);
  try {
    if (f === "img" && el.files[0]) { await updateDoc(ref, { image: await resize(el.files[0]) }); el.value = ""; toast("Image de « " + p.name + " » mise à jour.", { type: "ok" }); }
    else if (f === "cat") await updateDoc(ref, { category: el.value });
    else if (f === "badge") await updateDoc(ref, { badge: el.value });
  } catch (err) { fail("Modification impossible", err); }
});

async function saveProd(card, p) {
  const value = f => $(`[data-f="${f}"]`, card).value;
  const name = value("name").trim(), emoji = value("emoji").trim() || "🥤";
  const priceCents = toCents(value("price")), stock = Number(value("stock"));
  if (!name) return toast("Le nom du produit ne peut pas être vide.", { type: "error" });
  if (!Number.isFinite(priceCents) || priceCents < 0) return toast("Le prix n'est pas valide.", { type: "error" });
  if (!Number.isInteger(stock) || stock < 0) return toast("Le stock doit être un nombre entier positif.", { type: "error" });
  const patch = {};
  if (name !== p.name) patch.name = name;
  if (emoji !== p.emoji) patch.emoji = emoji;
  if (priceCents !== p.priceCents) patch.priceCents = priceCents;
  if (stock !== p.stock) patch.stock = stock;
  for (const input of $$("[data-dirty]", card)) delete input.dataset.dirty;
  card.classList.remove("dirty");
  if (!Object.keys(patch).length) { syncProd(card, p); return toast("Rien à enregistrer pour « " + p.name + " »."); }
  await updateDoc(doc(db, "products", p.id), patch);
  toast("« " + name + " » enregistré.", { type: "ok" });
}

function showRestock(p) {
  const d = openSheet(`<h2>Réassort</h2>
    <p class="total-line"><span>${esc(p.name)}</span><strong>${p.stock} en stock</strong></p>
    <label for="more-stock">Quantité à ajouter</label>
    <input id="more-stock" type="number" inputmode="numeric" step="1" min="1" placeholder="12">
    <div class="chips">${[6, 12, 24, 48].map(n => `<button type="button" class="chip" data-add="${n}">+ ${n}</button>`).join("")}</div>
    <p class="note">La quantité s'ajoute au stock actuel, même si une commande arrive pendant ce temps.</p>
    <div class="actions"><button type="button" class="btn alt" data-close>Annuler</button><button type="button" class="btn" id="do-restock">Ajouter au stock</button></div>`);
  const input = $("#more-stock", d);
  d.addEventListener("click", e => { const b = e.target.closest("[data-add]"); if (b) input.value = b.dataset.add; });
  $("#do-restock", d).onclick = async () => {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 1) return toast("Indique une quantité entière à ajouter.", { type: "error" });
    try {
      await updateDoc(doc(db, "products", p.id), { stock: increment(n) });
      d.close();
      toast(n + " ajouté" + (n > 1 ? "s" : "") + " au stock de « " + p.name + " ».", { type: "ok" });
    } catch (err) { fail("Réassort impossible", err); }
  };
  input.focus();
}

$("#products").addEventListener("click", async e => {
  const b = e.target.closest("[data-p]");
  if (!b) return;
  const card = b.closest(".prod"), p = prodOf(b);
  if (!p) return;
  try {
    if (b.dataset.p === "save") await saveProd(card, p);
    else if (b.dataset.p === "restock") showRestock(p);
    else if (b.dataset.p === "noimg") await updateDoc(doc(db, "products", p.id), { image: "" });
    else if (b.dataset.p === "del" && await confirmDialog({ title: "Supprimer « " + p.name + " » ?", text: "Le produit disparaîtra de la boutique. Les commandes déjà passées ne changent pas.", ok: "Supprimer", danger: true })) {
      await deleteDoc(doc(db, "products", p.id));
      toast("« " + p.name + " » supprimé.");
    }
  } catch (err) { fail("Action impossible", err); }
});

$("#add").onsubmit = async e => {
  e.preventDefault();
  const name = $("#an").value.trim(), priceCents = toCents($("#ap").value), stock = Number($("#as").value);
  if (!name) return toast("Indique le nom du produit.", { type: "error" });
  if (!Number.isFinite(priceCents) || priceCents < 0) return toast("Le prix n'est pas valide.", { type: "error" });
  if (!Number.isInteger(stock) || stock < 0) return toast("Le stock doit être un nombre entier positif.", { type: "error" });
  const btn = $("#add button");
  btn.disabled = true;
  try {
    const file = $("#ai").files[0], image = file ? await resize(file) : "";
    await addDoc(collection(db, "products"), { emoji: $("#ae").value.trim() || "🥤", name, priceCents, stock, image, category: $("#ac").value });
    e.target.reset();
    $("#add-box").open = false;
    toast("« " + name + " » ajouté à la boutique.", { type: "ok" });
  } catch (err) { fail("Ajout impossible", err); }
  btn.disabled = false;
};

// ══════════════ Boutique : ouverture et annonce ══════════════
function renderShop() {
  const s = shopStatus(settings), el = $("#shopinfo");
  el.className = "status " + (s.open ? "open" : "closed");
  el.innerHTML = '<span class="dot" aria-hidden="true"></span>';
  el.append(s.text + (s.mode !== "auto" ? " (réglage manuel du jour)" : ""));
  for (const [id, mode] of [["m-auto", "auto"], ["m-open", "open"], ["m-closed", "closed"], ["m-custom", "custom"]]) $("#" + id).setAttribute("aria-pressed", String(s.mode === mode));
  if (s.mode === "custom" && !["cf", "ct"].includes(document.activeElement.id)) {
    $("#cf").value = settings.from;
    $("#ct").value = settings.to;
  }
}

const setMode = async patch => {
  try { await setDoc(doc(db, "settings", "shop"), { date: todayKey(new Date()), ...patch }); }
  catch (err) { fail("Réglage impossible", err); }
};
$("#m-auto").onclick = () => setMode({ mode: "auto" });
$("#m-open").onclick = () => setMode({ mode: "open" });
$("#m-closed").onclick = () => setMode({ mode: "closed" });
$("#m-custom").onclick = () => {
  const from = $("#cf").value, to = $("#ct").value;
  if (!isTime(from) || !isTime(to) || to <= from) return toast("L'heure de fermeture doit être après l'heure d'ouverture.", { type: "error" });
  setMode({ mode: "custom", from, to });
};

$("#schedule").innerHTML = [1, 2, 3, 4, 5, 6, 0].map(day => {
  const wins = SCHEDULE[day] || [];
  return `<tr><th scope="row">${DAYS[day]}</th><td>${wins.length ? wins.map(([a, b]) => a + " – " + b).join(", ") : "Fermé"}</td></tr>`;
}).join("");

let announceDirty = false;
$("#an-text").addEventListener("input", () => { announceDirty = true; });
$("#an-on").addEventListener("change", () => { announceDirty = true; });
$("#an-save").onclick = async () => {
  try {
    await setDoc(doc(db, "settings", "announce"), { text: $("#an-text").value.trim(), on: $("#an-on").checked });
    announceDirty = false;
    toast($("#an-on").checked ? "Annonce affichée sur le site." : "Annonce enregistrée (masquée).", { type: "ok" });
  } catch (err) { fail("Enregistrement impossible", err); }
};

// ══════════════ Horloge ══════════════
function tick() {
  if (!currentUser()) return;
  renderShop();
  refreshEtas();
}
setInterval(tick, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentUser()) { tick(); renderToday(); } });
