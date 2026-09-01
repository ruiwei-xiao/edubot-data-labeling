/** Codebook panel: spreadsheet-style Aspect / Code / Definition columns. */
(function () {
  const SAVE_DELAY_MS = 700;
  const ASPECT_ORDER = ["user_message", "bot_message", "per_conversation", "per_bot"];

  let book = null;
  let open = false;
  let pressKey = null;
  let saveTimer = null;
  let onToggle = null;
  let wired = false;

  let fontScale = Number(localStorage.getItem("playlab_codebook_font_scale")) || 1;

  const root = document.createElement("div");
  root.id = "codebookRoot";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "codebook-trigger chip-btn";
  trigger.id = "codebookOpenBtn";
  trigger.title = "Show labeling codebook beside conversation";
  trigger.textContent = "Codebook";

  root.appendChild(trigger);

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function aspectOptions() {
    return book?.aspect_options || book?.field_options || [
      { key: "user_message", label: "User Message" },
      { key: "bot_message", label: "Bot Message" },
      { key: "per_conversation", label: "Per Conversation" },
      { key: "per_bot", label: "Per Bot" },
    ];
  }

  function aspectLabel(key) {
    const opt = aspectOptions().find((f) => f.key === key);
    return opt?.label || key;
  }

  function entryAspect(entry) {
    return entry?.aspect || (entry?.fields && entry.fields[0]) || "user_message";
  }

  function entryKey(entry) {
    if (entry?.id) return String(entry.id);
    return `${entryAspect(entry)}:${entry?.code || ""}`;
  }

  function findEntry(key) {
    return (book?.entries || []).find((e) => entryKey(e) === key);
  }

  function newEntryId() {
    return `e${Math.random().toString(36).slice(2, 10)}`;
  }

  function displayCode(entry) {
    return entry.label || entry.code || "";
  }

  function sectionHeading(entry) {
    const aspect = aspectLabel(entryAspect(entry));
    const code = entry.code || "";
    const secondary = (entry.secondary_code || "").trim();
    if (entry.is_flag) return `[FLAG · ${aspect}] ${code}`;
    let heading = `[${aspect}] ${code}`;
    if (secondary) heading += ` (secondary: ${secondary})`;
    return heading;
  }

  function sectionBody(entry) {
    const lines = [entry.description || ""];
    if (entry.examples?.length) {
      lines.push("Example (code it):");
      entry.examples.forEach((ex) => lines.push(`  - ${ex}`));
    }
    const boundary = (entry.boundary_rule || entry.not_this || "").trim();
    if (boundary) lines.push(`Boundary rule (do not code it): ${boundary}`);
    return lines.join("\n").trim();
  }

  function buildSystemPrompt() {
    const parts = [(book?.preamble || "").trim(), ""];
    groupedEntries().forEach(({ entries }) => {
      entries.forEach((entry) => {
        parts.push(sectionHeading(entry));
        parts.push(sectionBody(entry));
        parts.push("");
      });
    });
    parts.push((book?.footer || "").trim());
    return `${parts.join("\n").trim()}\n`;
  }

  function groupedEntries() {
    const order = aspectOptions().map((f) => f.key);
    const groups = new Map();
    (book?.entries || []).forEach((entry) => {
      const aspect = entryAspect(entry);
      if (!groups.has(aspect)) groups.set(aspect, []);
      groups.get(aspect).push(entry);
    });
    const result = [];
    order.forEach((aspect) => {
      const entries = groups.get(aspect);
      if (entries?.length) result.push({ aspect, entries });
      groups.delete(aspect);
    });
    groups.forEach((entries, aspect) => {
      if (entries.length) result.push({ aspect, entries });
    });
    return result;
  }

  function notifyChanged() {
    if (!book) return;
    window.dispatchEvent(new CustomEvent("codebook-changed", { detail: book }));
  }

  function applyResponse(data) {
    book = data;
    notifyChanged();
  }

  function setSaveStatus(text, kind = "") {
    const el = document.getElementById("codebookSaveStatus");
    if (!el) return;
    el.textContent = text;
    el.className = `codebook-save-status${kind ? ` is-${kind}` : ""}`;
  }

  function applyFontScale() {
    fontScale = Math.min(1.6, Math.max(0.7, fontScale));
    localStorage.setItem("playlab_codebook_font_scale", String(fontScale));
    const split = document.querySelector("#codebookBody .codebook-split");
    if (split) split.style.setProperty("--codebook-font-scale", String(fontScale));
    const label = document.getElementById("codebookZoomLabel");
    if (label) label.textContent = `${Math.round(fontScale * 100)}%`;
  }

  function nudgeFontScale(delta) {
    fontScale = Math.round((fontScale + delta) * 20) / 20;
    applyFontScale();
  }

  function mountTrigger(container) {
    if (!container || document.getElementById("codebookOpenBtn")) return;
    container.appendChild(root);
    wire();
  }

  function setOpen(next) {
    open = next;
    trigger.classList.toggle("active", open);
    onToggle?.(open);
    if (open) {
      loadAndRender();
    } else {
      clearLinked();
    }
  }

  function toggleOpen() {
    setOpen(!open);
  }

  async function fetchBook() {
    const res = await fetch("/api/codebook");
    if (!res.ok) throw new Error("Failed to load codebook");
    applyResponse(await res.json());
  }

  async function saveBook() {
    if (!book) return;
    setSaveStatus("Saving…");
    const activeName =
      book.active?.name ||
      book.codebooks?.find((b) => b.id === book.active_id)?.name ||
      "";
    const res = await fetch("/api/codebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: activeName,
        entries: book.entries,
        preamble: book.preamble,
        footer: book.footer,
      }),
    });
    if (!res.ok) throw new Error("Failed to save codebook");
    applyResponse(await res.json());
    setSaveStatus("Saved", "ok");
    syncBookToolbar();
  }

  function scheduleSave() {
    setSaveStatus("Unsaved changes…", "pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveBook();
        refreshPromptHeadings();
      } catch (err) {
        setSaveStatus(err.message || "Save failed", "err");
      }
    }, SAVE_DELAY_MS);
  }

  function refreshPromptHeadings() {
    document.querySelectorAll("#codebookBody .codebook-prompt-section").forEach((sec) => {
      const key = sec.dataset.codeKey;
      const entry = findEntry(key);
      const heading = sec.querySelector(".codebook-section-heading");
      if (entry && heading && document.activeElement !== heading) {
        heading.textContent = sectionHeading(entry);
      }
    });
  }

  function clearLinked() {
    pressKey = null;
    document.querySelectorAll(".codebook-linked").forEach((el) => el.classList.remove("codebook-linked"));
    document.querySelectorAll(".codebook-pressed").forEach((el) => el.classList.remove("codebook-pressed"));
  }

  function setLinked(key, pressed = false) {
    if (pressed) pressKey = key;
    document.querySelectorAll("#codebookBody [data-code-key]").forEach((el) => {
      const on = el.dataset.codeKey === key;
      el.classList.toggle("codebook-linked", on);
      el.classList.toggle("codebook-pressed", on && pressed);
    });
  }

  function clearHoverLinked() {
    if (pressKey) return;
    document.querySelectorAll(".codebook-linked").forEach((el) => el.classList.remove("codebook-linked"));
  }

  function syncPromptSection(key) {
    const entry = findEntry(key);
    const section = document.querySelector(
      `#codebookBody .codebook-prompt-section[data-code-key="${CSS.escape(key)}"] .codebook-section-body`
    );
    const heading = document.querySelector(
      `#codebookBody .codebook-prompt-section[data-code-key="${CSS.escape(key)}"] .codebook-section-heading`
    );
    if (!entry) return;
    if (heading && document.activeElement !== heading) heading.textContent = sectionHeading(entry);
    if (section && !section.matches(":focus")) section.textContent = sectionBody(entry);
  }

  function syncTableRow(key) {
    const entry = findEntry(key);
    const row = document.querySelector(`#codebookBody tr[data-code-key="${CSS.escape(key)}"]`);
    if (!entry || !row) return;
    const code = row.querySelector('[data-field="code"]');
    const desc = row.querySelector('[data-field="description"]');
    const secondary = row.querySelector('[data-field="secondary_code"]');
    const examples = row.querySelector('[data-field="examples"]');
    const boundary = row.querySelector('[data-field="boundary_rule"]');
    if (code && document.activeElement !== code) code.textContent = displayCode(entry);
    if (desc && document.activeElement !== desc) desc.textContent = entry.description || "";
    if (secondary && document.activeElement !== secondary) secondary.textContent = entry.secondary_code || "";
    if (examples && document.activeElement !== examples) {
      examples.textContent = (entry.examples || []).join("\n");
    }
    if (boundary && document.activeElement !== boundary) {
      boundary.textContent = entry.boundary_rule || entry.not_this || "";
    }
  }

  function applyTableEdit(key, field, value) {
    const entry = findEntry(key);
    if (!entry) return;
    if (field === "examples") {
      entry.examples = String(value || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field === "code") {
      const next = String(value || "").trim();
      entry.code = next;
      entry.label = next;
    } else if (field === "boundary_rule") {
      const next = String(value || "").trim();
      entry.boundary_rule = next;
      entry.not_this = next;
    } else {
      entry[field] = String(value || "").trim();
    }
    syncPromptSection(key);
    scheduleSave();
  }

  function setGroupAspect(aspect, entryKeys) {
    entryKeys.forEach((key) => {
      const entry = findEntry(key);
      if (!entry) return;
      entry.aspect = aspect;
      entry.fields = [aspect];
    });
    renderBody();
    scheduleSave();
  }

  function applyPromptEdit(key, text) {
    const entry = findEntry(key);
    if (!entry) return;
    const parsed = parseSectionBody(text);
    entry.description = parsed.description;
    entry.examples = parsed.examples;
    entry.boundary_rule = parsed.boundary_rule;
    entry.not_this = parsed.not_this;
    syncTableRow(key);
    scheduleSave();
  }

  function parseSectionBody(text) {
    const lines = String(text || "").split("\n");
    const description = [];
    const examples = [];
    let boundary_rule = "";
    let mode = "description";
    for (const line of lines) {
      const stripped = line.trim();
      const lower = stripped.toLowerCase();
      if (lower === "examples:" || lower === "example (code it):") {
        mode = "examples";
        continue;
      }
      if (lower.startsWith("not this:")) {
        boundary_rule = stripped.slice(9).trim();
        mode = "boundary";
        continue;
      }
      if (lower.startsWith("boundary rule")) {
        boundary_rule = stripped.includes(":") ? stripped.slice(stripped.indexOf(":") + 1).trim() : stripped;
        mode = "boundary";
        continue;
      }
      if (mode === "description") description.push(line);
      else if (mode === "examples") {
        if (stripped.startsWith("- ")) examples.push(stripped.slice(2).trim());
        else if (stripped) examples.push(stripped);
      }
    }
    return { description: description.join("\n").trim(), examples, boundary_rule, not_this: boundary_rule };
  }

  function aspectSelectHtml(aspect, entryKeys) {
    const options = aspectOptions()
      .map(
        (opt) =>
          `<option value="${escapeHtml(opt.key)}"${opt.key === aspect ? " selected" : ""}>${escapeHtml(opt.label)}</option>`
      )
      .join("");
    return `<select class="codebook-aspect-select" data-aspect-keys="${escapeHtml(entryKeys.join(","))}" aria-label="Aspect">${options}</select>`;
  }

  function toolbarHtml() {
    const books = book.codebooks || [];
    const activeId = book.active_id;
    const activeName =
      book.active?.name || books.find((b) => b.id === activeId)?.name || "Untitled";
    const options = books
      .map(
        (b) =>
          `<option value="${escapeHtml(b.id)}"${b.id === activeId ? " selected" : ""}>${escapeHtml(b.name)}</option>`
      )
      .join("");
    const canDelete = books.length > 1;
    return `
      <div class="codebook-toolbar">
        <label class="codebook-toolbar-label">
          <select id="codebookSelect" class="codebook-select" aria-label="Active codebook" title="Switch codebook">${options}</select>
        </label>
        <button type="button" class="chip-btn" id="codebookNewBtn" title="Create a new codebook">New</button>
        <input type="text" class="codebook-name-input" id="codebookNameInput" value="${escapeHtml(activeName)}" title="Rename active codebook" aria-label="Codebook name" />
        ${canDelete ? `<button type="button" class="chip-btn codebook-delete-btn" id="codebookDeleteBtn" title="Delete active codebook">Delete</button>` : ""}
        <button type="button" class="chip-btn" id="codebookAddRowBtn" title="Append a new empty entry">Add row</button>
      </div>`;
  }

  function tableRowsHtml() {
    const groups = groupedEntries();
    const parts = [];
    groups.forEach((group, gi) => {
      const entryKeys = group.entries.map((e) => entryKey(e));
      group.entries.forEach((entry, idx) => {
        const key = entryKey(entry);
        const flag = entry.is_flag ? `<span class="codebook-flag">flag</span>` : "";
        const aspectCell =
          idx === 0
            ? `<td class="codebook-aspect-cell" rowspan="${group.entries.length}">${aspectSelectHtml(group.aspect, entryKeys)}</td>`
            : "";
        parts.push(`
          <tr data-code-key="${escapeHtml(key)}" class="codebook-data-row">
            ${aspectCell}
            <td class="codebook-code">
              <div class="codebook-editable codebook-code-value" contenteditable="true" data-field="code" spellcheck="false">${escapeHtml(displayCode(entry))}</div>
              ${flag}
            </td>
            <td class="codebook-def-cell">
              <div class="codebook-editable" contenteditable="true" data-field="description" spellcheck="true">${escapeHtml(entry.description || "")}</div>
            </td>
            <td class="codebook-secondary-cell">
              <div class="codebook-editable" contenteditable="true" data-field="secondary_code" spellcheck="true">${escapeHtml(entry.secondary_code || "")}</div>
            </td>
            <td class="codebook-example-cell">
              <div class="codebook-editable codebook-editable-examples" contenteditable="true" data-field="examples" spellcheck="true">${escapeHtml((entry.examples || []).join("\n"))}</div>
            </td>
            <td class="codebook-boundary-cell">
              <div class="codebook-editable" contenteditable="true" data-field="boundary_rule" spellcheck="true">${escapeHtml(entry.boundary_rule || entry.not_this || "")}</div>
            </td>
          </tr>`);
      });
      if (gi < groups.length - 1) {
        parts.push(`<tr class="codebook-separator-row" aria-hidden="true"><td colspan="6"></td></tr>`);
      }
    });
    return parts.join("");
  }

  function tableHtml() {
    return `
      <section class="codebook-pane codebook-pane-table">
        <header class="codebook-pane-head">Table view</header>
        <div class="codebook-table-wrap">
          <table class="codebook-table codebook-sheet-table">
            <colgroup>
              <col class="col-aspect" />
              <col class="col-code" />
              <col class="col-definition" />
              <col class="col-secondary" />
              <col class="col-example" />
              <col class="col-boundary" />
            </colgroup>
            <thead>
              <tr>
                <th title="Aspect">Aspect</th>
                <th title="Code">Code</th>
                <th title="Definition">Definition</th>
                <th title="Secondary Code">Secondary</th>
                <th title="Example (code it)">Example</th>
                <th title="Boundary rule (do not code it)">Boundary</th>
              </tr>
            </thead>
            <tbody>${tableRowsHtml()}</tbody>
          </table>
        </div>
      </section>`;
  }

  function promptHtml() {
    const sections = (book.entries || [])
      .map((entry) => {
        const key = entryKey(entry);
        return `
          <article class="codebook-prompt-section" data-code-key="${escapeHtml(key)}">
            <div class="codebook-section-heading">${escapeHtml(sectionHeading(entry))}</div>
            <div class="codebook-editable codebook-section-body" contenteditable="true" spellcheck="true">${escapeHtml(sectionBody(entry))}</div>
          </article>`;
      })
      .join("");

    return `
      <section class="codebook-pane codebook-pane-prompt">
        <header class="codebook-pane-head">System prompt</header>
        <div class="codebook-prompt-scroll">
          <div class="codebook-prompt-block" data-part="preamble">
            <div class="codebook-field-label">Preamble</div>
            <div class="codebook-editable codebook-preamble" contenteditable="true" spellcheck="true">${escapeHtml(book.preamble || "")}</div>
          </div>
          ${sections}
          <div class="codebook-prompt-block" data-part="footer">
            <div class="codebook-field-label">Footer</div>
            <div class="codebook-editable codebook-footer" contenteditable="true" spellcheck="true">${escapeHtml(book.footer || "")}</div>
          </div>
        </div>
      </section>`;
  }

  function syncBookToolbar() {
    const select = document.getElementById("codebookSelect");
    const nameInput = document.getElementById("codebookNameInput");
    if (!book) return;
    if (select) {
      const books = book.codebooks || [];
      select.innerHTML = books
        .map(
          (b) =>
            `<option value="${escapeHtml(b.id)}"${b.id === book.active_id ? " selected" : ""}>${escapeHtml(b.name)}</option>`
        )
        .join("");
    }
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value =
        book.active?.name ||
        book.codebooks?.find((b) => b.id === book.active_id)?.name ||
        "";
    }
    const title = document.getElementById("codebookTitle");
    if (title) {
      const name =
        book.active?.name ||
        book.codebooks?.find((b) => b.id === book.active_id)?.name ||
        "Codebook";
      title.textContent = name;
    }
  }

  function renderBody() {
    const body = document.getElementById("codebookBody");
    if (!body || !book) return;
    body.innerHTML = `<div class="codebook-body-inner">${toolbarHtml()}<div class="codebook-split">${tableHtml()}${promptHtml()}</div></div>`;
    applyFontScale();
    syncBookToolbar();
    wirePaneInteractions(body);
    wireToolbar(body);
  }

  function wireToolbar(body) {
    body.querySelector("#codebookSelect")?.addEventListener("change", async (e) => {
      const id = e.target.value;
      if (!id || id === book.active_id) return;
      try {
        setSaveStatus("Switching…");
        const res = await fetch("/api/codebook/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error("Failed to activate codebook");
        applyResponse(await res.json());
        renderBody();
        setSaveStatus("");
      } catch (err) {
        setSaveStatus(err.message || "Switch failed", "err");
        syncBookToolbar();
      }
    });

    body.querySelector("#codebookNewBtn")?.addEventListener("click", async () => {
      const name = window.prompt("Name for the new codebook:", "New codebook");
      if (name === null) return;
      const copy = window.confirm("Copy entries from the current codebook?");
      try {
        setSaveStatus("Creating…");
        const res = await fetch("/api/codebook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() || "New codebook", copy_active: copy }),
        });
        if (!res.ok) throw new Error("Failed to create codebook");
        applyResponse(await res.json());
        renderBody();
        setSaveStatus("");
      } catch (err) {
        setSaveStatus(err.message || "Create failed", "err");
      }
    });

    const nameInput = body.querySelector("#codebookNameInput");
    nameInput?.addEventListener("change", () => {
      const next = nameInput.value.trim() || "Untitled";
      nameInput.value = next;
      if (book.active) book.active.name = next;
      if (book.codebooks) {
        const meta = book.codebooks.find((b) => b.id === book.active_id);
        if (meta) meta.name = next;
      }
      const title = document.getElementById("codebookTitle");
      if (title) title.textContent = next;
      const sel = body.querySelector("#codebookSelect option:checked");
      if (sel) sel.textContent = next;
      scheduleSave();
    });

    body.querySelector("#codebookDeleteBtn")?.addEventListener("click", async () => {
      if ((book.codebooks || []).length <= 1) return;
      const name =
        book.active?.name ||
        book.codebooks?.find((b) => b.id === book.active_id)?.name ||
        "this codebook";
      if (!window.confirm(`Delete codebook “${name}”? This cannot be undone.`)) return;
      try {
        setSaveStatus("Deleting…");
        const res = await fetch(`/api/codebook/${encodeURIComponent(book.active_id)}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("Failed to delete codebook");
        applyResponse(await res.json());
        renderBody();
        setSaveStatus("");
      } catch (err) {
        setSaveStatus(err.message || "Delete failed", "err");
      }
    });

    body.querySelector("#codebookAddRowBtn")?.addEventListener("click", () => {
      if (!book.entries) book.entries = [];
      const last = book.entries[book.entries.length - 1];
      const aspect = last ? entryAspect(last) : "user_message";
      const entry = {
        id: newEntryId(),
        aspect,
        fields: [aspect],
        code: "",
        label: "",
        description: "",
        secondary_code: "",
        examples: [],
        boundary_rule: "",
        not_this: "",
      };
      book.entries.push(entry);
      renderBody();
      scheduleSave();
      const row = document.querySelector(
        `#codebookBody tr[data-code-key="${CSS.escape(entryKey(entry))}"] [data-field="code"]`
      );
      row?.focus();
    });
  }

  function wirePaneInteractions(body) {
    const tableScroll = body.querySelector(".codebook-table-wrap");
    const promptScroll = body.querySelector(".codebook-prompt-scroll");
    let syncingScroll = false;

    const syncScroll = (source, target) => {
      if (!source || !target || syncingScroll) return;
      const sourceMax = source.scrollHeight - source.clientHeight;
      const targetMax = target.scrollHeight - target.clientHeight;
      if (sourceMax <= 0 || targetMax <= 0) return;
      syncingScroll = true;
      target.scrollTop = (source.scrollTop / sourceMax) * targetMax;
      requestAnimationFrame(() => {
        syncingScroll = false;
      });
    };

    tableScroll?.addEventListener("scroll", () => syncScroll(tableScroll, promptScroll), { passive: true });
    promptScroll?.addEventListener("scroll", () => syncScroll(promptScroll, tableScroll), { passive: true });

    body.querySelectorAll("tr[data-code-key], .codebook-prompt-section[data-code-key]").forEach((el) => {
      const key = el.dataset.codeKey;
      el.addEventListener("mouseenter", () => setLinked(key, false));
      el.addEventListener("mouseleave", clearHoverLinked);
      el.addEventListener("mousedown", (e) => {
        if (e.target.closest(".codebook-editable, .codebook-aspect-select, button, input, select")) return;
        setLinked(key, true);
        const peer =
          el.tagName === "TR"
            ? body.querySelector(`.codebook-prompt-section[data-code-key="${CSS.escape(key)}"]`)
            : body.querySelector(`tr[data-code-key="${CSS.escape(key)}"]`);
        if (el.tagName === "TR" && peer && promptScroll) {
          const offset =
            peer.offsetTop - (promptScroll.querySelector(".codebook-prompt-block")?.offsetHeight || 0);
          syncingScroll = true;
          promptScroll.scrollTop = Math.max(0, offset - 8);
          requestAnimationFrame(() => {
            syncingScroll = false;
          });
        } else if (peer && tableScroll) {
          syncingScroll = true;
          peer.scrollIntoView({ block: "nearest", behavior: "auto" });
          requestAnimationFrame(() => {
            syncingScroll = false;
          });
        }
      });
    });

    body.querySelectorAll(".codebook-aspect-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        e.stopPropagation();
        const keys = (sel.dataset.aspectKeys || "").split(",").filter(Boolean);
        setGroupAspect(sel.value, keys);
      });
      sel.addEventListener("mousedown", (e) => e.stopPropagation());
    });

    body.querySelectorAll("tr[data-code-key] .codebook-editable").forEach((el) => {
      const row = el.closest("tr");
      const key = row?.dataset.codeKey;
      const field = el.dataset.field;
      if (!key || !field) return;
      el.addEventListener("input", () => applyTableEdit(key, field, el.textContent));
      el.addEventListener("focus", () => setLinked(key, true));
    });

    body.querySelectorAll(".codebook-prompt-section .codebook-section-body").forEach((el) => {
      const key = el.closest(".codebook-prompt-section")?.dataset.codeKey;
      if (!key) return;
      el.addEventListener("input", () => applyPromptEdit(key, el.textContent));
      el.addEventListener("focus", () => setLinked(key, true));
    });

    body.querySelector(".codebook-preamble")?.addEventListener("input", (e) => {
      book.preamble = e.target.textContent.trim();
      scheduleSave();
    });
    body.querySelector(".codebook-footer")?.addEventListener("input", (e) => {
      book.footer = e.target.textContent.trim();
      scheduleSave();
    });
  }

  async function loadAndRender() {
    const body = document.getElementById("codebookBody");
    if (!body) return;
    try {
      await fetchBook();
      renderBody();
      setSaveStatus("");
    } catch (err) {
      body.innerHTML = `<div class="empty">Failed to load codebook: ${escapeHtml(err.message)}</div>`;
    }
  }

  function wire() {
    if (wired) return;
    wired = true;
    trigger.addEventListener("click", toggleOpen);
    document.getElementById("codebookCloseBtn")?.addEventListener("click", () => setOpen(false));
    document.getElementById("codebookZoomOut")?.addEventListener("click", () => nudgeFontScale(-0.1));
    document.getElementById("codebookZoomIn")?.addEventListener("click", () => nudgeFontScale(0.1));
    document.getElementById("codebookZoomReset")?.addEventListener("click", () => {
      fontScale = 1;
      applyFontScale();
    });
    document.getElementById("codebookPane")?.addEventListener(
      "wheel",
      (e) => {
        if (!open || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        nudgeFontScale(e.deltaY < 0 ? 0.05 : -0.05);
      },
      { passive: false }
    );
    document.getElementById("codebookCopyBtn")?.addEventListener("click", async () => {
      if (!book) return;
      try {
        await navigator.clipboard.writeText(buildSystemPrompt());
        const btn = document.getElementById("codebookCopyBtn");
        if (btn) {
          const prev = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = prev;
          }, 1200);
        }
      } catch {
        /* ignore */
      }
    });
    document.addEventListener("mouseup", () => {
      pressKey = null;
      document.querySelectorAll(".codebook-pressed").forEach((el) => el.classList.remove("codebook-pressed"));
    });
  }

  window.initCodebook = function initCodebook(containerSelector, options = {}) {
    onToggle = options.onToggle || null;
    const container =
      (containerSelector && document.querySelector(containerSelector)) ||
      document.querySelector(".labeler-box") ||
      document.querySelector(".topbar-row-primary");
    mountTrigger(container);
    if (options.defaultOpen) setOpen(true);
  };
})();
