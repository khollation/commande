// Page compta : chiffres clés, ventes par jour ou par semaine, produits les plus vendus, dépenses, exports CSV.
import { esc, eur, toCents, todayKey, frDate, plural } from "./core.js";
import { db, collection, onSnapshot, query, orderBy, limit, where, addDoc, deleteDoc, doc } from "./firebase.js";
import { initSession, currentUser } from "./session.js";
import { $, $$, initTheme, initNetworkBanner, toast, confirmDialog } from "./ui.js";
import { initPwa } from "./pwa.js";

initTheme();
initNetworkBanner();
initPwa({ name: "l'appli Admin" });

const MAX_BARS = 31;   // nombre maximal de barres du graphique (le tableau, lui, liste tout)
const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
const num = cents => ((Number(cents) || 0) / 100).toFixed(2).replace(".", ",");
const amount = o => Math.round(Number(o.totalCents)) || 0;
const itemsOf = o => (Array.isArray(o.items) ? o.items : []);
const fail = (what, err) => toast(what + " : " + (err && err.message ? err.message : "erreur inconnue"), { type: "error", duration: 7000 });
const parseKey = key => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
const mondayOf = date => { const x = new Date(date); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return todayKey(x); };

let orders = [], expenses = [];
let unsubOrders = null, unsubExpenses = null, listeningSince = null;
$("#xd").value = todayKey(new Date());

/** Premier jour de la période choisie (AAAA-MM-JJ), ou "" pour « Tout ». */
function since() {
  const n = +$("#period").value;
  if (!n) return "";
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return todayKey(d);
}
const inPeriod = o => todayKey(o.createdAt.toDate()) >= since();

// ══════════════ Données ══════════════
function subscribeOrders() {
  if (unsubOrders) unsubOrders();
  const s = since(), base = collection(db, "orders");
  listeningSince = s;
  // Pendant le rechargement, on garde l'affichage précédent, simplement estompé.
  $("#report").classList.add("loading");
  const q = s
    ? query(base, where("createdAt", ">=", parseKey(s)), orderBy("createdAt", "desc"))
    : query(base, orderBy("createdAt", "desc"), limit(2000));
  unsubOrders = onSnapshot(q, snap => {
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.createdAt && typeof o.createdAt.toDate === "function");
    $("#report").classList.remove("loading");
    render();
  }, err => { $("#report").classList.remove("loading"); fail("Lecture des commandes impossible", err); });
}

initSession({
  onOut() {
    if (unsubOrders) { unsubOrders(); unsubOrders = null; }
    if (unsubExpenses) { unsubExpenses(); unsubExpenses = null; }
    orders = []; expenses = [];
  },
  onIn() {
    subscribeOrders();
    if (unsubExpenses) unsubExpenses();
    unsubExpenses = onSnapshot(query(collection(db, "expenses"), orderBy("date", "desc")), snap => {
      expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    }, err => fail("Lecture des dépenses impossible", err));
  }
});

$("#period").onchange = subscribeOrders;
$("#group").onchange = render;
// Si la page reste ouverte après minuit, la période glisse d'un jour.
document.addEventListener("visibilitychange", () => { if (!document.hidden && currentUser() && since() !== listeningSince) subscribeOrders(); });

// ══════════════ Affichage ══════════════
const table = (head, rows) => rows.length
  ? `<table class="table card"><thead><tr>${head.map((h, i) => `<th class="${i ? "n" : ""}">${h}</th>`).join("")}</tr></thead>
     <tbody>${rows.map(r => `<tr>${r.map((cell, i) => `<td class="${i ? "n" : ""}">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : `<p class="note">Aucune donnée sur cette période.</p>`;

function render() {
  const s = since();
  const os = orders.filter(o => o.status !== "annulée" && inPeriod(o));
  const xs = expenses.filter(x => String(x.date) >= s);
  const paidOrders = os.filter(o => o.paid);
  const ca = sum(os, amount), paid = sum(paidOrders, amount), dep = sum(xs, x => Number(x.amountCents) || 0);

  // Chiffres clés
  const tiles = [
    ["Chiffre d'affaires", eur(ca)],
    ["Pas encore encaissé", eur(ca - paid)],
    ["Dépenses", eur(dep)],
    ["Bénéfice", eur(paid - dep), "encaissé − dépenses"],
    ["Commandes", os.length],
    ["Panier moyen", os.length ? eur(Math.round(ca / os.length)) : "—"]
  ];
  $("#kpis").innerHTML = tiles.map(([label, value, sub]) =>
    `<div class="kpi"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong>${sub ? `<span class="kpi-sub">${sub}</span>` : ""}</div>`).join("");

  // Encaissements : espèces et Wero (utile pour vérifier la caisse)
  const cash = sum(paidOrders.filter(o => o.payment !== "wero"), amount), wero = paid - cash;
  const pct = v => (paid ? Math.round(v / paid * 100) : 0);
  $("#cash").innerHTML = `
    <div class="split-head"><strong>Déjà encaissé</strong><span>${eur(paid)}</span></div>
    ${paid ? `<div class="segbar" role="img" aria-label="Espèces ${pct(cash)} %, Wero ${pct(wero)} %">${cash ? `<i class="s1" style="flex:${cash}"></i>` : ""}${wero ? `<i class="s2" style="flex:${wero}"></i>` : ""}</div>` : ""}
    <ul class="legend">
      <li><i class="sw s1"></i>Espèces<b>${eur(cash)}</b></li>
      <li><i class="sw s2"></i>Wero<b>${eur(wero)}</b></li>
    </ul>`;

  // Ventes par jour ou par semaine
  const week = $("#group").value === "week", buckets = {};
  os.forEach(o => {
    const d = o.createdAt.toDate(), key = week ? mondayOf(d) : todayKey(d);
    const b = buckets[key] || (buckets[key] = { n: 0, c: 0 });
    b.n++;
    b.c += amount(o);
  });
  $("#byh").textContent = week ? "Ventes par semaine (début le lundi)" : "Ventes par jour";
  const keys = Object.keys(buckets).sort();
  renderChart(buckets, keys, s, week);
  $("#byday").innerHTML = table([week ? "Semaine du" : "Jour", "Commandes", "CA"], [...keys].reverse().map(k => [frDate(k), buckets[k].n, eur(buckets[k].c)]));

  // Produits les plus vendus
  const sold = {};
  os.forEach(o => itemsOf(o).forEach(i => {
    const qty = Number(i.qty) || 0, r = sold[i.name] || (sold[i.name] = { q: 0, c: 0 });
    r.q += qty;
    r.c += qty * (Number(i.priceCents) || 0);
  }));
  const ranked = Object.entries(sold).sort((a, b) => b[1].q - a[1].q), best = ranked.length ? ranked[0][1].q : 0;
  $("#top").innerHTML = table(["Produit", "Qté", "CA"], ranked.map(([name, r]) =>
    [`${esc(name)}<span class="rank"><i style="width:${best ? Math.max(2, r.q / best * 100) : 0}%"></i></span>`, r.q, eur(r.c)]));

  // Dépenses
  $("#xlist").innerHTML = xs.map(x => `<div class="erow"><span>${esc(frDate(String(x.date)))} · ${esc(x.label)}</span>
    <span class="erow-end"><strong>${eur(x.amountCents)}</strong><button type="button" class="icon-btn sm" data-del="${esc(x.id)}" aria-label="Supprimer cette dépense">✕</button></span></div>`).join("")
    || `<p class="note">Aucune dépense sur cette période.</p>`;
}

// ---------- Graphique des ventes ----------
/** Graduations rondes pour l'axe vertical : renvoie le haut de l'échelle et les graduations (en centimes). */
function niceScale(maxCents) {
  const max = Math.max(maxCents, 100) / 100, raw = max / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * pow).find(v => v >= raw);
  const top = Math.ceil(max / step - 1e-9) * step, ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100));
  return { top: Math.round(top * 100), ticks };
}
const tickLabel = cents => (cents % 100 ? num(cents) : String(cents / 100)) + " €";

function renderChart(buckets, keys, s, week) {
  const fig = $("#chart");
  if (!keys.length) { fig.innerHTML = `<p class="note">Aucune vente sur cette période.</p>`; return; }
  // Toutes les périodes entre le début et aujourd'hui, y compris celles sans vente.
  const first = week ? mondayOf(parseKey(s || keys[0])) : (s || keys[0]);
  let all = [];
  for (const d = parseKey(first), end = todayKey(new Date()); todayKey(d) <= end; d.setDate(d.getDate() + (week ? 7 : 1))) all.push(todayKey(d));
  const truncated = all.length > MAX_BARS;
  if (truncated) all = all.slice(-MAX_BARS);
  const points = all.map(key => ({ key, c: buckets[key] ? buckets[key].c : 0, n: buckets[key] ? buckets[key].n : 0 }));
  const max = Math.max(...points.map(p => p.c)), { top, ticks } = niceScale(max);
  const peak = points.findIndex(p => p.c === max);
  const every = Math.ceil(points.length / 6);   // au plus ~6 dates sous l'axe, la plus récente toujours affichée
  const short = key => key.slice(8) + "/" + key.slice(5, 7);
  const what = p => (week ? "Semaine du " : "") + frDate(p.key);

  fig.innerHTML = `
    <div class="plot">
      ${ticks.map(t => `<div class="gl${t ? "" : " base"}" style="bottom:${t / top * 100}%"><span>${tickLabel(t)}</span></div>`).join("")}
      <div class="cols" role="group" aria-label="Ventes ${week ? "par semaine" : "par jour"}">
        ${points.map((p, i) => `<button type="button" class="col" tabindex="${i === points.length - 1 ? 0 : -1}" data-i="${i}"
            aria-label="${what(p)} : ${eur(p.c)}, ${plural(p.n, "commande", "commandes")}">
            <i style="height:${p.c / top * 100}%"></i>${i === peak && max > 0 ? `<b style="bottom:calc(${p.c / top * 100}% + .25rem)">${eur(p.c)}</b>` : ""}</button>`).join("")}
      </div>
    </div>
    <div class="xl" aria-hidden="true">${points.map((p, i) => `<span>${(points.length - 1 - i) % every === 0 ? short(p.key) : ""}</span>`).join("")}</div>
    ${truncated ? `<figcaption class="note">Le graphique montre les ${MAX_BARS} ${week ? "dernières semaines" : "derniers jours"} ; le tableau ci-dessous liste tout.</figcaption>` : ""}
    <div class="tip" hidden></div>`;

  const tip = $(".tip", fig), cols = $$(".col", fig);
  const show = col => {
    const p = points[+col.dataset.i];
    const value = document.createElement("strong"), label = document.createElement("span");
    value.textContent = eur(p.c);
    label.textContent = what(p) + " · " + plural(p.n, "commande", "commandes");
    tip.replaceChildren(value, label);
    tip.hidden = false;
    const f = fig.getBoundingClientRect(), c = col.getBoundingClientRect(), bar = $("i", col).getBoundingClientRect();
    const half = tip.offsetWidth / 2 + 6;
    tip.style.left = Math.min(Math.max(c.left + c.width / 2 - f.left, half), f.width - half) + "px";
    tip.style.top = Math.max(bar.top - f.top - 8, tip.offsetHeight + 2) + "px";
  };
  const hide = () => { tip.hidden = true; };
  for (const col of cols) {
    col.addEventListener("pointerenter", () => show(col));
    col.addEventListener("pointerleave", hide);
    col.addEventListener("focus", () => show(col));
    col.addEventListener("blur", hide);
    // Au clavier : une seule étape de tabulation, puis les flèches pour passer d'une barre à l'autre.
    col.addEventListener("keydown", e => {
      const next = e.key === "ArrowRight" ? cols[+col.dataset.i + 1] : e.key === "ArrowLeft" ? cols[+col.dataset.i - 1] : null;
      if (!next) return;
      e.preventDefault();
      col.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    });
  }
}

// ══════════════ Dépenses ══════════════
$("#addx").onsubmit = async e => {
  e.preventDefault();
  const date = $("#xd").value, label = $("#xl").value.trim(), amountCents = toCents($("#xa").value);
  if (!date || !label) return toast("Indique la date et l'achat.", { type: "error" });
  if (!Number.isFinite(amountCents) || amountCents < 0) return toast("Le montant n'est pas valide.", { type: "error" });
  try {
    await addDoc(collection(db, "expenses"), { date, label, amountCents });
    $("#xl").value = "";
    $("#xa").value = "";
    toast("Dépense ajoutée.", { type: "ok" });
  } catch (err) { fail("Ajout impossible", err); }
};

$("#xlist").onclick = async e => {
  const b = e.target.closest("[data-del]");
  if (!b || !await confirmDialog({ title: "Supprimer cette dépense ?", ok: "Supprimer", danger: true })) return;
  try { await deleteDoc(doc(db, "expenses", b.dataset.del)); }
  catch (err) { fail("Suppression impossible", err); }
};

// ══════════════ Exports ══════════════
/** Un texte commençant par = + - ou @ serait lu comme une formule par un tableur : on le neutralise. */
const safeCell = c => { const t = String(c ?? ""); return /^[=+\-@\t\r]/.test(t) ? "'" + t : t; };

async function csv(name, rows) {
  const text = "﻿" + rows.map(r => r.map(c => '"' + safeCell(c).replace(/"/g, '""') + '"').join(";")).join("\r\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  // Sur téléphone, la feuille de partage permet d'enregistrer le fichier ou de l'envoyer (mail, Drive…).
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare) {
    const file = new File([blob], name, { type: "text/csv" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (err) { if (err && err.name === "AbortError") return; }
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("#ex-o").onclick = () => csv("commandes.csv", [["Date", "Heure", "Statut", "Payée", "Paiement", "Produits", "Total (€)"],
  ...orders.filter(inPeriod).map(o => {
    const d = o.createdAt.toDate();
    return [todayKey(d), d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), o.status, o.paid ? "oui" : "non", o.payment,
      itemsOf(o).map(i => i.qty + " x " + i.name).join(" ; "), num(o.totalCents)];
  })]);
$("#ex-x").onclick = () => csv("depenses.csv", [["Date", "Libellé", "Montant (€)"],
  ...expenses.filter(x => String(x.date) >= since()).map(x => [x.date, x.label, num(x.amountCents)])]);
