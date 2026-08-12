let items = [];
let selectedId = null;
let filterData = { conversations: {} };
let needsAttention = false;
let groupByBot = true;
let groupByUser = true;
let sortByTime = false;
let costAnalysisOn = false;
let costAnalysisData = null;
const audienceFilter = { builder: true, anonymous: true, other: true };
let botSort = { key: "total", dir: "desc" };
let lastStackMax = { builder: 1, anonymous: 1, other: 0, total: 1 };
let searchTimer = null;
let botLabelCodes = [
  "Iterative refinement",
  "Limited evaluation",
  "Opportunistic exploration",
  "No testing",
];
let botLabels = {}; // bot_title -> { code, updated_by, updated_at }
let messageLabels = {}; // `${convId}:${msgNum}` -> { codes, role, ... }
const BOT_MSG_CODES = ["success", "fail", "others"];
const USER_MSG_CODES = ["desired", "adversarial", "others"];
const ALLOWED_LABELERS = new Set(["ruiwei", "jiayi"]);
const LABELER_KEY = "playlab_labeler_name";
const LABELS_LOCAL_KEY = "playlab_bot_labels_cache";
const MSG_LABELS_LOCAL_KEY = "playlab_message_labels_cache";
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
const groupByUserBtn = document.getElementById("groupByUserBtn");
const sortByTimeBtn = document.getElementById("sortByTimeBtn");
const costAnalysisBtn = document.getElementById("costAnalysisBtn");
const costAnalysisView = document.getElementById("costAnalysisView");
const costAnalysisBody = document.getElementById("costAnalysisBody");
const costAnalysisSub = document.getElementById("costAnalysisSub");
const costAnalysisCloseBtn = document.getElementById("costAnalysisCloseBtn");
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
const FILTERS_PANEL_W_KEY = "playlab_filters_panel_w";
const COL_WIDTH_KEY = "playlab_bot_col_width";
let detailWidth = Number(localStorage.getItem(DETAIL_WIDTH_KEY)) || 420;
let filtersPanelWidthPct = Number(localStorage.getItem(FILTERS_PANEL_W_KEY)) || 58;
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
  if (costAnalysisOn) {
    updateLayoutMode();
    await loadCostAnalysis();
    return;
  }
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
  if (costAnalysisOn) {
    updateLayoutMode();
    await loadCostAnalysis();
    return;
  }
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

function conversationSortKey(c) {
  return `${c.date_sort || c.date || ""}\0${c.id || ""}`;
}

function sortConversationsByTime(list, dir = "desc") {
  const mult = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => mult * conversationSortKey(a).localeCompare(conversationSortKey(b)));
}

function botCardHtml(c) {
  const audience = conversationAudience(c);
  const tip = `${c.user} · ${c.date} · ${c.message_count} msgs`;
  return `
    <button class="bot-card aud-${audience} ${c.id === selectedId ? "selected" : ""}" data-id="${c.id}" type="button" title="${escapeHtml(tip)}">
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
  if (selectedId) loadDetail(selectedId);
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
    detailPane.querySelectorAll(".msg-label-panel").forEach((panel) => {
      setMessageLabelPanelEditable(panel, false);
    });
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
  botMapLegend.hidden = !!sortByTime;
  botMapLegend.querySelectorAll("[data-audience]").forEach((btn) => {
    const key = btn.dataset.audience;
    btn.classList.toggle("active", !!audienceFilter[key]);
    btn.classList.toggle("sorting", !sortByTime && botSort.key === key);
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
  if (sortByTime) return;
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
  botMapView.classList.toggle("chrono-mode", !!sortByTime);

  if (!sortedKeys.length) {
    botMapGrid.innerHTML = `<div class="empty">No conversations for the selected audience filters.</div>`;
    botMapView.classList.remove("fit-height");
    return;
  }

  const useMidline = !sortByTime && groupByUser && audienceFilter.builder && audienceFilter.anonymous;
  let maxBuilder = 0;
  let maxAnonymous = 0;
  let maxOther = 0;
  let maxTotal = 0;

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
      maxTotal = Math.max(maxTotal, groupItems.length);

      let bodyHtml = "";
      if (sortByTime) {
        const chronoItems = sortConversationsByTime(groupItems, "asc");
        bodyHtml = `<div class="bot-section bot-section-chrono">${chronoItems.map(botCardHtml).join("")}</div>`;
      } else {
        const builderHtml = audienceFilter.builder
          ? botSectionHtml("Builder tests", "bot-section-builder", builders, { allowEmpty: useMidline })
          : "";
        const anonHtml = audienceFilter.anonymous
          ? botSectionHtml("Anonymous", "bot-section-anonymous", anonymous, { allowEmpty: useMidline })
          : "";
        const otherHtml = audienceFilter.other
          ? botSectionHtml("Other users", "bot-section-other", others)
          : "";
        bodyHtml = useMidline
          ? `${builderHtml}<div class="bot-half-bottom">${anonHtml}${otherHtml}</div>`
          : `${builderHtml}${anonHtml}${otherHtml}`;
      }

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
          <div class="bot-column-body${useMidline ? " midline" : ""}${sortByTime ? " chrono" : ""}">
            ${bodyHtml}
          </div>
        </div>`;
    })
    .join("");

  lastStackMax = { builder: maxBuilder, anonymous: maxAnonymous, other: maxOther, total: maxTotal };
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

  if (sortByTime) {
    const ht = heightFor(lastStackMax.total || 0, true);
    botMapView.style.setProperty("--bot-h-builder", `0px`);
    botMapView.style.setProperty("--bot-h-anonymous", `0px`);
    botMapView.style.setProperty("--bot-h-other", `0px`);
    botMapView.style.setProperty("--bot-body-h", `${ht}px`);
    botMapView.classList.add("fit-height");
    return;
  }

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
  const costOn = costAnalysisOn;
  const mapOn = groupByBot && !costOn;
  workspace.classList.toggle("cost-mode", costOn);
  workspace.classList.toggle("bot-map-mode", mapOn);
  if (costAnalysisView) costAnalysisView.hidden = !costOn;
  if (botMapView) botMapView.hidden = !mapOn;
  if (splitHandle) splitHandle.hidden = !mapOn;
  if (detailPane) detailPane.hidden = !!costOn;
  if (document.getElementById("sidebar")) {
    document.getElementById("sidebar").hidden = !!costOn || mapOn;
  }
  if (mapOn) {
    applyDetailWidth();
    applyBotColWidth(false);
  }
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

function renderCostAnalysis(data) {
  if (!costAnalysisBody) return;
  const summary = data.summary || {};
  const bots = data.bots || [];
  const models = data.models || [];

  if (costAnalysisSub) {
    costAnalysisSub.textContent = `${summary.bots || 0} bots · ${summary.conversations || 0} conversations · est. ${formatUsd(
      summary.cost_usd
    )} · respects current filters`;
  }

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

  const botRows = bots
    .map(
      (b) => `
      <tr>
        <td class="bot-name">${escapeHtml(b.bot)}</td>
        <td>${escapeHtml(b.model)}${b.model_matched ? "" : ' <span class="cost-warn">est.</span>'}</td>
        <td class="num">${b.conversations}</td>
        <td class="num">${b.messages}</td>
        <td class="num">${formatTokens(b.input_tokens)}</td>
        <td class="num">${formatTokens(b.output_tokens)}</td>
        <td class="num">${formatUsd(b.input_cost_usd)}</td>
        <td class="num">${formatUsd(b.output_cost_usd)}</td>
        <td class="num cost">${formatUsd(b.cost_usd)}</td>
      </tr>`
    )
    .join("");

  costAnalysisBody.innerHTML = `
    <div class="cost-summary">
      <div class="cost-stat">
        <div class="label">Estimated total</div>
        <div class="value">${formatUsd(summary.cost_usd)}</div>
      </div>
      <div class="cost-stat">
        <div class="label">Input tokens</div>
        <div class="value">${formatTokens(summary.input_tokens)}</div>
      </div>
      <div class="cost-stat">
        <div class="label">Output tokens</div>
        <div class="value">${formatTokens(summary.output_tokens)}</div>
      </div>
      <div class="cost-stat">
        <div class="label">Unknown model convs</div>
        <div class="value">${summary.unknown_model_conversations || 0}</div>
      </div>
    </div>

    <p class="cost-note">
      Tokens ≈ characters / 4. Each bot reply billed with system prompt + prior messages as input.
      Rates are approximate public list prices for Playlab model names. Not an invoice.
    </p>

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

    <div class="cost-section">
      <h3>By bot</h3>
      <div class="cost-table-wrap">
        <table class="cost-table">
          <thead>
            <tr>
              <th>Bot</th>
              <th>Model</th>
              <th class="num">Convs</th>
              <th class="num">Msgs</th>
              <th class="num">Input</th>
              <th class="num">Output</th>
              <th class="num">In $</th>
              <th class="num">Out $</th>
              <th class="num">Cost</th>
            </tr>
          </thead>
          <tbody>${botRows || `<tr><td colspan="9">No data</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function loadCostAnalysis() {
  if (!costAnalysisBody) return;
  costAnalysisBody.innerHTML = `<div class="empty">Computing cost estimates…</div>`;
  const res = await fetch(`/api/cost-analysis?${queryParams().toString()}`);
  if (!res.ok) {
    costAnalysisBody.innerHTML = `<div class="empty">Failed to load cost analysis</div>`;
    return;
  }
  costAnalysisData = await res.json();
  renderCostAnalysis(costAnalysisData);
}

async function setCostAnalysis(on) {
  costAnalysisOn = on;
  syncShortcutButtons();
  updateLayoutMode();
  if (costAnalysisOn) {
    await loadCostAnalysis();
  } else {
    renderList();
  }
}

function applyFiltersPanelWidth(persist = true) {
  const row = document.querySelector(".topbar-row-controls");
  if (!row) return;
  filtersPanelWidthPct = Math.min(78, Math.max(28, filtersPanelWidthPct));
  row.style.setProperty("--filters-panel-w", `${filtersPanelWidthPct}%`);
  if (persist) localStorage.setItem(FILTERS_PANEL_W_KEY, String(Math.round(filtersPanelWidthPct)));
}

function wireControlsSplitHandle() {
  const handle = document.getElementById("controlsSplitHandle");
  const row = document.querySelector(".topbar-row-controls");
  if (!handle || !row || handle.dataset.wired) return;
  handle.dataset.wired = "1";

  let startX = 0;
  let startPct = 0;

  const onMove = (e) => {
    const rect = row.getBoundingClientRect();
    if (!rect.width) return;
    const deltaPct = ((e.clientX - startX) / rect.width) * 100;
    filtersPanelWidthPct = startPct + deltaPct;
    applyFiltersPanelWidth(false);
  };

  const onUp = () => {
    row.classList.remove("resizing");
    applyFiltersPanelWidth(true);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startPct = filtersPanelWidthPct;
    row.classList.add("resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
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
  if (costAnalysisOn) return;

  if (groupByBot) {
    renderBotMap();
    return;
  }

  const listItems = sortByTime ? sortConversationsByTime(items, "asc") : items;
  itemList.innerHTML = listItems.map(conversationItemHtml).join("");

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

function messageLabelKey(convId, messageNumber) {
  return `${convId}:${messageNumber}`;
}

function messageCodesForRole(role) {
  const r = (role || "").toLowerCase();
  if (r === "user") return USER_MSG_CODES;
  if (r === "bot" || r === "assistant") return BOT_MSG_CODES;
  return [];
}

function normalizeMsgCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase();
}

function messageLabelCode(row) {
  if (!row) return "";
  if (row.code) return normalizeMsgCode(row.code);
  if (Array.isArray(row.codes) && row.codes.length) {
    const primary = row.codes.map(normalizeMsgCode).find((c) => c && c !== "iterative");
    return primary || "";
  }
  return "";
}

function messageLabelRationale(row) {
  return row && row.rationale ? String(row.rationale) : "";
}

function messageLabelIterative(row) {
  if (!row) return false;
  if (row.iterative) return true;
  if (Array.isArray(row.codes) && row.codes.map(normalizeMsgCode).includes("iterative")) return true;
  return false;
}

function setMessageLabelPanelEditable(panel, editable) {
  panel
    .querySelectorAll(".msg-label-opt, .msg-label-extra, .msg-label-rationale, .msg-label-confirm")
    .forEach((el) => {
      el.disabled = !editable;
    });
  if (editable) syncMessageLabelConfirm(panel);
}

function syncMessageLabelConfirm(panel) {
  const confirmBtn = panel.querySelector(".msg-label-confirm");
  const rationaleEl = panel.querySelector(".msg-label-rationale");
  if (!confirmBtn || !rationaleEl) return;

  const key = messageLabelKey(panel.dataset.conv, panel.dataset.msg);
  const saved = messageLabels[key];
  const code = panel.dataset.draftCode || "";
  const iterative = panel.dataset.draftIterative === "1";
  const rationale = rationaleEl.value.trim();
  const savedCode = messageLabelCode(saved);
  const savedRationale = messageLabelRationale(saved).trim();
  const savedIterative = messageLabelIterative(saved);
  const dirty =
    code !== savedCode || rationale !== savedRationale || iterative !== savedIterative;
  const ready = !!code && !!rationale && dirty;
  confirmBtn.disabled = !canEditBotLabels() || !ready;
  confirmBtn.textContent = savedCode && !dirty ? "Saved" : "Confirm";
  panel.classList.toggle("is-saved", !!savedCode && !dirty);
  panel.classList.toggle("is-dirty", dirty && (!!code || !!rationale || iterative));
}

function messageLabelStatusHtml(code, iterative, updatedBy) {
  if (!code) return `<div class="msg-label-status">Select a label, add rationale, then Confirm</div>`;
  const bits = [escapeHtml(code)];
  if (iterative) bits.push("iterative");
  return `<div class="msg-label-status">Labeled <strong>${bits.join(" · ")}</strong>${
    updatedBy ? ` · ${escapeHtml(updatedBy)}` : ""
  }</div>`;
}

function messageLabelControlsHtml(convId, m) {
  const role = (m.role || "").toLowerCase();
  const codes = messageCodesForRole(role);
  if (!codes.length) return "";

  const key = messageLabelKey(convId, m.message_number);
  const row = messageLabels[key];
  const savedCode = messageLabelCode(row);
  const savedRationale = messageLabelRationale(row);
  const savedIterative = messageLabelIterative(row);
  const editable = canEditBotLabels();
  const showIterative = role === "user";

  const opts = codes
    .map((c) => {
      const on = c === savedCode;
      return `<button
        type="button"
        class="msg-label-opt ${on ? "active" : ""}"
        data-code="${escapeHtml(c)}"
        aria-pressed="${on ? "true" : "false"}"
        ${editable ? "" : "disabled"}
      >${escapeHtml(c)}</button>`;
    })
    .join("");

  const iterativeBtn = showIterative
    ? `<button
        type="button"
        class="msg-label-extra ${savedIterative ? "active" : ""}"
        data-flag="iterative"
        aria-pressed="${savedIterative ? "true" : "false"}"
        title="Asked before in this conversation"
        ${editable ? "" : "disabled"}
      >iterative</button>`
    : "";

  return `
    <div
      class="msg-label-panel ${savedCode ? "is-saved" : ""}"
      data-conv="${escapeHtml(String(convId))}"
      data-msg="${escapeHtml(String(m.message_number))}"
      data-role="${escapeHtml(role)}"
      data-draft-code="${escapeHtml(savedCode)}"
      data-draft-iterative="${savedIterative ? "1" : "0"}"
    >
      <div class="msg-label-row">
        <div class="msg-label-seg" role="radiogroup" aria-label="Message label">${opts}</div>
        ${iterativeBtn}
      </div>
      <div class="msg-label-form">
        <textarea
          class="msg-label-rationale"
          rows="2"
          placeholder="Rationale…"
          ${editable ? "" : "disabled"}
        >${escapeHtml(savedRationale)}</textarea>
        <button type="button" class="msg-label-confirm" ${editable ? "" : "disabled"}>Confirm</button>
      </div>
      ${messageLabelStatusHtml(savedCode, savedIterative, row && row.updated_by)}
    </div>`;
}

async function saveMessageLabel(convId, messageNumber, role, code, rationale, iterative = false) {
  if (!canEditBotLabels()) {
    alert("Only ruiwei or jiayi can edit message labels. Confirm your name at the top right.");
    if (selectedId) loadDetail(selectedId);
    return null;
  }
  const res = await fetch(
    `/api/message-labels/${encodeURIComponent(convId)}/${encodeURIComponent(messageNumber)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        rationale,
        iterative: !!iterative,
        editor: labelerName(),
        role,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.detail || "Failed to save message label");
    if (selectedId) loadDetail(selectedId);
    return null;
  }
  const row = await res.json();
  const key = messageLabelKey(convId, messageNumber);
  if (row.code) messageLabels[key] = row;
  else delete messageLabels[key];
  try {
    const all = JSON.parse(localStorage.getItem(MSG_LABELS_LOCAL_KEY) || "{}");
    if (row.code) all[key] = row;
    else delete all[key];
    localStorage.setItem(MSG_LABELS_LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  return row;
}

function wireMessageLabelControls() {
  detailPane.querySelectorAll(".msg-label-panel").forEach((panel) => {
    const rationaleEl = panel.querySelector(".msg-label-rationale");
    const confirmBtn = panel.querySelector(".msg-label-confirm");
    const statusEl = panel.querySelector(".msg-label-status");
    syncMessageLabelConfirm(panel);

    panel.querySelectorAll(".msg-label-opt").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const code = btn.dataset.code || "";
        const next = panel.dataset.draftCode === code ? "" : code;
        panel.dataset.draftCode = next;
        panel.querySelectorAll(".msg-label-opt").forEach((opt) => {
          const on = opt.dataset.code === next;
          opt.classList.toggle("active", on);
          opt.setAttribute("aria-pressed", on ? "true" : "false");
        });
        syncMessageLabelConfirm(panel);
      });
    });

    panel.querySelectorAll(".msg-label-extra").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const next = panel.dataset.draftIterative !== "1";
        panel.dataset.draftIterative = next ? "1" : "0";
        btn.classList.toggle("active", next);
        btn.setAttribute("aria-pressed", next ? "true" : "false");
        syncMessageLabelConfirm(panel);
      });
    });

    rationaleEl?.addEventListener("input", () => syncMessageLabelConfirm(panel));
    rationaleEl?.addEventListener("click", (e) => e.stopPropagation());

    confirmBtn?.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirmBtn.disabled) return;
      const code = panel.dataset.draftCode || "";
      const iterative = panel.dataset.draftIterative === "1";
      const rationale = (rationaleEl?.value || "").trim();
      if (!code || !rationale) return;

      confirmBtn.disabled = true;
      confirmBtn.textContent = "Saving…";
      const saved = await saveMessageLabel(
        panel.dataset.conv,
        panel.dataset.msg,
        panel.dataset.role,
        code,
        rationale,
        iterative
      );
      if (!saved) return;

      panel.dataset.draftCode = saved.code || "";
      panel.dataset.draftIterative = saved.iterative ? "1" : "0";
      if (rationaleEl) rationaleEl.value = saved.rationale || "";
      panel.querySelectorAll(".msg-label-opt").forEach((opt) => {
        const on = opt.dataset.code === (saved.code || "");
        opt.classList.toggle("active", on);
        opt.setAttribute("aria-pressed", on ? "true" : "false");
      });
      panel.querySelectorAll(".msg-label-extra").forEach((opt) => {
        const on = !!saved.iterative;
        opt.classList.toggle("active", on);
        opt.setAttribute("aria-pressed", on ? "true" : "false");
      });
      if (statusEl) {
        statusEl.outerHTML = messageLabelStatusHtml(
          saved.code || "",
          !!saved.iterative,
          saved.updated_by
        );
      }
      syncMessageLabelConfirm(panel);
    });
  });
}

function renderConversationDetail(c) {
  const convId = c.conv_id || c.id;
  messageLabels = { ...(c.message_labels || {}) };
  try {
    const local = JSON.parse(localStorage.getItem(MSG_LABELS_LOCAL_KEY) || "{}");
    Object.entries(local).forEach(([key, row]) => {
      if (!key.startsWith(`${convId}:`)) return;
      const server = messageLabels[key];
      if (!server || (row.updated_at || "") > (server.updated_at || "")) {
        messageLabels[key] = row;
      }
    });
  } catch {
    /* ignore */
  }

  const messagesHtml = (c.messages || [])
    .map(
      (m) => `
      <div class="bubble ${escapeHtml(m.role)} ${m.flagged ? "flagged" : ""}" data-role="${escapeHtml(
        (m.role || "").toLowerCase()
      )}">
        <div class="bubble-meta">
          <span class="bubble-role">${escapeHtml(m.role || "unknown")} · #${m.message_number}</span>
          <span class="bubble-time">${escapeHtml(m.datetime || "")}${
            m.time_since ? ` · ${escapeHtml(m.time_since)}` : ""
          }</span>
        </div>
        <div class="bubble-body">${escapeHtml(m.content || "")}</div>
        ${messageLabelControlsHtml(convId, m)}
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

    <div class="section system-prompt-section" id="systemPromptSection">
      <div class="section-head">
        <h3>System prompt</h3>
        <button type="button" class="section-toggle" id="togglePromptSectionBtn">Collapse</button>
      </div>
      <div class="system-prompt-body" id="systemPromptBody">
        ${appConfigHtml(c.app_config)}
        <pre class="prompt-body prompt-collapsed" id="promptBody">${escapeHtml(c.system_prompt || "(empty)")}</pre>
        <button type="button" class="linkish" id="expandPromptBtn">Show full prompt</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h3>Messages</h3>
        <div class="msg-role-filter" role="group" aria-label="Message role filter">
          <button type="button" class="chip-btn active" data-msg-filter="all">All</button>
          <button type="button" class="chip-btn" data-msg-filter="user">User</button>
          <button type="button" class="chip-btn" data-msg-filter="bot">Bot</button>
        </div>
      </div>
      <div class="thread" id="messageThread">${messagesHtml || "<p>No messages</p>"}</div>
    </div>
  `;

  wirePromptActions(c.system_prompt || "");
  wireMessageRoleFilter();
  wireMessageLabelControls();
}

function wireMessageRoleFilter() {
  const buttons = detailPane.querySelectorAll("[data-msg-filter]");
  const thread = document.getElementById("messageThread");
  if (!buttons.length || !thread) return;

  const apply = (filter) => {
    buttons.forEach((btn) => btn.classList.toggle("active", btn.dataset.msgFilter === filter));
    thread.querySelectorAll(".bubble").forEach((bubble) => {
      const role = (bubble.dataset.role || "").toLowerCase();
      const show =
        filter === "all" ||
        (filter === "user" && role === "user") ||
        (filter === "bot" && (role === "bot" || role === "assistant"));
      bubble.hidden = !show;
    });
    const visible = [...thread.querySelectorAll(".bubble")].some((b) => !b.hidden);
    let empty = thread.querySelector(".msg-filter-empty");
    if (!visible && thread.querySelector(".bubble")) {
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "msg-filter-empty";
        empty.textContent = "No messages for this filter";
        thread.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
  };

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => apply(btn.dataset.msgFilter));
  });
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

  const section = document.getElementById("systemPromptSection");
  const sectionBody = document.getElementById("systemPromptBody");
  const sectionToggle = document.getElementById("togglePromptSectionBtn");
  if (section && sectionBody && sectionToggle) {
    sectionToggle.addEventListener("click", () => {
      const collapsed = section.classList.toggle("section-collapsed");
      sectionBody.hidden = collapsed;
      sectionToggle.textContent = collapsed ? "Expand" : "Collapse";
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

function syncShortcutButtons() {
  groupByBotBtn?.classList.toggle("active", groupByBot && !costAnalysisOn);
  groupByUserBtn?.classList.toggle("active", groupByUser && !costAnalysisOn);
  sortByTimeBtn?.classList.toggle("active", sortByTime && !costAnalysisOn);
  costAnalysisBtn?.classList.toggle("active", costAnalysisOn);
  needsAttentionBtn?.classList.toggle("danger-active", needsAttention);
}

function setNeedsAttention(on) {
  needsAttention = on;
  syncShortcutButtons();
  onFilterChanged();
}

function setGroupByBot(on) {
  if (costAnalysisOn) costAnalysisOn = false;
  groupByBot = on;
  syncShortcutButtons();
  renderList();
}

function setGroupByUser(on) {
  if (costAnalysisOn) costAnalysisOn = false;
  groupByUser = on;
  if (groupByUser) sortByTime = false;
  else if (!sortByTime) sortByTime = true;
  syncShortcutButtons();
  renderList();
}

function setSortByTime(on) {
  if (costAnalysisOn) costAnalysisOn = false;
  sortByTime = on;
  if (sortByTime) groupByUser = false;
  else if (!groupByUser) groupByUser = true;
  syncShortcutButtons();
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
groupByUserBtn?.addEventListener("click", () => setGroupByUser(!groupByUser));
sortByTimeBtn?.addEventListener("click", () => setSortByTime(!sortByTime));
costAnalysisBtn?.addEventListener("click", () => setCostAnalysis(!costAnalysisOn));
costAnalysisCloseBtn?.addEventListener("click", () => setCostAnalysis(false));
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
    wireControlsSplitHandle();
    wireColumnZoom();
    wireLabelerBox();
    applyDetailWidth();
    applyFiltersPanelWidth(false);
    syncShortcutButtons();
    await loadBotLabels();
    await loadFilters();
    await loadList();
  } catch (err) {
    itemList.innerHTML = `<div class="empty">Failed to load data: ${escapeHtml(err.message)}</div>`;
  }
})();
