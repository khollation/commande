// Tests de l'application installable : manifestes, critères d'installation de Chrome,
// fonctionnement hors ligne (service worker), invitations à installer, application native.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startSite, until, text, REPO } = require("./lib/harness.cjs");
const { seed, PRODUCTS } = require("./lib/fixtures.cjs");
const emu = require("./lib/emulator.cjs");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const INSTAGRAM = IPHONE.replace("Safari/604.1", "Instagram 380.0.0.0.0 (iPhone16,2; iOS 18_5; fr_FR; fr; scale=3.00; 1179x2556)");

let site;
before(async () => { site = await startSite(); });
after(async () => { await site.close(); });
beforeEach(async () => { await emu.reset(); await seed(); });

async function open(options, path = "") {
  const ctx = await site.newContext(options);
  const page = await ctx.newPage();
  await page.goto(site.url + path);
  return { ctx, page };
}

test("manifestes : champs obligatoires et icônes aux bonnes dimensions", async () => {
  for (const [file, start] of [["manifest.webmanifest", "./"], ["admin.webmanifest", "./admin.html"]]) {
    const res = await fetch(site.url + file);
    assert.equal(res.status, 200);
    const m = await res.json();
    assert.equal(m.start_url, start);
    assert.equal(m.id, start);
    assert.equal(m.display, "standalone");
    assert.equal(m.lang, "fr");
    for (const icon of m.icons) {
      const img = await fetch(site.url + icon.src);
      assert.equal(img.status, 200, icon.src);
      const buf = Buffer.from(await img.arrayBuffer());
      const [w, h] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];   // dimensions inscrites dans l'en-tête PNG
      assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    }
    assert.ok(m.icons.some(i => i.sizes === "512x512" && i.purpose === "maskable"), file + " : icône adaptative 512 px");
  }
});

test("Chrome considère la boutique et l'admin comme installables", async () => {
  const { ctx, page } = await open({ serviceWorkers: "allow", viewport: { width: 1200, height: 800 } });
  const cdp = await ctx.newCDPSession(page);
  await page.waitForSelector(".item");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const shop = await until(async () => { const r = await cdp.send("Page.getInstallabilityErrors"); return r.installabilityErrors.length === 0 && r; }, "boutique installable");
  assert.deepEqual(shop.installabilityErrors, []);
  await page.goto(site.url + "admin.html");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const admin = await until(async () => { const r = await cdp.send("Page.getInstallabilityErrors"); return r.installabilityErrors.length === 0 && r; }, "admin installable");
  assert.deepEqual(admin.installabilityErrors, []);
  const manifest = await cdp.send("Page.getAppManifest");
  assert.ok(manifest.url.endsWith("/admin.webmanifest"));
});

test("hors ligne : la boutique s'ouvre quand même, avec le dernier catalogue connu", async () => {
  const { ctx, page } = await open({ serviceWorkers: "allow" });
  await page.waitForSelector(".item");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await until(() => page.evaluate(() => !!navigator.serviceWorker.controller || location.reload()), "service worker actif");
  await page.waitForSelector(".item");
  await until(() => page.evaluate(() => !!localStorage.getItem("kh_products")), "catalogue gardé en mémoire");
  const cached = await page.evaluate(async () => (await (await caches.open("khollation-v1")).keys()).map(r => new URL(r.url).pathname));
  for (const file of ["/commande/", "/commande/index.html", "/commande/style.css", "/commande/js/shop.js", "/commande/vendor/firebase/firebase-firestore.js"]) assert.ok(cached.includes(file), file + " gardé pour le hors-ligne");

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector(".item");
  assert.equal(await page.$$eval(".item", els => els.length), Object.keys(PRODUCTS).length);
  assert.ok(await page.isVisible(".offline"), "bandeau « Hors ligne » affiché");
  assert.equal(await text(page, ".offline"), "Hors ligne · ce qui est affiché n'est peut-être plus à jour");
  await ctx.setOffline(false);
  await until(() => page.isHidden(".offline"), "bandeau masqué au retour du réseau");
});

test("hors ligne, page jamais visitée : page « Pas de connexion » plutôt qu'une erreur du navigateur", async () => {
  const { ctx, page } = await open({ serviceWorkers: "allow" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.goto(site.url + "page-inconnue.html");
  // Une page inconnue retombe sur la boutique gardée en mémoire.
  await page.waitForSelector("#list");
  assert.equal(await page.title(), "La Khôllation");
});

test("mise à jour : une nouvelle version publiée est servie dès le chargement suivant", async () => {
  const { page } = await open({ serviceWorkers: "allow" });
  await page.waitForSelector(".item");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await until(() => page.evaluate(() => !!navigator.serviceWorker.controller || location.reload()), "service worker actif");
  await page.waitForSelector(".item");
  const marker = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--version-test").trim());
  assert.equal(await marker(), "");
  site.override("style.css", fs.readFileSync(path.join(REPO, "style.css"), "utf8") + "\n:root{--version-test:2}\n");
  try {
    await page.reload();
    await page.waitForSelector(".item");
    assert.equal(await marker(), "2", "la nouvelle feuille de style est servie, pas l'ancienne copie");
  } finally { site.clearOverrides(); }
});

test("iPhone : encart d'installation et mode d'emploi Safari, masquable pour 30 jours", async () => {
  const { page } = await open({ userAgent: IPHONE });
  await page.waitForSelector(".item");
  assert.ok(await page.isVisible("main [data-install-card]"));
  await page.click("main [data-install-card] [data-install]");
  const help = await text(page, "dialog.sheet:not(#dlg)");
  for (const part of ["Installer La Khôllation", "Partager", "Sur l'écran d'accueil", "Ajouter"]) assert.ok(help.includes(part), `« ${part} » absent de « ${help} »`);
  await page.click("dialog.sheet:not(#dlg) .btn");
  await page.click("main [data-install-card] [data-install-dismiss]");
  assert.ok(await page.isHidden("main [data-install-card]"));
  await page.reload();
  await page.waitForSelector(".item");
  assert.ok(await page.isHidden("main [data-install-card]"), "reste masqué après rechargement");
  assert.ok(await page.isVisible("footer [data-install-link]"), "le lien discret du pied de page reste disponible");
});

test("navigateur d'Instagram : explique comment ouvrir la page dans Safari", async () => {
  const { page } = await open({ userAgent: INSTAGRAM });
  await page.waitForSelector(".item");
  await page.click("main [data-install-card] [data-install]");
  assert.ok((await text(page, "dialog.sheet:not(#dlg)")).includes("Ouvrir dans Safari"));
});

test("Android / Chrome : le bouton « Installer » déclenche l'installation proposée par le navigateur", async () => {
  const { page } = await open({ userAgent: ANDROID });
  await page.waitForSelector(".item");
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await page.waitForSelector("main [data-install-card]:not([hidden])");
  await page.click("main [data-install-card] [data-install]");
  assert.equal(await page.evaluate(() => window.__prompted), true);
  assert.equal(await page.locator("dialog.sheet:not(#dlg)").count(), 0, "pas de mode d'emploi : le navigateur s'en charge");
});

test("Android sans invitation du navigateur : mode d'emploi et lien vers l'application Android", async () => {
  const { page } = await open({ userAgent: ANDROID.replace("Chrome/141.0.0.0 Mobile Safari/537.36", "Firefox/145.0") });
  await page.waitForSelector(".item");
  await page.click("footer [data-install-link]");
  const help = await text(page, "dialog.sheet:not(#dlg)");
  assert.ok(help.includes("Installer l'application") && help.includes("Ajouter à l'écran d'accueil"));
  assert.equal(await page.getAttribute("dialog.sheet:not(#dlg) a", "href"), "https://github.com/khollation/commande/releases/download/android/khollation.apk");
});

test("ordinateur sans invitation du navigateur : pas d'encart, mais un lien d'aide en bas de page", async () => {
  const { page } = await open({ viewport: { width: 1200, height: 800 } });
  await page.waitForSelector(".item");
  assert.ok(await page.isHidden("main [data-install-card]"));
  assert.ok(await page.isVisible("footer [data-install-link]"));
});

test("application installée : aucune invitation à installer", async () => {
  const ctx = await site.newContext({ userAgent: IPHONE });
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true }));
  const page = await ctx.newPage();
  await page.goto(site.url);
  await page.waitForSelector(".item");
  assert.ok(await page.isHidden("main [data-install-card]"));
  assert.ok(await page.isHidden("footer [data-install-link]"));
});

test("application native Android : bouton retour (fenêtre, page précédente, sortie)", async () => {
  const ctx = await site.newContext({ userAgent: ANDROID });
  await ctx.addInitScript(() => {
    window.__calls = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      addListener: (plugin, event, cb) => { window.__back = cb; window.__calls.push(plugin + "." + event); return { remove() {} }; },
      nativePromise: (plugin, method) => { window.__calls.push(plugin + "." + method); return Promise.resolve(); }
    };
  });
  const page = await ctx.newPage();
  await page.goto(site.url);
  await page.waitForSelector(".item");
  assert.ok(await page.isHidden("main [data-install-card]"));
  assert.ok(await page.isHidden("footer [data-install-link]"), "pas d'invitation à installer dans l'application");
  assert.deepEqual(await page.evaluate(() => window.__calls), ["App.backButton"]);

  await page.click('.item[data-id="coca"] .plus');
  await page.click("#open");
  assert.ok(await page.isVisible("#dlg"));
  await page.evaluate(() => window.__back({ canGoBack: false }));
  assert.ok(await page.isHidden("#dlg"), "« retour » ferme d'abord la fenêtre ouverte");
  await page.evaluate(() => window.__back({ canGoBack: false }));
  assert.deepEqual(await page.evaluate(() => window.__calls), ["App.backButton", "App.exitApp"], "puis quitte l'application");
});
