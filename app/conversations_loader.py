from __future__ import annotations

import csv
import io
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CACHE_PATH = DATA_DIR / "cache" / "conversations.json"
LOCAL_CSV_PATH = DATA_DIR / "playlab_activities_with_messages - all_data_origin.csv"

DEFAULT_SHEET_ID = "1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ"
DEFAULT_SHEET_TAB = "all_data_origin"

CONTINUED_KEYS = [
    "message_content_continued",
    *[f"message_content_continued_{i}" for i in range(2, 12)],
]

_cache: Optional[tuple[dict[str, Any], ...]] = None


def sheet_csv_url(sheet_id: Optional[str] = None, tab: Optional[str] = None) -> str:
    sid = sheet_id or os.environ.get("GOOGLE_SHEET_ID", DEFAULT_SHEET_ID)
    tab_name = tab or os.environ.get("GOOGLE_SHEET_ALL_DATA_TAB", DEFAULT_SHEET_TAB)
    return (
        f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq"
        f"?tqx=out:csv&sheet={quote(tab_name)}"
    )


def _truthy(value: str) -> bool:
    return (value or "").strip().upper() in {"TRUE", "1", "YES"}


def _parse_date(value: str) -> Optional[datetime]:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%b %d, %Y"):
        try:
            return datetime.strptime(
                value[:19] if "T" in value and fmt.startswith("%Y-%m-%dT") else value,
                fmt,
            )
        except ValueError:
            continue
    return None


def _assemble_message(row: dict[str, str]) -> str:
    trimmed = (row.get("message_content (trimmed)") or "").strip()
    parts = [trimmed] if trimmed else []
    for key in CONTINUED_KEYS:
        chunk = (row.get(key) or "").strip()
        if chunk:
            parts.append(chunk)
    if parts:
        return "\n".join(parts)
    raw = (row.get("message_content") or "").strip()
    if raw.startswith("<"):
        return re.sub(r"<[^>]+>", "", raw).strip()
    return raw


def _message_from_row(row: dict[str, str]) -> dict[str, Any]:
    try:
        msg_num = int(row.get("message_number") or 0)
    except ValueError:
        msg_num = 0
    return {
        "message_id": (row.get("message_id") or "").strip(),
        "message_number": msg_num,
        "role": (row.get("role") or "").strip().lower(),
        "msg_type": (row.get("msg_type") or "").strip(),
        "datetime": (row.get("datetime") or "").strip(),
        "time_since": (row.get("time_since") or "").strip(),
        "flagged": _truthy(row.get("flagged", "")),
        "content": _assemble_message(row),
    }


def _rows_to_conversations(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        cid = (row.get("conv_id") or "").strip()
        if not cid:
            continue
        buckets.setdefault(cid, []).append(row)

    conversations: list[dict[str, Any]] = []
    for cid, bucket in buckets.items():
        rows_sorted = sorted(
            bucket,
            key=lambda r: int(r.get("message_number") or 0)
            if str(r.get("message_number") or "").isdigit()
            else 0,
        )
        head = rows_sorted[0]
        user = (head.get("deanon_user") or head.get("user") or "Anonymous").strip() or "Anonymous"
        date_raw = (head.get("date") or "").strip()
        parsed = _parse_date(date_raw)
        try:
            turns = int(head.get("turns") or len(rows_sorted))
        except ValueError:
            turns = len(rows_sorted)

        messages = [_message_from_row(r) for r in rows_sorted]
        flagged_count = sum(1 for m in messages if m["flagged"])

        conversations.append({
            "id": cid,
            "conv_id": cid,
            "title": (head.get("title") or "Untitled").strip(),
            "system_prompt": head.get("system_prompt") or "",
            "url": (head.get("url") or "").strip(),
            "date": date_raw,
            "date_sort": parsed.isoformat() if parsed else date_raw,
            "user": user,
            "is_builder": _truthy(head.get("is_builder", "")),
            "turns": turns,
            "message_count": len(messages),
            "flagged_count": flagged_count,
            "has_flagged": flagged_count > 0,
            "messages": messages,
        })

    conversations.sort(
        key=lambda c: (c["date_sort"] or "", int(c["conv_id"]) if str(c["conv_id"]).isdigit() else 0),
        reverse=True,
    )
    return conversations


def fetch_sheet_csv(url: Optional[str] = None) -> str:
    target = url or sheet_csv_url()
    req = Request(target, headers={"User-Agent": "edubot-data-labeling/1.0"})
    with urlopen(req, timeout=180) as resp:
        return resp.read().decode("utf-8")


def parse_csv_text(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def build_conversations_from_csv_text(text: str) -> list[dict[str, Any]]:
    return _rows_to_conversations(parse_csv_text(text))


def save_conversations_cache(conversations: list[dict[str, Any]], path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(conversations, ensure_ascii=False), encoding="utf-8")


def load_conversations_cache(path: Path = CACHE_PATH) -> Optional[list[dict[str, Any]]]:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def reload_conversations() -> None:
    global _cache
    _cache = None


def load_conversations(force_refresh: bool = False) -> tuple[dict[str, Any], ...]:
    global _cache
    if _cache is not None and not force_refresh:
        return _cache

    # 1) Prefer prebuilt cache (Vercel build / local script)
    cached = load_conversations_cache()
    if cached is not None and not force_refresh:
        _cache = tuple(cached)
        return _cache

    # 2) Fetch Google Sheet
    try:
        text = fetch_sheet_csv()
        conversations = build_conversations_from_csv_text(text)
        try:
            save_conversations_cache(conversations)
        except OSError:
            pass
        _cache = tuple(conversations)
        return _cache
    except Exception as sheet_err:
        # 3) Fallback local CSV
        if LOCAL_CSV_PATH.exists():
            with LOCAL_CSV_PATH.open(newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            conversations = _rows_to_conversations(rows)
            _cache = tuple(conversations)
            return _cache
        raise FileNotFoundError(
            f"Unable to load conversations from Google Sheet or local CSV: {sheet_err}"
        ) from sheet_err


def get_conversation_filter_options() -> dict[str, Any]:
    conversations = load_conversations()
    users = sorted({c["user"] for c in conversations if c["user"]})
    apps = sorted({c["title"] for c in conversations if c["title"]})
    dates = sorted({c["date"] for c in conversations if c["date"]})
    return {
        "users": users,
        "apps": apps,
        "dates": dates,
        "total": len(conversations),
        "message_rows": sum(c["message_count"] for c in conversations),
    }


def filter_conversations(
    user: Optional[str] = None,
    app: Optional[str] = None,
    q: Optional[str] = None,
    builder_only: bool = False,
    needs_attention: bool = False,
) -> list[dict[str, Any]]:
    results = list(load_conversations())

    if user and user.lower() != "all":
        results = [c for c in results if c["user"] == user]
    if app and app.lower() != "all":
        results = [c for c in results if c["title"] == app]
    if builder_only:
        results = [c for c in results if c["is_builder"]]
    if needs_attention:
        results = [c for c in results if c["has_flagged"]]

    if q:
        needle = q.lower().strip()
        results = [
            c
            for c in results
            if needle in c["title"].lower()
            or needle in c["user"].lower()
            or needle in c["system_prompt"].lower()
            or any(needle in (m["content"] or "").lower() for m in c["messages"])
        ]

    return results


def get_conversation(conv_id: str) -> Optional[dict[str, Any]]:
    for conv in load_conversations():
        if conv["id"] == conv_id:
            return conv
    return None


def conversation_list_item(conv: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": conv["id"],
        "title": conv["title"],
        "user": conv["user"],
        "date": conv["date"],
        "turns": conv["turns"],
        "message_count": conv["message_count"],
        "is_builder": conv["is_builder"],
        "has_flagged": conv["has_flagged"],
        "flagged_count": conv["flagged_count"],
    }
