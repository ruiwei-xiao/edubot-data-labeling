"""Sync conversation-level labels to a dedicated Google Sheet."""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import gspread

from app.sheet_labels import credentials_available, get_gspread_client

logger = logging.getLogger(__name__)

DEFAULT_CONVERSATION_LABEL_SHEET_ID = "1vij_ivhf22pt6rY6wM92TDUFi921caJuqY2Dc5ky_s4"
DEFAULT_CONVERSATION_LABEL_TAB = "conversation_labels"

EDITORS = ("naacl_label1", "naacl_label2")

HEADERS = [
    "conv_id",
    "title",
    "naacl_label1_codes",
    "naacl_label1_updated_at",
    "naacl_label2_codes",
    "naacl_label2_updated_at",
    "last_editor",
    "updated_at",
]

_row_index: dict[str, int] = {}
_header_cache: list[str] = []
_index_ready = False


def _sheet_id() -> str:
    return os.environ.get(
        "GOOGLE_CONVERSATION_LABEL_SHEET_ID",
        DEFAULT_CONVERSATION_LABEL_SHEET_ID,
    )


def _sheet_tab() -> str:
    return os.environ.get(
        "GOOGLE_CONVERSATION_LABEL_TAB",
        DEFAULT_CONVERSATION_LABEL_TAB,
    )


def _open_worksheet() -> gspread.Worksheet:
    client = get_gspread_client()
    spreadsheet = client.open_by_key(_sheet_id())
    tab = _sheet_tab()
    try:
        return spreadsheet.worksheet(tab)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=tab, rows=2000, cols=len(HEADERS))
        ws.update("A1", [HEADERS], value_input_option="RAW")
        return ws


def _ensure_headers(ws: gspread.Worksheet) -> list[str]:
    headers = [h.strip() for h in ws.row_values(1)]
    if not headers:
        ws.update("A1", [HEADERS], value_input_option="RAW")
        return list(HEADERS)
    missing = [h for h in HEADERS if h not in headers]
    if missing:
        start_col = len(headers) + 1
        end_col = start_col + len(missing) - 1
        start_a1 = gspread.utils.rowcol_to_a1(1, start_col)
        end_a1 = gspread.utils.rowcol_to_a1(1, end_col)
        ws.update(f"{start_a1}:{end_a1}", [missing], value_input_option="RAW")
        headers.extend(missing)
    return headers


def _rebuild_index(ws: gspread.Worksheet, headers: list[str]) -> None:
    global _row_index, _header_cache, _index_ready
    if "conv_id" not in headers:
        raise RuntimeError("conversation label sheet missing conv_id column")
    cid_col = headers.index("conv_id") + 1
    values = ws.col_values(cid_col)
    index: dict[str, int] = {}
    for i, raw in enumerate(values[1:], start=2):  # 1-based sheet rows; skip header
        cid = (raw or "").strip()
        if cid:
            index[cid] = i
    _row_index = index
    _header_cache = headers
    _index_ready = True


def _format_codes(codes: list[str] | None) -> str:
    return ", ".join([c for c in (codes or []) if c])


def write_conversation_label_to_sheet(
    conv_id: str,
    editor: str,
    codes: list[str] | None = None,
    updated_at: str = "",
    title: str = "",
) -> dict[str, Any]:
    if not credentials_available():
        return {"ok": False, "skipped": True, "reason": "credentials_missing"}

    cid = str(conv_id or "").strip()
    editor_norm = (editor or "").strip().lower()
    if not cid:
        return {"ok": False, "error": "conv_id required"}
    if editor_norm not in EDITORS:
        return {"ok": False, "skipped": True, "reason": f"unsupported_editor:{editor_norm}"}

    global _index_ready
    ws = _open_worksheet()
    headers = _ensure_headers(ws)
    if not _index_ready or headers != _header_cache:
        _rebuild_index(ws, headers)

    row_num = _row_index.get(cid)
    if not row_num:
        _rebuild_index(ws, headers)
        row_num = _row_index.get(cid)

    codes_col = f"{editor_norm}_codes"
    at_col = f"{editor_norm}_updated_at"
    if codes_col not in headers or at_col not in headers:
        return {"ok": False, "error": f"missing_columns:{codes_col}/{at_col}"}

    codes_value = _format_codes(codes)
    at_value = (updated_at or "").strip()

    if not row_num:
        # Append new row
        row = [""] * len(headers)
        row[headers.index("conv_id")] = cid
        if "title" in headers and title:
            row[headers.index("title")] = title
        row[headers.index(codes_col)] = codes_value
        row[headers.index(at_col)] = at_value
        if "last_editor" in headers:
            row[headers.index("last_editor")] = editor_norm
        if "updated_at" in headers:
            row[headers.index("updated_at")] = at_value
        ws.append_row(row, value_input_option="RAW")
        # refresh index for this cid
        _rebuild_index(ws, headers)
        return {
            "ok": True,
            "action": "append",
            "conv_id": cid,
            "editor": editor_norm,
            "codes": codes_value,
            "sheet_id": _sheet_id(),
            "tab": _sheet_tab(),
        }

    updates = [
        {
            "range": gspread.utils.rowcol_to_a1(row_num, headers.index(codes_col) + 1),
            "values": [[codes_value]],
        },
        {
            "range": gspread.utils.rowcol_to_a1(row_num, headers.index(at_col) + 1),
            "values": [[at_value]],
        },
    ]
    if title and "title" in headers:
        # Only fill title if currently empty
        title_col = headers.index("title") + 1
        existing_title = ""
        try:
            existing_title = (ws.cell(row_num, title_col).value or "").strip()
        except Exception:  # noqa: BLE001
            existing_title = ""
        if not existing_title:
            updates.append(
                {
                    "range": gspread.utils.rowcol_to_a1(row_num, title_col),
                    "values": [[title]],
                }
            )
    if "last_editor" in headers:
        updates.append(
            {
                "range": gspread.utils.rowcol_to_a1(row_num, headers.index("last_editor") + 1),
                "values": [[editor_norm]],
            }
        )
    if "updated_at" in headers:
        updates.append(
            {
                "range": gspread.utils.rowcol_to_a1(row_num, headers.index("updated_at") + 1),
                "values": [[at_value]],
            }
        )
    ws.batch_update(updates, value_input_option="RAW")
    return {
        "ok": True,
        "action": "update",
        "row": row_num,
        "conv_id": cid,
        "editor": editor_norm,
        "codes": codes_value,
        "sheet_id": _sheet_id(),
        "tab": _sheet_tab(),
    }


def try_write_conversation_label_to_sheet(*args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return write_conversation_label_to_sheet(*args, **kwargs)
    except Exception as err:  # noqa: BLE001 - best-effort sync
        logger.exception("Failed to write conversation label to Google Sheet")
        return {"ok": False, "error": str(err)}
