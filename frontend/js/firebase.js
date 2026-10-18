// ── firebase.js ─────────────────────────────────────────────────
// Thin wrapper around the Firebase Web SDK (loaded from Google's CDN only
// when Firebase is configured): Google sign-in, role lookup, Firestore I/O.
//
// ROLES: everyone who signs in is a STUDENT. A user is an ADMIN only if a
// document exists at  admins/<their-google-email-in-lowercase>  in Firestore.
// Only you can create that document (in the Firebase console) - the
// Firestore rules block every client from writing to /admins.
//
// WHAT IS IN THIS FILE
//    Loading Firebase  -> fb()
//    Who is signed in  -> resolveSession()
//    Signing in / up   -> signInWithGoogle, emailSignUp, emailSignIn, resendVerification, resetPassword, signOutUser
//    Backend ticket    -> getIdToken()   (sent to the Flask backend as proof of sign-in)
//    Saved data        -> cloudList, cloudUpsert, cloudDelete   (Firestore database)
//
// If firebase-config.js still has placeholder values ("YOUR_..."), FIREBASE_ENABLED is
// false and the app runs in local mode (no sign-in, data kept in the browser).
import { firebaseConfig } from "./firebase-config.js";

// True if a setting in firebase-config.js has not been filled in yet.
const isPlaceholder = v => !v || String(v).startsWith("YOUR_");
export const FIREBASE_ENABLED = !isPlaceholder(firebaseConfig.apiKey) && !isPlaceholder(firebaseConfig.projectId);

// Firebase is downloaded from Google only when first needed (never in local mode).
const SDK = "https://www.gstatic.com/firebasejs/10.14.1";
let _fb = null;   // remembers the loaded Firebase so it is only set up once

/** Loads and sets up Firebase once. Returns { app, auth, db, A: auth tools, F: database tools }. */
async function fb() {
  if (_fb) return _fb;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  _fb = { app, auth: authMod.getAuth(app), db: fsMod.getFirestore(app), A: authMod, F: fsMod };
  return _fb;
}

/** Waits for Firebase to say who is signed in (a user, or null) and returns that once. */
function firstAuthUser() {
  return fb().then(({ auth, A }) => new Promise(resolve => {
    const off = A.onAuthStateChanged(auth, u => { off(); resolve(u); });
  }));
}

/** Resolves the signed-in user + role, or null when signed out. */
export async function resolveSession() {
  const user = await firstAuthUser();
  if (!user) return null;
  const email = (user.email || "").toLowerCase();
  // Only Google-VERIFIED emails are accepted: reports are sent to this address.
  if (!email || !user.emailVerified) { await signOutUser(); return null; }
  const { db, F } = await fb();
  let role = "student", lookupError = "";            // default for every sign-in / sign-up
  for (let attempt = 0; attempt < 2; attempt++) {    // one retry for transient network hiccups
    try {
      const snap = await F.getDoc(F.doc(db, "admins", email));
      role = snap.exists() ? "admin" : "student";    // admin = a document you created in the Firebase console
      lookupError = "";
      break;
    } catch (e) {
      lookupError = e.code || e.message || "unknown";
      console.warn("[auth] admin lookup failed (attempt " + (attempt + 1) + "):", e);
      if (attempt === 0) await new Promise(r => setTimeout(r, 700));
    }
  }
  // Fails closed (student) but reports why, so a broken lookup is never silent.
  return { uid: user.uid, email, name: user.displayName || email.split("@")[0], photo: user.photoURL || "", role, lookupError };
}

/** Opens the Google account picker popup. */
export async function signInWithGoogle() {
  const { auth, A } = await fb();
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await A.signInWithPopup(auth, provider);
  return cred.user;
}

/** Sign up with email + password. A verification link is emailed; the user
 *  can only get in after clicking it (resolveSession rejects unverified emails). */
export async function emailSignUp(name, email, password) {
  const { auth, A } = await fb();
  const cred = await A.createUserWithEmailAndPassword(auth, email, password);
  if (name) await A.updateProfile(cred.user, { displayName: name }).catch(() => {});
  let sent = true, code = "";
  try { await A.sendEmailVerification(cred.user); } catch (e) { sent = false; code = e.code || ""; }
  await A.signOut(auth);
  return { sent, code };                       // account exists either way; UI explains what happened
}

/** Email + password sign-in. Unverified accounts are refused (a fresh link is attempted). */
export async function emailSignIn(email, password) {
  const { auth, A } = await fb();
  const cred = await A.signInWithEmailAndPassword(auth, email, password);
  if (!cred.user.emailVerified) {
    let sent = true, code = "";
    try { await A.sendEmailVerification(cred.user); } catch (e) { sent = false; code = e.code || ""; }
    await A.signOut(auth);
    const e = new Error("unverified"); e.code = "app/unverified"; e.sent = sent; e.sendCode = code; throw e;
  }
  return cred.user;
}

/** Re-send the verification link. Returns "sent" or "verified". */
export async function resendVerification(email, password) {
  const { auth, A } = await fb();
  const cred = await A.signInWithEmailAndPassword(auth, email, password);
  try {
    if (cred.user.emailVerified) return "verified";
    await A.sendEmailVerification(cred.user);
    return "sent";
  } finally { await A.signOut(auth).catch(() => {}); }
}

/** Emails a "reset your password" link. */
export async function resetPassword(email) {
  const { auth, A } = await fb();
  await A.sendPasswordResetEmail(auth, email);
}

/** Signs the current person out. */
export async function signOutUser() {
  const { auth, A } = await fb();
  await A.signOut(auth);
}

/** Fresh ID token (auto-refreshed by the SDK) for calling the Flask backend. */
export async function getIdToken() {
  const { auth } = await fb();
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

// ── Firestore helpers ───────────────────────────────────────────
// Copies an object without any `undefined` values (Firestore refuses to save those).
const clean = obj => JSON.parse(JSON.stringify(obj));

/** Students get only their own docs; admins get everything. Newest first. */
export async function cloudList(coll, session) {
  const { db, F } = await fb();
  const base = F.collection(db, coll);
  const q = session.role === "admin" ? base : F.query(base, F.where("uid", "==", session.uid));
  const snap = await F.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

/** Saves one item (creates it, or replaces it if the id already exists). */
export async function cloudUpsert(coll, obj) {
  const { db, F } = await fb();
  await F.setDoc(F.doc(db, coll, obj.id), clean(obj));
}

/** Deletes one item by id. */
export async function cloudDelete(coll, id) {
  const { db, F } = await fb();
  await F.deleteDoc(F.doc(db, coll, id));
}
