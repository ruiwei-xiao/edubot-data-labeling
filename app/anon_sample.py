"""Stable random draw of anonymous (non-builder) conversations for the dashboard."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SAMPLE_PATH = ROOT / "data" / "anon_dashboard_sample.json"
DRAW_N = 20
DRAW_SEED = 20260919

_ids: set[str] | None = None


def is_anonymous_pool(conv: dict[str, Any]) -> bool:
    if conv.get("is_builder"):
        return False
    user = conv.get("user") or ""
    user_raw = conv.get("user_raw") or ""
    return bool(conv.get("is_anonymous") or user == "Anonymous" or user_raw == "Anonymous")


def is_prior_dashboard_conversation(conv: dict[str, Any]) -> bool:
    """The set already shown in conversation-only mode: anonymous and conv_id % 20 == 1."""
    if not is_anonymous_pool(conv):
        return False
    cid = str(conv.get("id") or conv.get("conv_id") or "").strip()
    return cid.isdigit() and int(cid) % 20 == 1


def anon_draw_ids(*, redraw: bool = False) -> set[str]:
    """Extra anonymous conversations, disjoint from the prior dashboard set.

    The draw is stored so a refresh does not reshuffle the set.
    """
    global _ids
    if _ids is not None and not redraw:
        return _ids

    from app.conversations_loader import load_conversations

    conversations = list(load_conversations())
    prior = {
        str(c.get("id") or c.get("conv_id") or "").strip()
        for c in conversations
        if is_prior_dashboard_conversation(c)
    }

    if SAMPLE_PATH.exists() and not redraw:
        try:
            data = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
            stored = [str(x).strip() for x in (data.get("ids") or []) if str(x).strip()]
            if (
                data.get("excludes") == "prior_half_sample"
                and len(stored) == DRAW_N
                and not (set(stored) & prior)
            ):
                _ids = set(stored)
                return _ids
        except (OSError, json.JSONDecodeError):
            pass

    pool = []
    for conv in conversations:
        if not is_anonymous_pool(conv):
            continue
        cid = str(conv.get("id") or conv.get("conv_id") or "").strip()
        if cid and cid not in prior:
            pool.append(cid)
    rng = random.Random(DRAW_SEED if not redraw else None)
    picked = rng.sample(pool, min(DRAW_N, len(pool)))
    SAMPLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SAMPLE_PATH.write_text(
        json.dumps(
            {
                "n": DRAW_N,
                "seed": None if redraw else DRAW_SEED,
                "pool": "anonymous_non_builder",
                "excludes": "prior_half_sample",
                "ids": picked,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    _ids = set(picked)
    return _ids


def is_anon_draw(conv_id: str) -> bool:
    return str(conv_id or "").strip() in anon_draw_ids()
