let items = [];
let selectedId = null;
let filterData = { conversations: {} };
let needsAttention = false;
let groupByBot = true;
const audienceFilter = { builder: true, anonymous: true, other: true };
let botSort = { key: "total", dir: "desc" };
let lastStackMax = { builder: 1, anonymous: 1, other: 0 };
let searchTimer = null;
let botLabelCodes = [
  "Iterative refinement",
  "Limited evaluation",
  "Opportunistic exploration",
  "No testing",
];
let botLabels = {}; // bot_title -> { code, updated_by, updated_at }
const ALLOWED_LABELERS = new Set(["ruiwei", "jiayi"]);
const LABELER_KEY = "playlab_labeler_name";
const LABELS_LOCAL_KEY = "playlab_bot_labels_cache";
const CODE_SHORT = {
  "Iterative refinement": "IR",
  "Limited evaluation": "LE",
  "Opportunistic exploration": "OE",
  "No testing": "NT",
};

const appSelect = document.getElementById("appSelect");
const userSelect = document.getElementById("userSelect");
const searchInput = document.getElementById("searchInput");
const itemList = document.getElementById("itemList");
const detailPane = document.getElementById("detailPane");
const listCount = document.getElementById("listCount");
const totalCount = document.getElementById("totalCount");
const workspace = document.getElementById("workspace");
const botMapView = document.getElementById("botMapView");
const botMapGrid = document.getElementById("botMapGrid");
const botMapCount = document.getElementById("botMapCount");
const splitHandle = document.getElementById("splitHandle");
const needsAttentionBtn = document.getElementById("needsAttentionBtn");
const groupByBotBtn = document.getElementById("groupByBotBtn");
const botMapLegend = document.querySelector(".bot-map-legend");
const colZoomOut = document.getElementById("colZoomOut");
const colZoomIn = document.getElementById("colZoomIn");
const colZoomRange = document.getElementById("colZoomRange");
const colZoomFit = document.getElementById("colZoomFit");
const colZoomLabel = document.getElementById("colZoomLabel");
const labelerNameInput = document.getElementById("labelerNameInput");
const labelerConfirmBtn = document.getElementById("labelerConfirmBtn");
const labelerStatus = document.getElementById("labelerStatus");
let labelerConfirmed = false;

const DETAIL_WIDTH_KEY = "playlab_detail_width";
const COL_WIDTH_KEY = "playlab_bot_col_width";
let detailWidth = Number(localStorage.getItem(DETAIL_WIDTH_KEY)) || 420;
let botColWidth = Number(localStorage.getItem(COL_WIDTH_KEY)) || 280;
const COL_W_MIN = 12;
const COL_W_MAX = 320;

function initials(name) {
  return (
    (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function normalizeOptions(values) {
  return (values || []).map((v) =>
    typeof v === "string" ? { name: v, count: null } : { name: v.name, count: v.count }
  );
}

function closeAllCountSelects(except) {
  document.querySelectorAll(".count-select.open").forEach((el) => {
    if (el !== except) {
      el.classList.remove("open");
      const menu = el.querySelector(".count-select-menu");
      if (menu) menu.hidden = true;
    }
  });
}

function fillCountSelect(wrapId, values, allCount, onChange) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const menu = wrap.querySelector(".count-select-menu");
  const hidden = wrap.querySelector('input[type="hidden"]');
  const label = wrap.querySelector(".count-select-label");
  const triggerCount = wrap.querySelector(".count-select-count");
  const items = normalizeOptions(values);
  let current = hidden.value || "All";

  const renderTrigger = (name, count) => {
    label.textContent = name;
    triggerCount.textContent = count == null ? "" : String(count);
  };

  const rows = [{ name: "All", count: allCount }, ...items];
  if (current !== "All" && !rows.some((r) => r.name === current)) {
    current = "All";
  }

  menu.innerHTML = rows
    .map(
      ({ name, count }) => `
    <button type="button" class="count-select-option ${name === current ? "active" : ""}" data-value="${escapeHtml(
        name
      )}">
      <span class="opt-name">${escapeHtml(name)}</span>
      <span class="opt-count">${count == null ? "" : escapeHtml(String(count))}</span>
    </button>`
    )
    .join("");

  const selected = rows.find((r) => r.name === current) || rows[0];
  hidden.value = selected.name;
  renderTrigger(selected.name, selected.count);

  menu.querySelectorAll(".count-select-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset.value;
      const row = rows.find((r) => r.name === value) || rows[0];
      hidden.value = row.name;
      renderTrigger(row.name, row.count);
      closeAllCountSelects();
      if (onChange) onChange(row.name);
      else loadList();
    });
  });
}

function wireCountSelect(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap || wrap.dataset.wired) return;
  wrap.dataset.wired = "1";
  const trigger = wrap.querySelector(".count-select-trigger");
  const menu = wrap.querySelector(".count-select-menu");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    closeAllCountSelects();
    if (willOpen) {
      wrap.classList.add("open");
      menu.hidden = false;
    }
  });
}

document.addEventListener("click", () => closeAllCountSelects());

function applyFilterOptions() {
  const c = filterData.conversations || {};
  fillCountSelect("appSelectWrap", c.apps || [], c.apps_total ?? c.total ?? 0, onFilterChanged);
  fillCountSelect("userSelectWrap", c.users || [], c.users_total ?? c.total ?? 0, onFilterChanged);
  totalCount.textContent = `${c.total || 0} conversations · ${c.message_rows || 0} messages`;
}

function filterQueryParams() {
  const params = new URLSearchParams();
  if (userSelect.value && userSelect.value !== "All") params.set("user", userSelect.value);
  if (appSelect.value && appSelect.value !== "All") params.set("app", appSelect.value);
  if (needsAttention) params.set("needs_attention", "true");
  return params;
}

async function refreshCascadingFilters() {
  const res = await fetch(`/api/filters?${filterQueryParams().toString()}`);
  const data = await res.json();
  filterData.conversations = data.conversations || filterData.conversations;
  applyFilterOptions();
}

async function onFilterChanged() {
  await refreshCascadingFilters();
  await loadList();
}

async function loadFilters() {
  const res = await fetch(`/api/filters?${filterQueryParams().toString()}`);
  filterData = await res.json();
  applyFilterOptions();
}

function queryParams() {
  const params = new URLSearchParams();
  if (appSelect.value && appSelect.value !== "All") params.set("app", appSelect.value);
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
  if (needsAttention) params.set("needs_attention", "true");
  if (userSelect.value && userSelect.value !== "All") params.set("user", userSelect.value);
  return params;
}

async function loadList() {
  itemList.innerHTML = `<div class="empty">Loading…</div>`;
  const res = await fetch(`/api/conversations?${queryParams().toString()}`);
  const data = await res.json();

  items = data.conversations || [];
  listCount.textContent = `${data.count} conversation${data.count === 1 ? "" : "s"}`;

  if (!items.length) {
    itemList.innerHTML = `<div class="empty">No items match these filters</div>`;
    selectedId = null;
    renderEmptyDetail();
    return;
  }

  if (!selectedId || !items.find((a) => a.id === selectedId)) {
    selectedId = items[0].id;
  }

  renderList();
  await loadDetail(selectedId);
}

function conversationItemHtml(c) {
  return `
    <button class="activity-item ${c.id === selectedId ? "selected" : ""}" data-id="${c.id}" type="button">
      <div class="item-top">
        <div class="item-title">${escapeHtml(groupByBot ? c.user : c.title)}</div>
        <div class="item-date">${escapeHtml(c.date)}</div>
      </div>
      <div class="item-bottom">
        <div class="item-user">
          <div class="avatar">${escapeHtml(initials(c.user))}</div>
          <div class="user-name">${escapeHtml(groupByBot ? c.title : c.user)}</div>
        </div>
        <div class="item-meta">
          ${c.is_builder ? `<span class="tag">Builder</span>` : ""}
          ${c.has_flagged ? `<span class="tag" style="background:#fef2f2;color:#b91c1c">Flagged</span>` : ""}
          <span class="msg-count" title="Messages">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
            </svg>
            ${c.message_count}
          </span>
        </div>
      </div>
    </button>`;
}

function botCardHtml(c) {
  const tip = `${c.user} · ${c.date} · ${c.message_count} msgs`;
  return `
    <button class="bot-card ${c.id === selectedId ? "selected" : ""}" data-id="${c.id}" type="button" title="${escapeHtml(tip)}">
      <div class="bot-card-top">
        <div class="bot-card-user">${escapeHtml(c.user)}</div>
        <div class="bot-card-date">${escapeHtml(c.date)}</div>
      </div>
      <div class="bot-card-meta">
        <span>${c.message_count} msg${c.message_count === 1 ? "" : "s"}</span>
        <span>${c.is_builder ? "Builder" : c.has_flagged ? "Flagged" : ""}</span>
      </div>
    </button>`;
}

function botSectionHtml(label, className, sectionItems, { allowEmpty = false } = {}) {
  if (!sectionItems.length && !allowEmpty) return "";
  const empty = !sectionItems.length;
  const cards = empty ? "" : sectionItems.map(botCardHtml).join("");
  const body =
    className === "bot-section-builder"
      ? `<div class="bot-section-stack">${cards}</div>`
      : cards;
  return `
    <div class="bot-section ${className}${empty ? " is-empty" : ""}" title="${escapeHtml(label)} · ${sectionItems.length}">
      <div class="bot-section-label">${escapeHtml(label)} · ${sectionItems.length}</div>
      ${body}
    </div>`;
}

function labelerName() {
  return (labelerNameInput?.value || "").trim();
}

function canEditBotLabels() {
  return labelerConfirmed && ALLOWED_LABELERS.has(labelerName().toLowerCase());
}

function syncLabelerStatus() {
  if (!labelerStatus) return;
  const name = labelerName();
  labelerStatus.classList.remove("can-edit", "blocked");
  botMapView?.classList.toggle("can-label", canEditBotLabels());
  if (!name) {
    labelerStatus.textContent = "Enter name + Confirm";
    return;
  }
  if (!labelerConfirmed) {
    labelerStatus.textContent = "Press Confirm";
    return;
  }
  if (ALLOWED_LABELERS.has(name.toLowerCase())) {
    labelerStatus.textContent = `Editing as ${name.toLowerCase()}`;
    labelerStatus.classList.add("can-edit");
  } else {
    labelerStatus.textContent = "View only (ruiwei/jiayi)";
    labelerStatus.classList.add("blocked");
  }
}

function confirmLabeler() {
  const name = labelerName();
  localStorage.setItem(LABELER_KEY, name);
  labelerConfirmed = !!name;
  localStorage.setItem(`${LABELER_KEY}_confirmed`, labelerConfirmed ? "1" : "0");
  syncLabelerStatus();
  if (groupByBot) renderBotMap();
}

function wireLabelerBox() {
  if (!labelerNameInput || labelerNameInput.dataset.wired) return;
  labelerNameInput.dataset.wired = "1";
  labelerNameInput.value = localStorage.getItem(LABELER_KEY) || "";
  labelerConfirmed = localStorage.getItem(`${LABELER_KEY}_confirmed`) === "1" && !!labelerName();
  syncLabelerStatus();

  labelerNameInput.addEventListener("input", () => {
    // Changing the name requires Confirm again
    labelerConfirmed = false;
    localStorage.setItem(LABELER_KEY, labelerNameInput.value);
    localStorage.setItem(`${LABELER_KEY}_confirmed`, "0");
    syncLabelerStatus();
    if (groupByBot) renderBotMap();
  });

  labelerNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmLabeler();
    }
  });

  labelerConfirmBtn?.addEventListener("click", () => confirmLabeler());
}

function codeSlug(code) {
  return (code || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function botLabelCode(botTitle) {
  return (botLabels[botTitle] && botLabels[botTitle].code) || "";
}

function botLevelLabelHtml(botTitle) {
  const code = botLabelCode(botTitle);
  const editable = canEditBotLabels();
  const short = CODE_SHORT[code] || "—";
  const options = [`<option value="">Select code…</option>`]
    .concat(
      botLabelCodes.map((c) => {
        const selected = c === code;
        const label = selected ? `✓ ${c}` : c;
        return `<option value="${escapeHtml(c)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
    )
    .join("");

  return `
    <div class="bot-level-label" data-bot="${escapeHtml(botTitle)}">
      <select
        class="bot-level-label-select ${code ? "has-code" : ""}"
        data-bot="${escapeHtml(botTitle)}"
        ${editable ? "" : "disabled"}
        title="${escapeHtml(code ? `Labeled: ${code}` : "Bot-level labeling")}"
      >${options}</select>
      <span
        class="bot-level-label-badge ${code ? "" : "empty"}"
        title="${escapeHtml(code ? `Labeled: ${code}` : "Unlabeled")}"
      >${escapeHtml(code ? `✓ ${short}` : "—")}</span>
    </div>`;
}

async function loadBotLabels() {
  const res = await fetch("/api/bot-labels");
  if (!res.ok) throw new Error("Failed to load bot labels");
  const data = await res.json();
  if (Array.isArray(data.codes) && data.codes.length) botLabelCodes = data.codes;
  botLabels = data.labels || {};

  try {
    const local = JSON.parse(localStorage.getItem(LABELS_LOCAL_KEY) || "{}");
    Object.entries(local).forEach(([bot, row]) => {
      if (!row || typeof row !== "object") return;
      const server = botLabels[bot];
      if (!server || (row.updated_at || "") > (server.updated_at || "")) {
        botLabels[bot] = row;
      }
    });
  } catch {
    /* ignore bad local cache */
  }
  localStorage.setItem(LABELS_LOCAL_KEY, JSON.stringify(botLabels));
}

async function saveBotLabel(botTitle, code) {
  if (!canEditBotLabels()) {
    alert("Only ruiwei or jiayi can edit bot-level codes. Enter your name at the top right.");
    syncLabelerStatus();
    if (groupByBot) renderBotMap();
    return;
  }
  const res = await fetch(`/api/bot-labels/${encodeURIComponent(botTitle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, editor: labelerName() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.detail || "Failed to save label");
    await loadBotLabels();
    if (groupByBot) renderBotMap();
    return;
  }
  const row = await res.json();
  if (row.code) botLabels[botTitle] = row;
  else delete botLabels[botTitle];
  localStorage.setItem(LABELS_LOCAL_KEY, JSON.stringify(botLabels));
  if (groupByBot) renderBotMap();
}

function wireBotLabelControls() {
  botMapGrid.querySelectorAll(".bot-level-label-select").forEach((el) => {
    el.addEventListener("change", () => {
      saveBotLabel(el.dataset.bot, el.value);
    });
    el.addEventListener("click", (e) => e.stopPropagation());
  });
}

function conversationAudience(c) {
  if (c.is_builder) return "builder";
  if (c.is_anonymous || c.user === "Anonymous" || c.user_raw === "Anonymous") return "anonymous";
  return "other";
}

function audienceCount(groupItems, key) {
  if (key === "builder") return groupItems.filter((c) => c.is_builder).length;
  if (key === "anonymous") {
    return groupItems.filter(
      (c) => !c.is_builder && (c.is_anonymous || c.user === "Anonymous" || c.user_raw === "Anonymous")
    ).length;
  }
  if (key === "other") {
    return groupItems.filter(
      (c) => !c.is_builder && !(c.is_anonymous || c.user === "Anonymous" || c.user_raw === "Anonymous")
    ).length;
  }
  return groupItems.length;
}

function syncAudienceLegend() {
  if (!botMapLegend) return;
  botMapLegend.querySelectorAll("[data-audience]").forEach((btn) => {
    const key = btn.dataset.audience;
    btn.classList.toggle("active", !!audienceFilter[key]);
    btn.classList.toggle("sorting", botSort.key === key);
    btn.setAttribute("aria-pressed", audienceFilter[key] ? "true" : "false");
    const sortEl = btn.querySelector(".legend-sort");
    if (sortEl) {
      if (botSort.key === key) {
        sortEl.textContent = botSort.dir === "desc" ? "↓" : "↑";
        sortEl.setAttribute("aria-label", `Sorted by ${key} ${botSort.dir}`);
      } else {
        sortEl.textContent = "↕";
        sortEl.setAttribute("aria-label", `Sort by ${key}`);
      }
    }
  });
}

function setBotSort(key) {
  if (botSort.key === key) {
    botSort.dir = botSort.dir === "desc" ? "asc" : "desc";
  } else {
    botSort.key = key;
    botSort.dir = "desc";
  }
  renderBotMap();
}

function renderBotMap() {
  const visibleItems = items.filter((c) => audienceFilter[conversationAudience(c)]);
  const groups = new Map();
  visibleItems.forEach((c) => {
    const key = c.title || "Untitled";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });

  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ca = audienceCount(groups.get(a), botSort.key);
    const cb = audienceCount(groups.get(b), botSort.key);
    const diff = botSort.dir === "desc" ? cb - ca : ca - cb;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  botMapCount.textContent = `${sortedKeys.length} bot${sortedKeys.length === 1 ? "" : "s"} · ${visibleItems.length} conversations`;
  syncAudienceLegend();

  if (!sortedKeys.length) {
    botMapGrid.innerHTML = `<div class="empty">No conversations for the selected audience filters.</div>`;
    botMapView.classList.remove("fit-height");
    return;
  }

  const useMidline = audienceFilter.builder && audienceFilter.anonymous;
  let maxBuilder = 0;
  let maxAnonymous = 0;
  let maxOther = 0;

  botMapGrid.innerHTML = sortedKeys
    .map((key) => {
      const groupItems = groups.get(key);
      const builders = groupItems.filter((c) => c.is_builder);
      const anonymous = groupItems.filter(
        (c) => !c.is_builder && (c.is_anonymous || c.user === "Anonymous" || c.user_raw === "Anonymous")
      );
      const others = groupItems.filter(
        (c) => !c.is_builder && !(c.is_anonymous || c.user === "Anonymous" || c.user_raw === "Anonymous")
      );
      maxBuilder = Math.max(maxBuilder, builders.length);
      maxAnonymous = Math.max(maxAnonymous, anonymous.length);
      maxOther = Math.max(maxOther, others.length);

      const builderHtml = audienceFilter.builder
        ? botSectionHtml("Builder tests", "bot-section-builder", builders, { allowEmpty: useMidline })
        : "";
      const anonHtml = audienceFilter.anonymous
        ? botSectionHtml("Anonymous", "bot-section-anonymous", anonymous, { allowEmpty: useMidline })
        : "";
      const otherHtml = audienceFilter.other
        ? botSectionHtml("Other users", "bot-section-other", others)
        : "";

      const bodyHtml = useMidline
        ? `${builderHtml}<div class="bot-half-bottom">${anonHtml}${otherHtml}</div>`
        : `${builderHtml}${anonHtml}${otherHtml}`;

      return `
        <div class="bot-column" title="${escapeHtml(`${key} · ${groupItems.length} conversations`)}">
          <div class="bot-column-header">
            <div class="bot-column-title">${escapeHtml(key)}</div>
            ${botLevelLabelHtml(key)}
            <div class="bot-column-stats">
              <span>${groupItems.length} total</span>
              ${audienceFilter.builder ? `<span>${builders.length} builder</span>` : ""}
              ${audienceFilter.anonymous ? `<span>${anonymous.length} anon</span>` : ""}
              ${audienceFilter.other ? `<span>${others.length} other</span>` : ""}
            </div>
          </div>
          <div class="bot-column-body${useMidline ? " midline" : ""}">
            ${bodyHtml}
          </div>
        </div>`;
    })
    .join("");

  lastStackMax = { builder: maxBuilder, anonymous: maxAnonymous, other: maxOther };
  applyBotMapFitHeight();

  botMapGrid.querySelectorAll(".bot-card").forEach((el) => {
    el.addEventListener("click", () => {
      selectedId = el.dataset.id;
      renderList();
      loadDetail(selectedId);
    });
  });
  wireBotLabelControls();
}

function stackUnitPx(density) {
  if (density === "overview") return 9; // 8px card + 1px gap
  if (density === "narrow") return 26;
  if (density === "compact") return 42;
  return 52;
}

function applyBotMapFitHeight() {
  if (!botMapView || botMapView.hidden || !groupByBot) {
    botMapView?.classList.remove("fit-height");
    return;
  }

  const density = densityForWidth(botColWidth);
  const unit = stackUnitPx(density);
  const pad = density === "overview" ? 4 : 16;

  const heightFor = (count, enabled) => {
    if (!enabled) return 0;
    const n = Math.max(count, 0);
    // Keep a slim lane when the filter is on but every column is empty for this type
    if (n === 0) return Math.ceil(unit * 1.1);
    return Math.ceil(n * unit * 1.1 + pad);
  };

  const hb = heightFor(lastStackMax.builder, audienceFilter.builder);
  const ha = heightFor(lastStackMax.anonymous, audienceFilter.anonymous);
  const ho = heightFor(lastStackMax.other, audienceFilter.other);
  const sectionGap = density === "overview" ? 2 : 8;
  const gaps =
    (hb && (ha || ho) ? sectionGap : 0) + (ha && ho ? sectionGap : 0);

  botMapView.style.setProperty("--bot-h-builder", `${hb}px`);
  botMapView.style.setProperty("--bot-h-anonymous", `${ha}px`);
  botMapView.style.setProperty("--bot-h-other", `${ho}px`);
  botMapView.style.setProperty("--bot-body-h", `${hb + ha + ho + gaps}px`);
  botMapView.classList.add("fit-height");
}

function densityForWidth(w) {
  if (w < 64) return "overview";
  if (w < 120) return "narrow";
  if (w < 200) return "compact";
  return "comfortable";
}

function applyBotColWidth(persist = true) {
  botColWidth = Math.min(COL_W_MAX, Math.max(COL_W_MIN, Math.round(botColWidth)));
  const gap = botColWidth < 24 ? 1 : botColWidth < 64 ? 3 : botColWidth < 120 ? 6 : 12;
  botMapView.style.setProperty("--bot-col-w", `${botColWidth}px`);
  botMapView.style.setProperty("--bot-col-gap", `${gap}px`);
  botMapView.dataset.density = densityForWidth(botColWidth);
  if (colZoomRange) colZoomRange.value = String(botColWidth);
  if (colZoomLabel) colZoomLabel.textContent = `${botColWidth}px`;
  if (persist) localStorage.setItem(COL_WIDTH_KEY, String(botColWidth));
  applyBotMapFitHeight();
}

function fitAllColumns() {
  const cols = botMapGrid.querySelectorAll(".bot-column").length;
  if (!cols) return;
  const pad = 28;
  const available = Math.max(200, botMapGrid.clientWidth - pad);
  // Leave a tiny gap; solve w * n + gap*(n-1) ~= available
  const gap = 3;
  const width = Math.floor((available - gap * (cols - 1)) / cols);
  botColWidth = Math.min(COL_W_MAX, Math.max(COL_W_MIN, width));
  applyBotColWidth();
}

function wireColumnZoom() {
  if (!botMapView || botMapView.dataset.zoomWired) return;
  botMapView.dataset.zoomWired = "1";

  applyBotColWidth(false);

  colZoomOut?.addEventListener("click", () => {
    botColWidth -= botColWidth <= 80 ? 2 : 16;
    applyBotColWidth();
  });
  colZoomIn?.addEventListener("click", () => {
    botColWidth += botColWidth < 80 ? 2 : 16;
    applyBotColWidth();
  });
  colZoomRange?.addEventListener("input", () => {
    botColWidth = Number(colZoomRange.value);
    applyBotColWidth();
  });
  colZoomFit?.addEventListener("click", () => fitAllColumns());

  // Ctrl/⌘ + scroll, or trackpad pinch (browsers report as ctrl+wheel)
  botMapGrid.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const step = botColWidth <= 80 ? 2 : 12;
      botColWidth += e.deltaY < 0 ? step : -step;
      applyBotColWidth();
    },
    { passive: false }
  );
}

function applyDetailWidth() {
  const minDetail = 280;
  const maxDetail = Math.max(minDetail, window.innerWidth - 320);
  detailWidth = Math.min(maxDetail, Math.max(minDetail, detailWidth));
  workspace.style.setProperty("--detail-w", `${detailWidth}px`);
}

function updateLayoutMode() {
  const mapOn = groupByBot;
  workspace.classList.toggle("bot-map-mode", mapOn);
  botMapView.hidden = !mapOn;
  splitHandle.hidden = !mapOn;
  if (mapOn) {
    applyDetailWidth();
    applyBotColWidth(false);
  }
}

function wireSplitHandle() {
  if (!splitHandle || splitHandle.dataset.wired) return;
  splitHandle.dataset.wired = "1";

  let startX = 0;
  let startWidth = 0;

  const onMove = (e) => {
    const dx = startX - e.clientX;
    detailWidth = startWidth + dx;
    applyDetailWidth();
  };

  const onUp = () => {
    workspace.classList.remove("resizing");
    localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth));
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  splitHandle.addEventListener("mousedown", (e) => {
    if (botMapView.hidden) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = detailWidth;
    workspace.classList.add("resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  window.addEventListener("resize", () => {
    if (!botMapView.hidden) applyDetailWidth();
  });
}

function renderList() {
  updateLayoutMode();

  if (groupByBot) {
    renderBotMap();
    return;
  }

  itemList.innerHTML = items.map(conversationItemHtml).join("");

  itemList.querySelectorAll(".activity-item").forEach((el) => {
    el.addEventListener("click", () => {
      selectedId = el.dataset.id;
      renderList();
      loadDetail(selectedId);
    });
  });
}

function renderEmptyDetail() {
  detailPane.innerHTML = `
    <div class="empty-detail">
      <h2>Select an item</h2>
      <p>Filter by teacher or app, then pick from the list.</p>
    </div>`;
}

function renderChips(itemsArr, muted = false) {
  if (!itemsArr || !itemsArr.length) return `<span class="chip muted">None</span>`;
  return itemsArr.map((t) => `<span class="chip ${muted ? "muted" : ""}">${escapeHtml(t)}</span>`).join("");
}

function appConfigHtml(cfg) {
  if (!cfg) {
    return `<p class="prompt-config-missing">No matching app config found for this bot.</p>`;
  }

  const files = (cfg.reference_files || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  return `
    <div class="prompt-config">
      <div class="prompt-config-head">
        <div class="prompt-config-title">App config${cfg.creator ? ` · ${escapeHtml(cfg.creator)}` : ""}</div>
        ${
          cfg.build_url
            ? `<a class="linkish" href="${escapeHtml(cfg.build_url)}" target="_blank" rel="noopener">Open build</a>`
            : ""
        }
      </div>
      <div class="meta-grid meta-grid-compact">
        <div class="meta-card"><div class="label">Model</div><div class="value">${escapeHtml(cfg.model || "—")}</div></div>
        <div class="meta-card"><div class="label">Variability</div><div class="value">${escapeHtml(cfg.variability || "—")}</div></div>
        <div class="meta-card"><div class="label">Style</div><div class="value">${escapeHtml(cfg.interaction_style || "—")}</div></div>
        <div class="meta-card"><div class="label">Reference files</div><div class="value">${cfg.reference_file_count ?? 0}</div></div>
      </div>
      ${cfg.description ? `<div class="prompt-config-block"><div class="label">Description</div><p>${escapeHtml(cfg.description)}</p></div>` : ""}
      ${cfg.welcome_message ? `<div class="prompt-config-block"><div class="label">Welcome message</div><p>${escapeHtml(cfg.welcome_message)}</p></div>` : ""}
      <div class="prompt-config-block">
        <div class="label">Enabled tools</div>
        <div class="chip-row">${renderChips(cfg.enabled_tools)}</div>
      </div>
      <div class="prompt-config-block">
        <div class="label">Enabled settings</div>
        <div class="chip-row">${renderChips(cfg.enabled_settings, true)}</div>
      </div>
      ${
        files.length
          ? `<div class="prompt-config-block"><div class="label">Reference files</div><div class="file-list">${files
              .map((f) => `<span>${escapeHtml(f)}</span>`)
              .join("")}</div></div>`
          : ""
      }
    </div>`;
}

async function loadDetail(id) {
  if (!id) {
    renderEmptyDetail();
    return;
  }

  detailPane.innerHTML = `<div class="empty">Loading detail…</div>`;
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  if (!res.ok) {
    detailPane.innerHTML = `<div class="empty">Failed to load detail</div>`;
    return;
  }
  renderConversationDetail(await res.json());
}

function renderConversationDetail(c) {
  const messagesHtml = (c.messages || [])
    .map(
      (m) => `
      <div class="bubble ${escapeHtml(m.role)} ${m.flagged ? "flagged" : ""}">
        <div class="bubble-meta">
          <span class="bubble-role">${escapeHtml(m.role || "unknown")} · #${m.message_number}</span>
          <span>${escapeHtml(m.datetime || "")}${m.time_since ? ` · ${escapeHtml(m.time_since)}` : ""}</span>
        </div>
        <div class="bubble-body">${escapeHtml(m.content || "")}</div>
      </div>`
    )
    .join("");

  detailPane.innerHTML = `
    <div class="detail-header">
      <div>
        <h1 class="detail-title">${escapeHtml(c.title)}</h1>
        <div class="detail-sub">${escapeHtml(c.user)} · ${escapeHtml(c.date)} · ${c.message_count} messages${
          c.is_builder ? " · Builder" : ""
        }</div>
      </div>
      <div class="detail-actions">
        ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">Open in Playlab</a>` : ""}
        <button type="button" id="copyPromptBtn">Copy prompt</button>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-card"><div class="label">Conversation ID</div><div class="value">${escapeHtml(c.conv_id)}</div></div>
      <div class="meta-card"><div class="label">Turns</div><div class="value">${c.turns}</div></div>
      <div class="meta-card"><div class="label">Flagged</div><div class="value">${c.flagged_count}</div></div>
      <div class="meta-card"><div class="label">Builder</div><div class="value">${c.is_builder ? "Yes" : "No"}</div></div>
    </div>

    <div class="section system-prompt-section">
      <h3>System prompt</h3>
      ${appConfigHtml(c.app_config)}
      <pre class="prompt-body prompt-collapsed" id="promptBody">${escapeHtml(c.system_prompt || "(empty)")}</pre>
      <button type="button" class="linkish" id="expandPromptBtn">Show full prompt</button>
    </div>

    <div class="section">
      <h3>Messages</h3>
      <div class="thread">${messagesHtml || "<p>No messages</p>"}</div>
    </div>
  `;

  wirePromptActions(c.system_prompt || "");
}

function wirePromptActions(promptText) {
  const copyBtn = document.getElementById("copyPromptBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(promptText);
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy prompt"), 1200);
      } catch {
        copyBtn.textContent = "Copy failed";
      }
    });
  }

  const expandBtn = document.getElementById("expandPromptBtn");
  const promptBody = document.getElementById("promptBody");
  if (expandBtn && promptBody) {
    expandBtn.addEventListener("click", () => {
      const collapsed = promptBody.classList.toggle("prompt-collapsed");
      expandBtn.textContent = collapsed ? "Show full prompt" : "Collapse prompt";
    });
  }
}

function setNeedsAttention(on) {
  needsAttention = on;
  needsAttentionBtn.classList.toggle("danger-active", on);
  onFilterChanged();
}

function setGroupByBot(on) {
  groupByBot = on;
  groupByBotBtn.classList.toggle("active", on);
  renderList();
}

function toggleAudienceFilter(key) {
  if (!(key in audienceFilter)) return;
  const activeCount = Object.values(audienceFilter).filter(Boolean).length;
  // Keep at least one audience visible
  if (audienceFilter[key] && activeCount === 1) return;
  audienceFilter[key] = !audienceFilter[key];
  syncAudienceLegend();
  renderBotMap();
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 250);
});
needsAttentionBtn.addEventListener("click", () => setNeedsAttention(!needsAttention));
groupByBotBtn.addEventListener("click", () => setGroupByBot(!groupByBot));
if (botMapLegend) {
  botMapLegend.addEventListener("click", (e) => {
    const sortEl = e.target.closest("[data-sort]");
    if (sortEl) {
      e.preventDefault();
      e.stopPropagation();
      setBotSort(sortEl.dataset.sort);
      return;
    }
    const btn = e.target.closest("[data-audience]");
    if (!btn) return;
    toggleAudienceFilter(btn.dataset.audience);
  });
}

(async function init() {
  try {
    wireCountSelect("appSelectWrap");
    wireCountSelect("userSelectWrap");
    wireSplitHandle();
    wireColumnZoom();
    wireLabelerBox();
    applyDetailWidth();
    groupByBotBtn.classList.toggle("active", groupByBot);
    await loadBotLabels();
    await loadFilters();
    await loadList();
  } catch (err) {
    itemList.innerHTML = `<div class="empty">Failed to load data: ${escapeHtml(err.message)}</div>`;
  }
})();
