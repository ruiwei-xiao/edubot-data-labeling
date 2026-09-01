/** Codebook panel: right column beside conversation detail. */
(function () {
  const ROLE_LABELS = { user: "User prompt", bot: "Bot reply" };
  const SAVE_DELAY_MS = 700;

  let book = null;
  let open = false;
  let pressKey = null;
  let saveTimer = null;
  let onToggle = null;

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

  function entryKey(entry) {
    return `${entry.role}:${entry.code}`;
  }

  function findEntry(key) {
    return (book?.entries || []).find((e) => entryKey(e) === key);
  }

  function sectionHeading(entry) {
    const role = entry.role.toUpperCase();
    return entry.is_flag ? `[${role} FLAG] ${entry.code}` : `[${role}] ${entry.code}`;
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
    const parts = [(book.preamble || "").trim(), ""];
    (book.entries || []).forEach((entry) => {
      parts.push(sectionHeading(entry));
      parts.push(sectionBody(entry));
      parts.push("");
    });
    parts.push((book.footer || "").trim());
    return `${parts.join("\n").trim()}\n`;
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
    book = await res.json();
  }

  async function saveBook() {
    if (!book) return;
    setSaveStatus("Saving…");
    const res = await fetch("/api/codebook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: book.entries,
        preamble: book.preamble,
        footer: book.footer,
      }),
    });
    if (!res.ok) throw new Error("Failed to save codebook");
    book = await res.json();
    setSaveStatus("Saved", "ok");
  }

  function scheduleSave() {
    setSaveStatus("Unsaved changes…", "pending");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveBook();
      } catch (err) {
        setSaveStatus(err.message || "Save failed", "err");
      }
    }, SAVE_DELAY_MS);
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
      `#codebookBody .codebook-prompt-section[data-code-key="${key}"] .codebook-section-body`
    );
    if (!entry || !section || section.matches(":focus")) return;
    section.textContent = sectionBody(entry);
  }

  function syncTableRow(key) {
    const entry = findEntry(key);
    const row = document.querySelector(`#codebookBody tr[data-code-key="${key}"]`);
    if (!entry || !row) return;
    const label = row.querySelector('[data-field="label"]');
    const desc = row.querySelector('[data-field="description"]');
    const examples = row.querySelector('[data-field="examples"]');
    const notThis = row.querySelector('[data-field="not_this"]');
    if (label && document.activeElement !== label) label.textContent = entry.label || entry.code;
    if (desc && document.activeElement !== desc) desc.textContent = entry.description || "";
    if (examples && document.activeElement !== examples) {
      examples.textContent = (entry.examples || []).join("\n");
    }
    if (notThis && document.activeElement !== notThis) notThis.textContent = entry.not_this || "";
  }

  function applyTableEdit(key, field, value) {
    const entry = findEntry(key);
    if (!entry) return;
    if (field === "examples") {
      entry.examples = String(value || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      entry[field] = String(value || "").trim();
    }
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

  function tableHtml() {
    const rows = (book.entries || [])
      .map((entry) => {
        const key = entryKey(entry);
        const flag = entry.is_flag ? `<span class="codebook-flag">flag</span>` : "";
        return `
          <tr data-code-key="${escapeHtml(key)}">
            <td class="codebook-role">${escapeHtml(ROLE_LABELS[entry.role] || entry.role)}</td>
            <td class="codebook-code"><code>${escapeHtml(entry.code)}</code>${flag}</td>
            <td class="codebook-label">
              <div class="codebook-editable" contenteditable="true" data-field="label" spellcheck="true">${escapeHtml(entry.label || entry.code)}</div>
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
            <thead>
              <tr>
                <th>Role</th>
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

  function renderBody() {
    const body = document.getElementById("codebookBody");
    if (!body || !book) return;
    body.innerHTML = `<div class="codebook-split">${tableHtml()}${promptHtml()}</div>`;
    applyFontScale();
    wirePaneInteractions(body);
  }

  function wirePaneInteractions(body) {
    body.querySelectorAll("tr[data-code-key], .codebook-prompt-section[data-code-key]").forEach((el) => {
      const key = el.dataset.codeKey;
      el.addEventListener("mouseenter", () => setLinked(key, false));
      el.addEventListener("mouseleave", clearHoverLinked);
      el.addEventListener("mousedown", (e) => {
        if (e.target.closest(".codebook-editable")) return;
        setLinked(key, true);
        const peer =
          el.tagName === "TR"
            ? body.querySelector(`.codebook-prompt-section[data-code-key="${key}"]`)
            : body.querySelector(`tr[data-code-key="${key}"]`);
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        peer?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
