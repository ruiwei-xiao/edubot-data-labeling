"""Per-conversation defect labels (multi-select codebook)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
LABELS_PATH = ROOT / "data" / "conversation_labels.json"
TMP_LABELS_PATH = Path("/tmp/playlab_conversation_labels.json")

ALLOWED_EDITORS = {"naacl_label1", "naacl_label2"}

# Primary → secondary codes with definitions (hover text).
CONVERSATION_DEFECT_CODES: list[dict[str, str]] = [
    {
        "id": "F1",
        "primary": "Factual",
        "label": "Incorrect content (hallucination)",
        "definition": "The bot states false, fabricated, or miscalculated information, or misgrades a student answer.",
    },
    {
        "id": "F2",
        "primary": "Factual",
        "label": "Incomplete or imprecise content",
        "definition": "The bot's content is not wrong but omits a required element or is too vague to support the goal in the system prompt.",
    },
    {
        "id": "F3",
        "primary": "Factual",
        "label": "Internal inconsistency",
        "definition": "The bot contradicts something it said earlier in the same conversation.",
    },
    {
        "id": "F4",
        "primary": "Factual",
        "label": "Grounding failure",
        "definition": "The bot ignores or misreads course material or context supplied in the system prompt or uploaded by the builder.",
    },
    {
        "id": "F5",
        "primary": "Factual (scope)",
        "label": "Guardrail breach",
        "definition": "The bot performs an action the system prompt explicitly forbids.",
    },
    {
        "id": "F6",
        "primary": "Factual (scope)",
        "label": "Off-task drift",
        "definition": "The bot follows the student away from the bot's stated purpose and does not redirect.",
    },
    {
        "id": "F7",
        "primary": "Factual (scope)",
        "label": "Over-refusal",
        "definition": "The bot refuses or deflects an in-scope request by misapplying a guardrail.",
    },
    {
        "id": "W1",
        "primary": "Workflow",
        "label": "Student abandonment",
        "definition": "The student stops responding before the goal is reached; the last turn is the bot's.",
    },
    {
        "id": "W2",
        "primary": "Workflow",
        "label": "Unanswered student question",
        "definition": "The bot ignores or deflects a direct student question and continues its own script.",
    },
    {
        "id": "W3",
        "primary": "Workflow",
        "label": "Unanswered bot question",
        "definition": "The student does not answer the bot's question and the bot neither re-asks nor adapts; the thread is dropped.",
    },
    {
        "id": "W4",
        "primary": "Workflow",
        "label": "Broken or truncated output",
        "definition": "The bot's response is cut off, empty, or unreadable due to formatting (e.g., raw LaTeX, broken markdown).",
    },
    {
        "id": "W5",
        "primary": "Workflow",
        "label": "Repetition loop",
        "definition": "The bot repeats the same question or explanation across consecutive turns without progress.",
    },
    {
        "id": "W6",
        "primary": "Workflow",
        "label": "Multi-question overload",
        "definition": "The bot asks several questions in one turn; the student answers at most one and the rest are lost.",
    },
    {
        "id": "W7",
        "primary": "Workflow",
        "label": "Skipped or missing structure",
        "definition": "The bot fails to follow a workflow step defined in the system prompt (e.g., skips a required opening, diagnosis, or wrap-up step).",
    },
    {
        "id": "W8",
        "primary": "Workflow",
        "label": "Language or format mismatch",
        "definition": "The bot responds in a language or output format that contradicts the system prompt or the student's input.",
    },
    {
        "id": "D1",
        "primary": "Diagnose",
        "label": "No diagnosis before instruction",
        "definition": "The bot begins teaching or giving feedback without eliciting the student's prior knowledge or current attempt when the prompt expects it.",
    },
    {
        "id": "D2",
        "primary": "Diagnose",
        "label": "Misjudged level",
        "definition": "The bot's explanation is pitched too high or too low for the student's demonstrated level.",
    },
    {
        "id": "D3",
        "primary": "Diagnose",
        "label": "Missed error (false positive)",
        "definition": "The bot fails to notice a student mistake or affirms an incorrect answer.",
    },
    {
        "id": "D4",
        "primary": "Diagnose",
        "label": "False error (false negative)",
        "definition": "The bot marks a correct student answer as wrong.",
    },
    {
        "id": "D5",
        "primary": "Diagnose",
        "label": "Ignored learner signal",
        "definition": "The student explicitly signals confusion, frustration, or a time constraint and the bot proceeds unchanged.",
    },
    {
        "id": "D6",
        "primary": "Diagnose",
        "label": "Misidentified request",
        "definition": "The bot misreads what the student is actually asking for (task type or intent).",
    },
    {
        "id": "P1",
        "primary": "Pedagogical",
        "label": "Answer dumping (too early)",
        "definition": "The bot reveals the full solution before the student has attempted the task when the prompt calls for guided help.",
    },
    {
        "id": "P2",
        "primary": "Pedagogical",
        "label": "Over-scaffolding (too many rounds)",
        "definition": "The bot keeps asking guiding questions when the student is clearly stuck or the question is factual/logistical, withholding information unproductively.",
    },
    {
        "id": "P3",
        "primary": "Pedagogical",
        "label": "Cognitive overload (verbosity)",
        "definition": "The bot delivers too much content at once relative to the student's level or the task.",
    },
    {
        "id": "P4",
        "primary": "Pedagogical",
        "label": "Strategy-task mismatch (refer to kli/blooms)",
        "definition": "The instructional approach does not fit the task type.",
    },
    {
        "id": "P5",
        "primary": "Pedagogical",
        "label": "No engagement opportunity",
        "definition": "The bot explains passively with no questions, prompts, or openings for the student to act.",
    },
    {
        "id": "P6",
        "primary": "Pedagogical",
        "label": "Poor feedback quality",
        "definition": "Feedback is vague, does not acknowledge correct parts, or is delivered in a discouraging way.",
    },
    {
        "id": "P7",
        "primary": "Pedagogical",
        "label": "Failure to recover",
        "definition": "After the student corrects the bot or pushes back, the bot does not adjust its strategy or content.",
    },
]

_CODE_ORDER = {row["id"]: i for i, row in enumerate(CONVERSATION_DEFECT_CODES)}
_ALLOWED_IDS = set(_CODE_ORDER)

_labels: dict[str, dict[str, Any]] = {}
_loaded = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_editor(name: str) -> str:
    return (name or "").strip().lower()


def can_edit(editor: str) -> bool:
    return _normalize_editor(editor) in ALLOWED_EDITORS


def conversation_code_options() -> list[dict[str, str]]:
    return [dict(row) for row in CONVERSATION_DEFECT_CODES]


def active_conversation_codes() -> list[str]:
    return [row["id"] for row in CONVERSATION_DEFECT_CODES]


def _normalize_codes(raw: Any, fallback_code: str = "") -> list[str]:
    codes: list[str] = []
    if isinstance(raw, list):
        for item in raw:
            c = str(item or "").strip()
            if c and c not in codes:
                codes.append(c)
    single = (fallback_code or "").strip()
    if single and single not in codes:
        codes.append(single)
    # Keep only known codes, preserve codebook order
    known = [c for c in codes if c in _ALLOWED_IDS]
    known.sort(key=lambda c: _CODE_ORDER.get(c, 999))
    return known


def _normalize_editor_row(row: dict[str, Any], editor: str = "") -> dict[str, Any]:
    codes = _normalize_codes(row.get("codes"), row.get("code") or "")
    return {
        "codes": codes,
        "code": codes[0] if codes else "",
        "updated_by": (row.get("updated_by") or editor or "").strip(),
        "updated_at": (row.get("updated_at") or "").strip(),
    }


def _normalize_conv_record(row: dict[str, Any]) -> dict[str, Any]:
    """Support legacy single-row labels and per-editor `by` maps."""
    if not isinstance(row, dict):
        return {"by": {}}
    by_raw = row.get("by")
    by: dict[str, dict[str, Any]] = {}
    if isinstance(by_raw, dict):
        for ed, sub in by_raw.items():
            ed_norm = _normalize_editor(str(ed))
            if not ed_norm or not isinstance(sub, dict):
                continue
            by[ed_norm] = _normalize_editor_row(sub, ed_norm)
    # Legacy flat row -> migrate under updated_by / unknown
    if not by and (row.get("codes") or row.get("code")):
        ed = _normalize_editor(row.get("updated_by") or "")
        if not ed:
            ed = "legacy"
        by[ed] = _normalize_editor_row(row, ed)
    return {"by": by}


def _flatten_for_editor(record: dict[str, Any], editor: str = "") -> Optional[dict[str, Any]]:
    by = (record or {}).get("by") or {}
    ed = _normalize_editor(editor)
    if ed and ed in by:
        return dict(by[ed])
    if ed:
        return None
    # No editor requested: return most recently updated label
    best: Optional[dict[str, Any]] = None
    for sub in by.values():
        if not best or (sub.get("updated_at") or "") >= (best.get("updated_at") or ""):
            best = sub
    return dict(best) if best else None


def _read_file(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    labels = data.get("labels", data) if isinstance(data, dict) else {}
    if not isinstance(labels, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for cid, row in labels.items():
        if not isinstance(cid, str) or not cid.strip():
            continue
        if not isinstance(row, dict):
            continue
        out[cid] = _normalize_conv_record(row)
    return out


def _write_file(path: Path, labels: dict[str, dict[str, Any]]) -> bool:
    payload = {
        "codes": active_conversation_codes(),
        "code_options": conversation_code_options(),
        "labels": labels,
        "updated_at": _now_iso(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return True
    except OSError:
        return False


def load_conversation_labels(force: bool = False) -> dict[str, dict[str, Any]]:
    global _labels, _loaded
    if _loaded and not force:
        return _labels
    merged: dict[str, dict[str, Any]] = {}
    for path in (LABELS_PATH, TMP_LABELS_PATH):
        for cid, row in _read_file(path).items():
            prev = merged.get(cid)
            if not prev:
                merged[cid] = row
                continue
            # Merge per-editor maps, keep newer timestamp per editor
            by = dict((prev.get("by") or {}))
            for ed, sub in (row.get("by") or {}).items():
                old = by.get(ed)
                if not old or (sub.get("updated_at") or "") >= (old.get("updated_at") or ""):
                    by[ed] = sub
            merged[cid] = {"by": by}
    _labels = merged
    _loaded = True
    return _labels


def save_conversation_labels() -> None:
    _write_file(LABELS_PATH, _labels)
    _write_file(TMP_LABELS_PATH, _labels)


def list_conversation_labels(editor: str = "") -> dict[str, Any]:
    labels = load_conversation_labels()
    ed = _normalize_editor(editor)
    flat = {}
    for cid, record in labels.items():
        if ed:
            row = _flatten_for_editor(record, ed)
            if row:
                flat[cid] = row
        else:
            flat[cid] = {
                "by": record.get("by") or {},
                **(_flatten_for_editor(record) or {}),
            }
    return {
        "codes": active_conversation_codes(),
        "code_options": conversation_code_options(),
        "editors": sorted(ALLOWED_EDITORS),
        "labels": flat,
        "count": len(flat),
    }


def set_conversation_label(
    conv_id: str,
    editor: str,
    code: str = "",
    codes: Optional[list[str]] = None,
    title: str = "",
) -> dict[str, Any]:
    cid = (conv_id or "").strip()
    if not cid:
        raise ValueError("conv_id is required")
    editor_norm = _normalize_editor(editor)
    if editor_norm not in ALLOWED_EDITORS:
        raise PermissionError("Only naacl_label1 or naacl_label2 can edit conversation labels")

    normalized = _normalize_codes(codes if codes is not None else [], code)
    unknown = []
    if codes is not None:
        for item in codes:
            c = str(item or "").strip()
            if c and c not in _ALLOWED_IDS:
                unknown.append(c)
    if code and code.strip() and code.strip() not in _ALLOWED_IDS:
        unknown.append(code.strip())
    if unknown:
        raise ValueError(f"Invalid code(s): {', '.join(sorted(set(unknown)))}")

    load_conversation_labels()
    record = _labels.get(cid) or {"by": {}}
    by = dict(record.get("by") or {})
    now = _now_iso()

    if not normalized:
        by.pop(editor_norm, None)
        if by:
            _labels[cid] = {"by": by}
        else:
            _labels.pop(cid, None)
        save_conversation_labels()
        sheet = _sync_sheet(cid, editor_norm, [], now, title=title)
        return {
            "conv_id": cid,
            "codes": [],
            "code": "",
            "updated_by": editor_norm,
            "updated_at": now,
            "sheet_sync": sheet,
        }

    row = {
        "codes": normalized,
        "code": normalized[0],
        "updated_by": editor_norm,
        "updated_at": now,
    }
    by[editor_norm] = row
    _labels[cid] = {"by": by}
    save_conversation_labels()
    sheet = _sync_sheet(cid, editor_norm, normalized, now, title=title)
    return {"conv_id": cid, **row, "sheet_sync": sheet}


def _sync_sheet(
    conv_id: str,
    editor: str,
    codes: list[str],
    updated_at: str,
    title: str = "",
) -> dict[str, Any]:
    try:
        from app.conversation_sheet_labels import try_write_conversation_label_to_sheet

        return try_write_conversation_label_to_sheet(
            conv_id=conv_id,
            editor=editor,
            codes=codes,
            updated_at=updated_at,
            title=title,
        )
    except Exception as err:  # noqa: BLE001
        return {"ok": False, "error": str(err)}


def get_conversation_label(conv_id: str, editor: str = "") -> Optional[dict[str, Any]]:
    record = load_conversation_labels().get((conv_id or "").strip())
    if not record:
        return None
    return _flatten_for_editor(record, editor)
