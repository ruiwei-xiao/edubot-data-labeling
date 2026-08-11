from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.conversations_loader import (
    conversation_list_item,
    filter_conversations,
    get_conversation,
    get_conversation_filter_options,
    load_conversations,
)
from app.data_loader import (
    activity_list_item,
    filter_activities,
    get_activity,
    get_filter_options,
    load_activities,
)

app = FastAPI(title="Playlab Activities Browser")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def warmup():
    load_activities()
    # conversations CSV is large — load in background path on first request / here
    load_conversations()


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/api/filters")
async def filters():
    activity_opts = get_filter_options()
    conv_opts = get_conversation_filter_options()
    return {
        "activities": {
            **activity_opts,
            "total": len(load_activities()),
        },
        "conversations": conv_opts,
    }


@app.get("/api/activities")
async def list_activities(
    creator: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    model: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    needs_attention: bool = Query(default=False),
):
    items = filter_activities(
        creator=creator,
        app=app,
        model=model,
        q=q,
        date_from=date_from,
        date_to=date_to,
        needs_attention=needs_attention,
    )
    return {
        "count": len(items),
        "activities": [activity_list_item(a) for a in items],
    }


@app.get("/api/activities/{activity_id}")
async def activity_detail(activity_id: str):
    activity = get_activity(activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


@app.get("/api/conversations")
async def list_conversations(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
):
    items = filter_conversations(
        user=user,
        app=app,
        q=q,
        builder_only=builder_only,
        needs_attention=needs_attention,
    )
    return {
        "count": len(items),
        "conversations": [conversation_list_item(c) for c in items],
    }


@app.get("/api/conversations/{conv_id}")
async def conversation_detail(conv_id: str):
    conv = get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv
