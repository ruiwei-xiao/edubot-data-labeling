#!/usr/bin/env python3
"""Fetch Google Sheet tabs and write compact JSON caches for runtime/Vercel."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.conversations_loader import (  # noqa: E402
    CACHE_PATH as CONV_CACHE_PATH,
    build_conversations_from_csv_text,
    fetch_sheet_csv,
    load_conversations_cache,
    save_conversations_cache,
    sheet_csv_url as conversations_sheet_url,
)
from app.data_loader import (  # noqa: E402
    CACHE_PATH as ACT_CACHE_PATH,
    build_activities_from_csv_text,
    fetch_sheet_csv as fetch_activities_csv,
    load_activities_cache,
    save_activities_cache,
    sheet_csv_url as activities_sheet_url,
)
from app.message_labels import (  # noqa: E402
    LABELS_PATH,
    _merge_label_stores,
    _read_file,
    build_message_labels_from_csv_text,
    save_message_labels_snapshot,
)


def _fetch_with_fallback(label: str, url: str, fetch_fn, build_fn, save_fn, cache_path: Path, load_fn) -> int:
    try:
        print(f"Fetching {label} from:", url)
        text = fetch_fn(url)
        rows = build_fn(text)
        if not rows:
            raise RuntimeError(f"{label} fetch returned 0 rows")
        save_fn(rows)
        print(f"Wrote {len(rows)} {label} -> {cache_path}")
        return len(rows)
    except Exception as err:
        existing = load_fn()
        if existing:
            print(f"WARN: {label} fetch failed ({err}); keeping existing cache ({len(existing)} rows)")
            return len(existing)
        raise RuntimeError(f"{label} fetch failed and no cache available: {err}") from err


def _fetch_conversations_and_labels() -> int:
    url = conversations_sheet_url()
    try:
        print("Fetching conversations from:", url)
        text = fetch_sheet_csv(url)
        rows = build_conversations_from_csv_text(text)
        if not rows:
            raise RuntimeError("conversations fetch returned 0 rows")
        save_conversations_cache(rows)
        print(f"Wrote {len(rows)} conversations -> {CONV_CACHE_PATH}")

        labels = build_message_labels_from_csv_text(text)
        existing = _read_file(LABELS_PATH)
        # Keep previously saved labels (e.g. not yet visible in Sheet export);
        # Sheet non-empty cells win for the same editor/message.
        merged = _merge_label_stores(existing, labels, sheet_wins_nonempty=True)
        if merged:
            save_message_labels_snapshot(merged, LABELS_PATH)
            print(
                f"Wrote {len(merged)} message labels -> {LABELS_PATH} "
                f"(sheet={len(labels)}, previous={len(existing)})"
            )
        else:
            print("WARN: message labels extract returned 0 labeled rows")
        return len(rows)
    except Exception as err:
        existing = load_conversations_cache()
        if existing:
            print(f"WARN: conversations fetch failed ({err}); keeping existing cache ({len(existing)} rows)")
            return len(existing)
        raise RuntimeError(f"conversations fetch failed and no cache available: {err}") from err


def main() -> None:
    _fetch_conversations_and_labels()
    _fetch_with_fallback(
        "activities",
        activities_sheet_url(),
        fetch_activities_csv,
        build_activities_from_csv_text,
        save_activities_cache,
        ACT_CACHE_PATH,
        load_activities_cache,
    )


if __name__ == "__main__":
    main()
