const laBody = document.getElementById("laBody");
const laEditor = document.getElementById("laEditor");
const laApp = document.getElementById("laApp");
const laSampleOnly = document.getElementById("laSampleOnly");
const laBuilderOnly = document.getElementById("laBuilderOnly");
const laRefresh = document.getElementById("laRefresh");

const INTENT_LABELS = {
  desired: "Desired",
  adversarial: "Adversarial",
  others: "Other",
};

const OUTCOME_LABELS = {
  success: "Success",
  fail: "Fail",
  others: "Other",
};

const THEME_SECTIONS = {
  adversarial: {
    field: "adversarial",
    unit: "prompts",
    one: "prompt",
    empty: "No prompts coded adversarial under these filters.",
  },
  failures: {
    field: "failures",
    unit: "replies",
    one: "reply",
    empty: "No bot replies coded fail under these filters.",
  },
};

let laData = null;
let selectedCell = null;
let selectedThemes = { adversarial: null, failures: null };
let appOptionsLoaded = false;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function pct(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function pct1(value) {
  if (value === null || value === undefined) return "—";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function queryParams() {
  const params = new URLSearchParams();
  const editor = laEditor.value;
  if (editor && editor !== "all") params.set("editor", editor);
  if (laApp.value && laApp.value !== "All") params.set("app", laApp.value);
  if (laSampleOnly.checked) params.set("sample_only", "true");
  if (laBuilderOnly.checked) params.set("builder_only", "true");
  return params;
}

function statsHtml(data) {
  const t = data.totals;
  const cards = [
    { label: "Coded prompts", value: t.user_labeled, sub: `${t.conversations_labeled} conversations` },
    { label: "Coded replies", value: t.bot_labeled, sub: "bot messages" },
    { label: "Prompt → reply pairs", value: t.pairs, sub: `${t.prompts_without_coded_reply} prompts without a coded reply` },
    { label: "Overall success", value: pct1(t.success_rate), sub: "share of pairs coded success" },
  ];
  const note =
    laEditor.value === "all"
      ? "Showing both coders: when they disagree on a message, the more notable code wins (adversarial over desired, fail over success), so nothing rare is hidden behind the other coder's default."
      : `Showing only messages coded by ${laEditor.value}.`;
  return `
    <p class="la-scope-note">${escapeHtml(note)}</p>
    <div class="la-stats">
      ${cards
        .map(
          (c) => `
        <div class="la-stat">
          <div class="label">${escapeHtml(c.label)}</div>
          <div class="value">${escapeHtml(String(c.value))}</div>
          <div class="sub">${escapeHtml(c.sub)}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

function barListHtml(rows, labels, kind) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `
    <div class="la-bars">
      ${rows
        .map(
          (r) => `
        <div class="la-bar-row">
          <div class="la-bar-name">${escapeHtml(labels[r.code] || r.code)}</div>
          <div class="la-bar-track">
            <div class="la-bar-fill" data-${kind}="${escapeHtml(r.code)}" style="width:${
            (r.count / max) * 100
          }%"></div>
          </div>
          <div class="la-bar-value">${r.count}<span>${pct(r.share)}</span></div>
        </div>`
        )
        .join("")}
    </div>`;
}

function matrixHtml(data) {
  const rows = data.matrix.rows;
  return `
    <div class="la-matrix">
      ${rows
        .map((row) => {
          if (!row.total) {
            return `
              <div class="la-matrix-row la-matrix-row--empty">
                <div class="la-matrix-head">
                  <span class="la-intent" data-intent="${escapeHtml(row.intent)}">${escapeHtml(
              INTENT_LABELS[row.intent] || row.intent
            )}</span>
                  <span class="la-matrix-total">no pairs</span>
                </div>
              </div>`;
          }
          const segments = row.cells
            .filter((cell) => cell.count > 0)
            .map((cell) => {
              const active =
                selectedCell &&
                selectedCell.intent === row.intent &&
                selectedCell.outcome === cell.outcome;
              return `
                <button
                  type="button"
                  class="la-seg${active ? " active" : ""}"
                  data-outcome="${escapeHtml(cell.outcome)}"
                  data-intent="${escapeHtml(row.intent)}"
                  style="flex-grow:${cell.count}"
                  title="${escapeHtml(
                    `${INTENT_LABELS[row.intent]} → ${OUTCOME_LABELS[cell.outcome]}: ${
                      cell.count
                    } (${pct(cell.share)})`
                  )}"
                >
                  <span class="la-seg-label">${escapeHtml(
                    OUTCOME_LABELS[cell.outcome] || cell.outcome
                  )} ${pct(cell.share)}</span>
                </button>`;
            })
            .join("");
          return `
            <div class="la-matrix-row">
              <div class="la-matrix-head">
                <span class="la-intent" data-intent="${escapeHtml(row.intent)}">${escapeHtml(
            INTENT_LABELS[row.intent] || row.intent
          )}</span>
                <span class="la-matrix-total">${row.total} pair${row.total === 1 ? "" : "s"} · ${pct1(
            row.success_rate
          )} success</span>
              </div>
              <div class="la-stack">${segments}</div>
            </div>`;
        })
        .join("")}
    </div>`;
}

function examplesHtml(data) {
  if (!selectedCell) {
    return `<div class="la-examples-empty">Click a bar segment above to read the prompts and replies behind it.</div>`;
  }
  const key = `${selectedCell.intent}|${selectedCell.outcome}`;
  const rows = data.examples[key] || [];
  const heading = `${INTENT_LABELS[selectedCell.intent] || selectedCell.intent} prompt → ${(
    OUTCOME_LABELS[selectedCell.outcome] || selectedCell.outcome
  ).toLowerCase()} reply`;
  if (!rows.length) {
    return `<div class="la-examples-empty">No examples for ${escapeHtml(heading)}.</div>`;
  }
  return `
    <div class="la-examples-head">
      <h3>${escapeHtml(heading)}</h3>
      <span>showing ${rows.length} example${rows.length === 1 ? "" : "s"}</span>
    </div>
    <div class="la-example-list">
      ${rows
        .map(
          (ex) => `
        <article class="la-example">
          <header>
            <span class="la-example-app">${escapeHtml(ex.app)}</span>
            <span class="la-example-meta">${escapeHtml(ex.user || "Anonymous")} · ${escapeHtml(
            ex.date || ""
          )} · msg ${escapeHtml(ex.message_number)}${ex.iterative ? " · iterative" : ""}</span>
            <a class="la-example-link" href="/?conv=${encodeURIComponent(
              ex.conv_id
            )}" target="_blank" rel="noopener">Open conversation ↗</a>
          </header>
          <div class="la-turn la-turn--user">
            <span class="la-turn-who">Prompt</span>
            <p>${escapeHtml(ex.prompt)}</p>
            ${
              ex.prompt_rationale
                ? `<div class="la-rationale">${escapeHtml(ex.prompt_rationale)}</div>`
                : ""
            }
          </div>
          <div class="la-turn la-turn--bot">
            <span class="la-turn-who">Reply</span>
            <p>${escapeHtml(ex.reply)}</p>
            ${
              ex.reply_rationale
                ? `<div class="la-rationale">${escapeHtml(ex.reply_rationale)}</div>`
                : ""
            }
          </div>
        </article>`
        )
        .join("")}
    </div>`;
}

function appTableHtml(data) {
  if (!data.by_app.length) {
    return `<div class="la-examples-empty">No coded pairs yet for these filters.</div>`;
  }
  return `
    <div class="cost-table-wrap">
      <table class="cost-table la-table">
        <thead>
          <tr>
            <th>App</th>
            <th class="num">Convs</th>
            <th class="num">Pairs</th>
            <th class="num">Desired</th>
            <th class="num">Adversarial</th>
            <th class="num">Other</th>
            <th class="num">Success</th>
            <th class="num">Fail</th>
            <th class="num">Success rate</th>
          </tr>
        </thead>
        <tbody>
          ${data.by_app
            .map(
              (row) => `
            <tr>
              <td class="bot-name">${escapeHtml(row.app)}</td>
              <td class="num">${row.conversations}</td>
              <td class="num">${row.pairs}</td>
              <td class="num">${row.intents.desired}</td>
              <td class="num">${row.intents.adversarial}</td>
              <td class="num">${row.intents.others}</td>
              <td class="num">${row.outcomes.success}</td>
              <td class="num">${row.outcomes.fail}</td>
              <td class="num la-rate">${pct1(row.success_rate)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function cohortCompareHtml(data) {
  const keys = (data.cohort_order || []).filter((key) => (data.cohorts?.[key]?.pairs || 0) > 0);
  if (keys.length < 2) {
    return `<div class="la-examples-empty">Not enough coded data to compare cohorts.</div>`;
  }
  const metrics = [
    { key: "conversations_labeled", label: "Coded conversations", fmt: (v) => v },
    { key: "pairs", label: "Prompt → reply pairs", fmt: (v) => v },
    { key: "turns_per_conversation", label: "Turns per conversation", fmt: (v) => (v ?? "—") },
    { key: "prompts_per_conversation", label: "Coded prompts per conversation", fmt: (v) => (v ?? "—") },
    { key: "desired_share", label: "Desired prompts", fmt: pct1, bar: true },
    { key: "adversarial_share", label: "Adversarial prompts", fmt: pct1, bar: true },
    { key: "success_rate", label: "Success rate", fmt: pct1, bar: true },
    { key: "fail_rate", label: "Fail rate", fmt: pct1, bar: true },
  ];
  return `
    <div class="cost-table-wrap">
      <table class="cost-table la-table la-cohort-table">
        <thead>
          <tr>
            <th>Metric</th>
            ${keys
              .map(
                (key) =>
                  `<th class="num">${escapeHtml(data.cohort_labels[key])}<span class="la-th-sub">${
                    data.cohorts[key].conversations_scanned
                  } convs in scope</span></th>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${metrics
            .map(
              (m) => `
            <tr>
              <td>${escapeHtml(m.label)}</td>
              ${keys
                .map((key) => {
                  const raw = data.cohorts[key][m.key];
                  // Share metrics are drawn on an absolute 0–100% scale.
                  const width = m.bar ? (Number(raw) || 0) * 100 : null;
                  return `<td class="num">
                    <span class="la-cohort-value">${escapeHtml(String(m.fmt(raw)))}</span>
                    ${
                      m.bar
                        ? `<span class="la-cohort-bar"><i style="width:${width}%"></i></span>`
                        : ""
                    }
                  </td>`;
                })
                .join("")}
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="la-grid la-cohort-cards">
      ${keys
        .map(
          (key) => `
        <div class="la-card">
          <div class="la-card-head">
            <h3>${escapeHtml(data.cohort_labels[key])}</h3>
            <span>${data.cohorts[key].pairs} pairs</span>
          </div>
          <div class="la-card-sub">Prompt intent</div>
          ${barListHtml(data.cohorts[key].user_intent, INTENT_LABELS, "intent")}
          <div class="la-card-sub">Response outcome</div>
          ${barListHtml(data.cohorts[key].bot_outcome, OUTCOME_LABELS, "outcome")}
        </div>`
        )
        .join("")}
    </div>`;
}

function themeSectionHtml(data, kind) {
  const config = THEME_SECTIONS[kind];
  const adv = data[config.field];
  if (!adv || !adv.total) {
    return `<div class="la-examples-empty">${escapeHtml(config.empty)}</div>`;
  }
  const selectedTheme = selectedThemes[kind];
  const keys = data.cohort_order.filter((key) => adv.by_cohort[key].coded_prompts > 0);
  const themes = adv.themes.filter((t) =>
    keys.some((key) => adv.by_cohort[key].themes[t.key] > 0)
  );
  const maxCell = Math.max(
    ...themes.flatMap((t) => keys.map((key) => adv.by_cohort[key].themes[t.key])),
    1
  );

  const rateRow = keys
    .map((key) => {
      const c = adv.by_cohort[key];
      return `
        <div class="la-adv-rate">
          <span class="la-compare-label">${escapeHtml(data.cohort_labels[key])}</span>
          <strong>${pct1(c.share)}</strong>
          <span class="la-compare-sub">${c.count} of ${c.coded_prompts} coded ${
        config.unit
      }, across ${c.conversations} conversation${c.conversations === 1 ? "" : "s"}${
        c.count >= 5 ? ` · top 3 hold ${pct(c.concentration)}` : ""
      }</span>
        </div>`;
    })
    .join("");

  const rows = themes
    .map((theme) => {
      const active = selectedTheme === theme.key;
      const total = keys.reduce((sum, key) => sum + adv.by_cohort[key].themes[theme.key], 0);
      return `
        <tr class="la-adv-row${active ? " active" : ""}" data-theme="${escapeHtml(theme.key)}">
          <td>
            <span class="la-adv-theme">${escapeHtml(theme.label)}</span>
            <span class="la-adv-desc">${escapeHtml(theme.description)}</span>
          </td>
          ${keys
            .map((key) => {
              const n = adv.by_cohort[key].themes[theme.key];
              return `<td class="num">
                <span class="la-cohort-value">${n || "—"}</span>
                <span class="la-cohort-bar"><i style="width:${(n / maxCell) * 100}%"></i></span>
              </td>`;
            })
            .join("")}
          <td class="num">${total}</td>
        </tr>`;
    })
    .join("");

  const shown = selectedTheme
    ? adv.prompts.filter((p) => p.theme === selectedTheme)
    : [];
  const themeLabel = selectedTheme
    ? (adv.themes.find((t) => t.key === selectedTheme) || {}).label
    : "";

  return `
    <p class="la-card-lede">${adv.total} ${config.unit} carry this code. Themes are tagged by keyword from the message text and the coders' rationales, so treat them as a reading aid rather than a second coding pass.</p>
    <div class="la-adv-rates">${rateRow}</div>
    <div class="cost-table-wrap">
      <table class="cost-table la-table la-adv-table" data-kind="${escapeHtml(kind)}">
        <thead>
          <tr>
            <th>Theme</th>
            ${keys
              .map((key) => `<th class="num">${escapeHtml(data.cohort_labels[key])}</th>`)
              .join("")}
            <th class="num">All</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="la-adv-prompts" id="laThemePrompts-${escapeHtml(kind)}">
      ${
        selectedTheme
          ? `<div class="la-examples-head">
              <h3>${escapeHtml(themeLabel)}</h3>
              <span>${shown.length} ${shown.length === 1 ? config.one : config.unit}</span>
            </div>
            <div class="la-example-list">
              ${shown
                .map(
                  (p) => `
                <article class="la-example la-adv-card la-adv-card--${escapeHtml(p.cohort)}">
                  <header>
                    <span class="la-example-app">${escapeHtml(
                      data.cohort_labels[p.cohort]
                    )}</span>
                    <span class="la-example-meta">${escapeHtml(p.app)} · #${escapeHtml(
                    p.conv_id
                  )} msg ${escapeHtml(p.message_number)}</span>
                    <a class="la-example-link" href="/?conv=${encodeURIComponent(
                      p.conv_id
                    )}" target="_blank" rel="noopener">Open ↗</a>
                  </header>
                  ${
                    p.prompt
                      ? `<div class="la-turn la-turn--user">
                          <span class="la-turn-who">Prompt</span>
                          <p>${escapeHtml(p.prompt)}</p>
                        </div>`
                      : ""
                  }
                  <p class="la-adv-text">${escapeHtml(p.text)}</p>
                  ${
                    p.rationale
                      ? `<div class="la-rationale">${escapeHtml(p.rationale)}</div>`
                      : ""
                  }
                </article>`
                )
                .join("")}
            </div>`
          : `<div class="la-examples-empty">Click a theme row to read the ${escapeHtml(
              config.unit
            )} behind it.</div>`
      }
    </div>`;
}

function kappaBlockHtml(title, block, labels) {
  if (!block || !block.n) {
    return `
      <div class="la-kappa">
        <div class="la-kappa-head"><h4>${escapeHtml(title)}</h4><span>no shared items</span></div>
      </div>`;
  }
  const cats = block.categories;
  const perCode = block.per_code || [];
  return `
    <div class="la-kappa">
      <div class="la-kappa-head">
        <h4>${escapeHtml(title)}</h4>
        <span>${block.n} messages coded by both</span>
      </div>
      <div class="la-kappa-figures">
        <div>
          <span class="la-compare-label">Overall κ</span>
          <strong>${block.kappa === null ? "—" : block.kappa.toFixed(3)}</strong>
          <span class="la-compare-sub">${escapeHtml(block.interpretation)}</span>
        </div>
        <div>
          <span class="la-compare-label">Observed</span>
          <strong>${pct1(block.observed)}</strong>
          <span class="la-compare-sub">raw agreement</span>
        </div>
        <div>
          <span class="la-compare-label">Chance</span>
          <strong>${pct1(block.expected)}</strong>
          <span class="la-compare-sub">expected by chance</span>
        </div>
      </div>
      ${block.note ? `<p class="la-kappa-note">${escapeHtml(block.note)}</p>` : ""}
      <h5 class="la-kappa-subhead">IRR by code (code vs not-code)</h5>
      <table class="la-per-code">
        <thead>
          <tr>
            <th>Code</th>
            <th class="num">κ</th>
            <th class="num">Agree</th>
            <th class="num">Both</th>
            <th class="num">${escapeHtml(labels.rater_a)} only</th>
            <th class="num">${escapeHtml(labels.rater_b)} only</th>
            <th class="num">Specific P</th>
          </tr>
        </thead>
        <tbody>
          ${perCode
            .map((row) => {
              const name = labels.codes[row.code] || row.code;
              return `
              <tr>
                <th>${escapeHtml(name)}</th>
                <td class="num"><strong>${
                  row.kappa === null || row.kappa === undefined ? "—" : row.kappa.toFixed(3)
                }</strong>
                  <div class="la-compare-sub">${escapeHtml(row.interpretation || "")}</div>
                </td>
                <td class="num">${pct1(row.observed)}</td>
                <td class="num">${row.agreed ?? 0}</td>
                <td class="num">${row.a_only ?? 0}</td>
                <td class="num">${row.b_only ?? 0}</td>
                <td class="num">${pct1(row.specific_agreement)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
      <details class="la-confusion-details">
        <summary>Confusion matrix</summary>
        <table class="la-confusion">
          <thead>
            <tr>
              <th>${escapeHtml(labels.rater_a)} ↓ / ${escapeHtml(labels.rater_b)} →</th>
              ${cats.map((c) => `<th class="num">${escapeHtml(labels.codes[c] || c)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${block.confusion
              .map((row, i) => {
                return `
                <tr>
                  <th>${escapeHtml(labels.codes[row.code] || row.code)}</th>
                  ${row.counts
                    .map(
                      (n, j) =>
                        `<td class="num${i === j ? " la-diag" : ""}${
                          i !== j && n > 0 ? " la-off" : ""
                        }">${n}</td>`
                    )
                    .join("")}
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </details>
    </div>`;
}

function agreementHtml(data) {
  const ag = data.agreement;
  if (!ag || !ag.kappa) {
    return `<div class="la-examples-empty">Agreement stats unavailable.</div>`;
  }
  const [raterA, raterB] = ag.raters || ["ruiwei", "jiayi"];
  const conflicts = ag.conflicts || [];
  const labelsUser = { rater_a: raterA, rater_b: raterB, codes: INTENT_LABELS };
  const labelsBot = { rater_a: raterA, rater_b: raterB, codes: OUTCOME_LABELS };
  const iterativeLabels = {
    rater_a: raterA,
    rater_b: raterB,
    codes: { iterative: "Iterative", single: "Single-shot" },
  };
  return `
    <p class="la-card-lede">${ag.matched} of ${ag.both_coded} messages coded by both ${escapeHtml(
    raterA
  )} and ${escapeHtml(raterB)} carry the same code (${pct1(
    ag.rate
  )} raw agreement). Kappa is reported separately for the two code sets, since they are never mixed.</p>
    <div class="la-grid la-kappa-grid">
      ${kappaBlockHtml("Prompt intent", ag.kappa.user, labelsUser)}
      ${kappaBlockHtml("Response outcome", ag.kappa.bot, labelsBot)}
      ${kappaBlockHtml("Iterative flag", ag.kappa.iterative, iterativeLabels)}
    </div>
    ${
      conflicts.length
        ? `<div class="la-card la-conflicts-card">
            <div class="la-card-head">
              <h3>Disagreements</h3>
              <span>all ${conflicts.length}</span>
            </div>
            <ul class="la-conflicts">${conflicts
              .map(
                (c) =>
                  `<li>
                    <a href="/?conv=${encodeURIComponent(
                      c.conv_id
                    )}" target="_blank" rel="noopener">
                      <span class="la-conflict-app">${escapeHtml(c.app)}</span>
                      <span class="la-conflict-loc">#${escapeHtml(
                        c.conv_id
                      )} · msg ${escapeHtml(c.message_number)} · ${escapeHtml(c.role)}</span>
                    </a>
                    <span class="la-conflict-codes">${Object.entries(c.codes)
                      .map(
                        ([ed, code]) =>
                          `<em>${escapeHtml(ed)}</em> ${escapeHtml(code)}`
                      )
                      .join(" vs ")}</span>
                  </li>`
              )
              .join("")}</ul>
          </div>`
        : ""
    }`;
}

function iterativeHtml(data) {
  const it = data.iterative;
  return `
    <div class="la-card">
      <div class="la-card-head"><h3>Iterative prompting</h3></div>
      <p class="la-card-lede">${it.prompts} prompt${
    it.prompts === 1 ? " was" : "s were"
  } flagged as iterative (${pct(it.share)} of coded prompts).</p>
      <div class="la-compare">
        <div>
          <span class="la-compare-label">Iterative</span>
          <strong>${pct1(it.success_rate)}</strong>
          <span class="la-compare-sub">${it.pairs} pairs</span>
        </div>
        <div>
          <span class="la-compare-label">Single-shot</span>
          <strong>${pct1(it.non_iterative_success_rate)}</strong>
          <span class="la-compare-sub">${it.non_iterative_pairs} pairs</span>
        </div>
      </div>
    </div>`;
}

function render() {
  if (!laData) return;
  const data = laData;
  laBody.innerHTML = `
    ${statsHtml(data)}
    <div class="la-grid">
      <div class="la-card">
        <div class="la-card-head">
          <h3>Prompt intent</h3>
          <span>what students asked for</span>
        </div>
        ${barListHtml(data.user_intent, INTENT_LABELS, "intent")}
      </div>
      <div class="la-card">
        <div class="la-card-head">
          <h3>Response outcome</h3>
          <span>how the bot answered</span>
        </div>
        ${barListHtml(data.bot_outcome, OUTCOME_LABELS, "outcome")}
      </div>
    </div>

    <section class="la-section">
      <div class="la-section-head">
        <h2>Intent → outcome</h2>
        <p>Each coded prompt is paired with the bot reply that follows it.</p>
      </div>
      ${matrixHtml(data)}
      <div class="la-examples" id="laExamples">${examplesHtml(data)}</div>
    </section>

    <section class="la-section">
      <div class="la-section-head">
        <h2>Builder tests vs. real use</h2>
        <p>Builders testing their own bot behave differently from students using them for real.</p>
      </div>
      ${cohortCompareHtml(data)}
    </section>

    <section class="la-section">
      <div class="la-section-head">
        <h2>Adversarial themes</h2>
        <p>What students push against, compared with what builders probe for.</p>
      </div>
      ${themeSectionHtml(data, "adversarial")}
    </section>

    <section class="la-section">
      <div class="la-section-head">
        <h2>Failure reasons</h2>
        <p>Why replies were coded fail, grouped the same way.</p>
      </div>
      ${themeSectionHtml(data, "failures")}
    </section>

    <section class="la-section">
      <div class="la-section-head">
        <h2>By app</h2>
        <p>Coded pairs grouped by the bot students were talking to.</p>
      </div>
      ${appTableHtml(data)}
    </section>

    <section class="la-section">
      <div class="la-section-head">
        <h2>Coder agreement</h2>
        <p>Inter-rater reliability between the two coders, always across both coders regardless of the filter above.</p>
      </div>
      ${agreementHtml(data)}
    </section>

    <section class="la-section">
      ${iterativeHtml(data)}
    </section>
  `;

  laBody.querySelectorAll(".la-adv-row").forEach((row) => {
    row.addEventListener("click", () => {
      const kind = row.closest("table").dataset.kind;
      const theme = row.dataset.theme;
      selectedThemes[kind] = selectedThemes[kind] === theme ? null : theme;
      render();
      const panel = document.getElementById(`laThemePrompts-${kind}`);
      if (panel && selectedThemes[kind]) {
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  });

  laBody.querySelectorAll(".la-seg").forEach((btn) => {
    btn.addEventListener("click", () => {
      const intent = btn.dataset.intent;
      const outcome = btn.dataset.outcome;
      if (selectedCell && selectedCell.intent === intent && selectedCell.outcome === outcome) {
        selectedCell = null;
      } else {
        selectedCell = { intent, outcome };
      }
      render();
      const panel = document.getElementById("laExamples");
      if (panel && selectedCell) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

function syncAppOptions(data) {
  if (appOptionsLoaded) return;
  const current = laApp.value;
  const apps = data.by_app.map((row) => row.app);
  laApp.innerHTML =
    `<option value="All">All apps</option>` +
    apps
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
      .join("");
  laApp.value = current && apps.includes(current) ? current : "All";
  appOptionsLoaded = true;
}

async function load() {
  laBody.innerHTML = `<div class="empty">Loading coded messages…</div>`;
  try {
    const res = await fetch(`/api/label-analysis?${queryParams().toString()}`);
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    laData = await res.json();
    syncAppOptions(laData);
    render();
  } catch (err) {
    laBody.innerHTML = `<div class="empty">Failed to load analysis: ${escapeHtml(err.message)}</div>`;
  }
}

[laEditor, laApp, laSampleOnly, laBuilderOnly].forEach((el) => {
  el.addEventListener("change", () => {
    selectedCell = null;
    selectedThemes = { adversarial: null, failures: null };
    load();
  });
});

laRefresh.addEventListener("click", async () => {
  laRefresh.disabled = true;
  laRefresh.textContent = "Refreshing…";
  laBody.innerHTML = `<div class="empty">Pulling latest Google Sheet…</div>`;
  try {
    await fetch("/api/refresh", { method: "POST" });
  } catch (err) {
    /* fall through to a normal load with cached data */
  }
  appOptionsLoaded = false;
  await load();
  laRefresh.disabled = false;
  laRefresh.textContent = "Refresh";
});

load();
