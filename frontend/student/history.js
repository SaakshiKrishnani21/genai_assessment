  // Past performance: a searchable list of the student's assessments on the left; selecting one
  // shows its full result on the right (scores, corrections, admin review, PDF downloads).
  import { wireChrome, getAllAssessments, esc, fmtDate, scoreColor, scoreBadgeClass, scoreLabel, resultNoticesHtml, removeAssessmentCloud, downloadPdf, showToast } from "../js/app.js?v=6";

  wireChrome("student");   // fills in the sidebar and user info

  // Fill the domain filter dropdown
  const DOMAINS = ["Computer Science","Electronics","Mechanical","Civil","Biotechnology","Information Technology","Environment","General"];
  document.getElementById("filter-domain").innerHTML += DOMAINS.map(d => `<option value="${d}">${d}</option>`).join("");

  let allAssessments = getAllAssessments();   // everything saved
  let filtered = allAssessments;               // what the search / filter currently shows

  // Re-filter the list whenever the search text or domain changes
  document.getElementById("search-input").oninput = applyFilters;
  document.getElementById("filter-domain").onchange = applyFilters;

  /** Keeps only the assessments matching the search text and the chosen domain, then redraws the list. */
  function applyFilters() {
    const q = document.getElementById("search-input").value.toLowerCase();
    const d = document.getElementById("filter-domain").value;
    filtered = allAssessments.filter(a =>
      (!q || (a.topic || "").toLowerCase().includes(q)) &&
      (!d || a.domain === d)
    );
    renderList(filtered);
  }

  /** Draws the list of assessment cards on the left (or an empty message). */
  function renderList(list) {
    const el = document.getElementById("assessment-list");
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="file-text"></i></div><h3>No assessments found</h3><p>Try a different filter or submit a new assessment.</p><a href="new_assessment.html" class="btn btn-primary" style="margin-top:16px">Start assessment</a></div>`;
      return;
    }
    el.innerHTML = list.map(a => `
      <div class="assessment-card" onclick="openDetail('${a.id}')">
        <div class="topic">${esc(a.topic)}</div>
        <p style="font-size:13px;color:var(--text2);margin:6px 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc((a.essay||"").slice(0,110))}…</p>
        <div class="meta">
          <span class="badge ${scoreBadgeClass(a.avg_score)}">${a.avg_score}/10</span>
          ${a.domain ? `<span class="badge badge-purple" style="font-size:11px">${esc(a.domain)}</span>` : ''}
          <span style="font-size:12px;color:var(--text3);margin-left:auto">${fmtDate(a.created_at)}</span>
        </div>
      </div>`).join("");
  }

  /** Shows one assessment in the right-hand panel. (Attached to `window` because the cards call it from onclick.) */
  window.openDetail = function(id) {
    const a = allAssessments.find(x => x.id === id);
    const panel = document.getElementById("detail-panel");
    if (!a) { panel.innerHTML = `<div style="color:var(--red);padding:20px">Not found.</div>`; return; }

    // Build the pieces of the panel first: the corrections list, then the three dimension rows.
    const dims = [["semantic","Semantic"],["stylistic","Stylistic"],["pragmatic","Pragmatic"]];
    const renderCorrections = corrections => {
      if (!corrections || !corrections.length) {
        return `<p style="font-size:12px;color:var(--text3);font-style:italic;margin:2px 0 14px">No specific line-level issues flagged for this dimension.</p>`;
      }
      return `<div style="margin:4px 0 14px">${corrections.map(c => `
        <div class="correction-card">
          <div class="c-original">"${esc(c.original_text)}"</div>
          <div class="c-row c-expected"><span class="c-tag">Expected</span><span>${esc(c.expected)}</span></div>
          <div class="c-row c-correction"><span class="c-tag">Correction</span><span>${esc(c.correction)}</span></div>
        </div>`).join("")}</div>`;
    };
    const breakdownHtml = dims.map(([key,label]) => {
      const d = a[key] || {};
      const col = scoreColor(d.score || 0);
      return `
        <div class="breakdown-row">
          <div class="label" style="width:80px">${label}</div>
          <div class="bar-wrap"><div class="bar-fill" style="width:${(d.score||0)*10}%;background:${col}"></div></div>
          <div class="score-val" style="color:${col}">${d.score}/10</div>
        </div>
        <p style="font-size:12px;color:var(--text2);line-height:1.55;margin:2px 0 8px">${esc(d.feedback)}</p>
        <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:6px"><i data-icon="pencil"></i> ${label} corrections</div>
        ${renderCorrections(d.corrections)}`;
    }).join("");

    // The panel: topic, average score, breakdown, notices, essay, then the admin review section.
    panel.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Topic</div>
          <div style="font-weight:600;font-size:14px;line-height:1.4">${esc(a.topic)}</div>
          ${a.domain ? `<span class="badge badge-purple" style="font-size:11px;margin-top:6px;display:inline-flex">${esc(a.domain)}</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text3)">${fmtDate(a.created_at)}</div>

        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;text-align:center">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Average score</div>
          <div class="num" style="font-size:32px;font-weight:500;color:${scoreColor(a.avg_score)}">${a.avg_score}<span style="font-size:14px;color:var(--text2)">/10</span></div>
          <div style="font-size:11px;color:var(--text2)">${scoreLabel(a.avg_score)}</div>
        </div>

        <div>${breakdownHtml}</div>

        ${resultNoticesHtml(a)}
        ${a.overall_feedback ? `<div class="callout callout-blue"><strong style="color:var(--text)">Overall feedback:</strong> ${esc(a.overall_feedback)}</div>` : ''}

        <div>
          <div style="font-size:12px;color:var(--text2);margin-bottom:6px">Essay</div>
          <div class="essay-display" style="max-height:200px">${esc(a.essay)}</div>
        </div>

        <button class="btn btn-secondary btn-full" id="download-ai-report-btn"><i data-icon="download"></i> Download AI report (PDF)</button>

        <div style="border-top:1px solid var(--border);padding-top:16px">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px"><i data-icon="shield-check"></i> Admin review</div>
          ${(a.admin_score !== undefined && a.admin_score !== null && a.admin_score !== "") ? `
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:12px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:12px;color:var(--text2)">Admin Score</span>
                <span class="badge ${scoreBadgeClass(a.admin_score)}">${a.admin_score}/10</span>
              </div>
              <p style="font-size:13px;color:var(--text2);line-height:1.6">${esc(a.admin_feedback || "No written feedback yet.")}</p>
            </div>
            <button class="btn btn-secondary btn-full" id="download-admin-report-btn"><i data-icon="download"></i> Download admin report (PDF)</button>
            <button class="btn btn-secondary btn-full" id="download-cmp-report-btn" style="margin-top:8px"><i data-icon="download"></i> Download comparison report (PDF)</button>
          ` : `
            <div class="callout callout-amber"><i data-icon="clock"></i> Not reviewed by an admin yet. Once reviewed, the admin score, feedback, and a downloadable admin report will appear here.</div>
          `}
        </div>

        <div style="display:flex;gap:8px">
          <a href="new_assessment.html" class="btn btn-secondary btn-full"><i data-icon="plus"></i> New assessment</a>
          <button class="btn btn-danger" id="delete-entry-btn" style="white-space:nowrap"><i data-icon="trash"></i> Delete</button>
        </div>
      </div>`;

    // ── Buttons in the panel ────────────────────────────────
    // Each download button sends the data to the backend (/download-pdf) and saves the PDF it returns.
    document.getElementById("download-ai-report-btn").onclick = async () => {
      const btn = document.getElementById("download-ai-report-btn");
      btn.disabled = true;
      try {
        await downloadPdf({
          report_type: "ai",
          domain: a.domain, topic: a.topic, essay: a.essay,
          semantic: a.semantic, stylistic: a.stylistic, pragmatic: a.pragmatic,
          avg_score: a.avg_score, overall_feedback: a.overall_feedback,
        }, "ai_report.pdf");
      } catch (err) {
        showToast("Download failed: " + err.message, "error");
      } finally {
        btn.disabled = false;
      }
    };

    // The admin and comparison buttons only exist once an admin has reviewed the essay.
    const downloadAdminBtn = document.getElementById("download-admin-report-btn");
    if (downloadAdminBtn) {
      downloadAdminBtn.onclick = async () => {
        downloadAdminBtn.disabled = true;
        try {
          await downloadPdf({
            report_type: "admin",
            domain: a.domain, topic: a.topic, essay: a.essay,
            semantic: a.semantic, stylistic: a.stylistic, pragmatic: a.pragmatic,
            avg_score: a.avg_score, overall_feedback: a.overall_feedback,
            admin_score: a.admin_score, admin_feedback: a.admin_feedback,
            admin_dims: a.admin_dims || null, footer_note: a.footer_note || "",
          }, "admin_report.pdf");
        } catch (err) {
          showToast("Download failed: " + err.message, "error");
        } finally {
          downloadAdminBtn.disabled = false;
        }
      };
    }

    const cmpBtn = document.getElementById("download-cmp-report-btn");
    if (cmpBtn) cmpBtn.onclick = async () => {
      cmpBtn.disabled = true;
      try {
        await downloadPdf({
          report_type: "comparison", name: a.student_name || "Student",
          domain: a.domain, topic: a.topic, essay: a.essay,
          semantic: a.semantic, stylistic: a.stylistic, pragmatic: a.pragmatic,
          avg_score: a.avg_score, overall_feedback: a.overall_feedback,
          admin_score: a.admin_score, admin_feedback: a.admin_feedback,
          admin_dims: a.admin_dims || null, footer_note: a.footer_note || "",
          irrelevant: !!a.irrelevant, ai_generated: a.ai_generated || null,
        }, "comparison_report.pdf");
      } catch (err) { showToast("Download failed: " + err.message, "error"); }
      finally { cmpBtn.disabled = false; }
    };

    // Delete: removes it from the browser, and from Firebase if that is in use.
    document.getElementById("delete-entry-btn").onclick = () => {
      if (!confirm("Delete this assessment from local history?")) return;
      allAssessments = allAssessments.filter(x => x.id !== id);
      localStorage.setItem("genai_assess_history", JSON.stringify(allAssessments));
      removeAssessmentCloud(id);
      applyFilters();
      panel.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="pointer"></i></div><h3>Select an assessment</h3><p>Select an item to see its full semantic, stylistic and pragmatic breakdown.</p></div>`;
    };
  };

  // First draw. If the address has ?id=..., open that assessment straight away.
  renderList(filtered);

  const params = new URLSearchParams(location.search);
  if (params.get("id")) openDetail(params.get("id"));
