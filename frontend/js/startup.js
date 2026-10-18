// ── startup.js ───────────────────────────────────────────────
// Runs ONCE per page load, before the page's own script (it uses top-level await, so every
// page waits for it). In local mode it does nothing. In Firebase mode it:
//   1. finds out who is signed in           2. sends signed-out people to the login page
//   3. keeps students out of admin pages (and the other way round)
//   4. loads that person's saved data from Firestore into the browser copy
import { FIREBASE_ENABLED, resolveSession, cloudList } from "./firebase.js";
import { HISTORY_KEY, FEEDBACK_KEY, ROLE_KEY, NAME_KEY, UID_KEY } from "./config.js";
import { SESSION, setSession } from "./session.js";
import { cloudFailed, wipePrivateCache, setUserEmail } from "./storage.js";
import { showToast } from "./helpers.js";

// A promise that never finishes. Used to pause the page script while the browser is redirecting.
const NEVER = () => new Promise(() => {});

// Steps: (1) who is signed in? (2) signed out -> back to login, (3) wrong area for the role -> redirect,
// (4) load this person's saved data from Firestore into the browser cache.
async function bootstrapFirebase() {
  const inSub = /\/(student|admin)\//.test(location.pathname);
  const root = inSub ? "../" : "./";
  let s = null;
  try { s = await resolveSession(); } catch (e) { console.error("[auth]", e); }

  if (!s) {                                          // signed out
    wipePrivateCache();
    if (inSub) { location.replace(root + "index.html"); await NEVER(); }
    return null;
  }

  // a different Google account than last time on this browser -> drop the old cache
  const prev = localStorage.getItem(UID_KEY);
  if (prev && prev !== s.uid) wipePrivateCache();
  localStorage.setItem(UID_KEY, s.uid);
  localStorage.setItem(ROLE_KEY, s.role);
  localStorage.setItem(NAME_KEY, s.name);
  setUserEmail(s.role, s.email);

  // page guard: students can't open admin pages and vice versa
  const area = location.pathname.includes("/admin/") ? "admin" : location.pathname.includes("/student/") ? "student" : null;
  if (area && area !== s.role) { location.replace(`${root}${s.role}/dashboard.html`); await NEVER(); }

  try {
    const [assessments, feedback] = await Promise.all([cloudList("assessments", s), cloudList("feedback", s)]);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(assessments));
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(feedback));
  } catch (e) {
    cloudFailed("load your data", e);
  }
  return s;
}

// Runs the start-up above when Firebase is configured; in local mode SESSION stays null.
if (FIREBASE_ENABLED) setSession(await bootstrapFirebase());

// If the admin check itself failed (not "you're not an admin"), say so instead of silently downgrading.
if (SESSION && SESSION.lookupError) {
  setTimeout(() => showToast(
    `Couldn't confirm admin access for ${SESSION.email} (${SESSION.lookupError}), so you're signed in as a student. ` +
    `Check your connection and that the Firestore rules are published, then refresh.`, "error", 15000), 700);
}
