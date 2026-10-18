// ── config.js ────────────────────────────────────────────────
// The few fixed settings of the front end. Nothing here runs; it is only read by the other files.
import { FIREBASE_ENABLED } from "./firebase.js";

export const API_BASE = "https://scuba-analyzer-api.onrender.com";   // address of the Flask backend (backend/app.py)
export const FIREBASE_MODE = FIREBASE_ENABLED;

// Names under which data is saved in the browser (localStorage). Changing one
// would make previously saved data disappear, so keep them as they are.
export const HISTORY_KEY = "genai_assess_history";
export const NAME_KEY = "genai_assess_name";
export const ROLE_KEY = "genai_assess_role";
export const FEEDBACK_KEY = "genai_assess_feedback";
export const SETTINGS_KEY = "genai_assess_settings";
export const ADMIN_SETTINGS_KEY = "genai_assess_admin_settings";
export const UID_KEY = "genai_assess_uid";