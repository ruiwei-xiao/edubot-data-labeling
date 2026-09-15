let items = [];
let selectedId = null;
let filterData = { conversations: {} };
let needsAttention = false;
let disagreedOnly = false;
let groupByBot = true;
let groupByUser = true;
let sortByTime = false;
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
let conversationLabels = {}; // conv_id -> { codes, code, ... }
let conversationCodes = [];
let conversationCodeOptions = []; // [{id, primary, label, definition}]
const FALLBACK_CONVERSATION_CODE_OPTIONS = [{"id": "F1", "primary": "Factual", "label": "Incorrect content (hallucination)", "definition": "The bot states false, fabricated, or miscalculated information, or misgrades a student answer."}, {"id": "F2", "primary": "Factual", "label": "Incomplete or imprecise content", "definition": "The bot's content is not wrong but omits a required element or is too vague to support the goal in the system prompt."}, {"id": "F3", "primary": "Factual", "label": "Internal inconsistency", "definition": "The bot contradicts something it said earlier in the same conversation."}, {"id": "F4", "primary": "Factual", "label": "Grounding failure", "definition": "The bot ignores or misreads course material or context supplied in the system prompt or uploaded by the builder."}, {"id": "F5", "primary": "Factual", "label": "Guardrail breach", "definition": "The bot performs an action the system prompt explicitly forbids."}, {"id": "F6", "primary": "Factual", "label": "Off-task drift", "definition": "The bot follows the student away from the bot's stated purpose and does not redirect."}, {"id": "F7", "primary": "Factual", "label": "Over-refusal", "definition": "The bot refuses or deflects an in-scope request by misapplying a guardrail."}, {"id": "W1", "primary": "Workflow", "label": "Student abandonment", "definition": "The student stops responding before the goal is reached; the last turn is the bot's."}, {"id": "W2", "primary": "Workflow", "label": "Unanswered student question", "definition": "The bot ignores or deflects a direct student question and continues its own script."}, {"id": "W3", "primary": "Workflow", "label": "Unanswered bot question", "definition": "The student does not answer the bot's question and the bot neither re-asks nor adapts; the thread is dropped."}, {"id": "W4", "primary": "Workflow", "label": "Broken or truncated output", "definition": "The bot's response is cut off, empty, or unreadable due to formatting (e.g., raw LaTeX, broken markdown)."}, {"id": "W5", "primary": "Workflow", "label": "Repetition loop", "definition": "The bot repeats the same question or explanation across consecutive turns without progress."}, {"id": "W6", "primary": "Workflow", "label": "Multi-question overload", "definition": "The bot asks several questions in one turn; the student answers at most one and the rest are lost."}, {"id": "W7", "primary": "Workflow", "label": "Skipped or missing structure", "definition": "The bot fails to follow a workflow step defined in the system prompt (e.g., skips a required opening, diagnosis, or wrap-up step)."}, {"id": "W8", "primary": "Workflow", "label": "Language or format mismatch", "definition": "The bot responds in a language or output format that contradicts the system prompt or the student's input."}, {"id": "W9", "primary": "Workflow", "label": "No expectation setup", "definition": "At the start of the conversation, the bot does not tell the student what it can do or what to expect, so the student has no clear sense of its capabilities or scope."}, {"id": "D1", "primary": "Diagnose", "label": "No diagnosis before instruction", "definition": "The bot begins teaching or giving feedback without eliciting the student's prior knowledge or current attempt when the prompt expects it."}, {"id": "D2", "primary": "Diagnose", "label": "Misjudged level", "definition": "The bot's explanation is pitched too high or too low for the student's demonstrated level."}, {"id": "D3", "primary": "Diagnose", "label": "Missed error (false positive)", "definition": "The bot fails to notice a student mistake or affirms an incorrect answer."}, {"id": "D4", "primary": "Diagnose", "label": "False error (false negative)", "definition": "The bot marks a correct student answer as wrong."}, {"id": "D5", "primary": "Diagnose", "label": "Ignored learner signal", "definition": "The student explicitly signals confusion, frustration, or a time constraint and the bot proceeds unchanged."}, {"id": "D6", "primary": "Diagnose", "label": "Misidentified request", "definition": "The bot misreads what the student is actually asking for (task type or intent)."}, {"id": "P1", "primary": "Pedagogical", "label": "Answer dumping (too early)", "definition": "The bot reveals the full solution before the student has attempted the task when the prompt calls for guided help."}, {"id": "P2", "primary": "Pedagogical", "label": "Over-scaffolding (too many rounds)", "definition": "The bot keeps asking guiding questions when the student is clearly stuck or the question is factual/logistical, withholding information unproductively."}, {"id": "P3", "primary": "Pedagogical", "label": "Cognitive overload (verbosity)", "definition": "The bot delivers too much content at once relative to the student's level or the task."}, {"id": "P4", "primary": "Pedagogical", "label": "Strategy-task mismatch (refer to kli/blooms)", "definition": "The instructional approach does not fit the task type."}, {"id": "P5", "primary": "Pedagogical", "label": "Insufficient cognitive engagement", "definition": "The student shows little substantive engagement—e.g., mostly short acknowledgments like \"yes\" / \"ok\" / \"sure\"—without meaningful reasoning, attempts, or elaboration."}, {"id": "P6", "primary": "Pedagogical", "label": "Poor feedback quality", "definition": "Feedback is vague, does not acknowledge correct parts, or is delivered in a discouraging way."}, {"id": "P7", "primary": "Pedagogical", "label": "Failure to recover", "definition": "After the student corrects the bot or pushes back, the bot does not adjust its strategy or content."}];
let currentLabelableMsgIds = []; // message_number strings for open conversation
let BOT_MSG_CODES = ["success", "fail", "others"];
let USER_MSG_CODES = ["desired", "adversarial", "others"];
let USER_MSG_FLAGS = ["iterative"];
const ALLOWED_LABELERS = new Set(["naacl_label1", "naacl_label2"]);
const LABELER_KEY = "playlab_labeler_name";
const LABEL_LEVELS_KEY = "playlab_label_levels_v3";
const CONV_DEFECT_FLOAT_KEY = "playlab_conv_defect_float";
const CONV_DEFECT_FLOAT_POS_KEY = "playlab_conv_defect_float_pos";
let convDefectFloat = localStorage.getItem(CONV_DEFECT_FLOAT_KEY) === "1";
let convDefectFloatPos = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(CONV_DEFECT_FLOAT_POS_KEY) || "null");
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      return {
        x: raw.x,
        y: raw.y,
        w: Number.isFinite(raw.w) ? raw.w : null,
        h: Number.isFinite(raw.h) ? raw.h : null,
      };
    }
  } catch {}
  return null;
})();
const ALL_LABEL_LEVELS = ["conversation", "message", "bot"];
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
const codingSelect = document.getElementById("codingSelect");
const searchInput = document.getElementById("searchInput");
const itemList = document.getElementById("itemList");
const detailPane = document.getElementById("detailPane");
const listCount = document.getElementById("listCount");
const workspace = document.getElementById("workspace");
const botMapView = document.getElementById("botMapView");
const botMapGrid = document.getElementById("botMapGrid");
const botMapCount = document.getElementById("botMapCount");
const splitHandle = document.getElementById("splitHandle");
const needsAttentionBtn = document.getElementById("needsAttentionBtn");
const disagreedBtn = document.getElementById("disagreedBtn");
const syncSheetBtn = document.getElementById("syncSheetBtn");
const groupByBotBtn = document.getElementById("groupByBotBtn");
const groupByUserBtn = document.getElementById("groupByUserBtn");
const sortByTimeBtn = document.getElementById("sortByTimeBtn");
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
let labelLevels = new Set(["conversation"]);

const DETAIL_WIDTH_KEY = "playlab_detail_width";
/** Set false to hide the Codebook panel / trigger (label codes still load via API). */
const CODEBOOK_UI_ENABLED = false;
const CODEBOOK_WIDTH_KEY = "playlab_codebook_width";
const FILTERS_PANEL_W_KEY = "playlab_filters_panel_w";
const COL_WIDTH_KEY = "playlab_bot_col_width";

function defaultColumnWidths() {
  // Initial 4:3:3 across map | conversation | codebook (handles ≈ 20px).
  const usable = Math.max(900, (workspace?.clientWidth || window.innerWidth) - 20);
  return {
    detail: Math.round(usable * 0.3),
    codebook: Math.round(usable * 0.3),
  };
}

const _defaultCols = defaultColumnWidths();
let detailWidth = Number(localStorage.getItem(DETAIL_WIDTH_KEY)) || _defaultCols.detail;
let codebookWidth = Number(localStorage.getItem(CODEBOOK_WIDTH_KEY)) || _defaultCols.codebook;
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
  fillCountSelect("codingSelectWrap", c.coding || [], c.coding_total ?? c.total ?? 0, onFilterChanged);
}

function activeCodingEditor() {
  if (!canEditBotLabels()) return "";
  return labelerName().toLowerCase();
}

function msgLabelsStorageKey() {
  const ed = activeCodingEditor();
  return ed ? `${MSG_LABELS_LOCAL_KEY}:${ed}` : MSG_LABELS_LOCAL_KEY;
}

function codingQueryParam(label) {
  const name = String(label || "").trim().toLowerCase();
  if (name === "coded") return "coded";
  if (name === "not coded") return "uncoded";
  if (name === "not sampled") return "not_sampled";
  return "";
}

function filterQueryParams() {
  const params = new URLSearchParams();
  if (userSelect.value && userSelect.value !== "All") params.set("user", userSelect.value);
  if (appSelect.value && appSelect.value !== "All") params.set("app", appSelect.value);
  const editor = activeCodingEditor();
  if (editor) params.set("editor", editor);
  if (editor && codingSelect?.value && codingSelect.value !== "All") {
    const coding = codingQueryParam(codingSelect.value);
    if (coding) params.set("coding", coding);
  }
  if (needsAttention) params.set("needs_attention", "true");
  if (disagreedOnly) params.set("disagreed", "true");
  return params;
}

function queryParams() {
  const params = new URLSearchParams();
  if (appSelect.value && appSelect.value !== "All") params.set("app", appSelect.value);
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
  if (needsAttention) params.set("needs_attention", "true");
  if (disagreedOnly) params.set("disagreed", "true");
  if (userSelect.value && userSelect.value !== "All") params.set("user", userSelect.value);
  const editor = activeCodingEditor();
  if (editor) params.set("editor", editor);
  if (editor && codingSelect?.value && codingSelect.value !== "All") {
    const coding = codingQueryParam(codingSelect.value);
    if (coding) params.set("coding", coding);
  }
  return params;
}

async function refreshSpreadsheet({ silent = false } = {}) {
  const markSyncing = (on) => {
    if (!listCount && !botMapCount) return;
    const base = listCount?.dataset.baseCount || botMapCount?.dataset.baseCount || "";
    const text = on
      ? `${base}${base ? " · " : ""}Syncing sheet…`
      : base || listCount?.textContent || "";
    if (listCount) listCount.textContent = text;
    if (botMapCount && groupByBot) {
      botMapCount.textContent = on ? "Syncing sheet…" : botMapCount.dataset.baseCount || text;
    }
  };

  markSyncing(true);
  try {
    const res = await fetch("/api/refresh", { method: "POST" });
    if (!res.ok) throw new Error("Failed to refresh spreadsheet");
    await loadBotLabels();
    await refreshCascadingFilters();
    await loadList();
    if (selectedId) await loadDetail(selectedId);
    return true;
  } catch (err) {
    if (!silent) console.warn("Background sheet sync failed:", err);
    return false;
  } finally {
    markSyncing(false);
  }
}

function updateListCountLabel() {
  if (!listCount) return;
  const visible = visibleConversations(items);
  const n = visible.length;
  const bots = new Set(visible.map((i) => i.title)).size;
  const msgs = visible.reduce((sum, i) => {
    if (disagreedOnly) return sum + (Number(i.disagreed_count) || 0);
    return sum + (Number(i.message_count) || 0);
  }, 0);
  const msgPart = disagreedOnly
    ? `${msgs} disagreed message${msgs === 1 ? "" : "s"}`
    : `${msgs} message${msgs === 1 ? "" : "s"}`;
  const base = groupByBot
    ? `${bots} bots · ${n} conversations · ${msgPart}`
    : `${n} conversations · ${msgPart}`;
  listCount.dataset.baseCount = base;
  listCount.textContent = base;
  if (botMapCount) botMapCount.dataset.baseCount = base;
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


async function loadList() {
  itemList.innerHTML = `<div class="empty">Loading…</div>`;
  const res = await fetch(`/api/conversations?${queryParams().toString()}`);
  const data = await res.json();

  items = data.conversations || [];
  const visible = visibleConversations(items);
  // Recompute sample red/green using conversation labels when in conversation-only mode.
  (items || []).forEach((c) => {
    if (c?.is_sample) c.is_coded = conversationFullyCoded(c.id);
  });
  updateListCountLabel();

  if (!visible.length) {
    itemList.innerHTML = `<div class="empty">${
      isConversationOnlyLabelMode()
        ? "No sample anonymous conversations match these filters"
        : "No items match these filters"
    }</div>`;
    selectedId = null;
    if (groupByBot) renderBotMap();
    renderEmptyDetail();
    return;
  }

  if (!selectedId || !visible.find((a) => a.id === selectedId)) {
    selectedId = visible[0].id;
  }

  renderList();
  await loadDetail(selectedId);
}

function sampleCodingClass(c) {
  if (!canEditBotLabels() || !c?.is_sample) return "";
  return c.is_coded ? "sample-coded" : "sample-uncoded";
}

function conversationItemHtml(c) {
  return `
    <button class="activity-item ${sampleCodingClass(c)} ${c.id === selectedId ? "selected" : ""}" data-id="${c.id}" type="button">
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
          ${c.is_sample && canEditBotLabels() ? `<span class="tag sample-tag">Sample</span>` : ""}
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
  const tip = `${c.user} · ${c.date} · ${c.message_count} msgs${c.is_sample ? " · sample" : ""}${
    c.is_sample ? (c.is_coded ? " · coded" : " · not coded") : ""
  }`;
  return `
    <button class="bot-card aud-${audience} ${sampleCodingClass(c)} ${
    c.id === selectedId ? "selected" : ""
  }" data-id="${c.id}" type="button" title="${escapeHtml(tip)}">
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

function loadLabelLevels() {
  const defaultLevels = ["conversation"];
  try {
    const raw = JSON.parse(localStorage.getItem(LABEL_LEVELS_KEY) || "null");
    if (Array.isArray(raw) && raw.length) {
      labelLevels = new Set(raw.filter((x) => ALL_LABEL_LEVELS.includes(x)));
    } else {
      labelLevels = new Set(defaultLevels);
    }
  } catch {
    labelLevels = new Set(defaultLevels);
  }
  if (!labelLevels.size) labelLevels = new Set(defaultLevels);
}

function saveLabelLevels() {
  localStorage.setItem(LABEL_LEVELS_KEY, JSON.stringify([...labelLevels]));
}

function labelLevelEnabled(level) {
  return labelLevels.has(level);
}

function isConversationOnlyLabelMode() {
  return (
    labelLevelEnabled("conversation") &&
    !labelLevelEnabled("message") &&
    !labelLevelEnabled("bot")
  );
}

function isAnonymousConversation(c) {
  if (!c || c.is_builder) return false;
  return !!(c.is_anonymous || c.user === "Anonymous" || c.user_raw === "Anonymous");
}

function isSampleAnonConversation(c) {
  return !!(c && c.is_sample && isAnonymousConversation(c));
}

/** Keep half of sample-anon chats (stable): conv_id % 20 === 1. */
function isHalfSampleAnonConversation(c) {
  if (!isSampleAnonConversation(c)) return false;
  const id = Number(c.id);
  return Number.isFinite(id) && id % 20 === 1;
}

/** Conversation-only labeling: keep half of sample anonymous; leave message/bot modes unfiltered. */
function visibleConversations(list = items) {
  if (!isConversationOnlyLabelMode()) return list;
  return (list || []).filter(isHalfSampleAnonConversation);
}

function syncLabelLevelUi() {
  const box = document.getElementById("labelLevelBox");
  if (!box) return;
  box.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = labelLevels.has(input.value);
  });
  ALL_LABEL_LEVELS.forEach((level) => {
    document.body.classList.toggle(`label-level-${level}`, labelLevels.has(level));
  });
}

async function applyLabelLevelFilter() {
  syncLabelLevelUi();
  const visible = visibleConversations(items);
  if (selectedId && !visible.find((c) => String(c.id) === String(selectedId))) {
    selectedId = visible[0]?.id || null;
  }
  refreshAllConversationCodedFlags();
  updateListCountLabel();
  renderList();
  if (selectedId) await loadDetail(selectedId);
  else renderEmptyDetail();
}

function wireLabelLevelBox() {
  const box = document.getElementById("labelLevelBox");
  if (!box || box.dataset.wired) return;
  box.dataset.wired = "1";
  loadLabelLevels();
  syncLabelLevelUi();
  box.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", async () => {
      const next = new Set(
        [...box.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value)
      );
      // Keep at least one level selected
      if (!next.size) {
        input.checked = true;
        next.add(input.value);
      }
      labelLevels = next;
      saveLabelLevels();
      await applyLabelLevelFilter();
    });
  });
}


function refreshLabelerUi({ refetch = true } = {}) {
  const canLabel = canEditBotLabels();
  document.body.classList.toggle("is-labeler", canLabel);
  const codingWrap = document.getElementById("codingFilter") || document.getElementById("codingSelectWrap")?.closest(".filter");
  if (codingWrap) codingWrap.hidden = !canLabel;
  if (!canLabel && codingSelect && codingSelect.value !== "All") {
    codingSelect.value = "All";
    const label = document.querySelector("#codingSelectWrap .count-select-label");
    const count = document.querySelector("#codingSelectWrap .count-select-count");
    if (label) label.textContent = "All";
    if (count) count.textContent = "";
  }
  if (!refetch) {
    if (groupByBot) renderBotMap();
    else renderList();
    if (selectedId) loadDetail(selectedId);
    return;
  }
  // Coding counts / sample status are per editor — refetch when labeler changes.
  onFilterChanged().then(() => {
    if (selectedId) loadDetail(selectedId);
  });
}

function syncLabelerStatus() {
  if (!labelerStatus) return;
  const name = labelerName();
  labelerStatus.classList.remove("can-edit", "blocked");
  botMapView?.classList.toggle("can-label", canEditBotLabels());
  document.body.classList.toggle("is-labeler", canEditBotLabels());
  const codingWrap = document.getElementById("codingFilter") || document.getElementById("codingSelectWrap")?.closest(".filter");
  if (codingWrap) codingWrap.hidden = !canEditBotLabels();
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
    labelerStatus.textContent = "View only (naacl_label1/2)";
    labelerStatus.classList.add("blocked");
  }
}

function confirmLabeler() {
  const name = labelerName();
  localStorage.setItem(LABELER_KEY, name);
  labelerConfirmed = !!name;
  localStorage.setItem(`${LABELER_KEY}_confirmed`, labelerConfirmed ? "1" : "0");
  syncLabelerStatus();
  refreshLabelerUi();
}

function wireLabelerBox() {
  if (!labelerNameInput || labelerNameInput.dataset.wired) return;
  labelerNameInput.dataset.wired = "1";
  labelerNameInput.value = localStorage.getItem(LABELER_KEY) || "";
  labelerConfirmed = localStorage.getItem(`${LABELER_KEY}_confirmed`) === "1" && !!labelerName();
  syncLabelerStatus();

  labelerNameInput.addEventListener("input", () => {
    // Changing the name requires Confirm again
    const wasConfirmed = labelerConfirmed;
    labelerConfirmed = false;
    localStorage.setItem(LABELER_KEY, labelerNameInput.value);
    localStorage.setItem(`${LABELER_KEY}_confirmed`, "0");
    syncLabelerStatus();
    // Only refetch coding stats when leaving a confirmed labeler session
    refreshLabelerUi({ refetch: wasConfirmed });
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
  if (!labelLevelEnabled("bot")) return "";
  if (!canEditBotLabels()) return "";
  const code = botLabelCode(botTitle);
  const editable = true;
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
    alert("Only naacl_label1 or naacl_label2 can edit bot-level codes. Enter your name at the top right.");
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
  const visibleItems = visibleConversations(items).filter((c) => audienceFilter[conversationAudience(c)]);
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

  const msgTotal = visibleItems.reduce((sum, i) => {
    if (disagreedOnly) return sum + (Number(i.disagreed_count) || 0);
    return sum + (Number(i.message_count) || 0);
  }, 0);
  const msgPart = disagreedOnly
    ? `${msgTotal} disagreed message${msgTotal === 1 ? "" : "s"}`
    : `${msgTotal} message${msgTotal === 1 ? "" : "s"}`;
  const botMapLabel = `${sortedKeys.length} bot${sortedKeys.length === 1 ? "" : "s"} · ${visibleItems.length} conversations · ${msgPart}`;
  botMapCount.textContent = botMapLabel;
  botMapCount.dataset.baseCount = botMapLabel;
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
  const minDetail = 240;
  const codebookOpen = workspace.classList.contains("codebook-open");
  const reserved = codebookOpen ? codebookWidth + 10 + 280 : 320;
  const maxDetail = Math.max(minDetail, window.innerWidth - reserved);
  detailWidth = Math.min(maxDetail, Math.max(minDetail, detailWidth));
  workspace.style.setProperty("--detail-w", `${detailWidth}px`);
}

function applyCodebookWidth() {
  const minCodebook = 280;
  const reserved = detailWidth + 10 + 280;
  const maxCodebook = Math.max(minCodebook, window.innerWidth - reserved);
  codebookWidth = Math.min(maxCodebook, Math.max(minCodebook, codebookWidth));
  workspace.style.setProperty("--codebook-w", `${codebookWidth}px`);
}

function setCodebookOpen(on) {
  workspace.classList.toggle("codebook-open", on);
  const pane = document.getElementById("codebookPane");
  const handle = document.getElementById("codebookSplitHandle");
  if (pane) pane.hidden = !on;
  if (handle) handle.hidden = !on;
  document.getElementById("codebookOpenBtn")?.classList.toggle("active", on);
  applyDetailWidth();
  applyCodebookWidth();
}

function updateLayoutMode() {
  const mapOn = groupByBot;
  workspace.classList.toggle("bot-map-mode", mapOn);
  if (botMapView) botMapView.hidden = !mapOn;
  if (splitHandle) splitHandle.hidden = !mapOn;
  if (detailPane) detailPane.hidden = false;
  if (document.getElementById("sidebar")) {
    document.getElementById("sidebar").hidden = mapOn;
  }
  applyDetailWidth();
  if (workspace.classList.contains("codebook-open")) applyCodebookWidth();
  if (mapOn) applyBotColWidth(false);
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
    if (workspace.classList.contains("codebook-open")) applyCodebookWidth();
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
    if (workspace.classList.contains("codebook-open")) applyCodebookWidth();
  });
}

function wireCodebookSplitHandle() {
  const handle = document.getElementById("codebookSplitHandle");
  if (!handle || handle.dataset.wired) return;
  handle.dataset.wired = "1";

  let startX = 0;
  let startWidth = 0;

  const onMove = (e) => {
    const dx = startX - e.clientX;
    codebookWidth = startWidth + dx;
    applyCodebookWidth();
    applyDetailWidth();
  };

  const onUp = () => {
    workspace.classList.remove("resizing");
    localStorage.setItem(CODEBOOK_WIDTH_KEY, String(codebookWidth));
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = codebookWidth;
    workspace.classList.add("resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

function renderList() {
  updateLayoutMode();

  if (groupByBot) {
    renderBotMap();
    return;
  }

  const source = visibleConversations(items);
  if (!source.length) {
    itemList.innerHTML = `<div class="empty">${
      isConversationOnlyLabelMode()
        ? "No sample anonymous conversations match these filters"
        : "No items match these filters"
    }</div>`;
    return;
  }
  const listItems = sortByTime ? sortConversationsByTime(source, "asc") : source;
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
  const params = new URLSearchParams();
  const editor = activeCodingEditor();
  if (editor) params.set("editor", editor);
  const qs = params.toString();
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`
  );
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

function messageFlagsForRole(role) {
  return (role || "").toLowerCase() === "user" ? USER_MSG_FLAGS : [];
}

function applyCodebookConfig(data) {
  const active = data?.active || data || {};
  if (Array.isArray(active.user_codes) && active.user_codes.length) {
    USER_MSG_CODES = active.user_codes.slice();
  }
  if (Array.isArray(active.bot_codes) && active.bot_codes.length) {
    BOT_MSG_CODES = active.bot_codes.slice();
  }
  if (Array.isArray(active.user_flags)) {
    USER_MSG_FLAGS = active.user_flags.slice();
  }
  if (Array.isArray(active.per_bot_codes) && active.per_bot_codes.length) {
    botLabelCodes = active.per_bot_codes.slice();
  }
  if (Array.isArray(active.conversation_codes) && active.conversation_codes.length) {
    conversationCodes = active.conversation_codes.slice();
  }
  if (Array.isArray(active.conversation_code_options) && active.conversation_code_options.length) {
    conversationCodeOptions = active.conversation_code_options.slice();
  }
}

async function loadCodebookConfig() {
  const res = await fetch("/api/codebook");
  if (!res.ok) return;
  applyCodebookConfig(await res.json());
}



function ensureConversationCodeOptions() {
  if (conversationCodeOptions.length) return;
  if (FALLBACK_CONVERSATION_CODE_OPTIONS.length) {
    conversationCodeOptions = FALLBACK_CONVERSATION_CODE_OPTIONS.slice();
    conversationCodes = conversationCodeOptions.map((o) => o.id);
  }
}

async function loadConversationCodeOptions() {
  try {
    const res = await fetch("/api/conversation-labels");
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.code_options) && data.code_options.length) {
      conversationCodeOptions = data.code_options.slice();
      conversationCodes = conversationCodeOptions.map((o) => o.id);
    } else if (Array.isArray(data.codes) && data.codes.length) {
      conversationCodes = data.codes.slice();
    }
    if (data.labels && typeof data.labels === "object") {
      Object.entries(data.labels).forEach(([cid, row]) => {
        conversationLabels[cid] = normalizeConversationLabel(row);
      });
    }
  } catch {
    /* ignore */
  }
  ensureConversationCodeOptions();
  refreshAllConversationCodedFlags();
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
  const ready = !!code && dirty;
  confirmBtn.disabled = !canEditBotLabels() || !ready;
  confirmBtn.textContent = savedCode && !dirty ? "Saved" : "Confirm";
  panel.classList.toggle("is-saved", !!savedCode && !dirty);
  panel.classList.toggle("is-dirty", dirty && (!!code || !!rationale || iterative));
}

function messageLabelStatusHtml(code, iterative, updatedBy) {
  if (!code) return `<div class="msg-label-status">Select a label, then Confirm</div>`;
  const bits = [escapeHtml(code)];
  if (iterative) bits.push("iterative");
  return `<div class="msg-label-status">Labeled <strong>${bits.join(" · ")}</strong>${
    updatedBy ? ` · ${escapeHtml(updatedBy)}` : ""
  }</div>`;
}

function messageLabelControlsHtml(convId, m) {
  if (!labelLevelEnabled("message")) return "";
  if (!canEditBotLabels()) return "";
  const role = (m.role || "").toLowerCase();
  const codes = messageCodesForRole(role);
  if (!codes.length) return "";

  const key = messageLabelKey(convId, m.message_number);
  const row = messageLabels[key];
  const savedCode = messageLabelCode(row);
  const savedRationale = messageLabelRationale(row);
  const savedIterative = messageLabelIterative(row);
  const editable = canEditBotLabels();
  const flags = messageFlagsForRole(role);

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

  const iterativeBtn = flags
    .map((flag) => {
      const on = flag === "iterative" ? savedIterative : false;
      return `<button
        type="button"
        class="msg-label-extra ${on ? "active" : ""}"
        data-flag="${escapeHtml(flag)}"
        aria-pressed="${on ? "true" : "false"}"
        title="${escapeHtml(flag)}"
        ${editable ? "" : "disabled"}
      >${escapeHtml(flag)}</button>`;
    })
    .join("");

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
          placeholder="Rationale (optional)…"
          ${editable ? "" : "disabled"}
        >${escapeHtml(savedRationale)}</textarea>
        <button type="button" class="msg-label-confirm" ${editable ? "" : "disabled"}>Confirm</button>
      </div>
      ${messageLabelStatusHtml(savedCode, savedIterative, row && row.updated_by)}
    </div>`;
}

async function saveMessageLabel(convId, messageNumber, role, code, rationale, iterative = false) {
  if (!canEditBotLabels()) {
    alert("Only naacl_label1 or naacl_label2 can edit message labels. Confirm your name at the top right.");
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
    const storageKey = msgLabelsStorageKey();
    const all = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (row.code) all[key] = row;
    else delete all[key];
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  syncConversationCodedFlag(convId);
  // Refresh Coding filter counts for this editor
  refreshCascadingFilters().catch(() => {});
  return row;
}

function conversationLabelSubmitted(convId) {
  const row = conversationLabels[String(convId)] || conversationLabels[convId];
  if (!row) return false;
  const norm = normalizeConversationLabel(row);
  return norm.codes.length > 0 || !!norm.updated_at;
}

function conversationFullyCoded(convId) {
  // Conversation-only labeling: green once conversation labels are submitted.
  if (isConversationOnlyLabelMode()) {
    return conversationLabelSubmitted(convId);
  }
  const required =
    String(selectedId) === String(convId) && currentLabelableMsgIds.length
      ? currentLabelableMsgIds
      : null;
  if (required) {
    return required.every((mid) => {
      const row = messageLabels[messageLabelKey(convId, mid)];
      return !!(row && String(row.code || "").trim());
    });
  }
  const panels = [
    ...detailPane.querySelectorAll(`.msg-label-panel[data-conv="${CSS.escape(String(convId))}"]`),
  ];
  if (panels.length) {
    return panels.every((panel) => {
      const row = messageLabels[messageLabelKey(convId, panel.dataset.msg)];
      return !!(row && String(row.code || "").trim());
    });
  }
  return false;
}

function syncConversationCodedFlag(convId) {
  const item = items.find((c) => String(c.id) === String(convId));
  const coded = conversationFullyCoded(convId);
  if (item) item.is_coded = coded;
  const showSample = canEditBotLabels() && !!item?.is_sample;
  document.querySelectorAll(`[data-id="${CSS.escape(String(convId))}"]`).forEach((el) => {
    el.classList.toggle("sample-coded", showSample && coded);
    el.classList.toggle("sample-uncoded", showSample && !coded);
  });
}

function refreshAllConversationCodedFlags() {
  (items || []).forEach((c) => {
    if (c?.is_sample) syncConversationCodedFlag(c.id);
  });
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
      if (!code) return;

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
    const local = JSON.parse(localStorage.getItem(msgLabelsStorageKey()) || "{}");
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
  currentLabelableMsgIds = (c.messages || [])
    .filter((m) => messageCodesForRole(m.role).length)
    .map((m) => String(m.message_number));

  if (Array.isArray(c.conversation_code_options) && c.conversation_code_options.length) {
    conversationCodeOptions = c.conversation_code_options.slice();
    conversationCodes = conversationCodeOptions.map((o) => o.id);
  } else if (Array.isArray(c.conversation_codes) && c.conversation_codes.length) {
    conversationCodes = c.conversation_codes.slice();
  }
  if (c.conversation_label) conversationLabels[convId] = normalizeConversationLabel(c.conversation_label);

  const convLabelHtml = conversationDefectPanelHtml(convId);

  const disagreedIds = new Set((c.disagreed_messages || []).map(String));
  const disagreementDetails = c.disagreement_details || {};

  const messagesHtml = (c.messages || [])
    .map((m) => {
      const isDisagreed = disagreedIds.has(String(m.message_number));
      return `
      <div class="bubble ${escapeHtml(m.role)} ${m.flagged ? "flagged" : ""} ${
        isDisagreed ? "disagreed" : ""
      }" data-role="${escapeHtml((m.role || "").toLowerCase())}" data-disagreed="${
        isDisagreed ? "1" : "0"
      }">
        <div class="bubble-meta">
          <span class="bubble-role">${escapeHtml(m.role || "unknown")} · #${m.message_number}</span>
          ${isDisagreed ? `<span class="bubble-disagreed">coders disagree</span>` : ""}
          <span class="bubble-time">${escapeHtml(m.datetime || "")}${
            m.time_since ? ` · ${escapeHtml(m.time_since)}` : ""
          }</span>
        </div>
        <div class="bubble-body">${escapeHtml(m.content || "")}</div>
        ${isDisagreed ? disagreementDiffHtml(disagreementDetails[String(m.message_number)]) : ""}
        ${messageLabelControlsHtml(convId, m)}
      </div>`;
    })
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

    ${convLabelHtml}

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
          <button type="button" class="chip-btn" data-msg-filter="disagreed" ${
            disagreedIds.size ? "" : "disabled"
          } title="Messages the two coders coded differently">Disagreed${
            disagreedIds.size ? ` · ${disagreedIds.size}` : ""
          }</button>
        </div>
      </div>
      <div class="thread" id="messageThread">${messagesHtml || "<p>No messages</p>"}</div>
    </div>
  `;

  wirePromptActions(c.system_prompt || "");
  wireMessageRoleFilter();
  wireMessageLabelControls();
  wireConversationLabelControl(convId);
  syncConversationCodedFlag(convId);
}

function normalizeConversationLabel(row) {
  if (!row || typeof row !== "object") return { codes: [], code: "", updated_by: "", updated_at: "" };
  const codes = Array.isArray(row.codes)
    ? row.codes.map((c) => String(c || "").trim()).filter(Boolean)
    : [];
  const single = String(row.code || "").trim();
  if (single && !codes.includes(single)) codes.unshift(single);
  return {
    codes,
    code: codes[0] || "",
    updated_by: row.updated_by || "",
    updated_at: row.updated_at || "",
  };
}

function conversationSelectedCodes(convId) {
  const row = conversationLabels[String(convId)] || conversationLabels[convId];
  return normalizeConversationLabel(row).codes;
}

function conversationDefectPanelHtml(convId) {
  if (!labelLevelEnabled("conversation")) return "";
  ensureConversationCodeOptions();
  const options = conversationCodeOptions.length
    ? conversationCodeOptions
    : FALLBACK_CONVERSATION_CODE_OPTIONS;
  if (!options.length) return "";

  const selected = new Set(conversationSelectedCodes(convId));
  const editable = canEditBotLabels();
  const groups = [];
  const seen = new Map();
  options.forEach((opt) => {
    const primary = opt.primary || "Other";
    if (!seen.has(primary)) {
      seen.set(primary, []);
      groups.push([primary, seen.get(primary)]);
    }
    seen.get(primary).push(opt);
  });

  const groupsHtml = groups
    .map(([primary, opts]) => {
      const chips = opts
        .map((opt) => {
          const id = String(opt.id || "");
          const on = selected.has(id);
          const title = opt.definition || opt.label || id;
          const label = opt.label ? `${id} · ${opt.label}` : id;
          return `<label class="conv-defect-chip ${on ? "is-on" : ""}" title="${escapeHtml(
            title
          )}" data-tip="${escapeHtml(title)}">
            <input type="checkbox" class="conv-defect-check" value="${escapeHtml(id)}" ${
              on ? "checked" : ""
            } ${editable ? "" : "disabled"} />
            <span class="conv-defect-id">${escapeHtml(id)}</span>
            <span class="conv-defect-name">${escapeHtml(opt.label || id)}</span>
          </label>`;
        })
        .join("");
      return `<div class="conv-defect-group">
        <div class="conv-defect-primary">${escapeHtml(primary)}</div>
        <div class="conv-defect-chips">${chips}</div>
      </div>`;
    })
    .join("");

  const selectedList = [...selected];
  const summary = selectedList.length
    ? `Selected: <strong>${escapeHtml(selectedList.join(", "))}</strong>`
    : "No codes selected";
  const hint = editable
    ? "Multi-select · hover a code for its definition · Submit to save"
    : "Enter naacl_label1/2 at top right to edit · hover for definitions";
  const submitted = conversationLabelSubmitted(convId);
  const submitLabel = submitted ? "Saved" : "Submit";
  const submitCls = submitted ? "is-saved" : "";

  const floatCls = convDefectFloat ? " is-floating" : "";
  const floatLabel = convDefectFloat ? "Dock" : "Float";
  return `<section class="section conv-defect-section${floatCls}${
    submitted ? " is-submitted" : ""
  }" id="convDefectSection" data-conv="${escapeHtml(String(convId))}">
    <div class="section-head conv-defect-drag-handle" title="${convDefectFloat ? "Drag to move" : ""}">
      <h3>Conversation labels</h3>
      <div class="conv-defect-head-actions">
        <span class="conv-defect-hint">${hint}</span>
        <button type="button" class="chip-btn conv-defect-float-btn" id="convDefectFloatBtn" title="${
          convDefectFloat ? "Dock panel back into the page" : "Pop out as a floating draggable panel"
        }">${floatLabel}</button>
      </div>
    </div>
    <div class="conv-defect-body">${groupsHtml}</div>
    <div class="conv-defect-footer">
      <div class="conv-defect-summary" id="convDefectSummary">${summary}</div>
      <button type="button" class="conv-defect-submit ${submitCls}" id="convDefectSubmitBtn" ${
        editable ? "" : "disabled"
      }>${submitLabel}</button>
    </div>
    <div class="conv-defect-resize-handles" aria-hidden="true">
      <span class="conv-defect-resize n" data-resize="n"></span>
      <span class="conv-defect-resize s" data-resize="s"></span>
      <span class="conv-defect-resize e" data-resize="e"></span>
      <span class="conv-defect-resize w" data-resize="w"></span>
      <span class="conv-defect-resize ne" data-resize="ne"></span>
      <span class="conv-defect-resize nw" data-resize="nw"></span>
      <span class="conv-defect-resize se" data-resize="se"></span>
      <span class="conv-defect-resize sw" data-resize="sw"></span>
    </div>
  </section>`;
}

async function saveConversationCodes(convId, codes) {
  if (!canEditBotLabels()) {
    alert("Only naacl_label1 or naacl_label2 can edit conversation labels.");
    return null;
  }
  const title =
    document.querySelector(".detail-title")?.textContent?.trim() ||
    items.find((c) => String(c.id) === String(convId))?.title ||
    "";
  const res = await fetch(`/api/conversation-labels/${encodeURIComponent(convId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ codes, editor: labelerName(), title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.detail || "Failed to save conversation labels");
    return null;
  }
  const row = normalizeConversationLabel(await res.json());
  conversationLabels[String(convId)] = row;
  conversationLabels[convId] = row;
  return row;
}



function saveConvDefectFloatPos() {
  if (!convDefectFloatPos) return;
  localStorage.setItem(CONV_DEFECT_FLOAT_POS_KEY, JSON.stringify(convDefectFloatPos));
}

function clampConvDefectFloatBox(box) {
  const minW = 280;
  const minH = 180;
  const maxW = Math.max(minW, window.innerWidth - 16);
  const maxH = Math.max(minH, window.innerHeight - 16);
  let { x, y, w, h } = box;
  w = Math.min(Math.max(minW, Number(w) || minW), maxW);
  h = Math.min(Math.max(minH, Number(h) || minH), maxH);
  x = Math.min(Math.max(8, Number(x) || 8), window.innerWidth - 40);
  y = Math.min(Math.max(8, Number(y) || 8), window.innerHeight - 40);
  if (x + w > window.innerWidth - 8) x = Math.max(8, window.innerWidth - 8 - w);
  if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - 8 - h);
  return { x, y, w, h };
}

function applyConvDefectFloat(section, on) {
  if (!section) return;
  const btn = section.querySelector("#convDefectFloatBtn");
  section.classList.toggle("is-floating", on);
  if (btn) {
    btn.textContent = on ? "Dock" : "Float";
    btn.title = on ? "Dock panel back into the page" : "Pop out as a floating draggable panel";
  }
  const handle = section.querySelector(".conv-defect-drag-handle");
  if (handle) handle.title = on ? "Drag to move · drag edges to resize" : "";

  if (!on) {
    section.style.left = "";
    section.style.top = "";
    section.style.width = "";
    section.style.height = "";
    section.style.maxHeight = "";
    return;
  }

  const rect = section.getBoundingClientRect();
  const defaultW = Math.min(520, Math.max(320, window.innerWidth * 0.42));
  const defaultH = Math.min(window.innerHeight - 24, Math.max(280, rect.height || 420));
  let box = {
    x: convDefectFloatPos?.x ?? Math.max(12, rect.left),
    y: convDefectFloatPos?.y ?? Math.max(12, rect.top),
    w: convDefectFloatPos?.w || defaultW,
    h: convDefectFloatPos?.h || defaultH,
  };
  box = clampConvDefectFloatBox(box);
  convDefectFloatPos = box;
  saveConvDefectFloatPos();
  section.style.left = `${box.x}px`;
  section.style.top = `${box.y}px`;
  section.style.width = `${box.w}px`;
  section.style.height = `${box.h}px`;
  section.style.maxHeight = `${box.h}px`;
}

function wireConvDefectFloat(section) {
  if (!section || section.dataset.floatWired) return;
  section.dataset.floatWired = "1";

  const btn = section.querySelector("#convDefectFloatBtn");
  btn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    convDefectFloat = !convDefectFloat;
    localStorage.setItem(CONV_DEFECT_FLOAT_KEY, convDefectFloat ? "1" : "0");
    if (convDefectFloat && !convDefectFloatPos) {
      const rect = section.getBoundingClientRect();
      convDefectFloatPos = {
        x: Math.max(12, rect.left),
        y: Math.max(12, rect.top),
        w: Math.max(320, rect.width),
        h: Math.max(280, rect.height),
      };
      saveConvDefectFloatPos();
    }
    applyConvDefectFloat(section, convDefectFloat);
  });

  const handle = section.querySelector(".conv-defect-drag-handle");
  handle?.addEventListener("pointerdown", (e) => {
    if (!convDefectFloat || !section.classList.contains("is-floating")) return;
    if (e.target.closest("button, a, input, label, select, textarea")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = section.getBoundingClientRect();
    const origX = rect.left;
    const origY = rect.top;
    section.classList.add("is-dragging");
    handle.setPointerCapture?.(e.pointerId);

    const onMove = (ev) => {
      const x = origX + (ev.clientX - startX);
      const y = origY + (ev.clientY - startY);
      const maxX = window.innerWidth - 80;
      const maxY = window.innerHeight - 40;
      const nx = Math.min(Math.max(8, x), maxX);
      const ny = Math.min(Math.max(8, y), maxY);
      section.style.left = `${nx}px`;
      section.style.top = `${ny}px`;
      const w = convDefectFloatPos?.w || section.offsetWidth;
      const h = convDefectFloatPos?.h || section.offsetHeight;
      convDefectFloatPos = { x: nx, y: ny, w, h };
    };
    const onUp = (ev) => {
      section.classList.remove("is-dragging");
      saveConvDefectFloatPos();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        handle.releasePointerCapture?.(ev.pointerId);
      } catch {}
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  section.querySelectorAll(".conv-defect-resize").forEach((edge) => {
    edge.addEventListener("pointerdown", (e) => {
      if (!convDefectFloat || !section.classList.contains("is-floating")) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = edge.dataset.resize || "";
      const startX = e.clientX;
      const startY = e.clientY;
      const start = section.getBoundingClientRect();
      section.classList.add("is-resizing");
      edge.setPointerCapture?.(e.pointerId);

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let x = start.left;
        let y = start.top;
        let w = start.width;
        let h = start.height;
        if (dir.includes("e")) w = start.width + dx;
        if (dir.includes("s")) h = start.height + dy;
        if (dir.includes("w")) {
          w = start.width - dx;
          x = start.left + dx;
        }
        if (dir.includes("n")) {
          h = start.height - dy;
          y = start.top + dy;
        }
        let box = clampConvDefectFloatBox({ x, y, w, h });
        if (dir.includes("w")) box.x = start.right - box.w;
        if (dir.includes("n")) box.y = start.bottom - box.h;
        box = clampConvDefectFloatBox(box);
        section.style.left = `${box.x}px`;
        section.style.top = `${box.y}px`;
        section.style.width = `${box.w}px`;
        section.style.height = `${box.h}px`;
        section.style.maxHeight = `${box.h}px`;
        convDefectFloatPos = box;
      };
      const onUp = (ev) => {
        section.classList.remove("is-resizing");
        saveConvDefectFloatPos();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        try {
          edge.releasePointerCapture?.(ev.pointerId);
        } catch {}
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });

  if (convDefectFloat) applyConvDefectFloat(section, true);
}


function wireConversationLabelControl(convId) {
  const section = document.getElementById("convDefectSection");
  if (!section) return;
  const summary = document.getElementById("convDefectSummary");
  const submitBtn = document.getElementById("convDefectSubmitBtn");

  const draftCodes = () =>
    [...section.querySelectorAll(".conv-defect-check:checked")].map((el) => el.value);

  const codesEqual = (a, b) => {
    const sa = [...new Set(a || [])].map(String).sort();
    const sb = [...new Set(b || [])].map(String).sort();
    return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
  };

  const syncSubmitBtn = () => {
    if (!submitBtn) return;
    const saved = conversationSelectedCodes(convId);
    const draft = draftCodes();
    const submitted = conversationLabelSubmitted(convId);
    const dirty = !codesEqual(draft, saved);
    section.classList.toggle("is-submitted", submitted && !dirty);
    submitBtn.disabled = !canEditBotLabels() || (!dirty && submitted);
    submitBtn.classList.toggle("is-saved", submitted && !dirty);
    if (!canEditBotLabels()) {
      submitBtn.textContent = "Submit";
    } else if (submitted && !dirty) {
      submitBtn.textContent = "Saved";
    } else {
      submitBtn.textContent = "Submit";
    }
  };

  const syncUi = (codes) => {
    const selected = new Set(codes);
    section.querySelectorAll(".conv-defect-chip").forEach((chip) => {
      const input = chip.querySelector(".conv-defect-check");
      const on = !!(input && selected.has(input.value));
      chip.classList.toggle("is-on", on);
      if (input) input.checked = on;
    });
    if (summary) {
      summary.innerHTML = codes.length
        ? `Selected: <strong>${escapeHtml(codes.join(", "))}</strong>`
        : "No codes selected";
    }
    syncSubmitBtn();
  };

  section.querySelectorAll(".conv-defect-check").forEach((input) => {
    input.addEventListener("change", () => {
      if (!canEditBotLabels()) {
        input.checked = !input.checked;
        alert("Only naacl_label1 or naacl_label2 can edit conversation labels.");
        return;
      }
      syncUi(draftCodes());
    });
  });

  submitBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canEditBotLabels()) {
      alert("Only naacl_label1 or naacl_label2 can edit conversation labels.");
      return;
    }
    const codes = draftCodes();
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    const row = await saveConversationCodes(convId, codes);
    if (!row) {
      syncUi(conversationSelectedCodes(convId));
      return;
    }
    // Ensure submitted state even when codes are empty (reviewed, no defects).
    if (!row.updated_at) row.updated_at = new Date().toISOString();
    conversationLabels[convId] = row;
    syncUi(row.codes || []);
    syncConversationCodedFlag(convId);
  });

  syncSubmitBtn();
  wireConvDefectFloat(section);
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
        (filter === "bot" && (role === "bot" || role === "assistant")) ||
        (filter === "disagreed" && bubble.dataset.disagreed === "1");
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

function disagreementDiffHtml(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return "";
  const iterativeDiffers = new Set(rows.map((r) => !!r.iterative)).size > 1;

  const lines = rows
    .map((row, i) => {
      const side = i === 0 ? "minus" : "plus";
      const marker = i === 0 ? "−" : "+";
      const flags = [];
      if (row.iterative) flags.push("iterative");
      return `
        <div class="diff-line diff-${side}">
          <span class="diff-marker">${marker}</span>
          <span class="diff-editor">${escapeHtml(row.editor || "?")}</span>
          <span class="diff-code">${escapeHtml(row.code || "—")}</span>
          ${
            flags.length
              ? `<span class="diff-flags ${iterativeDiffers ? "differs" : ""}">${flags
                  .map((f) => escapeHtml(f))
                  .join(" · ")}</span>`
              : ""
          }
          ${row.rationale ? `<span class="diff-rationale">${escapeHtml(row.rationale)}</span>` : ""}
        </div>`;
    })
    .join("");

  return `
    <div class="disagreement-diff">
      <div class="diff-head">Coding diff</div>
      ${lines}
    </div>`;
}

function syncShortcutButtons() {
  groupByBotBtn?.classList.toggle("active", groupByBot);
  groupByUserBtn?.classList.toggle("active", groupByUser);
  sortByTimeBtn?.classList.toggle("active", sortByTime);
  needsAttentionBtn?.classList.toggle("danger-active", needsAttention);
  disagreedBtn?.classList.toggle("warn-active", disagreedOnly);
}

function setDisagreedOnly(on) {
  disagreedOnly = on;
  syncShortcutButtons();
  onFilterChanged();
}

function setNeedsAttention(on) {
  needsAttention = on;
  syncShortcutButtons();
  onFilterChanged();
}

function setGroupByBot(on) {
  groupByBot = on;
  syncShortcutButtons();
  renderList();
}

function setGroupByUser(on) {
  groupByUser = on;
  if (groupByUser) sortByTime = false;
  else if (!sortByTime) sortByTime = true;
  syncShortcutButtons();
  renderList();
}

function setSortByTime(on) {
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
disagreedBtn?.addEventListener("click", () => setDisagreedOnly(!disagreedOnly));
syncSheetBtn?.addEventListener("click", () => refreshSpreadsheet({ silent: false }));
groupByBotBtn.addEventListener("click", () => setGroupByBot(!groupByBot));
groupByUserBtn?.addEventListener("click", () => setGroupByUser(!groupByUser));
sortByTimeBtn?.addEventListener("click", () => setSortByTime(!sortByTime));
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
    wireCountSelect("codingSelectWrap");
    wireSplitHandle();
    if (CODEBOOK_UI_ENABLED) wireCodebookSplitHandle();
    wireControlsSplitHandle();
    wireColumnZoom();
    wireLabelerBox();
    applyDetailWidth();
    applyCodebookWidth();
    applyFiltersPanelWidth(false);
    syncShortcutButtons();
    if (itemList) itemList.innerHTML = `<div class="empty">Loading…</div>`;
    await loadCodebookConfig();
    await loadConversationCodeOptions();
    await loadBotLabels();
    await loadFilters();
    await loadList();
    const deepLinkId = new URLSearchParams(window.location.search).get("conv");
    if (deepLinkId) {
      selectedId = deepLinkId;
      await loadDetail(deepLinkId);
    }
    if (CODEBOOK_UI_ENABLED && window.initCodebook) {
      initCodebook("#codebookMount", { onToggle: setCodebookOpen, defaultOpen: true });
      window.addEventListener("codebook-changed", (e) => {
        applyCodebookConfig(e.detail || {});
        if (groupByBot) renderBotMap();
        if (selectedId) loadDetail(selectedId);
      });
    } else {
      setCodebookOpen(false);
    }
    // Show cached data immediately; sync Google Sheet in the background.
    refreshSpreadsheet({ silent: true });
  } catch (err) {
    itemList.innerHTML = `<div class="empty">Failed to load data: ${escapeHtml(err.message)}</div>`;
  }
})();
