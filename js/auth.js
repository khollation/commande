// Connexion des administrateurs (e-mail + mot de passe). Chargé uniquement par l'admin et la compta.
import { getAuth } from "../vendor/firebase/firebase-auth.js";
import { app } from "./firebase.js";

export const auth = getAuth(app);
export { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "../vendor/firebase/firebase-auth.js";
