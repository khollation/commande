// ════════════════════════════════════════════════════════════════════
//  RÉGLAGES DE LA BOUTIQUE
//  C'est le seul fichier à modifier pour changer le nom, les catégories,
//  les horaires, les alertes ou le thème de saison.
// ════════════════════════════════════════════════════════════════════

// Nom affiché sur le site et dans l'application
export const SHOP = {
  name: "La Khôllation",
  // Info de paiement Wero (pas encore affichée sur le site : le client scanne ton QR code à la livraison)
  wero: "COMPLÈTE ICI ton numéro ou identifiant Wero"
};

// Catégories affichées sur le site, dans cet ordre.
// Un produit sans catégorie (ou d'une catégorie absente de cette liste) est rangé dans « Autres ».
export const CATEGORIES = ["Boissons", "Snacks", "Formules"];

// ---------- Horaires d'ouverture ----------
// 0 = dimanche, 1 = lundi … 6 = samedi. Liste vide = fermé toute la journée.
export const SCHEDULE = {
  0: [["20:00", "22:30"]],
  1: [["17:30", "18:30"], ["19:00", "22:30"]],
  2: [["17:30", "18:30"], ["19:00", "22:30"]],
  3: [["17:30", "18:30"], ["19:00", "22:30"]],
  4: [["17:30", "18:30"], ["19:00", "22:30"]],
  5: [["17:30", "18:30"], ["19:00", "22:30"]],
  6: []
};
export const LAST_ORDER = "22:30";      // utilisée par « Ouvrir maintenant » dans l'admin
export const LAST_DELIVERY = "23:00";   // heure de livraison maximale proposée aux clients

// ---------- Notifications sur ton téléphone (application ntfy) ----------
// Sujet ntfy auquel ton téléphone est abonné. Chaque nouvelle commande y envoie une notification.
export const NTFY_TOPIC = "khollation-13a10g";

// ---------- Stock faible ----------
// À partir de ce nombre d'unités restantes (ou moins), un produit est signalé « stock faible » :
// texte rouge sur le site, repère dans l'admin et notification ntfy au moment où il passe sous ce seuil.
// Une notification est aussi envoyée quand un produit tombe à zéro. Mets 0 pour désactiver les alertes.
export const LOW_STOCK = 3;

// ---------- Application Android ----------
// Lien de téléchargement de l'application Android (fichier APK), proposé dans le mode d'emploi
// d'installation sur les téléphones Android. Mets "" pour ne pas le proposer.
export const ANDROID_APK = "https://github.com/khollation/commande/releases/download/android/khollation.apk";

// ---------- Thème de saison ----------
// "auto"      : suit le calendrier (Halloween fin octobre, Noël en décembre, été fin juin)
// "aucun"     : toujours les couleurs normales
// "noel", "halloween" ou "ete" : force un thème toute l'année
export const SEASON = "auto";

// ---------- Connexion à la base de données Firebase (ne pas modifier) ----------
export const FIREBASE = {
  apiKey: "AIzaSyAII2fbLkzkTnK8v3mzYQRNlIvVnFNB8bA",
  authDomain: "internat-couffignal.firebaseapp.com",
  projectId: "internat-couffignal",
  storageBucket: "internat-couffignal.firebasestorage.app",
  messagingSenderId: "357179569899",
  appId: "1:357179569899:web:d7403543dc19e1f212f0ae"
};
