  // Admin feedback: every message students sent. The admin can filter by status, reply,
  // mark items resolved (or reopen them) and delete them.
  import { wireChrome, getAllFeedback, updateFeedback, deleteFeedback, esc, fmtDate, showToast } from "../js/app.js?v=6";

  wireChrome("admin");   // fills in the sidebar and user info

  // ── Filter tabs: All / Open / Resolved ──────────────────────
  let statusFilter = "all";
  document.querySelectorAll("#status-tabs .tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#status-tabs .tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      statusFilter = btn.dataset.status;
      render();
    };
  });

  /** Draws the list for the selected filter, then connects the Save reply / Resolve / Delete buttons. */
  function render() {
    const all = getAllFeedback();
    const list = statusFilter === "all" ? all : all.filter(f => (statusFilter === "resolved" ? f.status === "resolved" : f.status !== "resolved"));
    const el = document.getElementById("feedback-list");

    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="message"></i></div><h3>No feedback here</h3><p>Nothing matches this filter yet.</p></div>`;
      return;
    }

    el.innerHTML = list.map(f => `
      <div class="feedback-item" id="fb-${f.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-weight:600;font-size:14px">${esc(f.author || "Student")}</span>
            <span class="badge badge-purple">${esc(f.category || "General")}</span>
          </div>
          <span style="font-size:12px;color:var(--text3)">${fmtDate(f.created_at)}</span>
        </div>
        <div class="rating-stars" role="img" aria-label="${f.rating || 0} out of 5">${Array.from({length:5},(_,i)=>`<i data-icon="star" class="${i<(f.rating || 0)?'on':''}"></i>`).join("")}</div>
        <p style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:12px">${esc(f.message)}</p>

        ${f.admin_reply ? `<div class="callout callout-blue" style="margin-bottom:12px"><strong style="color:var(--text)">Your reply:</strong> ${esc(f.admin_reply)}</div>` : ""}

        <div class="input-group" style="margin-bottom:10px">
          <textarea class="input-field reply-input" data-id="${f.id}" style="min-height:60px" placeholder="Write a reply…">${esc(f.admin_reply || "")}</textarea>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary reply-btn" data-id="${f.id}" style="padding:7px 14px;font-size:13px"><i data-icon="message"></i> Save reply</button>
          <button class="btn ${f.status === 'resolved' ? 'btn-secondary' : 'btn-success'} toggle-status-btn" data-id="${f.id}" style="padding:7px 14px;font-size:13px">
            ${f.status === "resolved" ? '<i data-icon="undo"></i> Reopen' : '<i data-icon="check"></i> Mark resolved'}
          </button>
          <button class="btn btn-danger delete-btn" data-id="${f.id}" style="padding:7px 14px;font-size:13px;margin-left:auto"><i data-icon="trash"></i> Delete</button>
        </div>
      </div>`).join("");

    // Save reply: stores the text typed in that item's reply box.
    document.querySelectorAll(".reply-btn").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const text = document.querySelector(`.reply-input[data-id="${id}"]`).value.trim();
        updateFeedback(id, { admin_reply: text, replied_at: new Date().toISOString() });
        showToast("Reply saved.", "success");
        render();
      };
    });
    // Mark resolved / Reopen: flips the status of that item.
    document.querySelectorAll(".toggle-status-btn").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const current = getAllFeedback().find(f => f.id === id);
        updateFeedback(id, { status: current.status === "resolved" ? "open" : "resolved" });
        render();
      };
    });
    // Delete: asks first, then removes that item.
    document.querySelectorAll(".delete-btn").forEach(btn => {
      btn.onclick = () => {
        if (!confirm("Delete this feedback item?")) return;
        deleteFeedback(btn.dataset.id);
        render();
      };
    });
  }

  render();   // run once when the page opens
