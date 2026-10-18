// ── app.js ───────────────────────────────────────────────────
// The ONE file every page imports from, e.g.
//      import { showToast, getAllAssessments } from "../js/app.js?v=6";
// It holds no code of its own: it only re-exports the helpers from the files below,
// so a page never needs to know which file a helper lives in.
//
// WHERE THINGS LIVE
//    config.js        fixed settings: backend address, names used to save data in the browser
//    session.js       who is signed in (SESSION) and their role (student / admin)
//    helpers.js       small helpers: safe text, dates, score colours, email check, toast pop-up
//    storage.js       saving / loading: assessments, feedback, settings, name, login email
//    backend.js       calls to the Flask server: PDF, emails, Excel file
//    participants.js  one summary row per participant (Participants page + Excel)
//    sidebar.js       the sidebar: name, role, sign-out / clear-data button
//    startup.js       runs once per page: Firebase sign-in check (does nothing in local mode)
//    firebase.js      Google sign-in + Firestore (firebase-config.js holds your project's keys)
//    icons.js         the line icons:  <i data-icon="history"></i>
//
// TWO MODES (decided by js/firebase-config.js)
//  * LOCAL mode  (config still has YOUR_... placeholders): no sign-in, the role is picked on the
//    landing page, data lives in this browser's localStorage.
//  * FIREBASE mode (config filled in): Google sign-in, everyone is a student unless
//    admins/<email> exists in Firestore, data lives in Firestore (the browser copy is just a cache).

import "./startup.js";   // runs first: finds out who is signed in before any page code runs

export { API_BASE, FIREBASE_MODE } from "./config.js";
export { SESSION, getRole, setRole } from "./session.js";
export { esc, fmtDate, scoreColor, scoreBadgeClass, scoreLabel, isValidEmail, showToast, resultNoticesHtml } from "./helpers.js";
export {
  getDisplayName, setDisplayName,
  saveAssessment, syncAssessment, removeAssessmentCloud, getAllAssessments, clearAllAssessments,
  saveFeedback, getAllFeedback, updateFeedback, deleteFeedback,
  getSettings, saveSettings, getAdminSettings, saveAdminSettings,
  getUserEmail, setUserEmail,
} from "./storage.js";
export { authHeaders, downloadPdf, sendResultEmail, sendComparisonEmail, downloadParticipantsXlsx } from "./backend.js";
export { RATING_BANDS, FEEDBACK_BASIS_TEXT, ratingLabel, isReviewed, participantKey, buildParticipantRows } from "./participants.js";
export { wireChrome, populateSidebarUser, signOut } from "./sidebar.js";
