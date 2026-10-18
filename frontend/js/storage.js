// ── storage.js ───────────────────────────────────────────────
// Saving and loading everything the app remembers:
//    display name · assessments · feedback · settings · the login email
//
// Everything is kept in this browser (localStorage). In Firebase mode each change is ALSO sent to
// Firestore, and startup.js fills the browser copy from Firestore when the page opens, so the
// simple synchronous helpers below (getAllAssessments etc.) work the same in both modes.
import {
  HISTORY_KEY, NAME_KEY, FEEDBACK_KEY, SETTINGS_KEY, ADMIN_SETTINGS_KEY, UID_KEY, ROLE_KEY,
} from "./config.js";
import { SESSION, getRole } from "./session.js";
import { cloudUpsert, cloudDelete } from "./firebase.js";
import { showToast } from "./helpers.js";

// ── Cloud helpers ───────────────────────────────────────────────
export function cloudFailed(what, err) {
  console.error("[firestore]", err);
  const denied = err && (err.code === "permission-denied");
  showToast(`Couldn't ${what} in Firebase${denied ? " (permission denied - check the Firestore rules)" : ""}.`, "error", 6000);
}

// Removes everything saved in this browser for the signed-in person (used on sign-out / account change).
export function wipePrivateCache() {
  [HISTORY_KEY, FEEDBACK_KEY, ROLE_KEY, NAME_KEY, UID_KEY, "genai_assess_email_student", "genai_assess_email_admin", "genai_assess_email"]
    .forEach(k => localStorage.removeItem(k));
}

// ── Display name ───────────────────────────────────────────────
export function getDisplayName() {
  return localStorage.getItem(NAME_KEY) || "Guest";
}
export function setDisplayName(name) {
  localStorage.setItem(NAME_KEY, name);
}

// ── Assessments (kept in this browser; also sent to Firestore in Firebase mode) ──
export function saveAssessment(record) {
  const list = getAllAssessments();
  const withMeta = {
    id: "a_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    created_at: new Date().toISOString(),
    ...record,
    // Firebase mode: owner + the Google-VERIFIED email always come from the session, never from the page.
    ...(SESSION ? { uid: SESSION.uid, student_email: SESSION.email, student_name: record.student_name || SESSION.name } : {}),
  };
  list.unshift(withMeta);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  if (SESSION) cloudUpsert("assessments", withMeta).catch(e => cloudFailed("save the assessment", e));
  return withMeta;
}

/** Push one (already locally updated) assessment to Firestore. No-op in local mode. */
export function syncAssessment(a) {
  if (SESSION && a) return cloudUpsert("assessments", a).catch(e => cloudFailed("save your changes", e));
}
/** Delete one assessment from Firestore (the page already removed it from the local cache). */
export function removeAssessmentCloud(id) {
  if (SESSION) return cloudDelete("assessments", id).catch(e => cloudFailed("delete the assessment", e));
}

export function getAllAssessments() {
  // If the saved data is missing or damaged, fall back to an empty list.
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function clearAllAssessments() {
  // Firebase mode: a student clears only THEIR OWN submissions. Admin pages never call this in Firebase mode.
  if (SESSION && SESSION.role === "student") {
    getAllAssessments().forEach(a => removeAssessmentCloud(a.id));
  }
  localStorage.removeItem(HISTORY_KEY);
}

// ── Feedback ───────────────────────────────────────────────────
// Students submit feedback about the platform; admins view + reply to it.
// Same as assessments: kept in this browser, and also sent to Firestore in Firebase mode.
export function saveFeedback(record) {
  const list = getAllFeedback();
  const withMeta = {
    id: "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    created_at: new Date().toISOString(),
    status: "open",          // "open" | "resolved"
    admin_reply: "",
    replied_at: null,
    ...record,
    ...(SESSION ? { uid: SESSION.uid, student_email: SESSION.email } : {}),
  };
  list.unshift(withMeta);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
  if (SESSION) cloudUpsert("feedback", withMeta).catch(e => cloudFailed("send your feedback", e));
  return withMeta;
}

export function getAllFeedback() {
  try {
    return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "[]");
  } catch {
    return [];
  }
}

export function updateFeedback(id, patch) {
  const list = getAllFeedback().map(f => f.id === id ? { ...f, ...patch } : f);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
  const updated = list.find(f => f.id === id) || null;
  if (SESSION && updated) cloudUpsert("feedback", updated).catch(e => cloudFailed("save the feedback reply", e));
  return updated;
}

export function deleteFeedback(id) {
  const list = getAllFeedback().filter(f => f.id !== id);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
  if (SESSION) cloudDelete("feedback", id).catch(e => cloudFailed("delete the feedback", e));
}

// ── Settings (kept in this browser) ────────────────────────────
// Student-facing preferences: defaults for New Assessment + notification
// toggles (the toggles are locally simulated — there's no email/push
// backend behind them, same spirit as the rest of this simplified app).
const DEFAULT_SETTINGS = {
  defaultDomain: "",
  defaultDifficulty: "Medium",
  emailNotifications: true,
  scoreAlerts: true,
};
export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

// Admin-facing platform preferences: used to flag low scores in the
// admin dashboard/review views.
const DEFAULT_ADMIN_SETTINGS = {
  lowScoreThreshold: 5,
  suspiciousExitThreshold: 1,   // leaving full screen this many times (or more) during a test = suspicious
  feedbackBasis: "average",      // which score gives a participant's Feedback word: "admin", "average" (of AI and admin) or "lower"
  autoFlagLowScores: true,
  weeklyDigest: false,
  reportFooterNote: "",
};
export function getAdminSettings() {
  try {
    return { ...DEFAULT_ADMIN_SETTINGS, ...JSON.parse(localStorage.getItem(ADMIN_SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }
}
export function saveAdminSettings(patch) {
  const merged = { ...getAdminSettings(), ...patch };
  localStorage.setItem(ADMIN_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

// ── The email given at login ───────────────────────────────────
// (The address is remembered in this browser; the backend sends reports to it.)
const EMAIL_KEY = "genai_assess_email";            // legacy key (student), still read as a fallback
const emailKey = role => `genai_assess_email_${role}`;
// The email given at login, stored per role so an admin login never overwrites the student's address.
export function getUserEmail(role = getRole()) {
  return localStorage.getItem(emailKey(role)) || (role === "student" ? localStorage.getItem(EMAIL_KEY) || "" : "");
}
export function setUserEmail(role, email) {
  localStorage.setItem(emailKey(role), (email || "").trim());
}
