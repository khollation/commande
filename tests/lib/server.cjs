// Petit serveur statique qui imite GitHub Pages : le site est servi sous /commande/,
// avec les mêmes en-têtes de cache (max-age=600 + revalidation conditionnelle).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

// transform(cheminRelatif, contenu) permet aux tests de réécrire un fichier à la volée.
function startServer({ root, base = "/commande/", port = 0, transform = null } = {}) {
  const rootDir = path.resolve(root);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let p = decodeURIComponent(url.pathname);
    if (!p.startsWith(base)) { res.writeHead(404).end("Not found"); return; }
    let file = path.join(rootDir, p.slice(base.length));
    if (!file.startsWith(rootDir)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!p.endsWith("/")) { res.writeHead(301, { Location: p + "/" + url.search }).end(); return; }
        file = path.join(file, "index.html");
        try { st = fs.statSync(file); } catch { res.writeHead(404).end("Not found"); return; }
      } else if (err) { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }).end("<h1>404</h1>"); return; }
      const lastModified = new Date(Math.floor(st.mtimeMs / 1000) * 1000).toUTCString();
      const headers = {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "max-age=600",
        "Last-Modified": lastModified
      };
      if (req.headers["if-modified-since"] === lastModified) { res.writeHead(304, headers).end(); return; }
      let body = fs.readFileSync(file);
      if (transform) body = transform(path.relative(rootDir, file).split(path.sep).join("/"), body);
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    });
  });
  return new Promise(resolve => server.listen(port, "127.0.0.1", () => {
    const origin = "http://localhost:" + server.address().port;
    resolve({ origin, url: origin + base, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) });
  }));
}

module.exports = { startServer };

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, "..", "..");
  startServer({ root, port: Number(process.env.PORT) || 4173 }).then(s => console.log("Site servi sur " + s.url));
}
