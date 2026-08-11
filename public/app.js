let view = "conversations"; // conversations | activities
let items = [];
let selectedId = null;
let filterData = { activities: {}, conversations: {} };
let needsAttention = false;
let builderOnly = false;
let groupByBot = false;
let searchTimer = null;

const appSelect = document.getElementById("appSelect");
const userSelect = document.getElementById("userSelect");
const modelSelect = document.getElementById("modelSelect");
const modelFilterWrap = document.getElementById("modelFilterWrap");
const searchInput = document.getElementById("searchInput");
const itemList = document.getElementById("itemList");
const detailPane = document.getElementById("detailPane");
const listCount = document.getElementById("listCount");
const totalCount = document.getElementById("totalCount");
const needsAttentionBtn = document.getElementById("needsAttentionBtn");
const builderBtn = document.getElementById("builderBtn");
const groupByBotBtn = document.getElementById("groupByBotBtn");
const shortcutsBar = document.getElementById("shortcutsBar");
const tabConversations = document.getElementById("tabConversations");
const tabActivities = document.getElementById("tabActivities");

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

function fillSelect(select, values, allLabel = "All", allCount = null) {
  const current = select.value || "All";
  const items = normalizeOptions(values);
  const allText = allCount == null ? allLabel : `${allLabel} (${allCount})`;
  select.innerHTML = `<option value="All">${allText}</option>`;
  items.forEach(({ name, count }) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = count == null ? name : `${name} (${count})`;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === current)) {
    select.value = current;
  } else {
    select.value = "All";
  }
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

function setView(next) {
  view = next;
  selectedId = null;
  tabConversations.classList.toggle("active", view === "conversations");
  tabActivities.classList.toggle("active", view === "activities");
  modelFilterWrap.style.display = view === "activities" ? "" : "none";
  shortcutsBar.style.display = view === "conversations" ? "" : "none";
  if (view !== "conversations") {
    groupByBot = false;
    builderOnly = false;
    needsAttention = false;
    groupByBotBtn.classList.remove("active");
    builderBtn.classList.remove("active");
    needsAttentionBtn.classList.remove("danger-active");
  }
  searchInput.placeholder =
    view === "conversations" ? "Search conversations…" : "Search title, prompt…";
  applyFilterOptions();
  loadList();
}

function applyFilterOptions() {
  if (view === "conversations") {
    const c = filterData.conversations || {};
    fillCountSelect("appSelectWrap", c.apps || [], c.apps_total ?? c.total ?? 0, onFilterChanged);
    fillCountSelect("userSelectWrap", c.users || [], c.users_total ?? c.total ?? 0, onFilterChanged);
    totalCount.textContent = `${c.total || 0} conversations · ${c.message_rows || 0} messages`;
  } else {
    const a = filterData.activities || {};
    fillCountSelect("appSelectWrap", a.apps || [], a.apps_total ?? a.total ?? 0, onFilterChanged);
    fillCountSelect("userSelectWrap", a.creators || [], a.creators_total ?? a.total ?? 0, onFilterChanged);
    fillSelect(modelSelect, a.models || [], "All", a.models_total ?? a.total ?? 0);
    totalCount.textContent = `${a.total || 0} system-prompt activities`;
  }
}

function filterQueryParams() {
  const params = new URLSearchParams();
  if (view === "conversations") {
    if (userSelect.value && userSelect.value !== "All") params.set("user", userSelect.value);
    if (appSelect.value && appSelect.value !== "All") params.set("app", appSelect.value);
    if (builderOnly) params.set("builder_only", "true");
    if (needsAttention) params.set("needs_attention", "true");
  } else {
    if (userSelect.value && userSelect.value !== "All") params.set("creator", userSelect.value);
    if (appSelect.value && appSelect.value !== "All") params.set("app", appSelect.value);
    if (modelSelect.value && modelSelect.value !== "All") params.set("model", modelSelect.value);
  }
  return params;
}

async function refreshCascadingFilters() {
  const res = await fetch(`/api/filters?${filterQueryParams().toString()}`);
  const data = await res.json();
  if (view === "conversations") {
    filterData.conversations = data.conversations || filterData.conversations;
  } else {
    filterData.activities = data.activities || filterData.activities;
  }
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

  if (view === "conversations") {
    if (userSelect.value && userSelect.value !== "All") params.set("user", userSelect.value);
    if (builderOnly) params.set("builder_only", "true");
  } else {
    if (userSelect.value && userSelect.value !== "All") params.set("creator", userSelect.value);
    if (modelSelect.value && modelSelect.value !== "All") params.set("model", modelSelect.value);
  }
  return params;
}

async function loadList() {
  itemList.innerHTML = `<div class="empty">Loading…</div>`;
  const endpoint = view === "conversations" ? "/api/conversations" : "/api/activities";
  const res = await fetch(`${endpoint}?${queryParams().toString()}`);
  const data = await res.json();

  if (view === "conversations") {
    items = data.conversations || [];
    listCount.textContent = `${data.count} conversation${data.count === 1 ? "" : "s"}`;
  } else {
    items = data.activities || [];
    listCount.textContent = `${data.count} activit${data.count === 1 ? "y" : "ies"}`;
  }

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

function activityItemHtml(a) {
  return `
    <button class="activity-item ${a.id === selectedId ? "selected" : ""}" data-id="${a.id}" type="button">
      <div class="item-top">
        <div class="item-title">${escapeHtml(a.title)}</div>
        <div class="item-date">${escapeHtml(a.date)}</div>
      </div>
      <div class="item-bottom">
        <div class="item-user">
          <div class="avatar">${escapeHtml(initials(a.creator))}</div>
          <div class="user-name">${escapeHtml(a.creator)}</div>
        </div>
        <div class="item-meta">
          ${a.model ? `<span class="tag">${escapeHtml(a.model)}</span>` : ""}
          <span class="msg-count" title="Reference files">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            </svg>
            ${a.reference_file_count}
          </span>
        </div>
      </div>
    </button>`;
}

function renderGroupedConversations() {
  const groups = new Map();
  items.forEach((c) => {
    const key = c.title || "Untitled";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });

  const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  return sortedKeys
    .map((key) => {
      const groupItems = groups.get(key);
      return `
        <div class="group-header">
          <div class="group-header-title">${escapeHtml(key)}</div>
          <div class="group-header-count">${groupItems.length}</div>
        </div>
        ${groupItems.map(conversationItemHtml).join("")}
      `;
    })
    .join("");
}

function renderList() {
  if (view === "conversations") {
    itemList.innerHTML = groupByBot
      ? renderGroupedConversations()
      : items.map(conversationItemHtml).join("");
  } else {
    itemList.innerHTML = items.map(activityItemHtml).join("");
  }

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

async function loadDetail(id) {
  if (!id) {
    renderEmptyDetail();
    return;
  }

  detailPane.innerHTML = `<div class="empty">Loading detail…</div>`;
  const endpoint =
    view === "conversations"
      ? `/api/conversations/${encodeURIComponent(id)}`
      : `/api/activities/${encodeURIComponent(id)}`;
  const res = await fetch(endpoint);
  if (!res.ok) {
    detailPane.innerHTML = `<div class="empty">Failed to load detail</div>`;
    return;
  }
  const data = await res.json();
  if (view === "conversations") {
    renderConversationDetail(data);
  } else {
    renderActivityDetail(data);
  }
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

    <div class="section">
      <h3>System prompt</h3>
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

function renderActivityDetail(a) {
  const files = (a.reference_files || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  detailPane.innerHTML = `
    <div class="detail-header">
      <div>
        <h1 class="detail-title">${escapeHtml(a.title)}</h1>
        <div class="detail-sub">${escapeHtml(a.creator)} · ${escapeHtml(a.date)} · ${escapeHtml(a.app_name)}</div>
      </div>
      <div class="detail-actions">
        ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Open in Playlab</a>` : ""}
        <button type="button" id="copyPromptBtn">Copy prompt</button>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-card"><div class="label">Model</div><div class="value">${escapeHtml(a.model || "—")}</div></div>
      <div class="meta-card"><div class="label">Variability</div><div class="value">${escapeHtml(a.variability || "—")}</div></div>
      <div class="meta-card"><div class="label">Style</div><div class="value">${escapeHtml(a.interaction_style || "—")}</div></div>
      <div class="meta-card"><div class="label">Reference files</div><div class="value">${a.reference_file_count}</div></div>
    </div>

    ${a.description ? `<div class="section"><h3>Description</h3><p>${escapeHtml(a.description)}</p></div>` : ""}
    ${a.welcome_message ? `<div class="section"><h3>Welcome message</h3><p>${escapeHtml(a.welcome_message)}</p></div>` : ""}

    <div class="section">
      <h3>System prompt</h3>
      <pre class="prompt-body" id="promptBody">${escapeHtml(a.system_prompt || "(empty)")}</pre>
    </div>

    <div class="section">
      <h3>Enabled tools</h3>
      <div class="chip-row">${renderChips(a.enabled_tools)}</div>
    </div>

    <div class="section">
      <h3>Enabled settings</h3>
      <div class="chip-row">${renderChips(a.enabled_settings, true)}</div>
    </div>

    ${
      files.length
        ? `<div class="section"><h3>Reference files</h3><div class="file-list">${files
            .map((f) => `<span>${escapeHtml(f)}</span>`)
            .join("")}</div></div>`
        : ""
    }
  `;

  wirePromptActions(a.system_prompt || "");
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

function setBuilderOnly(on) {
  builderOnly = on;
  builderBtn.classList.toggle("active", on);
  onFilterChanged();
}

function setGroupByBot(on) {
  groupByBot = on;
  groupByBotBtn.classList.toggle("active", on);
  renderList();
}

tabConversations.addEventListener("click", () => setView("conversations"));
tabActivities.addEventListener("click", () => setView("activities"));
modelSelect.addEventListener("change", () => onFilterChanged());
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 250);
});
needsAttentionBtn.addEventListener("click", () => setNeedsAttention(!needsAttention));
builderBtn.addEventListener("click", () => setBuilderOnly(!builderOnly));
groupByBotBtn.addEventListener("click", () => setGroupByBot(!groupByBot));

(async function init() {
  try {
    wireCountSelect("appSelectWrap");
    wireCountSelect("userSelectWrap");
    modelFilterWrap.style.display = "none";
    await loadFilters();
    await loadList();
  } catch (err) {
    itemList.innerHTML = `<div class="empty">Failed to load data: ${escapeHtml(err.message)}</div>`;
  }
})();
