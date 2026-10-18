// ── session.js ───────────────────────────────────────────────
// Who is using the app right now.
//
//  * FIREBASE mode: SESSION is the signed-in person ({uid, email, name, photo, role}), set once by
//    startup.js. The role (student / admin) is decided only by Firestore.
//  * LOCAL mode:    SESSION stays null and the role is a preference saved in this browser,
//    chosen on the landing page.
import { FIREBASE_ENABLED } from "./firebase.js";
import { ROLE_KEY } from "./config.js";

export let SESSION = null;          // {uid,email,name,photo,role} in Firebase mode, else null

/** Called once by startup.js. (Other files cannot assign to SESSION directly.) */
export function setSession(session) { SESSION = session; }

export function getRole() {
  if (SESSION) return SESSION.role;                 // Firebase mode: decided by Firestore only
  return localStorage.getItem(ROLE_KEY) || "student";
}
export function setRole(role) {
  if (FIREBASE_ENABLED) return;                     // in Firebase mode the role cannot be chosen
  localStorage.setItem(ROLE_KEY, role);
}
