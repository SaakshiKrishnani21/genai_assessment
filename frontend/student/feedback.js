  // Student feedback: a form (star rating, category, message) and the list of feedback this student sent,
  // including any reply from an admin.
  import { wireChrome, getDisplayName, saveFeedback, getAllFeedback, esc, fmtDate, showToast } from "../js/app.js?v=6";

  wireChrome("student");   // fills in the sidebar and user info

  // ── Star rating ─────────────────────────────────────────────
  // Clicking star N sets the rating to N and highlights stars 1 to N.
  let rating = 0;
  document.querySelectorAll("#rating-stars .star").forEach(star => {
    star.onclick = () => {
      rating = Number(star.dataset.val);
      document.querySelectorAll("#rating-stars .star").forEach(s => s.classList.toggle("active", Number(s.dataset.val) <= rating));
    };
  });

  // ── Submit button: check the form, save the feedback, reset the form ──
  document.getElementById("submit-feedback-btn").onclick = () => {
    const message = document.getElementById("message-input").value.trim();
    const category = document.getElementById("category-select").value;
    if (!rating) { showToast("Select a star rating.", "error"); return; }
    if (!message) { showToast("Please write a message.", "error"); return; }

    saveFeedback({
      author: getDisplayName(),
      role: "student",
      rating, category, message,
    });

    document.getElementById("message-input").value = "";
    rating = 0;
    document.querySelectorAll("#rating-stars .star").forEach(s => s.classList.remove("active"));
    showToast("Feedback submitted. Thank you.", "success");
    renderList();
  };

  /** Shows this student's own feedback (newest first), with status and any admin reply. */
  function renderList() {
    const mine = getAllFeedback().filter(f => f.role === "student");
    const el = document.getElementById("feedback-list");
    if (!mine.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="message"></i></div><h3>No feedback yet</h3><p>Your submitted feedback will show up here, along with any admin replies.</p></div>`;
      return;
    }
    el.innerHTML = mine.map(f => `
      <div class="feedback-item">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span class="badge badge-purple">${esc(f.category)}</span>
          <span class="badge ${f.status === "resolved" ? "badge-green" : "badge-amber"}">${f.status === "resolved" ? "Resolved" : "Open"}</span>
          <span style="font-size:12px;color:var(--text3);margin-left:auto">${fmtDate(f.created_at)}</span>
        </div>
        <div class="rating-stars" role="img" aria-label="${f.rating} out of 5">${Array.from({length:5},(_,i)=>`<i data-icon="star" class="${i<(f.rating)?'on':''}"></i>`).join("")}</div>
        <p style="font-size:13px;color:var(--text2);line-height:1.6">${esc(f.message)}</p>
        ${f.admin_reply ? `<div class="callout callout-blue" style="margin-top:10px"><strong style="color:var(--text)">Admin reply:</strong> ${esc(f.admin_reply)}</div>` : ""}
      </div>`).join("");
  }

  renderList();   // run once when the page opens
