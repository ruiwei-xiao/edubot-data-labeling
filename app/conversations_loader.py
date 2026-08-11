from __future__ import annotations

import csv
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_PATH = DATA_DIR / "playlab_activities_with_messages - all_data_origin.csv"

CONTINUED_KEYS = [
    "message_content_continued",
    *[f"message_content_continued_{i}" for i in range(2, 12)],
]


def _truthy(value: str) -> bool:
    return (value or "").strip().upper() in {"TRUE", "1", "YES"}


def _parse_date(value: str) -> Optional[datetime]:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%b %d, %Y"):
        try:
            return datetime.strptime(value[:19] if "T" in value and fmt.startswith("%Y-%m-%dT") else value, fmt)
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
    # strip simple HTML tags for display fallback
    if raw.startswith("<"):
        import re

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


@lru_cache(maxsize=1)
def load_conversations() -> tuple[dict[str, Any], ...]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Data file not found: {CSV_PATH}")

    buckets: dict[str, list[dict[str, str]]] = {}
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            cid = (row.get("conv_id") or "").strip()
            if not cid:
                continue
            buckets.setdefault(cid, []).append(row)

    conversations: list[dict[str, Any]] = []
    for cid, rows in buckets.items():
        rows_sorted = sorted(
            rows,
            key=lambda r: int(r.get("message_number") or 0) if str(r.get("message_number") or "").isdigit() else 0,
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
    return tuple(conversations)


def reload_conversations() -> None:
    load_conversations.cache_clear()


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
