// Tests de bout en bout de la boutique (index.html) : vrai navigateur, vrai SDK Firebase, émulateurs.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { startSite, until, text, cutLiveUpdates } = require("./lib/harness.cjs");
const { seed, PRODUCTS } = require("./lib/fixtures.cjs");
const emu = require("./lib/emulator.cjs");

let site;
before(async () => { site = await startSite(); });
after(async () => { await site.close(); });
beforeEach(async () => { await emu.reset(); await seed(); });

const add = name => `button[aria-label="Ajouter un ${name}"]`;
const remove = name => `button[aria-label="Retirer un ${name}"]`;

async function openShop(options) {
  const ctx = await site.newContext(options);
  const page = await ctx.newPage();
  await page.goto(site.url);
  await page.waitForSelector(".item");
  return { ctx, page };
}

/** Remplit le panier et le formulaire, puis envoie la commande. */
async function order(page, { items = [["Oasis Tropical 33 cl", 2], ["Kinder Bueno", 1]], name = "Léa", room = "214", time = "20:30", comment = "", wero = false } = {}) {
  for (const [product, qty] of items) for (let i = 0; i < qty; i++) await page.click(add(product));
  await page.click("#open");
  await page.fill("#name", name);
  await page.fill("#room", room);
  await page.fill("#time", time);
  await page.fill("#comment", comment);
  if (wero) await page.check('input[value="wero"]');
  await page.click("#send");
}

test("catalogue : catégories, ordre, badges et stock", async () => {
  const { ctx, page } = await openShop();
  assert.deepEqual(await page.$$eval(".cat-title", els => els.map(e => e.textContent)), ["Boissons", "Snacks", "Formules", "Autres"]);
  assert.deepEqual(await page.$$eval("#cat-boissons .item", els => els.map(e => e.dataset.id)), ["coca", "icetea", "oasis"]);
  assert.deepEqual(await page.$$eval("#cats .chip", els => els.map(e => e.textContent)), ["Boissons", "Snacks", "Formules", "Autres"]);

  assert.equal(await text(page, '.item[data-id="oasis"] .price'), "1,10 €");
  assert.equal(await text(page, '.item[data-id="oasis"] .stock'), "12 en stock");
  assert.equal(await text(page, '.item[data-id="oasis"] .badge'), "Nouveau");
  assert.equal(await text(page, '.item[data-id="bueno"] .badge'), "Promo");
  assert.equal(await text(page, '.item[data-id="bueno"] .stock.low'), "Plus que 3 en stock");
  assert.equal(await text(page, '.item[data-id="icetea"] .stock'), "Épuisé");
  assert.ok(await page.isHidden('.item[data-id="icetea"] .step'), "pas de bouton d'ajout sur un produit épuisé");

  await until(async () => (await text(page, "#shopstatus")) === "Ouvert jusqu'à 22:30", "état d'ouverture");
  assert.ok(await page.isHidden("#announce"));
  assert.deepEqual(ctx.errors, []);
});

test("bannière d'annonce : affichée, modifiée puis masquée en direct", async () => {
  const { page } = await openShop();
  await emu.setDoc("settings/announce", { on: true, text: "Nouveau : Oasis Pomme à 1,10 € !" });
  await until(async () => (await page.isVisible("#announce")) && (await text(page, "#announce")) === "📣 Nouveau : Oasis Pomme à 1,10 € !", "annonce visible");
  await emu.setDoc("settings/announce", { on: false, text: "Nouveau : Oasis Pomme à 1,10 € !" });
  await until(() => page.isHidden("#announce"), "annonce masquée");
});

test("panier : ajout, retrait, plafond au stock, conservation après rechargement", async () => {
  const { page } = await openShop();
  assert.equal(await text(page, "#count"), "0 article");
  assert.ok(await page.isDisabled("#open"));
  for (let i = 0; i < 3; i++) await page.click(add("Kinder Bueno"));
  assert.ok(await page.isDisabled(add("Kinder Bueno")), "impossible de dépasser le stock (3)");
  assert.equal(await text(page, "#count"), "3 articles");
  assert.equal(await text(page, "#total"), "3,90 €");
  await page.click(remove("Kinder Bueno"));
  await page.click(add("Coca-Cola 33 cl"));
  assert.equal(await text(page, "#count"), "3 articles");
  assert.equal(await text(page, "#total"), "3,80 €");
  assert.ok(await page.isEnabled("#open"));

  await page.reload();
  await page.waitForSelector(".item");
  await until(async () => (await text(page, "#total")) === "3,80 €", "panier retrouvé après rechargement");
  assert.equal(await text(page, '.item[data-id="bueno"] .qty'), "2");

  // Le stock baisse ailleurs : le panier s'ajuste tout seul et le signale.
  await emu.setDoc("products/bueno", { ...PRODUCTS.bueno, stock: 1 });
  await until(async () => (await text(page, '.item[data-id="bueno"] .qty')) === "1", "quantité plafonnée au nouveau stock");
  await until(async () => (await text(page, ".toast")).includes("Ton panier a été ajusté"), "message d'ajustement");
  // Un produit supprimé quitte le panier.
  await emu.deleteDoc("products/coca");
  await until(async () => (await text(page, "#total")) === "1,30 €", "produit supprimé retiré du panier");
});

test("commande : document enregistré, stock, notification et confirmation", async () => {
  const { ctx, page } = await openShop();
  await order(page, { comment: "Frappe fort stp", wero: true });
  await page.waitForSelector("#done:not([hidden])");

  const orders = await emu.listDocs("orders");
  assert.equal(orders.length, 1);
  const { id, createdAt, ...doc } = orders[0];
  assert.deepEqual(doc, {
    name: "Léa", room: "214", payment: "wero",
    items: [{ id: "oasis", name: "Oasis Tropical 33 cl", priceCents: 110, qty: 2 }, { id: "bueno", name: "Kinder Bueno", priceCents: 130, qty: 1 }],
    totalCents: 350, status: "nouvelle", paid: false, deliveryTime: "20:30", comment: "Frappe fort stp"
  });
  assert.ok(createdAt instanceof Date && Math.abs(Date.now() - createdAt.getTime()) < 60000, "date posée par le serveur");
  assert.equal((await emu.getDoc("products/oasis")).stock, 10);
  assert.equal((await emu.getDoc("products/bueno")).stock, 2);
  assert.deepEqual(Object.keys(await emu.getDoc("products/oasis")).sort(), ["badge", "category", "emoji", "id", "image", "name", "priceCents", "stock"], "seul le stock du produit est modifié");

  assert.deepEqual(ctx.ntfy, [{
    topic: "khollation-13a10g", title: "Nouvelle commande 🛎️", message: "3 articles · 3,50 € · livraison vers 20:30",
    priority: 4, tags: ["shopping_cart"], click: site.url + "admin.html"
  }]);

  const done = await text(page, "#done");
  for (const part of ["Commande envoyée", "Livraison prévue dans 30 min", "2 × Oasis Tropical 33 cl", "Total à payer", "3,50 €", "scanne le QR code Wero", "Livraison dans ta chambre (214) vers 20:30"]) assert.ok(done.includes(part), `confirmation : « ${part} » absent de « ${done} »`);
  await page.click("#ok");
  assert.equal(await text(page, "#count"), "0 article");
  assert.equal(await text(page, '.item[data-id="oasis"] .stock'), "10 en stock");

  // Prénom et chambre sont retenus pour la prochaine fois.
  await page.click(add("Coca-Cola 33 cl"));
  await page.click("#open");
  assert.equal(await page.inputValue("#name"), "Léa");
  assert.equal(await page.inputValue("#room"), "214");
  assert.equal(await page.inputValue("#comment"), "");
  assert.ok(await page.isChecked('input[value="especes"]'), "paiement par défaut : espèces");
  assert.deepEqual(ctx.errors, []);
});

test("commande en espèces : texte de confirmation", async () => {
  const { page } = await openShop();
  await order(page, { items: [["Coca-Cola 33 cl", 1]] });
  await page.waitForSelector("#done:not([hidden])");
  assert.ok((await text(page, "#done")).includes("Prépare ton paiement en espèces, de préférence l'appoint."));
  assert.equal((await emu.listDocs("orders"))[0].payment, "especes");
});

test("commande : raccourcis d'heure et contrôles du formulaire", async () => {
  const { page } = await openShop();
  await page.click(add("Coca-Cola 33 cl"));
  await page.click("#open");
  assert.deepEqual(await page.$$eval("#quick .chip", els => els.map(e => [e.textContent, e.dataset.time])),
    [["Dès que possible", "20:05"], ["+ 15 min", "20:15"], ["+ 30 min", "20:30"], ["+ 1 h", "21:00"]]);
  assert.equal(await page.getAttribute("#time", "min"), "20:00");
  assert.equal(await page.getAttribute("#time", "max"), "23:00");
  await page.click('#quick .chip[data-time="20:15"]');
  assert.equal(await page.inputValue("#time"), "20:15");
  assert.equal(await page.getAttribute('#quick .chip[data-time="20:15"]', "aria-pressed"), "true");

  // On désactive le contrôle intégré du navigateur pour vérifier celui du site.
  await page.evaluate(() => { document.querySelector("#form").noValidate = true; });
  const submit = async fields => {
    for (const [sel, value] of Object.entries(fields)) await page.fill(sel, value);
    await page.click("#send");
    return until(async () => await text(page, "#err"), "message d'erreur");
  };
  assert.equal(await submit({ "#name": "   ", "#room": "214", "#time": "20:30" }), "Indique ton prénom et ta chambre.");
  assert.equal(await submit({ "#name": "Léa", "#time": "19:30" }), "Choisis une heure de livraison entre maintenant et 23:00.");
  assert.equal(await submit({ "#time": "23:30" }), "Choisis une heure de livraison entre maintenant et 23:00.");
  assert.equal(await submit({ "#time": "" }), "Choisis une heure de livraison entre maintenant et 23:00.");
  assert.equal((await emu.listDocs("orders")).length, 0, "aucune commande invalide n'est enregistrée");
});

test("boutique fermée : commande impossible, puis ouverture manuelle en direct", async () => {
  const { page } = await openShop({ time: "2026-11-16T12:00:00+01:00" });
  await until(async () => (await text(page, "#shopstatus")) === "Fermé · réouverture à 17:30", "état fermé");
  await page.click(add("Coca-Cola 33 cl"));
  assert.equal(await text(page, "#open"), "Fermé");
  assert.ok(await page.isDisabled("#open"));

  await emu.setDoc("settings/shop", { date: "2026-11-16", mode: "open" });
  await until(async () => (await text(page, "#shopstatus")) === "Ouvert jusqu'à 22:30", "ouverture manuelle");
  assert.equal(await text(page, "#open"), "Commander");
  assert.ok(await page.isEnabled("#open"));

  await emu.setDoc("settings/shop", { date: "2026-11-16", mode: "closed" });
  await until(async () => (await text(page, "#shopstatus")) === "Fermé · prochaine ouverture demain à 17:30", "fermeture manuelle");
  assert.ok(await page.isDisabled("#open"));

  // Un réglage de la veille ne compte plus.
  await emu.setDoc("settings/shop", { date: "2026-11-15", mode: "open" });
  await until(async () => (await text(page, "#shopstatus")) === "Fermé · réouverture à 17:30", "réglage périmé ignoré");
});

test("fermeture pendant la saisie : la commande est refusée à l'envoi", async () => {
  const { page } = await openShop();
  await page.click(add("Coca-Cola 33 cl"));
  await page.click("#open");
  await page.fill("#name", "Léa");
  await page.fill("#room", "214");
  await page.fill("#time", "20:30");
  await emu.setDoc("settings/shop", { date: "2026-11-16", mode: "closed" });
  await until(async () => (await text(page, "#shopstatus")).startsWith("Fermé"), "fermeture reçue");
  await page.click("#send");
  assert.equal(await until(async () => await text(page, "#err"), "message d'erreur"), "La boutique est fermée pour le moment.");
  assert.equal((await emu.listDocs("orders")).length, 0);
});

test("stock épuisé entre-temps : la base refuse la commande et rien n'est débité", async () => {
  const { ctx, page } = await openShop();
  for (let i = 0; i < 3; i++) await page.click(add("Kinder Bueno"));
  await page.click(add("Coca-Cola 33 cl"));
  await cutLiveUpdates(ctx);                                   // la page ne reçoit plus les mises à jour
  await emu.setDoc("products/bueno", { ...PRODUCTS.bueno, stock: 2 });
  await page.click("#open");
  await page.fill("#name", "Léa");
  await page.fill("#room", "214");
  await page.fill("#time", "20:30");
  await page.click("#send");
  assert.equal(await until(async () => await text(page, "#err"), "message d'erreur", 20000),
    "Désolé, « Kinder Bueno » vient d'être épuisé ou n'a plus assez de stock. Vérifie ton panier.");
  assert.equal((await emu.listDocs("orders")).length, 0);
  assert.equal((await emu.getDoc("products/bueno")).stock, 2);
  assert.equal((await emu.getDoc("products/coca")).stock, 8, "aucun produit n'est débité quand la commande échoue");
  assert.deepEqual(ctx.ntfy, []);
});

test("prix modifié entre-temps : la commande est refusée avec une explication", async () => {
  const { ctx, page } = await openShop();
  await page.click(add("Coca-Cola 33 cl"));
  await cutLiveUpdates(ctx);
  await emu.setDoc("products/coca", { ...PRODUCTS.coca, priceCents: 150 });
  await page.click("#open");
  await page.fill("#name", "Léa");
  await page.fill("#room", "214");
  await page.fill("#time", "20:30");
  await page.click("#send");
  assert.equal(await until(async () => await text(page, "#err"), "message d'erreur", 20000),
    "Le prix de « Coca-Cola 33 cl » vient de changer. Vérifie ton panier avant de renvoyer.");
  assert.equal((await emu.listDocs("orders")).length, 0);
  assert.equal((await emu.getDoc("products/coca")).stock, 8);
});

test("alerte stock faible : une notification quand un produit passe sous le seuil ou tombe à zéro", async () => {
  const { ctx, page } = await openShop();
  await order(page, { items: [["Haribo Tagada", 3], ["Kinder Bueno", 3], ["Chips Lay's nature", 2]] });   // 6→3, 3→0, 20→18
  await page.waitForSelector("#done:not([hidden])");
  await until(() => ctx.ntfy.length === 2, "deux notifications");
  assert.equal(ctx.ntfy[0].title, "Nouvelle commande 🛎️");
  assert.deepEqual(ctx.ntfy[1], {
    topic: "khollation-13a10g", title: "Stock faible ⚠️", message: "Haribo Tagada : plus que 3 · Kinder Bueno : épuisé",
    priority: 3, tags: ["warning"], click: site.url + "admin.html#produits"
  });
});

test("« Ta commande » : rappel, compte à rebours, suivi en direct, masquage", async () => {
  const { ctx, page } = await openShop();
  await order(page);
  await page.waitForSelector("#done:not([hidden])");
  await page.click("#ok");
  assert.ok(await page.isVisible("#myorder"));
  assert.equal(await text(page, "#myorder-title"), "Ta commande · 3,50 €");
  assert.equal(await text(page, "#myorder-sub"), "Livraison prévue dans 30 min");

  await page.reload();
  await page.waitForSelector(".item");
  assert.equal(await text(page, "#myorder-sub"), "Livraison prévue dans 30 min", "le rappel survit au rechargement");

  const tick = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await ctx.clock.setFixedTime(new Date("2026-11-16T20:28:00+01:00"));
  await tick();
  assert.equal(await text(page, "#myorder-sub"), "Livraison prévue dans 2 min");
  await ctx.clock.setFixedTime(new Date("2026-11-16T20:35:00+01:00"));
  await tick();
  assert.equal(await text(page, "#myorder-sub"), "Livraison d'un instant à l'autre");

  // L'admin valide puis livre : le client le voit sans recharger (si la base autorise cette lecture).
  const [o] = await emu.listDocs("orders");
  const { id, ...data } = o;
  await page.click("#myorder");
  await emu.setDoc("orders/" + id, { ...data, status: "validée" });
  await until(async () => (await text(page, "#live")) === "Commande validée, en préparation", "statut validé");
  await emu.setDoc("orders/" + id, { ...data, status: "livrée" });
  await until(async () => (await text(page, "#countdown")) === "Commande livrée 🎉", "statut livré");
  assert.equal(await text(page, "#done-title"), "Ta commande");

  await page.click("#forget");
  assert.ok(await page.isHidden("#myorder"));
  await page.reload();
  await page.waitForSelector(".item");
  assert.ok(await page.isHidden("#myorder"), "le rappel masqué ne revient pas");
});

test("le rappel « Ta commande » disparaît le lendemain", async () => {
  const { ctx, page } = await openShop();
  await order(page);
  await page.waitForSelector("#done:not([hidden])");
  await ctx.clock.setFixedTime(new Date("2026-11-17T08:00:00+01:00"));
  await page.reload();
  await page.waitForSelector(".item");
  assert.ok(await page.isHidden("#myorder"));
});

test("sécurité : un nom de produit ou une annonce contenant du HTML s'affiche comme du texte", async () => {
  await emu.setDoc("products/piege", { emoji: "<b>x</b>", name: `<img src=x onerror="window.__xss=1">`, priceCents: 100, stock: 5, image: `x" onerror="window.__xss=2`, category: "Snacks", badge: `"><script>window.__xss=3</script>` });
  await emu.setDoc("settings/announce", { on: true, text: `<img src=x onerror="window.__xss=4">` });
  const { page } = await openShop();
  await until(() => page.isVisible("#announce"), "annonce");
  assert.equal(await text(page, '.item[data-id="piege"] .name'), `<img src=x onerror="window.__xss=1">`);
  await page.click('.item[data-id="piege"] .plus');
  await page.click("#open");
  assert.ok((await text(page, "#recap")).includes(`1 × <img src=x onerror="window.__xss=1">`));
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__xss), undefined, "aucun script injecté ne s'exécute");
});

test("thème : bascule clair / sombre mémorisée", async () => {
  const { page } = await openShop();
  assert.equal(await page.getAttribute("html", "data-theme"), "light");
  await page.click("#theme");
  assert.equal(await page.getAttribute("html", "data-theme"), "dark");
  assert.equal(await page.getAttribute('meta[name="theme-color"]', "content"), "#0E1626");
  await page.reload();
  await page.waitForSelector(".item");
  assert.equal(await page.getAttribute("html", "data-theme"), "dark");
  assert.equal(await page.getAttribute("#theme", "aria-label"), "Passer au thème clair");

  const { page: dark } = await openShop({ colorScheme: "dark" });
  assert.equal(await dark.getAttribute("html", "data-theme"), "dark", "suit le réglage du téléphone par défaut");
});

test("thème de saison : appliqué en décembre, absent en novembre", async () => {
  const { page } = await openShop();
  assert.equal(await page.getAttribute("html", "data-season"), null);
  const { page: december } = await openShop({ time: "2026-12-10T20:00:00+01:00" });
  assert.equal(await december.getAttribute("html", "data-season"), "noel");
});

test("copie locale du catalogue : les produits s'affichent même si la base ne répond pas", async () => {
  const { ctx, page } = await openShop();
  await until(() => page.evaluate(() => !!localStorage.getItem("kh_products")), "copie locale enregistrée");
  await ctx.route(url => url.host === "127.0.0.1:8080", route => route.abort());   // base de données injoignable
  await page.reload();
  await page.waitForSelector(".item");
  assert.equal(await page.$$eval(".item", els => els.length), Object.keys(PRODUCTS).length);
  assert.equal(await text(page, '.item[data-id="oasis"] .stock'), "12 en stock");
});

test("aucun produit : message d'accueil plutôt qu'une page vide", async () => {
  await emu.reset();
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url);
  await until(async () => (await text(page, "#list")).includes("Aucun produit pour le moment"), "message « aucun produit »");
});
