// Accès direct aux émulateurs Firebase (Firestore + Auth) pour préparer et vérifier les données de test.
// Le jeton « owner » contourne les règles de sécurité : il n'existe que dans l'émulateur.
const fs = require("node:fs");
const path = require("node:path");
const PROJECT = "demo-khollation";
const FS = "http://127.0.0.1:8080";
const AUTH = "http://127.0.0.1:9099";
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
const toFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));

function fromValue(v) {
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue);
  if ("mapValue" in v) return fromFields(v.mapValue.fields || {});
  throw new Error("Type Firestore non géré : " + JSON.stringify(v));
}
const fromFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromValue(v)]));

async function call(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${init?.method || "GET"} ${url} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const setDoc = (path, data) => call(`${DOCS}/${path}`, { method: "PATCH", headers: OWNER, body: JSON.stringify({ fields: toFields(data) }) });
async function getDoc(path) {
  const r = await fetch(`${DOCS}/${path}`, { headers: OWNER });
  if (r.status === 404) return null;
  const j = await r.json();
  return { id: j.name.split("/").pop(), ...fromFields(j.fields || {}) };
}
async function listDocs(collection) {
  const j = await call(`${DOCS}/${collection}?pageSize=1000`, { headers: OWNER });
  return ((j && j.documents) || []).map(d => ({ id: d.name.split("/").pop(), ...fromFields(d.fields || {}) }));
}
const deleteDoc = path => call(`${DOCS}/${path}`, { method: "DELETE", headers: OWNER });
const clearFirestore = () => call(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
const clearAuth = () => call(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
const createUser = (email, password) => call(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true })
});
const setRules = source => call(`${FS}/emulator/v1/projects/${PROJECT}:securityRules`, {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: source }] } })
});
const OPEN_RULES = `rules_version = '2';
service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if true; } } }`;

/**
 * Règles recommandées (firestore.rules), avec l'adresse de l'admin de test à la place de celle à remplacer.
 * Les tests utilisent ces règles quand la variable d'environnement KH_RULES vaut 1 (« npm run test:regles »).
 */
function recommendedRules(adminEmail = "admin@khollation.test") {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  if (!source.includes("REMPLACE-PAR-TON-EMAIL@exemple.com")) throw new Error("firestore.rules : adresse à remplacer introuvable");
  return source.replace("REMPLACE-PAR-TON-EMAIL@exemple.com", adminEmail);
}

async function reset({ rules = process.env.KH_RULES === "1" ? recommendedRules() : OPEN_RULES } = {}) {
  await Promise.all([clearFirestore(), clearAuth()]);
  await setRules(rules);
}

module.exports = { PROJECT, FS, AUTH, setDoc, getDoc, listDocs, deleteDoc, clearFirestore, clearAuth, createUser, setRules, reset, recommendedRules, OPEN_RULES };
