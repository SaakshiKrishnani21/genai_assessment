// ── helpers.js ───────────────────────────────────────────────
// Small helpers used by many pages: safe text, dates, score colours and labels,
// the email check, the toast pop-up and the off-topic / AI-text notice box.
import { icon } from "./icons.js";

// Makes user-written text safe to put inside HTML (so "<b>" shows as text, not as markup).
export function esc(s) {
  if (!s && s !== 0) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

// ── Score helpers (all scores are 0–10) ────────────────────────
export function scoreColor(score) {
  if (score >= 8) return "var(--green)";
  if (score >= 5) return "var(--amber)";
  return "var(--red)";
}
export function scoreBadgeClass(score) {
  if (score >= 8) return "badge-green";
  if (score >= 5) return "badge-amber";
  return "badge-red";
}
export function scoreLabel(score) {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Average";
  return "Needs work";
}

// Same format everywhere: an email needs something@something.xx
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((email || "").trim());
}

// ── Toast (small pop-up message in the corner) ─────────────────
export function showToast(message, type = "info", duration = 3500) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const icons = { success: "circle-check", error: "alert", info: "info" };
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `${icon(icons[type] || "info")}<span>${esc(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// Small HTML notice shown wherever a result/assessment is displayed:
// off-topic essays (forced 0) and essays flagged as AI-generated.
export function resultNoticesHtml(a) {
  let html = "";
  if (a && a.irrelevant) {
    html += `<div class="callout callout-red" style="margin-bottom:12px">${icon("ban")} <strong style="color:var(--text)">Off-topic essay: scored 0.</strong> The essay was not relevant to the assigned topic, so it was not evaluated.</div>`;
  }
  const ai = a && a.ai_generated;
  if (ai && ai.detected) {
    html += `<div class="callout callout-amber" style="margin-bottom:12px">${icon("bot")} <strong style="color:var(--text)">AI-generated text detected</strong> (${esc(ai.confidence)}% likelihood).${ai.reason ? " " + esc(ai.reason) : ""}</div>`;
  } else if (ai && ai.checked) {
    // Always show that the check ran, so a clean result is never mistaken for "check didn't run".
    html += `<div style="margin-bottom:12px;font-size:12.5px;color:var(--text3)">${icon("bot", "ic-sm")} AI-text check: ${esc(ai.confidence)}% likelihood of AI-generated text, not flagged.</div>`;
  }
  return html;
}
