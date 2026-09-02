"""Per-bot author testing behavior: profiles, labels, and AI-assisted coding.

The unit of analysis is one bot. Every builder (author) conversation for that bot
is bundled in chronological order by first-message timestamp, because the
conversation-level `date` field is day-resolution only and would make a single
burst of re-rolls look like multi-day iteration.

Labels are stored only on Google Sheet tab `testing_behavior` — no local JSON.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from app.codebook import get_codebook
from app.conversations_loader import load_conversations
from app.testing_behavior_sheets import (
    read_labels_from_sheet,
    upsert_label_on_sheet,
    write_all_labels_to_sheet,
)

logger = logging.getLogger(__name__)

CODEBOOK_ID = "author-testing"
CODES = [
    "No testing",
    "Limited evaluation",
    "Opportunistic exploration",
    "Iterative refinement",
]

DEFAULT_MODEL = "claude-sonnet-4-6"
INPUT_USD_PER_MTOK = 3.0
OUTPUT_USD_PER_MTOK = 15.0
CHARS_PER_TOKEN = 4.0
MAX_BUNDLE_CHARS = 140_000
MAX_MESSAGE_CHARS = 4_000
MAX_SYSTEM_CHARS = 6_000

_labels: dict[str, dict[str, Any]] = {}
_labels_loaded_at = 0.0
_migrate_attempted = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------
# storage (Google Sheet only)
# --------------------------------------------------------------------------

def load_labels(force: bool = False) -> dict[str, dict[str, Any]]:
    """Always read labels from the Google Sheet (source of truth)."""
    global _labels, _labels_loaded_at
    import time

    _maybe_migrate_legacy_json()

    try:
        _labels = read_labels_from_sheet()
        _labels_loaded_at = time.time()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to load testing behavior labels from Google Sheet")
        if not _labels_loaded_at:
            _labels = {}
    return _labels


def _maybe_migrate_legacy_json() -> None:
    """One-shot: push any leftover local JSON labels to the Sheet, then delete JSON."""
    global _migrate_attempted
    if _migrate_attempted:
        return

    from pathlib import Path

    from app.sheet_labels import credentials_available

    roots = [
        Path(__file__).resolve().parent.parent / "data" / "testing_behavior_labels.json",
        Path("/tmp/playlab_testing_behavior_labels.json"),
    ]
    existing = [p for p in roots if p.exists()]
    if not existing:
        _migrate_attempted = True
        return
    if not credentials_available():
        logger.warning(
            "Legacy testing_behavior_labels.json found but Google credentials are missing; "
            "cannot migrate yet. Labels will be empty until credentials are set."
        )
        return

    _migrate_attempted = True
    merged: dict[str, dict[str, Any]] = {}
    for path in existing:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            rows = data.get("labels") if isinstance(data, dict) else {}
            if not isinstance(rows, dict):
                rows = data if isinstance(data, dict) else {}
            for bot, row in rows.items():
                if isinstance(row, dict) and (row.get("code") or "").strip():
                    merged[bot] = row
        except Exception:  # noqa: BLE001
            logger.exception("Failed reading legacy labels at %s", path)

    try:
        if merged:
            current = read_labels_from_sheet()
            for bot, row in merged.items():
                if bot not in current:
                    current[bot] = row
            write_all_labels_to_sheet(current)
            logger.info("Migrated %d testing behavior labels to Google Sheet", len(merged))
        for path in existing:
            try:
                path.unlink()
                logger.info("Removed legacy label file %s", path)
            except OSError:
                logger.warning("Could not delete legacy label file %s", path)
    except Exception:  # noqa: BLE001
        logger.exception("Legacy JSON → Sheet migration failed; leaving JSON in place")
        _migrate_attempted = False


def set_label(
    bot: str,
    code: str,
    *,
    editor: str = "",
    rationale: str = "",
    confidence: str = "",
    defect_observed: str = "",
    source: str = "manual",
) -> dict[str, Any]:
    name = (bot or "").strip()
    if not name:
        raise ValueError("bot is required")
    selected = (code or "").strip()
    if selected and selected not in CODES:
        raise ValueError(f"Unknown code: {code}")

    row = {
        "bot": name,
        "code": selected,
        "rationale": (rationale or "").strip(),
        "confidence": (confidence or "").strip().lower(),
        "defect_observed": (defect_observed or "").strip(),
        "editor": (editor or "").strip() or ("sonnet" if source == "ai" else ""),
        "source": source,
        "updated_at": _now_iso(),
    }

    # Source of truth: Google Sheet. Fail loudly so the UI surfaces the error.
    sheet_result = upsert_label_on_sheet(row)
    if not sheet_result.get("ok"):
        raise RuntimeError(sheet_result.get("error") or "Failed to write label to Google Sheet")

    global _labels, _labels_loaded_at
    if selected:
        _labels[name] = row
    else:
        _labels.pop(name, None)
    _labels_loaded_at = 0.0  # next load_labels() re-reads from Sheet
    return {**row, "sheet_sync": sheet_result}


# --------------------------------------------------------------------------
# per-bot profiles
# --------------------------------------------------------------------------

def _first_ts(conv: dict[str, Any]) -> str:
    stamps = [m.get("datetime") for m in (conv.get("messages") or []) if m.get("datetime")]
    if stamps:
        return min(stamps)
    return str(conv.get("date_sort") or "")


def _bot_name(conv: dict[str, Any]) -> str:
    return (conv.get("bot_name") or conv.get("title") or "Unknown").strip()


def _burst_groups(stamps: list[str], gap_minutes: int = 30) -> int:
    """Count clusters of sessions separated by more than `gap_minutes`."""
    parsed: list[datetime] = []
    for s in stamps:
        try:
            parsed.append(datetime.fromisoformat(s))
        except (TypeError, ValueError):
            continue
    if not parsed:
        return 0
    parsed.sort()
    groups = 1
    for prev, cur in zip(parsed, parsed[1:]):
        if (cur - prev).total_seconds() > gap_minutes * 60:
            groups += 1
    return groups


def _repeat_ratio(sessions: list[dict[str, Any]]) -> float:
    """Share of author messages whose normalized text appears in >1 session.

    A high value means the author re-ran the same probe, which is the main
    behavioural signal separating refinement from opportunistic exploration.
    """
    per_session: list[set[str]] = []
    for s in sessions:
        texts = set()
        for m in s.get("messages") or []:
            if (m.get("role") or "").lower() != "user":
                continue
            norm = re.sub(r"[^a-z0-9 ]+", "", (m.get("content") or "").lower()).strip()
            norm = re.sub(r"\s+", " ", norm)
            if len(norm) >= 4 and norm not in {"yes", "no", "ok", "okay"}:
                texts.add(norm)
        per_session.append(texts)
    if len(per_session) < 2:
        return 0.0
    counts: dict[str, int] = {}
    for texts in per_session:
        for t in texts:
            counts[t] = counts.get(t, 0) + 1
    total = len(counts)
    if not total:
        return 0.0
    return round(sum(1 for v in counts.values() if v > 1) / total, 3)


def _outcome_index() -> dict[str, tuple[int, int]]:
    """conv_id -> (fail count, total bot-outcome labels), across all coders."""
    try:
        from app.message_labels import load_message_labels
    except Exception:  # noqa: BLE001
        return {}
    index: dict[str, tuple[int, int]] = {}
    for key, store in load_message_labels().items():
        cid = key.rsplit(":", 1)[0]
        fail, total = index.get(cid, (0, 0))
        for entry in (store.get("by") or {}).values():
            code = (entry.get("code") or "").strip()
            if code in {"success", "fail", "others"}:
                total += 1
                if code == "fail":
                    fail += 1
        index[cid] = (fail, total)
    return index


def _fail_rate(conv_ids: list[str], index: dict[str, tuple[int, int]]) -> Optional[float]:
    fail = total = 0
    for cid in conv_ids:
        f, t = index.get(cid, (0, 0))
        fail += f
        total += t
    if not total:
        return None
    return round(fail / total * 100, 1)


def build_profiles() -> list[dict[str, Any]]:
    conversations = load_conversations()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for conv in conversations:
        grouped.setdefault(_bot_name(conv), []).append(conv)

    labels = load_labels()
    outcomes = _outcome_index()
    profiles: list[dict[str, Any]] = []
    for name, convs in grouped.items():
        builder = sorted([c for c in convs if c.get("is_builder")], key=_first_ts)
        student = sorted([c for c in convs if not c.get("is_builder")], key=_first_ts)
        # 38 conversations in the corpus carry no usable timestamp; an undated one
        # must not sort to the front and blank out the launch boundary.
        student_stamps = [s for s in (_first_ts(c) for c in student) if s]
        first_student = min(student_stamps) if student_stamps else ""
        dated = [(c, _first_ts(c)) for c in builder if _first_ts(c)]
        undated = len(builder) - len(dated)
        if first_student:
            pre = [c for c, ts in dated if ts < first_student]
            post = [c for c, ts in dated if ts >= first_student]
        else:
            # Never deployed (or no dated student traffic): every session is pre-launch.
            pre, post = [c for c, _ in dated], []
        stamps = [ts for _, ts in dated]
        turns = [int(c.get("turns") or 0) for c in builder]
        chars = sum(
            len(m.get("content") or "")
            for c in builder
            for m in (c.get("messages") or [])
        )
        row = labels.get(name) or {}
        profiles.append(
            {
                "bot": name,
                "builder_sessions": len(builder),
                "student_conversations": len(student),
                "deployed": bool(student),
                "pre_launch_sessions": len(pre),
                "post_launch_sessions": len(post),
                "undated_sessions": undated,
                "distinct_days": len({s[:10] for s in stamps if s}),
                "bursts": _burst_groups(stamps),
                "median_turns": (sorted(turns)[len(turns) // 2] if turns else 0),
                "max_turns": max(turns) if turns else 0,
                "repeat_probe_ratio": _repeat_ratio(builder),
                "first_session": stamps[0] if stamps else "",
                "last_session": stamps[-1] if stamps else "",
                "first_student": first_student,
                "transcript_chars": chars,
                "student_fail_rate": _fail_rate(
                    [str(c.get("conv_id") or c.get("id")) for c in student], outcomes
                ),
                "label": row.get("code") or "",
                "rationale": row.get("rationale") or "",
                "confidence": row.get("confidence") or "",
                "defect_observed": row.get("defect_observed") or "",
                "source": row.get("source") or "",
                "updated_at": row.get("updated_at") or "",
            }
        )
    profiles.sort(key=lambda p: (-p["builder_sessions"], p["bot"].lower()))
    return profiles


def bot_detail(bot: str) -> dict[str, Any]:
    name = (bot or "").strip()
    conversations = load_conversations()
    convs = [c for c in conversations if _bot_name(c) == name]
    if not convs:
        raise ValueError(f"Unknown bot: {bot}")
    builder = sorted([c for c in convs if c.get("is_builder")], key=_first_ts)
    student = [c for c in convs if not c.get("is_builder")]
    student_stamps = [s for s in (_first_ts(c) for c in student) if s]
    first_student = min(student_stamps) if student_stamps else ""

    sessions = []
    for conv in builder:
        ts = _first_ts(conv)
        sessions.append(
            {
                "conv_id": str(conv.get("conv_id") or conv.get("id")),
                "started_at": ts,
                "author": conv.get("deanon_user") or conv.get("user") or "",
                "turns": conv.get("turns") or 0,
                "pre_launch": bool(ts) and (not first_student or ts < first_student),
                "url": conv.get("url") or "",
                "messages": [
                    {
                        "message_number": m.get("message_number"),
                        "role": "bot"
                        if (m.get("role") or "").lower() in {"bot", "assistant"}
                        else "user",
                        "datetime": m.get("datetime") or "",
                        "content": (m.get("content") or "")[:MAX_MESSAGE_CHARS],
                    }
                    for m in (conv.get("messages") or [])
                ],
            }
        )

    profile = next((p for p in build_profiles() if p["bot"] == name), None)
    return {
        "bot": name,
        "system_prompt": (convs[0].get("system_prompt") or "")[:MAX_SYSTEM_CHARS],
        "first_student": first_student,
        "sessions": sessions,
        "profile": profile,
    }


# --------------------------------------------------------------------------
# AI labeling
# --------------------------------------------------------------------------

def _bundle_text(detail: dict[str, Any]) -> str:
    parts = [f"BOT: {detail['bot']}"]
    sp = (detail.get("system_prompt") or "").strip()
    if sp:
        parts.append(f"SYSTEM PROMPT (what the bot is supposed to do):\n{sp}")
    else:
        parts.append("SYSTEM PROMPT: (not captured in the export)")
    fs = detail.get("first_student") or ""
    parts.append(f"FIRST STUDENT CONVERSATION: {fs or '(never deployed)'}")
    parts.append(f"AUTHOR TESTING SESSIONS ({len(detail['sessions'])}, chronological):")
    for i, s in enumerate(detail["sessions"], 1):
        tag = "pre-launch" if s["pre_launch"] else "post-launch"
        head = f"--- session {i} | {s['started_at']} | {tag} | {s['turns']} turns | author={s['author']}"
        lines = [head]
        for m in s["messages"]:
            lines.append(f"[{m['role'].upper()}] {m['content']}")
        parts.append("\n".join(lines))
    text = "\n\n".join(parts)
    if len(text) > MAX_BUNDLE_CHARS:
        text = text[:MAX_BUNDLE_CHARS] + "\n\n…[bundle truncated]"
    return text


def _system_prompt() -> str:
    try:
        book = get_codebook(CODEBOOK_ID)
        prompt = (book.get("active") or {}).get("system_prompt") or ""
        if prompt.strip():
            return prompt
    except Exception:  # noqa: BLE001
        logger.warning("Falling back: codebook %s unavailable", CODEBOOK_ID)
    return (
        "Classify how the author of this bot tested it. Respond with JSON "
        '{"code": "...", "confidence": "...", "rationale": "...", "defect_observed": "..."} '
        f"using exactly one of: {' | '.join(CODES)}."
    )


def _extract_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start : end + 1]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("model response was not a JSON object")
    return data


def _match_code(value: str) -> str:
    v = (value or "").strip().lower().replace("_", " ")
    for code in CODES:
        if v == code.lower():
            return code
    for code in CODES:
        if v and (v in code.lower() or code.lower() in v):
            return code
    raise ValueError(f"model returned an unknown code: {value!r}")


def _call_anthropic(api_key: str, model: str, system: str, user: str) -> tuple[str, dict[str, int]]:
    try:
        import anthropic
    except ImportError as err:
        raise RuntimeError("The anthropic package is not installed on the server") from err

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=1500,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "\n".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    usage = {
        "input_tokens": int(getattr(resp.usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(resp.usage, "output_tokens", 0) or 0),
    }
    return text.strip(), usage


def label_bot(bot: str, api_key: str, model: str = DEFAULT_MODEL) -> dict[str, Any]:
    detail = bot_detail(bot)
    if not detail["sessions"]:
        row = set_label(
            bot,
            "No testing",
            rationale="No builder session exists for this bot in the corpus.",
            confidence="high",
            source="ai",
        )
        return {"bot": bot, "label": row, "usage": {"input_tokens": 0, "output_tokens": 0}}

    text, usage = _call_anthropic(api_key, model, _system_prompt(), _bundle_text(detail))
    parsed = _extract_json(text)
    code = _match_code(str(parsed.get("code") or ""))
    row = set_label(
        bot,
        code,
        rationale=str(parsed.get("rationale") or ""),
        confidence=str(parsed.get("confidence") or ""),
        defect_observed=str(parsed.get("defect_observed") or ""),
        source="ai",
    )
    return {"bot": bot, "label": row, "usage": usage}


def preview(only_unlabeled: bool = True) -> dict[str, Any]:
    profiles = build_profiles()
    pending = [p for p in profiles if p["builder_sessions"] > 0]
    if only_unlabeled:
        pending = [p for p in pending if not p["label"]]
    chars = sum(p["transcript_chars"] for p in pending)
    in_tok = int(chars / CHARS_PER_TOKEN) + len(pending) * 1800
    out_tok = len(pending) * 250
    usd = in_tok / 1e6 * INPUT_USD_PER_MTOK + out_tok / 1e6 * OUTPUT_USD_PER_MTOK
    return {
        "total_bots": len(profiles),
        "labeled": sum(1 for p in profiles if p["label"]),
        "pending": len(pending),
        "pending_bots": [p["bot"] for p in pending],
        "estimated_input_tokens": in_tok,
        "estimated_output_tokens": out_tok,
        "estimated_usd": round(usd, 2),
        "model": DEFAULT_MODEL,
        "codes": CODES,
    }


def run_batch(
    api_key: str,
    *,
    batch_size: int = 3,
    model: str = DEFAULT_MODEL,
    only_unlabeled: bool = True,
) -> dict[str, Any]:
    if not (api_key or "").strip():
        raise RuntimeError("An Anthropic API key is required")

    profiles = [p for p in build_profiles() if p["builder_sessions"] > 0]
    if only_unlabeled:
        profiles = [p for p in profiles if not p["label"]]

    batch = profiles[: max(1, min(batch_size, 10))]
    results, errors = [], []
    usage_total = {"input_tokens": 0, "output_tokens": 0}
    for p in batch:
        try:
            res = label_bot(p["bot"], api_key, model=model)
            results.append(res)
            for k in usage_total:
                usage_total[k] += int(res["usage"].get(k) or 0)
        except Exception as err:  # noqa: BLE001
            logger.exception("Testing-behavior labeling failed for %s", p["bot"])
            errors.append({"bot": p["bot"], "error": str(err)})

    remaining = max(0, len(profiles) - len(batch))
    cost = (
        usage_total["input_tokens"] / 1e6 * INPUT_USD_PER_MTOK
        + usage_total["output_tokens"] / 1e6 * OUTPUT_USD_PER_MTOK
    )
    return {
        "processed": len(batch),
        "labeled": len(results),
        "failed": len(errors),
        "remaining": remaining,
        "done": remaining == 0,
        "results": results,
        "errors": errors,
        "usage": usage_total,
        "cost_usd": round(cost, 4),
    }


# --------------------------------------------------------------------------
# export
# --------------------------------------------------------------------------

EXPORT_COLUMNS = [
    "bot",
    "label",
    "confidence",
    "source",
    "rationale",
    "defect_observed",
    "builder_sessions",
    "pre_launch_sessions",
    "post_launch_sessions",
    "undated_sessions",
    "distinct_days",
    "bursts",
    "median_turns",
    "max_turns",
    "repeat_probe_ratio",
    "student_conversations",
    "student_fail_rate",
    "first_session",
    "last_session",
    "updated_at",
]


def export_rows() -> list[dict[str, Any]]:
    return [{c: p.get(c, "") for c in EXPORT_COLUMNS} for p in build_profiles()]


def export_csv() -> str:
    import csv
    import io

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for row in export_rows():
        writer.writerow({k: ("" if v is None else v) for k, v in row.items()})
    return buf.getvalue()


def export_json() -> dict[str, Any]:
    return {
        "codes": CODES,
        "exported_at": _now_iso(),
        "bots": export_rows(),
    }
