// Régénère toutes les icônes de l'application à partir du logo vectoriel icons/mark.svg.
//
//   node tools/make-icons.cjs
//
// Nécessite Node.js et Playwright (Chromium). À relancer seulement si le logo ou les couleurs changent.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(ROOT, "icons", "mark.svg"), "utf8");
const d = id => svg.match(new RegExp(`id="${id}"[^>]* d="([^"]+)"`))[1];
const SIGMA = d("sigma"), CRUMBS = d("miettes");
const font = fs.readFileSync(path.join(ROOT, "fonts", "bricolage-grotesque-latin.woff2")).toString("base64");

// Palettes : boutique (logo d'origine sur fond clair), admin (inversé sur fond bleu nuit), sombre (écran de démarrage).
const SHOP = { bg: "#F5F7FA", sigma: "#12305A", crumbs: "#8F5E2E" };
const ADMIN = { bg: "#12305A", sigma: "#F5F7FA", crumbs: "#FFD23F" };
const DARK = { bg: "#0E1626", sigma: "#E8EEF8", crumbs: "#C98F52" };

const mark = (c, pct) => `<svg viewBox="0 0 100 100" style="width:${pct}%;height:${pct}%"><path fill="${c.sigma}" d="${SIGMA}"/><path fill="${c.crumbs}" d="${CRUMBS}"/></svg>`;

// scale : part de la largeur occupée par le logo. radius : arrondi des coins (en %), 0 = plein cadre.
function tile(c, { scale = 62, radius = 0, bg = true, border = false } = {}) {
  return `<div style="width:100vw;height:100vh;display:grid;place-items:center;box-sizing:border-box;
    ${bg ? `background:${c.bg};` : ""}border-radius:${radius}%;${border ? "box-shadow:inset 0 0 0 1px rgba(18,48,90,.10);" : ""}">${mark(c, scale)}</div>`;
}

const og = `<div style="width:100vw;height:100vh;background:${SHOP.bg};display:flex;align-items:center;gap:64px;padding:0 96px;box-sizing:border-box;color:${SHOP.sigma};font-family:Brico,sans-serif">
  <div style="width:330px;height:330px;flex:none;display:grid;place-items:center">${mark(SHOP, 100)}</div>
  <div><div style="font-size:108px;font-weight:800;letter-spacing:-.02em;line-height:1">La Khôllation</div>
  <div style="font-size:44px;font-weight:500;color:#5A6B85;margin-top:22px;line-height:1.25">Snacks et boissons, livrés dans ta chambre.</div>
  <div style="display:inline-block;margin-top:38px;background:#FFD23F;font-size:40px;font-weight:800;padding:10px 26px;border-radius:12px;transform:rotate(-2deg)">Commande en ligne</div></div></div>`;

// [fichier, largeur, hauteur, contenu, fond transparent ?]
const JOBS = [
  ["icons/icon-192.png", 192, 192, tile(SHOP, { radius: 22, border: true }), true],
  ["icons/icon-512.png", 512, 512, tile(SHOP, { radius: 22, border: true }), true],
  ["icons/maskable-192.png", 192, 192, tile(SHOP, { scale: 54 }), false],
  ["icons/maskable-512.png", 512, 512, tile(SHOP, { scale: 54 }), false],
  ["icons/apple-touch-icon.png", 180, 180, tile(SHOP, { scale: 62 }), false],
  ["icons/favicon-32.png", 32, 32, tile(SHOP, { scale: 74, radius: 22, border: true }), true],
  ["icons/admin-192.png", 192, 192, tile(ADMIN, { radius: 22 }), true],
  ["icons/admin-512.png", 512, 512, tile(ADMIN, { radius: 22 }), true],
  ["icons/admin-maskable-512.png", 512, 512, tile(ADMIN, { scale: 54 }), false],
  ["icons/admin-apple-touch-icon.png", 180, 180, tile(ADMIN, { scale: 62 }), false],
  ["icons/og.png", 1200, 630, og, false],
  // Sources des icônes et écrans de démarrage des applications natives (voir native/README.md)
  ["native/assets/icon-only.png", 1024, 1024, tile(SHOP, { scale: 62 }), false],
  ["native/assets/icon-foreground.png", 1024, 1024, tile(SHOP, { scale: 44, bg: false }), true],
  ["native/assets/icon-background.png", 1024, 1024, `<div style="width:100vw;height:100vh;background:${SHOP.bg}"></div>`, false],
  ["native/assets/splash.png", 2732, 2732, tile(SHOP, { scale: 16 }), false],
  ["native/assets/splash-dark.png", 2732, 2732, tile(DARK, { scale: 16 }), false]
];

(async () => {
  const browser = await chromium.launch();
  for (const [file, width, height, body, transparent] of JOBS) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>@font-face{font-family:Brico;font-weight:200 800;src:url(data:font/woff2;base64,${font}) format("woff2")}
      html,body{margin:0;background:transparent}</style>${body}`);
    await page.evaluate(() => document.fonts.ready);
    const out = path.join(ROOT, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, omitBackground: transparent });
    await page.close();
    console.log(file.padEnd(40), fs.statSync(out).size, "octets");
  }
  await browser.close();
})();
