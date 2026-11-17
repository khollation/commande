# La Khôllation

Boutique en ligne de snacks et boissons : les élèves commandent, tu livres en chambre, ils paient à la livraison (espèces ou Wero).

| Page | Adresse |
|---|---|
| Boutique | <https://khollation.github.io/commande/> |
| Admin (commandes, produits, ouverture) | <https://khollation.github.io/commande/admin.html> |
| Compta | <https://khollation.github.io/commande/compta.html> |
| Application Android (APK) | <https://github.com/khollation/commande/releases/download/android/khollation.apk> |

L'ancienne version du site est sauvegardée dans [`backup/`](backup/) (voir son [README](backup/README.md) pour revenir en arrière).

---

## Installer l'application

Le site s'installe comme une vraie application, avec son icône sur l'écran d'accueil, en plein écran, et elle se met à jour toute seule.

- **iPhone / iPad** : ouvrir la boutique dans **Safari** → bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
- **Android** : ouvrir la boutique dans **Chrome** → bouton **Installer** affiché sur la page (ou menu **⋮** → **Installer l'application**).
  On peut aussi télécharger le [fichier APK](https://github.com/khollation/commande/releases/download/android/khollation.apk) et l'ouvrir (Android demande d'autoriser l'installation).
- **Admin** : ouvrir `admin.html` puis installer de la même façon : tu obtiens une deuxième appli, « Kh. Admin », avec sa propre icône.

La boutique affiche ces explications d'elle-même (encart « Installe l'appli » et lien en bas de page), y compris aux élèves qui arrivent depuis Instagram.

> **Pourquoi pas l'App Store ?** Publier sur l'App Store demande un compte développeur Apple (99 €/an), un Mac et une validation par Apple, qui refuse souvent les applications qui ne font qu'afficher un site. L'installation depuis Safari donne le même résultat, gratuitement et sans validation. Le projet iOS est quand même prêt : voir [`native/README.md`](native/README.md).

---

## Ce qui a changé

**Pour les élèves (boutique)**
- Nouveau design, même identité (bleu nuit, étiquettes jaunes, police Bricolage Grotesque), logo Σ en en-tête.
- Raccourcis de catégories qui suivent le défilement, panier conservé si on ferme la page.
- Commande plus rapide : prénom et chambre retenus, boutons « Dès que possible / +15 min / +30 min / +1 h ».
- Après la commande : récapitulatif, **compte à rebours avant la livraison**, et suivi en direct (« validée », « livrée »).
- Le site s'ouvre instantanément (copie locale du catalogue) et fonctionne même avec un réseau capricieux.
- Si le stock ou le prix d'un produit change pendant la commande, la commande est refusée proprement avec une explication.
- Thème sombre automatique, **thème de saison** (Noël, Halloween, été) réglable dans `config.js`.

**Pour toi (admin)**
- Onglets **Commandes / Produits / Boutique / Compta** en bas de l'écran, comme une appli.
- Chiffres du jour en haut (commandes, ventes, à traiter, non payé), commandes regroupées par jour, **délai avant livraison** (« dans 12 min », « en retard de 5 min »).
- **Rendu de monnaie** pour les paiements en espèces (montant donné → à rendre, avec le détail des pièces).
- **Historique d'un élève** : touche son nom pour voir ses commandes, ce qu'il prend le plus souvent, ce qu'il doit encore.
- **Alerte stock faible** dans l'admin et **notification ntfy** quand un produit passe sous le seuil ou tombe à zéro.
- Produits : modifier le nom, l'emoji, le prix, le stock, la catégorie, le badge, l'image ; bouton **Réassort** (+6, +12, +24…) ; recherche.
- Confirmation avant toute action irréversible, messages clairs en cas d'erreur, son et vibration à chaque nouvelle commande.

**Compta**
- Mêmes chiffres qu'avant + panier moyen, répartition **espèces / Wero** de ce qui est encaissé, **graphique des ventes**.
- Exports CSV inchangés (Excel / Google Sheets), et partage direct depuis le téléphone.

**Corrections de bugs de l'ancienne version**
- Annuler une commande était impossible si l'un de ses produits avait été supprimé entre-temps.
- L'annonce déjà en ligne n'apparaissait jamais dans l'admin (champ vide) : cliquer sur « Enregistrer » risquait de l'effacer.
- Une modification de stock venue d'une commande pouvait effacer le prix que tu étais en train de taper.
- Le son des nouvelles commandes ne marchait pas quand la session admin était déjà ouverte.
- Une ancienne commande qui réapparaissait dans la liste déclenchait une fausse alerte.

Toutes les idées de [`idée.md`](idée.md) sont maintenant en place.

---

## Modifier les réglages

Tout se règle dans **[`config.js`](config.js)** (sur GitHub : ouvrir le fichier → crayon ✏️ → modifier → *Commit changes*). Le site est à jour une à deux minutes plus tard.

| Réglage | Rôle |
|---|---|
| `SHOP.name` | Nom affiché |
| `CATEGORIES` | Catégories, dans l'ordre d'affichage |
| `SCHEDULE` | Horaires d'ouverture de chaque jour (l'admin peut ouvrir / fermer / changer les horaires pour la journée) |
| `LAST_DELIVERY` | Heure de livraison la plus tardive proposée |
| `NTFY_TOPIC` | Sujet ntfy de ton téléphone pour les notifications |
| `LOW_STOCK` | Seuil d'alerte « stock faible » (0 = pas d'alerte) |
| `ANDROID_APK` | Lien de l'application Android proposé aux élèves ("" pour le masquer) |
| `SEASON` | Thème de saison : `"auto"`, `"aucun"`, `"noel"`, `"halloween"` ou `"ete"` |

Les couleurs sont en haut de [`style.css`](style.css) (section « Couleurs »).

---

## Sécuriser la base de données (recommandé)

Le site fonctionne sans que les élèves se connectent : la base de données doit donc les autoriser à commander, **mais rien de plus**. Les règles actuelles de ton projet Firebase ne sont pas visibles depuis le code ; si elles sont restées en « mode test », n'importe qui peut modifier les prix, lire toutes les commandes ou vider la base (et ce mode expire au bout de 30 jours, ce qui bloque alors le site).

Le fichier [`firestore.rules`](firestore.rules) contient des règles prêtes à l'emploi, testées avec tout le site :

1. Ouvre [`firestore.rules`](firestore.rules) et copie tout son contenu.
2. Dans la [console Firebase](https://console.firebase.google.com/project/internat-couffignal/firestore/rules) : **Firestore Database** → onglet **Règles**.
3. Colle le contenu à la place de l'ancien, puis **remplace `REMPLACE-PAR-TON-EMAIL@exemple.com`** par l'adresse e-mail de ton compte admin.
4. Clique sur **Publier**.

Avec ces règles, un élève peut voir les produits, commander et suivre sa commande, mais ni changer un prix, ni lire les commandes des autres, ni toucher aux réglages ou à la compta. Seul ton compte admin peut tout gérer, même si quelqu'un se crée un compte de son côté.

---

## Comment c'est construit

Site statique hébergé par GitHub Pages, sans étape de compilation : on modifie un fichier, il est en ligne.

```
index.html, admin.html, compta.html   les trois pages
config.js                             les réglages (le seul fichier à modifier au quotidien)
style.css                             l'apparence, commune aux trois pages
js/                                   le code : boutique (shop.js), admin, compta, et les briques communes
sw.js, *.webmanifest, icons/          ce qui rend le site installable comme une application
fonts/, vendor/firebase/              police et SDK Firebase hébergés avec le site (plus rapide, aucun serveur tiers)
native/                               applications Android et iOS (voir native/README.md)
firestore.rules                       règles de sécurité recommandées
tests/                                tests automatiques (voir tests/README.md)
tools/make-icons.cjs                  régénère les icônes à partir du logo
backup/                               l'ancienne version du site
```

La base de données Firebase est la même qu'avant : produits, commandes, dépenses et réglages sont conservés, et l'ancienne et la nouvelle version peuvent fonctionner en même temps.
