"""Per-conversation labels driven by the active codebook."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parent.parent
LABELS_PATH = ROOT / "data" / "conversation_labels.json"
TMP_LABELS_PATH = Path("/tmp/playlab_conversation_labels.json")

ALLOWED_EDITORS = {"ruiwei", "jiayi"}

_labels: dict[str, dict[str, Any]] = {}
_loaded = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_editor(name: str) -> str:
    return (name or "").strip().lower()


def can_edit(editor: str) -> bool:
    return _normalize_editor(editor) in ALLOWED_EDITORS


def _allowed_codes() -> list[str]:
    from app.codebook import active_conversation_codes

    return active_conversation_codes()


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
        code = (row.get("code") or "").strip()
        out[cid] = {
            "code": code,
            "updated_by": (row.get("updated_by") or "").strip(),
            "updated_at": (row.get("updated_at") or "").strip(),
        }
    return out


def _write_file(path: Path, labels: dict[str, dict[str, Any]]) -> bool:
    payload = {
        "codes": _allowed_codes(),
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
            if not prev or (row.get("updated_at") or "") >= (prev.get("updated_at") or ""):
                merged[cid] = row
    _labels = merged
    _loaded = True
    return _labels


def save_conversation_labels() -> None:
    _write_file(LABELS_PATH, _labels)
    _write_file(TMP_LABELS_PATH, _labels)


def list_conversation_labels() -> dict[str, Any]:
    labels = load_conversation_labels()
    return {
        "codes": _allowed_codes(),
        "editors": sorted(ALLOWED_EDITORS),
        "labels": labels,
        "count": len(labels),
    }


def set_conversation_label(conv_id: str, code: str, editor: str) -> dict[str, Any]:
    cid = (conv_id or "").strip()
    if not cid:
        raise ValueError("conv_id is required")
    editor_norm = _normalize_editor(editor)
    if editor_norm not in ALLOWED_EDITORS:
        raise PermissionError("Only ruiwei or jiayi can edit conversation labels")

    code = (code or "").strip()
    allowed = _allowed_codes()
    if code and allowed and code not in allowed:
        raise ValueError(f"Invalid code. Allowed: {', '.join(allowed)}")

    load_conversation_labels()
    if not code:
        _labels.pop(cid, None)
        save_conversation_labels()
        return {"conv_id": cid, "code": "", "updated_by": editor_norm, "updated_at": _now_iso()}

    row = {"code": code, "updated_by": editor_norm, "updated_at": _now_iso()}
    _labels[cid] = row
    save_conversation_labels()
    return {"conv_id": cid, **row}


def get_conversation_label(conv_id: str) -> Optional[dict[str, Any]]:
    return load_conversation_labels().get((conv_id or "").strip())
