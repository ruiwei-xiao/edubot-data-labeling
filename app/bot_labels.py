from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
LABELS_PATH = ROOT / "data" / "bot_labels.json"
TMP_LABELS_PATH = Path("/tmp/playlab_bot_labels.json")

ALLOWED_EDITORS = {"ruiwei", "jiayi"}

BOT_LABEL_CODES = [
    "Iterative refinement",
    "Limited evaluation",
    "Opportunistic exploration",
    "No testing",
]

_labels: dict[str, dict[str, Any]] = {}
_loaded = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_editor(name: str) -> str:
    return (name or "").strip().lower()


def can_edit(editor: str) -> bool:
    return _normalize_editor(editor) in ALLOWED_EDITORS


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
    for bot, row in labels.items():
        if not isinstance(bot, str) or not bot.strip():
            continue
        if isinstance(row, str):
            code = row.strip()
            if code and code in BOT_LABEL_CODES:
                out[bot] = {"code": code, "updated_by": "", "updated_at": ""}
            continue
        if not isinstance(row, dict):
            continue
        code = (row.get("code") or "").strip()
        if code and code not in BOT_LABEL_CODES:
            continue
        out[bot] = {
            "code": code,
            "updated_by": (row.get("updated_by") or "").strip(),
            "updated_at": (row.get("updated_at") or "").strip(),
        }
    return out


def _write_file(path: Path, labels: dict[str, dict[str, Any]]) -> bool:
    payload = {
        "codes": BOT_LABEL_CODES,
        "labels": labels,
        "updated_at": _now_iso(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return True
    except OSError:
        return False


def load_labels(force: bool = False) -> dict[str, dict[str, Any]]:
    global _labels, _loaded
    if _loaded and not force:
        return _labels
    merged: dict[str, dict[str, Any]] = {}
    for path in (LABELS_PATH, TMP_LABELS_PATH):
        for bot, row in _read_file(path).items():
            prev = merged.get(bot)
            if not prev or (row.get("updated_at") or "") >= (prev.get("updated_at") or ""):
                merged[bot] = row
    _labels = merged
    _loaded = True
    return _labels


def save_labels() -> None:
    # Prefer repo path locally; always try /tmp for Vercel warm instances.
    _write_file(LABELS_PATH, _labels)
    _write_file(TMP_LABELS_PATH, _labels)


def list_labels() -> dict[str, Any]:
    labels = load_labels()
    return {
        "codes": BOT_LABEL_CODES,
        "editors": sorted(ALLOWED_EDITORS),
        "labels": labels,
        "count": len(labels),
    }


def set_bot_label(bot_title: str, code: str, editor: str) -> dict[str, Any]:
    bot = (bot_title or "").strip()
    if not bot:
        raise ValueError("bot_title is required")

    editor_norm = _normalize_editor(editor)
    if editor_norm not in ALLOWED_EDITORS:
        raise PermissionError("Only ruiwei or jiayi can edit bot labels")

    code = (code or "").strip()
    if code and code not in BOT_LABEL_CODES:
        raise ValueError(f"Invalid code. Allowed: {', '.join(BOT_LABEL_CODES)}")

    load_labels()
    if not code:
        _labels.pop(bot, None)
        save_labels()
        return {"bot_title": bot, "code": "", "updated_by": editor_norm, "updated_at": _now_iso()}

    row = {
        "code": code,
        "updated_by": editor_norm,
        "updated_at": _now_iso(),
    }
    _labels[bot] = row
    save_labels()
    return {"bot_title": bot, **row}


def get_bot_label(bot_title: str) -> Optional[dict[str, Any]]:
    return load_labels().get((bot_title or "").strip())
