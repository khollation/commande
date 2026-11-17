// Tests des règles de sécurité recommandées (firestore.rules) : ce qu'un client, un inconnu
// connecté et l'admin ont le droit de faire. Les essais passent par le vrai SDK, depuis le navigateur.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { startSite, signIn } = require("./lib/harness.cjs");
const { seed, PRODUCTS, ADMIN } = require("./lib/fixtures.cjs");
const emu = require("./lib/emulator.cjs");

let site;
before(async () => { site = await startSite(); });
after(async () => { await site.close(); });
beforeEach(async () => {
  await emu.reset({ rules: emu.recommendedRules(ADMIN.email) });
  await seed();
  await emu.setDoc("orders/existante", { name: "Léa", room: "214", payment: "wero", items: [{ id: "coca", name: "Coca-Cola 33 cl", priceCents: 120, qty: 1 }], totalCents: 120, status: "nouvelle", paid: false, deliveryTime: "20:30", comment: "", createdAt: new Date() });
  await emu.setDoc("expenses/x1", { date: "2026-11-16", label: "Cartons", amountCents: 1000 });
});

/**
 * Exécute une série d'essais dans la page, avec le SDK Firebase du site.
 * Chaque essai renvoie "ok" ou le code d'erreur (« permission-denied » si les règles refusent).
 */
async function attempts(page, names) {
  return page.evaluate(async names => {
    const f = await import("./js/firebase.js");
    const { db, doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp } = f;
    const order = extra => ({ name: "Léa", room: "214", payment: "especes", items: [{ id: "coca", name: "Coca-Cola 33 cl", priceCents: 120, qty: 1 }], totalCents: 120, status: "nouvelle", paid: false, deliveryTime: "20:30", comment: "", createdAt: serverTimestamp(), ...extra });
    const all = {
      "lire les produits": () => getDocs(collection(db, "products")),
      "lire l'ouverture": () => getDoc(doc(db, "settings", "shop")),
      "baisser un stock": () => updateDoc(doc(db, "products", "coca"), { stock: 7 }),
      "monter un stock": () => updateDoc(doc(db, "products", "coca"), { stock: 999 }),
      "stock négatif": () => updateDoc(doc(db, "products", "coca"), { stock: -1 }),
      "changer un prix": () => updateDoc(doc(db, "products", "coca"), { priceCents: 1 }),
      "baisser un stock et renommer": () => updateDoc(doc(db, "products", "coca"), { stock: 6, name: "Gratuit" }),
      "créer un produit": () => setDoc(doc(db, "products", "pirate"), { name: "x", priceCents: 0, stock: 1 }),
      "supprimer un produit": () => deleteDoc(doc(db, "products", "coca")),
      "passer une commande": () => addDoc(collection(db, "orders"), order()),
      "commande déjà payée": () => addDoc(collection(db, "orders"), order({ paid: true })),
      "commande déjà livrée": () => addDoc(collection(db, "orders"), order({ status: "livrée" })),
      "commande antidatée": () => addDoc(collection(db, "orders"), order({ createdAt: new Date(2020, 0, 1) })),
      "commande avec un champ en plus": () => addDoc(collection(db, "orders"), order({ admin: true })),
      "commande sans article": () => addDoc(collection(db, "orders"), order({ items: [] })),
      "commande au prénom trop long": () => addDoc(collection(db, "orders"), order({ name: "x".repeat(31) })),
      "suivre sa commande": () => getDoc(doc(db, "orders", "existante")),
      "lister les commandes": () => getDocs(collection(db, "orders")),
      "marquer une commande payée": () => updateDoc(doc(db, "orders", "existante"), { paid: true }),
      "supprimer une commande": () => deleteDoc(doc(db, "orders", "existante")),
      "ouvrir la boutique": () => setDoc(doc(db, "settings", "shop"), { date: "2026-11-16", mode: "open" }),
      "changer l'annonce": () => setDoc(doc(db, "settings", "announce"), { on: true, text: "pirate" }),
      "lire les dépenses": () => getDocs(collection(db, "expenses")),
      "ajouter une dépense": () => addDoc(collection(db, "expenses"), { date: "2026-11-16", label: "x", amountCents: 1 })
    };
    const out = {};
    for (const name of names) {
      try { await all[name](); out[name] = "ok"; }
      catch (err) { out[name] = err.code || String(err); }
    }
    return out;
  }, names);
}

const CLIENT_ALLOWED = ["lire les produits", "lire l'ouverture", "baisser un stock", "passer une commande", "suivre sa commande"];
const CLIENT_DENIED = ["monter un stock", "stock négatif", "changer un prix", "baisser un stock et renommer", "créer un produit", "supprimer un produit",
  "commande déjà payée", "commande déjà livrée", "commande antidatée", "commande avec un champ en plus", "commande sans article", "commande au prénom trop long",
  "lister les commandes", "marquer une commande payée", "supprimer une commande", "ouvrir la boutique", "changer l'annonce", "lire les dépenses", "ajouter une dépense"];
const expect = (allowed, denied) => Object.fromEntries([...allowed.map(n => [n, "ok"]), ...denied.map(n => [n, "permission-denied"])]);

test("client de la boutique (sans compte) : peut commander, rien de plus", async () => {
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url);
  await page.waitForSelector(".item");
  assert.deepEqual(await attempts(page, [...CLIENT_ALLOWED, ...CLIENT_DENIED]), expect(CLIENT_ALLOWED, CLIENT_DENIED));
  const { id, ...coca } = await emu.getDoc("products/coca");
  assert.deepEqual(coca, { ...PRODUCTS.coca, stock: 7 }, "seule la baisse de stock autorisée a eu lieu");
  assert.equal((await emu.getDoc("settings/shop")), null);
});

test("inconnu qui s'est créé un compte : aucun droit d'admin", async () => {
  await emu.createUser("pirate@exemple.com", "motdepasse-pirate");
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url + "admin.html");
  await signIn(page, { email: "pirate@exemple.com", password: "motdepasse-pirate" });
  await page.waitForSelector("#panel:not([hidden])");
  const denied = ["lister les commandes", "marquer une commande payée", "changer un prix", "créer un produit", "ouvrir la boutique", "changer l'annonce", "lire les dépenses", "ajouter une dépense"];
  assert.deepEqual(await attempts(page, denied), expect([], denied));
});

test("admin : tous les droits", async () => {
  const ctx = await site.newContext();
  const page = await ctx.newPage();
  await page.goto(site.url + "admin.html");
  await signIn(page);
  await page.waitForSelector("#panel:not([hidden])");
  const allowed = ["lister les commandes", "marquer une commande payée", "changer un prix", "monter un stock", "créer un produit", "ouvrir la boutique", "changer l'annonce", "lire les dépenses", "ajouter une dépense", "supprimer une commande"];
  assert.deepEqual(await attempts(page, allowed), expect(allowed, []));
});
