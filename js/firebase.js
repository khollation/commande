// Connexion à la base de données Firestore.
// Toutes les pages importent d'ici « db » et les fonctions Firestore dont elles ont besoin.
import { initializeApp } from "../vendor/firebase/firebase-app.js";
import { getFirestore } from "../vendor/firebase/firebase-firestore.js";
import { FIREBASE } from "../config.js";

export const app = initializeApp(FIREBASE);
export const db = getFirestore(app);
export * from "../vendor/firebase/firebase-firestore.js";
