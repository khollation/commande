# SDK Firebase (copie locale)

Ces trois fichiers sont le SDK JavaScript officiel de Firebase, **version 10.14.1** — exactement celle que le site chargeait auparavant depuis `https://www.gstatic.com/firebasejs/10.14.1/`. Ils proviennent du paquet npm [`firebase@10.14.1`](https://www.npmjs.com/package/firebase/v/10.14.1).

Ils sont hébergés ici pour que l'application démarre plus vite et fonctionne sans dépendre d'un serveur tiers.

Deux modifications seulement par rapport aux fichiers d'origine :

1. dans `firebase-firestore.js` et `firebase-auth.js`, l'import de `firebase-app.js` pointe vers le fichier voisin (`./firebase-app.js`) au lieu de l'adresse gstatic ;
2. le commentaire `//# sourceMappingURL=…` de fin de fichier a été retiré (les cartes de sources ne sont pas fournies).

Ne pas modifier ces fichiers à la main. Licence : Apache 2.0 (voir `LICENSE`), © Google LLC.
