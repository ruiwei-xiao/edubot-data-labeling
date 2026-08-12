from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

ROOT = Path(__file__).resolve().parent.parent
LABELS_PATH = ROOT / "data" / "message_labels.json"
TMP_LABELS_PATH = Path("/tmp/playlab_message_labels.json")

ALLOWED_EDITORS = {"ruiwei", "jiayi"}

BOT_MESSAGE_CODES = ["success", "fail", "others"]
USER_MESSAGE_CODES = ["desired", "adversarial", "others"]
_ALL_CODES = set(BOT_MESSAGE_CODES + USER_MESSAGE_CODES)

_labels: dict[str, dict[str, Any]] = {}
_loaded = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_editor(name: str) -> str:
    return (name or "").strip().lower()


def can_edit(editor: str) -> bool:
    return _normalize_editor(editor) in ALLOWED_EDITORS


def message_key(conv_id: str, message_number: Union[str, int]) -> str:
    return f"{str(conv_id).strip()}:{str(message_number).strip()}"


def codes_for_role(role: str) -> list[str]:
    role_l = (role or "").strip().lower()
    if role_l in {"bot", "assistant"}:
        return list(BOT_MESSAGE_CODES)
    if role_l == "user":
        return list(USER_MESSAGE_CODES)
    return []


def _normalize_code(code: str) -> str:
    return (code or "").strip().lower()


def _normalize_codes(raw: Any) -> list[str]:
    values: list[str] = []
    if isinstance(raw, str):
        values = [raw]
    elif isinstance(raw, list):
        values = [str(v) for v in raw]
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        code = _normalize_code(value)
        if not code or code not in _ALL_CODES or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


def _row_from_legacy(row: dict[str, Any] | str) -> Optional[dict[str, Any]]:
    if isinstance(row, str):
        codes = _normalize_codes(row)
        if not codes:
            return None
        return {"codes": codes, "code": codes[0], "role": "", "updated_by": "", "updated_at": ""}

    if not isinstance(row, dict):
        return None

    codes = _normalize_codes(row.get("codes"))
    if not codes:
        codes = _normalize_codes(row.get("code"))
    if not codes:
        return None

    return {
        "codes": codes,
        "code": codes[0],
        "role": (row.get("role") or "").strip().lower(),
        "updated_by": (row.get("updated_by") or "").strip(),
        "updated_at": (row.get("updated_at") or "").strip(),
    }


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
    for key, row in labels.items():
        if not isinstance(key, str) or not key.strip():
            continue
        normalized = _row_from_legacy(row)
        if normalized:
            out[key] = normalized
    return out


def _write_file(path: Path, labels: dict[str, dict[str, Any]]) -> bool:
    payload = {
        "bot_codes": BOT_MESSAGE_CODES,
        "user_codes": USER_MESSAGE_CODES,
        "labels": labels,
        "updated_at": _now_iso(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return True
    except OSError:
        return False


def load_message_labels(force: bool = False) -> dict[str, dict[str, Any]]:
    global _labels, _loaded
    if _loaded and not force:
        return _labels
    merged: dict[str, dict[str, Any]] = {}
    for path in (LABELS_PATH, TMP_LABELS_PATH):
        for key, row in _read_file(path).items():
            prev = merged.get(key)
            if not prev or (row.get("updated_at") or "") >= (prev.get("updated_at") or ""):
                merged[key] = row
    _labels = merged
    _loaded = True
    return _labels


def save_message_labels() -> None:
    _write_file(LABELS_PATH, _labels)
    _write_file(TMP_LABELS_PATH, _labels)


def list_message_labels(conv_id: Optional[str] = None) -> dict[str, Any]:
    labels = load_message_labels()
    if conv_id:
        prefix = f"{str(conv_id).strip()}:"
        labels = {k: v for k, v in labels.items() if k.startswith(prefix)}
    return {
        "bot_codes": BOT_MESSAGE_CODES,
        "user_codes": USER_MESSAGE_CODES,
        "editors": sorted(ALLOWED_EDITORS),
        "labels": labels,
        "count": len(labels),
    }


def set_message_label(
    conv_id: str,
    message_number: Union[str, int],
    codes: Any,
    editor: str,
    role: str = "",
    code: str = "",
) -> dict[str, Any]:
    cid = (conv_id or "").strip()
    mid = str(message_number).strip()
    if not cid or not mid:
        raise ValueError("conv_id and message_number are required")

    editor_norm = _normalize_editor(editor)
    if editor_norm not in ALLOWED_EDITORS:
        raise PermissionError("Only ruiwei or jiayi can edit message labels")

    role_l = (role or "").strip().lower()
    allowed = set(codes_for_role(role_l) if role_l else list(_ALL_CODES))

    selected = _normalize_codes(codes if codes not in (None, "", []) else code)
    invalid = [c for c in selected if c not in allowed]
    if invalid:
        raise ValueError(
            f"Invalid code(s) for role {role_l or 'unknown'}: {', '.join(invalid)}. "
            f"Allowed: {', '.join(sorted(allowed))}"
        )

    # Keep role order stable
    order = codes_for_role(role_l) if role_l else list(BOT_MESSAGE_CODES + USER_MESSAGE_CODES)
    selected = [c for c in order if c in set(selected)]

    load_message_labels()
    key = message_key(cid, mid)
    if not selected:
        _labels.pop(key, None)
        save_message_labels()
        return {
            "key": key,
            "conv_id": cid,
            "message_number": mid,
            "codes": [],
            "code": "",
            "role": role_l,
            "updated_by": editor_norm,
            "updated_at": _now_iso(),
        }

    row = {
        "codes": selected,
        "code": selected[0],
        "role": role_l,
        "updated_by": editor_norm,
        "updated_at": _now_iso(),
    }
    _labels[key] = row
    save_message_labels()
    return {"key": key, "conv_id": cid, "message_number": mid, **row}
