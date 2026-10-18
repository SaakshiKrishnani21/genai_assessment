  // ════════════════════════════════════════════════════════════════
  // New assessment page. The student moves through 4 steps:
  //   1. Domain  - pick a subject area and a difficulty
  //   2. Topic   - the backend generates a topic (can be regenerated)
  //   3. Write   - 10 minute timed test, in full screen, maximum 300 words
  //   4. Submit  - review, then the backend scores the essay and shows the result
  //
  // Test rules while writing (they are deterrents, not perfect locks):
  //   - full screen is required
  //   - leaving the tab/window starts a 15 second countdown; if the writer is not
  //     back in time, the test ends and the essay is submitted as it is
  //   - copy, cut, paste and right-click are blocked
  //
  // Sections below, in order: state, timer, full screen, domain picker, steps,
  // topic, word count, copy/paste blocking, buttons, submit, showing the result.
  // ════════════════════════════════════════════════════════════════
  import { wireChrome, showToast, saveAssessment, scoreColor, scoreBadgeClass, scoreLabel, esc, API_BASE, downloadPdf, getUserEmail, sendResultEmail, getDisplayName, resultNoticesHtml, authHeaders, FIREBASE_MODE, getSettings } from "../js/app.js?v=6";

  wireChrome("student");   // fills in the sidebar and user info (see js/sidebar.js)

  // The 8 domains shown in step 1 (the icon names come from js/icons.js).
  const DOMAINS = {
    "Computer Science":       { icon: "code" },
    "Electronics":            { icon: "zap" },
    "Mechanical":             { icon: "wrench" },
    "Civil":                  { icon: "building" },
    "Biotechnology":          { icon: "dna" },
    "Information Technology": { icon: "globe" },
    "Environment":            { icon: "leaf" },
    "General":                { icon: "book-open" },
  };

  // What the student has chosen or received so far:
  let selectedDomain = null;
  let currentTopic = "";
  let currentKeywords = [];
  let seenTopics = [];
  let lastResult = null;     // the scoring result from the backend (used for the PDF download)
  let lastSavedId = null;    // id of the saved assessment

  // ── Timer + fullscreen state ────────────────────────────────
  const WRITING_SECONDS = 600; // 10 minutes
  const AWAY_SECONDS = 15;     // grace period after leaving the tab/window
  let timeRemaining = WRITING_SECONDS;
  let endAt = 0;               // wall-clock deadline (ms) - immune to background-tab timer throttling
  let timerInterval = null;    // truthy while the test is running
  let tickWorker = null;
  let timeUp = false;
  let awayDeadline = 0;        // 0 = writer is in the test window
  let tabSwitches = 0;
  let fullscreenExits = 0;      // how many times the writer left full screen while the timer was running (shown to admins)
  let escapePresses = 0;        // how many times the writer pressed Esc to try to leave full screen (a quick Esc press is blocked, so it is NOT an exit)
  let endedBy = "manual";      // manual | time | tab
  const testRunning = () => !!timerInterval && !timeUp;   // true while the timer is counting down

  /** 75 seconds -> "01:15" */
  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  /** Shows the remaining time in both timer badges and colours them red near the end. */
  function updateTimerDisplay() {
    const text = formatTime(timeRemaining);
    const badge = document.getElementById("timer-badge");
    const topbarBadge = document.getElementById("timer-topbar");
    [badge, topbarBadge].forEach(el => {
      if (!el) return;
      (el.querySelector(".t-val") || el).textContent = text;
      el.classList.toggle("timer-red", timeRemaining <= 120);      // last 2 minutes -> red
      el.classList.toggle("timer-critical", timeRemaining <= 30);  // last 30 s -> pulsing
    });
  }

  // A Web Worker drives the ticks because browsers heavily throttle timers in background tabs.
  function startTicker(fn) {
    stopTicker();
    try {
      tickWorker = new Worker(URL.createObjectURL(new Blob(["setInterval(()=>postMessage(1),250)"], { type: "text/javascript" })));
      tickWorker.onmessage = fn;
      timerInterval = "worker";
    } catch { tickWorker = null; timerInterval = setInterval(fn, 250); }
  }
  function stopTicker() {
    if (tickWorker) { tickWorker.terminate(); tickWorker = null; }
    else if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  /** Runs four times a second: updates the timer and ends the test when time is up
   *  or when the writer has been away too long. */
  function tick() {
    if (timeUp) return;
    const now = Date.now();
    timeRemaining = Math.max(0, Math.ceil((endAt - now) / 1000));
    updateTimerDisplay();
    if (awayDeadline) {
      document.getElementById("away-count").textContent = Math.max(0, Math.ceil((awayDeadline - now) / 1000));
      if (now >= awayDeadline) { endTest("tab"); return; }
    }
    if (now >= endAt) endTest("time");
  }

  /** Resets everything and starts the 10 minute countdown. */
  function startTimer() {
    stopTimer();
    timeUp = false; tabSwitches = 0; fullscreenExits = 0; escapePresses = 0; endedBy = "manual"; awayDeadline = 0;
    endAt = Date.now() + WRITING_SECONDS * 1000;
    timeRemaining = WRITING_SECONDS;
    ta.disabled = false;
    updateTimerDisplay();
    document.getElementById("timer-topbar").classList.remove("hidden");
    startTicker(tick);
  }

  /** Stops the countdown and hides the timer, away screen and full screen lock. */
  function stopTimer() {
    stopTicker();
    awayDeadline = 0;
    document.getElementById("away-overlay").style.display = "none";
    document.getElementById("timer-topbar")?.classList.add("hidden");
    document.getElementById("fs-lock").style.display = "none";
  }

  // Leaving the tab/window starts a 15 s countdown; back in time -> carry on, otherwise the test ends.
  function leaveTest() {
    if (!testRunning() || awayDeadline) return;
    awayDeadline = Date.now() + AWAY_SECONDS * 1000;
    tabSwitches++;
    document.getElementById("away-count").textContent = AWAY_SECONDS;
    document.getElementById("away-overlay").style.display = "flex";
  }
  function returnToTest() {
    if (!awayDeadline) return;
    if (Date.now() >= awayDeadline) { endTest("tab"); return; }
    awayDeadline = 0;
    document.getElementById("away-overlay").style.display = "none";
    showToast(`You left the test window (${tabSwitches}×). Staying away for more than ${AWAY_SECONDS} seconds ends the test.`, "error", 5000);
    ta.focus();
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? leaveTest() : returnToTest()));
  window.addEventListener("blur", leaveTest);
  window.addEventListener("focus", () => { if (!document.hidden) returnToTest(); });
  document.getElementById("away-return-btn").onclick = returnToTest;

  /** Asks the browser for full screen (browsers only allow this after a click). */
  async function enterFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      lockEscapeKey();
    } catch {
      showToast("Full screen was blocked by your browser — click again to allow it.", "error", 3000);
    }
  }

  /** Leaves full screen and releases the Esc key. */
  function exitFullscreen() {
    unlockEscapeKey();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // Full screen is enforced while the timer runs. Browsers never let a page
  // block Esc outright, so: (1) where supported (Chromium), lock the Esc key
  // while in full screen, and (2) if the writer still gets out (e.g. holding
  // Esc), cover the page with a lock screen until they re-enter full screen.
  const fsLock = document.getElementById("fs-lock");
  function setFsLock(on) {
    fsLock.style.display = on ? "flex" : "none";
    ta.disabled = on || timeUp;
  }
  function lockEscapeKey() {
    try { navigator.keyboard?.lock?.(["Escape"])?.catch?.(() => {}); } catch {}
  }
  function unlockEscapeKey() {
    try { navigator.keyboard?.unlock?.(); } catch {}
  }
  document.addEventListener("fullscreenchange", () => {
    if (!timerInterval || timeUp) return;
    if (document.fullscreenElement) { setFsLock(false); lockEscapeKey(); ta.focus(); }
    else {                                          // left full screen mid-test: counted for the integrity report
      fullscreenExits++;
      setFsLock(true);
      showToast(`Full-screen exit recorded (${fullscreenExits}×). Return to full screen to keep writing.`, "error", 5000);
    }
  });
  document.getElementById("fs-return-btn").onclick = async () => {
    await enterFullscreen();
  };

  // Ends the test (time ran out, or the writer stayed away > 15 s) and submits whatever is written.
  function endTest(reason) {
    if (timeUp) return;
    timeUp = true; endedBy = reason;
    stopTimer();
    ta.disabled = true;
    showToast(reason === "tab"
      ? "Test ended: you left the test window for more than 15 seconds. Submitting your essay…"
      : "Time's up. Submitting what you've written…", "error", 6000);
    const essay = ta.value.trim();
    if (essay.length < 50) {
      showToast("Not enough written to score (minimum 50 characters). Start again from the topic step.", "error", 7000);
      exitFullscreen(); ta.disabled = false; timeUp = false; setStep(2);
      return;
    }
    const wc = essay.split(/\s+/).filter(Boolean).length;
    document.getElementById("review-domain").textContent = selectedDomain;
    document.getElementById("review-wc").textContent = wc + " words";
    document.getElementById("review-topic").textContent = currentTopic;
    document.getElementById("review-essay").textContent = essay.slice(0, 600) + (essay.length > 600 ? "…" : "");
    setStep(4);
    submitAssessment();
  }

  // ── Domain grid: builds the 8 clickable cards from DOMAINS ─
  document.getElementById("domain-grid").innerHTML =
    Object.entries(DOMAINS).map(([name, d]) =>
      `<div class="domain-card" data-domain="${name}" onclick="selectDomain('${name}')">
        <div class="domain-icon"><i data-icon="${d.icon}"></i></div>
        <div class="domain-name">${name}</div>
      </div>`
    ).join("");

  window.selectDomain = function(name) {
    selectedDomain = name;
    document.querySelectorAll(".domain-card").forEach(c =>
      c.classList.toggle("selected", c.dataset.domain === name)
    );
  };

  // Apply the defaults saved in Student -> Settings
  {
    const prefs = getSettings();
    if (prefs.defaultDomain && DOMAINS[prefs.defaultDomain]) selectDomain(prefs.defaultDomain);
    if (["Easy", "Medium", "Hard"].includes(prefs.defaultDifficulty)) document.getElementById("difficulty-select").value = prefs.defaultDifficulty;
  }

  // ── Step navigation ────────────────────────────────────────
  /** Shows step n (1-4) and hides the others; also updates the step indicator at the top. */
  function setStep(n) {
    ["step1","step2","step3","step4"].forEach((id, i) => {
      document.getElementById(id).classList.toggle("hidden", i + 1 !== n);
    });
    [1,2,3,4].forEach(i => {
      document.getElementById(`si${i}`).className = `step-item ${i < n ? "done" : i === n ? "active" : ""}`;
    });
    [1,2,3].forEach(i => {
      document.getElementById(`sl${i}`).className = `step-line ${i < n ? "done" : ""}`;
    });
  }

  // ── Topic generation (calls the real backend) ──────────────
  /** Asks the backend for a topic, then shows it with its keywords. Shows an error with a Retry button if it fails. */
  async function loadTopic() {
    const difficulty = document.getElementById("difficulty-select").value;
    const container = document.getElementById("topic-container");
    container.innerHTML = `<div class="genai-loading"><div class="ai-orb"></div><p>Generating unique topic…</p></div>`;

    try {
      const res = await fetch(`${API_BASE}/generate-topic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ domain: selectedDomain, level: difficulty, exclude: seenTopics }),
      });
      if (!res.ok) throw new Error((await res.json().catch(()=>({})))?.error || `Server ${res.status}`);
      const data = await res.json();
      currentTopic = data.topic;
      currentKeywords = data.keywords || [];
      if (currentTopic) seenTopics.push(currentTopic);
      container.innerHTML = `
        <div class="topic-result">
          <div class="topic-text">"${esc(currentTopic)}"</div>
          <button type="button" class="topic-dice" id="dice-icon" title="Generate another topic" aria-label="Generate another topic"><i data-icon="shuffle"></i></button>
        </div>
        ${currentKeywords.length ? `
          <div style="margin-top:12px">
            <div style="font-size:11px;color:var(--text2);margin-bottom:4px">Keywords to cover:</div>
            ${currentKeywords.map(k => `<span class="keyword-chip">${esc(k)}</span>`).join("")}
          </div>` : ""}`;
      document.getElementById("dice-icon").onclick = () => {
        document.getElementById("dice-icon").classList.add("dice-spinning");
        loadTopic();
      };
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" style="color:var(--amber)"><i data-icon="alert"></i></div>
          <h3>Could not generate topic</h3>
          <p>Is the backend running? Check: <code>cd backend && python app.py</code></p>
          <p style="font-size:12px;margin-top:4px;color:var(--red)">${esc(err.message)}</p>
          <button class="btn btn-secondary" style="margin-top:14px" id="retry-topic-btn"><i data-icon="refresh"></i> Retry</button>
        </div>`;
      document.getElementById("retry-topic-btn").onclick = loadTopic;
    }
  }

  // ── Word count (maximum, enforced while typing) ────────────
  const MAX_WORDS = 300;               // change this one number to change the limit
  // `ta` is the essay text box. It is declared here but the timer functions above also use it
  // (they only run later, after the page has loaded, so this is fine).
  const ta = document.getElementById("essay-input");
  const countWords = t => (t.match(/\S+/g) || []).length;
  ta.addEventListener("input", () => {
    // Hard cap: drop anything typed after the last allowed word.
    const found = [...ta.value.matchAll(/\S+/g)];
    if (found.length > MAX_WORDS) {
      const last = found[MAX_WORDS - 1];
      const pos = ta.selectionStart;
      ta.value = ta.value.slice(0, last.index + last[0].length);
      ta.setSelectionRange(Math.min(pos, ta.value.length), Math.min(pos, ta.value.length));
      showToast(`Maximum ${MAX_WORDS} words reached.`, "info", 2200);
    }
    const words = countWords(ta.value);
    const chars = ta.value.length;
    const pct = Math.min(100, Math.round((words / MAX_WORDS) * 100));
    const state = words >= MAX_WORDS ? "red" : words >= MAX_WORDS * 0.9 ? "amber" : "ok";
    document.getElementById("wc-badge").textContent = words + " words";
    document.getElementById("wc-badge").className = "badge num " + (state === "red" ? "badge-red" : state === "amber" ? "badge-amber" : "badge-purple");
    document.getElementById("wc-topbar").textContent = words + " words";
    document.getElementById("wc-detail").textContent = `${words} of ${MAX_WORDS} words maximum`;
    document.getElementById("char-count").textContent = chars + " chars";
    document.getElementById("wc-fill").style.width = pct + "%";
    document.getElementById("wc-fill").style.background = state === "red" ? "var(--red)" : state === "amber" ? "var(--amber)" : "var(--plum)";
  });

  // ── Copy / cut / paste blocking while the test runs (a deterrent, not a lock) ──
  let lastBlockToast = 0;
  const blocked = (e, msg) => {
    if (!testRunning()) return;
    e.preventDefault();
    if (Date.now() - lastBlockToast > 1500) { lastBlockToast = Date.now(); showToast(msg, "error", 2000); }
  };
  ["copy", "cut", "paste", "drop"].forEach(t => document.addEventListener(t, e => blocked(e, "Copy, cut, paste and drag-and-drop are disabled during the test.")));
  document.addEventListener("contextmenu", e => blocked(e, "Right-click is disabled during the test."));
  ta.addEventListener("beforeinput", e => { if (/^insertFrom(Paste|PasteAsQuotation|Drop|Yank)$/.test(e.inputType)) blocked(e, "Pasting is disabled during the test."); });
  document.addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase();
    if (((e.ctrlKey || e.metaKey) && ["c", "x", "v", "insert"].includes(k)) || (e.shiftKey && k === "insert")) blocked(e, "Copy and paste shortcuts are disabled during the test.");
  });

  // Pressing Esc: on Chrome/Edge the key lock keeps the page in full screen after a quick press, so nothing would
  // count as an "exit". Count the attempt itself (once per press, not while the key is held down).
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.repeat || !testRunning() || !document.fullscreenElement) return;
    escapePresses++;
    showToast(`Esc is disabled during the test. This attempt was recorded (${escapePresses}×).`, "error", 3000);
  });

  // ── Wire buttons: what each button does when clicked ───────
  document.getElementById("step1-next").onclick = () => {
    if (!selectedDomain) { showToast("Select a domain first.", "error"); return; }
    setStep(2);
    loadTopic();
  };
  document.getElementById("regen-btn").onclick = loadTopic;
  document.getElementById("step2-back").onclick = () => setStep(1);
  document.getElementById("step2-next").onclick = async () => {
    if (!currentTopic) { showToast("Topic is still loading. Please wait.", "error"); return; }
    document.getElementById("topic-locked").textContent = currentTopic;
    document.getElementById("keywords-locked").innerHTML =
      currentKeywords.map(k => `<span class="keyword-chip">${esc(k)}</span>`).join("");
    setStep(3);
    await enterFullscreen();
    startTimer();
    ta.focus();
  };
  document.getElementById("step3-back").onclick = () => {
    stopTimer();
    exitFullscreen();
    setStep(2);
  };
  document.getElementById("clear-btn").onclick = () => {
    if (confirm("Clear your essay? This cannot be undone.")) {
      ta.value = "";
      ta.dispatchEvent(new Event("input"));
    }
  };
  document.getElementById("step3-next").onclick = () => {
    const essay = ta.value.trim();
    if (essay.length < 50) { showToast("Essay is too short. Write at least 50 characters.", "error"); return; }
    const wc = essay.split(/\s+/).filter(Boolean).length;
    document.getElementById("review-domain").textContent = selectedDomain;
    document.getElementById("review-wc").textContent = wc + " words";
    document.getElementById("review-topic").textContent = currentTopic;
    document.getElementById("review-essay").textContent = essay.slice(0, 600) + (essay.length > 600 ? "…" : "");
    setStep(4);
  };
  document.getElementById("step4-back").onclick = () => setStep(3);
  document.getElementById("submit-btn").onclick = submitAssessment;
  document.getElementById("new-assessment-btn").onclick = () => location.reload();
  document.getElementById("download-ai-report-btn").onclick = async () => {
    if (!lastResult) { showToast("Nothing to download yet.", "error"); return; }
    const btn = document.getElementById("download-ai-report-btn");
    btn.disabled = true;
    try {
      await downloadPdf({
        report_type: "ai",
        domain: selectedDomain,
        topic: currentTopic,
        essay: ta.value.trim(),
        semantic: lastResult.semantic,
        stylistic: lastResult.stylistic,
        pragmatic: lastResult.pragmatic,
        avg_score: lastResult.avg_score,
        overall_feedback: lastResult.overall_feedback,
        irrelevant: !!lastResult.irrelevant,
        ai_generated: lastResult.ai_generated || null,
      }, "ai_report.pdf");
    } catch (err) {
      showToast("Download failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };

  // ── Submit (calls the real backend, then saves the result) ─
  /** Sends the essay to the backend for scoring, saves the result, and shows it. */
  async function submitAssessment() {
    stopTimer();
    exitFullscreen();
    const essay = ta.value.trim();
    const btn = document.getElementById("submit-btn");
    btn.disabled = true;
    document.getElementById("submit-text").textContent = "Scoring with AI…";
    document.getElementById("submit-spinner").classList.remove("hidden");

    try {
      const res = await fetch(`${API_BASE}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ essay, topic: currentTopic, domain: selectedDomain }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Backend returned ${res.status}`);
      }
      const data = await res.json();
      lastResult = data;

      const saved = saveAssessment({
        student_name: getDisplayName(),
        student_email: getUserEmail("student"),  // captured at login; used to auto-email the comparison report
        domain: selectedDomain,
        topic: currentTopic,
        essay,
        semantic: data.semantic,
        stylistic: data.stylistic,
        pragmatic: data.pragmatic,
        avg_score: data.avg_score,
        overall_feedback: data.overall_feedback,
        irrelevant: !!data.irrelevant,
        ai_generated: data.ai_generated || null,
        integrity: { tab_switches: tabSwitches, fullscreen_exits: fullscreenExits, escape_presses: escapePresses, ended_by: endedBy === "manual" ? "submitted" : endedBy },
      });

      lastSavedId = saved.id;
      showResult(data);
      showToast("Essay scored successfully!", "success");
    } catch (err) {
      showToast("Scoring failed: " + err.message, "error");
    } finally {
      btn.disabled = false;
      document.getElementById("submit-text").textContent = "Submit for AI scoring";
      document.getElementById("submit-spinner").classList.add("hidden");
    }
  }

  /** Returns the HTML for a list of corrections (or a short note if there are none). */
  function renderCorrections(corrections) {
    if (!corrections || !corrections.length) {
      return `<p style="font-size:12.5px;color:var(--text3);font-style:italic;margin:4px 0 16px">No specific line-level issues flagged for this dimension.</p>`;
    }
    return `<div style="margin:6px 0 16px">${corrections.map(c => `
      <div class="correction-card">
        <div class="c-original">"${esc(c.original_text)}"</div>
        <div class="c-row c-expected"><span class="c-tag">Expected</span><span>${esc(c.expected)}</span></div>
        <div class="c-row c-correction"><span class="c-tag">Correction</span><span>${esc(c.correction)}</span></div>
      </div>`).join("")}</div>`;
  }

  /** Replaces the submit button area with the score, the three dimension scores, feedback and corrections. */
  function showResult(data) {
    document.getElementById("submit-area").classList.add("hidden");
    document.getElementById("result-area").classList.remove("hidden");

    const score = data.avg_score;
    const scoreEl = document.getElementById("result-score");
    scoreEl.textContent = score;
    scoreEl.style.color = scoreColor(score);
    document.getElementById("result-label").textContent = scoreLabel(score);
    document.getElementById("result-label").className = `badge ${scoreBadgeClass(score)}`;
    document.getElementById("result-feedback").textContent = data.overall_feedback || "AI analysis complete.";

    document.getElementById("result-notices").innerHTML = resultNoticesHtml(data);
    document.getElementById("report-email").textContent = getUserEmail("student");

    const dims = [["semantic","Semantic"],["stylistic","Stylistic"],["pragmatic","Pragmatic"]];
    document.getElementById("score-breakdown").innerHTML = dims.map(([key, label]) => {
      const d = data[key] || {};
      const col = scoreColor(d.score || 0);
      return `
        <div class="breakdown-row">
          <div class="label" style="width:90px">${label}</div>
          <div class="bar-wrap"><div class="bar-fill" style="width:${(d.score||0)*10}%;background:${col}"></div></div>
          <div class="score-val" style="color:${col}">${d.score}/10</div>
        </div>
        <p style="font-size:13px;color:var(--text2);line-height:1.6;margin:2px 0 10px">${esc(d.feedback)}</p>
        <div style="font-size:12.5px;font-weight:600;color:var(--text2);margin-bottom:6px"><i data-icon="pencil"></i> ${label} corrections</div>
        ${renderCorrections(d.corrections)}`;
    }).join("");
  }
