"""Read/write author-testing labels on a dedicated Google Sheet tab.

Source of truth is the spreadsheet — no local JSON store.
Tab defaults to `testing_behavior` on the same workbook as conversations
(`GOOGLE_SHEET_ID`), overridable with `GOOGLE_TESTING_BEHAVIOR_TAB`.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import gspread

from app.sheet_labels import (
    DEFAULT_SHEET_ID,
    credentials_available,
    get_gspread_client,
)

logger = logging.getLogger(__name__)

DEFAULT_TAB = "testing_behavior"

SHEET_HEADERS = [
    "bot",
    "code",
    "confidence",
    "source",
    "editor",
    "rationale",
    "defect_observed",
    "updated_at",
]


def sheet_id() -> str:
    return os.environ.get("GOOGLE_SHEET_ID", DEFAULT_SHEET_ID)


def sheet_tab() -> str:
    return os.environ.get("GOOGLE_TESTING_BEHAVIOR_TAB", DEFAULT_TAB)


def _open_worksheet() -> gspread.Worksheet:
    client = get_gspread_client()
    spreadsheet = client.open_by_key(sheet_id())
    try:
        return spreadsheet.worksheet(sheet_tab())
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(
            title=sheet_tab(),
            rows=max(200, 50),
            cols=len(SHEET_HEADERS),
        )
        ws.update("A1", [SHEET_HEADERS], value_input_option="RAW")
        return ws


def _ensure_headers(ws: gspread.Worksheet) -> list[str]:
    headers = [h.strip() for h in ws.row_values(1)]
    if not headers:
        ws.update("A1", [SHEET_HEADERS], value_input_option="RAW")
        return list(SHEET_HEADERS)
    # If the tab exists but is the wrong schema, rewrite headers once.
    if [h.lower() for h in headers[: len(SHEET_HEADERS)]] != SHEET_HEADERS:
        # Keep existing data cells; just make sure the header row matches.
        ws.update("A1", [SHEET_HEADERS], value_input_option="RAW")
        return list(SHEET_HEADERS)
    return headers


def _row_to_label(headers: list[str], values: list[str]) -> Optional[dict[str, Any]]:
    mapped = {
        headers[i].strip().lower(): (values[i] if i < len(values) else "").strip()
        for i in range(len(headers))
    }
    bot = mapped.get("bot") or ""
    if not bot:
        return None
    code = mapped.get("code") or ""
    return {
        "bot": bot,
        "code": code,
        "confidence": mapped.get("confidence") or "",
        "source": mapped.get("source") or "",
        "editor": mapped.get("editor") or "",
        "rationale": mapped.get("rationale") or "",
        "defect_observed": mapped.get("defect_observed") or "",
        "updated_at": mapped.get("updated_at") or "",
    }


def _label_to_row(row: dict[str, Any]) -> list[str]:
    return [
        str(row.get("bot") or ""),
        str(row.get("code") or ""),
        str(row.get("confidence") or ""),
        str(row.get("source") or ""),
        str(row.get("editor") or ""),
        str(row.get("rationale") or ""),
        str(row.get("defect_observed") or ""),
        str(row.get("updated_at") or ""),
    ]


def read_labels_from_sheet() -> dict[str, dict[str, Any]]:
    """Fetch every label row keyed by bot name. Empty dict if credentials missing."""
    if not credentials_available():
        logger.warning("Google credentials missing; testing behavior labels unavailable")
        return {}

    ws = _open_worksheet()
    headers = _ensure_headers(ws)
    values = ws.get_all_values()
    out: dict[str, dict[str, Any]] = {}
    for raw in values[1:]:
        if not any(cell.strip() for cell in raw):
            continue
        row = _row_to_label(headers, raw)
        if not row or not row.get("code"):
            continue
        out[row["bot"]] = row
    return out


def upsert_label_on_sheet(row: dict[str, Any]) -> dict[str, Any]:
    """Insert or update one bot's label. Empty `code` deletes the row."""
    if not credentials_available():
        raise RuntimeError(
            "Google credentials not configured. Set GOOGLE_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_PATH."
        )

    bot = (row.get("bot") or "").strip()
    if not bot:
        raise ValueError("bot is required")

    ws = _open_worksheet()
    headers = _ensure_headers(ws)
    bot_col = headers.index("bot") + 1 if "bot" in headers else 1
    bots = ws.col_values(bot_col)
    existing_row: Optional[int] = None
    for i, name in enumerate(bots[1:], start=2):  # 1-indexed sheet rows; skip header
        if (name or "").strip() == bot:
            existing_row = i
            break

    code = (row.get("code") or "").strip()
    if not code:
        if existing_row is not None:
            ws.delete_rows(existing_row)
        return {"ok": True, "deleted": True, "bot": bot, "tab": sheet_tab()}

    cells = _label_to_row({**row, "bot": bot, "code": code})
    if existing_row is not None:
        start = gspread.utils.rowcol_to_a1(existing_row, 1)
        end = gspread.utils.rowcol_to_a1(existing_row, len(SHEET_HEADERS))
        ws.update(f"{start}:{end}", [cells], value_input_option="RAW")
        action = "updated"
    else:
        ws.append_row(cells, value_input_option="RAW")
        action = "inserted"

    return {
        "ok": True,
        "action": action,
        "bot": bot,
        "sheet_id": sheet_id(),
        "tab": sheet_tab(),
        "url": f"https://docs.google.com/spreadsheets/d/{sheet_id()}/edit#gid=0",
    }


def write_all_labels_to_sheet(labels: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Replace the whole tab (used once when migrating off JSON)."""
    if not credentials_available():
        raise RuntimeError("Google credentials not configured")

    ws = _open_worksheet()
    rows = [SHEET_HEADERS]
    for bot in sorted(labels.keys(), key=str.lower):
        row = labels[bot]
        if not (row.get("code") or "").strip():
            continue
        rows.append(_label_to_row({**row, "bot": bot}))

    ws.clear()
    ws.update("A1", rows, value_input_option="RAW")
    return {
        "ok": True,
        "rows": len(rows) - 1,
        "sheet_id": sheet_id(),
        "tab": sheet_tab(),
    }


def try_upsert_label(row: dict[str, Any]) -> dict[str, Any]:
    try:
        return upsert_label_on_sheet(row)
    except Exception as err:  # noqa: BLE001
        logger.exception("Failed to write testing behavior label for %s", row.get("bot"))
        return {"ok": False, "error": str(err)}
