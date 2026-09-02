/** Per-bot author testing behavior: review sessions, code them, export results. */
(function () {
  const CODES = [
    "No testing",
    "Limited evaluation",
    "Opportunistic exploration",
    "Iterative refinement",
  ];
  const CODE_SLUG = {
    "No testing": "none",
    "Limited evaluation": "limited",
    "Opportunistic exploration": "opportunistic",
    "Iterative refinement": "iterative",
  };
  const KEY_STORAGE = "playlab_anthropic_key";

  const el = (id) => document.getElementById(id);
  const listEl = el("tbList");
  const detailEl = el("tbDetail");
  const summaryEl = el("tbSummary");
  const statusEl = el("tbStatus");
  const apiKeyEl = el("tbApiKey");
  const rememberEl = el("tbRemember");
  const runPanel = el("tbRunPanel");
  const runTitle = el("tbRunTitle");
  const runDetail = el("tbRunDetail");
  const runFill = el("tbRunFill");
  const runElapsed = el("tbRunElapsed");

  let bots = [];
  let storage = null;
  let selected = null;
  let detailCache = {};
  let running = false;
  let stopRequested = false;
  let labelingBot = "";
  let runTimer = null;
  let runStartedAt = 0;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function setStatus(text, kind = "") {
    statusEl.textContent = text || "";
    statusEl.className = `tb-status${kind ? ` is-${kind}` : ""}`;
  }

  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${s}s`;
  }

  function startRunTimer() {
    runStartedAt = Date.now();
    stopRunTimer();
    runTimer = window.setInterval(() => {
      if (runElapsed) runElapsed.textContent = fmtElapsed(Date.now() - runStartedAt);
    }, 1000);
    if (runElapsed) runElapsed.textContent = "0s";
  }

  function stopRunTimer() {
    if (runTimer) {
      window.clearInterval(runTimer);
      runTimer = null;
    }
  }

  function showRunPanel(show) {
    if (runPanel) runPanel.hidden = !show;
  }

  function setRunProgress({
    title = "",
    detail = "",
    done = 0,
    total = 0,
    bot = "",
  } = {}) {
    labelingBot = bot || "";
    if (runTitle) runTitle.textContent = title || "Labeling…";
    if (runDetail) runDetail.textContent = detail || "";
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (runFill) runFill.style.width = `${pct}%`;
    const track = runFill?.parentElement;
    if (track) {
      track.setAttribute("aria-valuenow", String(pct));
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-label", total ? `${done} of ${total} bots` : "Labeling progress");
    }
    renderList();
  }

  function clearRunProgress() {
    labelingBot = "";
    stopRunTimer();
    showRunPanel(false);
    setRunProgress({ title: "", detail: "", done: 0, total: 0 });
  }

  function pendingBotNames() {
    return bots
      .filter((b) => b.builder_sessions > 0 && !b.label)
      .map((b) => b.bot);
  }

  function chunkNames(names, size) {
    const out = [];
    for (let i = 0; i < names.length; i += size) out.push(names.slice(i, i + size));
    return out;
  }

  function formatBatchLabel(names) {
    if (!names.length) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names[0]}, ${names[1]}, +${names.length - 2} more`;
  }

  function apiKey() {
    return (apiKeyEl.value || "").trim();
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return String(iso).replace("T", " ").slice(0, 16);
  }

  // ---------------------------------------------------------------- data

  async function loadBots() {
    const res = await fetch("/api/testing-behavior/bots");
    if (!res.ok) throw new Error("Failed to load bots");
    const data = await res.json();
    bots = data.bots || [];
    storage = data.storage || null;
    const sheetLink = el("tbSheetLink");
    if (sheetLink && storage?.url) {
      sheetLink.href = storage.url;
      sheetLink.hidden = false;
      sheetLink.title = `Labels are stored on tab “${storage.tab || "testing_behavior"}”`;
    }
    if (storage && storage.credentials_configured === false) {
      setStatus(
        "Google credentials missing — labels cannot be saved to Sheet. Set GOOGLE_CREDENTIALS_JSON.",
        "err"
      );
    }
  }

  async function loadDetail(name) {
    if (detailCache[name]) return detailCache[name];
    const res = await fetch(`/api/testing-behavior/bot?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error("Failed to load bot sessions");
    const data = await res.json();
    detailCache[name] = data;
    return data;
  }

  // ------------------------------------------------------------- summary

  function renderSummary() {
    const total = bots.length;
    const labeled = bots.filter((b) => b.label).length;
    const counts = {};
    CODES.forEach((c) => (counts[c] = bots.filter((b) => b.label === c).length));

    const withRate = (code) => {
      const rows = bots.filter((b) => b.label === code && b.student_fail_rate !== null);
      if (!rows.length) return null;
      const sum = rows.reduce((a, b) => a + b.student_fail_rate, 0);
      return (sum / rows.length).toFixed(1);
    };

    const max = Math.max(1, ...CODES.map((c) => counts[c]));
    const bars = CODES.map((c) => {
      const n = counts[c];
      const rate = withRate(c);
      return `
        <div class="tb-bar-row">
          <div class="tb-bar-label">
            <span class="tb-dot tb-dot-${CODE_SLUG[c]}"></span>${escapeHtml(c)}
          </div>
          <div class="tb-bar-track">
            <div class="tb-bar-fill tb-bar-${CODE_SLUG[c]}" style="width:${(n / max) * 100}%"></div>
          </div>
          <div class="tb-bar-value">${n}</div>
          <div class="tb-bar-rate" title="Mean student-facing fail rate for bots in this category">
            ${rate === null ? "—" : `${rate}% fail`}
          </div>
        </div>`;
    }).join("");

    summaryEl.innerHTML = `
      <div class="tb-summary-stats">
        <div class="tb-stat"><span class="tb-stat-value">${total}</span><span class="tb-stat-label">bots</span></div>
        <div class="tb-stat"><span class="tb-stat-value">${labeled}</span><span class="tb-stat-label">labeled</span></div>
        <div class="tb-stat"><span class="tb-stat-value">${total - labeled}</span><span class="tb-stat-label">remaining</span></div>
      </div>
      <div class="tb-summary-chart">${bars}</div>
      <div class="tb-storage-note" title="Source of truth for labels">
        ${
          storage?.credentials_configured
            ? `Saved on Google Sheet · tab <code>${escapeHtml(storage.tab || "testing_behavior")}</code>`
            : `<span class="tb-storage-warn">Sheet credentials not configured — saves will fail</span>`
        }
      </div>`;
  }

  // ---------------------------------------------------------------- list

  function visibleBots() {
    const q = (el("tbSearch").value || "").trim().toLowerCase();
    const mode = el("tbFilter").value;
    return bots.filter((b) => {
      if (q && !b.bot.toLowerCase().includes(q)) return false;
      if (mode === "unlabeled" && b.label) return false;
      if (mode === "labeled" && !b.label) return false;
      if (mode === "deployed" && !b.deployed) return false;
      if (mode === "ai" && b.source !== "ai") return false;
      if (mode === "manual" && b.source !== "manual") return false;
      return true;
    });
  }

  function renderList() {
    const rows = visibleBots();
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty">No bots match this filter.</div>`;
      return;
    }
    listEl.innerHTML = rows
      .map((b) => {
        const tag = b.label
          ? `<span class="tb-tag tb-tag-${CODE_SLUG[b.label]}">${escapeHtml(b.label)}</span>`
          : `<span class="tb-tag tb-tag-empty">unlabeled</span>`;
        const src = b.source === "ai" ? `<span class="tb-src">AI</span>` : b.source === "manual" ? `<span class="tb-src tb-src-manual">manual</span>` : "";
        const fail =
          b.student_fail_rate === null
            ? ""
            : `<span class="tb-meta-item" title="Bot-reply fail rate on student conversations">${b.student_fail_rate}% fail</span>`;
        return `
          <button type="button" class="tb-row${selected === b.bot ? " is-selected" : ""}${labelingBot === b.bot ? " is-labeling" : ""}" data-bot="${escapeHtml(b.bot)}">
            <div class="tb-row-top">
              <span class="tb-row-name">${escapeHtml(b.bot)}</span>
              ${tag}${src}
            </div>
            <div class="tb-row-meta">
              <span class="tb-meta-item">${b.builder_sessions} sessions</span>
              <span class="tb-meta-item">${b.bursts} bursts</span>
              <span class="tb-meta-item">${b.distinct_days}d</span>
              <span class="tb-meta-item" title="Share of author probes re-run in more than one session">repeat ${b.repeat_probe_ratio}</span>
              ${fail}
            </div>
          </button>`;
      })
      .join("");

    listEl.querySelectorAll(".tb-row").forEach((btn) => {
      btn.addEventListener("click", () => selectBot(btn.dataset.bot));
    });
  }

  // -------------------------------------------------------------- detail

  function signalsHtml(p) {
    if (!p) return "";
    const items = [
      ["Builder sessions", p.builder_sessions],
      ["Pre-launch", p.pre_launch_sessions],
      ["Post-launch", p.post_launch_sessions],
      ["Undated", p.undated_sessions],
      ["Distinct days", p.distinct_days],
      ["Bursts (>30min apart)", p.bursts],
      ["Median turns", p.median_turns],
      ["Repeat-probe ratio", p.repeat_probe_ratio],
      ["Student conversations", p.student_conversations],
      ["Student fail rate", p.student_fail_rate === null ? "—" : `${p.student_fail_rate}%`],
    ];
    return `<div class="tb-signals">${items
      .map(
        ([k, v]) =>
          `<div class="tb-signal"><span class="tb-signal-k">${escapeHtml(k)}</span><span class="tb-signal-v">${escapeHtml(String(v))}</span></div>`
      )
      .join("")}</div>`;
  }

  function coderHtml(b) {
    const opts = CODES.map(
      (c) => `<option value="${escapeHtml(c)}"${b.label === c ? " selected" : ""}>${escapeHtml(c)}</option>`
    ).join("");
    return `
      <div class="tb-coder">
        <div class="tb-coder-row">
          <label for="tbCode">Code</label>
          <select id="tbCode" class="tb-code-select">
            <option value="">— unlabeled —</option>
            ${opts}
          </select>
          <select id="tbConfidence" class="tb-code-select tb-code-conf">
            <option value="">confidence</option>
            <option value="high"${b.confidence === "high" ? " selected" : ""}>high</option>
            <option value="medium"${b.confidence === "medium" ? " selected" : ""}>medium</option>
            <option value="low"${b.confidence === "low" ? " selected" : ""}>low</option>
          </select>
          <button type="button" class="tb-btn tb-btn-primary" id="tbSave">Save</button>
          <button type="button" class="tb-btn" id="tbRunOne">Label with AI</button>
          <span class="tb-save-status" id="tbSaveStatus"></span>
        </div>
        <textarea id="tbRationale" class="tb-textarea" rows="3" placeholder="Rationale — cite specific probes and timestamps">${escapeHtml(b.rationale || "")}</textarea>
        <textarea id="tbDefect" class="tb-textarea" rows="2" placeholder="Defect observed in the author's own sessions (deviation from the system prompt), if any">${escapeHtml(b.defect_observed || "")}</textarea>
      </div>`;
  }

  function sessionsHtml(detail) {
    if (!detail.sessions.length) {
      return `<div class="empty">No author testing sessions exist for this bot.</div>`;
    }
    return detail.sessions
      .map((s, i) => {
        const msgs = s.messages
          .map(
            (m) =>
              `<div class="tb-msg tb-msg-${m.role}"><span class="tb-msg-role">${m.role}</span><div class="tb-msg-body">${escapeHtml(m.content)}</div></div>`
          )
          .join("");
        return `
          <details class="tb-session"${i < 3 ? " open" : ""}>
            <summary>
              <span class="tb-session-n">#${i + 1}</span>
              <span class="tb-session-time">${fmtDate(s.started_at)}</span>
              <span class="tb-session-tag${s.pre_launch ? " is-pre" : ""}">${s.pre_launch ? "pre-launch" : "post-launch"}</span>
              <span class="tb-session-turns">${s.turns} turns</span>
              <span class="tb-session-author">${escapeHtml(s.author)}</span>
            </summary>
            <div class="tb-session-body">${msgs}</div>
          </details>`;
      })
      .join("");
  }

  async function selectBot(name) {
    selected = name;
    renderList();
    detailEl.innerHTML = `<div class="empty">Loading sessions…</div>`;
    try {
      const detail = await loadDetail(name);
      const b = bots.find((x) => x.bot === name) || {};
      detailEl.innerHTML = `
        <header class="tb-detail-head">
          <h2>${escapeHtml(name)}</h2>
          <span class="tb-detail-sub">${detail.sessions.length} author sessions · first student ${fmtDate(detail.first_student) || "never"}</span>
        </header>
        ${signalsHtml(detail.profile)}
        ${coderHtml(b)}
        <details class="tb-prompt">
          <summary>System prompt — what the bot is supposed to do</summary>
          <pre>${escapeHtml(detail.system_prompt || "(not captured in the export)")}</pre>
        </details>
        <div class="tb-sessions">${sessionsHtml(detail)}</div>`;
      wireDetail(name);
    } catch (err) {
      detailEl.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function wireDetail(name) {
    el("tbSave")?.addEventListener("click", async () => {
      const status = el("tbSaveStatus");
      try {
        status.textContent = "Saving…";
        const res = await fetch("/api/testing-behavior/label", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bot: name,
            code: el("tbCode").value,
            confidence: el("tbConfidence").value,
            rationale: el("tbRationale").value,
            defect_observed: el("tbDefect").value,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).detail || "Save failed");
        const row = await res.json();
        applyRow(name, row);
        status.textContent = "Saved";
        setTimeout(() => (status.textContent = ""), 1500);
      } catch (err) {
        status.textContent = err.message;
      }
    });

    el("tbRunOne")?.addEventListener("click", async () => {
      if (!apiKey()) {
        setStatus("Enter an Anthropic API key first", "err");
        apiKeyEl.focus();
        return;
      }
      const status = el("tbSaveStatus");
      try {
        showRunPanel(true);
        startRunTimer();
        setRunProgress({
          title: `Labeling ${name}`,
          detail: "Calling Claude with this bot's author sessions…",
          bot: name,
        });
        setStatus("AI labeling in progress…");
        const res = await fetch("/api/testing-behavior/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: apiKey(), bot: name }),
        });
        if (!res.ok) throw new Error((await res.json()).detail || "Labeling failed");
        const data = await res.json();
        const row = data.results?.[0]?.label;
        if (row) {
          applyRow(name, row);
          selectBot(name);
        }
        setRunProgress({
          title: `Done — ${name}`,
          detail: row?.code ? `→ ${row.code}` : "Labeled",
          bot: "",
        });
        setStatus(row?.code ? `${name} → ${row.code}` : "Labeled", "ok");
        status.textContent = "Labeled";
      } catch (err) {
        setStatus(err.message, "err");
        status.textContent = err.message;
      } finally {
        window.setTimeout(clearRunProgress, 2500);
      }
    });
  }

  function applyRow(name, row) {
    const b = bots.find((x) => x.bot === name);
    if (!b) return;
    b.label = row.code || "";
    b.rationale = row.rationale || "";
    b.confidence = row.confidence || "";
    b.defect_observed = row.defect_observed || "";
    b.source = row.source || "";
    renderSummary();
    renderList();
  }

  // ------------------------------------------------------------ ai batch

  async function runBatch() {
    if (running) return;
    if (!apiKey()) {
      setStatus("Enter an Anthropic API key first", "err");
      apiKeyEl.focus();
      return;
    }
    running = true;
    stopRequested = false;
    el("tbRun").disabled = true;
    el("tbStop").hidden = false;

    try {
      const pv = await (await fetch("/api/testing-behavior/preview")).json();
      const queue = (pv.pending_bots || []).filter(Boolean);
      if (!queue.length) {
        setStatus("Every bot with author sessions is already labeled");
        return;
      }
      const ok = window.confirm(
        `Label ${queue.length} bots with ${pv.model}?\n\nEstimated cost ~$${pv.estimated_usd}.\nThe API key stays in this browser tab and is not stored on the server.`
      );
      if (!ok) {
        setStatus("");
        return;
      }

      showRunPanel(true);
      startRunTimer();

      let done = 0;
      let failed = 0;
      let cost = 0;
      const batchSize = Math.max(1, Number(el("tbBatch").value) || 1);
      const batches = chunkNames(queue, batchSize);
      const total = queue.length;

      for (let bi = 0; bi < batches.length; bi += 1) {
        if (stopRequested) {
          setRunProgress({
            title: "Stopping…",
            detail: `Finished ${done} of ${total} before stop`,
            done,
            total,
            bot: "",
          });
          setStatus(`Stopped after ${done} bots (~$${cost.toFixed(2)})`);
          break;
        }

        const names = batches[bi];
        const batchLabel = formatBatchLabel(names);
        const indexStart = done + 1;
        const indexEnd = Math.min(done + names.length, total);

        setRunProgress({
          title:
            names.length === 1
              ? `Labeling ${batchLabel} (${indexStart}/${total})`
              : `Labeling batch ${bi + 1}/${batches.length}: ${batchLabel}`,
          detail:
            names.length === 1
              ? `Calling Claude — ${names[0].length > 48 ? `${names[0].slice(0, 48)}…` : names[0]} · waiting for response…`
              : `Calling Claude for ${names.length} bots (${indexStart}–${indexEnd} of ${total}) · this may take a few minutes…`,
          done,
          total,
          bot: names[0],
        });
        setStatus(
          names.length === 1
            ? `Labeling ${batchLabel} (${indexStart}/${total})…`
            : `Labeling ${names.length} bots (${indexStart}–${indexEnd}/${total})…`
        );

        const res = await fetch("/api/testing-behavior/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey(),
            batch_size: names.length,
            only_unlabeled: true,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).detail || "Batch failed");
        const data = await res.json();
        const batchCost = data.cost_usd || 0;

        (data.results || []).forEach((r) => {
          applyRow(r.bot, r.label);
          const code = r.label?.code || "labeled";
          setRunProgress({
            title: `Saved ${r.bot}`,
            detail: `→ ${code}`,
            done: done + 1,
            total,
            bot: "",
          });
        });

        (data.errors || []).forEach((err) => {
          setRunProgress({
            title: `Failed — ${err.bot}`,
            detail: err.error || "Unknown error",
            done,
            total,
            bot: "",
          });
        });

        done += data.labeled || 0;
        failed += data.failed || 0;
        cost += batchCost;

        if (data.results?.length) {
          setRunProgress({
            title: `Batch ${bi + 1}/${batches.length} complete`,
            detail: `${done}/${total} bots · ~$${cost.toFixed(2)} so far`,
            done,
            total,
            bot: "",
          });
        }

        if (data.done || !data.processed) {
          setRunProgress({
            title: failed ? "Finished with errors" : "All bots labeled",
            detail: failed
              ? `${done} labeled, ${failed} failed · ~$${cost.toFixed(2)} total`
              : `${done} bots labeled · ~$${cost.toFixed(2)} total`,
            done: total,
            total,
            bot: "",
          });
          setStatus(
            failed
              ? `Finished: ${done} labeled, ${failed} failed (~$${cost.toFixed(2)})`
              : `Finished: ${done} bots labeled (~$${cost.toFixed(2)})`,
            failed ? "err" : "ok"
          );
          break;
        }
      }
      await refresh();
    } catch (err) {
      setRunProgress({
        title: "Labeling failed",
        detail: err.message || "Unknown error",
        bot: "",
      });
      setStatus(err.message || "AI labeling failed", "err");
    } finally {
      running = false;
      el("tbRun").disabled = false;
      el("tbStop").hidden = true;
      window.setTimeout(clearRunProgress, failedOrDoneDelay());
    }
  }

  function failedOrDoneDelay() {
    return 4000;
  }

  // ---------------------------------------------------------------- init

  async function refresh() {
    try {
      await loadBots();
      renderSummary();
      renderList();
      if (selected) {
        const b = bots.find((x) => x.bot === selected);
        if (b) {
          const d = el("tbCode");
          if (d) d.value = b.label || "";
        }
      }
    } catch (err) {
      listEl.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function wire() {
    el("tbRefresh").addEventListener("click", refresh);
    el("tbRun").addEventListener("click", runBatch);
    el("tbStop").addEventListener("click", () => {
      stopRequested = true;
      setRunProgress({
        title: "Stop requested",
        detail: "Will stop after the current Claude call finishes…",
        bot: labelingBot,
      });
      setStatus("Stopping after current bot…");
    });
    el("tbSearch").addEventListener("input", renderList);
    el("tbFilter").addEventListener("change", renderList);

    rememberEl.addEventListener("change", () => {
      if (rememberEl.checked) sessionStorage.setItem(KEY_STORAGE, apiKey());
      else sessionStorage.removeItem(KEY_STORAGE);
    });
    apiKeyEl.addEventListener("input", () => {
      if (rememberEl.checked) sessionStorage.setItem(KEY_STORAGE, apiKey());
    });

    const saved = sessionStorage.getItem(KEY_STORAGE);
    if (saved) {
      apiKeyEl.value = saved;
      rememberEl.checked = true;
    }
  }

  wire();
  refresh();
})();
