  // ════════════════════════════════════════════════════════════════
  // Participants dashboard (admin).
  //
  // HOW IT WORKS, in four steps that repeat on every click:
  //   1. filters   what the admin ticked / clicked (the `filters` object below)
  //   2. view      currentView() keeps only the essays and participants that match the filters
  //   3. draw      render() redraws the numbers, the 4 charts, the filter chips and the table
  //   4. download  the Excel button sends the participants that are currently shown to the backend
  // ════════════════════════════════════════════════════════════════
  import { wireChrome, getAllAssessments, getAdminSettings, buildParticipantRows, downloadParticipantsXlsx,
           isReviewed, participantKey, RATING_BANDS, FEEDBACK_BASIS_TEXT, esc, showToast } from "../js/app.js?v=6";

  wireChrome("admin");

  const settings = getAdminSettings();
  const allEssays = getAllAssessments();
  const totalPeople = buildParticipantRows(allEssays, settings).length;   // everyone, before any filter
  const basisText = FEEDBACK_BASIS_TEXT[settings.feedbackBasis] || FEEDBACK_BASIS_TEXT.average;   // which score gives the Feedback word
  document.getElementById("fb-note").textContent = basisText;
  document.getElementById("fb-head").textContent = `(${basisText})`;
  document.getElementById("limit-txt").textContent = Math.max(1, Number(settings.suspiciousExitThreshold) || 1);

  const DIMS = [["semantic", "Semantic"], ["stylistic", "Stylistic"], ["pragmatic", "Pragmatic"]];
  const BANDS = [...RATING_BANDS.map(b => b.label).reverse(), "Pending review"];   // Need improvement … Excellent, Pending review
  const BAND_COLOUR = { "Need improvement": "#A32A2A", "Good": "#9A5B13", "Very good": "#5C3A41", "Excellent": "#3F6B4A", "Pending review": "#B8AEA2" };
  const BAND_BADGE = { "Need improvement": "badge-red", "Good": "badge-amber", "Very good": "badge-blue", "Excellent": "badge-green", "Pending review": "badge-purple" };
  const PLUM = "#5C3A41", PEACH = "#ECA087";

  // ── 1. Filters ──────────────────────────────────────────────
  // A Set holds the ticked values of one filter. An empty Set means "no filter" (show everything).
  const filters = { domain: new Set(), feedback: new Set(), suspicious: new Set(), status: new Set(), period: "all" };
  let selectedKey = "";                          // participant chosen for the spider graph ("" = everyone)
  let sort = { key: "name", dir: 1 };            // table sorting

  const FILTER_TITLES = { domain: "Domain", feedback: "Feedback", suspicious: "Suspicious", status: "Status" };
  const SLICERS = [   // the checkbox lists on the right
    { id: "domain", title: "Domain", options: [...new Set(allEssays.map(a => a.domain).filter(Boolean))].sort() },
    { id: "feedback", title: "Feedback", options: BANDS },
    { id: "suspicious", title: "Suspicious activity", options: ["Yes", "No"] },
    { id: "status", title: "Review status", options: ["Reviewed", "Pending"] },
  ];

  function toggle(filterName, value) {
    const set = filters[filterName];
    set.has(value) ? set.delete(value) : set.add(value);
    render();
  }

  // ── 2. The view: what matches the filters ───────────────────
  // `ignore` is for the two charts you can click (domain bars, feedback donut): they skip their OWN filter,
  // so the other bars / slices stay visible (faded) and can be clicked to add them. Everything else uses all filters.
  function currentView(ignore = "") {
    const pass = (name, value) => name === ignore || filters[name].size === 0 || filters[name].has(value);
    const days = filters.period === "all" ? null : Number(filters.period);

    // a) filters about ONE essay: domain, review status, period
    const essays = allEssays.filter(a =>
      pass("domain", a.domain) &&
      pass("status", isReviewed(a) ? "Reviewed" : "Pending") &&
      (days === null || Date.now() - new Date(a.created_at) <= days * 86400000));

    // b) one row per participant, then filters about a PARTICIPANT: feedback, suspicious
    const rows = buildParticipantRows(essays, settings).filter(r =>
      pass("feedback", r.rating) &&
      pass("suspicious", r.suspicious ? "Yes" : "No"));

    // c) keep only the essays of the participants that are still shown
    const shown = new Set(rows.map(r => r.key));
    return { rows, essays: essays.filter(a => shown.has(participantKey(a))) };
  }

  // Small maths helpers
  const average = values => {
    const nums = values.filter(v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))).map(Number);
    return nums.length ? Math.round(nums.reduce((s, x) => s + x, 0) / nums.length * 10) / 10 : null;
  };
  const show = v => v === null || v === undefined ? "—" : String(v);

  // ── 3. Drawing ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const charts = {};     // the four Chart.js charts, created once and updated after that
  let current = { rows: [], essays: [] };   // what is shown right now (the Excel button and the table search use it)

  function render() {
    const view = current = currentView();
    syncFilterBoxes();
    drawChips();
    drawNumbers(view);
    drawDomainChart(currentView("domain"));
    drawTimeChart(view);
    drawBandChart(currentView("feedback"));
    drawSpider(view);
    drawTable(view);
    $("shown-count").textContent = `Showing ${view.rows.length} of ${totalPeople} participants`;
    $("download-btn").title = `Downloads the ${view.rows.length} participant(s) currently shown`;
    $("download-btn").disabled = view.rows.length === 0;
  }

  // Filter boxes on the right + the chips on top
  function buildSlicers() {
    for (const s of SLICERS) {
      $("slicer-" + s.id).innerHTML = `<h4>${s.title}</h4>` + (s.options.length
        ? s.options.map(o => `<label><input type="checkbox" data-filter="${s.id}" value="${esc(o)}"/> ${esc(o)}</label>`).join("")
        : `<div style="font-size:12px;color:var(--text3)">No data yet</div>`);
    }
    document.querySelectorAll("input[data-filter]").forEach(box => box.onchange = () => toggle(box.dataset.filter, box.value));
  }
  function syncFilterBoxes() {   // a click on a chart also ticks the matching box
    document.querySelectorAll("input[data-filter]").forEach(box => box.checked = filters[box.dataset.filter].has(box.value));
    $("period-select").value = filters.period;
  }
  function drawChips() {
    const chips = [];
    for (const name of Object.keys(FILTER_TITLES))
      for (const value of filters[name]) chips.push(`<span class="chip" data-name="${name}" data-value="${esc(value)}">${FILTER_TITLES[name]}: ${esc(value)} ✕</span>`);
    if (filters.period !== "all") chips.push(`<span class="chip" data-name="period">Last ${filters.period} days ✕</span>`);
    $("chips").innerHTML = chips.length ? chips.join("") : `<span class="none">No filters: showing everyone. Tick a box on the right or click a chart to filter.</span>`;
    $("chips").querySelectorAll(".chip").forEach(chip => chip.onclick = () => {
      chip.dataset.name === "period" ? (filters.period = "all", render()) : toggle(chip.dataset.name, chip.dataset.value);
    });
  }

  // Headline numbers
  function drawNumbers({ rows, essays }) {
    $("k-people").textContent = rows.length;
    $("k-essays").textContent = essays.length;
    $("k-admin").textContent = show(average(rows.map(r => r.admin_avg)));
    $("k-ai").textContent = show(average(rows.map(r => r.ai_avg)));
    $("k-sus").textContent = rows.filter(r => r.suspicious).length;
  }

  // Chart 1: average score by domain (bars = admin, line = AI). Only reviewed essays count (blind review).
  function drawDomainChart({ essays }) {
    const domains = [...new Set(essays.map(a => a.domain || "Other"))].sort();
    const reviewedIn = d => essays.filter(a => (a.domain || "Other") === d && isReviewed(a));
    const faded = (colour, d) => filters.domain.size && !filters.domain.has(d) ? colour + "55" : colour;   // dim the unticked domains
    setChart("domain", {
      labels: domains,
      datasets: [
        { type: "bar", label: "Admin average", data: domains.map(d => average(reviewedIn(d).map(a => a.admin_score))),
          backgroundColor: domains.map(d => faded(PLUM, d)), borderRadius: 3, maxBarThickness: 46, order: 2 },
        { type: "line", label: "AI average", data: domains.map(d => average(reviewedIn(d).map(a => a.avg_score))),
          borderColor: PEACH, backgroundColor: PEACH, pointRadius: 5, borderWidth: 2.5, order: 1 },
      ],
    });
  }

  // Chart 2: essays per day (area) and the average admin score that day (line)
  function drawTimeChart({ essays }) {
    const byDay = {};
    for (const a of essays) {
      const day = new Date(a.created_at).toLocaleDateString("en-CA");   // 2026-10-14
      (byDay[day] = byDay[day] || []).push(a);
    }
    const days = Object.keys(byDay).sort().slice(-30);                  // the latest 30 days that have essays
    setChart("time", {
      labels: days.map(d => new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })),
      datasets: [
        { type: "line", label: "Submissions", data: days.map(d => byDay[d].length), yAxisID: "y", fill: true,
          borderColor: PEACH, backgroundColor: "rgba(236,160,135,0.30)", tension: 0.3, pointRadius: 3 },
        { type: "line", label: "Average admin score", data: days.map(d => average(byDay[d].filter(isReviewed).map(a => a.admin_score))),
          yAxisID: "y1", borderColor: PLUM, backgroundColor: PLUM, tension: 0.3, pointRadius: 3, borderWidth: 2, spanGaps: true },
      ],
    });
  }

  // Chart 3: participants per feedback band (donut). A click on a slice filters the page.
  function drawBandChart({ rows }) {
    const colour = band => filters.feedback.size && !filters.feedback.has(band) ? BAND_COLOUR[band] + "44" : BAND_COLOUR[band];
    setChart("band", {
      labels: BANDS,
      datasets: [{ data: BANDS.map(b => rows.filter(r => r.rating === b).length), backgroundColor: BANDS.map(colour), borderColor: "#fff", borderWidth: 2 }],
    });
  }

  // Chart 4: spider graph, AI vs admin on each dimension (everyone's average, or the participant picked in the table)
  function drawSpider({ rows }) {
    const picked = rows.find(r => r.key === selectedKey);
    const pool = picked ? [picked] : rows;
    const line = which => DIMS.map(([d]) => average(pool.map(r => r[which][d])) ?? 0);
    $("spider-hint").textContent = picked ? picked.name : "Everyone shown (average).";
    $("spider-select").innerHTML = `<option value="">Everyone (average)</option>` +
      rows.map(r => `<option value="${esc(r.key)}" ${r.key === selectedKey ? "selected" : ""}>${esc(r.name)}${r.suspicious ? " 🚩" : ""}</option>`).join("");
    setChart("spider", {
      labels: DIMS.map(([, label]) => label),
      datasets: [
        { label: "AI average", data: line("ai_dims"), borderColor: PEACH, backgroundColor: "rgba(236,160,135,0.25)", pointBackgroundColor: PEACH, borderWidth: 2, pointRadius: 4 },
        { label: "Admin average", data: line("admin_dims"), borderColor: PLUM, backgroundColor: "rgba(92,58,65,0.18)", pointBackgroundColor: PLUM, borderWidth: 2, pointRadius: 4 },
      ],
    });
  }

  // Table of participants (click a title to sort, a row to pick the participant for the spider graph)
  function drawTable({ rows }) {
    const q = $("search-input").value.toLowerCase().trim();
    const order = r => sort.key === "rating" ? BANDS.indexOf(r.rating) : r[sort.key];
    const list = rows.filter(r => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
      .sort((x, y) => {
        const a = order(x), b = order(y);
        if (a === null || a === undefined) return 1;      // empty values go last
        if (b === null || b === undefined) return -1;
        return (typeof a === "string" ? a.localeCompare(b) : a - b) * sort.dir;
      });
    $("table-count").textContent = `(${list.length})`;
    const body = $("p-body");
    if (!list.length) {
      body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:28px">${allEssays.length ? "No participants match the filters." : "No submissions yet. Participants appear here after they submit an essay."}</td></tr>`;
      return;
    }
    body.innerHTML = list.map(r => `
      <tr class="${r.suspicious ? "sus" : ""} ${r.key === selectedKey ? "sel" : ""}" data-key="${esc(r.key)}">
        <td style="font-weight:600">${esc(r.name)}${r.suspicious ? `<span class="flag-ic" title="Tried to leave full screen during a test"><i data-icon="flag"></i></span>` : ""}
          ${r.email ? `<div style="font-weight:400;font-size:12px;color:var(--text3)">${esc(r.email)}</div>` : ""}</td>
        <td class="num">${r.admin_avg === null ? `<span class="muted-i">Not reviewed</span>` : r.admin_avg}</td>
        <td class="num">${r.ai_avg === null ? `<span class="muted-i">Not reviewed</span>` : r.ai_avg}</td>
        <td><span class="badge ${BAND_BADGE[r.rating] || "badge-purple"}">${esc(r.rating)}</span></td>
        <td>${r.suspicious ? `<span class="badge badge-red">Yes</span>` : `<span class="badge badge-green">No</span>`}</td>
        <td class="num">${r.fullscreen_exits}</td>
        <td class="num">${r.flagged_submissions} of ${r.submissions}</td>
        <td class="num">${r.submissions}</td>
      </tr>`).join("");
    body.querySelectorAll("tr[data-key]").forEach(tr => tr.onclick = () => {
      selectedKey = selectedKey === tr.dataset.key ? "" : tr.dataset.key;
      render();
    });
  }

  // ── Chart.js set-up ─────────────────────────────────────────
  // The settings of each chart (type, axes, click behaviour). The data is added later by setChart().
  const hoverPointer = (event, elements) => { event.native.target.style.cursor = elements.length ? "pointer" : "default"; };
  const scale10 = { min: 0, max: 10, ticks: { stepSize: 2 }, grid: { color: "rgba(43,27,23,0.08)" } };
  const noLegendBottom = { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } };

  const CHART_SETTINGS = {
    domain: { type: "bar", options: {
      interaction: { mode: "index", intersect: false },
      plugins: noLegendBottom, scales: { y: scale10, x: { grid: { display: false } } },
      onHover: hoverPointer,
      onClick: (e, els, chart) => { if (els.length) toggle("domain", chart.data.labels[els[0].index]); } } },
    time: { type: "line", options: {
      interaction: { mode: "index", intersect: false },
      plugins: noLegendBottom,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(43,27,23,0.08)" }, title: { display: true, text: "Submissions" } },
                y1: { ...scale10, position: "right", grid: { display: false }, title: { display: true, text: "Score" } },
                x: { grid: { display: false } } } } },
    band: { type: "doughnut", options: {
      cutout: "58%", plugins: { legend: { position: "right", labels: { boxWidth: 10, usePointStyle: true } } },
      onHover: hoverPointer,
      onClick: (e, els, chart) => { if (els.length) toggle("feedback", chart.data.labels[els[0].index]); } } },
    spider: { type: "radar", options: {
      plugins: { legend: { display: false } },
      scales: { r: { min: 0, max: 10, ticks: { stepSize: 2, backdropColor: "transparent", color: "#8A7A70" },
        grid: { color: "rgba(43,27,23,0.12)" }, angleLines: { color: "rgba(43,27,23,0.12)" },
        pointLabels: { color: "#2B1B17", font: { size: 12, weight: "600" } } } } } },
  };

  /** Draws a chart the first time, and just swaps in the new data after that. */
  function setChart(name, data) {
    if (!window.Chart) return;
    if (charts[name]) { charts[name].data = data; charts[name].update(); return; }
    const { type, options } = CHART_SETTINGS[name];
    charts[name] = new Chart($(name + "-chart"), { type, data, options: { responsive: true, maintainAspectRatio: false, ...options } });
  }

  // ── Buttons and boxes ───────────────────────────────────────
  $("period-select").onchange = e => { filters.period = e.target.value; render(); };
  $("spider-select").onchange = e => { selectedKey = e.target.value; render(); };
  $("search-input").oninput = () => drawTable(current);
  document.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
    sort = { key: th.dataset.sort, dir: sort.key === th.dataset.sort ? -sort.dir : 1 };
    drawTable(current);
  });
  $("reset-btn").onclick = () => {
    Object.values(filters).forEach(f => f instanceof Set && f.clear());
    filters.period = "all"; selectedKey = ""; $("search-input").value = "";
    render();
  };

  // What goes to the Excel file besides the participants: the essays behind them (for its charts)
  // and a sentence saying which filters are on (printed at the top of the Excel Dashboard sheet).
  function essaysForExcel() {
    return current.essays.map(a => ({
      domain: a.domain || "Other",
      date: new Date(a.created_at).toLocaleDateString("en-CA"),
      reviewed: isReviewed(a),
      ai: isReviewed(a) ? a.avg_score : null,        // blind review: AI scores only for reviewed essays
      admin: isReviewed(a) ? a.admin_score : null,
    }));
  }
  function filterText() {
    const parts = Object.keys(FILTER_TITLES).filter(name => filters[name].size).map(name => `${FILTER_TITLES[name]}: ${[...filters[name]].join(", ")}`);
    if (filters.period !== "all") parts.push(`Last ${filters.period} days`);
    return parts.join(" | ");
  }

  // Excel download: the participants currently shown (so filter first, then download)
  $("download-btn").onclick = async () => {
    const rows = current.rows;
    if (!rows.length) { showToast("There are no participants to export.", "error"); return; }
    const button = $("download-btn"), label = $("download-text");
    button.disabled = true; label.textContent = "Creating Excel…";
    try {
      await downloadParticipantsXlsx(rows, settings, { essays: essaysForExcel(), filters: filterText(), feedbackBasis: basisText });
      showToast(`Excel downloaded with ${rows.length} participant(s). Check your Downloads folder.`, "success", 5000);
    } catch (err) {
      showToast("Excel download failed: " + err.message, "error", 7000);
    } finally { label.textContent = "Download Excel"; render(); }
  };

  if (!window.Chart) showToast("Charts could not load (Chart.js needs internet). The table and Excel download still work.", "error", 7000);
  buildSlicers();
  render();
