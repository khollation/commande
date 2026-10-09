import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const app = initializeApp({
  apiKey: "AIzaSyAII2fbLkzkTnK8v3mzYQRNlIvVnFNB8bA",
  authDomain: "internat-couffignal.firebaseapp.com",
  projectId: "internat-couffignal",
  storageBucket: "internat-couffignal.firebasestorage.app",
  messagingSenderId: "357179569899",
  appId: "1:357179569899:web:d7403543dc19e1f212f0ae"
});

export const db = getFirestore(app);
export const auth = getAuth(app);

// À MODIFIER : nom affiché et info de paiement Wero
export const SHOP = {
  name: "Le Snack de l'internat",
  wero: "COMPLÈTE ICI ton numéro ou identifiant Wero"
};

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const eur = c => (c / 100).toFixed(2).replace(".", ",") + " €";
