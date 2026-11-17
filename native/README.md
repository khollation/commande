# Applications Android et iOS

Ces applications sont une « coquille » ([Capacitor](https://capacitorjs.com)) qui affiche le site en ligne, `https://khollation.github.io/commande/`, en plein écran avec l'icône de La Khôllation.

Conséquence pratique : **elles ont toujours exactement les mêmes fonctionnalités que le site**. Une modification du site (produits, prix, textes, nouvelles fonctions) apparaît dans l'application sans la reconstruire ni la réinstaller. Sans connexion, l'application affiche une page « Pas de connexion » qui se recharge toute seule au retour du réseau.

## Android

Le fichier `khollation.apk` est construit automatiquement par GitHub (onglet **Actions**, « Applications Android et iOS ») à chaque modification de ce dossier, et publié sur la page **Releases** du dépôt :

<https://github.com/khollation/commande/releases/download/android/khollation.apk>

Pour l'installer : ouvrir ce lien sur le téléphone Android, ouvrir le fichier téléchargé, autoriser l'installation si Android le demande.

On peut relancer la construction à la main : **Actions** → **Applications Android et iOS** → **Run workflow**.

### Clé de signature (facultatif)

Android exige qu'une mise à jour de l'application soit signée avec la même clé que la version installée. Par défaut, chaque construction utilise une nouvelle clé de test : pour installer une nouvelle version de l'APK, il faut d'abord désinstaller l'ancienne. Comme l'application affiche le site en ligne, c'est rarement nécessaire.

Pour des mises à jour sans désinstaller, crée une clé une fois pour toutes (sur un ordinateur avec Java) :

```bash
keytool -genkeypair -v -keystore khollation.jks -alias khollation -keyalg RSA -keysize 4096 -validity 36500 -storepass CHOISIS-UN-MOT-DE-PASSE -dname "CN=La Khollation"
base64 -w0 khollation.jks > khollation.jks.txt
```

Puis sur GitHub : **Settings** → **Secrets and variables** → **Actions** → **New repository secret** :

- `ANDROID_KEYSTORE_BASE64` : le contenu du fichier `khollation.jks.txt` ;
- `ANDROID_KEYSTORE_PASSWORD` : le mot de passe choisi.

Garde `khollation.jks` et son mot de passe en lieu sûr : sans eux, impossible de publier une mise à jour signée de la même façon.

## iOS

Sur iPhone, le plus simple est d'installer le site depuis Safari (**Partager** → **Sur l'écran d'accueil**) : même résultat, gratuit, toujours à jour.

Le projet iOS est néanmoins prêt, et GitHub vérifie à chaque modification qu'il compile. Pour le publier sur l'App Store, il faut :

1. un compte [Apple Developer](https://developer.apple.com/programs/) (99 €/an) ;
2. un Mac avec Xcode, puis dans ce dossier : `npm ci`, `npm run ios`, `npx cap open ios` ;
3. dans Xcode, choisir son équipe (onglet *Signing & Capabilities*), puis *Product → Archive* et envoyer l'application à Apple.

Attention : Apple refuse souvent les applications qui se contentent d'afficher un site (règle 4.2 de l'App Store).

La construction automatique fournit aussi un `.ipa` **non signé** (artefact « khollation-ios-non-signee » de chaque construction), utilisable seulement avec des outils comme AltStore ou Sideloadly, qui le signent avec un compte Apple personnel (validité de 7 jours).

## Modifier l'application

| Fichier | Rôle |
|---|---|
| `capacitor.config.json` | nom, identifiant, adresse du site affiché |
| `assets/` | icône et écrans de démarrage (régénérés par `node ../tools/make-icons.cjs`) |
| `www/offline.html` | page affichée sans connexion |
| `release-notes.md` | texte de la page de téléchargement Android |

Les dossiers `android/` et `ios/` sont recréés à chaque construction (`npm run android`, `npm run ios`) et ne sont pas enregistrés dans le dépôt.
