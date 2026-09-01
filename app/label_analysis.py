"""Analysis of coded messages: user prompt intent vs. bot response outcome.

User messages are coded desired / adversarial / others (plus an iterative flag);
bot messages are coded success / fail / others. This module pairs each coded
user prompt with the bot reply that follows it so the two code sets can be read
together, and splits the result by cohort (builder tests vs. real student use).
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from app.conversations_loader import filter_conversations
from app.message_labels import (
    ALLOWED_EDITORS,
    BOT_MESSAGE_CODES,
    USER_MESSAGE_CODES,
    is_sample_conversation,
    load_message_labels,
    message_key,
)

ALL_EDITORS = "all"
EXAMPLE_TEXT_LIMIT = 420

COHORT_BUILDER = "builder"
COHORT_ANONYMOUS = "anonymous"
COHORT_NAMED = "named"
COHORT_ORDER = [COHORT_BUILDER, COHORT_ANONYMOUS, COHORT_NAMED]
COHORT_LABELS = {
    COHORT_BUILDER: "Builder tests",
    COHORT_ANONYMOUS: "Students (anonymous)",
    COHORT_NAMED: "Signed-in non-builders",
}


# Heuristic themes for adversarial prompts. Rules are checked in order and the
# first match wins, so the more specific patterns come first. These are a
# reading aid over the coders' own rationales, not a second coding pass.
ADVERSARIAL_THEMES: list[dict[str, Any]] = [
    {
        "key": "jailbreak",
        "label": "Jailbreak / prompt injection",
        "description": "Tries to override the bot's instructions or persona.",
        "text": [
            "ignore all previous",
            "ignore previous instruction",
            "disregard your instructions",
            "system prompt",
            "pretend you are",
            "act as if you have no",
        ],
        "rationale": ["jail break", "jailbreak", "injection"],
    },
    {
        "key": "detection_evasion",
        "label": "Detection evasion",
        "description": "Asks for output that will not read as AI-written.",
        "text": [
            "not detectable",
            "undetectable",
            "detected by ai",
            "detectable by ai",
            "sound more human",
            "make it sound human",
            "plagiaris",
        ],
        "rationale": ["detect"],
    },
    {
        "key": "ghostwriting",
        "label": "Rewrite my work for me",
        "description": "Hands over the student's own draft for the bot to redo.",
        "text": [
            "to my text",
            "can you simplify it",
            "simplify it down",
            "make it sound",
            "reword",
            "rewrite it",
            "make it better",
        ],
        "rationale": ["rewrite", "ghostwrit"],
    },
    {
        "key": "moderated",
        "label": "Blocked by moderation",
        "description": "Playlab hid the message, so the intent is only visible in context.",
        "text": ["this message is hidden because"],
        "rationale": ["hidden message"],
    },
    {
        "key": "ai_generated_prompt",
        "label": "Prompt itself is AI-written",
        "description": "The student pasted an AI-generated prompt into the bot.",
        "text": [],
        "rationale": ["ai-generated", "ai generated"],
    },
    {
        "key": "quiz",
        "label": "Quiz / test answers",
        "description": "Pastes graded quiz items, usually with the answer options.",
        "text": ["question options", "true false"],
        "rationale": ["quiz", "test question"],
        "custom": "quiz",
    },
    {
        "key": "solution",
        "label": "Homework solution dump",
        "description": "Pastes the assignment or problem and asks for the answer.",
        "text": [],
        "rationale": ["direct solution", "asking for solution", "assignment", "answer"],
        "custom": "solution",
    },
    {
        "key": "source_challenge",
        "label": "Source / accuracy challenge",
        "description": "Presses the bot on where its claims come from.",
        "text": [
            "where are you getting",
            "what is your source",
            "in the references",
            "how do i know that you",
            "are you sure",
            "you forgot you had these resources",
            "shared resources with you",
            "didn't the",
        ],
        "rationale": ["accuracy", "source", "correct the ai", "red teaming"],
    },
    {
        "key": "off_topic",
        "label": "Off-topic probe",
        "description": "Deliberately steers the bot outside its purpose.",
        "text": [],
        "rationale": ["off topic", "off-topic"],
    },
    {
        "key": "skips_scaffolding",
        "label": "Skips the bot's scaffolding",
        "description": "Ignores the bot's guiding questions and demands the answer.",
        "text": ["tell me what you want from me", "just tell me"],
        "rationale": ["ignored ai", "ignored the ai", "impatient about the process"],
    },
    {
        "key": "frustration",
        "label": "Frustration / broken input",
        "description": "Typing, voice or platform trouble rather than hostile intent.",
        "text": ["leave me alone", "im not done", "i'm not done", "keeps messing up"],
        "rationale": [
            "impatient",
            "typing",
            "voice to text",
            "system issue",
            "not fluent",
            "modality",
        ],
    },
    {
        "key": "limitation",
        "label": "Product limitation found",
        "description": "Hits a functional limit such as uploads or errors.",
        "text": ["wont let me upload", "won't let me upload", "error code"],
        "rationale": ["limitation", "unclear request"],
    },
]

ADVERSARIAL_THEME_OTHER = {
    "key": "unclassified",
    "label": "Unclassified",
    "description": "No heuristic matched; read the prompt directly.",
}

# Why a bot reply was coded fail. Driven mainly by the coders' own rationales,
# which are unusually descriptive for this code.
FAILURE_THEMES: list[dict[str, Any]] = [
    {
        "key": "abandoned",
        "label": "Student walked away",
        "description": "The conversation stops dead right after this reply.",
        "rationale": ["give up", "gave up", "giveup", "impatient"],
        "text": [],
    },
    {
        "key": "too_long",
        "label": "Too long / not concise",
        "description": "Wall of text where the bot was told to stay brief.",
        "rationale": [" long", "concise", "verbos", "lengthy"],
        "text": [],
    },
    {
        "key": "truncated",
        "label": "Truncated or empty output",
        "description": "The reply cuts off mid-sentence or never arrives.",
        "rationale": ["stopped by the user", "cut off", "truncated", "empty"],
        "text": [],
        "custom": "truncated",
    },
    {
        "key": "grounding",
        "label": "Ignored the uploaded materials",
        "description": "Answers without using the resources the builder attached.",
        "rationale": [
            "reference material",
            "not from reference",
            "did not read",
            "uploaded",
            "resources",
            "source",
        ],
        "text": ["i don't have access to", "i can't see the", "having trouble viewing"],
    },
    {
        "key": "inaccurate",
        "label": "Inaccurate or irrelevant",
        "description": "Content is wrong, off-target or unsupported.",
        "rationale": [
            "incorrect",
            "inaccurate",
            "irrelevant",
            "not the right answer",
            "wrong",
            "accurate feedback",
            "mismatch",
            "broad",
        ],
        "text": [],
    },
    {
        "key": "caved",
        "label": "Caved under pushback",
        "description": "Apologises and reverses itself as soon as it is challenged.",
        "rationale": ["apolog", "caved"],
        "text": [
            "you're absolutely right",
            "you are absolutely right",
            "i sincerely apologize",
            "i apologize for the error",
            "right to call that out",
        ],
    },
    {
        "key": "did_the_work",
        "label": "Did the work for the student",
        "description": "Hands over the answer instead of scaffolding it.",
        "rationale": [
            "direct solution",
            "direct answer",
            "gave out direct",
            "did the work",
            "solution",
        ],
        "text": [
            "here's a simplified version",
            "here's your strengthened",
            "happy to enhance",
            "here's a revised version",
            "simplified version with",
        ],
    },
    {
        "key": "socratic_misfire",
        "label": "Socratic when it should answer",
        "description": "Deflects a plain factual question back to the student.",
        "rationale": ["socratic", "already answered", "already told"],
        "text": ["what do you think", "what do YOU think"],
    },
    {
        "key": "sycophancy",
        "label": "Undeserved praise",
        "description": "Flatters work that does not merit it.",
        "rationale": ["compliment", "praise", "flatter"],
        "text": [],
    },
    {
        "key": "capability",
        "label": "Hit a capability limit",
        "description": "Cannot open a file, take an upload, or reach the source.",
        "rationale": ["limitation", "cannot", "can't"],
        "text": [
            "can't directly accept file uploads",
            "cannot accept file",
            "unable to open",
            "not able to view",
        ],
    },
    {
        "key": "off_script",
        "label": "Ignored its own instructions",
        "description": "Departs from the opening script or rules in the system prompt.",
        "rationale": [
            "failed to act as required",
            "did not follow",
            "did not ask",
            "should \"",
            "violated",
            "off topic",
            "off-topic",
        ],
        "text": ["still being set up"],
        "custom": "quotes_spec",
    },
]

FAILURE_THEME_OTHER = {
    "key": "unclassified",
    "label": "Unclassified",
    "description": "No heuristic matched; read the reply directly.",
}


def classify_failure_theme(text: str, rationale: str) -> str:
    body = (text or "").lower()
    why = (rationale or "").lower()
    for theme in FAILURE_THEMES:
        if any(needle in why for needle in theme.get("rationale", [])):
            return theme["key"]
        if any(needle in body for needle in theme.get("text", [])):
            return theme["key"]
        # A very short reply only counts as truncated when the coder left no
        # other explanation, otherwise the rationale decides.
        if (
            theme.get("custom") == "truncated"
            and not why.strip()
            and len((text or "").strip()) < 60
        ):
            return theme["key"]
        # Coders quote the system prompt verbatim when the bot ignored it.
        if theme.get("custom") == "quotes_spec" and ("“" in rationale or '"' in rationale):
            return theme["key"]
    return FAILURE_THEME_OTHER["key"]


def _looks_like_quiz_item(text: str) -> bool:
    lowered = text.lower()
    return "question" in lowered and ("options" in lowered or "true false" in lowered)


def _looks_like_problem_dump(text: str) -> bool:
    """Pasted textbook problem or assignment, including terse follow-up parts."""
    lowered = (text or "").lower()
    cues = (
        "what is the",
        "what is its",
        "determine the",
        "find the",
        "calculate",
        "how far",
        "how fast",
        "give your answer",
        "worksheet",
        "write down",
        "for each, what",
        "what are the wavelengths",
    )
    if not any(cue in lowered for cue in cues):
        return False
    # Long pastes are problems on their own; short ones need a numeric quantity
    # so that ordinary questions to the bot are not swept up.
    if len(lowered) >= 120:
        return True
    return any(ch.isdigit() for ch in lowered) or "for each" in lowered


def classify_adversarial_theme(text: str, rationale: str) -> str:
    body = (text or "").lower()
    why = (rationale or "").lower()
    for theme in ADVERSARIAL_THEMES:
        if any(needle in why for needle in theme.get("rationale", [])):
            return theme["key"]
        if any(needle in body for needle in theme.get("text", [])):
            return theme["key"]
        custom = theme.get("custom")
        if custom == "quiz" and _looks_like_quiz_item(text or ""):
            return theme["key"]
        if custom == "solution" and _looks_like_problem_dump(text or ""):
            return theme["key"]
    return ADVERSARIAL_THEME_OTHER["key"]


def _normalize_editor_mode(editor: Optional[str]) -> str:
    ed = (editor or "").strip().lower()
    if ed in ALLOWED_EDITORS:
        return ed
    return ALL_EDITORS


# With "all coders" selected a message keeps the most notable code any coder
# gave it, so a rare code is never hidden behind the other coder's default.
CODE_PRIORITY = {
    "adversarial": 3,
    "fail": 3,
    "others": 2,
    "desired": 1,
    "success": 1,
}


def _entry_for(store: dict[str, Any], editor_mode: str) -> Optional[dict[str, Any]]:
    by = (store or {}).get("by") or {}
    if editor_mode != ALL_EDITORS:
        entry = by.get(editor_mode)
        return entry if entry and entry.get("code") else None

    coded = [(ed, by[ed]) for ed in sorted(by) if (by[ed] or {}).get("code")]
    if not coded:
        return None
    ed, entry = max(
        coded,
        key=lambda item: CODE_PRIORITY.get(
            str(item[1].get("code") or "").strip().lower(), 0
        ),
    )
    merged = dict(entry)
    merged["iterative"] = any(bool((row or {}).get("iterative")) for _, row in coded)
    merged["coded_by_all"] = [name for name, _ in coded]
    return merged


def _cohort_of(conv: dict[str, Any]) -> str:
    if conv.get("is_builder"):
        return COHORT_BUILDER
    if conv.get("is_anonymous"):
        return COHORT_ANONYMOUS
    return COHORT_NAMED


def _truncate(text: str, limit: int = EXAMPLE_TEXT_LIMIT) -> str:
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    return f"{value[: limit - 1].rstrip()}…"


def _share(count: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(count / total, 4)


def _rate(part: int, total: int) -> Optional[float]:
    if total <= 0:
        return None
    return round(part / total, 4)


def _empty_counter(codes: Iterable[str]) -> dict[str, int]:
    return {code: 0 for code in codes}


def _distribution(counts: dict[str, int], codes: list[str]) -> list[dict[str, Any]]:
    total = sum(counts.values())
    return [
        {
            "code": code,
            "count": counts.get(code, 0),
            "share": _share(counts.get(code, 0), total),
        }
        for code in codes
    ]


def _bot_role(role: str) -> bool:
    return (role or "").strip().lower() in {"bot", "assistant"}


class _Stats:
    """Accumulates coded prompts, coded replies and prompt→reply pairs."""

    def __init__(self) -> None:
        self.conversations = 0
        self.labeled_conversations: set[str] = set()
        self.user_counts = _empty_counter(USER_MESSAGE_CODES)
        self.bot_counts = _empty_counter(BOT_MESSAGE_CODES)
        self.matrix = {
            intent: _empty_counter(BOT_MESSAGE_CODES) for intent in USER_MESSAGE_CODES
        }
        self.iterative_outcomes = _empty_counter(BOT_MESSAGE_CODES)
        self.non_iterative_outcomes = _empty_counter(BOT_MESSAGE_CODES)
        self.iterative_prompts = 0
        self.pairs = 0
        self.prompts_without_coded_reply = 0
        self.turns_total = 0
        self.turns_conversations = 0

    def add_pair(self, intent: str, outcome: str, iterative: bool) -> None:
        self.pairs += 1
        self.matrix[intent][outcome] += 1
        if iterative:
            self.iterative_outcomes[outcome] += 1
        else:
            self.non_iterative_outcomes[outcome] += 1

    @property
    def success_pairs(self) -> int:
        return sum(counts.get("success", 0) for counts in self.matrix.values())

    def matrix_rows(self) -> list[dict[str, Any]]:
        rows = []
        for intent in USER_MESSAGE_CODES:
            counts = self.matrix[intent]
            total = sum(counts.values())
            rows.append(
                {
                    "intent": intent,
                    "total": total,
                    "success_rate": _rate(counts["success"], total),
                    "cells": [
                        {
                            "outcome": outcome,
                            "count": counts[outcome],
                            "share": _share(counts[outcome], total),
                        }
                        for outcome in BOT_MESSAGE_CODES
                    ],
                }
            )
        return rows

    def to_dict(self) -> dict[str, Any]:
        user_total = sum(self.user_counts.values())
        iterative_pairs = sum(self.iterative_outcomes.values())
        non_iterative_pairs = sum(self.non_iterative_outcomes.values())
        return {
            "conversations_scanned": self.conversations,
            "conversations_labeled": len(self.labeled_conversations),
            "user_labeled": user_total,
            "bot_labeled": sum(self.bot_counts.values()),
            "pairs": self.pairs,
            "prompts_without_coded_reply": self.prompts_without_coded_reply,
            "success_rate": _rate(self.success_pairs, self.pairs),
            "fail_rate": _rate(
                sum(counts.get("fail", 0) for counts in self.matrix.values()), self.pairs
            ),
            "adversarial_share": _share(self.user_counts["adversarial"], user_total),
            "desired_share": _share(self.user_counts["desired"], user_total),
            "iterative_share": _share(self.iterative_prompts, user_total),
            "prompts_per_conversation": (
                round(user_total / len(self.labeled_conversations), 2)
                if self.labeled_conversations
                else None
            ),
            "turns_per_conversation": (
                round(self.turns_total / self.turns_conversations, 2)
                if self.turns_conversations
                else None
            ),
            "user_intent": _distribution(self.user_counts, USER_MESSAGE_CODES),
            "bot_outcome": _distribution(self.bot_counts, BOT_MESSAGE_CODES),
            "matrix": {
                "intents": list(USER_MESSAGE_CODES),
                "outcomes": list(BOT_MESSAGE_CODES),
                "rows": self.matrix_rows(),
            },
            "iterative": {
                "prompts": self.iterative_prompts,
                "share": _share(self.iterative_prompts, user_total),
                "pairs": iterative_pairs,
                "success_rate": _rate(self.iterative_outcomes["success"], iterative_pairs),
                "non_iterative_pairs": non_iterative_pairs,
                "non_iterative_success_rate": _rate(
                    self.non_iterative_outcomes["success"], non_iterative_pairs
                ),
            },
        }


def kappa_interpretation(kappa: Optional[float]) -> str:
    """Landis & Koch (1977) benchmarks."""
    if kappa is None:
        return "not enough data"
    if kappa < 0:
        return "worse than chance"
    if kappa < 0.21:
        return "slight"
    if kappa < 0.41:
        return "fair"
    if kappa < 0.61:
        return "moderate"
    if kappa < 0.81:
        return "substantial"
    return "almost perfect"


def cohens_kappa(
    pairs: list[tuple[str, str]],
    categories: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Unweighted Cohen's kappa for two raters over the same items."""
    n = len(pairs)
    cats = list(categories) if categories else sorted({c for pair in pairs for c in pair})
    if n == 0:
        return {
            "n": 0,
            "categories": cats,
            "observed": None,
            "expected": None,
            "kappa": None,
            "interpretation": kappa_interpretation(None),
            "confusion": [],
            "per_code": [],
            "note": "no messages coded by both raters",
        }

    observed = sum(1 for a, b in pairs if a == b) / n
    count_a = _empty_counter(cats)
    count_b = _empty_counter(cats)
    confusion = {a: _empty_counter(cats) for a in cats}
    for a, b in pairs:
        if a in count_a:
            count_a[a] += 1
        if b in count_b:
            count_b[b] += 1
        if a in confusion and b in confusion[a]:
            confusion[a][b] += 1

    expected = sum((count_a[c] / n) * (count_b[c] / n) for c in cats)
    if expected >= 1.0:
        # Both raters used a single category for everything; kappa is undefined.
        kappa = None
        note = "both raters used one category only, so kappa is undefined"
    else:
        kappa = round((observed - expected) / (1 - expected), 4)
        note = (
            "one code dominates the sample, which holds kappa down even when raw agreement is high"
            if expected >= 0.7
            else ""
        )

    # Specific agreement + binary kappa per code (code vs not-code).
    per_code = []
    for code in cats:
        both = confusion[code][code]
        denom = count_a[code] + count_b[code]
        # Dichotomize: each rater either assigned `code` or not.
        tp = both  # both said this code
        # a said code, b said something else
        a_only = count_a[code] - both
        b_only = count_b[code] - both
        # neither said this code
        tn = n - both - a_only - b_only
        binary_pairs = tp + a_only + b_only + tn
        p_o = (tp + tn) / binary_pairs if binary_pairs else None
        p_a = (tp + a_only) / binary_pairs if binary_pairs else 0
        p_b = (tp + b_only) / binary_pairs if binary_pairs else 0
        # Chance agreement for positive+negative: p_pos_chance + p_neg_chance
        p_e = (p_a * p_b) + ((1 - p_a) * (1 - p_b)) if binary_pairs else None
        if p_o is None or p_e is None:
            code_kappa = None
        elif p_e >= 1.0:
            code_kappa = None
        else:
            code_kappa = round((p_o - p_e) / (1 - p_e), 4)
        per_code.append(
            {
                "code": code,
                "rater_a": count_a[code],
                "rater_b": count_b[code],
                "agreed": both,
                "a_only": a_only,
                "b_only": b_only,
                "neither": tn,
                "specific_agreement": round(2 * both / denom, 4) if denom else None,
                "kappa": code_kappa,
                "interpretation": kappa_interpretation(code_kappa),
                "observed": round(p_o, 4) if p_o is not None else None,
                "expected": round(p_e, 4) if p_e is not None else None,
            }
        )

    return {
        "n": n,
        "categories": cats,
        "observed": round(observed, 4),
        "expected": round(expected, 4),
        "kappa": kappa,
        "interpretation": kappa_interpretation(kappa),
        "confusion": [
            {"code": a, "counts": [confusion[a][b] for b in cats], "total": sum(confusion[a].values())}
            for a in cats
        ],
        "per_code": per_code,
        "note": note,
    }


def _theme_summary(
    items: list[dict[str, Any]],
    cohorts: dict[str, "_Stats"],
    theme_defs: list[dict[str, Any]],
    other: dict[str, Any],
    denominator: str,
) -> dict[str, Any]:
    """Shared shape for the adversarial-prompt and failed-reply breakdowns."""
    themes = [
        {"key": t["key"], "label": t["label"], "description": t["description"]}
        for t in theme_defs
    ] + [dict(other)]
    theme_keys = [t["key"] for t in themes]

    by_cohort: dict[str, Any] = {}
    for key in COHORT_ORDER:
        rows = [p for p in items if p["cohort"] == key]
        counter = (
            cohorts[key].user_counts if denominator == "user" else cohorts[key].bot_counts
        )
        coded_prompts = sum(counter.values())
        conv_counts: dict[str, int] = {}
        for row in rows:
            conv_counts[row["conv_id"]] = conv_counts.get(row["conv_id"], 0) + 1
        top = sorted(conv_counts.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
        by_cohort[key] = {
            "count": len(rows),
            "coded_prompts": coded_prompts,
            "share": _share(len(rows), coded_prompts),
            "conversations": len(conv_counts),
            "themes": {k: sum(1 for r in rows if r["theme"] == k) for k in theme_keys},
            "top_conversations": [
                {
                    "conv_id": cid,
                    "count": n,
                    "share_of_cohort": _share(n, len(rows)),
                }
                for cid, n in top
            ],
            "concentration": _share(sum(n for _, n in top[:3]), len(rows)),
        }

    return {
        "themes": themes,
        "by_cohort": by_cohort,
        "total": len(items),
        "prompts": items,
    }


def compute_label_analysis(
    editor: Optional[str] = None,
    app: Optional[str] = None,
    user: Optional[str] = None,
    builder_only: bool = False,
    needs_attention: bool = False,
    sample_only: bool = False,
    examples_per_cell: int = 5,
) -> dict[str, Any]:
    editor_mode = _normalize_editor_mode(editor)
    labels = load_message_labels()

    conversations = filter_conversations(
        user=user,
        app=app,
        builder_only=builder_only,
        needs_attention=needs_attention,
    )
    if sample_only:
        conversations = [c for c in conversations if is_sample_conversation(c.get("id"))]

    overall = _Stats()
    cohorts: dict[str, _Stats] = {key: _Stats() for key in COHORT_ORDER}
    by_app: dict[str, dict[str, Any]] = {}
    examples: dict[str, list[dict[str, Any]]] = {}
    adversarial_prompts: list[dict[str, Any]] = []
    failed_replies: list[dict[str, Any]] = []

    # Rater pairs for Cohen's kappa, split by the code set each role uses.
    rater_pairs: dict[str, list[tuple[str, str]]] = {"user": [], "bot": []}
    iterative_pairs_raters: list[tuple[str, str]] = []
    conflicts: list[dict[str, Any]] = []
    both_coded = 0
    matched = 0
    # A few conversations repeat a message_number, so agreement is counted per
    # label key rather than per message row.
    seen_agreement_keys: set[str] = set()

    editor_a, editor_b = sorted(ALLOWED_EDITORS)

    for conv in conversations:
        cid = str(conv.get("id") or "").strip()
        if not cid:
            continue
        messages = conv.get("messages") or []
        title = conv.get("title") or "Untitled"
        cohort = _cohort_of(conv)
        stats = cohorts[cohort]

        overall.conversations += 1
        stats.conversations += 1

        coded: dict[str, dict[str, Any]] = {}
        for msg in messages:
            mid = str(msg.get("message_number") or "").strip()
            if not mid:
                continue
            store = labels.get(message_key(cid, mid)) or {}
            entry = _entry_for(store, editor_mode)
            if entry:
                coded[mid] = entry

            # Inter-rater agreement always compares the two coders, regardless
            # of which coder the rest of the view is filtered to.
            by = store.get("by") or {}
            code_a = str((by.get(editor_a) or {}).get("code") or "").strip().lower()
            code_b = str((by.get(editor_b) or {}).get("code") or "").strip().lower()
            if not code_a or not code_b:
                continue
            agreement_key = message_key(cid, mid)
            if agreement_key in seen_agreement_keys:
                continue
            seen_agreement_keys.add(agreement_key)
            both_coded += 1
            role = (msg.get("role") or "").strip().lower()
            if code_a == code_b:
                matched += 1
            else:
                conflicts.append(
                    {
                        "conv_id": cid,
                        "message_number": mid,
                        "app": title,
                        "cohort": cohort,
                        "role": "bot" if _bot_role(role) else role,
                        "codes": {editor_a: code_a, editor_b: code_b},
                    }
                )
            if role == "user":
                rater_pairs["user"].append((code_a, code_b))
                iterative_pairs_raters.append(
                    (
                        "iterative" if (by.get(editor_a) or {}).get("iterative") else "single",
                        "iterative" if (by.get(editor_b) or {}).get("iterative") else "single",
                    )
                )
            elif _bot_role(role):
                rater_pairs["bot"].append((code_a, code_b))

        if not coded:
            continue
        overall.labeled_conversations.add(cid)
        stats.labeled_conversations.add(cid)
        turns = int(conv.get("turns") or 0)
        if turns:
            overall.turns_total += turns
            overall.turns_conversations += 1
            stats.turns_total += turns
            stats.turns_conversations += 1

        for index, msg in enumerate(messages):
            mid = str(msg.get("message_number") or "").strip()
            entry = coded.get(mid)
            if not entry:
                continue
            code = str(entry.get("code") or "").strip().lower()
            role = (msg.get("role") or "").strip().lower()

            if _bot_role(role):
                if code in overall.bot_counts:
                    overall.bot_counts[code] += 1
                    stats.bot_counts[code] += 1
                if code == "fail":
                    reply_text = (msg.get("content") or "").strip()
                    rationale = (entry.get("rationale") or "").strip()
                    asked = ""
                    for earlier in reversed(messages[:index]):
                        if (earlier.get("role") or "").strip().lower() == "user":
                            asked = (earlier.get("content") or "").strip()
                            break
                    failed_replies.append(
                        {
                            "conv_id": cid,
                            "app": title,
                            "cohort": cohort,
                            "user": conv.get("user") or "",
                            "date": conv.get("date") or "",
                            "message_number": mid,
                            "theme": classify_failure_theme(reply_text, rationale),
                            "prompt": _truncate(asked, 200),
                            "text": _truncate(reply_text, 300),
                            "rationale": _truncate(rationale, 200),
                            "coded_by": entry.get("coded_by_all")
                            or [entry.get("updated_by") or ""],
                        }
                    )
                continue
            if role != "user" or code not in overall.user_counts:
                continue

            overall.user_counts[code] += 1
            stats.user_counts[code] += 1
            is_iterative = bool(entry.get("iterative"))

            if code == "adversarial":
                prompt_text = (msg.get("content") or "").strip()
                rationale = (entry.get("rationale") or "").strip()
                adversarial_prompts.append(
                    {
                        "conv_id": cid,
                        "app": title,
                        "cohort": cohort,
                        "user": conv.get("user") or "",
                        "date": conv.get("date") or "",
                        "message_number": mid,
                        "theme": classify_adversarial_theme(prompt_text, rationale),
                        "text": _truncate(prompt_text, 300),
                        "rationale": _truncate(rationale, 160),
                        "coded_by": entry.get("coded_by_all")
                        or [entry.get("updated_by") or ""],
                    }
                )

            if is_iterative:
                overall.iterative_prompts += 1
                stats.iterative_prompts += 1

            reply = None
            reply_entry = None
            for candidate in messages[index + 1 :]:
                if not _bot_role(candidate.get("role")):
                    continue
                reply = candidate
                reply_entry = coded.get(str(candidate.get("message_number") or "").strip())
                break

            outcome = str((reply_entry or {}).get("code") or "").strip().lower()
            if not reply or outcome not in BOT_MESSAGE_CODES:
                overall.prompts_without_coded_reply += 1
                stats.prompts_without_coded_reply += 1
                continue

            overall.add_pair(code, outcome, is_iterative)
            stats.add_pair(code, outcome, is_iterative)

            row = by_app.setdefault(
                title,
                {
                    "app": title,
                    "pairs": 0,
                    "conversations": set(),
                    "intents": _empty_counter(USER_MESSAGE_CODES),
                    "outcomes": _empty_counter(BOT_MESSAGE_CODES),
                },
            )
            row["pairs"] += 1
            row["conversations"].add(cid)
            row["intents"][code] += 1
            row["outcomes"][outcome] += 1

            bucket = examples.setdefault(f"{code}|{outcome}", [])
            if len(bucket) < examples_per_cell:
                bucket.append(
                    {
                        "conv_id": cid,
                        "app": title,
                        "user": conv.get("user") or "",
                        "cohort": cohort,
                        "date": conv.get("date") or "",
                        "message_number": mid,
                        "intent": code,
                        "outcome": outcome,
                        "iterative": is_iterative,
                        "prompt": _truncate(msg.get("content") or ""),
                        "reply": _truncate(reply.get("content") or ""),
                        "prompt_rationale": _truncate(entry.get("rationale") or "", 200),
                        "reply_rationale": _truncate(
                            (reply_entry or {}).get("rationale") or "", 200
                        ),
                        "coded_by": entry.get("updated_by") or "",
                    }
                )

    app_rows = []
    for row in by_app.values():
        total = row["pairs"]
        app_rows.append(
            {
                "app": row["app"],
                "conversations": len(row["conversations"]),
                "pairs": total,
                "intents": dict(row["intents"]),
                "outcomes": dict(row["outcomes"]),
                "success_rate": _rate(row["outcomes"]["success"], total),
                "adversarial_share": _share(row["intents"]["adversarial"], total),
            }
        )
    app_rows.sort(key=lambda r: (-r["pairs"], r["app"].lower()))

    agreement = {
        "raters": [editor_a, editor_b],
        "both_coded": both_coded,
        "matched": matched,
        "rate": _rate(matched, both_coded),
        "kappa": {
            "user": cohens_kappa(rater_pairs["user"], USER_MESSAGE_CODES),
            "bot": cohens_kappa(rater_pairs["bot"], BOT_MESSAGE_CODES),
            "iterative": cohens_kappa(iterative_pairs_raters, ["iterative", "single"]),
        },
        "conflicts": conflicts,
    }

    totals = overall.to_dict()
    return {
        "adversarial": _theme_summary(
            adversarial_prompts,
            cohorts,
            ADVERSARIAL_THEMES,
            ADVERSARIAL_THEME_OTHER,
            "user",
        ),
        "failures": _theme_summary(
            failed_replies, cohorts, FAILURE_THEMES, FAILURE_THEME_OTHER, "bot"
        ),
        "editor": "" if editor_mode == ALL_EDITORS else editor_mode,
        "editor_mode": editor_mode,
        "editors": sorted(ALLOWED_EDITORS),
        "filters": {
            "app": app or "",
            "user": user or "",
            "builder_only": bool(builder_only),
            "needs_attention": bool(needs_attention),
            "sample_only": bool(sample_only),
        },
        "user_codes": list(USER_MESSAGE_CODES),
        "bot_codes": list(BOT_MESSAGE_CODES),
        "cohort_order": list(COHORT_ORDER),
        "cohort_labels": dict(COHORT_LABELS),
        "cohorts": {key: cohorts[key].to_dict() for key in COHORT_ORDER},
        "totals": totals,
        "user_intent": totals["user_intent"],
        "bot_outcome": totals["bot_outcome"],
        "iterative": totals["iterative"],
        "matrix": totals["matrix"],
        "by_app": app_rows,
        "agreement": agreement,
        "examples": examples,
    }
