#!/usr/bin/env python3
"""Fetch Google Sheet tabs and write compact JSON caches for runtime/Vercel."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.conversations_loader import (  # noqa: E402
    build_conversations_from_csv_text,
    fetch_sheet_csv,
    save_conversations_cache,
    sheet_csv_url as conversations_sheet_url,
)
from app.data_loader import (  # noqa: E402
    build_activities_from_csv_text,
    fetch_sheet_csv as fetch_activities_csv,
    save_activities_cache,
    sheet_csv_url as activities_sheet_url,
)


def main() -> None:
    print("Fetching conversations from:", conversations_sheet_url())
    conv_text = fetch_sheet_csv(conversations_sheet_url())
    conversations = build_conversations_from_csv_text(conv_text)
    save_conversations_cache(conversations)
    print(f"Wrote {len(conversations)} conversations -> data/cache/conversations.json")

    print("Fetching activities from:", activities_sheet_url())
    act_text = fetch_activities_csv(activities_sheet_url())
    activities = build_activities_from_csv_text(act_text)
    save_activities_cache(activities)
    print(f"Wrote {len(activities)} activities -> data/cache/activities.json")


if __name__ == "__main__":
    main()
