// Tests unitaires des fonctions communes (js/core.js) : aucun navigateur, aucune base de données.
import test from "node:test";
import assert from "node:assert/strict";
import { esc, eur, toCents, plural, norm, slug, isTime, toMin, fromMin, todayKey, frDate, inMinutes, shopStatus, lastDelivery, groupByCategory, isLow, currentSeason } from "../js/core.js";
import { SCHEDULE, LAST_ORDER, LAST_DELIVERY, CATEGORIES, LOW_STOCK } from "../config.js";

// 16 novembre 2026 = lundi. Les dates sont construites en heure locale, comme le fait le site.
const at = (day, h, m = 0) => new Date(2026, 10, day, h, m);
const manual = (day, patch) => ({ date: todayKey(at(day, 12)), ...patch });

test("les réglages de la boutique ont la forme attendue", () => {
  assert.deepEqual(Object.keys(SCHEDULE).map(Number).sort(), [0, 1, 2, 3, 4, 5, 6]);
  for (const wins of Object.values(SCHEDULE)) for (const [a, b] of wins) assert.ok(isTime(a) && isTime(b) && a < b, `créneau invalide ${a}–${b}`);
  assert.ok(isTime(LAST_ORDER) && isTime(LAST_DELIVERY));
  assert.ok(Array.isArray(CATEGORIES) && CATEGORIES.length > 0);
  assert.ok(Number.isInteger(LOW_STOCK) && LOW_STOCK >= 0);
});

test("texte et montants", () => {
  assert.equal(esc(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
  assert.equal(esc(null), "");
  assert.equal(eur(350), "3,50 €");
  assert.equal(eur(0), "0,00 €");
  assert.equal(eur("n'importe quoi"), "0,00 €");
  assert.equal(toCents("1,10"), 110);
  assert.equal(toCents("1.1"), 110);
  assert.equal(toCents(" 12 "), 1200);
  assert.equal(toCents("0.29"), 29);
  assert.ok(Number.isNaN(toCents("")));
  assert.equal(plural(0, "article", "articles"), "0 article");
  assert.equal(plural(1, "article", "articles"), "1 article");
  assert.equal(plural(2, "article", "articles"), "2 articles");
  assert.equal(norm("  LÉA   Müller "), "lea muller");
  assert.equal(slug("Boissons fraîches & co"), "boissons-fraiches-co");
});

test("heures et dates", () => {
  assert.ok(isTime("00:00") && isTime("23:59") && isTime("07:05"));
  assert.ok(!isTime("24:00") && !isTime("7:05") && !isTime("12:60") && !isTime("") && !isTime(null) && !isTime("12:00:00"));
  assert.equal(toMin("22:30"), 1350);
  assert.equal(fromMin(1350), "22:30");
  assert.equal(fromMin(5), "00:05");
  assert.equal(todayKey(at(6, 9)), "2026-11-06");
  assert.equal(frDate("2026-11-06"), "06/11/2026");
  assert.equal(inMinutes(12), "dans 12 min");
  assert.equal(inMinutes(65), "dans 1 h 05");
});

test("ouverture : horaires habituels", () => {
  assert.deepEqual(shopStatus(null, at(16, 17, 0)), { open: false, mode: "auto", text: "Fermé · réouverture à 17:30" });
  assert.deepEqual(shopStatus(null, at(16, 17, 30)), { open: true, mode: "auto", text: "Ouvert jusqu'à 18:30", until: "18:30" });
  assert.equal(shopStatus(null, at(16, 18, 30)).text, "Fermé · réouverture à 19:00");
  assert.equal(shopStatus(null, at(16, 20, 0)).text, "Ouvert jusqu'à 22:30");
  assert.equal(shopStatus(null, at(16, 22, 29)).open, true);
  assert.equal(shopStatus(null, at(16, 22, 30)).text, "Fermé · prochaine ouverture demain à 17:30");
  // vendredi soir → samedi fermé → dimanche 20 h
  assert.equal(shopStatus(null, at(20, 23, 0)).text, "Fermé · prochaine ouverture dimanche à 20:00");
  assert.equal(shopStatus(null, at(21, 12, 0)).text, "Fermé · prochaine ouverture demain à 20:00");
  assert.equal(shopStatus(null, at(22, 19, 0)).text, "Fermé · réouverture à 20:00");
  assert.equal(shopStatus(null, at(22, 21, 0)).text, "Ouvert jusqu'à 22:30");
});

test("ouverture : réglage manuel du jour", () => {
  assert.deepEqual(shopStatus(manual(16, { mode: "open" }), at(16, 10)), { open: true, mode: "open", text: "Ouvert jusqu'à 22:30", until: "22:30" });
  assert.equal(shopStatus(manual(16, { mode: "open" }), at(16, 22, 45)).open, false);
  assert.deepEqual(shopStatus(manual(16, { mode: "closed" }), at(16, 20)), { open: false, mode: "closed", text: "Fermé · prochaine ouverture demain à 17:30" });
  assert.equal(shopStatus(manual(16, { mode: "custom", from: "15:00", to: "16:00" }), at(16, 15, 30)).text, "Ouvert jusqu'à 16:00");
  assert.equal(shopStatus(manual(16, { mode: "custom", from: "15:00", to: "16:00" }), at(16, 14)).text, "Fermé · réouverture à 15:00");
  assert.equal(shopStatus(manual(16, { mode: "custom", from: "15:00", to: "16:00" }), at(16, 20)).open, false);
  assert.equal(shopStatus(manual(16, { mode: "auto" }), at(16, 20)).mode, "auto");
});

test("ouverture : un réglage manuel périmé ou incomplet est ignoré", () => {
  assert.equal(shopStatus(manual(15, { mode: "closed" }), at(16, 20)).open, true);        // réglage de la veille
  assert.equal(shopStatus(manual(16, { mode: "custom" }), at(16, 20)).mode, "auto");       // sans heures
  assert.equal(shopStatus(manual(16, { mode: "custom", from: "x", to: "25:00" }), at(16, 20)).open, true);
  assert.equal(shopStatus(manual(16, { mode: "n'importe quoi" }), at(16, 20)).mode, "auto");
  assert.equal(shopStatus({}, at(16, 20)).open, true);
});

test("heure limite de livraison", () => {
  assert.equal(lastDelivery(shopStatus(null, at(16, 20))), "23:00");
  assert.equal(lastDelivery(shopStatus(null, at(16, 12))), "23:00");
  assert.equal(lastDelivery(null), "23:00");
  // ouverture exceptionnelle tardive : 30 min après la fermeture, sans dépasser minuit
  assert.equal(lastDelivery(shopStatus(manual(16, { mode: "custom", from: "20:00", to: "22:45" }), at(16, 21))), "23:15");
  assert.equal(lastDelivery(shopStatus(manual(16, { mode: "custom", from: "20:00", to: "23:50" }), at(16, 21))), "23:59");
});

test("produits : catégories et stock faible", () => {
  const groups = groupByCategory([
    { id: "a", name: "zeste", category: "Snacks" },
    { id: "b", name: "Éclair", category: "Snacks" },
    { id: "c", name: "eau 2", category: "Boissons" },
    { id: "d", name: "Eau 10", category: "Boissons" },
    { id: "e", name: "Truc", category: "Inconnue" },
    { id: "f", name: "Machin" }
  ]);
  assert.deepEqual(groups.map(g => g.name), ["Boissons", "Snacks", "Autres"]);
  assert.deepEqual(groups.map(g => g.id), ["cat-boissons", "cat-snacks", "cat-autres"]);
  assert.deepEqual(groups[0].list.map(p => p.id), ["c", "d"]);    // « eau 2 » avant « Eau 10 »
  assert.deepEqual(groups[1].list.map(p => p.id), ["b", "a"]);    // « Éclair » avant « zeste »
  assert.deepEqual(groups[2].list.map(p => p.id), ["f", "e"]);
  assert.deepEqual(groupByCategory([]), []);
  assert.equal(isLow({ stock: LOW_STOCK }), LOW_STOCK > 0);
  assert.equal(isLow({ stock: LOW_STOCK + 1 }), false);
  assert.equal(isLow({ stock: 0 }), false);                         // épuisé n'est pas « faible »
});

test("thème de saison", () => {
  const d = (m, day) => new Date(2026, m - 1, day);
  assert.equal(currentSeason(d(12, 1), "auto"), "noel");
  assert.equal(currentSeason(d(12, 31), "auto"), "noel");
  assert.equal(currentSeason(d(11, 30), "auto"), "");
  assert.equal(currentSeason(d(1, 1), "auto"), "");
  assert.equal(currentSeason(d(10, 31), "auto"), "halloween");
  assert.equal(currentSeason(d(10, 23), "auto"), "");
  assert.equal(currentSeason(d(6, 20), "auto"), "ete");
  assert.equal(currentSeason(d(7, 7), "auto"), "");
  assert.equal(currentSeason(d(3, 3), "noel"), "noel");
  assert.equal(currentSeason(d(12, 25), "aucun"), "");
  assert.equal(currentSeason(d(12, 25), "valeur inconnue"), "");
});
