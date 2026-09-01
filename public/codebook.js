/** Codebook panel: multi-book store with Field multi-select. */
(function () {
  const SAVE_DELAY_MS = 700;
  const FIELD_SHORT = {
    user_message: "User",
    bot_message: "Bot",
    per_conversation: "Conv",
    per_bot: "Per Bot",
  };

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

  function fieldOptions() {
    return book?.field_options || [
      { key: "user_message", label: "User Message" },
      { key: "bot_message", label: "Bot Message" },
      { key: "per_conversation", label: "Per Conversation" },
      { key: "per_bot", label: "Per Bot" },
    ];
  }

  function fieldLabel(key) {
    const opt = fieldOptions().find((f) => f.key === key);
    return opt?.label || FIELD_SHORT[key] || key;
  }

  function entryKey(entry) {
    if (entry?.id) return String(entry.id);
    const fields = (entry?.fields || []).join("|");
    return `${fields}:${entry?.code || ""}`;
  }

  function findEntry(key) {
    return (book?.entries || []).find((e) => entryKey(e) === key);
  }

  function newEntryId() {
    return `e${Math.random().toString(36).slice(2, 10)}`;
  }

  function sectionHeading(entry) {
    const fields = (entry.fields || []).map((f) => fieldLabel(f)).join(", ") || "—";
    const code = entry.code || "";
    if (entry.is_flag) return `[FLAG · ${fields}] ${code}`;
    return `[${fields}] ${code}`;
  }

  function sectionBody(entry) {
    const lines = [entry.description || ""];
    if (entry.examples?.length) {
      lines.push("Examples:");
      entry.examples.forEach((ex) => lines.push(`  - ${ex}`));
    }
    if (entry.not_this) lines.push(`Not this: ${entry.not_this}`);
    return lines.join("\n").trim();
  }

  function buildSystemPrompt() {
    const parts = [(book?.preamble || "").trim(), ""];
    (book?.entries || []).forEach((entry) => {
      parts.push(sectionHeading(entry));
      parts.push(sectionBody(entry));
      parts.push("");
    });
    parts.push((book?.footer || "").trim());
    return `${parts.join("\n").trim()}\n`;
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
        // Re-render headings that may have changed (fields/code), keep focus if possible.
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
    const label = row.querySelector('[data-field="label"]');
    const desc = row.querySelector('[data-field="description"]');
    const examples = row.querySelector('[data-field="examples"]');
    const notThis = row.querySelector('[data-field="not_this"]');
    if (code && document.activeElement !== code) code.textContent = entry.code || "";
    if (label && document.activeElement !== label) label.textContent = entry.label || entry.code;
    if (desc && document.activeElement !== desc) desc.textContent = entry.description || "";
    if (examples && document.activeElement !== examples) {
      examples.textContent = (entry.examples || []).join("\n");
    }
    if (notThis && document.activeElement !== notThis) notThis.textContent = entry.not_this || "";
    row.querySelectorAll(".codebook-field-chip").forEach((chip) => {
      const on = (entry.fields || []).includes(chip.dataset.fieldKey);
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
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
      entry.code = String(value || "").trim();
      if (!entry.label || entry.label === entry.code) {
        /* keep label in sync only when empty */
      }
    } else {
      entry[field] = String(value || "").trim();
    }
    syncPromptSection(key);
    scheduleSave();
  }

  function toggleField(key, fieldKey) {
    const entry = findEntry(key);
    if (!entry) return;
    const set = new Set(entry.fields || []);
    if (set.has(fieldKey)) set.delete(fieldKey);
    else set.add(fieldKey);
    const order = fieldOptions().map((f) => f.key);
    entry.fields = order.filter((k) => set.has(k));
    syncTableRow(key);
    syncPromptSection(key);
    scheduleSave();
  }

  function applyPromptEdit(key, text) {
    const entry = findEntry(key);
    if (!entry) return;
    const parsed = parseSectionBody(text);
    entry.description = parsed.description;
    entry.examples = parsed.examples;
    entry.not_this = parsed.not_this;
    syncTableRow(key);
    scheduleSave();
  }

  function parseSectionBody(text) {
    const lines = String(text || "").split("\n");
    const description = [];
    const examples = [];
    let not_this = "";
    let mode = "description";
    for (const line of lines) {
      const stripped = line.trim();
      if (stripped.toLowerCase() === "examples:") {
        mode = "examples";
        continue;
      }
      if (stripped.toLowerCase().startsWith("not this:")) {
        not_this = stripped.slice(9).trim();
        mode = "not_this";
        continue;
      }
      if (mode === "description") description.push(line);
      else if (mode === "examples") {
        if (stripped.startsWith("- ")) examples.push(stripped.slice(2).trim());
        else if (stripped) examples.push(stripped);
      }
    }
    return {
      description: description.join("\n").trim(),
      examples,
      not_this,
    };
  }

  function fieldsCellHtml(entry) {
    const selected = new Set(entry.fields || []);
    const chips = fieldOptions()
      .map((opt) => {
        const on = selected.has(opt.key);
        const short = FIELD_SHORT[opt.key] || opt.label;
        return `<button type="button" class="codebook-field-chip${on ? " on" : ""}" data-field-key="${escapeHtml(opt.key)}" title="${escapeHtml(opt.label)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(short)}</button>`;
      })
      .join("");
    return `<div class="codebook-fields">${chips}</div>`;
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

  function tableHtml() {
    const rows = (book.entries || [])
      .map((entry) => {
        const key = entryKey(entry);
        const flag = entry.is_flag ? `<span class="codebook-flag">flag</span>` : "";
        return `
          <tr data-code-key="${escapeHtml(key)}">
            <td class="codebook-fields-cell">${fieldsCellHtml(entry)}</td>
            <td class="codebook-code">
              <div class="codebook-editable" contenteditable="true" data-field="code" spellcheck="false">${escapeHtml(entry.code || "")}</div>
              ${flag}
            </td>
            <td class="codebook-label">
              <div class="codebook-editable" contenteditable="true" data-field="label" spellcheck="true">${escapeHtml(entry.label || entry.code || "")}</div>
            </td>
            <td class="codebook-desc">
              <div class="codebook-editable" contenteditable="true" data-field="description" spellcheck="true">${escapeHtml(entry.description || "")}</div>
              <div class="codebook-field-label">Examples (one per line)</div>
              <div class="codebook-editable codebook-editable-examples" contenteditable="true" data-field="examples" spellcheck="true">${escapeHtml((entry.examples || []).join("\n"))}</div>
              <div class="codebook-field-label">Not this</div>
              <div class="codebook-editable" contenteditable="true" data-field="not_this" spellcheck="true">${escapeHtml(entry.not_this || "")}</div>
            </td>
          </tr>`;
      })
      .join("");

    return `
      <section class="codebook-pane codebook-pane-table">
        <header class="codebook-pane-head">Table view</header>
        <div class="codebook-table-wrap">
          <table class="codebook-table">
            <colgroup>
              <col class="col-fields" />
              <col class="col-code" />
              <col class="col-label" />
              <col class="col-def" />
            </colgroup>
            <thead>
              <tr>
                <th>Field</th>
                <th>Code</th>
                <th>Label</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
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
      const entry = {
        id: newEntryId(),
        fields: ["user_message"],
        code: "",
        label: "",
        description: "",
        examples: [],
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

    tableScroll?.addEventListener(
      "scroll",
      () => syncScroll(tableScroll, promptScroll),
      { passive: true }
    );
    promptScroll?.addEventListener(
      "scroll",
      () => syncScroll(promptScroll, tableScroll),
      { passive: true }
    );

    body.querySelectorAll("tr[data-code-key], .codebook-prompt-section[data-code-key]").forEach((el) => {
      const key = el.dataset.codeKey;
      el.addEventListener("mouseenter", () => setLinked(key, false));
      el.addEventListener("mouseleave", clearHoverLinked);
      el.addEventListener("mousedown", (e) => {
        if (e.target.closest(".codebook-editable, .codebook-field-chip, button, input, select")) return;
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

    body.querySelectorAll("tr[data-code-key] .codebook-field-chip").forEach((chip) => {
      const row = chip.closest("tr");
      const key = row?.dataset.codeKey;
      const fieldKey = chip.dataset.fieldKey;
      if (!key || !fieldKey) return;
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleField(key, fieldKey);
        setLinked(key, true);
      });
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
