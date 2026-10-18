  // Admin dashboard: numbers for all students, two charts, essays waiting for review, and recent feedback.
  // All data comes from js/app.js (saved in the browser, or loaded from Firebase); nothing is fetched here.
  import { wireChrome, getAllAssessments, getAllFeedback, getAdminSettings, esc, fmtDate, scoreBadgeClass } from "../js/app.js?v=6";

  wireChrome("admin");   // fills in the sidebar and user info

  // Header: today's date
  document.getElementById("date-display").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  const assessments = getAllAssessments();
  const feedback = getAllFeedback();
  const adminSettings = getAdminSettings();
  // Scores below this number count as "low" (the admin can change it in Settings; default 5)
  const threshold = Number(adminSettings.lowScoreThreshold) || 5;

  /** True once an admin has entered a score for this assessment. */
  function hasReview(a) { return a.admin_score !== undefined && a.admin_score !== null && a.admin_score !== ""; }

  // The six stat boxes at the top
  document.getElementById("stat-total").textContent = assessments.length;
  document.getElementById("stat-reviewed").textContent = assessments.filter(hasReview).length;
  document.getElementById("stat-pending").textContent = assessments.filter(a => !hasReview(a)).length;
  document.getElementById("stat-flagged").textContent = assessments.filter(a => hasReview(a) && Number(a.avg_score) < threshold).length;
  document.getElementById("stat-feedback").textContent = feedback.filter(f => f.status !== "resolved").length;

  // Average AI score, and the charts (only when there is data to show)
  if (assessments.length) {
    const avgs = assessments.map(a => Number(a.avg_score));
    document.getElementById("stat-avg").textContent = (avgs.reduce((a,b)=>a+b,0) / avgs.length).toFixed(1);

    const dims = ["semantic", "stylistic", "pragmatic"];
    const dimAvgs = dims.map(d => {
      const vals = assessments.map(a => Number(a[d]?.score)).filter(v => !isNaN(v));
      return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
    });
    renderCharts(assessments, dims, dimAvgs);
  } else {
    document.getElementById("stat-avg").textContent = "—";
  }

  // "Needs attention" list: essays still waiting for the admin's review (up to 6)
  const attention = assessments
    .filter(a => !hasReview(a))                       // blind review: only essays awaiting your review
    .slice(0, 6);
  const attnEl = document.getElementById("attention-list");
  if (!attention.length) {
    attnEl.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="circle-check"></i></div><h3>All caught up</h3><p>Nothing pending review or flagged right now.</p></div>`;
  } else {
    attnEl.innerHTML = attention.map(a => `
      <div class="assessment-card" onclick="location.href='review.html?id=${a.id}'">
        <div class="topic">${esc(a.topic)}</div>
        <div class="meta">
          ${hasReview(a) ? `<span class="badge ${scoreBadgeClass(a.avg_score)}">AI ${a.avg_score}/10</span>` : ""}
          ${a.domain ? `<span class="badge badge-purple" style="font-size:11px">${esc(a.domain)}</span>` : ""}
          <span class="badge ${hasReview(a) ? "badge-green" : "badge-amber"}" style="font-size:11px">${hasReview(a) ? "Reviewed" : "Pending"}</span>
          <span style="font-size:12px;color:var(--text3);margin-left:auto">${fmtDate(a.created_at)}</span>
        </div>
      </div>`).join("");
  }

  // "Recent feedback" list: the 4 newest messages from students
  const fbEl = document.getElementById("feedback-preview");
  const recentFeedback = feedback.slice(0, 4);
  if (!recentFeedback.length) {
    fbEl.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="message"></i></div><h3>No feedback yet</h3><p>Student feedback will appear here as it comes in.</p></div>`;
  } else {
    fbEl.innerHTML = recentFeedback.map(f => `
      <div class="feedback-item">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:13px">${esc(f.author || "Student")}</span>
          <span class="badge ${f.status === "resolved" ? "badge-green" : "badge-amber"}">${f.status === "resolved" ? "Resolved" : "Open"}</span>
          <span style="font-size:12px;color:var(--text3);margin-left:auto">${fmtDate(f.created_at)}</span>
        </div>
        <p style="font-size:13px;color:var(--text2);line-height:1.6;margin-top:6px">${esc((f.message || "").slice(0, 140))}</p>
      </div>`).join("");
  }

  /** Draws the line chart (AI score over time) and the bar chart (average per dimension) with Chart.js. */
  function renderCharts(list, dims, dimAvgs) {
    // Shared look for both charts
    if (window.Chart) { Chart.defaults.font.family = "'IBM Plex Mono', ui-monospace, monospace"; Chart.defaults.font.size = 11; Chart.defaults.color = "#5A4640"; }
    // Line chart: the last 8 assessments, oldest on the left.
    const scored = list.slice(0, 8).reverse();
    new Chart(document.getElementById("trend-chart"), {
      type: "line",
      data: { labels: scored.map((_, i) => `#${i+1}`), datasets: [{
        label: "Avg Score", data: scored.map(a => Number(a.avg_score)),
        borderColor: "#5C3A41", backgroundColor: "rgba(92,58,65,0.08)",
        fill: true, tension: 0.3, pointBackgroundColor: "#ECA087", pointBorderColor: "#2B1B17", pointBorderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2
      }]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ y:{min:0,max:10,grid:{color:"rgba(43,27,23,0.08)"},ticks:{color:"#5A4640",stepSize:2}},
                 x:{grid:{display:false},ticks:{color:"#5A4640"}} } }
    });

    // Bar chart: average score for semantic, stylistic and pragmatic.
    new Chart(document.getElementById("dim-chart"), {
      type: "bar",
      data: { labels: dims.map(d => d.charAt(0).toUpperCase()+d.slice(1)), datasets: [{
        data: dimAvgs.map(v => Math.round(v*10)/10),
        backgroundColor: "#5C3A41", hoverBackgroundColor: "#ECA087", borderRadius:3, borderSkipped:false, maxBarThickness:56
      }]},
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ y:{min:0,max:10,grid:{color:"rgba(43,27,23,0.08)"},ticks:{color:"#5A4640",stepSize:2}},
                 x:{grid:{display:false},ticks:{color:"#5A4640"}} } }
    });
  }
