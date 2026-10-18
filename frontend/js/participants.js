// ── participants.js ──────────────────────────────────────────
// One summary row per participant (student), for the Participants page and the Excel file.
import { getAllAssessments, getAdminSettings } from "./storage.js";

// The Feedback word of a participant comes from ONE score (see FEEDBACK_BASIS_TEXT below, chosen in Admin > Settings):
//   below 5 = Need improvement | 5 to 6.9 = Good | 7 to 8.4 = Very good | 8.5 and up = Excellent
// A participant with no reviewed essay yet is "Pending review".
//
// BLIND REVIEW: admins must not see AI scores for essays they have not reviewed yet. So the AI average
// (and the AI dimension averages) only use essays the admin HAS reviewed. That also keeps the two averages comparable.
export const RATING_BANDS = [
  { min: 8.5, label: "Excellent" },
  { min: 7,   label: "Very good" },
  { min: 5,   label: "Good" },
  { min: 0,   label: "Need improvement" },
];
// Which score gives the Feedback word. The words are used on the Participants page and in the Excel file.
export const FEEDBACK_BASIS_TEXT = {
  admin: "admin average",
  average: "average of AI and admin",
  lower: "lower of AI and admin",
};
export function ratingLabel(score) {
  const n = Number(score);
  if (score === null || score === undefined || score === "" || isNaN(n)) return "-";
  return (RATING_BANDS.find(b => n >= b.min) || RATING_BANDS[RATING_BANDS.length - 1]).label;
}

const SCORE_DIMS = ["semantic", "stylistic", "pragmatic"];
const toNum = v => (v === "" || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
const mean = arr => { const v = arr.map(toNum).filter(x => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const round = (x, d = 2) => x === null ? null : Math.round(x * 10 ** d) / 10 ** d;

/** The one score that decides a participant's Feedback word, following the "Feedback is based on" setting. */
function feedbackScore(admin, ai, basis) {
  if (ai === null || basis === "admin") return admin;
  if (basis === "lower") return Math.min(admin, ai);
  return (admin + ai) / 2;                                   // "average" (the default)
}

/** True once an admin has reviewed (scored) the essay. */
export const isReviewed = a => toNum(a.admin_score) !== null;

/** Who wrote an essay: the same email (best), else the same login id, else the same name = the same participant. */
export const participantKey = a => (a.student_email || a.uid || a.student_name || "unknown").toLowerCase().trim();

/** Groups assessments by participant and works out averages, rating and the suspicious flag. */
export function buildParticipantRows(list = getAllAssessments(), settings = getAdminSettings()) {
  const limit = Math.max(1, Number(settings.suspiciousExitThreshold) || 1);
  const groups = new Map();
  for (const a of list) {
    const key = participantKey(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const rows = [];
  for (const [key, items] of groups) {
    const reviewed = items.filter(isReviewed);
    const first = items.find(a => a.student_name) || items[0];
    const ai = mean(reviewed.map(a => a.avg_score));
    const admin = mean(reviewed.map(a => a.admin_score));
    // Attempts to leave full screen in one essay: real exits or Esc presses, whichever is larger.
    // (Leaving full screen by holding Esc is BOTH, so they are never added together.)
    const exitsOf = a => Math.max(Number(a.integrity?.fullscreen_exits) || 0, Number(a.integrity?.escape_presses) || 0);
    const exits = items.reduce((sum, a) => sum + exitsOf(a), 0);
    rows.push({
      key,
      name: first.student_name || (first.student_email || "").split("@")[0] || "Unknown",
      email: first.student_email || "",
      submissions: items.length,
      reviewed: reviewed.length,
      ai_avg: round(ai),
      admin_avg: round(admin),
      rating: admin !== null ? ratingLabel(feedbackScore(admin, ai, settings.feedbackBasis)) : "Pending review",
      fullscreen_exits: exits,
      flagged_submissions: items.filter(a => exitsOf(a) > 0).length,   // how many essays had at least one exit
      suspicious: exits >= limit,
      ai_dims: Object.fromEntries(SCORE_DIMS.map(d => [d, round(mean(reviewed.map(a => a[d]?.score)))])),
      admin_dims: Object.fromEntries(SCORE_DIMS.map(d => [d, round(mean(reviewed.map(a => a.admin_dims?.[d])))])),
    });
  }
  return rows.sort((x, y) => x.name.localeCompare(y.name));
}
