from __future__ import annotations

import csv
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_PATH = DATA_DIR / "playlab_activities_with_messages - system_prompt (origin).csv"

SETTING_PREFIX = "setting: "
TOOL_PREFIX = "tool: "


def _parse_date(value: str) -> Optional[datetime]:
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%b %d, %Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _truthy(value: str) -> bool:
    return (value or "").strip().upper() in {"TRUE", "1", "YES"}


def _row_to_activity(row: dict[str, str]) -> dict[str, Any]:
    settings = {
        key[len(SETTING_PREFIX) :]: _truthy(val)
        for key, val in row.items()
        if key.startswith(SETTING_PREFIX)
    }
    tools = {
        key[len(TOOL_PREFIX) :]: _truthy(val)
        for key, val in row.items()
        if key.startswith(TOOL_PREFIX)
    }
    enabled_tools = [name for name, on in tools.items() if on]
    enabled_settings = [name for name, on in settings.items() if on]

    ref_count = 0
    try:
        ref_count = int(row.get("reference_file_count") or 0)
    except ValueError:
        ref_count = 0

    date_raw = (row.get("date") or "").strip()
    parsed = _parse_date(date_raw)

    title = (row.get("title") or row.get("app_name_setting") or "Untitled").strip()
    app_name = (row.get("app_name_setting") or title).strip()
    creator = (row.get("creator") or "Unknown").strip()

    return {
        "id": row.get("id", "").strip(),
        "title": title,
        "app_name": app_name,
        "description": (row.get("description") or "").strip(),
        "creator": creator,
        "date": date_raw,
        "date_sort": parsed.isoformat() if parsed else "",
        "system_prompt": row.get("system_prompt") or "",
        "url": (row.get("url") or "").strip(),
        "model": (row.get("model") or "").strip(),
        "variability": (row.get("variability") or "").strip(),
        "interaction_style": (row.get("interaction_style") or "").strip(),
        "reference_files": (row.get("reference_files") or "").strip(),
        "reference_file_count": ref_count,
        "welcome_message": (row.get("welcome_message") or "").strip(),
        "app_description_setting": (row.get("app_description_setting") or "").strip(),
        "input_count": row.get("input_count") or "0",
        "input_names": (row.get("input_names") or "").strip(),
        "memory_contents": (row.get("memory_contents") or "").strip(),
        "has_errors": _truthy(row.get("has_errors", "")),
        "errors": (row.get("errors") or "").strip(),
        "settings": settings,
        "tools": tools,
        "enabled_tools": enabled_tools,
        "enabled_settings": enabled_settings,
        "knowledge_graph_enabled": (row.get("knowledge_graph_enabled") or "").strip(),
        "agentic_search_enabled": (row.get("agentic_search_enabled") or "").strip(),
    }


@lru_cache(maxsize=1)
def load_activities() -> tuple[dict[str, Any], ...]:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"Data file not found: {CSV_PATH}")

    activities: list[dict[str, Any]] = []
    with CSV_PATH.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            activity = _row_to_activity(row)
            if activity["id"]:
                activities.append(activity)

    activities.sort(
        key=lambda a: (a["date_sort"] or "", a["title"].lower()),
        reverse=True,
    )
    return tuple(activities)


def reload_activities() -> None:
    load_activities.cache_clear()


def get_filter_options() -> dict[str, list[str]]:
    activities = load_activities()
    creators = sorted({a["creator"] for a in activities if a["creator"]})
    apps = sorted({a["app_name"] for a in activities if a["app_name"]})
    models = sorted({a["model"] for a in activities if a["model"]})
    dates = sorted({a["date"] for a in activities if a["date"]}, key=lambda d: _parse_date(d) or datetime.min)
    return {
        "creators": creators,
        "apps": apps,
        "models": models,
        "dates": dates,
    }


def filter_activities(
    creator: Optional[str] = None,
    app: Optional[str] = None,
    model: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    needs_attention: bool = False,
) -> list[dict[str, Any]]:
    results = list(load_activities())

    if creator and creator.lower() != "all":
        results = [a for a in results if a["creator"] == creator]
    if app and app.lower() != "all":
        results = [a for a in results if a["app_name"] == app]
    if model and model.lower() != "all":
        results = [a for a in results if a["model"] == model]
    if needs_attention:
        results = [a for a in results if a["has_errors"] or not a["system_prompt"].strip()]

    if q:
        needle = q.lower().strip()
        results = [
            a
            for a in results
            if needle in a["title"].lower()
            or needle in a["app_name"].lower()
            or needle in a["creator"].lower()
            or needle in a["description"].lower()
            or needle in a["system_prompt"].lower()
        ]

    df = _parse_date(date_from) if date_from else None
    dt = _parse_date(date_to) if date_to else None
    if df or dt:
        filtered = []
        for a in results:
            ad = _parse_date(a["date"])
            if not ad:
                continue
            if df and ad < df:
                continue
            if dt and ad > dt:
                continue
            filtered.append(a)
        results = filtered

    return results


def get_activity(activity_id: str) -> Optional[dict[str, Any]]:
    for activity in load_activities():
        if activity["id"] == activity_id:
            return activity
    return None


def activity_list_item(activity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": activity["id"],
        "title": activity["title"],
        "app_name": activity["app_name"],
        "creator": activity["creator"],
        "date": activity["date"],
        "model": activity["model"],
        "reference_file_count": activity["reference_file_count"],
        "has_errors": activity["has_errors"],
        "description": activity["description"][:160],
        "enabled_tools_count": len(activity["enabled_tools"]),
    }
