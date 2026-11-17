# Tests automatiques

Ces tests vérifient le site comme le ferait une personne : ils ouvrent un vrai navigateur (Chromium), passent des commandes, valident, annulent, modifient des produits, exportent la compta, coupent le réseau, etc.

Ils n'utilisent **jamais** la vraie base de données : tout se passe dans les *émulateurs* Firebase (une base de données temporaire sur l'ordinateur), avec des produits fictifs. Le navigateur de test n'a d'ailleurs pas accès à internet.

| Fichier | Ce qui est vérifié |
|---|---|
| `core.test.mjs` | horaires d'ouverture, montants, dates, catégories, thème de saison |
| `shop.test.cjs` | la boutique : catalogue, panier, commande, stock, notifications, « Ta commande » |
| `admin.test.cjs` | l'admin : commandes, annulation, rendu de monnaie, historique, produits, ouverture, annonce |
| `compta.test.cjs` | la compta : chiffres clés, graphique, périodes, dépenses, exports CSV |
| `pwa.test.cjs` | l'application installable : installation, hors-ligne, mises à jour, application native |
| `rules.test.cjs` | les règles de sécurité recommandées (`../firestore.rules`) |

## Lancer les tests

Il faut [Node.js](https://nodejs.org) 22 ou plus récent, et Java 21 (pour les émulateurs Firebase).

```bash
cd tests
npm install
npx playwright install chromium
npm test
```

`npm run test:regles` relance les tests de la boutique, de l'admin et de la compta avec les règles de sécurité recommandées, pour vérifier qu'elles ne bloquent rien.

Les tests sont écrits pour les réglages actuels de `config.js` (horaires, seuil de stock faible…). Si tu modifies ces réglages, certains tests peuvent échouer sans que le site soit cassé.
