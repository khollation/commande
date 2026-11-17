// Connexion de l'administrateur, commune à l'admin et à la compta :
// affiche le formulaire tant que personne n'est connecté, puis le contenu de la page.
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "./auth.js";
import { $ } from "./ui.js";

/**
 * onIn(user) est appelé à la connexion, onOut() à la déconnexion.
 * La page doit contenir #boot, #login (avec #em, #pw, #lerr), #panel et #tabs.
 */
export function initSession({ onIn, onOut }) {
  const form = $("#login");
  form.onsubmit = async e => {
    e.preventDefault();
    $("#lerr").textContent = "";
    const btn = $("button", form);
    btn.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, $("#em").value.trim(), $("#pw").value);
    } catch (err) {
      const code = err && err.code;
      $("#lerr").textContent = code === "auth/network-request-failed" ? "Connexion impossible. Vérifie ton réseau et réessaie."
        : code === "auth/too-many-requests" ? "Trop de tentatives. Réessaie dans quelques minutes."
        : "E-mail ou mot de passe incorrect.";
    }
    btn.disabled = false;
  };

  onAuthStateChanged(auth, user => {
    $("#boot").hidden = true;
    form.hidden = !!user;
    $("#panel").hidden = !user;
    $("#tabs").hidden = !user;
    if (user) onIn(user);
    else { $("#pw").value = ""; onOut(); }
  });
}

export const logout = () => signOut(auth);
export const currentUser = () => auth.currentUser;
