"""Write codebook entries to Google Sheet (service account)."""

from __future__ import annotations

import logging
from typing import Any

import gspread

from app.codebook_loader import entries_to_sheet_rows, sheet_id, sheet_tab, SHEET_HEADERS
from app.sheet_labels import credentials_available, get_gspread_client

logger = logging.getLogger(__name__)


def _open_codebook_worksheet() -> gspread.Worksheet:
    client = get_gspread_client()
    spreadsheet = client.open_by_key(sheet_id())
    try:
        return spreadsheet.worksheet(sheet_tab())
    except gspread.WorksheetNotFound:
        return spreadsheet.add_worksheet(title=sheet_tab(), rows=200, cols=len(SHEET_HEADERS))


def write_codebook_to_sheet(entries: list[dict[str, Any]]) -> dict[str, Any]:
    if not credentials_available():
        return {"ok": False, "skipped": True, "reason": "credentials_missing"}

    ws = _open_codebook_worksheet()
    data_rows = entries_to_sheet_rows(entries)
    values = [SHEET_HEADERS, *data_rows]

    ws.clear()
    ws.update("A1", values, value_input_option="RAW")

    return {
        "ok": True,
        "sheet_id": sheet_id(),
        "tab": sheet_tab(),
        "rows": len(data_rows),
        "url": f"https://docs.google.com/spreadsheets/d/{sheet_id()}/edit",
    }


def try_write_codebook_to_sheet(entries: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        return write_codebook_to_sheet(entries)
    except Exception as err:  # noqa: BLE001 - best-effort sync
        logger.exception("Failed to write codebook to Google Sheet")
        return {"ok": False, "error": str(err)}
