// ── backend.js ───────────────────────────────────────────────
// Every call from the browser to the Flask server (backend/app.py):
//    downloadPdf · sendResultEmail · sendComparisonEmail · downloadParticipantsXlsx
import { FIREBASE_ENABLED, getIdToken } from "./firebase.js";
import { API_BASE } from "./config.js";
import { getAdminSettings } from "./storage.js";

/** Authorization header for the Flask backend (empty in local mode). */
export async function authHeaders() {
  if (!FIREBASE_ENABLED) return {};
  const t = await getIdToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// ── The two shared building blocks ─────────────────────────────
/** POSTs JSON to the backend (adds the sign-in header when needed). */
async function post(path, payload) {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
}

/** POST, then give back the JSON answer (used by the email routes). */
async function postForJson(path, payload) {
  const res = await post(path, payload);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server ${res.status}`);
  return body;
}

/** POST, then save the file the backend sends back (used by the PDF and Excel routes). */
async function postForFile(path, payload, filename) {
  const res = await post(path, payload);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── PDF report ─────────────────────────────────────────────────
// Hits POST /download-pdf and saves the returned PDF.
// payload.report_type is "ai", "admin" or "comparison"; see backend/reports.py
// for exactly which fields each type needs.
export function downloadPdf(payload, filename) {
  return postForFile("/download-pdf", payload, filename);
}

// ── Emails (sent by the backend through n8n, see ../n8n/README.md) ──
/** The student's own AI result. */
export function sendResultEmail(payload) {
  return postForJson("/send-email", payload);
}

/** The AI-vs-Admin comparison (+ name, AI marks, admin marks). The backend builds the 3 PDFs. */
export function sendComparisonEmail(payload) {
  return postForJson("/send-comparison-email", payload);
}

// ── Excel file for the Participants page ───────────────────────
/** Asks the backend to build the Excel file for these rows and saves it to the computer. Admin only.
 *  extra.essays = the essays behind the rows (for the dashboard charts), extra.filters = text saying which filters were on,
 *  extra.feedbackBasis = which score gives the Feedback word (printed under the Participants sheet). */
export function downloadParticipantsXlsx(rows, settings = getAdminSettings(), extra = {}) {
  const payload = { rows, essays: extra.essays || [], filters: extra.filters || "", feedback_basis: extra.feedbackBasis || "", exit_threshold: Number(settings.suspiciousExitThreshold) || 1 };
  return postForFile("/export-excel", payload, `participants_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
