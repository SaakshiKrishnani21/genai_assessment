  // Student settings: profile (name and email), defaults for new assessments, and clearing saved history.
  // Each toggle / dropdown saves itself immediately when changed; only the profile has a Save button.
  import { wireChrome, getDisplayName, setDisplayName, getUserEmail, setUserEmail, isValidEmail, getSettings, saveSettings, clearAllAssessments, showToast, FIREBASE_MODE } from "../js/app.js?v=6";

  wireChrome("student");   // fills in the sidebar and user info

  // ── Fill the page with the saved values ─────────────────────
  const DOMAINS = ["Computer Science","Electronics","Mechanical","Civil","Biotechnology","Information Technology","Environment","General"];
  document.getElementById("default-domain").innerHTML += DOMAINS.map(d => `<option value="${d}">${d}</option>`).join("");

  document.getElementById("name-input").value = getDisplayName() === "Guest" ? "" : getDisplayName();
  document.getElementById("user-email-input").value = getUserEmail("student");
  if (FIREBASE_MODE) { const em = document.getElementById("user-email-input"); em.readOnly = true; em.title = "Your Google-verified email (cannot be changed)"; }

  // Saved preferences (the new assessment page reads these as its starting choices)
  const settings = getSettings();
  document.getElementById("default-domain").value = settings.defaultDomain || "";
  document.getElementById("default-difficulty").value = settings.defaultDifficulty || "Medium";
  document.getElementById("toggle-alerts").checked = !!settings.scoreAlerts;

  // ── Profile: Save button ────────────────────────────────────
  document.getElementById("save-name-btn").onclick = () => {
    const name = document.getElementById("name-input").value.trim();
    if (!name) { showToast("Enter a display name first.", "error"); return; }
    const email = document.getElementById("user-email-input").value.trim();
    // Reads as: if an email was typed it must be valid; if it is empty, students are required to have one.
    // (The admin page has the same line with "admin", where an empty email is allowed.)
    if (email ? !isValidEmail(email) : "student" === "student") { showToast("Enter a valid email address.", "error"); return; }
    setDisplayName(name);
    if (email) setUserEmail("student", email);
    showToast("Profile saved.", "success");
    location.reload();
  };

  // ── Preferences: saved as soon as they change ───────────────
  document.getElementById("default-domain").onchange = e => saveSettings({ defaultDomain: e.target.value });
  document.getElementById("default-difficulty").onchange = e => saveSettings({ defaultDifficulty: e.target.value });
  document.getElementById("toggle-alerts").onchange = e => saveSettings({ scoreAlerts: e.target.checked });

  // ── Clear history ───────────────────────────────────────────
  document.getElementById("clear-history-btn").onclick = () => {
    if (confirm("Clear all locally saved assessments? This cannot be undone.")) {
      clearAllAssessments();
      showToast("Local history cleared.", "success");
    }
  };
