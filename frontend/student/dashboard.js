  // Student dashboard: shows the student's own numbers, two charts and the 5 most recent assessments.
  // All data comes from getAllAssessments() (js/app.js); nothing is fetched from the backend here.
  import { wireChrome, getDisplayName, getAllAssessments, esc, fmtDate, scoreBadgeClass } from "../js/app.js?v=6";

  wireChrome("student");   // fills in the sidebar and user info

  // Header: today's date and the welcome name
  document.getElementById("date-display").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  document.getElementById("welcome-name").textContent = getDisplayName();

  const assessments = getAllAssessments();   // newest first

  /** Fills the four stat boxes, then draws the charts and the recent list. */
  function render() {
    // Stats
    document.getElementById("stat-total").textContent = assessments.length;
    if (assessments.length) {
      const avgs = assessments.map(a => Number(a.avg_score));
      document.getElementById("stat-avg").textContent = (avgs.reduce((a,b)=>a+b,0) / avgs.length).toFixed(1);
      document.getElementById("stat-high").textContent = Math.max(...avgs);

      // Average score of each dimension; the lowest one is shown as the "weakest dimension".
      const dims = ["semantic", "stylistic", "pragmatic"];
      const dimAvgs = dims.map(d => {
        const vals = assessments.map(a => Number(a[d]?.score)).filter(v => !isNaN(v));
        return vals.length ? vals.reduce((a,b)=>a+b,0) / vals.length : 0;
      });
      const minIdx = dimAvgs.indexOf(Math.min(...dimAvgs));
      document.getElementById("stat-weak").textContent =
        dims[minIdx].charAt(0).toUpperCase() + dims[minIdx].slice(1);

      renderCharts(assessments, dims, dimAvgs);
    } else {
      document.getElementById("stat-avg").textContent = "—";
      document.getElementById("stat-high").textContent = "—";
      document.getElementById("stat-weak").textContent = "—";
    }

    renderRecent(assessments.slice(0, 5));
  }

  /** Shows the given assessments as clickable cards (or an empty message). */
  function renderRecent(list) {
    const el = document.getElementById("recent-list");
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-icon="file-text"></i></div><h3>No assessments yet</h3><p>Submit your first assessment to see results here.</p><a href="new_assessment.html" class="btn btn-primary" style="margin-top:16px">Start assessment</a></div>`;
      return;
    }
    el.innerHTML = list.map(a => `
      <div class="assessment-card" onclick="location.href='history.html?id=${a.id}'">
        <div class="topic">${esc(a.topic)}</div>
        <p style="font-size:13px;color:var(--text2);margin:6px 0 12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc((a.essay || "").slice(0, 110))}…</p>
        <div class="meta">
          <span class="badge ${scoreBadgeClass(a.avg_score)}">${a.avg_score}/10</span>
          ${a.domain ? `<span class="badge badge-purple" style="font-size:11px">${esc(a.domain)}</span>` : ""}
          <span style="font-size:12px;color:var(--text3);margin-left:auto">${fmtDate(a.created_at)}</span>
        </div>
      </div>`).join("");
  }

  /** Draws the line chart (score over time) and the bar chart (average per dimension) with Chart.js. */
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

  render();   // run once when the page opens
