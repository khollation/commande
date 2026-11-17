// Page boutique : catalogue en direct, panier, envoi de la commande, suivi de « ma commande ».
import { SHOP, NTFY_TOPIC, LOW_STOCK } from "../config.js";
import { esc, eur, plural, shopStatus, lastDelivery, toMin, fromMin, nowMin, todayKey, isTime, groupByCategory, isLow, inMinutes } from "./core.js";
import { db, collection, doc, onSnapshot, query, orderBy, runTransaction, serverTimestamp } from "./firebase.js";
import { $, $$, store, initTheme, initNetworkBanner, toast, closeOnBackdrop } from "./ui.js";
import { initPwa } from "./pwa.js";

initTheme();
initNetworkBanner();
initPwa({ name: SHOP.name });
$("#title").textContent = SHOP.name;

// ══════════════ État ══════════════
const CART_KEY = "kh_cart", CATALOG_KEY = "kh_products", ORDER_KEY = "kh_order", SHOP_KEY = "kh_shop";
const CART_HOURS = 12;          // un panier oublié est vidé après ce délai
const ORDER_HOURS = 6;          // durée d'affichage du rappel « Ta commande »

let products = [];              // catalogue affiché
let live = false;               // vrai dès que la base de données a répondu
let cart = loadCart();          // { idProduit: quantité }
let settings = store.json(SHOP_KEY);   // réglage manuel d'ouverture (document settings/shop), copie locale en attendant
let settingsKnown = !!settings; // faux tant que la base n'a pas répondu (et qu'on n'a pas de copie locale)
let shop = shopStatus(settings);
let myOrder = loadOrder();      // dernière commande passée depuis cet appareil
let liveStatus = null;          // statut en direct de cette commande, si la base autorise sa lecture
let stopWatching = null;

const list = $("#list"), dlg = $("#dlg"), form = $("#form"), done = $("#done"), timeInput = $("#time");

// ══════════════ Panier ══════════════
function loadCart() {
  const saved = store.json(CART_KEY);
  if (!saved || typeof saved.items !== "object" || !saved.items || Date.now() - saved.at > CART_HOURS * 36e5) return {};
  const out = {};
  for (const [id, q] of Object.entries(saved.items)) if (Number.isInteger(q) && q > 0) out[id] = q;
  return out;
}
function saveCart() {
  if (Object.keys(cart).length) store.set(CART_KEY, JSON.stringify({ at: Date.now(), items: cart }));
  else store.del(CART_KEY);
}
/** Lignes du panier, au format enregistré dans la commande. */
function lines() {
  return Object.entries(cart).map(([id, qty]) => {
    const p = products.find(x => x.id === id);
    return p && qty > 0 ? { id, name: p.name, priceCents: p.priceCents, qty } : null;
  }).filter(Boolean);
}
const totalCents = () => lines().reduce((s, i) => s + i.priceCents * i.qty, 0);
const countItems = () => lines().reduce((s, i) => s + i.qty, 0);

/** Après une mise à jour du catalogue : retire ce qui n'existe plus, plafonne au stock disponible. */
function reconcileCart() {
  const changed = [];
  for (const id of Object.keys(cart)) {
    const p = products.find(x => x.id === id);
    if (!p || p.stock < 1) { delete cart[id]; changed.push(p ? p.name : "un produit"); }
    else if (cart[id] > p.stock) { cart[id] = p.stock; changed.push(p.name); }
  }
  if (changed.length) {
    saveCart();
    toast("Ton panier a été ajusté : le stock de " + changed.join(", ") + " a changé.");
  }
}

// ══════════════ Catalogue ══════════════
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

let saveTimer;
function saveCatalog() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = list => JSON.stringify({ at: Date.now(), list });
    // Si la mémoire du navigateur est pleine, on garde le catalogue sans les photos.
    if (!store.set(CATALOG_KEY, data(products))) store.set(CATALOG_KEY, data(products.map(p => ({ ...p, image: "" }))));
  }, 1500);
}

onSnapshot(query(collection(db, "products"), orderBy("name")), { includeMetadataChanges: true }, snap => {
  // Sans réseau, la première réponse est une liste vide « de cache » : on attend la vraie.
  if (snap.metadata.fromCache && snap.empty && !live) return;
  products = snap.docs.map(d => cleanProduct(d.id, d.data()));
  live = true;
  reconcileCart();
  render();
  saveCatalog();
}, () => {
  if (products.length) return toast("Connexion à la boutique impossible pour l'instant.", { type: "error" });
  list.setAttribute("aria-busy", "false");
  list.innerHTML = `<div class="empty"><p>Impossible de charger les produits.</p><button class="btn sm" type="button" id="reload">Réessayer</button></div>`;
  $("#reload").onclick = () => location.reload();
});

// ══════════════ Affichage ══════════════
const cards = new Map();   // idProduit → { el, sig } : les cartes sont conservées d'un affichage à l'autre

const signature = p => [p.name, p.priceCents, p.emoji, p.badge, p.image.length, p.image.slice(-32)].join("|");

function buildCard(p) {
  const el = document.createElement("article");
  el.className = "item";
  el.dataset.id = p.id;
  const badge = p.badge === "new" ? '<span class="badge new">Nouveau</span>' : p.badge === "promo" ? '<span class="badge promo">Promo</span>' : "";
  el.innerHTML = `
    <div class="thumb">${p.image ? `<img class="pimg" src="${esc(p.image)}" alt="" decoding="async">` : `<span class="emoji">${esc(p.emoji)}</span>`}</div>
    <div class="body">
      <div class="line"><h3 class="name">${esc(p.name)}${badge}</h3><span class="price">${eur(p.priceCents)}</span></div>
      <div class="line">
        <p class="stock"></p>
        <div class="step" role="group" aria-label="Quantité de ${esc(p.name)}">
          <button type="button" class="minus" data-d="-1" aria-label="Retirer un ${esc(p.name)}">−</button>
          <span class="qty">0</span>
          <button type="button" class="plus" data-d="1" aria-label="Ajouter un ${esc(p.name)}">+</button>
        </div>
      </div>
    </div>`;
  return el;
}

/** Met à jour ce qui change souvent sur une carte : stock et quantité dans le panier. */
function syncCard(el, p) {
  const q = cart[p.id] || 0, out = p.stock < 1;
  el.classList.toggle("out", out);
  el.classList.toggle("in-cart", q > 0);
  const stock = $(".stock", el);
  stock.textContent = out ? "Épuisé" : isLow(p) ? "Plus que " + p.stock + " en stock" : p.stock + " en stock";
  stock.classList.toggle("low", out || isLow(p));
  const step = $(".step", el);
  step.hidden = out;
  step.classList.toggle("zero", q === 0);
  $(".qty", el).textContent = q;
  $(".minus", el).disabled = q === 0;
  $(".plus", el).disabled = q >= p.stock;
}

function renderList() {
  list.setAttribute("aria-busy", "false");
  const groups = groupByCategory(products);
  if (!groups.length) {
    cards.clear();
    list.innerHTML = `<div class="empty"><p>Aucun produit pour le moment, repasse bientôt.</p></div>`;
    return groups;
  }
  const focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest(".item") : null;
  const focus = focused ? { id: focused.dataset.id, d: document.activeElement.dataset.d } : null;

  const frag = document.createDocumentFragment(), seen = new Set();
  for (const g of groups) {
    const section = document.createElement("section");
    section.className = "cat";
    section.id = g.id;
    const h = document.createElement("h2");
    h.className = "cat-title";
    h.textContent = g.name;
    const box = document.createElement("div");
    box.className = "items";
    for (const p of g.list) {
      const sig = signature(p);
      let card = cards.get(p.id);
      if (!card || card.sig !== sig) { card = { el: buildCard(p), sig }; cards.set(p.id, card); }
      syncCard(card.el, p);
      box.append(card.el);
      seen.add(p.id);
    }
    section.append(h, box);
    frag.append(section);
  }
  for (const id of [...cards.keys()]) if (!seen.has(id)) cards.delete(id);
  list.replaceChildren(frag);

  if (focus && cards.has(focus.id)) {
    const b = $(`button[data-d="${focus.d}"]`, cards.get(focus.id).el);
    if (b && !b.disabled) b.focus({ preventScroll: true });
  }
  return groups;
}

function renderCats(groups) {
  const nav = $("#cats");
  nav.hidden = groups.length < 2;
  const html = groups.map(g => `<button type="button" class="chip" data-target="${g.id}">${esc(g.name)}</button>`).join("");
  if (nav.dataset.html !== html) { nav.innerHTML = html; nav.dataset.html = html; markCurrentCat(); }
}

function renderBar(bump = false) {
  const n = countItems();
  $("#count").textContent = plural(n, "article", "articles");
  $("#total").textContent = eur(totalCents());
  const btn = $("#open");
  btn.disabled = n === 0 || !shop.open;
  btn.textContent = shop.open ? "Commander" : "Fermé";
  if (bump && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const bar = $(".bar");
    bar.classList.remove("bump");
    void bar.offsetWidth;   // relance l'animation
    bar.classList.add("bump");
  }
}

function render() {
  renderCats(renderList());
  renderBar();
}

// Copie locale du catalogue : affichage immédiat à l'ouverture, puis remplacement par les données en direct.
function showSavedCatalog() {
  const saved = store.json(CATALOG_KEY);
  if (!saved || !Array.isArray(saved.list) || Date.now() - saved.at > 7 * 864e5) return;
  products = saved.list.map(p => cleanProduct(p.id, p));
  if (products.length) render();
}
// (appelée seulement ici : l'affichage a besoin de tout ce qui est déclaré au-dessus)
showSavedCatalog();

// Boutons + et −
list.addEventListener("click", e => {
  const b = e.target.closest("button[data-d]");
  if (!b) return;
  const el = b.closest(".item"), id = el.dataset.id, p = products.find(x => x.id === id);
  if (!p) return;
  const q = Math.max(0, Math.min(p.stock, (cart[id] || 0) + Number(b.dataset.d)));
  if (q) cart[id] = q; else delete cart[id];
  saveCart();
  syncCard(el, p);
  renderBar(true);
  // Si le bouton utilisé vient d'être désactivé, on garde le focus clavier sur la carte.
  if (b.disabled) (b.classList.contains("minus") ? $(".plus", el) : $(".minus", el)).focus({ preventScroll: true });
});

// Raccourcis de catégories
$("#cats").addEventListener("click", e => {
  const b = e.target.closest("[data-target]");
  const target = b && document.getElementById(b.dataset.target);
  if (target) target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
});
function markCurrentCat() {
  const nav = $("#cats");
  if (nav.hidden) return;
  const limit = nav.getBoundingClientRect().bottom + 24;
  let current = null;
  for (const s of $$(".cat", list)) if (s.getBoundingClientRect().top <= limit) current = s.id;
  for (const chip of $$(".chip", nav)) {
    const on = chip.dataset.target === current;
    if (on) chip.setAttribute("aria-current", "true"); else chip.removeAttribute("aria-current");
  }
}
let scrollTick = false;
addEventListener("scroll", () => {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; markCurrentCat(); });
}, { passive: true });

// ══════════════ Ouverture et annonce ══════════════
function refreshShop() {
  shop = shopStatus(settings);
  const el = $("#shopstatus");
  if (settingsKnown && el.dataset.text !== shop.text) {
    el.dataset.text = shop.text;
    el.className = "status " + (shop.open ? "open" : "closed");
    el.innerHTML = '<span class="dot" aria-hidden="true"></span>';
    el.append(shop.text);
  }
  renderBar();
}
function setSettings(value) {
  settings = value;
  settingsKnown = true;
  if (value) store.set(SHOP_KEY, JSON.stringify(value)); else store.del(SHOP_KEY);
  refreshShop();
}
onSnapshot(doc(db, "settings", "shop"), s => setSettings(s.exists() ? s.data() : null), () => { settingsKnown = true; refreshShop(); });
refreshShop();
// Si la base tarde à répondre, on affiche l'état prévu par les horaires habituels.
setTimeout(() => { if (!settingsKnown) { settingsKnown = true; refreshShop(); } }, 2500);

onSnapshot(doc(db, "settings", "announce"), s => {
  const d = s.exists() ? s.data() : null, el = $("#announce");
  el.hidden = !(d && d.on && d.text);
  el.textContent = d && d.text ? "📣 " + d.text : "";
}, () => {});

// ══════════════ Commande ══════════════
store.get("snack_name") && ($("#name").value = store.get("snack_name"));
store.get("snack_room") && ($("#room").value = store.get("snack_room"));
closeOnBackdrop(dlg);

const QUICK = [["Dès que possible", 5], ["+ 15 min", 15], ["+ 30 min", 30], ["+ 1 h", 60]];

function renderQuickTimes() {
  const now = nowMin(), max = toMin(lastDelivery(shop));
  $("#quick").innerHTML = QUICK
    .filter(([, delta], i) => i === 0 || now + delta <= max)
    .map(([label, delta]) => `<button type="button" class="chip" data-time="${fromMin(Math.min(now + delta, max))}">${label}</button>`).join("");
}
$("#quick").addEventListener("click", e => {
  const b = e.target.closest("[data-time]");
  if (!b) return;
  timeInput.value = b.dataset.time;
  markQuick();
});
function markQuick() {
  for (const b of $$("#quick .chip")) b.setAttribute("aria-pressed", String(b.dataset.time === timeInput.value));
}
timeInput.addEventListener("input", markQuick);

function showForm() {
  const items = lines();
  $("#recap").innerHTML = `<ul class="recap-list">${items.map(i => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${eur(i.qty * i.priceCents)}</span></li>`).join("")}</ul>
    <p class="total-line"><span>Total</span><strong>${eur(totalCents())}</strong></p>`;
  $("#err").textContent = "";
  timeInput.min = fromMin(nowMin());
  timeInput.max = lastDelivery(shop);
  renderQuickTimes();
  markQuick();
  form.hidden = false;
  done.hidden = true;
  dlg.setAttribute("aria-labelledby", "dlg-title");
}

$("#open").onclick = () => { showForm(); dlg.showModal(); };
$("#cancel").onclick = () => dlg.close();

/** Notification push sur le téléphone de l'admin (application ntfy). */
function notify(payload) {
  if (!NTFY_TOPIC) return;
  const send = keepalive => fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: NTFY_TOPIC, ...payload }),
    keepalive   // la notification part même si la page est fermée juste après la commande
  });
  send(true).catch(() => send(false)).catch(() => {});
}

let sending = false;
form.onsubmit = async e => {
  e.preventDefault();
  if (sending) return;
  const fail = msg => { $("#err").textContent = msg; };
  const f = new FormData(form), items = lines(), total = totalCents();
  const name = f.get("name").trim(), room = f.get("room").trim();
  const payment = f.get("payment") === "wero" ? "wero" : "especes";
  const deliveryTime = f.get("time"), comment = f.get("comment").trim();

  if (!items.length) return fail("Ton panier est vide.");
  if (!name || !room) return fail("Indique ton prénom et ta chambre.");
  const status = shopStatus(settings);
  if (!status.open) return fail("La boutique est fermée pour le moment.");
  const max = lastDelivery(status);
  if (!isTime(deliveryTime) || toMin(deliveryTime) < nowMin() || toMin(deliveryTime) > toMin(max)) return fail("Choisis une heure de livraison entre maintenant et " + max + ".");
  if (navigator.onLine === false) return fail("La commande n'est pas partie. Vérifie ta connexion et réessaie.");

  sending = true;
  fail("");
  const send = $("#send");
  send.disabled = true;
  send.textContent = "Envoi…";
  const orderRef = doc(collection(db, "orders"));
  let alerts = [];
  try {
    await runTransaction(db, async tx => {
      alerts = [];
      const refs = items.map(i => doc(db, "products", i.id));
      const snaps = await Promise.all(refs.map(r => tx.get(r)));
      const stocks = snaps.map((s, k) => {
        const stock = s.exists() ? Math.floor(Number(s.data().stock)) || 0 : 0;
        if (stock < items[k].qty) throw new Error("STOCK:" + items[k].name);
        if (Math.round(Number(s.data().priceCents)) !== items[k].priceCents) throw new Error("PRICE:" + items[k].name);
        return stock;
      });
      stocks.forEach((stock, k) => {
        const left = stock - items[k].qty;
        tx.update(refs[k], { stock: left });
        if (LOW_STOCK > 0 && ((stock > LOW_STOCK && left <= LOW_STOCK) || (stock > 0 && left === 0))) alerts.push(items[k].name + (left ? " : plus que " + left : " : épuisé"));
      });
      tx.set(orderRef, { name, room, payment, items, totalCents: total, status: "nouvelle", paid: false, deliveryTime, comment, createdAt: serverTimestamp() });
    });
  } catch (err) {
    const m = String(err && err.message);
    fail(m.startsWith("STOCK:") ? "Désolé, « " + m.slice(6) + " » vient d'être épuisé ou n'a plus assez de stock. Vérifie ton panier."
      : m.startsWith("PRICE:") ? "Le prix de « " + m.slice(6) + " » vient de changer. Vérifie ton panier avant de renvoyer."
      : "La commande n'est pas partie. Vérifie ta connexion et réessaie.");
    return;
  } finally {
    sending = false;
    send.disabled = false;
    send.textContent = "Envoyer la commande";
  }

  store.set("snack_name", name);
  store.set("snack_room", room);
  const n = items.reduce((s, i) => s + i.qty, 0);
  notify({
    title: "Nouvelle commande 🛎️",
    message: `${n} article${n > 1 ? "s" : ""} · ${eur(total)} · livraison vers ${deliveryTime}`,
    priority: 4, tags: ["shopping_cart"],
    click: new URL("admin.html", location.href).href
  });
  if (alerts.length) notify({
    title: "Stock faible ⚠️",
    message: alerts.join(" · "),
    priority: 3, tags: ["warning"],
    click: new URL("admin.html#produits", location.href).href
  });

  myOrder = {
    id: orderRef.id, at: Date.now(), day: todayKey(new Date()), name, room, payment, deliveryTime, totalCents: total,
    items: items.map(i => ({ name: i.name, qty: i.qty, priceCents: i.priceCents }))
  };
  store.set(ORDER_KEY, JSON.stringify(myOrder));
  liveStatus = null;
  watchOrder();
  cart = {};
  saveCart();
  form.reset();
  $("#name").value = name;
  $("#room").value = room;
  render();
  showOrder(true);
};

// ══════════════ « Ta commande » : rappel, compte à rebours, suivi ══════════════
function loadOrder() {
  const o = store.json(ORDER_KEY);
  const ok = o && o.id && Array.isArray(o.items) && isTime(o.deliveryTime) && Date.now() - o.at < ORDER_HOURS * 36e5 && o.day === todayKey(new Date());
  if (o && !ok) store.del(ORDER_KEY);
  return ok ? o : null;
}

const STATUS_TEXT = { nouvelle: "Commande reçue, en attente de validation", "validée": "Commande validée, en préparation", "livrée": "Commande livrée 🎉", "annulée": "Commande annulée" };

/** Texte du compte à rebours avant la livraison. */
function countdown(o) {
  if (liveStatus === "livrée" || liveStatus === "annulée") return STATUS_TEXT[liveStatus];
  const diff = toMin(o.deliveryTime) - nowMin();
  if (diff > 0) return "Livraison prévue " + inMinutes(diff);
  if (diff > -20) return "Livraison d'un instant à l'autre";
  return "Livraison prévue à " + o.deliveryTime;
}

function renderMyOrder() {
  if (myOrder && (Date.now() - myOrder.at > ORDER_HOURS * 36e5 || myOrder.day !== todayKey(new Date()))) forgetOrder();
  const card = $("#myorder");
  card.hidden = !myOrder;
  if (!myOrder) return;
  $("#myorder-title").textContent = "Ta commande · " + eur(myOrder.totalCents);
  $("#myorder-sub").textContent = countdown(myOrder);
  const cd = $("#countdown");
  if (cd && !done.hidden) {
    cd.textContent = countdown(myOrder);
    const liveEl = $("#live");
    liveEl.hidden = !STATUS_TEXT[liveStatus] || liveStatus === "livrée" || liveStatus === "annulée";
    liveEl.textContent = STATUS_TEXT[liveStatus] || "";
  }
}

function forgetOrder() {
  myOrder = null;
  liveStatus = null;
  store.del(ORDER_KEY);
  if (stopWatching) { stopWatching(); stopWatching = null; }
}

/** Suit le statut de la commande en direct. Si la base n'autorise pas cette lecture, on s'en passe. */
function watchOrder() {
  if (stopWatching) { stopWatching(); stopWatching = null; }
  if (!myOrder) return;
  stopWatching = onSnapshot(doc(db, "orders", myOrder.id), s => {
    liveStatus = s.exists() ? s.data().status : null;
    renderMyOrder();
  }, () => { liveStatus = null; });
}

/** Affiche le récapitulatif de la commande. fresh = juste après l'envoi. */
function showOrder(fresh) {
  const o = myOrder;
  if (!o) return;
  const pay = o.payment === "wero"
    ? "Paiement en Wero : à la livraison, scanne le QR code Wero qui te sera présenté. Garde ton application prête."
    : "Prépare ton paiement en espèces, de préférence l'appoint.";
  done.innerHTML = `
    <div class="done-head"><span class="done-ico" aria-hidden="true">✅</span><h2 id="done-title">${fresh ? "Commande envoyée" : "Ta commande"}</h2></div>
    <p class="countdown" id="countdown"></p>
    <p class="live" id="live" hidden></p>
    <ul class="recap-list">${o.items.map(i => `<li><span>${i.qty} × ${esc(i.name)}</span><span>${eur(i.qty * i.priceCents)}</span></li>`).join("")}</ul>
    <p class="total-line"><span>Total à payer</span><strong>${eur(o.totalCents)}</strong></p>
    <p>${pay}</p>
    <p>Livraison dans ta chambre (${esc(o.room)}) vers <strong>${esc(o.deliveryTime)}</strong>, avec un éventuel petit retard.</p>
    <div class="install inline" data-install-card hidden>
      <span class="install-txt"><strong>Pour recommander plus vite</strong><small>Installe l'appli sur ton écran d'accueil</small></span>
      <button class="btn sm" type="button" data-install>Installer</button>
    </div>
    <div class="actions">${fresh ? "" : '<button type="button" class="btn alt" id="forget">Masquer</button>'}<button type="button" class="btn" id="ok">Fermer</button></div>`;
  form.hidden = true;
  done.hidden = false;
  dlg.setAttribute("aria-labelledby", "done-title");
  $("#ok").onclick = () => dlg.close();
  if (!fresh) $("#forget").onclick = () => { forgetOrder(); renderMyOrder(); dlg.close(); };
  renderMyOrder();
  // l'encart d'installation du récapitulatif suit les mêmes règles que celui de la page
  const pageCard = $("main [data-install-card]");
  $("[data-install-card]", done).hidden = !pageCard || pageCard.hidden;
  if (!dlg.open) dlg.showModal();
  $("#ok").focus();
}

$("#myorder").onclick = () => showOrder(false);
watchOrder();
renderMyOrder();

// ══════════════ Horloge ══════════════
// L'état ouvert / fermé et le compte à rebours suivent l'heure, y compris au retour au premier plan.
function tick() { refreshShop(); renderMyOrder(); }
setInterval(tick, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
addEventListener("pageshow", tick);
