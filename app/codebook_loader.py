"""Load codebook rows from the Google Sheet tab (public CSV export)."""

from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from app.sheet_fetch import fetch_url_text
from app.sheet_labels import DEFAULT_SHEET_ID

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / "data" / "cache" / "codebook_sheet.json"

DEFAULT_CODEBOOK_TAB = "codebook"
DEFAULT_SHEET_BOOK_ID = "default"

COL_ASPECT = 0
COL_CODE = 1
COL_DEFINITION = 2
COL_SECONDARY = 3
COL_EXAMPLE = 4
COL_BOUNDARY = 5

HEADER_ALIASES = {
    "aspect": {"aspect", ""},
    "code": {"code"},
    "definition": {"definition"},
    "secondary_code": {
        "secondary code",
        "what counts (where to look)",
        "what counts",
    },
    "examples": {"example (code it)", "example", "examples"},
    "boundary_rule": {
        "boundary rule (do not code it)",
        "boundary rule",
        "not this",
        "boundary",
    },
}

SHEET_HEADERS = [
    "Aspect",
    "Code",
    "Definition",
    "What counts (where to look)",
    "Example (code it)",
    "Boundary rule (do not code it)",
]


def sheet_id() -> str:
    """Same spreadsheet as conversations/labels by default; override with GOOGLE_CODEBOOK_SHEET_ID."""
    explicit = (os.environ.get("GOOGLE_CODEBOOK_SHEET_ID") or "").strip()
    if explicit:
        return explicit
    return os.environ.get("GOOGLE_SHEET_ID", DEFAULT_SHEET_ID)


def sheet_tab() -> str:
    return os.environ.get("GOOGLE_CODEBOOK_TAB", DEFAULT_CODEBOOK_TAB)


def sheet_book_id() -> str:
    return os.environ.get("GOOGLE_CODEBOOK_BOOK_ID", DEFAULT_SHEET_BOOK_ID)


def sheet_csv_url(sheet_id_override: Optional[str] = None, tab: Optional[str] = None) -> str:
    sid = sheet_id_override or sheet_id()
    tab_name = tab or sheet_tab()
    return (
        f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq"
        f"?tqx=out:csv&sheet={quote(tab_name)}"
    )


def fetch_codebook_csv(url: Optional[str] = None) -> str:
    return fetch_url_text(url or sheet_csv_url(), timeout=300, retries=6)


def _norm_header(value: str) -> str:
    return (value or "").strip().lower()


def _header_map(header: list[str]) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for idx, raw in enumerate(header):
        norm = _norm_header(raw)
        for field, aliases in HEADER_ALIASES.items():
            if norm in aliases and field not in mapping:
                mapping[field] = idx
    if "aspect" not in mapping and len(header) > COL_ASPECT:
        mapping["aspect"] = COL_ASPECT
    if "code" not in mapping and len(header) > COL_CODE:
        mapping["code"] = COL_CODE
    if "definition" not in mapping and len(header) > COL_DEFINITION:
        mapping["definition"] = COL_DEFINITION
    if "secondary_code" not in mapping and len(header) > COL_SECONDARY:
        mapping["secondary_code"] = COL_SECONDARY
    if "examples" not in mapping and len(header) > COL_EXAMPLE:
        mapping["examples"] = COL_EXAMPLE
    if "boundary_rule" not in mapping and len(header) > COL_BOUNDARY:
        mapping["boundary_rule"] = COL_BOUNDARY
    return mapping


def _cell(row: list[str], idx: int) -> str:
    if idx < 0 or idx >= len(row):
        return ""
    return (row[idx] or "").strip()


def _split_examples(text: str) -> list[str]:
    raw = (text or "").strip()
    if not raw:
        return []
    parts = [p.strip() for p in raw.replace("\r\n", "\n").split("\n") if p.strip()]
    return parts or [raw]


CONVERSATION_HEADER_MARKERS = {
    "conv_id",
    "message_number",
    "message_content",
    "message_content (trimmed)",
    "ruiwei_labeling",
    "jiayi_labeling",
    "system_prompt",
}


def is_codebook_csv_header(header: list[str]) -> bool:
    norms = {_norm_header(h) for h in header}
    if norms & CONVERSATION_HEADER_MARKERS:
        return False
    has_code = "code" in norms
    has_definition = "definition" in norms
    return has_code and has_definition


def parse_codebook_csv_header(text: str) -> list[str]:
    reader = csv.reader(io.StringIO(text or ""))
    try:
        return next(reader)
    except StopIteration:
        return []


def build_entries_from_csv_text(text: str) -> list[dict[str, Any]]:
    from app.codebook import _normalize_entry, _slug

    reader = csv.reader(io.StringIO(text or ""))
    try:
        header = next(reader)
    except StopIteration:
        return []

    if not is_codebook_csv_header(header):
        return []

    col = _header_map(header)
    current_aspect_label = ""
    entries: list[dict[str, Any]] = []

    for row in reader:
        if not any((cell or "").strip() for cell in row):
            continue

        aspect_cell = _cell(row, col.get("aspect", COL_ASPECT))
        if aspect_cell:
            current_aspect_label = aspect_cell

        code = _cell(row, col.get("code", COL_CODE))
        definition = _cell(row, col.get("definition", COL_DEFINITION))
        secondary = _cell(row, col.get("secondary_code", COL_SECONDARY))
        examples = _split_examples(_cell(row, col.get("examples", COL_EXAMPLE)))
        boundary = _cell(row, col.get("boundary_rule", COL_BOUNDARY))

        if not code and not definition and not secondary and not examples and not boundary:
            continue
        if not code:
            continue

        aspect_key = _aspect_key_from_label(current_aspect_label)
        entries.append(
            _normalize_entry(
                {
                    "aspect": aspect_key,
                    "aspect_label": current_aspect_label or aspect_key,
                    "fields": [aspect_key],
                    "code": code,
                    "label": code,
                    "description": definition,
                    "secondary_code": secondary,
                    "examples": examples,
                    "boundary_rule": boundary,
                }
            )
        )

    return entries


def _aspect_key_from_label(label: str) -> str:
    from app.codebook import (
        FIELD_BOT,
        FIELD_CONV,
        FIELD_LABELS,
        FIELD_PER_BOT,
        FIELD_USER,
        _slug,
    )

    raw = (label or "").strip()
    if not raw:
        return FIELD_USER
    lower = raw.lower()
    known = {
        "user message": FIELD_USER,
        "user": FIELD_USER,
        "bot message": FIELD_BOT,
        "bot": FIELD_BOT,
        "per conversation": FIELD_CONV,
        "conversation": FIELD_CONV,
        "per bot": FIELD_PER_BOT,
    }
    if lower in known:
        return known[lower]
    for key, name in FIELD_LABELS.items():
        if name.lower() == lower:
            return key
    return _slug(raw)


def entries_to_sheet_rows(entries: list[dict[str, Any]]) -> list[list[str]]:
    from app.codebook import _aspect_label_for, _sorted_entries

    rows: list[list[str]] = []
    current_aspect: Optional[str] = None
    for entry in _sorted_entries(entries):
        aspect_label = _aspect_label_for(entry)
        aspect_cell = aspect_label if aspect_label != current_aspect else ""
        current_aspect = aspect_label
        examples = entry.get("examples") or []
        example_text = "\n".join(str(x).strip() for x in examples if str(x).strip())
        boundary = str(entry.get("boundary_rule") or entry.get("not_this") or "").strip()
        rows.append(
            [
                aspect_cell,
                str(entry.get("code") or "").strip(),
                str(entry.get("description") or "").strip(),
                str(entry.get("secondary_code") or "").strip(),
                example_text,
                boundary,
            ]
        )
    return rows


def build_sheet_cache_payload(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "sheet_id": sheet_id(),
        "tab": sheet_tab(),
        "book_id": sheet_book_id(),
        "entries": entries,
    }


def save_codebook_sheet_cache(payload: dict[str, Any]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_codebook_sheet_cache() -> dict[str, Any]:
    if not CACHE_PATH.exists():
        return {}
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def fetch_and_cache_codebook() -> dict[str, Any]:
    text = fetch_codebook_csv()
    header = parse_codebook_csv_header(text)
    if not is_codebook_csv_header(header):
        tab = sheet_tab()
        preview = ", ".join(header[:4]) if header else "(empty)"
        raise ValueError(
            f"Tab '{tab}' is missing or not a codebook sheet (found columns: {preview}). "
            "Create a 'codebook' tab or save once from the UI to create it."
        )
    entries = build_entries_from_csv_text(text)
    payload = build_sheet_cache_payload(entries)
    save_codebook_sheet_cache(payload)
    return payload
