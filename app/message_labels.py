from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

ROOT = Path(__file__).resolve().parent.parent
LABELS_PATH = ROOT / "data" / "message_labels.json"
TMP_LABELS_PATH = Path("/tmp/playlab_message_labels.json")
SHEET_LABELS_CACHE_PATH = Path("/tmp/playlab_message_labels_sheet.json")
SHEET_SYNC_TTL_SEC = 60.0

ALLOWED_EDITORS = {"ruiwei", "jiayi", "sonnet"}
AI_EDITOR = "sonnet"

BOT_MESSAGE_CODES = ["success", "fail", "others"]
USER_MESSAGE_CODES = ["desired", "adversarial", "others"]
USER_EXTRA_FLAGS = ["iterative"]
_ALL_CODES = set(BOT_MESSAGE_CODES + USER_MESSAGE_CODES)

LABEL_SHEET_COLUMNS = {
    "ruiwei": ("ruiwei_labeling", "ruiwei_rationale"),
    "jiayi": ("jiayi_labeling", "jiayi_rationale"),
}

_labels: dict[str, dict[str, Any]] = {}
_loaded = False
_sheet_synced_at = 0.0
logger = logging.getLogger(__name__)


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
    try:
        from app.codebook import active_codes_for_role

        codes = active_codes_for_role(role_l)
        if codes:
            return codes
    except Exception:  # noqa: BLE001
        pass
    if role_l in {"bot", "assistant"}:
        return list(BOT_MESSAGE_CODES)
    if role_l == "user":
        return list(USER_MESSAGE_CODES)
    return []


def extras_for_role(role: str) -> list[str]:
    role_l = (role or "").strip().lower()
    if role_l != "user":
        return []
    try:
        from app.codebook import active_user_flags

        flags = active_user_flags()
        if flags:
            return flags
    except Exception:  # noqa: BLE001
        pass
    return list(USER_EXTRA_FLAGS)


def _normalize_code(code: str) -> str:
    return (code or "").strip().lower()


def _pick_code(code: str = "", codes: Any = None, allowed: Optional[set[str]] = None) -> str:
    candidates: list[str] = []
    if isinstance(codes, list):
        candidates.extend(str(v) for v in codes)
    elif isinstance(codes, str) and codes.strip():
        candidates.append(codes)
    if code:
        candidates.insert(0, code)
    allow = allowed if allowed is not None else set(_ALL_CODES)
    for value in candidates:
        normalized = _normalize_code(value)
        if not normalized:
            continue
        if normalized == "iterative":
            continue
        if normalized in allow or not allow:
            return normalized
        # Also accept original casing match for non-lower codes
        raw = str(value).strip()
        if raw in allow:
            return raw
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


def _editor_entry(row: dict[str, Any] | str, editor: str = "") -> Optional[dict[str, Any]]:
    normalized = _row_from_legacy(row)
    if not normalized:
        return None
    ed = _normalize_editor(editor or normalized.get("updated_by") or "")
    if ed not in ALLOWED_EDITORS:
        return None
    normalized["updated_by"] = ed
    return normalized


def _coerce_store_row(row: Any) -> dict[str, Any]:
    """Normalize stored label to {by: {editor: entry}}."""
    if isinstance(row, dict) and isinstance(row.get("by"), dict):
        by: dict[str, dict[str, Any]] = {}
        for ed, erow in row["by"].items():
            entry = _editor_entry(erow, str(ed))
            if entry:
                by[entry["updated_by"]] = entry
        return {"by": by}

    entry = _editor_entry(row)
    if not entry:
        return {"by": {}}
    return {"by": {entry["updated_by"]: entry}}


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
        store = _coerce_store_row(row)
        if store.get("by"):
            out[key] = store
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


def parse_sheet_label_value(raw: str) -> tuple[str, bool]:
    """Parse sheet cell like 'desired' or 'desired|iterative'."""
    text = (raw or "").strip()
    if not text:
        return "", False
    parts = [p.strip() for p in text.split("|") if p.strip()]
    iterative = any(_normalize_code(p) == "iterative" for p in parts)
    code = ""
    for part in parts:
        normalized = _normalize_code(part)
        if normalized in _ALL_CODES:
            code = normalized
            break
    return code, iterative


def build_message_labels_from_csv_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Build {conv:msg -> {by: {editor: entry}}} from all_data_origin rows."""
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        cid = str(row.get("conv_id") or "").strip()
        mid = str(row.get("message_number") or "").strip()
        if not cid or not mid:
            continue
        role = str(row.get("role") or "").strip().lower()
        by: dict[str, dict[str, Any]] = {}
        for editor, (label_col, rationale_col) in LABEL_SHEET_COLUMNS.items():
            code, iterative = parse_sheet_label_value(str(row.get(label_col) or ""))
            if not code:
                continue
            codes = [code]
            if iterative:
                codes.append("iterative")
            by[editor] = {
                "code": code,
                "codes": codes,
                "iterative": iterative,
                "rationale": str(row.get(rationale_col) or "").strip(),
                "role": role,
                "updated_by": editor,
                "updated_at": "",
                "source": "sheet",
            }
        if by:
            out[message_key(cid, mid)] = {"by": by}
    return out


def build_message_labels_from_csv_text(text: str) -> dict[str, dict[str, Any]]:
    from app.conversations_loader import parse_csv_text

    return build_message_labels_from_csv_rows(parse_csv_text(text))


def save_message_labels_snapshot(labels: dict[str, dict[str, Any]], path: Optional[Path] = None) -> bool:
    return _write_file(path or LABELS_PATH, labels)


def _merge_label_stores(
    base: dict[str, dict[str, Any]],
    incoming: dict[str, dict[str, Any]],
    *,
    sheet_wins_nonempty: bool = False,
) -> dict[str, dict[str, Any]]:
    for key, store in incoming.items():
        prev = base.get(key) or {"by": {}}
        by = dict(prev.get("by") or {})
        for ed, entry in (store.get("by") or {}).items():
            older = by.get(ed)
            if sheet_wins_nonempty and _row_has_code(entry):
                by[ed] = entry
            elif not older or (entry.get("updated_at") or "") >= (older.get("updated_at") or ""):
                by[ed] = entry
        if by:
            base[key] = {"by": by}
    return base


def fetch_message_labels_from_sheet() -> dict[str, dict[str, Any]]:
    from app.conversations_loader import fetch_sheet_csv

    return build_message_labels_from_csv_text(fetch_sheet_csv())


def ensure_sheet_labels_synced(force: bool = False) -> None:
    """Merge Google Sheet labeling columns into in-memory labels."""
    global _labels, _sheet_synced_at
    now = time.time()
    if not force:
        # Normal reads use local JSON (+ optional sheet cache file). Network sync
        # only runs on explicit refresh so page loads stay instant.
        if SHEET_LABELS_CACHE_PATH.exists():
            sheet_labels = _read_file(SHEET_LABELS_CACHE_PATH)
            if sheet_labels:
                _merge_label_stores(_labels, sheet_labels, sheet_wins_nonempty=True)
        return

    if _sheet_synced_at and (now - _sheet_synced_at) < SHEET_SYNC_TTL_SEC:
        return

    sheet_labels: dict[str, dict[str, Any]] = {}
    try:
        sheet_labels = fetch_message_labels_from_sheet()
        _write_file(SHEET_LABELS_CACHE_PATH, sheet_labels)
    except Exception:  # noqa: BLE001 - sheet sync is best-effort
        logger.exception("Failed to sync message labels from Google Sheet")
        if SHEET_LABELS_CACHE_PATH.exists():
            sheet_labels = _read_file(SHEET_LABELS_CACHE_PATH)
        _sheet_synced_at = now
        if sheet_labels:
            _merge_label_stores(_labels, sheet_labels, sheet_wins_nonempty=True)
        return

    _merge_label_stores(_labels, sheet_labels, sheet_wins_nonempty=True)
    _sheet_synced_at = now


def load_message_labels(force: bool = False) -> dict[str, dict[str, Any]]:
    global _labels, _loaded
    if not _loaded or force:
        merged: dict[str, dict[str, Any]] = {}
        for path in (LABELS_PATH, TMP_LABELS_PATH):
            _merge_label_stores(merged, _read_file(path))
        _labels = merged
        _loaded = True
    ensure_sheet_labels_synced(force=force)
    return _labels


def save_message_labels() -> None:
    _write_file(LABELS_PATH, _labels)
    _write_file(TMP_LABELS_PATH, _labels)


def _flatten_labels_for_editor(
    labels: dict[str, dict[str, Any]],
    editor: str,
) -> dict[str, dict[str, Any]]:
    ed = _normalize_editor(editor)
    out: dict[str, dict[str, Any]] = {}
    if ed not in ALLOWED_EDITORS:
        return out
    for key, store in labels.items():
        entry = (store.get("by") or {}).get(ed)
        if entry and _row_has_code(entry):
            out[key] = dict(entry)
        elif entry:
            out[key] = dict(entry)
    return out


def list_message_labels(
    conv_id: Optional[str] = None,
    editor: Optional[str] = None,
) -> dict[str, Any]:
    labels = load_message_labels()
    if conv_id:
        prefix = f"{str(conv_id).strip()}:"
        labels = {k: v for k, v in labels.items() if k.startswith(prefix)}
    ed = _normalize_editor(editor or "")
    if ed in ALLOWED_EDITORS:
        flat = _flatten_labels_for_editor(labels, ed)
    else:
        # No editor: expose empty flat map for UI; keep editors list.
        flat = {}
    return {
        "bot_codes": BOT_MESSAGE_CODES,
        "user_codes": USER_MESSAGE_CODES,
        "user_extras": USER_EXTRA_FLAGS,
        "editors": sorted(ALLOWED_EDITORS),
        "labels": flat,
        "count": len(flat),
        "editor": ed if ed in ALLOWED_EDITORS else "",
    }


def _row_has_code(row: dict[str, Any]) -> bool:
    code = _normalize_code(str(row.get("code") or ""))
    if code:
        return True
    codes = row.get("codes") or []
    if isinstance(codes, list):
        return bool(_pick_code("", codes))
    return False


def labeled_message_numbers_by_conv(editor: Optional[str] = None) -> dict[str, set[str]]:
    """conv_id -> set of message_number strings coded by this editor."""
    ed = _normalize_editor(editor or "")
    if ed not in ALLOWED_EDITORS:
        return {}
    out: dict[str, set[str]] = {}
    for key, store in load_message_labels().items():
        entry = (store.get("by") or {}).get(ed)
        if not entry or not _row_has_code(entry):
            continue
        parts = str(key).split(":", 1)
        if len(parts) != 2:
            continue
        cid, mid = parts[0].strip(), parts[1].strip()
        if cid and mid:
            out.setdefault(cid, set()).add(mid)
    return out


def disagreed_message_numbers_by_conv() -> dict[str, set[str]]:
    """conv_id -> message numbers where the two coders gave different codes."""
    out: dict[str, set[str]] = {}
    for key, store in load_message_labels().items():
        by = (store or {}).get("by") or {}
        codes = {
            _normalize_code(str((entry or {}).get("code") or ""))
            for entry in by.values()
            if (entry or {}).get("code")
        }
        if len(codes) < 2:
            continue
        parts = str(key).split(":", 1)
        if len(parts) != 2:
            continue
        cid, mid = parts[0].strip(), parts[1].strip()
        if cid and mid:
            out.setdefault(cid, set()).add(mid)
    return out


def disagreement_details(conv_id: str) -> dict[str, list[dict[str, Any]]]:
    """message number -> each coder's code/rationale, for disagreed messages only."""
    prefix = f"{str(conv_id).strip()}:"
    out: dict[str, list[dict[str, Any]]] = {}
    for key, store in load_message_labels().items():
        if not key.startswith(prefix):
            continue
        by = (store or {}).get("by") or {}
        rows = []
        for editor, entry in by.items():
            code = _normalize_code(str((entry or {}).get("code") or ""))
            if not code:
                continue
            rows.append(
                {
                    "editor": editor,
                    "code": code,
                    "iterative": bool(_normalize_iterative(entry or {})),
                    "rationale": str((entry or {}).get("rationale") or "").strip(),
                    "updated_at": str((entry or {}).get("updated_at") or ""),
                }
            )
        if len({r["code"] for r in rows}) < 2:
            continue
        rows.sort(key=lambda r: r["editor"])
        out[key.split(":", 1)[1].strip()] = rows
    return out


def labelable_message_numbers(conv: dict[str, Any]) -> list[str]:
    """Message numbers that require a coding label (user / bot / assistant)."""
    out: list[str] = []
    for msg in conv.get("messages") or []:
        role = (msg.get("role") or "").strip().lower()
        if role not in {"user", "bot", "assistant"}:
            continue
        mid = str(msg.get("message_number") or "").strip()
        if mid:
            out.append(mid)
    return out


def coded_conversation_ids(
    conversations: Optional[list[dict[str, Any]]] = None,
    labeled_by_conv: Optional[dict[str, set[str]]] = None,
    editor: Optional[str] = None,
) -> set[str]:
    """Conversations fully coded by this editor."""
    ed = _normalize_editor(editor or "")
    if ed not in ALLOWED_EDITORS:
        return set()
    if conversations is None:
        from app.conversations_loader import load_conversations

        conversations = list(load_conversations())
    labeled = (
        labeled_by_conv
        if labeled_by_conv is not None
        else labeled_message_numbers_by_conv(ed)
    )
    out: set[str] = set()
    for conv in conversations:
        cid = str(conv.get("id") or conv.get("conv_id") or "").strip()
        if not cid:
            continue
        required = labelable_message_numbers(conv)
        if not required:
            continue
        have = labeled.get(cid) or set()
        if all(mid in have for mid in required):
            out.add(cid)
    return out


def conversation_is_coded(
    conv_or_id: Any,
    coded_ids: Optional[set[str]] = None,
    *,
    labeled_by_conv: Optional[dict[str, set[str]]] = None,
    editor: Optional[str] = None,
) -> bool:
    ed = _normalize_editor(editor or "")
    if isinstance(conv_or_id, dict):
        cid = str(conv_or_id.get("id") or conv_or_id.get("conv_id") or "").strip()
        if coded_ids is not None:
            return cid in coded_ids
        if ed not in ALLOWED_EDITORS:
            return False
        required = labelable_message_numbers(conv_or_id)
        if not required:
            return False
        labeled = (
            labeled_by_conv
            if labeled_by_conv is not None
            else labeled_message_numbers_by_conv(ed)
        )
        have = labeled.get(cid) or set()
        return all(mid in have for mid in required)

    cid = str(conv_or_id or "").strip()
    if not cid or ed not in ALLOWED_EDITORS:
        return False
    ids = coded_ids if coded_ids is not None else coded_conversation_ids(editor=ed)
    return cid in ids


def is_sample_conversation(conv_id: str) -> bool:
    """Sample set: conv_id % 10 == 1."""
    raw = str(conv_id or "").strip()
    if not raw.isdigit():
        return False
    return int(raw) % 10 == 1


def conversation_coding_status(
    conv_or_id: Any,
    coded_ids: Optional[set[str]] = None,
    *,
    editor: Optional[str] = None,
) -> str:
    """Return coding bucket for one editor: coded | uncoded | not_sampled."""
    if isinstance(conv_or_id, dict):
        cid = str(conv_or_id.get("id") or conv_or_id.get("conv_id") or "").strip()
        conv = conv_or_id
    else:
        cid = str(conv_or_id or "").strip()
        conv = cid
    if not is_sample_conversation(cid):
        return "not_sampled"
    if conversation_is_coded(conv, coded_ids, editor=editor):
        return "coded"
    return "uncoded"


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
    # Always accept legacy hardcoded codes so old labels remain editable.
    allowed |= set(_ALL_CODES)

    selected = _pick_code(code, codes, allowed=allowed)
    rationale_norm = (rationale or "").strip()
    iterative_on = bool(iterative) and role_l == "user"

    if selected and selected not in allowed:
        raise ValueError(
            f"Invalid code for role {role_l or 'unknown'}: {selected}. "
            f"Allowed: {', '.join(sorted(allowed))}"
        )
    if iterative_on and role_l != "user":
        raise ValueError("iterative is only valid for user messages")

    load_message_labels()
    key = message_key(cid, mid)
    store = _coerce_store_row(_labels.get(key) or {"by": {}})
    by = dict(store.get("by") or {})

    if not selected:
        by.pop(editor_norm, None)
        if by:
            _labels[key] = {"by": by}
        else:
            _labels.pop(key, None)
        save_message_labels()
        try:
            from app.sheet_labels import try_write_message_label_to_sheet

            sheet_result = try_write_message_label_to_sheet(
                cid,
                mid,
                editor=editor_norm,
                code="",
                rationale="",
                iterative=False,
            )
        except Exception:  # noqa: BLE001
            sheet_result = {"ok": False, "error": "sheet_sync_failed"}
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
            "sheet_sync": sheet_result,
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
    by[editor_norm] = row
    _labels[key] = {"by": by}
    save_message_labels()
    try:
        from app.sheet_labels import try_write_message_label_to_sheet

        sheet_result = try_write_message_label_to_sheet(
            cid,
            mid,
            editor=editor_norm,
            code=selected,
            rationale=rationale_norm,
            iterative=iterative_on,
        )
    except Exception:  # noqa: BLE001
        sheet_result = {"ok": False, "error": "sheet_sync_failed"}
    return {
        "key": key,
        "conv_id": cid,
        "message_number": mid,
        **row,
        "sheet_sync": sheet_result,
    }


def upsert_editor_label(
    conv_id: str,
    message_number: Union[str, int],
    editor: str,
    role: str = "",
    code: str = "",
    rationale: str = "",
    iterative: bool = False,
) -> dict[str, Any]:
    """Write a label for any allowed editor (including AI). Skips sheet sync for sonnet."""
    cid = (conv_id or "").strip()
    mid = str(message_number).strip()
    editor_norm = _normalize_editor(editor)
    if editor_norm not in ALLOWED_EDITORS:
        raise ValueError(f"Unsupported editor: {editor}")

    role_l = (role or "").strip().lower()
    if role_l in {"assistant"}:
        role_l = "bot"
    allowed = set(codes_for_role(role_l) if role_l else list(_ALL_CODES))
    allowed |= set(_ALL_CODES)

    selected = _pick_code(code, None, allowed=allowed)
    rationale_norm = (rationale or "").strip()
    iterative_on = bool(iterative) and role_l == "user"

    if selected and selected not in allowed:
        raise ValueError(f"Invalid code for role {role_l}: {selected}")

    load_message_labels()
    key = message_key(cid, mid)
    store = _coerce_store_row(_labels.get(key) or {"by": {}})
    by = dict(store.get("by") or {})

    stored_codes = [selected] if selected else []
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
        "source": "ai" if editor_norm == AI_EDITOR else "",
    }
    by[editor_norm] = row
    _labels[key] = {"by": by}
    return {"key": key, "conv_id": cid, "message_number": mid, **row}
