  // ════════════════════════════════════════════════════════════════
  // Review center (admin). Essays are reviewed BLIND:
  //   - Before the admin submits a review, the AI scores and feedback are hidden.
  //   - After submitting, the page shows AI vs admin side by side, saves the review,
  //     and emails the three PDF reports to the student.
  //
  // Layout: list of essays on the left, details of the selected essay on the right.
  // Sections below: settings and helpers, list, pieces of the detail panel (small
  // functions that return HTML), then openDetail() which puts it all together.
  // ════════════════════════════════════════════════════════════════
  import { wireChrome, getAllAssessments, esc, fmtDate, scoreColor, scoreBadgeClass, scoreLabel, resultNoticesHtml, syncAssessment, removeAssessmentCloud, downloadPdf, showToast, getAdminSettings, sendComparisonEmail, isValidEmail } from "../js/app.js?v=6";

  wireChrome("admin");   // fills in the sidebar and user info

  // ── Settings and small helpers ──────────────────────────────
  const lowThreshold = Number(getAdminSettings().lowScoreThreshold) || 5;
  // True once the admin has entered a score for this assessment.
  const hasReview = a => a.admin_score !== undefined && a.admin_score !== null && a.admin_score !== "";
  // The three dimensions the admin scores: [key, label, short hint shown under the label]
  const DIMS = [["semantic","Semantic","Ideas, accuracy and depth of content"],["stylistic","Stylistic","Language, tone, grammar and flow"],["pragmatic","Pragmatic","Purpose, structure and audience fit"]];
  const AI_C = "var(--peach)", AD_C = "var(--plum)";   // bar colours
  const AI_TEXT = "var(--peach-ink)";                     // darker peach for numbers, easier to read
  // Domain names for the filter dropdown
  const DOMAINS = ["Computer Science","Electronics","Mechanical","Civil","Biotechnology","Information Technology","Environment","General"];
  document.getElementById("filter-domain").innerHTML += DOMAINS.map(d => `<option value="${d}">${d}</option>`).join("");

  let allAssessments = getAllAssessments();
  let filtered = allAssessments;
  // Saves the whole list back into the browser.
  const persist = () => localStorage.setItem("genai_assess_history", JSON.stringify(allAssessments));
  // Turns a value into a number, or null if it is empty or not a number.
  const num = v => (v === "" || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
  // Describes how far apart the AI and admin scores are: returns [words, colour].
  //   0 to 1 point apart = close, 1 to 2 = moderate, more than 2 = significant
  const agree = d =>
    d === null ? ["", "var(--text2)"]
    : Math.abs(d) <= 1 ? ["Close agreement", "var(--green)"]
    : Math.abs(d) <= 2 ? ["Moderate difference", "var(--amber)"]
    : ["Significant difference", "var(--red)"];

  // ── The list on the left ────────────────────────────────────
  // Re-filter whenever the search text or domain changes.
  document.getElementById("search-input").oninput = applyFilters;
  document.getElementById("filter-domain").onchange = applyFilters;
  /** Keeps only essays matching the search text and domain, then redraws the list. */
  function applyFilters() {
    const q = document.getElementById("search-input").value.toLowerCase();
    const d = document.getElementById("filter-domain").value;
    filtered = allAssessments.filter(a => (!q || (a.topic || "").toLowerCase().includes(q)) && (!d || a.domain === d));
    renderList(filtered);
  }

  /** Draws one card per essay, with badges showing whether it has been reviewed. */
  function renderList(list) {
    const el = document.getElementById("assessment-list");
    if (!list.length) { el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="file-text"></i></div><h3>No assessments found</h3><p>Try a different filter, or wait for students to submit assessments.</p></div>`; return; }
    el.innerHTML = list.map(a => {
      const rev = hasReview(a);
      return `
      <div class="assessment-card" onclick="openDetail('${a.id}')">
        <div class="topic">${esc(a.topic)}</div>
        <p style="font-size:13px;color:var(--text2);margin:6px 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc((a.essay||"").slice(0,110))}…</p>
        <div class="meta">
          ${rev ? `<span class="badge ${scoreBadgeClass(a.avg_score)}">AI ${a.avg_score}</span><span class="badge ${scoreBadgeClass(a.admin_score)}">Admin ${a.admin_score}</span>` : ""}
          ${a.domain ? `<span class="badge badge-purple" style="font-size:11px">${esc(a.domain)}</span>` : ""}
          <span class="badge ${rev ? "badge-green" : "badge-amber"}" style="font-size:11px">${rev ? "Reviewed" : "Awaiting your review"}</span>
          ${rev && Number(a.avg_score) < lowThreshold ? `<span class="badge badge-red" style="font-size:11px"><i data-icon="flag"></i> Flagged</span>` : ""}
          <span style="font-size:12px;color:var(--text3);margin-left:auto">${fmtDate(a.created_at)}</span>
        </div>
      </div>`;
    }).join("");
  }

  // ── Pieces of the detail panel (each returns HTML) ──────────
  // How the test ended: integrity info only (not an AI result, so it does not break blind review).
  const integrityHtml = a => {
    const i = a.integrity; if (!i) return "";
    const parts = [];
    if (i.ended_by === "tab") parts.push("test ended after leaving the window");
    else if (i.ended_by === "time") parts.push("auto-submitted at the time limit");
    if (i.tab_switches > 0) parts.push(`left the test window ${i.tab_switches}×`);
    if (i.fullscreen_exits > 0) parts.push(`left full screen ${i.fullscreen_exits}×`);
    if (i.escape_presses > 0) parts.push(`pressed Esc ${i.escape_presses}× (tried to leave full screen)`);
    return parts.length ? `<div style="margin-top:8px;font-size:12.5px;color:var(--amber)"><i data-icon="alert"></i> ${parts.join("; ")}</div>` : "";
  };

  // Topic, domain, date and student name.
  const headerHtml = a => `
    <div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Topic</div>
      <div style="font-weight:600;font-size:14px;line-height:1.4">${esc(a.topic)}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
        ${a.domain ? `<span class="badge badge-purple" style="font-size:11px">${esc(a.domain)}</span>` : ""}
        <span style="font-size:12px;color:var(--text3)">${fmtDate(a.created_at)}${a.student_name ? ", " + esc(a.student_name) : ""}</span>
      </div>
      ${integrityHtml(a)}
    </div>`;

  // The essay text in a scrollable box of height h.
  const essayHtml = (a, h) => `<div><div style="font-size:12px;color:var(--text2);margin-bottom:6px">Essay</div><div class="essay-display" style="max-height:${h}px">${esc(a.essay)}</div></div>`;

  // The review form: three score boxes, feedback, student email and the save button.
  const formHtml = a => {
    const ad = a.admin_dims || {};
    return `
      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px"><i data-icon="clipboard-check"></i> ${hasReview(a) ? "Edit your review" : "Your review"}</div>
        <div class="dimgrid">${DIMS.map(([k, l, d]) => `
          <div><label>${l}</label><small>${d}</small>
          <input type="number" id="dim-${k}" class="input-field" min="0" max="10" step="0.5" placeholder="0-10" value="${ad[k] ?? ""}" style="text-align:center"/></div>`).join("")}
        </div>
        <div class="overall"><span style="font-size:12px;color:var(--text2)">Overall (average of the three)</span><b id="overall-val" style="color:var(--text3)">—</b></div>
        <div class="input-group" style="margin-bottom:12px"><label>Your feedback</label>
          <textarea id="admin-feedback-input" class="input-field" style="min-height:90px" placeholder="What worked, what to improve…">${esc(a.admin_feedback || "")}</textarea></div>
        ${a.student_email
          ? `<div style="font-size:12.5px;color:var(--text2);margin-bottom:12px"><i data-icon="mail"></i> On save, all reports are emailed to <b style="color:var(--text)">${esc(a.student_email)}</b>.${a.reports_emailed_at ? `<br><span style="color:var(--green)"><i data-icon="check"></i> Last emailed ${esc(fmtDate(a.reports_emailed_at))}</span>` : ""}</div>`
          : `<div class="input-group" style="margin-bottom:12px"><label>Student email <span style="font-weight:400;color:var(--text3)">(none captured, enter once)</span></label><input type="email" id="student-email-input" class="input-field" placeholder="student@example.com"/></div>`}
        <button class="btn btn-primary btn-full" id="save-btn">${hasReview(a) ? "Update review and resend reports" : "Submit review and reveal AI comparison"}</button>
      </div>`;
  };

  // AI vs admin: three summary boxes, then a pair of bars per dimension. Only shown after the review is saved.
  const compareHtml = a => {
    const ai = num(a.avg_score), adm = num(a.admin_score), d = ai !== null && adm !== null ? adm - ai : null;
    const [lab, col] = agree(d), ad = a.admin_dims;
    const row = (label, x, y) => `<div class="cmp"><div style="font-size:12.5px;font-weight:600">${label}</div>
      <div><div class="tr"><div style="width:${(x||0)*10}%;background:${AI_C}"></div></div><div class="tr"><div style="width:${(y||0)*10}%;background:${AD_C}"></div></div></div>
      <div class="v"><span style="color:${AI_TEXT}">${x ?? "-"}</span><br><span style="color:${AD_C}">${y ?? "-"}</span></div></div>`;
    const rows = (ad ? DIMS.map(([k, l]) => row(l, num((a[k] || {}).score), num(ad[k]))) : []).concat(row("Overall", ai, adm)).join("");
    return `
      <div class="kpis">
        <div class="kpi"><small>AI score</small><b style="color:${AI_TEXT}">${a.avg_score}</b><i>${scoreLabel(a.avg_score)}</i></div>
        <div class="kpi"><small>Your score</small><b style="color:${AD_C}">${a.admin_score}</b><i>${scoreLabel(a.admin_score)}</i></div>
        <div class="kpi"><small>Difference</small><b style="color:${col}">${d === null ? "-" : (d > 0 ? "+" : "") + d.toFixed(2)}</b><i>${lab}</i></div>
      </div>
      <div><div style="display:flex;gap:14px;font-size:11px;color:var(--text2);margin-bottom:2px"><span><span style="color:${AI_C}">&#9632;</span> AI</span><span><span style="color:${AD_C}">&#9632;</span> You</span></div>${rows}</div>`;
  };

  // Collapsible "AI evaluation details" (scores, feedback, corrections). Only shown after the review is saved.
  const aiDetailsHtml = a => {
    const corr = c => (!c || !c.length) ? `<p style="font-size:12px;color:var(--text3);font-style:italic;margin:2px 0 12px">No line-level issues flagged.</p>` :
      `<div style="margin:4px 0 12px">${c.map(x => `<div class="correction-card"><div class="c-original">"${esc(x.original_text)}"</div><div class="c-row c-expected"><span class="c-tag">Expected</span><span>${esc(x.expected)}</span></div><div class="c-row c-correction"><span class="c-tag">Correction</span><span>${esc(x.correction)}</span></div></div>`).join("")}</div>`;
    return `<details class="ai"><summary><i data-icon="bot"></i> AI evaluation details</summary><div style="margin-top:12px">
      ${DIMS.map(([k, l]) => { const d = a[k] || {}, c = scoreColor(d.score || 0);
        return `<div class="breakdown-row"><div class="label" style="width:80px">${l}</div><div class="bar-wrap"><div class="bar-fill" style="width:${(d.score||0)*10}%;background:${c}"></div></div><div class="score-val" style="color:${c}">${d.score}/10</div></div>
        <p style="font-size:12px;color:var(--text2);line-height:1.55;margin:2px 0 8px">${esc(d.feedback)}</p>${corr(d.corrections)}`; }).join("")}
      ${resultNoticesHtml(a)}
      ${a.overall_feedback ? `<div class="callout callout-blue"><strong style="color:var(--text)">AI overall feedback:</strong> ${esc(a.overall_feedback)}</div>` : ""}</div></details>`;
  };

  // ── Showing one essay ───────────────────────────────────────
  /** Builds the right-hand panel for one essay and connects its buttons. (On `window` because the cards call it from onclick.) */
  window.openDetail = function (id) {
    const a = allAssessments.find(x => x.id === id);
    const panel = document.getElementById("detail-panel");
    if (!a) { panel.innerHTML = `<div style="color:var(--red);padding:20px">Not found.</div>`; return; }
    const rev = hasReview(a);

    panel.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px">
      ${headerHtml(a)}
      ${rev ? compareHtml(a) : `<div class="blind"><i data-icon="eye-off"></i> <b>Blind review.</b> AI scores, feedback and flags are hidden so your judgement stays independent. They appear, side by side with yours, once you submit.</div>`}
      ${essayHtml(a, rev ? 160 : 340)}
      ${rev ? aiDetailsHtml(a) : ""}
      ${rev ? `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <button class="btn btn-secondary" data-rep="comparison" style="font-size:12px;padding:9px 6px"><i data-icon="download"></i> Comparison</button>
        <button class="btn btn-secondary" data-rep="ai" style="font-size:12px;padding:9px 6px"><i data-icon="download"></i> AI report</button>
        <button class="btn btn-secondary" data-rep="admin" style="font-size:12px;padding:9px 6px"><i data-icon="download"></i> My report</button></div>` : ""}
      ${formHtml(a)}
      <button class="btn btn-danger btn-full" id="delete-entry-btn"><i data-icon="trash"></i> Delete</button></div>`;

    // The data sent to the backend to build a PDF or an email.
    const reportData = () => ({
      domain: a.domain, topic: a.topic, essay: a.essay, name: a.student_name || "Student",
      semantic: a.semantic, stylistic: a.stylistic, pragmatic: a.pragmatic, avg_score: a.avg_score, overall_feedback: a.overall_feedback,
      admin_score: a.admin_score, admin_feedback: a.admin_feedback, admin_dims: a.admin_dims || null, footer_note: a.footer_note || "",
      irrelevant: !!a.irrelevant, ai_generated: a.ai_generated || null,
    });
    // Download buttons (comparison / AI report / my report): ask the backend for the PDF.
    panel.querySelectorAll("[data-rep]").forEach(btn => btn.onclick = async () => {
      const t = btn.dataset.rep;
      btn.disabled = true;
      try { await downloadPdf({ ...reportData(), report_type: t }, t + "_report.pdf"); }
      catch (err) { showToast("Download failed: " + err.message, "error"); }
      finally { btn.disabled = false; }
    });

    // Live "Overall" number under the three score boxes: the average, once all three are filled in.
    const inputs = DIMS.map(([k]) => document.getElementById("dim-" + k));
    const updateOverall = () => {
      const v = inputs.map(i => num(i.value)), el = document.getElementById("overall-val");
      if (v.some(x => x === null)) { el.textContent = "—"; el.style.color = "var(--text3)"; return; }
      const avg = Math.round(v.reduce((s, x) => s + x, 0) / 3 * 10) / 10;
      el.textContent = avg + "/10";
      el.style.color = scoreColor(avg);
    };
    inputs.forEach(i => i.oninput = updateOverall);
    updateOverall();

    // Save: (1) check the form, (2) store the review, (3) email the reports, (4) reveal the AI comparison.
    document.getElementById("save-btn").onclick = async () => {
      // 1) Check the form: three scores from 0 to 10, and some feedback.
      const vals = inputs.map(i => num(i.value));
      const feedback = document.getElementById("admin-feedback-input").value.trim();
      if (vals.some(v => v === null || v < 0 || v > 10)) { showToast("Enter a score from 0 to 10 for all three dimensions.", "error"); return; }
      if (!feedback) { showToast("Please write your feedback.", "error"); return; }
      // 2) Store the review on the assessment (the overall score is the average of the three).
      a.admin_dims = Object.fromEntries(DIMS.map(([k], i) => [k, Math.round(vals[i] * 10) / 10]));
      a.admin_score = Math.round(vals.reduce((s, x) => s + x, 0) / 3 * 10) / 10;
      a.admin_feedback = feedback;
      a.footer_note = (getAdminSettings().reportFooterNote || "").trim();   // travels with the review to student downloads
      allAssessments = allAssessments.map(x => x.id === id ? a : x);
      persist();
      syncAssessment(a);

      // 3) Email the reports to the student (needs a valid email address).
      const btn = document.getElementById("save-btn");
      btn.disabled = true;
      showToast("Review saved.", "success");
      const email = a.student_email || document.getElementById("student-email-input")?.value.trim() || "";
      if (!isValidEmail(email)) {
        showToast("Review saved, but there is no valid student email to send the reports to.", "error", 6000);
      } else {
        btn.textContent = "Generating and emailing reports…";
        try {
          await sendComparisonEmail({ to: email, ...reportData() });
          a.student_email = email;
          a.reports_emailed_at = new Date().toISOString();
          allAssessments = allAssessments.map(x => x.id === id ? a : x);
          persist();
          syncAssessment(a);
          showToast("Reports emailed to " + email, "success", 5000);
        } catch (err) { showToast("Email failed: " + err.message, "error", 8000); }
      }
      // 4) Redraw the list and the panel; the panel now shows the AI comparison.
      applyFilters();
      openDetail(id);
    };

    document.getElementById("delete-entry-btn").onclick = () => {
      if (!confirm("Delete this assessment? This removes it for the student too.")) return;
      allAssessments = allAssessments.filter(x => x.id !== id);
      persist();
      removeAssessmentCloud(id);
      applyFilters();
      panel.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="pointer"></i></div><h3>Select an assessment</h3><p>Review essays blind: AI scores stay hidden until you submit your own review.</p></div>`;
    };
  };

  // First draw. If the address has ?id=..., open that essay straight away.
  renderList(filtered);
  const params = new URLSearchParams(location.search);
  if (params.get("id")) openDetail(params.get("id"));
