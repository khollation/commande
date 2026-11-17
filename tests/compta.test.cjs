// Tests de bout en bout de la compta (compta.html) : vrai navigateur, vrai SDK Firebase, émulateurs.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { startSite, until, text, signIn } = require("./lib/harness.cjs");
const { seed } = require("./lib/fixtures.cjs");
const emu = require("./lib/emulator.cjs");

const at = s => new Date(s + "+01:00");
const line = (id, name, priceCents, qty) => ({ id, name, priceCents, qty });
// Lundi 16/11/2026, 20 h. Montants choisis pour que chaque total soit vérifiable à la main.
const ORDERS = {
  c1: { name: "Léa", room: "214", payment: "especes", items: [line("oasis", "Oasis Tropical 33 cl", 110, 3)], totalCents: 330, status: "livrée", paid: true, createdAt: at("2026-11-16T19:30:00") },
  c2: { name: "Tom", room: "108", payment: "wero", items: [line("chips", "Chips Lay's nature", 120, 1)], totalCents: 120, status: "nouvelle", paid: false, createdAt: at("2026-11-16T19:50:00") },
  c3: { name: "Hugo", room: "112", payment: "wero", items: [line("formule", "Formule Révisions", 200, 5)], totalCents: 1000, status: "annulée", paid: false, createdAt: at("2026-11-16T19:40:00") },
  c4: { name: "Inès", room: "305", payment: "wero", items: [line("formule", "Formule Révisions", 200, 2)], totalCents: 400, status: "livrée", paid: true, createdAt: at("2026-11-13T21:00:00") },
  c5: { name: "Zoé", room: "301", payment: "especes", items: [line("coca", "Coca-Cola 33 cl", 120, 2)], totalCents: 240, status: "livrée", paid: true, createdAt: at("2026-11-06T21:00:00") },
  c6: { name: "Max", room: "220", payment: "especes", items: [line("bueno", "Kinder Bueno", 130, 4)], totalCents: 520, status: "livrée", paid: true, createdAt: at("2026-10-07T21:00:00") }
};
const EXPENSES = {
  x1: { date: "2026-11-14", label: "Cartons d'Oasis", amountCents: 1890 },
  x2: { date: "2026-11-01", label: "Gobelets", amountCents: 500 },
  x3: { date: "2026-11-16", label: "=SUM(A1)", amountCents: 100 },
  x4: { date: "2026-09-01", label: "Ancienne dépense", amountCents: 300 }
};

let site;
before(async () => { site = await startSite(); });
after(async () => { await site.close(); });
beforeEach(async () => {
  await emu.reset();
  await seed();
  await Promise.all([
    ...Object.entries(ORDERS).map(([id, o]) => emu.setDoc("orders/" + id, { deliveryTime: "20:30", comment: "", ...o })),
    ...Object.entries(EXPENSES).map(([id, x]) => emu.setDoc("expenses/" + id, x))
  ]);
});

async function openCompta(options) {
  const ctx = await site.newContext(options);
  const page = await ctx.newPage();
  await page.goto(site.url + "compta.html");
  await signIn(page);
  await page.waitForSelector("#panel:not([hidden])");
  await page.waitForSelector("#kpis .kpi");
  return { ctx, page };
}
const kpis = page => page.$$eval("#kpis .kpi", els => els.map(e => [e.querySelector(".kpi-label").textContent, e.querySelector(".kpi-value").textContent]));
const rows = (page, sel) => page.$$eval(sel + " tbody tr", trs => trs.map(tr => [...tr.cells].map(td => td.textContent.trim())));
const settled = page => page.waitForSelector("#report:not(.loading)");
const tip = page => Promise.all([text(page, ".tip strong"), text(page, ".tip span")]);
async function period(page, value) {
  await page.selectOption("#period", value);
  await settled(page);
}

test("7 derniers jours : chiffres clés, encaissements, ventes et produits", async () => {
  const { ctx, page } = await openCompta();
  await until(async () => (await kpis(page)).length === 6 && (await kpis(page))[4][1] === "3", "chiffres chargés");
  assert.deepEqual(await kpis(page), [
    ["Chiffre d'affaires", "8,50 €"], ["Pas encore encaissé", "1,20 €"], ["Dépenses", "19,90 €"],
    ["Bénéfice", "-12,60 €"], ["Commandes", "3"], ["Panier moyen", "2,83 €"]
  ]);
  assert.deepEqual([await text(page, "#cash .split-head strong"), await text(page, "#cash .split-head span")], ["Déjà encaissé", "7,30 €"]);
  assert.deepEqual(await page.$$eval("#cash .legend li", els => els.map(e => [e.childNodes[1].textContent, e.querySelector("b").textContent])), [["Espèces", "3,30 €"], ["Wero", "4,00 €"]]);
  assert.equal(await page.getAttribute("#cash .segbar", "aria-label"), "Espèces 45 %, Wero 55 %");

  assert.equal(await text(page, "#byh"), "Ventes par jour");
  assert.deepEqual(await rows(page, "#byday"), [["16/11/2026", "2", "4,50 €"], ["13/11/2026", "1", "4,00 €"]]);
  assert.deepEqual(await rows(page, "#top"), [["Oasis Tropical 33 cl", "3", "3,30 €"], ["Formule Révisions", "2", "4,00 €"], ["Chips Lay's nature", "1", "1,20 €"]]);
  assert.deepEqual(await page.$$eval("#xlist .erow", els => els.map(e => [e.firstElementChild.textContent, e.querySelector("strong").textContent])), [["16/11/2026 · =SUM(A1)", "1,00 €"], ["14/11/2026 · Cartons d'Oasis", "18,90 €"]]);
  assert.deepEqual(ctx.errors, []);
});

test("graphique : une barre par jour, échelle ronde, valeur du pic, infobulle souris et clavier", async () => {
  const { page } = await openCompta();
  await page.waitForSelector(".col");
  assert.equal(await page.$$eval(".col", els => els.length), 7);
  assert.deepEqual(await page.$$eval(".gl span", els => els.map(e => e.textContent)), ["0 €", "2 €", "4 €", "6 €"]);
  assert.deepEqual(await page.$$eval(".xl span", els => els.map(e => e.textContent)), ["10/11", "", "12/11", "", "14/11", "", "16/11"]);
  assert.deepEqual(await page.$$eval(".col b", els => els.map(e => e.textContent)), ["4,50 €"], "seul le pic est étiqueté");
  assert.equal(await page.getAttribute(".col:last-child", "aria-label"), "16/11/2026 : 4,50 €, 2 commandes");
  assert.equal(await page.getAttribute(".col:nth-child(2)", "aria-label"), "11/11/2026 : 0,00 €, 0 commande");

  await page.hover(".col:nth-child(4)");
  await page.waitForSelector(".tip:not([hidden])");
  assert.deepEqual(await tip(page), ["4,00 €", "13/11/2026 · 1 commande"]);

  await page.focus(".col:last-child");
  assert.deepEqual(await tip(page), ["4,50 €", "16/11/2026 · 2 commandes"]);
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.i), "5");
  assert.deepEqual(await tip(page), ["0,00 €", "15/11/2026 · 0 commande"]);
});

test("périodes : aujourd'hui, 30 jours, tout ; regroupement par semaine", async () => {
  const { page } = await openCompta();
  await until(async () => (await kpis(page))[4][1] === "3", "7 jours");

  await period(page, "1");
  await until(async () => (await kpis(page))[4][1] === "2", "aujourd'hui");
  assert.deepEqual((await kpis(page)).map(k => k[1]), ["4,50 €", "1,20 €", "1,00 €", "2,30 €", "2", "2,25 €"]);
  assert.equal(await page.$$eval(".col", els => els.length), 1);

  await period(page, "30");
  await until(async () => (await kpis(page))[4][1] === "4", "30 jours");
  assert.deepEqual((await kpis(page)).map(k => k[1]).slice(0, 3), ["10,90 €", "1,20 €", "24,90 €"]);
  assert.equal(await page.$$eval(".col", els => els.length), 30);

  await period(page, "0");
  await until(async () => (await kpis(page))[4][1] === "5", "tout");
  assert.deepEqual((await kpis(page)).map(k => k[1]).slice(0, 3), ["16,10 €", "1,20 €", "27,90 €"]);
  assert.ok((await text(page, "#chart")).includes("Le graphique montre les 31 derniers jours"), "graphique limité, tableau complet");
  assert.deepEqual((await rows(page, "#byday")).map(r => r[0]), ["16/11/2026", "13/11/2026", "06/11/2026", "07/10/2026"], "5 commandes réparties sur 4 jours");

  await period(page, "7");
  await page.selectOption("#group", "week");
  await until(async () => (await text(page, "#byh")) === "Ventes par semaine (début le lundi)", "par semaine");
  assert.deepEqual(await rows(page, "#byday"), [["16/11/2026", "2", "4,50 €"], ["09/11/2026", "1", "4,00 €"]]);
  assert.equal(await page.$$eval(".col", els => els.length), 2);
});

test("dépenses : ajout et suppression après confirmation", async () => {
  const { page } = await openCompta();
  assert.equal(await page.inputValue("#xd"), "2026-11-16", "date du jour proposée");
  await page.fill("#xd", "2026-11-15");
  await page.fill("#xl", "Sachets kraft");
  await page.fill("#xa", "4.5");
  await page.click("#addx button");
  await until(async () => (await emu.listDocs("expenses")).some(x => x.label === "Sachets kraft"), "dépense ajoutée");
  const added = (await emu.listDocs("expenses")).find(x => x.label === "Sachets kraft");
  assert.deepEqual({ ...added, id: undefined }, { id: undefined, date: "2026-11-15", label: "Sachets kraft", amountCents: 450 });
  await until(async () => (await kpis(page))[2][1] === "24,40 €", "total des dépenses mis à jour");
  assert.equal(await page.inputValue("#xl"), "");

  await page.click('#xlist [data-del="x1"]');
  await page.click('dialog.confirm button[value="yes"]');
  await until(async () => (await emu.getDoc("expenses/x1")) === null, "dépense supprimée");
  await until(async () => (await kpis(page))[2][1] === "5,50 €", "total après suppression");
});

test("exports CSV : contenu, séparateurs, accents et formules neutralisées", async () => {
  const { page } = await openCompta({ viewport: { width: 1200, height: 900 } });
  await until(async () => (await kpis(page))[4][1] === "3", "données chargées");
  const download = async button => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(button)]);
    return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), "utf8") };
  };
  const orders = await download("#ex-o");
  assert.equal(orders.name, "commandes.csv");
  assert.ok(orders.text.startsWith("﻿"), "marque UTF-8 pour Excel");
  assert.deepEqual(orders.text.slice(1).split("\r\n"), [
    '"Date";"Heure";"Statut";"Payée";"Paiement";"Produits";"Total (€)"',
    '"2026-11-16";"19:50";"nouvelle";"non";"wero";"1 x Chips Lay\'s nature";"1,20"',
    '"2026-11-16";"19:40";"annulée";"non";"wero";"5 x Formule Révisions";"10,00"',
    '"2026-11-16";"19:30";"livrée";"oui";"especes";"3 x Oasis Tropical 33 cl";"3,30"',
    '"2026-11-13";"21:00";"livrée";"oui";"wero";"2 x Formule Révisions";"4,00"'
  ]);
  const expenses = await download("#ex-x");
  assert.equal(expenses.name, "depenses.csv");
  assert.deepEqual(expenses.text.slice(1).split("\r\n"), [
    '"Date";"Libellé";"Montant (€)"',
    '"2026-11-16";"\'=SUM(A1)";"1,00"',
    '"2026-11-14";"Cartons d\'Oasis";"18,90"'
  ]);
});

test("session partagée avec l'admin et navigation par les onglets", async () => {
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url + "admin.html");
  await signIn(page);
  await page.waitForSelector("#panel:not([hidden])");
  await page.click('#tabs a[href="compta.html"]');
  await page.waitForURL(/compta\.html$/);
  await page.waitForSelector("#panel:not([hidden])");
  assert.ok(await page.isHidden("#login"), "pas besoin de se reconnecter");
  assert.equal(await page.getAttribute('#tabs a[href="compta.html"]', "aria-current"), "page");
  await page.click('#tabs a[href="admin.html#produits"]');
  await page.waitForSelector("#tab-produits:not([hidden])");
});

test("sans connexion : formulaire de connexion, aucune donnée affichée", async () => {
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url + "compta.html");
  await page.waitForSelector("#login:not([hidden])");
  assert.ok(await page.isHidden("#panel"));
  assert.ok(await page.isHidden("#tabs"));
  assert.equal(await page.$$eval("#kpis .kpi", els => els.length), 0);
});
