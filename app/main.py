from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
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

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
PUBLIC_DIR = ROOT / "public"
FRONTEND_DIR = PUBLIC_DIR if (PUBLIC_DIR / "index.html").exists() else STATIC_DIR

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def warmup():
    # Prefer cache built at deploy time; otherwise fetch/local fallback.
    load_activities()
    load_conversations()


@app.get("/", response_class=HTMLResponse)
async def index():
    return (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/styles.css")
async def styles():
    path = FRONTEND_DIR / "styles.css"
    if not path.exists():
        path = STATIC_DIR / "styles.css"
    return FileResponse(path)


@app.get("/app.js")
async def app_js():
    path = FRONTEND_DIR / "app.js"
    if not path.exists():
        path = STATIC_DIR / "app.js"
    return FileResponse(path)


@app.get("/api/filters")
async def filters(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
    creator: Optional[str] = Query(default=None),
    model: Optional[str] = Query(default=None),
):
    activity_opts = get_filter_options(creator=creator, app=app, model=model)
    conv_opts = get_conversation_filter_options(
        user=user,
        app=app,
        builder_only=builder_only,
        needs_attention=needs_attention,
    )
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


@app.post("/api/refresh")
async def refresh_data():
    from app.conversations_loader import reload_conversations
    from app.data_loader import reload_activities

    reload_activities()
    reload_conversations()
    activities = load_activities(force_refresh=True)
    conversations = load_conversations(force_refresh=True)
    return {
        "activities": len(activities),
        "conversations": len(conversations),
    }
