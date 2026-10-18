// ── sidebar.js ───────────────────────────────────────────────
// The sidebar on every page: hamburger button (phones), the name / role / initials of the
// person, and the button beside them: sign out (Firebase mode) or clear local data (local mode).
import { FIREBASE_ENABLED, signOutUser } from "./firebase.js";
import { icon } from "./icons.js";
import { SESSION, getRole, setRole } from "./session.js";
import { getDisplayName, setDisplayName, clearAllAssessments, wipePrivateCache } from "./storage.js";
import { showToast } from "./helpers.js";

// ── Sidebar chrome (hamburger + overlay + user pill) ──────────
// `role` ("student" | "admin") is optional — pass it from pages that live
// under /student/ or /admin/ so the visited section is remembered as the
// active role (used by the role switcher on the landing page).
export function wireChrome(role) {
  if (role && !FIREBASE_ENABLED) setRole(role);
  const hamburger = document.getElementById("hamburger-btn");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sb-overlay");
  if (hamburger && sidebar && overlay) {
    hamburger.onclick = () => { sidebar.classList.toggle("open"); overlay.classList.toggle("show"); };
    overlay.onclick = () => { sidebar.classList.remove("open"); overlay.classList.remove("show"); };
  }
  populateSidebarUser();
}

/** Turns an element into an icon button that also works with the keyboard. */
function makeIconButton(el, iconName, label, onClick) {
  el.innerHTML = icon(iconName);
  el.title = label;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", label);
  el.tabIndex = 0;
  el.style.cursor = "pointer";
  el.onclick = onClick;
  el.onkeydown = e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); }
  };
}

/** Local mode: ask first, then delete every assessment saved in this browser. */
function clearLocalHistory() {
  if (!confirm("Clear all locally saved assessments? This cannot be undone.")) return;
  clearAllAssessments();
  showToast("Local history cleared.", "success");
  setTimeout(() => location.reload(), 600);
}

/** Fills in the name, role and initials in the sidebar, and sets up the
 *  button next to them: sign out (Firebase mode) or clear local data (local mode). */
export function populateSidebarUser() {
  const name = getDisplayName();
  const role = getRole();
  const roleName = role === "admin" ? "Admin" : "Student";
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "G";

  document.querySelectorAll(".user-name").forEach(el => {
    el.textContent = name;
    if (!SESSION) { el.style.cursor = "pointer"; el.title = "Click to rename"; el.onclick = renamePrompt; }
  });
  document.querySelectorAll(".user-role").forEach(el => {
    el.textContent = `${roleName} (${SESSION ? SESSION.email : "local session"})`;
  });
  document.querySelectorAll(".user-avatar").forEach(el => el.textContent = initials);

  if (!SESSION) {
    document.querySelectorAll(".logout-btn").forEach(el =>
      makeIconButton(el, "trash", "Clear all local assessment history", clearLocalHistory));
    return;
  }

  // Firebase mode: the icon button and the "Switch role" link both sign out.
  const doSignOut = async e => { e?.preventDefault(); await signOut(); };
  document.querySelectorAll(".logout-btn").forEach(el => makeIconButton(el, "log-out", "Sign out", doSignOut));
  document.querySelectorAll('a[href$="index.html"]').forEach(a => {
    if (/switch role/i.test(a.textContent)) {
      a.innerHTML = icon("log-out", "ic-sm") + " Sign out";
      a.onclick = doSignOut;
    }
  });
}

/** Firebase mode: sign out, wipe the local cache, go back to the login page. */
export async function signOut() {
  try { await signOutUser(); } catch (e) { console.error(e); }
  wipePrivateCache();
  location.href = (/\/(student|admin)\//.test(location.pathname) ? "../" : "./") + "index.html";
}

function renamePrompt() {
  const current = getDisplayName();
  const next = prompt("Display name:", current === "Guest" ? "" : current);
  if (next && next.trim()) {
    setDisplayName(next.trim());
    populateSidebarUser();
  }
}
