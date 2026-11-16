// Jeu de données de démonstration (produits fictifs) utilisé par les tests.
const emu = require("./emulator.cjs");

const ADMIN = { email: "admin@khollation.test", password: "motdepasse-de-test" };

// Même forme que les documents créés par l'admin : { emoji, name, priceCents, stock, image, category, badge? }
const PRODUCTS = {
  oasis: { emoji: "🧃", name: "Oasis Tropical 33 cl", priceCents: 110, stock: 12, image: "", category: "Boissons", badge: "new" },
  coca: { emoji: "🥤", name: "Coca-Cola 33 cl", priceCents: 120, stock: 8, image: "", category: "Boissons" },
  icetea: { emoji: "🍑", name: "Ice Tea Pêche 33 cl", priceCents: 110, stock: 0, image: "", category: "Boissons" },
  bueno: { emoji: "🍫", name: "Kinder Bueno", priceCents: 130, stock: 3, image: "", category: "Snacks", badge: "promo" },
  chips: { emoji: "🥔", name: "Chips Lay's nature", priceCents: 120, stock: 20, image: "", category: "Snacks" },
  tagada: { emoji: "🍓", name: "Haribo Tagada", priceCents: 150, stock: 6, image: "", category: "Snacks" },
  formule: { emoji: "📚", name: "Formule Révisions", priceCents: 200, stock: 5, image: "", category: "Formules" },
  mystere: { emoji: "🎁", name: "Sachet surprise", priceCents: 90, stock: 4, image: "" } // sans catégorie → « Autres »
};

async function seed({ products = PRODUCTS, admin = true, settings = {} } = {}) {
  await Promise.all(Object.entries(products).map(([id, p]) => emu.setDoc("products/" + id, p)));
  await Promise.all(Object.entries(settings).map(([id, s]) => emu.setDoc("settings/" + id, s)));
  if (admin) await emu.createUser(ADMIN.email, ADMIN.password);
}

module.exports = { ADMIN, PRODUCTS, seed };
