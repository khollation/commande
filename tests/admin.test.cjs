// Tests de bout en bout de l'admin (admin.html) : vrai navigateur, vrai SDK Firebase, émulateurs.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { startSite, until, text, signIn, REPO } = require("./lib/harness.cjs");
const { seed, PRODUCTS, ADMIN } = require("./lib/fixtures.cjs");
const emu = require("./lib/emulator.cjs");

const NOW = new Date("2026-11-16T20:00:00+01:00");
const ago = min => new Date(NOW.getTime() - min * 60000);
const ORDERS = {
  o1: { name: "Léa", room: "214", payment: "wero", items: [{ id: "oasis", name: "Oasis Tropical 33 cl", priceCents: 110, qty: 2 }, { id: "bueno", name: "Kinder Bueno", priceCents: 130, qty: 1 }], totalCents: 350, status: "nouvelle", paid: false, deliveryTime: "20:30", comment: "Frappe fort stp", createdAt: ago(3) },
  o2: { name: "Tom", room: "108", payment: "especes", items: [{ id: "chips", name: "Chips Lay's nature", priceCents: 120, qty: 1 }], totalCents: 120, status: "validée", paid: false, deliveryTime: "19:45", comment: "", createdAt: ago(40) },
  o3: { name: "Inès", room: "305", payment: "especes", items: [{ id: "formule", name: "Formule Révisions", priceCents: 200, qty: 2 }], totalCents: 400, status: "livrée", paid: true, deliveryTime: "19:15", comment: "", createdAt: ago(70) },
  o4: { name: "lea", room: "214", payment: "especes", items: [{ id: "oasis", name: "Oasis Tropical 33 cl", priceCents: 110, qty: 1 }], totalCents: 110, status: "livrée", paid: true, deliveryTime: "21:00", comment: "", createdAt: ago(60 * 26) },
  o5: { name: "Hugo", room: "112", payment: "wero", items: [{ id: "tagada", name: "Haribo Tagada", priceCents: 150, qty: 1 }], totalCents: 150, status: "annulée", paid: false, deliveryTime: "20:10", comment: "", createdAt: ago(60 * 27) }
};

let site;
before(async () => { site = await startSite(); });
after(async () => { await site.close(); });
beforeEach(async () => {
  await emu.reset();
  await seed();
  await Promise.all(Object.entries(ORDERS).map(([id, o]) => emu.setDoc("orders/" + id, o)));
});

async function openAdmin(options, hash = "") {
  const ctx = await site.newContext(options);
  const page = await ctx.newPage();
  await page.goto(site.url + "admin.html" + hash);
  await signIn(page);
  await page.waitForSelector("#panel:not([hidden])");
  return { ctx, page };
}
const card = id => `.order[data-id="${id}"]`;
const act = (id, action) => `${card(id)} [data-act="${action}"]`;
const confirmYes = page => page.click('dialog.confirm button[value="yes"]');
const lastToast = page => until(async () => { const t = await page.$$eval(".toast span", els => els.map(e => e.textContent)); return t[t.length - 1]; }, "message");
const tab = (page, name) => page.click(`#tabs [data-tab="${name}"]`);
/** Tuiles de chiffres clés : [libellé, valeur]. */
const tiles = (page, root) => page.$$eval(root + " .kpi", els => els.map(e => [e.querySelector(".kpi-label").textContent, e.querySelector(".kpi-value").textContent]));

test("connexion : refus d'un mauvais mot de passe, puis accès et session conservée", async () => {
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url + "admin.html");
  await signIn(page, { password: "mauvais" });
  assert.equal(await until(() => text(page, "#lerr"), "message d'erreur"), "E-mail ou mot de passe incorrect.");
  assert.ok(await page.isHidden("#panel"));
  await page.fill("#pw", ADMIN.password);
  await page.click("#login button");
  await page.waitForSelector("#panel:not([hidden])");
  assert.equal(await text(page, "#page-title"), "Commandes");
  await page.reload();
  await page.waitForSelector("#panel:not([hidden])");
  assert.ok(await page.isHidden("#login"), "toujours connecté après rechargement");
  await tab(page, "boutique");
  assert.equal(await text(page, "#who"), ADMIN.email);
  await page.click("#out");
  await page.waitForSelector("#login:not([hidden])");
  assert.ok(await page.isHidden("#tabs"));
  assert.equal(await page.inputValue("#pw"), "");
  assert.deepEqual(ctx.errors.filter(e => !e.includes("400")), []);
});

test("commandes : chiffres du jour, filtres, regroupement par jour, délais", async () => {
  const { ctx, page } = await openAdmin();
  await page.waitForSelector(card("o1"));
  assert.equal(await page.title(), "(1) Admin · Commandes");
  assert.equal(await text(page, "#n-new"), "1");
  assert.deepEqual(await tiles(page, "#today"), [["Commandes du jour", "3"], ["Ventes du jour", "8,70 €"], ["À traiter", "2"], ["Non payé", "4,70 €"]]);
  assert.deepEqual(await page.$$eval("#filters .chip", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim())),
    ["Toutes 5", "Nouvelles 1", "À livrer 1", "Non payées 2", "Livrées 2"]);
  assert.deepEqual(await page.$$eval("#orders .day", els => els.map(e => e.textContent)), ["Aujourd'hui", "Hier"]);
  assert.deepEqual(await page.$$eval("#orders .order", els => els.map(e => e.dataset.id)), ["o1", "o2", "o3", "o4", "o5"]);

  const o1 = await text(page, card("o1"));
  for (const part of ["Léa · ch. 214", "3,50 €", "19:57 · Wero", "Livraison souhaitée : 20:30", "dans 30 min", "💬 Frappe fort stp", "2 × Oasis Tropical 33 cl", "1 × Kinder Bueno", "nouvelle", "non payée"]) assert.ok(o1.includes(part), `« ${part} » absent de « ${o1} »`);
  assert.equal(await text(page, `${card("o2")} .eta.late`), "en retard de 15 min");
  assert.ok(await page.isHidden(`${card("o3")} .eta`), "pas de délai pour une commande livrée");
  assert.ok((await text(page, card("o4"))).includes("15/11 18:00"), "date affichée pour une commande d'un autre jour");

  await page.click('#filters [data-filter="impayées"]');
  assert.deepEqual(await page.$$eval("#orders .order", els => els.map(e => e.dataset.id)), ["o1", "o2"]);
  assert.equal(await page.getAttribute('#filters [data-filter="impayées"]', "aria-pressed"), "true");
  await page.click('#filters [data-filter="livrée"]');
  assert.deepEqual(await page.$$eval("#orders .order", els => els.map(e => e.dataset.id)), ["o3", "o4"]);
  await page.click('#filters [data-filter="nouvelle"]');
  assert.deepEqual(await page.$$eval("#orders .order", els => els.map(e => e.dataset.id)), ["o1"]);
  assert.deepEqual(ctx.errors, []);
});

test("« À livrer » : la livraison la plus urgente en premier", async () => {
  await emu.setDoc("orders/o6", { ...ORDERS.o2, name: "Zoé", deliveryTime: "19:30", createdAt: ago(5) });
  await emu.setDoc("orders/o7", { ...ORDERS.o2, name: "Max", deliveryTime: "21:00", createdAt: ago(2) });
  const { page } = await openAdmin();
  await page.click('#filters [data-filter="validée"]');
  assert.deepEqual(await page.$$eval("#orders .order", els => els.map(e => e.dataset.id)), ["o6", "o2", "o7"]);
});

test("cycle d'une commande : valider, livrer, encaisser depuis le message", async () => {
  const { page } = await openAdmin();
  await page.click(act("o1", "valider"));
  await until(async () => (await emu.getDoc("orders/o1")).status === "validée", "commande validée");
  await page.waitForSelector(act("o1", "livrer"));
  assert.equal((await emu.getDoc("orders/o1")).paid, false);
  await page.click(act("o1", "livrer"));
  await until(async () => (await emu.getDoc("orders/o1")).status === "livrée", "commande livrée");
  assert.equal(await lastToast(page), "Commande de Léa livrée.");
  await page.click('.toast button:text("Marquer payée")');
  await until(async () => (await emu.getDoc("orders/o1")).paid === true, "commande payée depuis le message");
  await page.waitForSelector(`${card("o1")} .tag.ok`);
  await page.click(act("o1", "payer"));
  await until(async () => (await emu.getDoc("orders/o1")).paid === false, "retour à « non payée »");
  const { createdAt, id, ...rest } = await emu.getDoc("orders/o1");
  const { createdAt: _, ...expected } = ORDERS.o1;
  assert.deepEqual(rest, { ...expected, status: "livrée", paid: false }, "seuls statut et paiement changent");
});

test("annulation : confirmation, stock remis, même si un produit a été supprimé depuis", async () => {
  const { page } = await openAdmin();
  await page.click(act("o2", "annuler"));
  assert.equal(await text(page, "dialog.confirm h2"), "Annuler la commande de Tom ?");
  await page.click('dialog.confirm button[value="no"]');
  assert.equal((await emu.getDoc("orders/o2")).status, "validée", "« Retour » n'annule rien");

  await page.click(act("o2", "annuler"));
  await confirmYes(page);
  await until(async () => (await emu.getDoc("orders/o2")).status === "annulée", "commande annulée");
  assert.equal((await emu.getDoc("products/chips")).stock, 21);
  assert.equal(await lastToast(page), "Commande annulée, le stock est remis en vente.");

  // Avant la refonte, l'annulation échouait entièrement si un produit de la commande avait été supprimé.
  await emu.setDoc("orders/o8", { ...ORDERS.o1, name: "Sam", items: [{ id: "fantome", name: "Produit retiré", priceCents: 100, qty: 1 }, { id: "oasis", name: "Oasis Tropical 33 cl", priceCents: 110, qty: 2 }], createdAt: ago(1) });
  await page.waitForSelector(act("o8", "annuler"));
  await page.click(act("o8", "annuler"));
  await confirmYes(page);
  await until(async () => (await emu.getDoc("orders/o8")).status === "annulée", "commande annulée malgré le produit supprimé");
  assert.equal((await emu.getDoc("products/oasis")).stock, 14);
  assert.equal(await emu.getDoc("products/fantome"), null, "aucun produit fantôme recréé");
  assert.equal(await lastToast(page), "Commande annulée. Stock non remis pour Produit retiré (produit supprimé).");
});

test("suppression d'une commande terminée, après confirmation", async () => {
  const { page } = await openAdmin();
  assert.ok(await page.isHidden(act("o1", "suppr")), "une commande en cours ne se supprime pas");
  await page.click(act("o3", "suppr"));
  await confirmYes(page);
  await until(async () => (await emu.getDoc("orders/o3")) === null, "commande supprimée");
  await until(async () => !(await page.$(card("o3"))), "carte retirée");
});

test("nouvelle commande en direct : message, mise en avant ; une ancienne ne déclenche rien", async () => {
  const { page } = await openAdmin();
  await page.waitForSelector(card("o1"));
  await emu.setDoc("orders/o9", { ...ORDERS.o1, name: "Zoé", room: "301", createdAt: new Date(NOW.getTime() + 60000) });
  await page.waitForSelector(`${card("o9")}.fresh`);
  assert.equal(await lastToast(page), "Nouvelle commande : Zoé · ch. 301");
  assert.equal(await page.title(), "(2) Admin · Commandes");
  const before = await page.$$eval(".toast", els => els.length);
  await emu.setDoc("orders/o10", { ...ORDERS.o1, name: "Ancien", createdAt: ago(600) });
  await page.waitForSelector(card("o10"));
  await page.waitForTimeout(300);
  assert.equal(await page.$$eval(".toast", els => els.length), before, "pas d'alerte pour une commande ancienne");
});

test("rendu de monnaie : à rendre, détail des pièces, montant insuffisant, encaissement", async () => {
  const { page } = await openAdmin();
  assert.ok(await page.isHidden(act("o1", "rendu")), "pas de rendu de monnaie pour un paiement Wero");
  await emu.setDoc("orders/o2", { ...ORDERS.o2, totalCents: 350 });
  await until(async () => (await text(page, `${card("o2")} .amount`)) === "3,50 €", "montant mis à jour");
  await page.click(act("o2", "rendu"));
  assert.deepEqual(await page.$$eval("dialog [data-give]", els => els.map(e => e.textContent)), ["Appoint", "5,00 €", "10,00 €", "20,00 €", "50,00 €"]);
  await page.click('dialog [data-give="1000"]');
  assert.equal(await text(page, "#change strong"), "À rendre : 6,50 €");
  assert.equal(await text(page, "#change small"), "1 × 5 € + 1 × 1 € + 1 × 50 c");
  await page.fill("#given", "3");
  assert.equal(await text(page, "#change strong"), "Il manque 0,50 €");
  await page.click('dialog [data-give="350"]');
  assert.equal(await text(page, "#change strong"), "Le compte est bon");
  await page.click("#paid");
  await until(async () => (await emu.getDoc("orders/o2")).paid === true, "commande payée");
  assert.equal(await lastToast(page), "Commande de Tom marquée payée.");
});

test("historique d'un client : commandes, totaux, habitudes, même chambre", async () => {
  await emu.setDoc("orders/o11", { ...ORDERS.o3, name: "Max", room: "214", createdAt: ago(60 * 50) });
  const { page } = await openAdmin();
  await page.click(act("o1", "histo"));
  await until(async () => (await page.$$("dialog .histo li")).length === 2, "historique chargé");
  assert.equal(await text(page, "dialog h2"), "Léa · ch. 214");
  assert.deepEqual(await tiles(page, "dialog"), [["Commandes", "2"], ["Total dépensé", "4,60 €"], ["Reste à payer", "3,50 €"]]);
  assert.equal(await text(page, "dialog .note"), "Prend le plus souvent : Oasis Tropical 33 cl (3), Kinder Bueno (1)");
  assert.ok((await text(page, "dialog")).includes("1 autre commande vient de la même chambre sous un autre prénom."));
});

test("produits : ajout avec image, recherche, modification, réassort, suppression", async () => {
  const { page } = await openAdmin(undefined, "#produits");
  await page.waitForSelector(".prod");
  assert.equal(await text(page, "#page-title"), "Produits");
  assert.ok(await page.isHidden("#search"), "pas de recherche pour 8 produits");
  assert.deepEqual(await page.$$eval("#products .day", els => els.map(e => e.textContent)), ["Boissons (3)", "Snacks (3)", "Formules (1)", "Autres (1)"]);
  assert.equal(await text(page, '.prod[data-id="bueno"] .prod-tag'), "Stock faible");
  assert.equal(await text(page, '.prod[data-id="icetea"] .prod-tag'), "Épuisé");

  // Ajout
  await page.click("#add-box summary");
  await page.fill("#ae", "🧃");
  await page.fill("#an", "Capri-Sun");
  await page.fill("#ap", "0.9");
  await page.fill("#as", "10");
  await page.selectOption("#ac", "Boissons");
  await page.setInputFiles("#ai", path.join(REPO, "icons", "icon-192.png"));
  await page.click("#add button");
  const added = await until(async () => (await emu.listDocs("products")).find(p => p.name === "Capri-Sun"), "produit ajouté");
  assert.equal(added.priceCents, 90);
  assert.equal(added.stock, 10);
  assert.equal(added.emoji, "🧃");
  assert.equal(added.category, "Boissons");
  assert.match(added.image, /^data:image\/jpeg;base64,/);
  assert.ok(added.image.length < 60000, "image réduite (" + added.image.length + " caractères)");
  assert.equal(await lastToast(page), "« Capri-Sun » ajouté à la boutique.");

  // Recherche (plus de 8 produits)
  await page.waitForSelector("#search:not([hidden])");
  await page.fill("#search", "kinder");
  assert.deepEqual(await page.$$eval("#products .prod", els => els.map(e => e.dataset.id)), ["bueno"]);
  await page.fill("#search", "");

  // Modification : seuls les champs changés sont envoyés
  await page.click('.prod[data-id="bueno"] summary');
  await page.fill('.prod[data-id="bueno"] [data-f="name"]', "Kinder Bueno White");
  await page.fill('.prod[data-id="bueno"] [data-f="price"]', "1.4");
  await page.click('.prod[data-id="bueno"] [data-p="save"]');
  await until(async () => (await emu.getDoc("products/bueno")).name === "Kinder Bueno White", "produit modifié");
  const { id, ...bueno } = await emu.getDoc("products/bueno");
  assert.deepEqual(bueno, { ...PRODUCTS.bueno, name: "Kinder Bueno White", priceCents: 140 });

  // Une saisie en cours n'est pas écrasée par une mise à jour venue d'ailleurs (une commande, par exemple)
  await page.fill('.prod[data-id="bueno"] [data-f="stock"]', "50");
  await emu.setDoc("products/bueno", { ...bueno, stock: 1, priceCents: 150 });
  await until(async () => (await page.inputValue('.prod[data-id="bueno"] [data-f="price"]')) === "1.50", "champ non modifié mis à jour");
  assert.equal(await page.inputValue('.prod[data-id="bueno"] [data-f="stock"]'), "50");
  await page.click('.prod[data-id="bueno"] [data-p="save"]');
  await until(async () => (await emu.getDoc("products/bueno")).stock === 50, "stock saisi enregistré");

  // Catégorie et badge s'enregistrent dès qu'on les change
  await page.selectOption('.prod[data-id="bueno"] [data-f="cat"]', "Formules");
  await page.selectOption('.prod[data-id="bueno"] [data-f="badge"]', "new");
  await until(async () => { const p = await emu.getDoc("products/bueno"); return p.category === "Formules" && p.badge === "new"; }, "catégorie et badge");

  // Réassort : la quantité s'ajoute au stock
  await page.click('.prod[data-id="chips"] summary');
  await page.click('.prod[data-id="chips"] [data-p="restock"]');
  await page.click('dialog [data-add="12"]');
  await page.click("#do-restock");
  await until(async () => (await emu.getDoc("products/chips")).stock === 32, "réassort");
  assert.equal(await lastToast(page), "12 ajoutés au stock de « Chips Lay's nature ».");

  // Retrait de l'image
  await page.click(`.prod[data-id="${added.id}"] summary`);
  await page.click(`.prod[data-id="${added.id}"] [data-p="noimg"]`);
  await until(async () => (await emu.getDoc("products/" + added.id)).image === "", "image retirée");

  // Suppression
  await page.click('.prod[data-id="mystere"] summary');
  await page.click('.prod[data-id="mystere"] [data-p="del"]');
  await confirmYes(page);
  await until(async () => (await emu.getDoc("products/mystere")) === null, "produit supprimé");
});

test("produits : saisies invalides refusées", async () => {
  const { page } = await openAdmin(undefined, "#produits");
  await page.waitForSelector(".prod");
  await page.click('.prod[data-id="coca"] summary');
  await page.fill('.prod[data-id="coca"] [data-f="name"]', "   ");
  await page.click('.prod[data-id="coca"] [data-p="save"]');
  assert.equal(await lastToast(page), "Le nom du produit ne peut pas être vide.");
  await page.fill('.prod[data-id="coca"] [data-f="name"]', "Coca-Cola 33 cl");
  await page.fill('.prod[data-id="coca"] [data-f="stock"]', "2.5");
  await page.click('.prod[data-id="coca"] [data-p="save"]');
  assert.equal(await lastToast(page), "Le stock doit être un nombre entier positif.");
  const { id, ...coca } = await emu.getDoc("products/coca");
  assert.deepEqual(coca, PRODUCTS.coca, "rien n'a été enregistré");
});

test("alerte stock faible : visible sur les commandes, mène aux produits", async () => {
  const { page } = await openAdmin();
  assert.equal(await until(() => text(page, "#lowstock"), "alerte"), "⚠️ Stock faible : Ice Tea Pêche 33 cl (épuisé) · Kinder Bueno (3)");
  await page.click("#lowstock");
  assert.ok(await page.isVisible("#tab-produits"));
  await emu.setDoc("products/icetea", { ...PRODUCTS.icetea, stock: 24 });
  await emu.setDoc("products/bueno", { ...PRODUCTS.bueno, stock: 24 });
  await until(() => page.isHidden("#lowstock"), "alerte disparue après réassort");
});

test("boutique : ouverture manuelle, horaires du jour, retour à l'automatique", async () => {
  const { page } = await openAdmin(undefined, "#boutique");
  await until(async () => (await text(page, "#shopinfo")) === "Ouvert jusqu'à 22:30", "état initial");
  assert.equal(await page.getAttribute("#m-auto", "aria-pressed"), "true");

  await page.click("#m-closed");
  await until(async () => (await text(page, "#shopinfo")) === "Fermé · prochaine ouverture demain à 17:30 (réglage manuel du jour)", "fermé");
  assert.deepEqual(await emu.getDoc("settings/shop"), { id: "shop", date: "2026-11-16", mode: "closed" });
  assert.equal(await page.getAttribute("#m-closed", "aria-pressed"), "true");

  await page.click("#m-open");
  await until(async () => (await emu.getDoc("settings/shop")).mode === "open", "ouvert");

  await page.fill("#cf", "21:00");
  await page.fill("#ct", "20:00");
  await page.click("#m-custom");
  assert.equal(await lastToast(page), "L'heure de fermeture doit être après l'heure d'ouverture.");
  assert.equal((await emu.getDoc("settings/shop")).mode, "open");
  await page.fill("#cf", "15:00");
  await page.fill("#ct", "23:15");
  await page.click("#m-custom");
  await until(async () => (await text(page, "#shopinfo")) === "Ouvert jusqu'à 23:15 (réglage manuel du jour)", "horaires du jour");
  assert.deepEqual(await emu.getDoc("settings/shop"), { id: "shop", date: "2026-11-16", mode: "custom", from: "15:00", to: "23:15" });

  await page.click("#m-auto");
  await until(async () => (await text(page, "#shopinfo")) === "Ouvert jusqu'à 22:30", "automatique");
  const week = "17:30 – 18:30, 19:00 – 22:30";
  assert.deepEqual(await page.$$eval("#schedule tr", rows => rows.map(r => [...r.cells].map(c => c.textContent))),
    [["lundi", week], ["mardi", week], ["mercredi", week], ["jeudi", week], ["vendredi", week], ["samedi", "Fermé"], ["dimanche", "20:00 – 22:30"]]);
});

test("bannière d'annonce : préremplie, enregistrée, jamais écrasée pendant la saisie", async () => {
  await emu.setDoc("settings/announce", { on: false, text: "Ancienne annonce" });
  const { page } = await openAdmin(undefined, "#boutique");
  await until(async () => (await page.inputValue("#an-text")) === "Ancienne annonce", "annonce préremplie");
  assert.equal(await page.isChecked("#an-on"), false);
  await page.fill("#an-text", "Nouveau : Oasis Pomme à 1,10 € !");
  await emu.setDoc("settings/announce", { on: false, text: "Modifiée ailleurs" });
  await page.waitForTimeout(400);
  assert.equal(await page.inputValue("#an-text"), "Nouveau : Oasis Pomme à 1,10 € !");
  await page.check("#an-on");
  await page.click("#an-save");
  await until(async () => (await emu.getDoc("settings/announce")).text === "Nouveau : Oasis Pomme à 1,10 € !", "annonce enregistrée");
  assert.equal((await emu.getDoc("settings/announce")).on, true);
  assert.equal(await lastToast(page), "Annonce affichée sur le site.");
});

test("sécurité : le contenu d'une commande s'affiche comme du texte", async () => {
  await emu.setDoc("orders/o12", { ...ORDERS.o1, name: `<img src=x onerror="window.__xss=1">`, room: `"><b>x</b>`, comment: "<script>window.__xss=2</script>", createdAt: ago(1) });
  const { page } = await openAdmin();
  await page.waitForSelector(card("o12"));
  assert.ok((await text(page, card("o12"))).includes(`<img src=x onerror="window.__xss=1"> · ch. "><b>x</b>`));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
});

test("onglets : adresse directe, retour arrière, son mémorisé", async () => {
  const { page } = await openAdmin(undefined, "#boutique");
  assert.ok(await page.isVisible("#tab-boutique"));
  assert.equal(await page.getAttribute('#tabs [data-tab="boutique"]', "aria-current"), "page");
  await tab(page, "produits");
  assert.ok(page.url().endsWith("#produits"));
  await tab(page, "commandes");
  assert.ok(await page.isVisible("#tab-commandes"));
  await tab(page, "boutique");
  await page.uncheck("#snd");
  await page.reload();
  await page.waitForSelector("#panel:not([hidden])");
  assert.equal(await page.isChecked("#snd"), false);
});
