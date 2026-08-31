from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Optional

import gspread
from google.oauth2.service_account import Credentials

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

DEFAULT_SHEET_ID = "1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ"
DEFAULT_SHEET_TAB = "all_data_origin"

LABEL_COLUMNS = {
    "ruiwei": ("ruiwei_labeling", "ruiwei_rationale"),
    "jiayi": ("jiayi_labeling", "jiayi_rationale"),
}
REQUIRED_LABEL_HEADERS = [
    "ruiwei_labeling",
    "ruiwei_rationale",
    "jiayi_labeling",
    "jiayi_rationale",
]

_row_index: dict[tuple[str, str], int] = {}
_header_cache: list[str] = []
_index_ready = False


def _sheet_id() -> str:
    return os.environ.get("GOOGLE_SHEET_ID", DEFAULT_SHEET_ID)


def _sheet_tab() -> str:
    return os.environ.get("GOOGLE_SHEET_ALL_DATA_TAB", DEFAULT_SHEET_TAB)


def credentials_available() -> bool:
    if (os.environ.get("GOOGLE_CREDENTIALS_JSON") or "").strip():
        return True
    path = os.environ.get("GOOGLE_CREDENTIALS_PATH") or ""
    return bool(path and Path(path).exists())


def get_gspread_client(credentials_path: Optional[str] = None) -> gspread.Client:
    raw = (os.environ.get("GOOGLE_CREDENTIALS_JSON") or "").strip()
    if raw:
        info = json.loads(raw)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
        return gspread.authorize(creds)

    path = credentials_path or os.environ.get("GOOGLE_CREDENTIALS_PATH")
    if not path or not Path(path).exists():
        raise FileNotFoundError(
            "Google credentials not found. Set GOOGLE_CREDENTIALS_JSON or GOOGLE_CREDENTIALS_PATH."
        )
    creds = Credentials.from_service_account_file(path, scopes=SCOPES)
    return gspread.authorize(creds)


def _open_data_worksheet() -> gspread.Worksheet:
    client = get_gspread_client()
    spreadsheet = client.open_by_key(_sheet_id())
    return spreadsheet.worksheet(_sheet_tab())


def _ensure_label_headers(ws: gspread.Worksheet) -> list[str]:
    headers = [h.strip() for h in ws.row_values(1)]
    missing = [h for h in REQUIRED_LABEL_HEADERS if h not in headers]
    if missing:
        start_col = len(headers) + 1
        end_col = start_col + len(missing) - 1
        start_a1 = gspread.utils.rowcol_to_a1(1, start_col)
        end_a1 = gspread.utils.rowcol_to_a1(1, end_col)
        ws.update(f"{start_a1}:{end_a1}", [missing], value_input_option="RAW")
        headers.extend(missing)
    return headers


def _rebuild_row_index(ws: gspread.Worksheet, headers: list[str]) -> None:
    global _row_index, _header_cache, _index_ready
    if "conv_id" not in headers or "message_number" not in headers:
        raise RuntimeError("Sheet is missing conv_id / message_number columns")

    cid_col = headers.index("conv_id") + 1
    mid_col = headers.index("message_number") + 1
    cid_vals = ws.col_values(cid_col)
    mid_vals = ws.col_values(mid_col)
    index: dict[tuple[str, str], int] = {}
    n = max(len(cid_vals), len(mid_vals))
    for i in range(1, n):  # skip header row (index 0)
        cid = (cid_vals[i] if i < len(cid_vals) else "").strip()
        mid = (mid_vals[i] if i < len(mid_vals) else "").strip()
        if cid and mid:
            index[(cid, mid)] = i + 1  # 1-based sheet row
    _row_index = index
    _header_cache = headers
    _index_ready = True


def _format_label_value(code: str, iterative: bool = False) -> str:
    value = (code or "").strip()
    if not value:
        return ""
    if iterative:
        return f"{value}|iterative"
    return value


def write_message_label_to_sheet(
    conv_id: str,
    message_number: str | int,
    editor: str,
    code: str = "",
    rationale: str = "",
    iterative: bool = False,
) -> dict[str, Any]:
    """Write one message label into all_data_origin labeling columns.

    Columns: ruiwei_labeling / ruiwei_rationale / jiayi_labeling / jiayi_rationale
    """
    if not credentials_available():
        return {"ok": False, "skipped": True, "reason": "credentials_missing"}

    editor_norm = (editor or "").strip().lower()
    if editor_norm not in LABEL_COLUMNS:
        return {"ok": False, "skipped": True, "reason": f"unsupported_editor:{editor_norm}"}

    cid = str(conv_id or "").strip()
    mid = str(message_number or "").strip()
    if not cid or not mid:
        return {"ok": False, "error": "conv_id and message_number required"}

    global _index_ready
    ws = _open_data_worksheet()
    headers = _ensure_label_headers(ws)
    if not _index_ready or headers != _header_cache:
        _rebuild_row_index(ws, headers)

    row_num = _row_index.get((cid, mid))
    if not row_num:
        # Row map may be stale after sheet edits; rebuild once.
        _rebuild_row_index(ws, headers)
        row_num = _row_index.get((cid, mid))
    if not row_num:
        return {"ok": False, "error": f"row_not_found:{cid}:{mid}"}

    label_col_name, rationale_col_name = LABEL_COLUMNS[editor_norm]
    label_col = headers.index(label_col_name) + 1
    rationale_col = headers.index(rationale_col_name) + 1
    label_value = _format_label_value(code, iterative=iterative)
    rationale_value = (rationale or "").strip()

    label_a1 = gspread.utils.rowcol_to_a1(row_num, label_col)
    rationale_a1 = gspread.utils.rowcol_to_a1(row_num, rationale_col)
    ws.batch_update(
        [
            {"range": label_a1, "values": [[label_value]]},
            {"range": rationale_a1, "values": [[rationale_value]]},
        ],
        value_input_option="RAW",
    )
    return {
        "ok": True,
        "row": row_num,
        "editor": editor_norm,
        "label": label_value,
        "rationale": rationale_value,
    }


def try_write_message_label_to_sheet(*args: Any, **kwargs: Any) -> dict[str, Any]:
    try:
        return write_message_label_to_sheet(*args, **kwargs)
    except Exception as err:  # noqa: BLE001 - best-effort sync; keep local save
        logger.exception("Failed to write message label to Google Sheet")
        return {"ok": False, "error": str(err)}
