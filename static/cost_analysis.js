let costAnalysisData = null;
let costStageMode = "split";
let costDateZoom = 1.76;
const COST_DATE_ZOOM_DEFAULT = 1.76;
const COST_DATE_ZOOM_MIN = 1;
const COST_DATE_ZOOM_MAX = 10;

const costAnalysisBody = document.getElementById("costAnalysisBody");

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatUsd(n) {
  const v = Number(n) || 0;
  if (v >= 100) return `$${v.toFixed(2)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

function shortBotName(name, max = 28) {
  const s = String(name || "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fillCalendarDayPoints(byDate) {
  const known = (byDate || []).filter((d) => d && d.date && d.date !== "unknown");
  if (known.length < 2) return known;
  const byKey = new Map(known.map((d) => [String(d.date).slice(0, 10), d]));
  const keys = [...byKey.keys()].sort();
  const start = new Date(`${keys[0]}T00:00:00Z`);
  const end = new Date(`${keys[keys.length - 1]}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return known;

  const filled = [];
  let running = 0;
  let runningAuthor = 0;
  let runningAnon = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    const src = byKey.get(key);
    const author = Number(src?.author_cost_usd) || 0;
    const anon = Number(src?.anonymous_cost_usd) || 0;
    const cost = Number(src?.cost_usd) || author + anon;
    running += cost;
    runningAuthor += author;
    runningAnon += anon;
    filled.push({
      date: key,
      conversations: Number(src?.conversations) || 0,
      author_conversations: Number(src?.author_conversations) || 0,
      anonymous_conversations: Number(src?.anonymous_conversations) || 0,
      cost_usd: cost,
      author_cost_usd: author,
      anonymous_cost_usd: anon,
      cumulative_cost_usd: running,
      cumulative_author_cost_usd: runningAuthor,
      cumulative_anonymous_cost_usd: runningAnon,
    });
  }
  return filled;
}

function costDateLineChartHtml(byDate) {
  const points = fillCalendarDayPoints(byDate);
  if (points.length < 2) return "";

  const zoom = Math.min(COST_DATE_ZOOM_MAX, Math.max(COST_DATE_ZOOM_MIN, costDateZoom));
  const height = 256;
  const pad = { top: 16, right: 16, bottom: 46, left: 40 };
  const baseInnerW = 656;
  const innerW = baseInnerW * zoom;
  const width = pad.left + pad.right + innerW;
  const innerH = height - pad.top - pad.bottom;
  const maxDaily = Math.max(...points.map((d) => Number(d.cost_usd) || 0), 0.0001);
  const maxCum = Math.max(...points.map((d) => Number(d.cumulative_cost_usd) || 0), 0.0001);
  const n = points.length;

  const xAt = (i) => pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yDaily = (v) => pad.top + innerH - (Number(v) / maxDaily) * innerH;
  const yCum = (v) => pad.top + innerH - (Number(v) / maxCum) * innerH;
  const barGap = 0.6;
  const barW = Math.max(1.2, Math.min(10, innerW / n - barGap));

  const cumPath = points
    .map(
      (d, i) =>
        `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yCum(d.cumulative_cost_usd).toFixed(1)}`
    )
    .join(" ");

  const stackedBars = points
    .map((d, i) => {
      const author = Number(d.author_cost_usd) || 0;
      const anon = Number(d.anonymous_cost_usd) || 0;
      const total = author + anon;
      if (total <= 0) return "";
      const x = xAt(i) - barW / 2;
      const yBase = pad.top + innerH;
      const yTotal = yDaily(total);
      const yAuthorTop = yDaily(author);
      const authorH = Math.max(0, yBase - yAuthorTop);
      const anonH = Math.max(0, yAuthorTop - yTotal);
      const tip = `${d.date} · authors ${formatUsd(author)} · anon ${formatUsd(anon)} · total ${formatUsd(
        total
      )} · cum ${formatUsd(d.cumulative_cost_usd)} · ${d.conversations} convs`;
      return `
        <g class="stack-bar">
          <title>${escapeHtml(tip)}</title>
          <rect x="${x.toFixed(1)}" y="${yAuthorTop.toFixed(1)}" width="${barW.toFixed(
        1
      )}" height="${authorH.toFixed(1)}" class="stack-author" />
          <rect x="${x.toFixed(1)}" y="${yTotal.toFixed(1)}" width="${barW.toFixed(
        1
      )}" height="${anonH.toFixed(1)}" class="stack-anon" />
        </g>`;
    })
    .join("");

  const MONTH_ABBR = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const monthBands = [];
  let currentBand = null;
  points.forEach((d, i) => {
    const raw = String(d.date || "");
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (!m) return;
    const key = `${m[1]}-${m[2]}`;
    if (!currentBand || currentBand.key !== key) {
      currentBand = {
        key,
        start: i,
        end: i,
        month: MONTH_ABBR[Number(m[2]) - 1] || m[2],
        year: m[1],
      };
      monthBands.push(currentBand);
    } else {
      currentBand.end = i;
    }
  });

  const monthHighlights = monthBands
    .map((band, bi) => {
      const x0 = xAt(band.start) - barW / 2;
      const x1 = xAt(band.end) + barW / 2;
      const w = Math.max(1, x1 - x0);
      return `<rect
        class="month-band"
        data-month="${bi}"
        x="${x0.toFixed(1)}"
        y="${pad.top}"
        width="${w.toFixed(1)}"
        height="${innerH.toFixed(1)}"
      />`;
    })
    .join("");

  const xLabels = monthBands
    .map((band, bi) => {
      const x = xAt(band.start);
      return `<text
        x="${x.toFixed(1)}"
        y="${height - 18}"
        text-anchor="middle"
        class="line-axis-label month-axis-label"
        data-month="${bi}"
      ><tspan x="${x.toFixed(1)}" dy="0">${escapeHtml(band.month)}</tspan><tspan x="${x.toFixed(
        1
      )}" dy="9" class="month-axis-year">${escapeHtml(band.year)}</tspan></text>`;
    })
    .join("");

  const yTicks = [0, 0.5, 1]
    .map((t) => {
      const y = pad.top + innerH * (1 - t);
      const val = formatUsd(maxDaily * t);
      return `
        <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(
        1
      )}" class="line-grid" />
        <text x="${pad.left - 6}" y="${(y + 2.5).toFixed(1)}" text-anchor="end" class="line-axis-label">${val}</text>`;
    })
    .join("");

  const zoomPct = Math.round(zoom * 100);

  return `
    <div class="cost-chart-card cost-line-card" id="costDateChartHost">
      <div class="cost-chart-head">
        <h3>Cost by date</h3>
        <div class="cost-chart-head-right">
          <div class="line-legend">
            <span class="leg-author">Authors (builder + other)</span>
            <span class="leg-anon">Anonymous</span>
            <span class="leg-cum">Cumulative</span>
          </div>
          <div class="cost-date-zoom" title="⌘/Ctrl + trackpad pinch (or scroll) to zoom">
            <button type="button" class="zoom-btn" id="costDateZoomOut" aria-label="Zoom out">−</button>
            <button type="button" class="zoom-fit" id="costDateZoomFit" title="Reset zoom">Fit</button>
            <button type="button" class="zoom-btn" id="costDateZoomIn" aria-label="Zoom in">+</button>
            <span class="zoom-label" id="costDateZoomLabel">${zoomPct}%</span>
            <span class="zoom-hint">⌘ + pinch</span>
          </div>
        </div>
      </div>
      <div class="line-chart-wrap" id="costDateChartWrap">
        <svg
          class="line-chart"
          width="${width}"
          height="${height}"
          viewBox="0 0 ${width} ${height}"
          preserveAspectRatio="none"
          role="img"
          aria-label="Cost by date chart"
          style="width:${width}px;height:${height}px"
        >
          ${monthHighlights}
          ${yTicks}
          ${stackedBars}
          <path d="${cumPath}" class="line-cum" fill="none" />
          ${xLabels}
        </svg>
      </div>
    </div>`;
}

function refreshCostDateChart(opts = {}) {
  const host = document.getElementById("costDateChartHost");
  if (!host || !costAnalysisData) return;
  const wrap = document.getElementById("costDateChartWrap");
  const contentRatio = opts.contentRatio;
  const viewportOffset = opts.viewportOffset ?? 0;

  const tmp = document.createElement("div");
  tmp.innerHTML = costDateLineChartHtml(costAnalysisData.by_date || []);
  const next = tmp.firstElementChild;
  if (!next) return;
  host.replaceWith(next);
  const newWrap = document.getElementById("costDateChartWrap");
  if (newWrap && contentRatio != null) {
    newWrap.scrollLeft = Math.max(0, contentRatio * newWrap.scrollWidth - viewportOffset);
  }
  wireCostDateChartZoom();
}

function setCostDateZoom(next, opts = {}) {
  const clamped = Math.min(COST_DATE_ZOOM_MAX, Math.max(COST_DATE_ZOOM_MIN, next));
  if (Math.abs(clamped - costDateZoom) < 0.001) return;
  costDateZoom = clamped;
  refreshCostDateChart(opts);
}

function wireCostDateMonthHover() {
  const svg = document.querySelector("#costDateChartHost .line-chart");
  if (!svg || svg.dataset.monthHoverWired) return;
  svg.dataset.monthHoverWired = "1";

  const setActive = (monthId) => {
    svg.querySelectorAll(".month-band, .month-axis-label").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.month === monthId);
    });
  };
  const clearActive = () => {
    svg.querySelectorAll(".month-band.is-active, .month-axis-label.is-active").forEach((el) => {
      el.classList.remove("is-active");
    });
  };

  svg.querySelectorAll(".month-axis-label, .month-band").forEach((el) => {
    el.addEventListener("mouseenter", () => setActive(el.dataset.month));
    el.addEventListener("mouseleave", clearActive);
  });
}

function wireCostDateChartZoom() {
  const host = document.getElementById("costDateChartHost");
  const wrap = document.getElementById("costDateChartWrap");
  if (!host || !wrap) return;
  wireCostDateMonthHover();
  if (host.dataset.zoomWired) return;
  host.dataset.zoomWired = "1";

  document.getElementById("costDateZoomIn")?.addEventListener("click", () => {
    const mid = wrap.scrollLeft + wrap.clientWidth / 2;
    setCostDateZoom(costDateZoom * 1.25, {
      contentRatio: mid / Math.max(1, wrap.scrollWidth),
      viewportOffset: wrap.clientWidth / 2,
    });
  });
  document.getElementById("costDateZoomOut")?.addEventListener("click", () => {
    const mid = wrap.scrollLeft + wrap.clientWidth / 2;
    setCostDateZoom(costDateZoom / 1.25, {
      contentRatio: mid / Math.max(1, wrap.scrollWidth),
      viewportOffset: wrap.clientWidth / 2,
    });
  });
  document.getElementById("costDateZoomFit")?.addEventListener("click", () => {
    setCostDateZoom(COST_DATE_ZOOM_DEFAULT, { contentRatio: 0, viewportOffset: 0 });
  });

  wrap.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const viewportOffset = e.clientX - rect.left;
      const contentX = wrap.scrollLeft + viewportOffset;
      const contentRatio = contentX / Math.max(1, wrap.scrollWidth);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setCostDateZoom(costDateZoom * factor, { contentRatio, viewportOffset });
    },
    { passive: false }
  );
}

function costBarChartsHtml(models, bots, byDate) {
  const modelData = (models || []).filter((m) => Number(m.cost_usd) > 0);
  const botData = (bots || []).filter((b) => Number(b.cost_usd) > 0).slice(0, 15);
  const dateChart = costDateLineChartHtml(byDate);
  if (!modelData.length && !botData.length && !dateChart) return "";

  const maxModel = Math.max(...modelData.map((m) => Number(m.cost_usd) || 0), 0.0001);
  const maxBot = Math.max(...botData.map((b) => Number(b.cost_usd) || 0), 0.0001);

  const modelBars = modelData
    .map((m) => {
      const cost = Number(m.cost_usd) || 0;
      const pct = Math.max(4, (cost / maxModel) * 100);
      return `
        <div class="vbar" title="${escapeHtml(m.model)} · ${formatUsd(cost)}">
          <div class="vbar-value">${formatUsd(cost)}</div>
          <div class="vbar-col">
            <div class="vbar-fill" style="height:${pct}%"></div>
          </div>
          <div class="vbar-label">${escapeHtml(m.model)}</div>
        </div>`;
    })
    .join("");

  const botBars = botData
    .map((b) => {
      const cost = Number(b.cost_usd) || 0;
      const pct = Math.max(2, (cost / maxBot) * 100);
      return `
        <div class="hbar" title="${escapeHtml(b.bot)} · ${escapeHtml(b.model)} · ${formatUsd(cost)}">
          <div class="hbar-label">${escapeHtml(shortBotName(b.bot))}</div>
          <div class="hbar-track">
            <div class="hbar-fill" style="width:${pct}%">
              <span class="hbar-meta">${escapeHtml(shortBotName(b.model, 18))}</span>
            </div>
          </div>
          <div class="hbar-value">${formatUsd(cost)}</div>
        </div>`;
    })
    .join("");

  return `
    ${dateChart}
    <div class="cost-charts">
      ${
        modelData.length
          ? `<div class="cost-chart-card">
              <div class="cost-chart-head">
                <h3>Cost by model</h3>
                <span class="cost-chart-caption">Estimated USD</span>
              </div>
              <div class="vbar-chart">${modelBars}</div>
            </div>`
          : ""
      }
      ${
        botData.length
          ? `<div class="cost-chart-card">
              <div class="cost-chart-head">
                <h3>Top bots by cost</h3>
                <span class="cost-chart-caption">Top ${botData.length}</span>
              </div>
              <div class="hbar-chart">${botBars}</div>
            </div>`
          : ""
      }
    </div>`;
}

function estimateWhatIfConversations(data, authors, days) {
  const summary = data.summary || {};
  const authorRate = Number(summary.avg_author_conversations_per_author_per_day) || 0;
  const anonRate = Number(summary.avg_anonymous_conversations_per_author_per_day) || 0;
  const authorConvs = Math.max(0, Math.round(authors * days * authorRate));
  const anonConvs = Math.max(0, Math.round(authors * days * anonRate));
  return {
    author: authorConvs,
    anonymous: anonConvs,
    total: authorConvs + anonConvs,
    authorRate,
    anonRate,
  };
}

function costWhatIfHtml(data) {
  const summary = data.summary || {};
  const method = data.method || {};
  const pricing = method.pricing_usd_per_mtok || {};
  const modelOptions = data.model_options?.length
    ? data.model_options
    : ["mixed", ...Object.keys(pricing)];
  const defaultModel = "mixed";

  const authors = Math.max(1, Number(summary.authors) || 1);
  const days = Math.max(1, Number(summary.span_days) || 1);

  const options = modelOptions
    .map((m) => {
      const label = m === "mixed" ? "mixed" : m;
      return `<option value="${escapeHtml(m)}" ${m === defaultModel ? "selected" : ""}>${escapeHtml(
        label
      )}</option>`;
    })
    .join("");

  return `
    <div class="cost-whatif cost-whatif-page" id="costWhatIf">
      <div class="cost-whatif-layout">
        <div class="cost-whatif-left">
          <div class="cost-whatif-copy">
            <div class="cost-whatif-kicker">Scenario</div>
            <div class="cost-whatif-prose" id="costWhatIfLines">
            <p class="cost-whatif-line">
              We will take
              <span class="whatif-blank-wrap">
                <input type="number" min="1" step="1" id="whatIfAuthors" class="whatif-blank whatif-blank-num" value="${authors}" aria-label="users" />
                <span class="whatif-caret" aria-hidden="true"></span>
              </span>
              users
              in
              <span class="whatif-blank-wrap">
                <input type="number" min="1" step="1" id="whatIfDays" class="whatif-blank whatif-blank-num" value="${days}" aria-label="days" />
                <span class="whatif-caret" aria-hidden="true"></span>
              </span>
              days
            </p>
            <p class="cost-whatif-line">
              with
              <span class="whatif-blank-wrap whatif-blank-wrap-select">
                <select id="whatIfModel" class="whatif-blank whatif-blank-select" aria-label="AI model">${options}</select>
                <span class="whatif-caret" aria-hidden="true"></span>
                <span class="whatif-chevron" aria-hidden="true"></span>
              </span>
              AI model(s)
            </p>
            <p class="cost-whatif-line">
              Users may send
              <span class="whatif-blank-wrap whatif-free-wrap">
                <input
                  type="number"
                  min="0"
                  step="1"
                  id="whatIfFreeMsgs"
                  class="whatif-blank whatif-blank-num whatif-blank-free"
                  value=""
                  placeholder="100"
                  aria-label="free messages per user"
                />
                <span class="whatif-caret" aria-hidden="true"></span>
              </span>
              <button type="button" class="whatif-unlimited-btn is-active" id="whatIfFreeUnlimited" aria-pressed="true">
                unlimited
              </button>
              messages free
            </p>
          </div>
          </div>
        </div>
        <aside class="cost-whatif-right" aria-live="polite">
          <div class="cost-whatif-price" id="costWhatIfResult">
            <div class="cost-whatif-price-block">
              <div class="label">Estimated cost</div>
              <div class="value" id="whatIfEstValue">—</div>
              <div class="sub" id="whatIfEstSub"></div>
            </div>
            <div class="cost-whatif-price-block secondary">
              <div class="label">Maximum cost</div>
              <div class="value max" id="whatIfMaxValue">—</div>
              <div class="sub" id="whatIfMaxSub"></div>
            </div>
          </div>
          <div class="cost-whatif-breakdown" id="costWhatIfBreakdown"></div>
        </aside>
      </div>
    </div>`;
}

function readFreeMessages() {
  const btn = document.getElementById("whatIfFreeUnlimited");
  const input = document.getElementById("whatIfFreeMsgs");
  const unlimited = btn?.classList.contains("is-active") || btn?.getAttribute("aria-pressed") === "true";
  if (unlimited) return { unlimited: true, perUser: null };
  const n = Number(input?.value);
  if (!Number.isFinite(n) || n < 0) return { unlimited: true, perUser: null };
  return { unlimited: false, perUser: n };
}

function setFreeMessagesMode(mode) {
  const btn = document.getElementById("whatIfFreeUnlimited");
  const input = document.getElementById("whatIfFreeMsgs");
  if (!btn || !input) return;
  const unlimited = mode === "unlimited";
  btn.classList.toggle("is-active", unlimited);
  btn.setAttribute("aria-pressed", unlimited ? "true" : "false");
  input.classList.toggle("is-dimmed", unlimited);
  if (!unlimited && (input.value === "" || input.value == null)) {
    input.value = "100";
  }
  fitWhatIfBlank(input);
}

function avgTokensPerMessage(data) {
  const summary = data.summary || {};
  let inPerMsg = Number(summary.avg_input_tokens_per_message);
  let outPerMsg = Number(summary.avg_output_tokens_per_message);
  if (inPerMsg > 0 || outPerMsg > 0) {
    return { input: inPerMsg || 0, output: outPerMsg || 0 };
  }

  const avgIn = Number(summary.avg_input_tokens_per_conv) || 0;
  const avgOut = Number(summary.avg_output_tokens_per_conv) || 0;
  let avgMsgs = Number(summary.avg_messages_per_conv) || 0;
  if (avgMsgs <= 0) {
    const bots = data.bots || [];
    const totalMsgs = bots.reduce((sum, row) => sum + (Number(row.messages) || 0), 0);
    const totalConvs = bots.reduce((sum, row) => sum + (Number(row.conversations) || 0), 0);
    avgMsgs = totalConvs > 0 ? totalMsgs / totalConvs : 0;
  }
  if (avgMsgs <= 0) {
    return { input: 0, output: 0 };
  }
  return { input: avgIn / avgMsgs, output: avgOut / avgMsgs };
}

function avgMessagesPerConversation(data) {
  const summary = data.summary || {};
  let avgMsgs = Number(summary.avg_messages_per_conv) || 0;
  if (avgMsgs > 0) return avgMsgs;
  const bots = data.bots || [];
  const totalMsgs = bots.reduce((sum, row) => sum + (Number(row.messages) || 0), 0);
  const totalConvs = bots.reduce((sum, row) => sum + (Number(row.conversations) || 0), 0);
  return totalConvs > 0 ? totalMsgs / totalConvs : 0;
}

function pricingFromData(data, modelName) {
  const method = data.method || {};
  const table = method.pricing_usd_per_mtok || {};
  const fallback = method.default_pricing_usd_per_mtok || { input: 3, output: 15 };
  if ((modelName || "").toLowerCase() === "mixed") {
    return method.mixed_pricing_usd_per_mtok || fallback;
  }
  return table[modelName] || fallback;
}

function tokensToUsd(inputTokens, outputTokens, rates) {
  const inputCost = (inputTokens / 1_000_000) * Number(rates.input || 0);
  const outputCost = (outputTokens / 1_000_000) * Number(rates.output || 0);
  return { inputCost, outputCost, total: inputCost + outputCost };
}

function updateCostWhatIf(data) {
  if (!data) return;
  const authorsEl = document.getElementById("whatIfAuthors");
  const daysEl = document.getElementById("whatIfDays");
  const modelEl = document.getElementById("whatIfModel");
  const resultEl = document.getElementById("costWhatIfResult");
  if (!authorsEl || !daysEl || !modelEl || !resultEl) {
    return;
  }

  const authors = Math.max(0, Number(authorsEl.value) || 0);
  const days = Math.max(1, Number(daysEl.value) || 1);
  const free = readFreeMessages();
  const est = estimateWhatIfConversations(data, authors, days);
  const authorConvs = est.author;
  const anonConvs = est.anonymous;
  const totalConvs = est.total;

  const model = modelEl.value;
  const rates = pricingFromData(data, model);
  const summary = data.summary || {};
  const authorIn = Number(summary.avg_author_input_tokens_per_conv) || 0;
  const authorOut = Number(summary.avg_author_output_tokens_per_conv) || 0;
  const anonIn = Number(summary.avg_anonymous_input_tokens_per_conv) || 0;
  const anonOut = Number(summary.avg_anonymous_output_tokens_per_conv) || 0;
  const perMsg = avgTokensPerMessage(data);
  const avgMsgs = avgMessagesPerConversation(data);

  // Organic usage from historical conversation rates (the natural cap).
  const organicMsgs = Math.max(0, Math.round(totalConvs * avgMsgs));
  const organicIn = authorConvs * authorIn + anonConvs * anonIn;
  const organicOut = authorConvs * authorOut + anonConvs * anonOut;

  let estMsgs = organicMsgs;
  let estIn = organicIn;
  let estOut = organicOut;
  let maxMsgs = organicMsgs;
  let maxIn = organicIn;
  let maxOut = organicOut;
  let maxUnlimited = true;

  if (!free.unlimited) {
    const budget = Math.max(0, Math.round(authors * free.perUser));
    maxUnlimited = false;
    // Maximum = everyone uses the full free allowance.
    maxMsgs = budget;
    maxIn = budget * perMsg.input;
    maxOut = budget * perMsg.output;
    // Estimated = expected usage, capped by the free allowance.
    estMsgs = organicMsgs > 0 ? Math.min(organicMsgs, budget) : budget;
    if (organicMsgs > 0 && budget < organicMsgs) {
      const scale = budget / organicMsgs;
      estIn = organicIn * scale;
      estOut = organicOut * scale;
    } else {
      estIn = organicIn;
      estOut = organicOut;
    }
  }

  const estimated = tokensToUsd(estIn, estOut, rates);
  const maximum = tokensToUsd(maxIn, maxOut, rates);
  const estConvs = avgMsgs > 0 ? Math.round(estMsgs / avgMsgs) : totalConvs;
  const perAuthor = authors > 0 ? estimated.total / authors : 0;
  const perDay = estimated.total / days;
  const perConv = estConvs > 0 ? estimated.total / estConvs : 0;
  const breakdownEl = document.getElementById("costWhatIfBreakdown");

  resultEl.innerHTML = `
    <div class="cost-whatif-price-block">
      <div class="label">Estimated cost</div>
      <div class="value">${formatUsd(estimated.total)}</div>
      <div class="sub">expected usage${
        !free.unlimited && organicMsgs > maxMsgs ? " · capped by free messages" : ""
      }</div>
    </div>
    <div class="cost-whatif-price-block secondary">
      <div class="label">Maximum cost</div>
      <div class="value max">${maxUnlimited ? "—" : formatUsd(maximum.total)}</div>
      <div class="sub">${
        maxUnlimited
          ? "no free-message ceiling"
          : "if every free message is used"
      }</div>
    </div>`;

  if (breakdownEl) {
    breakdownEl.innerHTML = `
      <div class="cost-whatif-break-row">
        <span>Est. messages</span>
        <strong>${estMsgs.toLocaleString()}</strong>
      </div>
      <div class="cost-whatif-break-row">
        <span>Max messages</span>
        <strong>${maxUnlimited ? "unlimited" : maxMsgs.toLocaleString()}</strong>
      </div>
      <div class="cost-whatif-break-row">
        <span>Est. tokens</span>
        <strong>${formatTokens(estIn)} in · ${formatTokens(estOut)} out</strong>
      </div>
      <div class="cost-whatif-break-row">
        <span>Per user</span>
        <strong>${formatUsd(perAuthor)}</strong>
      </div>
      <div class="cost-whatif-break-row">
        <span>Per day</span>
        <strong>${formatUsd(perDay)}</strong>
      </div>
      <div class="cost-whatif-break-row">
        <span>Per conversation</span>
        <strong>${formatUsd(perConv)}</strong>
      </div>
      <div class="cost-whatif-break-row rates">
        <span>Model rates</span>
        <strong>$${Number(rates.input || 0)} / $${Number(rates.output || 0)} per MTok</strong>
      </div>`;
  }
}

function fitWhatIfBlank(el) {
  if (!el) return;
  const style = window.getComputedStyle(el);
  let probe = document.getElementById("whatIfMeasureProbe");
  if (!probe) {
    probe = document.createElement("span");
    probe.id = "whatIfMeasureProbe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
  }
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  probe.style.letterSpacing = style.letterSpacing;
  probe.style.fontVariantNumeric = style.fontVariantNumeric;

  let text = "";
  if (el.tagName === "SELECT") {
    const opt = el.options[el.selectedIndex];
    text = opt ? opt.text : "";
  } else {
    text = el.value || el.placeholder || "";
  }
  if (!text) text = "0";
  probe.textContent = text;
  const measured = Math.ceil(probe.getBoundingClientRect().width);
  const pad = el.tagName === "SELECT" ? 2 : 1;
  el.style.width = `${Math.max(measured + pad, 12)}px`;
}

function fitAllWhatIfBlanks() {
  ["whatIfAuthors", "whatIfDays", "whatIfModel", "whatIfFreeMsgs"].forEach((id) => {
    fitWhatIfBlank(document.getElementById(id));
  });
}

function wireCostWhatIf(data) {
  const root = document.getElementById("costWhatIf");
  if (!root || root.dataset.wired === "1") {
    updateCostWhatIf(data);
    fitAllWhatIfBlanks();
    return;
  }
  root.dataset.wired = "1";
  const sync = () => {
    fitAllWhatIfBlanks();
    updateCostWhatIf(data);
  };
  ["whatIfAuthors", "whatIfDays"].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", sync);
    el?.addEventListener("change", sync);
  });
  document.getElementById("whatIfModel")?.addEventListener("input", sync);
  document.getElementById("whatIfModel")?.addEventListener("change", sync);

  const freeInput = document.getElementById("whatIfFreeMsgs");
  const freeBtn = document.getElementById("whatIfFreeUnlimited");
  freeInput?.addEventListener("input", () => {
    setFreeMessagesMode("number");
    sync();
  });
  freeInput?.addEventListener("focus", () => {
    setFreeMessagesMode("number");
    sync();
  });
  freeInput?.addEventListener("change", sync);
  freeBtn?.addEventListener("click", () => {
    const next = freeBtn.classList.contains("is-active") ? "number" : "unlimited";
    setFreeMessagesMode(next);
    if (next === "number") freeInput?.focus();
    sync();
  });

  setFreeMessagesMode("unlimited");
  fitAllWhatIfBlanks();
  updateCostWhatIf(data);
}


function previewWhatIfCost(data, authorsOverride = null, daysOverride = null) {
  const summary = data.summary || {};
  const authors = Math.max(0, Number(authorsOverride ?? summary.authors) || 0);
  const days = Math.max(0, Number(daysOverride ?? summary.span_days) || 0);
  const est = estimateWhatIfConversations(data, authors, Math.max(days, 1));
  // When days is 0 during animation start, force zero conversations/cost.
  if (days <= 0 || authors <= 0) {
    return { total: 0, authors, days, est: { author: 0, anonymous: 0, total: 0 } };
  }
  const rates = pricingFromData(data, "mixed");
  const authorIn = Number(summary.avg_author_input_tokens_per_conv) || 0;
  const authorOut = Number(summary.avg_author_output_tokens_per_conv) || 0;
  const anonIn = Number(summary.avg_anonymous_input_tokens_per_conv) || 0;
  const anonOut = Number(summary.avg_anonymous_output_tokens_per_conv) || 0;
  const inputTokens = est.author * authorIn + est.anonymous * anonIn;
  const outputTokens = est.author * authorOut + est.anonymous * anonOut;
  const total =
    (inputTokens / 1_000_000) * Number(rates.input || 0) +
    (outputTokens / 1_000_000) * Number(rates.output || 0);
  return { total, authors, days, est };
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function animateWhatIfHero(data) {
  const peopleEl = document.getElementById("whatIfHeroPeople");
  const daysEl = document.getElementById("whatIfHeroDays");
  const moneyEl = document.getElementById("whatIfHeroMoney");
  if (!peopleEl || !daysEl || !moneyEl || !data) return;

  const peopleSteps = [1, 10, 100, 1000, 10000];
  const endDays = 365;
  const stepMs = 1000;
  const duration = stepMs * peopleSteps.length;
  const start = performance.now();

  const tick = (now) => {
    const stage = document.getElementById("costStage");
    if (!stage || stage.dataset.mode !== "split") return;
    if (!document.getElementById("whatIfHeroPeople")) return;

    const elapsed = Math.max(0, now - start);
    const t = Math.min(1, elapsed / duration);
    const stepIndex = Math.min(peopleSteps.length - 1, Math.floor(elapsed / stepMs));
    const people = peopleSteps[stepIndex];
    const days = Math.round(endDays * easeOutCubic(t));
    const live = previewWhatIfCost(data, people, Math.max(days, 1));
    peopleEl.textContent = people.toLocaleString();
    daysEl.textContent = days.toLocaleString();
    moneyEl.textContent = formatUsd(live.total);
    if (t < 1) requestAnimationFrame(tick);
    else {
      peopleEl.textContent = peopleSteps[peopleSteps.length - 1].toLocaleString();
      daysEl.textContent = endDays.toLocaleString();
      moneyEl.textContent = formatUsd(previewWhatIfCost(data, peopleSteps[peopleSteps.length - 1], endDays).total);
    }
  };

  peopleEl.textContent = "1";
  daysEl.textContent = "0";
  moneyEl.textContent = formatUsd(previewWhatIfCost(data, 1, 1).total);
  requestAnimationFrame(tick);
}

function formatDurationDays(days) {
  const n = Math.max(0, Number(days) || 0);
  if (n === 1) return "1 day";
  return `${n.toLocaleString()} days`;
}

function setCostStage(mode) {
  const next = mode === "current" || mode === "whatif" ? mode : "split";
  costStageMode = next;
  const stage = document.getElementById("costStage");
  if (!stage) return;
  stage.dataset.mode = next;
  if (next === "whatif" && costAnalysisData) {
    wireCostWhatIf(costAnalysisData);
  }
  if (next === "current") {
    wireCostDateChartZoom();
  }
  if (next === "split" && costAnalysisData) {
    requestAnimationFrame(() => animateWhatIfHero(costAnalysisData));
  }
}

function wireCostStage() {
  const stage = document.getElementById("costStage");
  if (!stage || stage.dataset.wired) return;
  stage.dataset.wired = "1";
  stage.addEventListener("click", (e) => {
    const expand = e.target.closest("[data-expand]");
    if (expand) {
      e.preventDefault();
      setCostStage(expand.dataset.expand);
      return;
    }
    const back = e.target.closest("[data-back]");
    if (back) {
      e.preventDefault();
      setCostStage("split");
    }
  });
  stage.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const expand = e.target.closest("[data-expand]");
    if (!expand) return;
    e.preventDefault();
    setCostStage(expand.dataset.expand);
  });
}

function renderCostAnalysis(data) {
  if (!costAnalysisBody) return;
  const summary = data.summary || {};
  const bots = data.bots || [];
  const models = data.models || [];

  const modelRows = models
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.model)}</td>
        <td class="num">${m.bots}</td>
        <td class="num">${m.conversations}</td>
        <td class="num">${formatTokens(m.input_tokens)}</td>
        <td class="num">${formatTokens(m.output_tokens)}</td>
        <td class="num cost">${formatUsd(m.cost_usd)}</td>
      </tr>`
    )
    .join("");

  costAnalysisBody.innerHTML = `
    <div class="cost-stage" id="costStage" data-mode="${costStageMode}">
      <div class="cost-split" aria-label="Cost analysis overview">
        <button type="button" class="cost-hero cost-hero-current" data-expand="current">
          <div class="cost-hero-inner">
            <div class="cost-hero-kicker">Current analysis</div>
            <div class="cost-hero-value">${formatUsd(summary.cost_usd)}</div>
            <div class="cost-hero-caption">Estimated total spend</div>
            <div class="cost-hero-meta">
              <span>${escapeHtml(formatDurationDays(summary.span_days))}</span>
              <span>${(summary.authors || 0).toLocaleString()} users</span>
              <span>${(summary.bots || 0).toLocaleString()} bots</span>
              <span>${(summary.conversations || 0).toLocaleString()} conversations</span>
            </div>
            <div class="cost-hero-cta">Click to expand</div>
          </div>
        </button>

        <button type="button" class="cost-hero cost-hero-whatif" data-expand="whatif">
          <div class="cost-hero-inner">
            <div class="cost-hero-title-xl">What-if</div>
            <div class="cost-hero-equation" aria-live="polite">
              <span class="eq-block">
                <span class="eq-num" id="whatIfHeroPeople">1</span>
                <span class="eq-unit">people</span>
              </span>
              <span class="eq-op" aria-hidden="true">×</span>
              <span class="eq-block">
                <span class="eq-num" id="whatIfHeroDays">1</span>
                <span class="eq-unit">days</span>
              </span>
              <span class="eq-op" aria-hidden="true">=</span>
              <span class="eq-block eq-money-block">
                <span class="eq-money" id="whatIfHeroMoney">$0</span>
                <span class="eq-unit">estimated cost</span>
              </span>
            </div>
            <div class="cost-hero-caption">Estimating the cost of teachers authoring teaching chatbots based on current data</div>
            <div class="cost-hero-cta">Click to estimate the cost</div>
          </div>
        </button>
      </div>

      <div class="cost-expanded cost-expanded-current" role="region" aria-label="Current analysis details">
        <div class="cost-expanded-bar">
          <button type="button" class="cost-back" data-back>← Overview</button>
          <div class="cost-expanded-title">Current analysis</div>
        </div>
        <div class="cost-expanded-body">
          <div class="cost-summary">
            <div class="cost-stat">
              <div class="label">Total cost</div>
              <div class="value">${formatUsd(summary.cost_usd)}</div>
            </div>
            <div class="cost-stat">
              <div class="label">Duration</div>
              <div class="value">${formatDurationDays(summary.span_days)}</div>
            </div>
            <div class="cost-stat">
              <div class="label">Users</div>
              <div class="value">${(summary.authors || 0).toLocaleString()}</div>
            </div>
            <div class="cost-stat">
              <div class="label">Bots</div>
              <div class="value">${(summary.bots || 0).toLocaleString()}</div>
            </div>
            <div class="cost-stat">
              <div class="label">Conversations</div>
              <div class="value">${(summary.conversations || 0).toLocaleString()}</div>
            </div>
          </div>

          <p class="cost-note">
            Tokens ≈ characters / 4. Each bot reply billed with system prompt + prior messages as input.
            Rates are approximate public list prices for Playlab model names. Not an invoice.
          </p>

          ${costBarChartsHtml(models, bots, data.by_date || [])}

          <div class="cost-section">
            <h3>By model</h3>
            <div class="cost-table-wrap">
              <table class="cost-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th class="num">Bots</th>
                    <th class="num">Convs</th>
                    <th class="num">Input</th>
                    <th class="num">Output</th>
                    <th class="num">Cost</th>
                  </tr>
                </thead>
                <tbody>${modelRows || `<tr><td colspan="6">No data</td></tr>`}</tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="cost-expanded cost-expanded-whatif" role="region" aria-label="What-if details">
        <div class="cost-expanded-bar">
          <button type="button" class="cost-back" data-back>← Overview</button>
          <div class="cost-expanded-title">What-if</div>
        </div>
        <div class="cost-expanded-body">
          ${costWhatIfHtml(data)}
        </div>
      </div>
    </div>
  `;

  wireCostStage();
  setCostStage(costStageMode);
  if (costStageMode === "split") {
    requestAnimationFrame(() => animateWhatIfHero(data));
  }
}

async function loadCostAnalysis() {
  if (!costAnalysisBody) return;
  costAnalysisBody.innerHTML = `<div class="empty">Computing cost estimates…</div>`;
  const res = await fetch("/api/cost-analysis");
  if (!res.ok) {
    costAnalysisBody.innerHTML = `<div class="empty">Failed to load cost analysis</div>`;
    return;
  }
  costAnalysisData = await res.json();
  renderCostAnalysis(costAnalysisData);
}

(async function init() {
  try {
    await loadCostAnalysis();
  } catch (err) {
    if (costAnalysisBody) {
      costAnalysisBody.innerHTML = `<div class="empty">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }
})();
