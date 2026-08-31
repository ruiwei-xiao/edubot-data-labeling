from __future__ import annotations

import csv
import io
import json
import os
import tempfile
from pathlib import Path
from typing import Optional

import gspread
from google.oauth2.service_account import Credentials

from app.parser import SHEET_HEADERS, Conversation, all_sheet_rows, parse_playlab_pdf
from app.sheet_labels import get_gspread_client  # noqa: F401 - re-export

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def rows_to_csv(rows: list[list[str]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerows(rows)
    return buffer.getvalue()


def conversation_to_dict(conv: Conversation) -> dict:
    return {
        "conversation_id": conv.conversation_id,
        "title": conv.title,
        "user": conv.user,
        "message_count": conv.message_count,
        "date": conv.date_display,
        "source_file": conv.source_file,
        "messages": [
            {
                "msg_num": m.msg_num,
                "timestamp": m.timestamp,
                "elapsed": m.elapsed,
                "role": m.role,
                "message": m.message,
            }
            for m in conv.messages
        ],
    }


def export_to_google_sheet(
    conversations: list[Conversation],
    spreadsheet_id: Optional[str] = None,
    spreadsheet_title: str = "Playlab Conversation Logs",
    credentials_path: Optional[str] = None,
) -> str:
    client = get_gspread_client(credentials_path)
    rows = all_sheet_rows(conversations)

    if spreadsheet_id:
        spreadsheet = client.open_by_key(spreadsheet_id)
        worksheet = spreadsheet.sheet1
        worksheet.clear()
    else:
        spreadsheet = client.create(spreadsheet_title)
        worksheet = spreadsheet.sheet1

    worksheet.update(rows, value_input_option="RAW")
    return spreadsheet.url
