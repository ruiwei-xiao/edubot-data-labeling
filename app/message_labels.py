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
USER_EXTRA_FLAGS = ["iterative"]
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


def extras_for_role(role: str) -> list[str]:
    role_l = (role or "").strip().lower()
    if role_l == "user":
        return list(USER_EXTRA_FLAGS)
    return []


def _normalize_code(code: str) -> str:
    return (code or "").strip().lower()


def _pick_code(code: str = "", codes: Any = None) -> str:
    candidates: list[str] = []
    if isinstance(codes, list):
        candidates.extend(str(v) for v in codes)
    elif isinstance(codes, str) and codes.strip():
        candidates.append(codes)
    if code:
        candidates.insert(0, code)
    for value in candidates:
        normalized = _normalize_code(value)
        if normalized in _ALL_CODES:
            return normalized
    return ""


def _normalize_iterative(row: dict[str, Any], codes: Any = None) -> bool:
    if bool(row.get("iterative")):
        return True
    extras = row.get("extras") or row.get("flags") or []
    if isinstance(extras, list):
        if any(_normalize_code(str(x)) == "iterative" for x in extras):
            return True
    values = codes if codes is not None else row.get("codes")
    if isinstance(values, list):
        if any(_normalize_code(str(x)) == "iterative" for x in values):
            return True
    return False


def _row_from_legacy(row: dict[str, Any] | str) -> Optional[dict[str, Any]]:
    if isinstance(row, str):
        code = _normalize_code(row)
        if code not in _ALL_CODES:
            return None
        return {
            "code": code,
            "codes": [code],
            "iterative": False,
            "rationale": "",
            "role": "",
            "updated_by": "",
            "updated_at": "",
        }

    if not isinstance(row, dict):
        return None

    code = _pick_code(row.get("code") or "", row.get("codes"))
    if not code or code not in _ALL_CODES:
        return None

    iterative = _normalize_iterative(row)
    codes = [code]
    if iterative:
        codes.append("iterative")

    return {
        "code": code,
        "codes": codes,
        "iterative": iterative,
        "rationale": (row.get("rationale") or "").strip(),
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
        "user_extras": USER_EXTRA_FLAGS,
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
        "user_extras": USER_EXTRA_FLAGS,
        "editors": sorted(ALLOWED_EDITORS),
        "labels": labels,
        "count": len(labels),
    }


def set_message_label(
    conv_id: str,
    message_number: Union[str, int],
    editor: str,
    role: str = "",
    code: str = "",
    codes: Any = None,
    rationale: str = "",
    iterative: bool = False,
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

    selected = _pick_code(code, codes)
    rationale_norm = (rationale or "").strip()
    iterative_on = bool(iterative) and role_l == "user"

    if selected and selected not in allowed:
        raise ValueError(
            f"Invalid code for role {role_l or 'unknown'}: {selected}. "
            f"Allowed: {', '.join(sorted(allowed))}"
        )
    if selected and not rationale_norm:
        raise ValueError("Rationale is required")
    if iterative_on and role_l != "user":
        raise ValueError("iterative is only valid for user messages")

    load_message_labels()
    key = message_key(cid, mid)
    if not selected:
        _labels.pop(key, None)
        save_message_labels()
        return {
            "key": key,
            "conv_id": cid,
            "message_number": mid,
            "code": "",
            "codes": [],
            "iterative": False,
            "rationale": "",
            "role": role_l,
            "updated_by": editor_norm,
            "updated_at": _now_iso(),
        }

    stored_codes = [selected]
    if iterative_on:
        stored_codes.append("iterative")

    row = {
        "code": selected,
        "codes": stored_codes,
        "iterative": iterative_on,
        "rationale": rationale_norm,
        "role": role_l,
        "updated_by": editor_norm,
        "updated_at": _now_iso(),
    }
    _labels[key] = row
    save_message_labels()
    return {"key": key, "conv_id": cid, "message_number": mid, **row}
