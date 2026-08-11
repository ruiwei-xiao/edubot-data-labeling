from __future__ import annotations

import csv
import io
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CACHE_PATH = DATA_DIR / "cache" / "activities.json"
LOCAL_CSV_PATH = DATA_DIR / "playlab_activities_with_messages - system_prompt (origin).csv"

DEFAULT_SHEET_ID = "1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ"
DEFAULT_SHEET_TAB = "system_prompt (origin)"

SETTING_PREFIX = "setting: "
TOOL_PREFIX = "tool: "

_cache: Optional[tuple[dict[str, Any], ...]] = None


def sheet_csv_url(sheet_id: Optional[str] = None, tab: Optional[str] = None) -> str:
    sid = sheet_id or os.environ.get("GOOGLE_SHEET_ID", DEFAULT_SHEET_ID)
    tab_name = tab or os.environ.get("GOOGLE_SHEET_SYSTEM_PROMPT_TAB", DEFAULT_SHEET_TAB)
    return (
        f"https://docs.google.com/spreadsheets/d/{sid}/gviz/tq"
        f"?tqx=out:csv&sheet={quote(tab_name)}"
    )


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


def fetch_sheet_csv(url: Optional[str] = None) -> str:
    target = url or sheet_csv_url()
    req = Request(target, headers={"User-Agent": "edubot-data-labeling/1.0"})
    with urlopen(req, timeout=120) as resp:
        return resp.read().decode("utf-8")


def build_activities_from_csv_text(text: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text))
    activities = []
    for row in reader:
        activity = _row_to_activity(row)
        if activity["id"]:
            activities.append(activity)
    activities.sort(
        key=lambda a: (a["date_sort"] or "", a["title"].lower()),
        reverse=True,
    )
    return activities


def save_activities_cache(activities: list[dict[str, Any]], path: Path = CACHE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(activities, ensure_ascii=False), encoding="utf-8")


def load_activities_cache(path: Path = CACHE_PATH) -> Optional[list[dict[str, Any]]]:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def reload_activities() -> None:
    global _cache
    _cache = None


def load_activities(force_refresh: bool = False) -> tuple[dict[str, Any], ...]:
    global _cache
    if _cache is not None and not force_refresh:
        return _cache

    cached = load_activities_cache()
    if cached is not None and not force_refresh:
        _cache = tuple(cached)
        return _cache

    try:
        text = fetch_sheet_csv()
        activities = build_activities_from_csv_text(text)
        try:
            save_activities_cache(activities)
        except OSError:
            pass
        _cache = tuple(activities)
        return _cache
    except Exception as sheet_err:
        if LOCAL_CSV_PATH.exists():
            with LOCAL_CSV_PATH.open(newline="", encoding="utf-8") as f:
                activities = []
                for row in csv.DictReader(f):
                    activity = _row_to_activity(row)
                    if activity["id"]:
                        activities.append(activity)
                activities.sort(
                    key=lambda a: (a["date_sort"] or "", a["title"].lower()),
                    reverse=True,
                )
            _cache = tuple(activities)
            return _cache
        raise FileNotFoundError(
            f"Unable to load activities from Google Sheet or local CSV: {sheet_err}"
        ) from sheet_err


def get_filter_options() -> dict[str, Any]:
    activities = load_activities()
    creator_counts: dict[str, int] = {}
    app_counts: dict[str, int] = {}
    model_counts: dict[str, int] = {}
    for a in activities:
        if a["creator"]:
            creator_counts[a["creator"]] = creator_counts.get(a["creator"], 0) + 1
        if a["app_name"]:
            app_counts[a["app_name"]] = app_counts.get(a["app_name"], 0) + 1
        if a["model"]:
            model_counts[a["model"]] = model_counts.get(a["model"], 0) + 1

    creators = [
        {"name": name, "count": creator_counts[name]}
        for name in sorted(creator_counts.keys())
    ]
    apps = [
        {"name": name, "count": app_counts[name]}
        for name in sorted(app_counts.keys())
    ]
    models = [
        {"name": name, "count": model_counts[name]}
        for name in sorted(model_counts.keys())
    ]
    dates = sorted(
        {a["date"] for a in activities if a["date"]},
        key=lambda d: _parse_date(d) or datetime.min,
    )
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
