  // Admin settings: profile (name and email), review rules, report footer note, and clearing saved submissions.
  // Each toggle / box saves itself immediately when changed; only the profile has a Save button.
  import { wireChrome, getDisplayName, setDisplayName, getUserEmail, setUserEmail, isValidEmail, getAdminSettings, saveAdminSettings, clearAllAssessments, showToast, FIREBASE_MODE } from "../js/app.js?v=6";

  wireChrome("admin");   // fills in the sidebar and user info

  // ── Fill the page with the saved values ─────────────────────
  document.getElementById("name-input").value = getDisplayName() === "Guest" ? "" : getDisplayName();
  document.getElementById("user-email-input").value = getUserEmail("admin");
  if (FIREBASE_MODE) { const em = document.getElementById("user-email-input"); em.readOnly = true; em.title = "Your Google-verified email (cannot be changed)"; }

  // Saved admin preferences (the dashboard and review center read these)
  const settings = getAdminSettings();
  document.getElementById("threshold-input").value = settings.lowScoreThreshold;
  document.getElementById("exit-limit-input").value = settings.suspiciousExitThreshold;
  document.getElementById("feedback-basis-input").value = settings.feedbackBasis;
  document.getElementById("toggle-autoflag").checked = !!settings.autoFlagLowScores;
  document.getElementById("toggle-digest").checked = !!settings.weeklyDigest;
  document.getElementById("footer-note").value = settings.reportFooterNote || "";

  // ── Profile: Save button ────────────────────────────────────
  document.getElementById("save-name-btn").onclick = () => {
    const name = document.getElementById("name-input").value.trim();
    if (!name) { showToast("Enter a display name first.", "error"); return; }
    const email = document.getElementById("user-email-input").value.trim();
    // Reads as: if an email was typed it must be valid; an empty email is fine for admins
    // (the student page has the same line with "student", where an email is required).
    if (email ? !isValidEmail(email) : "admin" === "student") { showToast("Enter a valid email address.", "error"); return; }
    setDisplayName(name);
    if (email) setUserEmail("admin", email);
    showToast("Profile saved.", "success");
    location.reload();
  };

  // ── Review rules: saved as soon as they change ──────────────
  // The low-score limit is kept between 0 and 10.
  document.getElementById("threshold-input").onchange = e => {
    const val = Math.max(0, Math.min(10, Number(e.target.value) || 0));
    e.target.value = val;
    saveAdminSettings({ lowScoreThreshold: val });
  };
  document.getElementById("feedback-basis-input").onchange = e => saveAdminSettings({ feedbackBasis: e.target.value });
  document.getElementById("exit-limit-input").onchange = e => {
    const val = Math.max(1, Math.min(20, Math.round(Number(e.target.value)) || 1));
    e.target.value = val;
    saveAdminSettings({ suspiciousExitThreshold: val });
  };
  document.getElementById("toggle-autoflag").onchange = e => saveAdminSettings({ autoFlagLowScores: e.target.checked });
  document.getElementById("toggle-digest").onchange = e => saveAdminSettings({ weeklyDigest: e.target.checked });
  document.getElementById("footer-note").onchange = e => saveAdminSettings({ reportFooterNote: e.target.value });

  // ── Clear submissions (blocked in Firebase mode so one admin cannot wipe everyone's data) ──
  document.getElementById("clear-history-btn").onclick = () => {
    if (FIREBASE_MODE) { showToast("Deleting every student's data from here is disabled in Firebase mode. Delete individual submissions in Review center.", "error", 6000); return; }
    if (confirm("Clear all locally saved submissions? This affects the student view too, since they share the same local storage. This cannot be undone.")) {
      clearAllAssessments();
      showToast("All submissions cleared.", "success");
    }
  };
